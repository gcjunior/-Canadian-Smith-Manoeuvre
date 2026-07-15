import { toCustomerCycleStatus } from '@csm/contracts';
import type { PrismaClient } from '@csm/database';
import { assertLedgerBalanced, summarizeLedgerBalance } from '@csm/domain';

import { DEMO } from './constants.js';
import type { SeedResult } from './seed.js';

export async function countByType(
  prisma: PrismaClient,
  tenantId: string,
  type: string,
): Promise<number> {
  return prisma.moneyMovement.count({ where: { tenantId, type: type as never } });
}

export async function assertNoInvestmentYet(
  prisma: PrismaClient,
  seed: SeedResult,
  phase: string,
): Promise<void> {
  const [draws, transfers, deposits, orders] = await Promise.all([
    countByType(prisma, seed.tenantId, 'HELOC_DRAW'),
    countByType(prisma, seed.tenantId, 'HELOC_TO_BROKERAGE_TRANSFER'),
    countByType(prisma, seed.tenantId, 'BROKERAGE_DEPOSIT'),
    prisma.investmentOrder.count({ where: { tenantId: seed.tenantId } }),
  ]);
  if (draws + transfers + deposits + orders > 0) {
    throw new Error(
      `${phase}: investment side effects already present (draws=${draws}, transfers=${transfers}, deposits=${deposits}, orders=${orders})`,
    );
  }
}

export async function assertConversionInvariants(
  prisma: PrismaClient,
  seed: SeedResult,
): Promise<{
  cycleId: string;
  customerStatus: string;
  drawAmountCents: bigint;
  remainingCashCents: bigint | null;
}> {
  const cycle = await prisma.monthlyConversionCycle.findFirst({
    where: {
      tenantId: seed.tenantId,
      strategyId: seed.strategyId,
      paymentPeriod: DEMO.paymentPeriod,
    },
  });
  if (!cycle) {
    throw new Error('Monthly conversion cycle not found');
  }
  if (cycle.state !== 'COMPLETED') {
    throw new Error(`Expected cycle COMPLETED, got ${cycle.state}`);
  }

  const customerStatus = toCustomerCycleStatus(cycle.state);
  if (customerStatus !== 'Completed') {
    throw new Error(`Expected customer status Completed, got ${customerStatus}`);
  }

  const draws = await prisma.moneyMovement.findMany({
    where: { tenantId: seed.tenantId, type: 'HELOC_DRAW' },
  });
  const transfers = await prisma.moneyMovement.findMany({
    where: { tenantId: seed.tenantId, type: 'HELOC_TO_BROKERAGE_TRANSFER' },
  });
  const deposits = await prisma.moneyMovement.findMany({
    where: { tenantId: seed.tenantId, type: 'BROKERAGE_DEPOSIT' },
  });
  const orders = await prisma.investmentOrder.findMany({
    where: { tenantId: seed.tenantId },
  });

  if (draws.length !== 1) {
    throw new Error(`Expected exactly one HELOC draw, got ${draws.length}`);
  }
  if (transfers.length !== 1) {
    throw new Error(`Expected exactly one brokerage transfer, got ${transfers.length}`);
  }
  if (deposits.length !== 1) {
    throw new Error(`Expected exactly one brokerage deposit, got ${deposits.length}`);
  }
  if (orders.length !== 1) {
    throw new Error(`Expected exactly one investment order, got ${orders.length}`);
  }

  const draw = draws[0]!;
  if (draw.amountCents !== DEMO.expectedInvestmentCents) {
    throw new Error(`Expected draw ${DEMO.expectedInvestmentCents}, got ${draw.amountCents}`);
  }
  if (draw.state !== 'SETTLED') {
    throw new Error(`Expected draw SETTLED, got ${draw.state}`);
  }
  if (orders[0]!.state !== 'FILLED') {
    throw new Error(`Expected order FILLED, got ${orders[0]!.state}`);
  }

  const ledger = await prisma.ledgerEntry.findMany({
    where: { tenantId: seed.tenantId, cycleId: cycle.id },
  });
  const legs = ledger.map((e) => ({ direction: e.direction, amountCents: e.amountCents }));
  const summary = summarizeLedgerBalance(legs);
  assertLedgerBalanced(legs);
  if (!summary.balanced) {
    throw new Error(
      `Ledger not balanced: debit=${summary.debitCents} credit=${summary.creditCents}`,
    );
  }

  const remainingCashCents =
    deposits[0] && orders[0] ? deposits[0].amountCents - orders[0].notionalCents : null;

  return {
    cycleId: cycle.id,
    customerStatus,
    drawAmountCents: draw.amountCents,
    remainingCashCents,
  };
}

export async function assertInterestFromOrdinary(
  prisma: PrismaClient,
  seed: SeedResult,
): Promise<void> {
  const payment = await prisma.helocInterestPayment.findFirst({
    where: { tenantId: seed.tenantId },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment) {
    throw new Error('HELOC interest payment not found');
  }
  const ordinaryDetail = await prisma.ordinaryBankAccount.findFirst({
    where: { tenantId: seed.tenantId },
  });
  if (!ordinaryDetail) {
    throw new Error('Ordinary bank facility missing');
  }
  if (payment.ordinaryBankAccountId !== ordinaryDetail.id) {
    throw new Error(
      `Interest payment sourced from ${payment.ordinaryBankAccountId}, expected ordinary ${ordinaryDetail.id}`,
    );
  }
  if (payment.state !== 'SETTLED') {
    throw new Error(`Expected interest payment SETTLED, got ${payment.state}`);
  }
}
