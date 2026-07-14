import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

import { CORRELATION_ID_HEADER, normalizeCorrelationId } from '@csm/observability';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

const correlationPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    const correlationId = normalizeCorrelationId(
      request.headers[CORRELATION_ID_HEADER] as string | undefined,
    );
    request.correlationId = correlationId;
    void reply.header(CORRELATION_ID_HEADER, correlationId);
  });
};

export default fp(correlationPlugin, { name: 'correlation' });
