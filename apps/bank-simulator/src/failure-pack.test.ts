import { describe, expect, it } from 'vitest';

import { createLogger } from '@csm/observability';

import { SimulatorClock } from './clock.js';
import { BankSimulatorEngine, SimulatorHttpError } from './engine.js';
import { happyPathScenario } from './scenario/fixtures.js';
import type { BankScenarioConfig } from './scenario/schema.js';
import { BankSimulatorStore } from './store.js';

function createEngine(clockStart = '2026-03-01T00:00:00.000Z') {
  const clock = new SimulatorClock(new Date(clockStart));
  const store = new BankSimulatorStore();
  const logger = createLogger({ service: 'bank-sim-failure', level: 'error', pretty: false });
  return new BankSimulatorEngine({
    clock,
    store,
    logger,
    webhookSigningSecret: 'test-webhook-secret',
    webhooksEnabledDefault: true,
  });
}

function bootstrap(engine: BankSimulatorEngine, scenario: Partial<BankScenarioConfig> = {}) {
  engine.loadScenario({
    ...happyPathScenario,
    ...scenario,
    scenarioId: scenario.scenarioId ?? 'fail',
  });
  const user = engine.createUser({ externalUserId: 'u1', displayName: 'Pat' });
  const mortgage = engine.createAccount({
    userId: user.id,
    kind: 'MORTGAGE',
    displayAlias: 'mtg',
    providerAccountId: 'mtg-1',
  });
  const heloc = engine.createAccount({
    userId: user.id,
    kind: 'HELOC',
    displayAlias: 'heloc',
    providerAccountId: 'heloc-1',
  });
  const ordinary = engine.createAccount({
    userId: user.id,
    kind: 'ORDINARY',
    displayAlias: 'ord',
    providerAccountId: 'ord-1',
  });
  return {
    mortgageId: mortgage.mortgage!.id,
    helocId: heloc.heloc!.id,
    ordinaryAccountId: ordinary.account.id,
    brokerageLinkId: ordinary.account.id,
  };
}

describe('BankSimulatorEngine failure pack', () => {
  it('payment settles immediately (zero delays)', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      mortgagePostingDelayMs: 0,
      mortgageSettlementDelayMs: 0,
      helocReadvanceDelayMs: 0,
    });
    engine.scheduleMortgagePayment({
      mortgageId: ids.mortgageId,
      paymentPeriod: '2026-03',
      totalAmountCents: 2_500_00n,
      principalAmountCents: 1_000_00n,
      interestAmountCents: 1_500_00n,
    });
    engine.runEvents(1);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('SETTLED');
  });

  it('payment takes one day to settle', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      mortgagePostingDelayMs: 0,
      mortgageSettlementDelayMs: 86_400_000,
      helocReadvanceDelayMs: 0,
    });
    engine.scheduleMortgagePayment({
      mortgageId: ids.mortgageId,
      paymentPeriod: '2026-03',
      totalAmountCents: 2_500_00n,
      principalAmountCents: 1_000_00n,
      interestAmountCents: 1_500_00n,
    });
    engine.runEvents(1);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('POSTED');
    engine.runEvents(86_400_000);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('SETTLED');
  });

  it('payment takes five days to settle', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      mortgagePostingDelayMs: 0,
      mortgageSettlementDelayMs: 5 * 86_400_000,
      helocReadvanceDelayMs: 0,
    });
    engine.scheduleMortgagePayment({
      mortgageId: ids.mortgageId,
      paymentPeriod: '2026-03',
      totalAmountCents: 2_500_00n,
      principalAmountCents: 1_000_00n,
      interestAmountCents: 1_500_00n,
    });
    engine.runEvents(1);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('POSTED');
    engine.runEvents(4 * 86_400_000);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('POSTED');
    engine.runEvents(86_400_000);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('SETTLED');
  });

  it('payment never settles when reversed after posting', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      mortgagePostingDelayMs: 0,
      deterministicFailureSteps: ['REVERSED_AFTER_POSTING'],
    });
    engine.scheduleMortgagePayment({
      mortgageId: ids.mortgageId,
      paymentPeriod: '2026-03',
      totalAmountCents: 2_500_00n,
      principalAmountCents: 1_000_00n,
      interestAmountCents: 1_500_00n,
    });
    engine.runEvents(1);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('REVERSED');
  });

  it('payment reverses after settlement attempt', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      mortgagePostingDelayMs: 0,
      mortgageSettlementDelayMs: 1_000,
      deterministicFailureSteps: ['REVERSED_MORTGAGE_PAYMENT'],
    });
    engine.scheduleMortgagePayment({
      mortgageId: ids.mortgageId,
      paymentPeriod: '2026-03',
      totalAmountCents: 2_500_00n,
      principalAmountCents: 1_000_00n,
      interestAmountCents: 1_500_00n,
    });
    engine.runEvents(1);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('POSTED');
    engine.runEvents(1_000);
    expect(engine.listMortgagePayments(ids.mortgageId)[0]?.state).toBe('REVERSED');
  });

  it('HELOC readvances late relative to settlement', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      mortgagePostingDelayMs: 0,
      mortgageSettlementDelayMs: 0,
      helocReadvanceDelayMs: 86_400_000,
    });
    engine.scheduleMortgagePayment({
      mortgageId: ids.mortgageId,
      paymentPeriod: '2026-03',
      totalAmountCents: 2_500_00n,
      principalAmountCents: 1_000_00n,
      interestAmountCents: 1_500_00n,
    });
    engine.runEvents(1);
    expect(engine.getHelocAvailability(ids.helocId).newlyAvailableCreditCents).toBe('0');
    engine.runEvents(86_400_000);
    expect(engine.getHelocAvailability(ids.helocId).newlyAvailableCreditCents).toBe('100000');
  });

  it('existing unused credit without new credit event leaves newlyAvailable at zero until readvance', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      initialBalances: {
        mortgagePrincipalCents: 450_000_00n,
        helocCreditLimitCents: 200_000_00n,
        helocBalanceOwedCents: 0n,
        helocExistingAvailableCreditCents: 50_000_00n,
        ordinaryBankBalanceCents: 5_000_00n,
      },
      mortgagePostingDelayMs: 0,
      mortgageSettlementDelayMs: 0,
      helocReadvanceDelayMs: 86_400_000,
    });
    const before = engine.getHelocAvailability(ids.helocId);
    expect(before.existingAvailableCreditCents).toBe('5000000');
    expect(before.newlyAvailableCreditCents).toBe('0');
    engine.scheduleMortgagePayment({
      mortgageId: ids.mortgageId,
      paymentPeriod: '2026-03',
      totalAmountCents: 2_500_00n,
      principalAmountCents: 1_000_00n,
      interestAmountCents: 1_500_00n,
    });
    engine.runEvents(1);
    expect(engine.getHelocAvailability(ids.helocId).newlyAvailableCreditCents).toBe('0');
  });

  it('rejects blocked, delinquent, and explicit draw rejections', () => {
    for (const step of ['HELOC_BLOCKED', 'HELOC_DELINQUENT', 'DRAW_REJECTED'] as const) {
      const engine = createEngine();
      const ids = bootstrap(engine, {
        deterministicFailureSteps: [step],
        initialBalances: {
          mortgagePrincipalCents: 450_000_00n,
          helocCreditLimitCents: 200_000_00n,
          helocBalanceOwedCents: 0n,
          helocExistingAvailableCreditCents: 100_000_00n,
          ordinaryBankBalanceCents: 5_000_00n,
        },
      });
      const result = engine.createHelocDraw(ids.helocId, {
        amountCents: 10_000_00n,
        idempotencyKey: `k-${step}`,
      });
      expect(result.statusCode).toBe(422);
      expect((result.body as { failureCode: string }).failureCode).toBe(step);
    }
  });

  it('draw timed out before processing never creates settle job side effects', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      deterministicFailureSteps: ['TIMEOUT_BEFORE_PROCESSING'],
      initialBalances: {
        mortgagePrincipalCents: 450_000_00n,
        helocCreditLimitCents: 200_000_00n,
        helocBalanceOwedCents: 0n,
        helocExistingAvailableCreditCents: 100_000_00n,
        ordinaryBankBalanceCents: 5_000_00n,
      },
    });
    expect(() =>
      engine.createHelocDraw(ids.helocId, { amountCents: 10_000_00n, idempotencyKey: 'pre' }),
    ).toThrow(SimulatorHttpError);
    expect(engine.getStore().draws.size).toBe(0);
  });

  it('draw timed out after succeeding still persists the draw', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      deterministicFailureSteps: ['TIMEOUT_AFTER_SUCCESS'],
      initialBalances: {
        mortgagePrincipalCents: 450_000_00n,
        helocCreditLimitCents: 200_000_00n,
        helocBalanceOwedCents: 0n,
        helocExistingAvailableCreditCents: 100_000_00n,
        ordinaryBankBalanceCents: 5_000_00n,
      },
    });
    expect(() =>
      engine.createHelocDraw(ids.helocId, { amountCents: 10_000_00n, idempotencyKey: 'post' }),
    ).toThrow(SimulatorHttpError);
    expect(engine.getStore().draws.size).toBe(1);
  });

  it('transfer pending for several days then settles', () => {
    const engine = createEngine();
    bootstrap(engine, { transferSettlementDelayMs: 3 * 86_400_000 });
    const heloc = [...engine.getStore().accounts.values()].find((a) => a.kind === 'HELOC')!.id;
    const ord = [...engine.getStore().accounts.values()].find((a) => a.kind === 'ORDINARY')!.id;
    const accepted = engine.createTransfer({
      sourceAccountId: heloc,
      destinationAccountId: ord,
      amountCents: 1_000_00n,
      idempotencyKey: 'xfer-slow',
    });
    expect(accepted.statusCode).toBe(202);
    const id = (accepted.body as { id: string }).id;
    expect(engine.getTransfer(id).state).toBe('PENDING');
    engine.runEvents(2 * 86_400_000);
    expect(engine.getTransfer(id).state).toBe('PENDING');
    engine.runEvents(86_400_000);
    expect(engine.getTransfer(id).state).toBe('SETTLED');
  });

  it('rejects transfer and reverses transfer on settle', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      deterministicFailureSteps: ['TRANSFER_REJECTED'],
      transferSettlementDelayMs: 0,
    });
    const helocAccountId = [...engine.getStore().accounts.values()].find(
      (a) => a.kind === 'HELOC',
    )!.id;
    const ordinaryId = [...engine.getStore().accounts.values()].find(
      (a) => a.kind === 'ORDINARY',
    )!.id;
    const rejected = engine.createTransfer({
      sourceAccountId: helocAccountId,
      destinationAccountId: ordinaryId,
      amountCents: 1_000_00n,
      idempotencyKey: 'rej',
    });
    expect(rejected.statusCode).toBe(422);

    const engine2 = createEngine();
    bootstrap(engine2, {
      deterministicFailureSteps: ['TRANSFER_REVERSED'],
      transferSettlementDelayMs: 1_000,
    });
    const heloc2 = [...engine2.getStore().accounts.values()].find((a) => a.kind === 'HELOC')!.id;
    const ord2 = [...engine2.getStore().accounts.values()].find((a) => a.kind === 'ORDINARY')!.id;
    const accepted = engine2.createTransfer({
      sourceAccountId: heloc2,
      destinationAccountId: ord2,
      amountCents: 1_000_00n,
      idempotencyKey: 'rev',
    });
    expect(accepted.statusCode).toBe(202);
    engine2.runEvents(1_000);
    const transfer = engine2.getTransfer((accepted.body as { id: string }).id);
    expect(transfer.state).toBe('REVERSED');
  });

  it('duplicate transfer request returns original response', () => {
    const engine = createEngine();
    bootstrap(engine);
    const heloc = [...engine.getStore().accounts.values()].find((a) => a.kind === 'HELOC')!.id;
    const ord = [...engine.getStore().accounts.values()].find((a) => a.kind === 'ORDINARY')!.id;
    const first = engine.createTransfer({
      sourceAccountId: heloc,
      destinationAccountId: ord,
      amountCents: 1_000_00n,
      idempotencyKey: 'dup',
    });
    const second = engine.createTransfer({
      sourceAccountId: heloc,
      destinationAccountId: ord,
      amountCents: 1_000_00n,
      idempotencyKey: 'dup',
    });
    expect(second.statusCode).toBe(first.statusCode);
    expect((second.body as { id: string }).id).toBe((first.body as { id: string }).id);
  });

  it('transfer timed out after succeeding persists transfer', () => {
    const engine = createEngine();
    bootstrap(engine, { deterministicFailureSteps: ['TIMEOUT_AFTER_SUCCESS'] });
    const heloc = [...engine.getStore().accounts.values()].find((a) => a.kind === 'HELOC')!.id;
    const ord = [...engine.getStore().accounts.values()].find((a) => a.kind === 'ORDINARY')!.id;
    expect(() =>
      engine.createTransfer({
        sourceAccountId: heloc,
        destinationAccountId: ord,
        amountCents: 1_000_00n,
        idempotencyKey: 'to',
      }),
    ).toThrow(SimulatorHttpError);
    expect(engine.getStore().transfers.size).toBe(1);
  });

  it('ordinary NSF fails interest debit settlement', () => {
    const engine = createEngine();
    const ids = bootstrap(engine, {
      deterministicFailureSteps: ['ORDINARY_ACCOUNT_NSF'],
      interestDebitDelayMs: 0,
      initialBalances: {
        mortgagePrincipalCents: 450_000_00n,
        helocCreditLimitCents: 200_000_00n,
        helocBalanceOwedCents: 10_000_00n,
        helocExistingAvailableCreditCents: 0n,
        ordinaryBankBalanceCents: 10_00n,
      },
    });
    engine.postInterestCharge({
      helocId: ids.helocId,
      interestPeriod: '2026-03',
      amountCents: 500_00n,
      ordinaryAccountId: ids.ordinaryAccountId,
    });
    engine.runEvents(1);
    const payments = engine.listInterestPayments(ids.helocId);
    expect(payments.some((p) => p.paymentState === 'FAILED')).toBe(true);
  });
});
