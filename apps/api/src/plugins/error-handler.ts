import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import { AppError, isAppError, toApiErrorEnvelope, type ErrorCode } from '@csm/contracts';
import { type DomainError, isDomainError } from '@csm/domain';
import { ContractTransitionError } from '@csm/contracts';

function httpStatusForCode(code: ErrorCode): number {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
    case 'UNSUPPORTED_ACCOUNT_CAPABILITY':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
    case 'INVALID_STATUS_TRANSITION':
      return 409;
    case 'MALFORMED_WEBHOOK':
      return 400;
    default:
      return 500;
  }
}

function mapDomainToApp(error: DomainError, correlationId: string): AppError {
  const codeMap: Record<string, ErrorCode> = {
    NOT_FOUND: 'NOT_FOUND',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    OWNERSHIP_VIOLATION: 'FORBIDDEN',
    TENANT_SCOPE_VIOLATION: 'FORBIDDEN',
    UNSUPPORTED_ACCOUNT_CAPABILITY: 'UNSUPPORTED_ACCOUNT_CAPABILITY',
    INVALID_ACCOUNT_KIND: 'VALIDATION_ERROR',
    OPTIMISTIC_CONCURRENCY_CONFLICT: 'CONFLICT',
    DUPLICATE_ENTITY: 'CONFLICT',
    INVALID_STRATEGY_STATE: 'INVALID_STATUS_TRANSITION',
  };
  return new AppError({
    code: codeMap[error.code] ?? 'INTERNAL_ERROR',
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    correlationId,
    retryable: false,
  });
}

const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error, request, reply) => {
    const correlationId = request.correlationId;

    if (error instanceof ZodError) {
      const appError = new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.flatten(),
        correlationId,
        retryable: false,
      });
      return reply.code(400).send(toApiErrorEnvelope(appError, correlationId));
    }

    if (error instanceof ContractTransitionError) {
      const appError = new AppError({
        code: 'INVALID_STATUS_TRANSITION',
        message: error.message,
        details: { entity: error.entity, from: error.from, to: error.to },
        correlationId,
        retryable: false,
      });
      return reply.code(409).send(toApiErrorEnvelope(appError, correlationId));
    }

    if (isDomainError(error)) {
      const appError = mapDomainToApp(error, correlationId);
      return reply
        .code(httpStatusForCode(appError.code))
        .send(toApiErrorEnvelope(appError, correlationId));
    }

    if (isAppError(error)) {
      return reply
        .code(httpStatusForCode(error.code))
        .send(toApiErrorEnvelope(error, correlationId));
    }

    request.log?.error?.(error);
    const appError = new AppError({
      code: 'INTERNAL_ERROR',
      message: 'Unexpected server error',
      correlationId,
      retryable: false,
    });
    return reply.code(500).send(toApiErrorEnvelope(appError, correlationId));
  });
};

export default fp(errorHandlerPlugin, { name: 'error-handler' });
