import { BankClient } from '@csm/bank-client';
import { BrokerageClient } from '@csm/brokerage-client';
import { parseApiEnv } from '@csm/contracts';
import { checkDatabaseHealth, createPrismaClient, disconnectPrisma } from '@csm/database';
import { createLogger, registerGracefulShutdown, waitForDependencies } from '@csm/observability';

import { buildApiApp } from './app.js';
import { checkTemporalClient, createTemporalClient } from './temporal-client.js';

async function main(): Promise<void> {
  const env = parseApiEnv({ ...process.env, SERVICE_NAME: process.env.SERVICE_NAME ?? 'api' });
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

  await waitForDependencies(
    logger,
    [
      {
        name: 'postgres',
        check: async () => checkDatabaseHealth(prisma),
      },
    ],
    env.STARTUP_DEPENDENCY_TIMEOUT_MS,
  );

  const temporal = await createTemporalClient({
    address: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
    logger,
  });

  await waitForDependencies(
    logger,
    [{ name: 'temporal', check: async () => checkTemporalClient(temporal) }],
    env.STARTUP_DEPENDENCY_TIMEOUT_MS,
  );

  const app = await buildApiApp({
    env,
    logger,
    prisma,
    temporal,
    bankClient,
    brokerageClient,
  });

  registerGracefulShutdown(logger, [
    async () => {
      await app.close();
    },
    async () => {
      await temporal.connection.close();
    },
    async () => {
      await disconnectPrisma();
    },
  ]);

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, 'api listening');
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ level: 'error', message: 'api failed to start', err: String(error) }),
  );
  process.exit(1);
});
