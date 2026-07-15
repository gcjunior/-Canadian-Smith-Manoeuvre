import type { FastifyPluginAsync } from 'fastify';

import { strategyResumeRequestSchema } from '@csm/contracts';

import { requireAuth } from '../auth/guards.js';
import type { OperationsAppService } from '../services/operations-app-service.js';

export const operationsRoutes: FastifyPluginAsync<{ operations: OperationsAppService }> = async (
  app,
  deps,
) => {
  app.get('/operations/exceptions', async (request) => {
    const auth = requireAuth(request);
    return deps.operations.listExceptions(auth, request.correlationId);
  });

  app.get('/operations/cycles', async (request) => {
    const auth = requireAuth(request);
    return deps.operations.listCycles(auth, request.correlationId);
  });

  app.get<{ Params: { cycleId: string } }>('/operations/cycles/:cycleId', async (request) => {
    const auth = requireAuth(request);
    return deps.operations.getCycle(auth, request.params.cycleId, request.correlationId);
  });

  app.get('/operations/webhooks', async (request) => {
    const auth = requireAuth(request);
    return deps.operations.listWebhooks(auth, request.correlationId);
  });

  app.post<{ Params: { webhookId: string } }>(
    '/operations/webhooks/:webhookId/retry',
    async (request) => {
      const auth = requireAuth(request);
      return deps.operations.retryWebhook(auth, request.params.webhookId, request.correlationId);
    },
  );

  app.get('/operations/reconciliation', async (request) => {
    const auth = requireAuth(request);
    return deps.operations.listReconciliations(auth, request.correlationId);
  });

  app.get('/operations/workflows', async (request) => {
    const auth = requireAuth(request);
    return deps.operations.listWorkflows(auth, request.correlationId);
  });

  app.get('/operations/documents', async (request) => {
    const auth = requireAuth(request);
    return deps.operations.listDocuments(auth, request.correlationId);
  });

  app.post<{ Params: { strategyId: string } }>(
    '/operations/strategies/:strategyId/resume',
    async (request) => {
      const auth = requireAuth(request);
      const body = strategyResumeRequestSchema.parse(request.body);
      return deps.operations.resumeStrategy(
        auth,
        request.params.strategyId,
        body.clearanceNote,
        request.correlationId,
      );
    },
  );
};
