import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaForTests,
  createTestActivities,
  provisionActiveStrategy,
  wipeFinancialTables,
} from '../test/harness.js';

describe('cycle and audit activities', () => {
  const prisma = createPrismaForTests();
  let graph: Awaited<ReturnType<typeof provisionActiveStrategy>>;
  let activities: ReturnType<typeof createTestActivities>['activities'];

  beforeAll(() => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';
  });

  beforeEach(async () => {
    await wipeFinancialTables(prisma);
    graph = await provisionActiveStrategy(prisma, `cyc-${randomUUID().slice(0, 8)}`);
    activities = createTestActivities({ prisma, repos: graph.repos }).activities;
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

  it('loadStrategySnapshot returns cents as strings', async () => {
    const snap = await activities.loadStrategySnapshot(ctx());
    expect(snap.symbol).toBe('VCN.TO');
    expect(snap.userMonthlyCapCents).toBe('200000');
  });

  it('reserveMonthlyCycle creates and transitions SCHEDULED→WAITING_FOR_MORTGAGE', async () => {
    const reserved = await activities.reserveMonthlyCycle({
      ...ctx(),
      paymentPeriod: '2026-07',
    });
    expect(reserved.created).toBe(true);
    expect(reserved.state).toBe('WAITING_FOR_MORTGAGE');

    const again = await activities.reserveMonthlyCycle({
      ...ctx(),
      paymentPeriod: '2026-07',
    });
    expect(again.cycleId).toBe(reserved.cycleId);
    expect(again.created).toBe(false);
  });

  it('transitionCycleState, recordOperation, ledger, audit, complete', async () => {
    const reserved = await activities.reserveMonthlyCycle({
      ...ctx(),
      paymentPeriod: '2026-07',
    });
    const cycleCtx = { ...ctx(), cycleId: reserved.cycleId };

    await activities.transitionCycleState({
      ...cycleCtx,
      fromState: 'WAITING_FOR_MORTGAGE',
      toState: 'WAITING_FOR_HELOC',
    });

    const op = await activities.recordOperation({
      ...cycleCtx,
      operationKey: `op-${reserved.cycleId}`,
      operationType: 'HELOC_DRAW',
      payload: { amountCents: '1000' },
    });
    expect(op.auditId).toBeTruthy();
    const opAgain = await activities.recordOperation({
      ...cycleCtx,
      operationKey: `op-${reserved.cycleId}`,
      operationType: 'HELOC_DRAW',
      payload: { amountCents: '1000' },
    });
    expect(opAgain.auditId).toBe(op.auditId);

    const snap = await activities.loadStrategySnapshot(cycleCtx);
    const ledger = await activities.appendLedgerEntries({
      ...cycleCtx,
      entries: [
        {
          accountId: snap.helocAccountId,
          businessEventId: `draw-debit-${reserved.cycleId}`,
          direction: 'DEBIT',
          amountCents: '100000',
          narrative: 'HELOC draw',
        },
        {
          accountId: snap.bankAccountId,
          businessEventId: `draw-credit-${reserved.cycleId}`,
          direction: 'CREDIT',
          amountCents: '100000',
          narrative: 'Cash from HELOC',
        },
      ],
    });
    expect(ledger.createdCount).toBe(2);
    const ledgerAgain = await activities.appendLedgerEntries({
      ...cycleCtx,
      entries: [
        {
          accountId: snap.helocAccountId,
          businessEventId: `draw-debit-${reserved.cycleId}`,
          direction: 'DEBIT',
          amountCents: '100000',
          narrative: 'HELOC draw',
        },
      ],
    });
    expect(ledgerAgain.skippedCount).toBe(1);

    const audit = await activities.createAuditPackageMetadata({
      ...cycleCtx,
      packageType: 'MonthlyConversionCycle',
      metadata: { outcome: 'test' },
    });
    expect(audit.auditDocumentId).toBeTruthy();

    // Advance to RECONCILING for completeCycle (skip financial reconcile)
    for (const [from, to] of [
      ['WAITING_FOR_HELOC', 'HELOC_DRAW_PENDING'],
      ['HELOC_DRAW_PENDING', 'HELOC_DRAW_CONFIRMED'],
      ['HELOC_DRAW_CONFIRMED', 'BROKERAGE_TRANSFER_PENDING'],
      ['BROKERAGE_TRANSFER_PENDING', 'BROKERAGE_FUNDED'],
      ['BROKERAGE_FUNDED', 'ORDER_PENDING'],
      ['ORDER_PENDING', 'ORDER_FILLED'],
      ['ORDER_FILLED', 'RECONCILING'],
    ] as const) {
      await activities.transitionCycleState({
        ...cycleCtx,
        fromState: from,
        toState: to,
      });
    }

    const completed = await activities.completeCycle(cycleCtx);
    expect(completed.state).toBe('COMPLETED');
  });

  it('skipCycle marks WAITING_FOR_HELOC as SKIPPED', async () => {
    const reserved = await activities.reserveMonthlyCycle({
      ...ctx(),
      paymentPeriod: '2026-07',
    });
    await activities.transitionCycleState({
      ...ctx(),
      cycleId: reserved.cycleId,
      fromState: 'WAITING_FOR_MORTGAGE',
      toState: 'WAITING_FOR_HELOC',
    });
    const skipped = await activities.skipCycle({
      ...ctx(),
      cycleId: reserved.cycleId,
      reasonCode: 'AMOUNT_BELOW_MINIMUM',
      reason: 'below min',
    });
    expect(skipped.state).toBe('SKIPPED');
  });

  it('pauseStrategyWithException pauses strategy', async () => {
    const reserved = await activities.reserveMonthlyCycle({
      ...ctx(),
      paymentPeriod: '2026-08',
    });
    const paused = await activities.pauseStrategyWithException({
      ...ctx(),
      cycleId: reserved.cycleId,
      code: 'PAYMENT_REVERSED',
      message: 'Mortgage payment reversed',
      cycleTerminalState: 'FAILED',
    });
    expect(paused.state).toBe('PAUSED');
    const strategy = await graph.repos.strategies.findById(graph.tenant.id, graph.strategy.id);
    expect(strategy?.state).toBe('PAUSED');
  });

  it('reconcileCycle passes when money trail matches', async () => {
    const reserved = await activities.reserveMonthlyCycle({
      ...ctx(),
      paymentPeriod: '2026-09',
    });
    const cycleId = reserved.cycleId;
    const cycleCtx = { ...ctx(), cycleId, paymentPeriod: '2026-09' };
    const amount = 100_000n;
    const tenantId = graph.tenant.id;

    const mortgage = await graph.repos.accounts.findMortgageDetail(tenantId, graph.mortgage.id);
    const heloc = await graph.repos.accounts.findHelocDetail(tenantId, graph.heloc.id);
    const payment = await graph.repos.mortgagePayments.upsertFromProvider(tenantId, {
      mortgageId: mortgage!.id,
      providerPaymentId: `pay_${randomUUID()}`,
      paymentPeriod: '2026-09',
      totalAmountCents: amount + 1000n,
      principalAmountCents: amount,
      interestAmountCents: 1000n,
      state: 'SETTLED',
      settledAt: new Date(),
    });

    let cycle = await graph.repos.cycles.findById(tenantId, cycleId);
    cycle = await graph.repos.cycles.patchFields(tenantId, cycleId, cycle!.version, {
      mortgagePaymentId: payment.id,
      principalRepaidCents: amount,
      newlyAvailableCreditCents: amount,
      drawAmountCents: amount,
    });

    await prisma.helocCreditEvent.create({
      data: {
        tenantId,
        helocId: heloc!.id,
        providerEventId: `cred_${randomUUID()}`,
        availableCreditCents: amount,
        creditDeltaCents: amount,
        relatedPaymentPeriod: '2026-09',
        observedAt: new Date(),
      },
    });

    await graph.repos.moneyMovements.create(tenantId, {
      cycleId,
      type: 'HELOC_DRAW',
      amountCents: amount,
      sourceAccountId: graph.heloc.id,
      destinationAccountId: graph.bank.id,
      idempotencyKey: randomUUID(),
      correlationId: cycleCtx.correlationId,
      state: 'SETTLED',
    });
    await graph.repos.moneyMovements.create(tenantId, {
      cycleId,
      type: 'HELOC_TO_BROKERAGE_TRANSFER',
      amountCents: amount,
      sourceAccountId: graph.bank.id,
      destinationAccountId: graph.brokerage.id,
      idempotencyKey: randomUUID(),
      correlationId: cycleCtx.correlationId,
      state: 'SETTLED',
    });
    await graph.repos.moneyMovements.create(tenantId, {
      cycleId,
      type: 'BROKERAGE_DEPOSIT',
      amountCents: amount,
      destinationAccountId: graph.brokerage.id,
      idempotencyKey: randomUUID(),
      correlationId: cycleCtx.correlationId,
      state: 'SETTLED',
    });
    const facility = await graph.repos.accounts.findBrokerageDetail(tenantId, graph.brokerage.id);
    const order = await graph.repos.investmentOrders.create(tenantId, {
      cycleId,
      brokerageAccountId: facility!.id,
      idempotencyKey: randomUUID(),
      symbol: 'VCN.TO',
      notionalCents: amount,
      correlationId: cycleCtx.correlationId,
      state: 'CREATED',
    });
    await graph.repos.investmentOrders.updateState(
      tenantId,
      order.id,
      order.version,
      'CREATED',
      'SUBMITTED',
      { providerOrderId: `ord_${randomUUID()}` },
    );
    const submitted = await graph.repos.investmentOrders.findById(tenantId, order.id);
    await graph.repos.investmentOrders.updateState(
      tenantId,
      submitted!.id,
      submitted!.version,
      'SUBMITTED',
      'FILLED',
    );

    await activities.appendLedgerEntries({
      ...cycleCtx,
      entries: [
        {
          accountId: graph.heloc.id,
          businessEventId: `rec-d-${cycleId}`,
          direction: 'DEBIT',
          amountCents: amount.toString(),
          narrative: 'draw',
        },
        {
          accountId: graph.brokerage.id,
          businessEventId: `rec-c-${cycleId}`,
          direction: 'CREDIT',
          amountCents: amount.toString(),
          narrative: 'deposit',
        },
      ],
    });

    const result = await activities.reconcileCycle(cycleCtx);
    expect(result.state).toBe('PASSED');
  });
});
