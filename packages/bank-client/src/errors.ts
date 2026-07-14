export type ProviderErrorKind =
  | 'RETRYABLE_TRANSPORT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'VALIDATION_FAILURE'
  | 'BUSINESS_REJECTION'
  | 'DUPLICATE_CONFLICT'
  | 'AMBIGUOUS_RESULT'
  | 'AUTHENTICATION_FAILURE';

export interface ProviderClientErrorOptions {
  kind: ProviderErrorKind;
  message: string;
  correlationId?: string;
  statusCode?: number;
  cause?: unknown;
  details?: Record<string, unknown>;
  /** Present when a financial POST timed out — caller must resolve by idempotency key. */
  idempotencyKey?: string;
  operation?: string;
}

export class ProviderClientError extends Error {
  readonly kind: ProviderErrorKind;
  readonly correlationId: string | undefined;
  readonly statusCode: number | undefined;
  readonly details: Record<string, unknown> | undefined;
  readonly idempotencyKey: string | undefined;
  readonly operation: string | undefined;
  readonly retryable: boolean;

  constructor(options: ProviderClientErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ProviderClientError';
    this.kind = options.kind;
    this.correlationId = options.correlationId;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.idempotencyKey = options.idempotencyKey;
    this.operation = options.operation;
    this.retryable =
      options.kind === 'RETRYABLE_TRANSPORT' ||
      options.kind === 'RATE_LIMITED' ||
      options.kind === 'PROVIDER_UNAVAILABLE';
  }
}

export function isProviderClientError(value: unknown): value is ProviderClientError {
  return value instanceof ProviderClientError;
}

export function classifyHttpStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) {
    return 'AUTHENTICATION_FAILURE';
  }
  if (status === 429) {
    return 'RATE_LIMITED';
  }
  if (status === 409) {
    return 'DUPLICATE_CONFLICT';
  }
  if (status === 400 || status === 422) {
    // 400 often validation; 422 business — callers may refine via body
    return status === 400 ? 'VALIDATION_FAILURE' : 'BUSINESS_REJECTION';
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'PROVIDER_UNAVAILABLE';
  }
  if (status >= 500) {
    return 'RETRYABLE_TRANSPORT';
  }
  return 'BUSINESS_REJECTION';
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    error.message.includes('CONNECT_TIMEOUT') ||
    error.message.includes('RESPONSE_TIMEOUT') ||
    error.message.includes('aborted')
  );
}
