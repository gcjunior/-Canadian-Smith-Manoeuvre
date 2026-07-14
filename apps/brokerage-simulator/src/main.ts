import { parseSimulatorEnv } from '@csm/contracts';
import { createLogger, registerGracefulShutdown } from '@csm/observability';

import { buildSimulatorApp } from './app.js';

async function main(): Promise<void> {
  const env = parseSimulatorEnv(process.env, {
    serviceName: 'brokerage-simulator',
    port: 3003,
  });
  const logger = createLogger({
    service: env.SERVICE_NAME,
    level: env.LOG_LEVEL,
    version: env.SERVICE_VERSION,
    pretty: false,
  });

  const app = await buildSimulatorApp({ env, logger });

  registerGracefulShutdown(logger, [
    async () => {
      await app.close();
    },
  ]);

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, 'brokerage-simulator listening');
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'brokerage-simulator failed to start',
      err: String(error),
    }),
  );
  process.exit(1);
});
