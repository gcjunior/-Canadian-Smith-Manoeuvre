import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaForTests,
  createTestActivities,
  provisionActiveStrategy,
  wipeFinancialTables,
} from '../test/harness.js';

describe('transfer activities', () => {
  const prisma = createPrismaForTests();
  let graph: Awaited<ReturnType<typeof provisionActiveStrategy>>;
  let bank: ReturnType<typeof createTestActivities>['bankClient'];
  let brokerage: ReturnType<typeof createTestActivities>['brokerageClient'];
  let activities: ReturnType<typeof createTestActivities>['activities'];

  beforeAll(() => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';
  });

  beforeEach(async () => {
    await wipeFinancialTables(prisma);
    graph = await provisionActiveStrategy(prisma, `xfer-${randomUUID().slice(0, 8)}`);
    const wired = createTestActivities({ prisma, repos: graph.repos });
    bank = wired.bankClient;
    brokerage = wired.brokerageClient;
    activities = wired.activities;
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

  it('initiateBrokerageTransfer posts bank transfer and brokerage deposit', async () => {
    const key = randomUUID();
    const result = await activities.initiateBrokerageTransfer({
      ...ctx(),
      amountCents: '100000',
      idempotencyKey: key,
    });
    expect(result.providerTransferId).toMatch(/^xfer_/);
    expect(result.providerDepositId).toMatch(/^dep_/);

    const movement = await graph.repos.moneyMovements.findByIdempotencyKey(graph.tenant.id, key);
    expect(movement?.sourceAccountId).toBe(graph.bank.id);
    expect(movement?.sourceAccountId).not.toBe(graph.heloc.id);

    const again = await activities.initiateBrokerageTransfer({
      ...ctx(),
      amountCents: '100000',
      idempotencyKey: key,
    });
    expect(again.moneyMovementId).toBe(result.moneyMovementId);
  });

  it('confirmBrokerageTransfer after settle', async () => {
    const key = randomUUID();
    const initiated = await activities.initiateBrokerageTransfer({
      ...ctx(),
      amountCents: '100000',
      idempotencyKey: key,
    });
    bank.settleTransfer(key);
    brokerage.settleDeposit(`${key}:deposit`);
    const confirmed = await activities.confirmBrokerageTransfer({
      ...ctx(),
      idempotencyKey: key,
      providerTransferId: initiated.providerTransferId,
      providerDepositId: initiated.providerDepositId,
    });
    expect(confirmed.transferState).toBe('SETTLED');
    expect(confirmed.depositState).toBe('SETTLED');
  });

  it('resolveAmbiguousBrokerageTransfer recovers provider refs', async () => {
    const key = randomUUID();
    const initiated = await activities.initiateBrokerageTransfer({
      ...ctx(),
      amountCents: '50000',
      idempotencyKey: key,
    });
    const resolved = await activities.resolveAmbiguousBrokerageTransfer({
      ...ctx(),
      idempotencyKey: key,
    });
    expect(resolved.providerTransferId).toBe(initiated.providerTransferId);
    expect(resolved.providerDepositId).toBe(initiated.providerDepositId);
  });
});
