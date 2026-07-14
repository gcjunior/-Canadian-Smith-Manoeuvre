import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import type { SimulatorEnv } from '@csm/contracts';
import { CORRELATION_ID_HEADER, normalizeCorrelationId, type Logger } from '@csm/observability';

import { SimulatorClock } from './clock.js';
import { BrokerageSimulatorEngine, SimulatorHttpError } from './engine.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerBrokerageRoutes } from './routes/brokerage.js';
import { BrokerageSimulatorStore } from './store.js';

export interface BuildSimulatorAppOptions {
  env: SimulatorEnv;
  logger: Logger;
  clock?: SimulatorClock;
  store?: BrokerageSimulatorStore;
}

export async function buildSimulatorApp(options: BuildSimulatorAppOptions) {
  const { env, logger } = options;
  const clock = options.clock ?? new SimulatorClock();
  const store = options.store ?? new BrokerageSimulatorStore();
  const engine = new BrokerageSimulatorEngine({
    clock,
    store,
    logger,
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET,
    ...(env.WEBHOOK_TARGET_URL !== undefined
      ? { webhookTargetUrl: env.WEBHOOK_TARGET_URL }
      : {}),
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
        title: 'CSM Brokerage Simulator',
        description:
          'External provider-style brokerage simulator (CAD non-registered). Owns its own in-memory data model; Temporal must not connect directly.',
        version: env.SERVICE_VERSION,
      },
      tags: [
        { name: 'health', description: 'Liveness / readiness' },
        { name: 'sim-admin', description: 'Scenario setup and clock control' },
        { name: 'brokerage', description: 'Brokerage provider API surface' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              version: { type: 'string' },
              correlationId: { type: 'string' },
              simulator: { type: 'string' },
            },
          },
        },
      },
    },
    async (request) => {
      const correlationId =
        (request as { correlationId?: string }).correlationId ??
        normalizeCorrelationId(undefined);
      return {
        status: 'ok',
        service: env.SERVICE_NAME,
        version: env.SERVICE_VERSION,
        correlationId,
        simulator: 'brokerage',
      };
    },
  );

  app.get('/ready', async () => ({
    status: 'ok',
    service: env.SERVICE_NAME,
  }));

  await registerAdminRoutes(app, engine);
  await registerBrokerageRoutes(app, engine);

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
    logger.error({ err: error }, 'unhandled brokerage-simulator error');
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'unknown',
    });
  });

  return Object.assign(app, { engine, clock, store });
}

export type BrokerageSimulatorApp = Awaited<ReturnType<typeof buildSimulatorApp>>;
