#!/usr/bin/env node
/**
 * Materialize a daily reconciliation report for a tenant.
 *
 * Usage:
 *   pnpm --filter @csm/api report:daily-recon -- --tenant <tenantId> [--date YYYY-MM-DD]
 */
import { createPrismaClient, createRepositories } from '@csm/database';
import { parseApiEnv } from '@csm/contracts';

function parseUtcDate(raw: string | undefined): Date {
  if (!raw) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    throw new Error(`Invalid --date (expected YYYY-MM-DD): ${raw}`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  return new Date(Date.UTC(y, m, d));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tenantIdx = args.indexOf('--tenant');
  const dateIdx = args.indexOf('--date');
  const tenantId = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined;
  const dateRaw = dateIdx >= 0 ? args[dateIdx + 1] : undefined;

  if (!tenantId) {
    console.error('Usage: report:daily-recon -- --tenant <uuid> [--date YYYY-MM-DD]');
    process.exit(2);
  }

  const reportDate = parseUtcDate(dateRaw);
  const nextDay = new Date(reportDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const env = parseApiEnv(process.env);
  const prisma = createPrismaClient(env.DATABASE_URL);
  const repos = createRepositories(prisma);

  try {
    const conversions = await prisma.reconciliation.findMany({
      where: {
        tenantId,
        kind: 'MONTHLY_CONVERSION',
        createdAt: { gte: reportDate, lt: nextDay },
        state: { in: ['PASSED', 'FAILED'] },
      },
      select: { state: true },
    });
    const interests = await prisma.reconciliation.findMany({
      where: {
        tenantId,
        kind: 'HELOC_INTEREST',
        createdAt: { gte: reportDate, lt: nextDay },
        state: { in: ['PASSED', 'FAILED'] },
      },
      select: { state: true },
    });

    const conversionPassedCount = conversions.filter((r) => r.state === 'PASSED').length;
    const conversionFailedCount = conversions.filter((r) => r.state === 'FAILED').length;
    const interestPassedCount = interests.filter((r) => r.state === 'PASSED').length;
    const interestFailedCount = interests.filter((r) => r.state === 'FAILED').length;

    const { debitCents, creditCents } = await repos.ledger.sumDebitsAndCredits(tenantId, {
      from: reportDate,
      to: nextDay,
    });
    const ledgerBalanced = debitCents === creditCents;

    const summaryJson = {
      reportDate: reportDate.toISOString().slice(0, 10),
      conversionPassedCount,
      conversionFailedCount,
      interestPassedCount,
      interestFailedCount,
      ledgerDebitCents: debitCents.toString(),
      ledgerCreditCents: creditCents.toString(),
      ledgerBalanced,
    } satisfies Record<string, unknown>;

    const report = await repos.dailyReconciliationReports.upsertByDate(tenantId, {
      reportDate,
      conversionPassedCount,
      conversionFailedCount,
      interestPassedCount,
      interestFailedCount,
      ledgerDebitCents: debitCents,
      ledgerCreditCents: creditCents,
      ledgerBalanced,
      summaryJson: summaryJson,
    });

    console.log(
      JSON.stringify(
        {
          id: report.id,
          tenantId,
          ...summaryJson,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
