#!/usr/bin/env node
/**
 * Administrative repair: reconcile strategy Temporal Schedules with database refs.
 *
 * Usage:
 *   pnpm --filter @csm/api repair:schedules -- --tenant <tenantId>
 *   pnpm --filter @csm/api repair:schedules -- --all-tenants
 */
import { createPrismaClient, createRepositories } from '@csm/database';
import { parseApiEnv } from '@csm/contracts';
import { createLogger } from '@csm/observability';

import { createTemporalClient } from '../temporal-client.js';
import { TemporalAppService } from '../services/temporal-app-service.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tenantIdx = args.indexOf('--tenant');
  const all = args.includes('--all-tenants');
  const tenantId = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined;

  if (!all && !tenantId) {
    console.error('Usage: repair:schedules -- --tenant <uuid> | --all-tenants');
    process.exit(2);
  }

  const env = parseApiEnv(process.env);
  const logger = createLogger({ service: 'schedule-repair', level: 'info', pretty: true });
  const prisma = createPrismaClient(env.DATABASE_URL);
  const temporal = await createTemporalClient({
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
    logger,
  });
  const repos = createRepositories(prisma);
  const service = new TemporalAppService(
    temporal,
    repos,
    env.TEMPORAL_TASK_QUEUE,
    env.TEMPORAL_NAMESPACE,
    logger,
  );

  try {
    const tenants = all
      ? (await prisma.tenant.findMany({ select: { id: true } })).map((t) => t.id)
      : [tenantId!];

    for (const id of tenants) {
      const correlationId = crypto.randomUUID();
      const results = await service.reconcileStrategySchedules(id, correlationId);
      console.log(JSON.stringify({ tenantId: id, correlationId, results }, null, 2));
    }
  } finally {
    await temporal.connection.close();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
