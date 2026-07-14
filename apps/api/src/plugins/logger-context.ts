import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from '@csm/observability';

declare module 'fastify' {
  interface FastifyInstance {
    appLogger: Logger;
  }
}

const loggerContextPlugin: FastifyPluginAsync<{ logger: Logger }> = async (app, opts) => {
  app.decorate('appLogger', opts.logger);
  app.addHook('onRequest', async (request) => {
    request.log = opts.logger.child({
      correlationId: request.correlationId,
      reqId: request.id,
    }) as typeof request.log;
  });
};

export default fp(loggerContextPlugin, { name: 'logger-context' });
