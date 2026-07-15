import { fileURLToPath } from 'node:url';

import { NativeConnection, Worker } from '@temporalio/worker';

import { BankClient } from '@csm/bank-client';
import { BrokerageClient } from '@csm/brokerage-client';
import { parseWorkerEnv } from '@csm/contracts';
import {
  checkDatabaseHealth,
  createPrismaClient,
  createRepositories,
  disconnectPrisma,
} from '@csm/database';
import {
  createBuildInfo,
  createLogger,
  csmMetrics,
  initTelemetry,
  registerGracefulShutdown,
  shutdownTelemetry,
  waitForDependencies,
} from '@csm/observability';
import { createActivities } from '@csm/temporal-activities';
import { WORKFLOW_BUNDLE_VERSION } from '@csm/temporal-workflows';

import { startHealthServer } from './health-server.js';

async function main(): Promise<void> {
  const env = parseWorkerEnv({
    ...process.env,
    SERVICE_NAME: process.env.SERVICE_NAME ?? 'worker',
  });

  await initTelemetry({
    serviceName: env.SERVICE_NAME,
    serviceVersion: env.SERVICE_VERSION,
    ...(env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined
      ? { otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT }
      : {}),
    enabled: env.OTEL_ENABLED ?? true,
  });

  const build = createBuildInfo({
    service: env.SERVICE_NAME,
    version: env.SERVICE_VERSION,
    temporalNamespace: env.TEMPORAL_NAMESPACE,
    temporalTaskQueue: env.TEMPORAL_TASK_QUEUE,
    temporalAddress: env.TEMPORAL_ADDRESS,
  });

  const logger = createLogger({
    service: env.SERVICE_NAME,
    level: env.LOG_LEVEL,
    version: env.SERVICE_VERSION,
    pretty: false,
  });

  const prisma = createPrismaClient(env.DATABASE_URL);
  const bankClient = new BankClient({ baseUrl: env.BANK_SIMULATOR_BASE_URL, logger });
  const brokerageClient = new BrokerageClient({
    baseUrl: env.BROKERAGE_SIMULATOR_BASE_URL,
    logger,
  });

  const healthPort = Number(process.env.HEALTH_PORT ?? '3100');
  const healthServer = startHealthServer(healthPort, {
    build,
    workflowBundleVersion: WORKFLOW_BUNDLE_VERSION,
    checkReady: async () => {
      await checkDatabaseHealth(prisma);
    },
  });

  await waitForDependencies(
    logger,
    [{ name: 'postgres', check: async () => checkDatabaseHealth(prisma) }],
    env.STARTUP_DEPENDENCY_TIMEOUT_MS,
  );

  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

  const activities = createActivities({
    logger,
    prisma,
    repos: createRepositories(prisma),
    bankClient,
    brokerageClient,
    platformMonthlyDrawCapCents: env.PLATFORM_MONTHLY_DRAW_CAP_CENTS,
  });

  // ESM-only package exports: use import.meta.resolve (not require.resolve).
  const workflowsPath = fileURLToPath(import.meta.resolve('@csm/temporal-workflows'));

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath,
    activities,
    identity: build.identity,
  });

  // Approximate active strategies gauge on worker startup (ops can scrape APItoo).
  try {
    const count = await prisma.strategy.count({ where: { state: 'ACTIVE' } });
    csmMetrics.activeStrategies.set(count);
  } catch (error) {
    logger.warn({ err: error }, 'failed to seed activeStrategies gauge');
  }

  registerGracefulShutdown(logger, [
    async () => {
      worker.shutdown();
    },
    async () => {
      await new Promise<void>((resolve, reject) => {
        healthServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
    async () => {
      await connection.close();
    },
    async () => {
      await disconnectPrisma();
    },
    async () => {
      await shutdownTelemetry();
    },
  ]);

  logger.info(
    {
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      healthPort,
      identity: build.identity,
      version: build.version,
      workflowBundleVersion: WORKFLOW_BUNDLE_VERSION,
    },
    'temporal worker starting',
  );
  await worker.run();
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ level: 'error', message: 'worker failed to start', err: String(error) }),
  );
  process.exit(1);
});
