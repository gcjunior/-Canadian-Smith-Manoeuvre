import type { FastifyPluginAsync } from 'fastify';

import {
  strategyActivationRequestSchema,
  strategyCloseRequestSchema,
  strategyPatchRequestSchema,
  strategyPauseRequestSchema,
  strategyResumeRequestSchema,
  strategySetupRequestSchema,
} from '@csm/contracts';

import { requireAuth } from '../auth/guards.js';
import type { OperationsAppService } from '../services/operations-app-service.js';
import type { StrategyAppService } from '../services/strategy-app-service.js';

export interface StrategyRouteDeps {
  strategies: StrategyAppService;
  operations: OperationsAppService;
}

export const strategyRoutes: FastifyPluginAsync<StrategyRouteDeps> = async (app, deps) => {
  app.post('/strategies', async (request, reply) => {
    const auth = requireAuth(request);
    const body = strategySetupRequestSchema.parse(request.body);
    const created = await deps.strategies.create(auth, body, request.correlationId);
    return reply.code(201).send(created);
  });

  app.get('/strategies', async (request) => {
    const auth = requireAuth(request);
    return deps.strategies.list(auth, request.correlationId);
  });

  app.get<{ Params: { strategyId: string } }>('/strategies/:strategyId', async (request) => {
    const auth = requireAuth(request);
    return deps.strategies.get(auth, request.params.strategyId, request.correlationId);
  });

  app.patch<{ Params: { strategyId: string } }>('/strategies/:strategyId', async (request) => {
    const auth = requireAuth(request);
    const body = strategyPatchRequestSchema.parse(request.body);
    return deps.strategies.patch(auth, request.params.strategyId, body, request.correlationId);
  });

  app.post<{ Params: { strategyId: string } }>(
    '/strategies/:strategyId/activate',
    async (request) => {
      const auth = requireAuth(request);
      const body = strategyActivationRequestSchema.parse(request.body);
      return deps.strategies.activate(
        auth,
        request.params.strategyId,
        body.acknowledgeRiskDisclosures,
        request.correlationId,
      );
    },
  );

  app.post<{ Params: { strategyId: string } }>('/strategies/:strategyId/pause', async (request) => {
    const auth = requireAuth(request);
    const body = strategyPauseRequestSchema.parse(request.body);
    return deps.strategies.pause(
      auth,
      request.params.strategyId,
      body.reason,
      request.correlationId,
    );
  });

  app.post<{ Params: { strategyId: string } }>(
    '/strategies/:strategyId/resume',
    async (request) => {
      const auth = requireAuth(request);
      const body = strategyResumeRequestSchema.parse(request.body);
      return deps.strategies.resume(
        auth,
        request.params.strategyId,
        body.clearanceNote,
        request.correlationId,
      );
    },
  );

  app.post<{ Params: { strategyId: string } }>('/strategies/:strategyId/close', async (request) => {
    const auth = requireAuth(request);
    const body = strategyCloseRequestSchema.parse(request.body);
    return deps.strategies.close(
      auth,
      request.params.strategyId,
      body.reason,
      request.correlationId,
    );
  });

  app.get<{ Params: { strategyId: string } }>('/strategies/:strategyId/cycles', async (request) => {
    const auth = requireAuth(request);
    return deps.strategies.listCycles(auth, request.params.strategyId, request.correlationId);
  });

  app.get<{ Params: { strategyId: string; cycleId: string } }>(
    '/strategies/:strategyId/cycles/:cycleId',
    async (request) => {
      const auth = requireAuth(request);
      return deps.strategies.getCycle(
        auth,
        request.params.strategyId,
        request.params.cycleId,
        request.correlationId,
      );
    },
  );

  app.get<{ Params: { strategyId: string } }>('/strategies/:strategyId/ledger', async (request) => {
    const auth = requireAuth(request);
    return deps.strategies.listLedger(auth, request.params.strategyId, request.correlationId);
  });

  app.get<{ Params: { strategyId: string } }>(
    '/strategies/:strategyId/interest-payments',
    async (request) => {
      const auth = requireAuth(request);
      return deps.operations.listInterestPayments(
        auth,
        request.params.strategyId,
        request.correlationId,
      );
    },
  );

  app.get<{ Params: { strategyId: string } }>(
    '/strategies/:strategyId/dashboard',
    async (request) => {
      const auth = requireAuth(request);
      return deps.strategies.getDashboard(auth, request.params.strategyId, request.correlationId);
    },
  );

  app.get('/documents', async (request) => {
    const auth = requireAuth(request);
    return deps.operations.listDocuments(auth, request.correlationId);
  });
};
