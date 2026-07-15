import { parseSimulatorEnv } from '@csm/contracts';
import {
  createLogger,
  initTelemetry,
  registerGracefulShutdown,
  shutdownTelemetry,
} from '@csm/observability';

import { buildSimulatorApp } from './app.js';

async function main(): Promise<void> {
  const env = parseSimulatorEnv(process.env, {
    serviceName: 'bank-simulator',
    port: 3002,
  });
  await initTelemetry({
    serviceName: env.SERVICE_NAME,
    serviceVersion: env.SERVICE_VERSION,
    ...(env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined
      ? { otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT }
      : {}),
    enabled: env.OTEL_ENABLED ?? true,
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
    async () => {
      await shutdownTelemetry();
    },
  ]);

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, 'bank-simulator listening');
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'bank-simulator failed to start',
      err: String(error),
    }),
  );
  process.exit(1);
});
