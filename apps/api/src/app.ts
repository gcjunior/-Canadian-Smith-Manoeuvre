import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Client } from '@temporalio/client';

import type { BankClient } from '@csm/bank-client';
import type { BrokerageClient } from '@csm/brokerage-client';
import type { ApiEnv } from '@csm/contracts';
import { checkDatabaseHealth, createRepositories, type PrismaClient } from '@csm/database';
import {
  CORRELATION_ID_HEADER,
  createBuildInfo,
  csmMetrics,
  healthPayload,
  snapshotMetrics,
  type Logger,
} from '@csm/observability';

import { JwtService } from './auth/jwt.js';
import correlationPlugin from './plugins/correlation.js';
import loggerContextPlugin from './plugins/logger-context.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import rawBodyPlugin from './plugins/raw-body.js';
import { authRoutes } from './routes/auth.js';
import { connectionRoutes } from './routes/connections.js';
import { operationsRoutes } from './routes/operations.js';
import { strategyRoutes } from './routes/strategies.js';
import { webhookRoutes } from './routes/webhooks.js';
import { ConnectionAppService } from './services/connection-app-service.js';
import { OperationsAppService } from './services/operations-app-service.js';
import { StrategyAppService } from './services/strategy-app-service.js';
import { TemporalAppService } from './services/temporal-app-service.js';
import { WebhookAppService } from './services/webhook-app-service.js';
import { WebhookProcessor } from './services/webhook-processor.js';

export interface AppDeps {
  env: ApiEnv;
  logger: Logger;
  prisma: PrismaClient;
  temporal: Client;
  bankClient: BankClient;
  brokerageClient: BrokerageClient;
}

export async function buildApiApp(deps: AppDeps) {
  const build = createBuildInfo({
    service: deps.env.SERVICE_NAME,
    version: deps.env.SERVICE_VERSION,
    temporalNamespace: deps.env.TEMPORAL_NAMESPACE,
    temporalTaskQueue: deps.env.TEMPORAL_TASK_QUEUE,
    temporalAddress: deps.env.TEMPORAL_ADDRESS,
  });

  const app = Fastify({
    logger: false,
    bodyLimit: deps.env.BODY_LIMIT_BYTES,
    genReqId: (req) =>
      (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? `${Date.now()}`,
  });

  await app.register(rawBodyPlugin);
  await app.register(correlationPlugin);
  await app.register(loggerContextPlugin, { logger: deps.logger });
  await app.register(errorHandlerPlugin);

  app.addHook('onResponse', async (request, reply) => {
    csmMetrics.apiRequests.add(1, {
      method: request.method,
      route: request.routeOptions.url ?? request.url,
      status: String(reply.statusCode),
    });
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });
  await app.register(rateLimit, {
    max: deps.env.RATE_LIMIT_MAX,
    timeWindow: deps.env.RATE_LIMIT_TIME_WINDOW_MS,
  });

  const jwt = new JwtService({
    secret: deps.env.JWT_SIGNING_SECRET,
    expiresSeconds: deps.env.JWT_EXPIRES_SECONDS,
  });
  await app.register(authPlugin, { jwt });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Canadian Smith Manoeuvre API',
        description:
          'Multi-tenant Smith Manoeuvre automation simulator. Auth context is derived from signed JWTs. Webhooks verify HMAC signatures over the raw body. Financial side-effects run in Temporal via application services — not HTTP handlers.',
        version: deps.env.SERVICE_VERSION,
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const repos = createRepositories(deps.prisma);
  const temporalApp = new TemporalAppService(
    deps.temporal,
    repos,
    deps.env.TEMPORAL_TASK_QUEUE,
    deps.env.TEMPORAL_NAMESPACE,
    deps.logger,
  );
  const strategies = new StrategyAppService(
    repos,
    deps.prisma,
    temporalApp,
    deps.env.PLATFORM_MONTHLY_DRAW_CAP_CENTS,
  );
  const connections = new ConnectionAppService(repos, {
    bankBaseUrl: deps.env.BANK_SIMULATOR_BASE_URL,
    brokerageBaseUrl: deps.env.BROKERAGE_SIMULATOR_BASE_URL,
  });
  const webhookProcessor = new WebhookProcessor(repos, temporalApp, deps.logger);
  const webhooks = new WebhookAppService(repos, deps.env.WEBHOOK_SIGNING_SECRET, deps.logger);
  const operations = new OperationsAppService(
    repos,
    deps.prisma,
    strategies,
    deps.env.TEMPORAL_UI_BASE_URL,
  );

  await app.register(authRoutes, {
    jwt,
    nodeEnv: deps.env.NODE_ENV,
    operations,
  });
  await app.register(strategyRoutes, { strategies, operations });
  await app.register(connectionRoutes, { connections });
  await app.register(webhookRoutes, { webhooks });
  await app.register(operationsRoutes, { operations });

  app.addHook('onReady', () => {
    webhookProcessor.start();
  });
  app.addHook('onClose', async () => {
    webhookProcessor.stop();
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
      return healthPayload(build, status, {
        correlationId: request.correlationId,
        checks,
      });
    },
  );

  app.get('/ready', async (request, reply) => {
    try {
      await checkDatabaseHealth(deps.prisma);
      await deps.temporal.workflowService.getSystemInfo({});
      return healthPayload(build, 'ok', {
        correlationId: request.correlationId,
        ready: true,
      });
    } catch (error) {
      return reply.code(503).send(
        healthPayload(build, 'error', {
          correlationId: request.correlationId,
          ready: false,
          detail: error instanceof Error ? error.message : 'not ready',
        }),
      );
    }
  });

  app.get('/metrics', async () => snapshotMetrics());

  // Bank/brokerage HTTP clients remain available for health/diagnostics; connections use sim admin URLs.
  void deps.bankClient;
  void deps.brokerageClient;

  return app;
}
