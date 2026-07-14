import { describe, expect, it } from 'vitest';

import { createLogger } from '@csm/observability';

import { SimulatorClock } from './clock.js';
import { BankSimulatorEngine, SimulatorHttpError } from './engine.js';
import { happyPathScenario, nsfInterestScenario } from './scenario/fixtures.js';
import { BankSimulatorStore } from './store.js';

function createEngine(clockStart = '2026-03-01T00:00:00.000Z') {
  const clock = new SimulatorClock(new Date(clockStart));
  const store = new BankSimulatorStore();
  const logger = createLogger({ service: 'bank-sim-test', level: 'error', pretty: false });
  const engine = new BankSimulatorEngine({
    clock,
    store,
    logger,
    webhookSigningSecret: 'test-webhook-secret',
    webhooksEnabledDefault: true,
  });
  return { engine, clock, store };
}

function bootstrapAccounts(engine: BankSimulatorEngine) {
  engine.loadScenario(happyPathScenario);
  const user = engine.createUser({ externalUserId: 'u1', displayName: 'Pat' });
  const mortgage = engine.createAccount({
    userId: user.id,
    kind: 'MORTGAGE',
    displayAlias: 'primary-mortgage',
    providerAccountId: 'mtg-1',
  });
  const heloc = engine.createAccount({
    userId: user.id,
    kind: 'HELOC',
    displayAlias: 'primary-heloc',
    providerAccountId: 'heloc-1',
  });
  const ordinary = engine.createAccount({
    userId: user.id,
    kind: 'ORDINARY',
    displayAlias: 'chequing',
    providerAccountId: 'ord-1',
  });
  return {
    user,
    mortgageId: mortgage.mortgage!.id,
    helocId: heloc.heloc!.id,
    ordinaryAccountId: ordinary.account.id,
  };
}

describe('BankSimulatorEngine', () => {
  it('moves mortgage payments SCHEDULED → POSTED → SETTLED then readvances HELOC', () => {
    const { engine } = createEngine();
    const ids = bootstrapAccounts(engine);

    const payment = engine.scheduleMortgagePayment({
      mortgageId: ids.mortgageId,
      paymentPeriod: '2026-03',
      totalAmountCents: 2_500_00n,
      principalAmountCents: 1_000_00n,
      interestAmountCents: 1_500_00n,
    });
    expect(payment.state).toBe('SCHEDULED');

    engine.runEvents(1_000);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('POSTED');

    engine.runEvents(2_000);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('SETTLED');

    const before = engine.getHelocAvailability(ids.helocId);
    expect(before.existingAvailableCreditCents).toBe('1000000');
    expect(before.newlyAvailableCreditCents).toBe('0');

    engine.runEvents(3_000);
    const after = engine.getHelocAvailability(ids.helocId);
    expect(after.newlyAvailableCreditCents).toBe('100000');
    expect(after.existingAvailableCreditCents).toBe('1000000');
    expect(after.availableCreditCents).toBe('1100000');

    const creditEvents = engine.getStore().creditEvents;
    expect(creditEvents).toHaveLength(1);
    expect(creditEvents[0]?.isNewlyCreated).toBe(true);
    expect(creditEvents[0]?.creditDeltaCents).toBe(1_000_00n);
  });

  it('returns original draw for same idempotency key and 409 on payload mismatch', () => {
    const { engine } = createEngine();
    const ids = bootstrapAccounts(engine);

    const first = engine.createHelocDraw(ids.helocId, {
      amountCents: 50_000n,
      idempotencyKey: 'draw-1',
    });
    expect(first.statusCode).toBe(202);

    const second = engine.createHelocDraw(ids.helocId, {
      amountCents: 50_000n,
      idempotencyKey: 'draw-1',
    });
    expect(second.statusCode).toBe(202);
    expect(second.body).toEqual(first.body);

    expect(() =>
      engine.createHelocDraw(ids.helocId, {
        amountCents: 60_000n,
        idempotencyKey: 'draw-1',
      }),
    ).toThrow(SimulatorHttpError);
  });

  it('fails interest debit on NSF without touching investment draw path', () => {
    const { engine } = createEngine();
    engine.loadScenario(nsfInterestScenario);
    const user = engine.createUser({ externalUserId: 'u2', displayName: 'Pat' });
    const heloc = engine.createAccount({
      userId: user.id,
      kind: 'HELOC',
      displayAlias: 'heloc',
      providerAccountId: 'h',
    });
    const ordinary = engine.createAccount({
      userId: user.id,
      kind: 'ORDINARY',
      displayAlias: 'ord',
      providerAccountId: 'o',
    });

    const { paymentId } = engine.postInterestCharge({
      helocId: heloc.heloc!.id,
      ordinaryAccountId: ordinary.account.id,
      interestPeriod: '2026-03',
      amountCents: 200_00n,
    });

    engine.runEvents(1_000);
    const payment = engine.getStore().interestPayments.get(paymentId);
    expect(payment?.state).toBe('FAILED');
    expect(payment?.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(ordinary.account.balanceCents).toBe(10_00n);
    expect(engine.getStore().draws.size).toBe(0);
  });

  it('emits signed webhook events for payment lifecycle', () => {
    const { engine } = createEngine();
    const ids = bootstrapAccounts(engine);
    engine.scheduleMortgagePayment({
      mortgageId: ids.mortgageId,
      paymentPeriod: '2026-03',
      totalAmountCents: 1_00n,
      principalAmountCents: 1_00n,
      interestAmountCents: 0n,
    });
    const hooks = engine.getStore().webhooks.filter((w) => w.type === 'mortgage.payment.updated');
    expect(hooks.length).toBeGreaterThanOrEqual(1);
    expect(hooks[0]?.signature.startsWith('sha256=')).toBe(true);
  });
});
