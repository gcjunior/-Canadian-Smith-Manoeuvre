import type { FastifyPluginAsync } from 'fastify';

import { AppError, devTokenRequestSchema } from '@csm/contracts';

import type { JwtService } from '../auth/jwt.js';
import type { OperationsAppService } from '../services/operations-app-service.js';

export const authRoutes: FastifyPluginAsync<{
  jwt: JwtService;
  nodeEnv: string;
  operations: OperationsAppService;
}> = async (app, deps) => {
  app.get('/auth/dev-scenarios', async (request, reply) => {
    if (deps.nodeEnv === 'production') {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'Dev scenarios endpoint is disabled in production',
        correlationId: request.correlationId,
      });
    }
    return reply.send(await deps.operations.listDevScenarios(request.correlationId));
  });

  app.post('/auth/dev-token', async (request, reply) => {
    if (deps.nodeEnv === 'production') {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'Dev token endpoint is disabled in production',
        correlationId: request.correlationId,
      });
    }
    const body = devTokenRequestSchema.parse(request.body);
    // Identity for subsequent requests comes only from the signed JWT, never body tenancy fields alone.
    const token = await deps.jwt.sign(body);
    return reply.code(201).send({
      accessToken: token.accessToken,
      tokenType: 'Bearer' as const,
      expiresIn: token.expiresIn,
    });
  });
};
