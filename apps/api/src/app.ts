import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Client } from '@temporalio/client';

import type { BankClient } from '@csm/bank-client';
import type { BrokerageClient } from '@csm/brokerage-client';
import type { ApiEnv } from '@csm/contracts';
import { checkDatabaseHealth, type PrismaClient } from '@csm/database';
import { CORRELATION_ID_HEADER, type Logger } from '@csm/observability';

import correlationPlugin from './plugins/correlation.js';
import loggerContextPlugin from './plugins/logger-context.js';

export interface AppDeps {
  env: ApiEnv;
  logger: Logger;
  prisma: PrismaClient;
  temporal: Client;
  bankClient: BankClient;
  brokerageClient: BrokerageClient;
}

export async function buildApiApp(deps: AppDeps) {
  const app = Fastify({
    logger: false,
    genReqId: (req) =>
      (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? `${Date.now()}`,
  });

  await app.register(correlationPlugin);
  await app.register(loggerContextPlugin, { logger: deps.logger });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Canadian Smith Manoeuvre API',
        description:
          'Multi-tenant Smith Manoeuvre automation simulator. Uses leverage (HELOC debt) to invest; interest, losses, and risk are real concerns in non-simulated deployments. This API executes simulated money movement only.',
        version: deps.env.SERVICE_VERSION,
      },
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
              checks: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
    async (request) => {
      const checks: Record<string, { status: string; detail?: string }> = {};
      try {
        await checkDatabaseHealth(deps.prisma);
        checks.database = { status: 'ok' };
      } catch (error) {
        checks.database = {
          status: 'error',
          detail: error instanceof Error ? error.message : 'unknown',
        };
      }

      const status = Object.values(checks).some((c) => c.status !== 'ok') ? 'degraded' : 'ok';
      return {
        status,
        service: deps.env.SERVICE_NAME,
        version: deps.env.SERVICE_VERSION,
        correlationId: request.correlationId,
        checks,
      };
    },
  );

  app.get('/ready', async (request, reply) => {
    try {
      await checkDatabaseHealth(deps.prisma);
      await deps.temporal.workflowService.getSystemInfo({});
      return {
        status: 'ok',
        service: deps.env.SERVICE_NAME,
        correlationId: request.correlationId,
      };
    } catch (error) {
      return reply.code(503).send({
        status: 'error',
        service: deps.env.SERVICE_NAME,
        correlationId: request.correlationId,
        detail: error instanceof Error ? error.message : 'not ready',
      });
    }
  });

  return app;
}
