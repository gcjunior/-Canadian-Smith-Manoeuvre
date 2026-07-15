import type { FastifyPluginAsync } from 'fastify';

import { requireAuth } from '../auth/guards.js';
import type { ConnectionAppService } from '../services/connection-app-service.js';

export const connectionRoutes: FastifyPluginAsync<{ connections: ConnectionAppService }> = async (
  app,
  deps,
) => {
  app.post('/financial-connections/simulated-bank', async (request, reply) => {
    const auth = requireAuth(request);
    const result = await deps.connections.createSimulatedBank(auth, request.correlationId);
    return reply.code(201).send(result);
  });

  app.post('/financial-connections/simulated-brokerage', async (request, reply) => {
    const auth = requireAuth(request);
    const result = await deps.connections.createSimulatedBrokerage(auth, request.correlationId);
    return reply.code(201).send(result);
  });

  app.get('/financial-connections', async (request) => {
    const auth = requireAuth(request);
    return deps.connections.listConnections(auth, request.correlationId);
  });

  app.get('/financial-accounts', async (request) => {
    const auth = requireAuth(request);
    return deps.connections.listAccounts(auth, request.correlationId);
  });
};
