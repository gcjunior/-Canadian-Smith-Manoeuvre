import { randomUUID } from 'node:crypto';

import { ApplicationFailure } from '@temporalio/activity';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaForTests,
  createTestActivities,
  provisionActiveStrategy,
  wipeFinancialTables,
} from '../test/harness.js';

async function seedPassingConversionTrail(opts: {
  prisma: ReturnType<typeof createPrismaForTests>;
  graph: Awaited<ReturnType<typeof provisionActiveStrategy>>;
  activities: ReturnType<typeof createTestActivities>['activities'];
  cycleId: string;
  correlationId: string;
  amountCents?: bigint;
  providerDrawId?: string;
  /** Same providerTransactionId on another cycle (different movement type to satisfy DB unique). */
  duplicateProviderOnOtherCycle?: boolean;
}) {
  const amount = opts.amountCents ?? 77_000n;
  const { graph, cycleId, correlationId, prisma } = opts;
  const tenantId = graph.tenant.id;

  const mortgage = await graph.repos.accounts.findMortgageDetail(tenantId, graph.mortgage.id);
  const heloc = await graph.repos.accounts.findHelocDetail(tenantId, graph.heloc.id);

  let cycle = await graph.repos.cycles.findById(tenantId, cycleId);
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

  const drawProvider = opts.providerDrawId ?? `draw_${randomUUID()}`;
  const draw = await graph.repos.moneyMovements.create(tenantId, {
    cycleId,
    type: 'HELOC_DRAW',
    amountCents: amount,
    sourceAccountId: graph.heloc.id,
    destinationAccountId: graph.bank.id,
    idempotencyKey: randomUUID(),
    correlationId,
    state: 'SETTLED',
  });
  await prisma.moneyMovement.update({
    where: { id: draw.id },
    data: { providerTransactionId: drawProvider },
  });

  const transfer = await graph.repos.moneyMovements.create(tenantId, {
    cycleId,
    type: 'HELOC_TO_BROKERAGE_TRANSFER',
    amountCents: amount,
    sourceAccountId: graph.bank.id,
    destinationAccountId: graph.brokerage.id,
    idempotencyKey: randomUUID(),
    correlationId,
    state: 'SETTLED',
  });
  await prisma.moneyMovement.update({
    where: { id: transfer.id },
    data: { providerTransactionId: `xfer_${randomUUID()}` },
  });

  const deposit = await graph.repos.moneyMovements.create(tenantId, {
    cycleId,
    type: 'BROKERAGE_DEPOSIT',
    amountCents: amount,
    destinationAccountId: graph.brokerage.id,
    idempotencyKey: randomUUID(),
    correlationId,
    state: 'SETTLED',
  });
  await prisma.moneyMovement.update({
    where: { id: deposit.id },
    data: { providerTransactionId: `dep_${randomUUID()}` },
  });

  if (opts.duplicateProviderOnOtherCycle) {
    const other = await graph.repos.cycles.create(tenantId, {
      strategyId: graph.strategy.id,
      paymentPeriod: '2026-10',
      correlationId: randomUUID(),
      state: 'SCHEDULED',
    });
    // Different type so tenant/type/providerTransactionId uniqueness allows the row.
    const otherMm = await graph.repos.moneyMovements.create(tenantId, {
      cycleId: other.id,
      type: 'HELOC_TO_BROKERAGE_TRANSFER',
      amountCents: 1n,
      sourceAccountId: graph.bank.id,
      destinationAccountId: graph.brokerage.id,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      state: 'SETTLED',
    });
    await prisma.moneyMovement.update({
      where: { id: otherMm.id },
      data: { providerTransactionId: drawProvider },
    });
  }

  const facility = await graph.repos.accounts.findBrokerageDetail(tenantId, graph.brokerage.id);
  const order = await graph.repos.investmentOrders.create(tenantId, {
    cycleId,
    brokerageAccountId: facility!.id,
    idempotencyKey: randomUUID(),
    symbol: 'VCN.TO',
    notionalCents: amount,
    correlationId,
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

  await opts.activities.appendLedgerEntries({
    tenantId,
    strategyId: graph.strategy.id,
    cycleId,
    correlationId,
    paymentPeriod: '2026-09',
    entries: [
      {
        accountId: graph.heloc.id,
        businessEventId: `conversion:${cycleId}:heloc-draw:debit`,
        direction: 'DEBIT',
        amountCents: amount.toString(),
        narrative: 'draw',
        cycleId,
      },
      {
        accountId: graph.bank.id,
        businessEventId: `conversion:${cycleId}:heloc-draw:credit`,
        direction: 'CREDIT',
        amountCents: amount.toString(),
        narrative: 'proceeds',
        cycleId,
      },
      {
        accountId: graph.bank.id,
        businessEventId: `conversion:${cycleId}:brokerage-transfer:debit`,
        direction: 'DEBIT',
        amountCents: amount.toString(),
        narrative: 'transfer out',
        cycleId,
      },
      {
        accountId: graph.brokerage.id,
        businessEventId: `conversion:${cycleId}:brokerage-transfer:credit`,
        direction: 'CREDIT',
        amountCents: amount.toString(),
        narrative: 'deposit',
        cycleId,
      },
      {
        accountId: graph.brokerage.id,
        businessEventId: `conversion:${cycleId}:investment:debit`,
        direction: 'DEBIT',
        amountCents: amount.toString(),
        narrative: 'invest',
        cycleId,
      },
      {
        accountId: graph.brokerage.id,
        businessEventId: `conversion:${cycleId}:investment:credit`,
        direction: 'CREDIT',
        amountCents: amount.toString(),
        narrative: 'position',
        cycleId,
      },
    ],
  });

  return { amount, cycle };
}

describe('conversion reconciliation activity', () => {
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
    graph = await provisionActiveStrategy(prisma, `rec-${randomUUID().slice(0, 8)}`);
    activities = createTestActivities({ prisma, repos: graph.repos }).activities;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('passes all conversion checks', async () => {
    const reserved = await activities.reserveMonthlyCycle({
      tenantId: graph.tenant.id,
      strategyId: graph.strategy.id,
      correlationId: randomUUID(),
      paymentPeriod: '2026-09',
    });
    const correlationId = randomUUID();
    await seedPassingConversionTrail({
      prisma,
      graph,
      activities,
      cycleId: reserved.cycleId,
      correlationId,
    });

    const result = await activities.reconcileCycle({
      tenantId: graph.tenant.id,
      strategyId: graph.strategy.id,
      cycleId: reserved.cycleId,
      correlationId,
      paymentPeriod: '2026-09',
    });
    expect(result.state).toBe('PASSED');
    expect(result.items).toHaveLength(12);
    expect(result.items.every((i) => i.result === 'PASS')).toBe(true);
  });

  it('fails on amount mismatch', async () => {
    const reserved = await activities.reserveMonthlyCycle({
      tenantId: graph.tenant.id,
      strategyId: graph.strategy.id,
      correlationId: randomUUID(),
      paymentPeriod: '2026-09',
    });
    const correlationId = randomUUID();
    await seedPassingConversionTrail({
      prisma,
      graph,
      activities,
      cycleId: reserved.cycleId,
      correlationId,
      amountCents: 77_000n,
    });
    const transfer = await graph.repos.moneyMovements.findByCycleAndType(
      graph.tenant.id,
      reserved.cycleId,
      'HELOC_TO_BROKERAGE_TRANSFER',
    );
    await prisma.moneyMovement.update({
      where: { id: transfer!.id },
      data: { amountCents: 76_000n },
    });

    await expect(
      activities.reconcileCycle({
        tenantId: graph.tenant.id,
        strategyId: graph.strategy.id,
        cycleId: reserved.cycleId,
        correlationId,
        paymentPeriod: '2026-09',
      }),
    ).rejects.toMatchObject({
      type: 'RECONCILIATION_FAILED',
    } satisfies Partial<ApplicationFailure>);
  });

  it('fails when provider tx is linked to another cycle', async () => {
    const reserved = await activities.reserveMonthlyCycle({
      tenantId: graph.tenant.id,
      strategyId: graph.strategy.id,
      correlationId: randomUUID(),
      paymentPeriod: '2026-09',
    });
    const correlationId = randomUUID();
    await seedPassingConversionTrail({
      prisma,
      graph,
      activities,
      cycleId: reserved.cycleId,
      correlationId,
      providerDrawId: `draw_dup_${randomUUID()}`,
      duplicateProviderOnOtherCycle: true,
    });

    await expect(
      activities.reconcileCycle({
        tenantId: graph.tenant.id,
        strategyId: graph.strategy.id,
        cycleId: reserved.cycleId,
        correlationId,
        paymentPeriod: '2026-09',
      }),
    ).rejects.toMatchObject({
      type: 'RECONCILIATION_FAILED',
    } satisfies Partial<ApplicationFailure>);
  });
});
