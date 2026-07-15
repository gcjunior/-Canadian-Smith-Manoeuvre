import { randomUUID } from 'node:crypto';

import { ApplicationFailure } from '@temporalio/activity';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaForTests,
  createTestActivities,
  provisionActiveStrategy,
  wipeFinancialTables,
} from '../test/harness.js';

describe('interest activities', () => {
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
    graph = await provisionActiveStrategy(prisma, `int-${randomUUID().slice(0, 8)}`);
    const wired = createTestActivities({ prisma, repos: graph.repos });
    bank = wired.bankClient;
    activities = wired.activities;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const ctx = (period = '2026-07') => ({
    tenantId: graph.tenant.id,
    strategyId: graph.strategy.id,
    correlationId: randomUUID(),
    interestPeriod: period,
  });

  it('reserveInterestCycle is idempotent per period', async () => {
    const first = await activities.reserveInterestCycle({
      ...ctx(),
      interestPeriod: '2026-07',
    });
    const second = await activities.reserveInterestCycle({
      ...ctx(),
      interestPeriod: '2026-07',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.cycleId).toBe(first.cycleId);
    expect(second.state).toBe('AWAITING_CHARGE');
  });

  it('findPostedInterestCharge persists charge and findOrdinaryInterestDebit confirms debit', async () => {
    const providerChargeId = `int_${randomUUID()}`;
    const chargeUuid = randomUUID();
    const paymentUuid = randomUUID();
    const debitId = randomUUID();

    bank.interestCharges.set(graph.helocProviderId, [
      {
        id: chargeUuid,
        helocId: graph.helocProviderId,
        providerChargeId,
        interestPeriod: '2026-07',
        amountCents: 250_00n,
        state: 'POSTED',
        postedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);
    bank.interestPayments.set(graph.helocProviderId, [
      {
        chargeId: chargeUuid,
        providerChargeId,
        interestPeriod: '2026-07',
        chargeState: 'POSTED',
        chargeAmountCents: 250_00n,
        paymentId: paymentUuid,
        providerPaymentId: `intdebit_${randomUUID()}`,
        paymentState: 'SETTLED',
        ordinaryAccountId: graph.bankProviderId,
        debitId,
        amountCents: 250_00n,
        failureCode: null,
        settledAt: new Date().toISOString(),
      },
    ]);
    bank.ordinaryDebits.set(debitId, {
      id: debitId,
      accountId: graph.bankProviderId,
      amountCents: 250_00n,
      relatedInterestPaymentId: paymentUuid,
      narrative: 'HELOC interest',
      state: 'SETTLED',
      createdAt: new Date().toISOString(),
      settledAt: new Date().toISOString(),
      interestPeriod: '2026-07',
      helocId: graph.helocProviderId,
      providerPaymentId: `intdebit_${randomUUID()}`,
    });

    const reserved = await activities.reserveInterestCycle({
      ...ctx(),
      interestPeriod: '2026-07',
    });
    const charge = await activities.findPostedInterestCharge({
      ...ctx(),
      cycleId: reserved.cycleId,
    });
    expect(charge.amountCents).toBe('25000');
    expect(charge.providerChargeId).toBe(providerChargeId);

    const debit = await activities.findOrdinaryInterestDebit({
      ...ctx(),
      cycleId: reserved.cycleId,
      chargeId: charge.chargeId,
      providerChargeId: charge.providerChargeId,
    });
    expect(debit.state).toBe('SETTLED');
    expect(debit.amountCents).toBe('25000');

    const settled = await activities.confirmInterestDebitSettlement({
      ...ctx(),
      cycleId: reserved.cycleId,
      debitId: debit.debitId,
      paymentId: debit.paymentId,
    });
    expect(settled.state).toBe('SETTLED');

    await activities.validateInterestPaymentRules({
      ...ctx(),
      cycleId: reserved.cycleId,
      chargeId: charge.chargeId,
      debitId: debit.debitId,
      chargeAmountCents: charge.amountCents,
      debitAmountCents: debit.amountCents,
      ordinaryAccountId: debit.ordinaryAccountId,
    });

    await activities.transitionInterestCycleState({
      ...ctx(),
      cycleId: reserved.cycleId,
      fromState: 'AWAITING_CHARGE',
      toState: 'AWAITING_DEBIT',
    });
    await activities.transitionInterestCycleState({
      ...ctx(),
      cycleId: reserved.cycleId,
      fromState: 'AWAITING_DEBIT',
      toState: 'RECONCILING',
    });

    const snap = await activities.loadStrategySnapshot({
      ...ctx(),
      cycleId: reserved.cycleId,
    });
    await activities.appendLedgerEntries({
      ...ctx(),
      cycleId: reserved.cycleId,
      entries: [
        {
          accountId: snap.bankAccountId,
          businessEventId: `interest:${reserved.cycleId}:debit`,
          direction: 'DEBIT',
          amountCents: charge.amountCents,
          narrative: 'Ordinary bank debit for HELOC interest',
          interestCycleId: reserved.cycleId,
        },
        {
          accountId: snap.helocAccountId,
          businessEventId: `interest:${reserved.cycleId}:credit`,
          direction: 'CREDIT',
          amountCents: charge.amountCents,
          narrative: 'HELOC interest charge payment',
          interestCycleId: reserved.cycleId,
        },
      ],
    });

    const reconciled = await activities.reconcileInterestCycle({
      ...ctx(),
      cycleId: reserved.cycleId,
    });
    expect(reconciled.state).toBe('PASSED');

    const completed = await activities.completeInterestCycle({
      ...ctx(),
      cycleId: reserved.cycleId,
    });
    expect(completed.state).toBe('COMPLETED');
  });

  it('validateInterestPaymentRules rejects amount mismatch', async () => {
    const reserved = await activities.reserveInterestCycle({
      ...ctx(),
      interestPeriod: '2026-07',
    });
    const ordinary = await graph.repos.accounts.findOrdinaryBankDetail(
      graph.tenant.id,
      graph.bank.id,
    );
    await expect(
      activities.validateInterestPaymentRules({
        ...ctx(),
        cycleId: reserved.cycleId,
        chargeId: randomUUID(),
        debitId: randomUUID(),
        chargeAmountCents: '10000',
        debitAmountCents: '9999',
        ordinaryAccountId: ordinary!.id,
      }),
    ).rejects.toMatchObject({
      type: 'INTEREST_AMOUNT_MISMATCH',
    } satisfies Partial<ApplicationFailure>);
  });

  it('failInterestCycle pauses strategy (default conversion pause policy)', async () => {
    const reserved = await activities.reserveInterestCycle({
      ...ctx(),
      interestPeriod: '2026-07',
    });
    const result = await activities.failInterestCycle({
      ...ctx(),
      cycleId: reserved.cycleId,
      code: 'INSUFFICIENT_FUNDS',
      message: 'NSF on interest debit',
      terminalState: 'PAUSED',
    });
    expect(result.state).toBe('PAUSED');
    const strategy = await graph.repos.strategies.findById(graph.tenant.id, graph.strategy.id);
    expect(strategy?.state).toBe('PAUSED');
    const cycle = await graph.repos.interestCycles.findById(graph.tenant.id, reserved.cycleId);
    expect(cycle?.state).toBe('PAUSED');
  });
});
