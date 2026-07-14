import { z } from 'zod';

import { correlationIdSchema } from './primitives.js';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'RECONCILIATION_REQUIRED',
  'RECONCILIATION_FAILED',
  'SAFETY_PAUSE',
  'INSUFFICIENT_FUNDS',
  'EXTERNAL_TIMEOUT',
  'EXTERNAL_FAILURE',
  'DEPENDENCY_UNAVAILABLE',
  'INVALID_STATUS_TRANSITION',
  'UNSUPPORTED_ACCOUNT_CAPABILITY',
  'MALFORMED_WEBHOOK',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  cause?: unknown;
  details?: Record<string, unknown>;
  retryable?: boolean;
  correlationId?: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;
  readonly correlationId: string | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = options.code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    this.correlationId = options.correlationId;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Stable HTTP API error envelope — public contract, not Prisma. */
export const apiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1),
        correlationId: correlationIdSchema,
        details: z.record(z.unknown()).optional(),
        retryable: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

export function toApiErrorEnvelope(error: AppError, correlationId: string): ApiErrorEnvelope {
  return apiErrorEnvelopeSchema.parse({
    error: {
      code: error.code,
      message: error.message,
      correlationId: error.correlationId ?? correlationId,
      ...(error.details !== undefined ? { details: error.details } : {}),
      retryable: error.retryable,
    },
  });
}
