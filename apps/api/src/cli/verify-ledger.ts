#!/usr/bin/env node
/**
 * Verify append-only ledger integrity and conversion reconciliation coverage.
 *
 * Usage:
 *   pnpm --filter @csm/api verify:ledger -- --tenant <tenantId>
 *   pnpm --filter @csm/api verify:ledger -- --all-tenants
 */
import { createPrismaClient, createRepositories } from '@csm/database';
import { parseApiEnv } from '@csm/contracts';

interface TenantReport {
  tenantId: string;
  ledgerBalanced: boolean;
  debitCents: string;
  creditCents: string;
  completedCyclesWithoutPassedRecon: string[];
  duplicateProviderTxAcrossCycles: Array<{
    providerTransactionId: string;
    cycleIds: string[];
  }>;
  ok: boolean;
}

async function verifyTenant(
  prisma: ReturnType<typeof createPrismaClient>,
  tenantId: string,
): Promise<TenantReport> {
  const repos = createRepositories(prisma);
  const { debitCents, creditCents } = await repos.ledger.sumDebitsAndCredits(tenantId);
  const ledgerBalanced = debitCents === creditCents;

  const completedCycles = await prisma.monthlyConversionCycle.findMany({
    where: { tenantId, state: 'COMPLETED' },
    select: { id: true },
  });
  const completedCyclesWithoutPassedRecon: string[] = [];
  for (const cycle of completedCycles) {
    const recon = await repos.reconciliations.findByCycle(tenantId, cycle.id);
    if (recon?.state !== 'PASSED') {
      completedCyclesWithoutPassedRecon.push(cycle.id);
    }
  }

  const movements = await prisma.moneyMovement.findMany({
    where: {
      tenantId,
      providerTransactionId: { not: null },
      cycleId: { not: null },
    },
    select: { providerTransactionId: true, cycleId: true },
  });
  const byProvider = new Map<string, Set<string>>();
  for (const m of movements) {
    if (!m.providerTransactionId || !m.cycleId) continue;
    const set = byProvider.get(m.providerTransactionId) ?? new Set<string>();
    set.add(m.cycleId);
    byProvider.set(m.providerTransactionId, set);
  }
  const duplicateProviderTxAcrossCycles = [...byProvider.entries()]
    .filter(([, cycles]) => cycles.size > 1)
    .map(([providerTransactionId, cycles]) => ({
      providerTransactionId,
      cycleIds: [...cycles],
    }));

  const ok =
    ledgerBalanced &&
    completedCyclesWithoutPassedRecon.length === 0 &&
    duplicateProviderTxAcrossCycles.length === 0;

  return {
    tenantId,
    ledgerBalanced,
    debitCents: debitCents.toString(),
    creditCents: creditCents.toString(),
    completedCyclesWithoutPassedRecon,
    duplicateProviderTxAcrossCycles,
    ok,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tenantIdx = args.indexOf('--tenant');
  const all = args.includes('--all-tenants');
  const tenantId = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined;

  if (!all && !tenantId) {
    console.error('Usage: verify:ledger -- --tenant <uuid> | --all-tenants');
    process.exit(2);
  }

  const env = parseApiEnv(process.env);
  const prisma = createPrismaClient(env.DATABASE_URL);

  try {
    const tenants = all
      ? (await prisma.tenant.findMany({ select: { id: true } })).map((t) => t.id)
      : [tenantId!];

    const reports: TenantReport[] = [];
    for (const id of tenants) {
      reports.push(await verifyTenant(prisma, id));
    }

    const ok = reports.every((r) => r.ok);
    console.log(JSON.stringify({ ok, tenants: reports }, null, 2));
    process.exit(ok ? 0 : 1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
