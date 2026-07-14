import { createRequire } from 'node:module';

import { NativeConnection, Worker } from '@temporalio/worker';

import { BankClient } from '@csm/bank-client';
import { BrokerageClient } from '@csm/brokerage-client';
import { parseWorkerEnv } from '@csm/contracts';
import { checkDatabaseHealth, createPrismaClient, disconnectPrisma } from '@csm/database';
import { createLogger, registerGracefulShutdown, waitForDependencies } from '@csm/observability';
import { createActivities } from '@csm/temporal-activities';

import { startHealthServer } from './health-server.js';

const require = createRequire(import.meta.url);

async function main(): Promise<void> {
  const env = parseWorkerEnv({
    ...process.env,
    SERVICE_NAME: process.env.SERVICE_NAME ?? 'worker',
  });
  const logger = createLogger({
    service: env.SERVICE_NAME,
    level: env.LOG_LEVEL,
    version: env.SERVICE_VERSION,
    pretty: false,
  });

  const healthPort = Number(process.env.HEALTH_PORT ?? '3100');
  const healthServer = startHealthServer(healthPort);

  const prisma = createPrismaClient(env.DATABASE_URL);
  const bankClient = new BankClient({ baseUrl: env.BANK_SIMULATOR_BASE_URL, logger });
  const brokerageClient = new BrokerageClient({
    baseUrl: env.BROKERAGE_SIMULATOR_BASE_URL,
    logger,
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
    bankClient,
    brokerageClient,
  });

  const workflowsPath = require.resolve('@csm/temporal-workflows');

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath,
    activities,
  });

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
  ]);

  logger.info(
    { taskQueue: env.TEMPORAL_TASK_QUEUE, workflowsPath, healthPort },
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
