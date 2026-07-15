import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import type { SimulatorEnv } from '@csm/contracts';
import {
  CORRELATION_ID_HEADER,
  createBuildInfo,
  csmMetrics,
  healthPayload,
  normalizeCorrelationId,
  snapshotMetrics,
  type Logger,
} from '@csm/observability';

import { SimulatorClock } from './clock.js';
import { BankSimulatorEngine, SimulatorHttpError } from './engine.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerBankRoutes } from './routes/bank.js';
import { BankSimulatorStore } from './store.js';

export interface BuildSimulatorAppOptions {
  env: SimulatorEnv;
  logger: Logger;
  /** Inject a fixed clock for deterministic tests. */
  clock?: SimulatorClock;
  store?: BankSimulatorStore;
}

export async function buildSimulatorApp(options: BuildSimulatorAppOptions) {
  const { env, logger } = options;
  const clock = options.clock ?? new SimulatorClock();
  const store = options.store ?? new BankSimulatorStore();
  const engine = new BankSimulatorEngine({
    clock,
    store,
    logger,
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET,
    ...(env.WEBHOOK_TARGET_URL !== undefined ? { webhookTargetUrl: env.WEBHOOK_TARGET_URL } : {}),
    webhooksEnabledDefault: env.WEBHOOKS_ENABLED,
  });

  const app = Fastify({
    logger: false,
    genReqId: (req) =>
      (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? `${Date.now()}`,
  });

  await app.register(
    fp(async (instance) => {
      instance.decorateRequest('correlationId', '');
      instance.addHook('onRequest', async (request, reply) => {
        const correlationId = normalizeCorrelationId(
          request.headers[CORRELATION_ID_HEADER] as string | undefined,
        );
        (request as unknown as { correlationId: string }).correlationId = correlationId;
        void reply.header(CORRELATION_ID_HEADER, correlationId);
      });
    }),
  );

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CSM Bank Simulator',
        description:
          'External provider-style bank / mortgage / HELOC simulator. Owns its own in-memory data model; does not write application business tables.',
        version: env.SERVICE_VERSION,
      },
      tags: [
        { name: 'health', description: 'Liveness / readiness' },
        { name: 'sim-admin', description: 'Scenario setup and clock control' },
        { name: 'bank', description: 'Bank provider API surface' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const build = createBuildInfo({
    service: env.SERVICE_NAME,
    version: env.SERVICE_VERSION,
  });
  app.addHook('onResponse', async (request, reply) => {
    csmMetrics.providerRequests.add(1, {
      provider: 'bank-sim',
      method: request.method,
      route: request.routeOptions.url ?? request.url,
      status: String(reply.statusCode),
    });
  });

  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
    },
    async (request) => {
      const correlationId =
        (request as { correlationId?: string }).correlationId ?? normalizeCorrelationId(undefined);
      return healthPayload(build, 'ok', {
        correlationId,
        simulator: 'bank-mortgage-heloc',
      });
    },
  );

  app.get('/ready', async () => healthPayload(build, 'ok', { ready: true }));
  app.get('/metrics', async () => snapshotMetrics());

  await registerAdminRoutes(app, engine);
  await registerBankRoutes(app, engine);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SimulatorHttpError) {
      return reply.code(error.statusCode).send({
        error: error.message,
        ...(error.body ?? {}),
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: error.flatten() });
    }
    logger.error({ err: error }, 'unhandled bank-simulator error');
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'unknown',
    });
  });

  return Object.assign(app, { engine, clock, store });
}

export type BankSimulatorApp = Awaited<ReturnType<typeof buildSimulatorApp>>;
