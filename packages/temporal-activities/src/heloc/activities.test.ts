import { randomUUID } from 'node:crypto';

import { ApplicationFailure } from '@temporalio/activity';
import { ProviderClientError } from '@csm/bank-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaForTests,
  createTestActivities,
  provisionActiveStrategy,
  wipeFinancialTables,
} from '../test/harness.js';

describe('heloc activities', () => {
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
    graph = await provisionActiveStrategy(prisma, `heloc-${randomUUID().slice(0, 8)}`);
    const wired = createTestActivities({ prisma, repos: graph.repos });
    bank = wired.bankClient;
    activities = wired.activities;
    bank.availability.set(graph.helocProviderId, {
      helocId: graph.helocProviderId,
      availableCreditCents: 50_000_00n,
      existingAvailableCreditCents: 49_000_00n,
      newlyAvailableCreditCents: 1_000_00n,
      creditLimitCents: 50_000_00n,
      balanceOwedCents: 0n,
      observedAt: new Date().toISOString(),
      stale: false,
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

  it('getHelocAvailability returns provider values', async () => {
    const avail = await activities.getHelocAvailability(ctx());
    expect(avail.newlyAvailableCreditCents).toBe('100000');
  });

  it('calculateNewlyAvailableCredit applies caps', async () => {
    const result = await activities.calculateNewlyAvailableCredit({
      ...ctx(),
      principalRepaidCents: '150000',
    });
    expect(result.newlyAvailableCreditCents).toBe('100000');
    expect(result.drawAmountCents).toBe('100000');
  });

  it('initiateHelocDraw persists intent then provider ref and is idempotent', async () => {
    const key = randomUUID();
    const first = await activities.initiateHelocDraw({
      ...ctx(),
      amountCents: '100000',
      idempotencyKey: key,
    });
    const second = await activities.initiateHelocDraw({
      ...ctx(),
      amountCents: '100000',
      idempotencyKey: key,
    });
    expect(second.moneyMovementId).toBe(first.moneyMovementId);
    expect(second.providerDrawId).toBe(first.providerDrawId);
  });

  it('confirmHelocDraw settles after provider settle', async () => {
    const key = randomUUID();
    const initiated = await activities.initiateHelocDraw({
      ...ctx(),
      amountCents: '100000',
      idempotencyKey: key,
    });
    bank.settleDraw(key);
    const confirmed = await activities.confirmHelocDraw({
      ...ctx(),
      idempotencyKey: key,
      providerDrawId: initiated.providerDrawId,
    });
    expect(confirmed.state).toBe('SETTLED');
  });

  it('initiateHelocDraw marks AMBIGUOUS_RESULT non-retryable', async () => {
    bank.failNextDrawWith = new ProviderClientError({
      kind: 'AMBIGUOUS_RESULT',
      message: 'timeout',
      operation: 'test',
    });
    await expect(
      activities.initiateHelocDraw({
        ...ctx(),
        amountCents: '100000',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ nonRetryable: true, type: 'AMBIGUOUS_RESULT' });
  });

  it('resolveAmbiguousHelocDraw looks up by idempotency key', async () => {
    const key = randomUUID();
    const initiated = await activities.initiateHelocDraw({
      ...ctx(),
      amountCents: '100000',
      idempotencyKey: key,
    });
    const resolved = await activities.resolveAmbiguousHelocDraw({
      ...ctx(),
      idempotencyKey: key,
    });
    expect(resolved.providerDrawId).toBe(initiated.providerDrawId);
  });

  it('getHelocInterestCharge and confirmInterestPayment', async () => {
    const chargeId = randomUUID();
    bank.interestCharges.set(graph.helocProviderId, [
      {
        id: randomUUID(),
        helocId: graph.helocProviderId,
        providerChargeId: chargeId,
        interestPeriod: '2026-07',
        amountCents: 250_00n,
        state: 'POSTED',
        postedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);
    const charge = await activities.getHelocInterestCharge({
      ...ctx(),
      interestPeriod: '2026-07',
    });
    expect(charge.amountCents).toBe('25000');

    const ordinary = await graph.repos.accounts.findOrdinaryBankDetail(
      graph.tenant.id,
      graph.bank.id,
    );
    const debitId = randomUUID();
    bank.ordinaryDebits.set(debitId, {
      id: debitId,
      accountId: graph.bankProviderId,
      amountCents: 250_00n,
      relatedInterestPaymentId: randomUUID(),
      narrative: 'HELOC interest',
      state: 'SETTLED',
      createdAt: new Date().toISOString(),
      settledAt: new Date().toISOString(),
    });
    const debit = await activities.confirmInterestPayment({
      ...ctx(),
      ordinaryAccountId: ordinary!.id,
      debitId,
    });
    expect(debit.state).toBe('SETTLED');
  });

  it('rejects inactive strategy', async () => {
    await graph.repos.strategies.updateState(
      graph.tenant.id,
      graph.strategy.id,
      graph.strategy.version,
      'PAUSED',
      'test',
    );
    await expect(activities.getHelocAvailability(ctx())).rejects.toBeInstanceOf(ApplicationFailure);
  });
});
