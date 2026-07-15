import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AppRole, TenantContext } from '@csm/contracts';
import { AppError } from '@csm/contracts';
import { ALERT_CODES, emitAlert, createLogger } from '@csm/observability';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: TenantContext;
    rawBody?: Buffer;
  }
}

const alertLogger = createLogger({ service: 'api-authz', level: 'warn', pretty: false });

export function requireAuth(request: FastifyRequest): TenantContext {
  if (!request.auth) {
    throw new AppError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      correlationId: request.correlationId,
      retryable: false,
    });
  }
  return request.auth;
}

export function requireRoles(
  auth: TenantContext,
  allowed: AppRole[],
  correlationId?: string,
): void {
  const ok = auth.roles.some((role) => allowed.includes(role) || role === 'ADMIN');
  if (!ok) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Insufficient role for this operation',
      details: { required: allowed, actual: auth.roles },
      ...(correlationId !== undefined ? { correlationId } : {}),
      retryable: false,
    });
  }
}

export function assertCustomerOwnsUser(
  auth: TenantContext,
  resourceUserId: string,
  correlationId?: string,
): void {
  if (auth.roles.includes('ADMIN') || auth.roles.includes('OPERATIONS')) {
    return;
  }
  if (auth.userId !== resourceUserId) {
    emitAlert(alertLogger, ALERT_CODES.CROSS_TENANT_AUTHORIZATION, {
      ...(correlationId !== undefined ? { correlationId } : {}),
      authUserId: auth.userId,
      resourceUserId,
      tenantId: auth.tenantId,
      kind: 'user_ownership',
    });
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Resource does not belong to authenticated user',
      ...(correlationId !== undefined ? { correlationId } : {}),
      retryable: false,
    });
  }
}

export function sendEmpty(_request: FastifyRequest, reply: FastifyReply): void {
  void reply;
}
