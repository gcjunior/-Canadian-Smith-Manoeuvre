import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaForTests,
  createTestActivities,
  provisionActiveStrategy,
  wipeFinancialTables,
} from '../test/harness.js';

/**
 * End-to-end monthly conversion activity chain using FakeBank/FakeBrokerage + Postgres.
 * Does not start a Temporal Workflow.
 */
describe('monthly conversion activity integration', () => {
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
    graph = await provisionActiveStrategy(prisma, `int-${randomUUID().slice(0, 8)}`);
    const wired = createTestActivities({ prisma, repos: graph.repos });
    bank = wired.bankClient;
    brokerage = wired.brokerageClient;
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

  it('runs mortgage → heloc → transfer → order → ledger → reconcile', async () => {
    const correlationId = randomUUID();
    const base = {
      tenantId: graph.tenant.id,
      strategyId: graph.strategy.id,
      correlationId,
      paymentPeriod: '2026-07',
    };

    const reserved = await activities.reserveMonthlyCycle(base);
    const ctx = { ...base, cycleId: reserved.cycleId };

    const payment = await activities.findSettledMortgagePayment(ctx);
    await activities.verifyPaymentNotReversed({
      ...ctx,
      providerPaymentId: payment.providerPaymentId,
    });
    const { principalRepaidCents } = await activities.identifyPrincipalRepaid({
      ...ctx,
      mortgagePaymentId: payment.mortgagePaymentId,
    });
    const caps = await activities.calculateNewlyAvailableCredit({
      ...ctx,
      principalRepaidCents,
    });

    const heloc = await graph.repos.accounts.findHelocDetail(graph.tenant.id, graph.heloc.id);
    await prisma.helocCreditEvent.create({
      data: {
        tenantId: graph.tenant.id,
        helocId: heloc!.id,
        providerEventId: `cred_${randomUUID()}`,
        availableCreditCents: BigInt(caps.newlyAvailableCreditCents),
        creditDeltaCents: BigInt(caps.newlyAvailableCreditCents),
        relatedPaymentPeriod: '2026-07',
        observedAt: new Date(),
      },
    });

    const drawKey = randomUUID();
    const draw = await activities.initiateHelocDraw({
      ...ctx,
      amountCents: caps.drawAmountCents,
      idempotencyKey: drawKey,
    });
    bank.settleDraw(drawKey);
    await activities.confirmHelocDraw({
      ...ctx,
      idempotencyKey: drawKey,
      providerDrawId: draw.providerDrawId,
    });

    await activities.transitionCycleState({
      ...ctx,
      fromState: 'WAITING_FOR_MORTGAGE',
      toState: 'WAITING_FOR_HELOC',
    });
    await activities.transitionCycleState({
      ...ctx,
      fromState: 'WAITING_FOR_HELOC',
      toState: 'HELOC_DRAW_PENDING',
    });
    await activities.transitionCycleState({
      ...ctx,
      fromState: 'HELOC_DRAW_PENDING',
      toState: 'HELOC_DRAW_CONFIRMED',
    });

    const transferKey = randomUUID();
    const transfer = await activities.initiateBrokerageTransfer({
      ...ctx,
      amountCents: caps.drawAmountCents,
      idempotencyKey: transferKey,
    });
    bank.settleTransfer(transferKey);
    brokerage.settleDeposit(`${transferKey}:deposit`);
    await activities.confirmBrokerageTransfer({
      ...ctx,
      idempotencyKey: transferKey,
      providerTransferId: transfer.providerTransferId,
      providerDepositId: transfer.providerDepositId,
    });

    await activities.transitionCycleState({
      ...ctx,
      fromState: 'HELOC_DRAW_CONFIRMED',
      toState: 'BROKERAGE_TRANSFER_PENDING',
    });
    await activities.transitionCycleState({
      ...ctx,
      fromState: 'BROKERAGE_TRANSFER_PENDING',
      toState: 'BROKERAGE_FUNDED',
    });

    const cash = await activities.getSettledCash(ctx);
    expect(BigInt(cash.settledCashCents)).toBeGreaterThanOrEqual(BigInt(caps.drawAmountCents));

    const orderKey = randomUUID();
    const order = await activities.submitInvestmentOrder({
      ...ctx,
      notionalCents: caps.drawAmountCents,
      idempotencyKey: orderKey,
    });
    brokerage.fillOrder(orderKey);
    await activities.confirmInvestmentOrder({
      ...ctx,
      idempotencyKey: orderKey,
      providerOrderId: order.providerOrderId,
    });
    await activities.confirmInvestmentSettlement({
      ...ctx,
      idempotencyKey: orderKey,
      expectedNotionalCents: caps.drawAmountCents,
    });

    await activities.transitionCycleState({
      ...ctx,
      fromState: 'BROKERAGE_FUNDED',
      toState: 'ORDER_PENDING',
    });
    await activities.transitionCycleState({
      ...ctx,
      fromState: 'ORDER_PENDING',
      toState: 'ORDER_FILLED',
    });
    await activities.transitionCycleState({
      ...ctx,
      fromState: 'ORDER_FILLED',
      toState: 'RECONCILING',
    });

    await activities.appendLedgerEntries({
      ...ctx,
      entries: [
        {
          accountId: graph.heloc.id,
          businessEventId: `int-draw-${reserved.cycleId}`,
          direction: 'DEBIT',
          amountCents: caps.drawAmountCents,
          narrative: 'HELOC draw',
        },
        {
          accountId: graph.brokerage.id,
          businessEventId: `int-dep-${reserved.cycleId}`,
          direction: 'CREDIT',
          amountCents: caps.drawAmountCents,
          narrative: 'Brokerage funded',
        },
      ],
    });

    const reconciled = await activities.reconcileCycle(ctx);
    expect(reconciled.state).toBe('PASSED');

    const completed = await activities.completeCycle(ctx);
    expect(completed.state).toBe('COMPLETED');

    const audit = await activities.createAuditPackageMetadata({
      ...ctx,
      packageType: 'MonthlyConversionCycle',
      metadata: { outcome: 'COMPLETED', drawAmountCents: caps.drawAmountCents },
    });
    expect(audit.auditDocumentId).toBeTruthy();
  });
});
