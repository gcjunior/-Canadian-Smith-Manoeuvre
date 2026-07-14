import { describe, expect, it } from 'vitest';

import { createLogger } from '@csm/observability';

import { SimulatorClock } from './clock.js';
import { BrokerageSimulatorEngine, SimulatorHttpError } from './engine.js';
import { happyPathScenario, partialFillScenario } from './scenario/fixtures.js';
import { BrokerageSimulatorStore } from './store.js';

function createEngine(start = '2026-05-01T00:00:00.000Z') {
  const clock = new SimulatorClock(new Date(start));
  const store = new BrokerageSimulatorStore();
  const logger = createLogger({ service: 'brokerage-sim-test', level: 'error', pretty: false });
  const engine = new BrokerageSimulatorEngine({
    clock,
    store,
    logger,
    webhookSigningSecret: 'test-webhook-secret',
    webhooksEnabledDefault: true,
  });
  return { engine, clock, store };
}

describe('BrokerageSimulatorEngine', () => {
  it('settles deposits then fills notional market buys with fractional units', () => {
    const { engine } = createEngine();
    engine.loadScenario(happyPathScenario);
    const account = engine.createAccount({
      externalAccountId: 'ext-1',
      displayName: 'Non-reg',
    });

    const dep = engine.createDeposit({
      accountId: account.id,
      amountCents: 10_000_00n,
      idempotencyKey: 'dep-1',
    });
    expect(dep.statusCode).toBe(202);

    engine.runEvents(1_000);
    expect(engine.getDeposit((dep.body as { id: string }).id).state).toBe('SETTLED');
    expect(engine.getCash(account.id).settledCashCents).toBe('1000000');

    const order = engine.createOrder({
      accountId: account.id,
      symbol: 'XEQT',
      side: 'BUY',
      notionalCents: 3_000_00n,
      idempotencyKey: 'ord-1',
    });
    expect(order.statusCode).toBe(202);
    const orderId = (order.body as { id: string }).id;

    engine.runEvents(500);
    expect(engine.getOrder(orderId).state).toBe('SUBMITTED');

    engine.runEvents(1_000);
    const filled = engine.getOrder(orderId);
    expect(filled.state).toBe('FILLED');
    expect(filled.quantity).toBeTruthy();
    expect(engine.listPositions(account.id)).toHaveLength(1);

    const hooks = engine.getStore().webhooks.map((w) => w.type);
    expect(hooks).toContain('brokerage.deposit.updated');
    expect(hooks).toContain('brokerage.order.updated');
    expect(hooks).toContain('brokerage.fill.created');
  });

  it('replays deposit idempotency and conflicts on payload mismatch', () => {
    const { engine } = createEngine();
    engine.loadScenario({
      ...happyPathScenario,
      initialSettledCashCents: 0n,
    });
    const account = engine.createAccount({
      externalAccountId: 'ext-2',
      displayName: 'Pat',
    });

    const first = engine.createDeposit({
      accountId: account.id,
      amountCents: 500_00n,
      idempotencyKey: 'same',
    });
    const second = engine.createDeposit({
      accountId: account.id,
      amountCents: 500_00n,
      idempotencyKey: 'same',
    });
    expect(second.body).toEqual(first.body);

    expect(() =>
      engine.createDeposit({
        accountId: account.id,
        amountCents: 501_00n,
        idempotencyKey: 'same',
      }),
    ).toThrow(SimulatorHttpError);
  });

  it('partially fills then completes remaining quantity', () => {
    const { engine } = createEngine();
    engine.loadScenario({
      ...partialFillScenario,
      initialSettledCashCents: 50_000_00n,
    });
    const account = engine.createAccount({
      externalAccountId: 'ext-3',
      displayName: 'Partial',
      settledCashCents: 50_000_00n,
    });

    const orderRes = engine.createOrder({
      accountId: account.id,
      symbol: 'XEQT',
      side: 'BUY',
      notionalCents: 10_000_00n,
      idempotencyKey: 'partial-1',
    });
    const orderId = (orderRes.body as { id: string }).id;

    engine.runEvents(500);
    engine.runEvents(1_000);
    expect(engine.getOrder(orderId).state).toBe('PARTIALLY_FILLED');

    engine.runEvents(1_000);
    expect(engine.getOrder(orderId).state).toBe('FILLED');
    expect(engine.getStore().fills.length).toBe(2);
  });
});
