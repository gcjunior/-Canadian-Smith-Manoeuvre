import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaForTests,
  createTestActivities,
  provisionActiveStrategy,
  wipeFinancialTables,
} from '../test/harness.js';

describe('brokerage activities', () => {
  const prisma = createPrismaForTests();
  let graph: Awaited<ReturnType<typeof provisionActiveStrategy>>;
  let brokerage: ReturnType<typeof createTestActivities>['brokerageClient'];
  let activities: ReturnType<typeof createTestActivities>['activities'];

  beforeAll(() => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';
  });

  beforeEach(async () => {
    await wipeFinancialTables(prisma);
    graph = await provisionActiveStrategy(prisma, `brk-${randomUUID().slice(0, 8)}`);
    const wired = createTestActivities({ prisma, repos: graph.repos });
    brokerage = wired.brokerageClient;
    activities = wired.activities;
    brokerage.cash.set(graph.brokerageProviderId, {
      accountId: graph.brokerageProviderId,
      currencyCode: 'CAD',
      settledCashCents: 100_000n,
      pendingCashCents: 0n,
      availableCashCents: 100_000n,
      restricted: false,
      observedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const ctx = () => ({
    tenantId: graph.tenant.id,
    strategyId: graph.strategy.id,
    correlationId: randomUUID(),
    paymentPeriod: '2026-07',
  });

  it('getSettledCash returns provider cash', async () => {
    const cash = await activities.getSettledCash(ctx());
    expect(cash.settledCashCents).toBe('100000');
  });

  it('submitInvestmentOrder is idempotent', async () => {
    const key = randomUUID();
    const first = await activities.submitInvestmentOrder({
      ...ctx(),
      notionalCents: '100000',
      idempotencyKey: key,
    });
    const second = await activities.submitInvestmentOrder({
      ...ctx(),
      notionalCents: '100000',
      idempotencyKey: key,
    });
    expect(second.investmentOrderId).toBe(first.investmentOrderId);
    expect(second.providerOrderId).toBe(first.providerOrderId);
  });

  it('confirmInvestmentOrder and settlement after fill', async () => {
    const key = randomUUID();
    const order = await activities.submitInvestmentOrder({
      ...ctx(),
      notionalCents: '100000',
      idempotencyKey: key,
    });
    brokerage.fillOrder(key);
    const confirmed = await activities.confirmInvestmentOrder({
      ...ctx(),
      idempotencyKey: key,
      providerOrderId: order.providerOrderId,
    });
    expect(confirmed.state).toBe('FILLED');

    const settled = await activities.confirmInvestmentSettlement({
      ...ctx(),
      idempotencyKey: key,
      expectedNotionalCents: '100000',
    });
    expect(settled.settled).toBe(true);
  });

  it('resolveAmbiguousInvestmentOrder looks up by key', async () => {
    const key = randomUUID();
    const order = await activities.submitInvestmentOrder({
      ...ctx(),
      notionalCents: '50000',
      idempotencyKey: key,
    });
    const resolved = await activities.resolveAmbiguousInvestmentOrder({
      ...ctx(),
      idempotencyKey: key,
    });
    expect(resolved.providerOrderId).toBe(order.providerOrderId);
  });
});
