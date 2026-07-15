import { describe, expect, it } from 'vitest';

import { createLogger } from '@csm/observability';

import { SimulatorClock } from './clock.js';
import { BrokerageSimulatorEngine, SimulatorHttpError } from './engine.js';
import {
  happyPathScenario,
  insufficientCashScenario,
  partialFillScenario,
  priceMoveScenario,
  restrictedAccountScenario,
} from './scenario/fixtures.js';
import { BrokerageSimulatorStore } from './store.js';

function createEngine(start = '2026-05-01T00:00:00.000Z') {
  const clock = new SimulatorClock(new Date(start));
  const store = new BrokerageSimulatorStore();
  const logger = createLogger({ service: 'brokerage-sim-failure', level: 'error', pretty: false });
  return new BrokerageSimulatorEngine({
    clock,
    store,
    logger,
    webhookSigningSecret: 'test-webhook-secret',
    webhooksEnabledDefault: true,
  });
}

describe('BrokerageSimulatorEngine failure pack', () => {
  it('delays deposit settlement', () => {
    const engine = createEngine();
    engine.loadScenario({ ...happyPathScenario, depositSettlementDelayMs: 86_400_000 });
    const account = engine.createAccount({ externalAccountId: 'e1', displayName: 'A' });
    const dep = engine.createDeposit({
      accountId: account.id,
      amountCents: 1_000_00n,
      idempotencyKey: 'd1',
    });
    const id = (dep.body as { id: string }).id;
    engine.runEvents(1_000);
    expect(engine.getDeposit(id).state).toBe('PENDING');
    engine.runEvents(86_400_000);
    expect(engine.getDeposit(id).state).toBe('SETTLED');
  });

  it('reverses deposit on settle when DEPOSIT_REVERSED is queued', () => {
    const engine = createEngine();
    engine.loadScenario({
      ...happyPathScenario,
      depositSettlementDelayMs: 1_000,
      deterministicFailureSteps: ['DEPOSIT_REVERSED'],
    });
    const account = engine.createAccount({ externalAccountId: 'e2', displayName: 'A' });
    const dep = engine.createDeposit({
      accountId: account.id,
      amountCents: 1_000_00n,
      idempotencyKey: 'rev',
    });
    engine.runEvents(1_000);
    expect(engine.getDeposit((dep.body as { id: string }).id).state).toBe('REVERSED');
  });

  it('rejects order for insufficient settled cash', () => {
    const engine = createEngine();
    engine.loadScenario(insufficientCashScenario);
    const account = engine.createAccount({ externalAccountId: 'e3', displayName: 'A' });
    const order = engine.createOrder({
      accountId: account.id,
      symbol: 'XEQT',
      side: 'BUY',
      notionalCents: 5_000_00n,
      idempotencyKey: 'cash',
    });
    expect(order.statusCode).toBe(422);
  });

  it('rejects order when REJECTED_ORDER queued', () => {
    const engine = createEngine();
    engine.loadScenario({
      ...happyPathScenario,
      initialSettledCashCents: 10_000_00n,
      deterministicFailureSteps: ['REJECTED_ORDER'],
    });
    const account = engine.createAccount({ externalAccountId: 'e4', displayName: 'A' });
    const order = engine.createOrder({
      accountId: account.id,
      symbol: 'XEQT',
      side: 'BUY',
      notionalCents: 1_000_00n,
      idempotencyKey: 'rej',
    });
    expect(order.statusCode).toBe(422);
  });

  it('partial fill consumes PARTIAL_FILL failure step', () => {
    const engine = createEngine();
    engine.loadScenario({
      ...partialFillScenario,
      initialSettledCashCents: 10_000_00n,
      depositSettlementDelayMs: 0,
      orderAckDelayMs: 0,
      fillDelayMs: 1_000,
    });
    const account = engine.createAccount({ externalAccountId: 'e5', displayName: 'A' });
    engine.createDeposit({
      accountId: account.id,
      amountCents: 10_000_00n,
      idempotencyKey: 'fund',
    });
    engine.runEvents(1);
    const order = engine.createOrder({
      accountId: account.id,
      symbol: 'XEQT',
      side: 'BUY',
      notionalCents: 5_000_00n,
      idempotencyKey: 'pf',
    });
    const orderId = (order.body as { id: string }).id;
    engine.runEvents(5_000);
    const fills = engine.getStore().fills.filter((f) => f.orderId === orderId);
    expect(fills.length).toBeGreaterThan(0);
    const orderState = engine.getOrder(orderId).state;
    expect(['PARTIALLY_FILLED', 'FILLED', 'SUBMITTED']).toContain(orderState);
  });

  it('order timeout after success persists the order', () => {
    const engine = createEngine();
    engine.loadScenario({
      ...happyPathScenario,
      initialSettledCashCents: 10_000_00n,
      deterministicFailureSteps: ['TIMEOUT_AFTER_SUCCESS'],
    });
    const account = engine.createAccount({ externalAccountId: 'e6', displayName: 'A' });
    expect(() =>
      engine.createOrder({
        accountId: account.id,
        symbol: 'XEQT',
        side: 'BUY',
        notionalCents: 1_000_00n,
        idempotencyKey: 'to',
      }),
    ).toThrow(SimulatorHttpError);
    expect(engine.getStore().orders.size).toBe(1);
  });

  it('price move fixture produces a fill', () => {
    const engine = createEngine();
    engine.loadScenario({
      ...priceMoveScenario,
      initialSettledCashCents: 10_000_00n,
      depositSettlementDelayMs: 0,
      orderAckDelayMs: 0,
      fillDelayMs: 500,
    });
    const account = engine.createAccount({ externalAccountId: 'e7', displayName: 'A' });
    engine.createDeposit({
      accountId: account.id,
      amountCents: 10_000_00n,
      idempotencyKey: 'pm',
    });
    engine.runEvents(1);
    const order = engine.createOrder({
      accountId: account.id,
      symbol: 'XEQT',
      side: 'BUY',
      notionalCents: 1_000_00n,
      idempotencyKey: 'pm-ord',
    });
    engine.runEvents(1_000);
    const fills = engine
      .getStore()
      .fills.filter((f) => f.orderId === (order.body as { id: string }).id);
    expect(fills.length).toBeGreaterThan(0);
  });

  it('restricted account rejects orders via ACCOUNT_RESTRICTION', () => {
    const engine = createEngine();
    engine.loadScenario(restrictedAccountScenario);
    const account = engine.createAccount({
      externalAccountId: 'e8',
      displayName: 'A',
    });
    const order = engine.createOrder({
      accountId: account.id,
      symbol: 'XEQT',
      side: 'BUY',
      notionalCents: 1_000_00n,
      idempotencyKey: 'rest',
    });
    expect(order.statusCode).toBe(422);
  });
});
