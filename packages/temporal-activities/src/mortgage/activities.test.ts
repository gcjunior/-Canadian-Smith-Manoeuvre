import { randomUUID } from 'node:crypto';

import { ApplicationFailure } from '@temporalio/activity';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaForTests,
  createTestActivities,
  provisionActiveStrategy,
  wipeFinancialTables,
} from '../test/harness.js';

describe('mortgage activities', () => {
  const prisma = createPrismaForTests();
  let graph: Awaited<ReturnType<typeof provisionActiveStrategy>>;
  let bank: ReturnType<typeof createTestActivities>['bankClient'];
  let activities: ReturnType<typeof createTestActivities>['activities'];

  beforeAll(() => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';
  });

  beforeEach(async () => {
    await wipeFinancialTables(prisma);
    graph = await provisionActiveStrategy(prisma, `mtg-${randomUUID().slice(0, 8)}`);
    const wired = createTestActivities({ prisma, repos: graph.repos });
    bank = wired.bankClient;
    activities = wired.activities;
    bank.mortgagePayments.set(graph.mortgageProviderId, [
      {
        id: randomUUID(),
        mortgageId: graph.mortgageProviderId,
        providerPaymentId: `pay_${randomUUID()}`,
        paymentPeriod: '2026-07',
        state: 'SETTLED',
        totalAmountCents: 2_400_00n,
        principalAmountCents: 1_000_00n,
        interestAmountCents: 1_400_00n,
        scheduledAt: new Date().toISOString(),
        postedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
        reversedAt: null,
      },
    ]);
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

  it('findSettledMortgagePayment persists provider payment', async () => {
    const result = await activities.findSettledMortgagePayment(ctx());
    expect(result.state).toBe('SETTLED');
    expect(result.principalAmountCents).toBe('100000');
  });

  it('identifyPrincipalRepaid reads DB payment', async () => {
    const found = await activities.findSettledMortgagePayment(ctx());
    const principal = await activities.identifyPrincipalRepaid({
      ...ctx(),
      mortgagePaymentId: found.mortgagePaymentId,
    });
    expect(principal.principalRepaidCents).toBe('100000');
  });

  it('verifyPaymentNotReversed rejects REVERSED', async () => {
    const found = await activities.findSettledMortgagePayment(ctx());
    const payments = bank.mortgagePayments.get(graph.mortgageProviderId)!;
    payments[0]!.state = 'REVERSED';
    await expect(
      activities.verifyPaymentNotReversed({
        ...ctx(),
        providerPaymentId: found.providerPaymentId,
      }),
    ).rejects.toBeInstanceOf(ApplicationFailure);
  });
});
