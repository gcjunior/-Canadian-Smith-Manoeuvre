export type DomainErrorCode =
  | 'INVALID_MONEY'
  | 'INVALID_QUANTITY'
  | 'INVALID_TIMEZONE'
  | 'INVALID_PAYMENT_PERIOD'
  | 'INVALID_STRATEGY_STATE'
  | 'INVALID_ACCOUNT_KIND'
  | 'TENANT_SCOPE_VIOLATION'
  | 'OWNERSHIP_VIOLATION'
  | 'VALIDATION_ERROR'
  | 'UNSUPPORTED_ACCOUNT_CAPABILITY'
  | 'OPTIMISTIC_CONCURRENCY_CONFLICT'
  | 'DUPLICATE_ENTITY'
  | 'NOT_FOUND';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
