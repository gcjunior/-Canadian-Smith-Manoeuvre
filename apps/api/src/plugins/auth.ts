import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { AppError } from '@csm/contracts';

import type { JwtService } from '../auth/jwt.js';

const authPlugin: FastifyPluginAsync<{ jwt: JwtService }> = async (app, opts) => {
  app.decorateRequest('auth', undefined);

  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? '';
    if (
      path === '/health' ||
      path === '/ready' ||
      path === '/metrics' ||
      path.startsWith('/docs') ||
      path === '/auth/dev-token' ||
      path === '/auth/dev-scenarios' ||
      path.startsWith('/webhooks/')
    ) {
      return;
    }

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        message: 'Bearer token required',
        correlationId: request.correlationId,
        retryable: false,
      });
    }
    const token = header.slice('Bearer '.length).trim();
    request.auth = await opts.jwt.verify(token, request.correlationId);
  });
};

export default fp(authPlugin, { name: 'auth' });
