import type { z } from 'zod';
import { ZodError } from 'zod';

import { csmMetrics, injectTraceHeaders, withSpan, type Logger } from '@csm/observability';

import {
  classifyHttpStatus,
  isAbortError,
  ProviderClientError,
  type ProviderErrorKind,
} from './errors.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export interface HttpClientOptions {
  baseUrl: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  connectionTimeoutMs?: number;
  responseTimeoutMs?: number;
  /** Max attempts for safe GET retries (including the first try). Default 3. */
  maxGetAttempts?: number;
  getRetryBaseDelayMs?: number;
  /** Metric attribute provider=bank|brokerage */
  providerLabel?: string;
}

export interface RequestContext {
  correlationId: string;
  /** When set, sent as Idempotency-Key header (financial POSTs). */
  idempotencyKey?: string;
  operation: string;
  /** Financial mutating POST — never auto-retried; timeout → AMBIGUOUS_RESULT. */
  financialMutation?: boolean;
  /** Allow bounded retry (GET / safe). */
  safeToRetry?: boolean;
}

export class ProviderHttpClient {
  readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly connectionTimeoutMs: number;
  private readonly responseTimeoutMs: number;
  private readonly maxGetAttempts: number;
  private readonly getRetryBaseDelayMs: number;
  private readonly providerLabel: string;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 5_000;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 30_000;
    this.maxGetAttempts = options.maxGetAttempts ?? 3;
    this.getRetryBaseDelayMs = options.getRetryBaseDelayMs ?? 50;
    this.providerLabel = options.providerLabel ?? 'provider';
  }

  async requestJson<S extends z.ZodTypeAny>(
    method: string,
    path: string,
    schema: S,
    ctx: RequestContext,
    body?: unknown,
  ): Promise<{ status: number; data: z.infer<S> }> {
    return withSpan(
      `provider.${this.providerLabel}.${ctx.operation}`,
      { correlationId: ctx.correlationId },
      async () => {
        const safeToRetry = ctx.safeToRetry === true && ctx.financialMutation !== true;
        const attempts = safeToRetry ? this.maxGetAttempts : 1;
        let lastError: unknown;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          try {
            const result = await this.singleRequest(method, path, schema, ctx, body);
            csmMetrics.providerRequests.add(1, {
              provider: this.providerLabel,
              operation: ctx.operation,
              outcome: 'ok',
            });
            return result;
          } catch (error) {
            lastError = error;
            const kind = error instanceof ProviderClientError ? error.kind : 'UNKNOWN';
            if (kind === 'AMBIGUOUS_RESULT') {
              csmMetrics.ambiguousProviderOutcomes.add(1, {
                provider: this.providerLabel,
                operation: ctx.operation,
              });
            }
            csmMetrics.providerRequests.add(1, {
              provider: this.providerLabel,
              operation: ctx.operation,
              outcome: 'error',
              kind,
            });
            const retryable =
              error instanceof ProviderClientError &&
              error.retryable &&
              safeToRetry &&
              attempt < attempts;
            this.logger.warn(
              {
                operation: ctx.operation,
                correlationId: ctx.correlationId,
                attempt,
                kind,
                statusCode: error instanceof ProviderClientError ? error.statusCode : undefined,
              },
              'provider request failed',
            );
            if (!retryable) {
              throw error;
            }
            await sleep(this.getRetryBaseDelayMs * 2 ** (attempt - 1));
          }
        }
        throw lastError;
      },
    );
  }

  private async singleRequest<S extends z.ZodTypeAny>(
    method: string,
    path: string,
    schema: S,
    ctx: RequestContext,
    body?: unknown,
  ): Promise<{ status: number; data: z.infer<S> }> {
    const url = `${this.baseUrl}${path}`;
    const headers = injectTraceHeaders(
      {
        accept: 'application/json',
        ...(ctx.idempotencyKey !== undefined
          ? { [IDEMPOTENCY_KEY_HEADER]: ctx.idempotencyKey }
          : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ctx.correlationId,
    );

    this.logger.info(
      {
        operation: ctx.operation,
        correlationId: ctx.correlationId,
        method,
        path,
        financialMutation: ctx.financialMutation === true,
        hasBody: body !== undefined,
        idempotencyKey: ctx.idempotencyKey,
      },
      'provider request',
    );

    const init: RequestInit = {
      method,
      headers,
      signal: createTimeoutSignal(this.connectionTimeoutMs, this.responseTimeoutMs),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body, bigintReplacer);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw this.mapTransportError(error, ctx);
    }

    const text = await response.text();
    let json: unknown = undefined;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        throw new ProviderClientError({
          kind: 'VALIDATION_FAILURE',
          message: `Provider returned non-JSON for ${ctx.operation}`,
          correlationId: ctx.correlationId,
          statusCode: response.status,
          operation: ctx.operation,
        });
      }
    }

    if (!response.ok) {
      throw this.mapHttpError(response.status, json, ctx);
    }

    try {
      const data = schema.parse(json) as z.infer<S>;
      return { status: response.status, data };
    } catch (error) {
      throw new ProviderClientError({
        kind: 'VALIDATION_FAILURE',
        message: `Provider response failed schema validation for ${ctx.operation}`,
        correlationId: ctx.correlationId,
        statusCode: response.status,
        operation: ctx.operation,
        cause: error,
        ...(error instanceof ZodError ? { details: { issues: error.flatten() } } : {}),
      });
    }
  }

  private mapTransportError(error: unknown, ctx: RequestContext): ProviderClientError {
    // Any failure after a financial POST may have been accepted by the provider.
    // Never Temporal-retry as a re-POST — resolve by idempotency key.
    if (ctx.financialMutation) {
      return new ProviderClientError({
        kind: 'AMBIGUOUS_RESULT',
        message: `Uncertain outcome during financial operation ${ctx.operation}; do not retry POST — resolve by idempotency key`,
        correlationId: ctx.correlationId,
        ...(ctx.idempotencyKey !== undefined ? { idempotencyKey: ctx.idempotencyKey } : {}),
        operation: ctx.operation,
        cause: error,
      });
    }
    if (isAbortError(error)) {
      return new ProviderClientError({
        kind: 'RETRYABLE_TRANSPORT',
        message: `Transport timeout for ${ctx.operation}`,
        correlationId: ctx.correlationId,
        operation: ctx.operation,
        cause: error,
      });
    }
    return new ProviderClientError({
      kind: 'RETRYABLE_TRANSPORT',
      message: `Transport failure for ${ctx.operation}`,
      correlationId: ctx.correlationId,
      operation: ctx.operation,
      cause: error,
    });
  }

  private mapHttpError(status: number, json: unknown, ctx: RequestContext): ProviderClientError {
    const body = asRecord(json);

    // Uncertain gateway / provider availability after a mutation must not re-POST.
    if (
      ctx.financialMutation &&
      (status === 502 || status === 503 || status === 504 || status >= 500)
    ) {
      return new ProviderClientError({
        kind: 'AMBIGUOUS_RESULT',
        message: `Uncertain HTTP ${status} during financial operation ${ctx.operation}; do not retry POST — resolve by idempotency key`,
        correlationId: ctx.correlationId,
        statusCode: status,
        ...(ctx.idempotencyKey !== undefined ? { idempotencyKey: ctx.idempotencyKey } : {}),
        operation: ctx.operation,
        ...(body !== undefined ? { details: body } : {}),
      });
    }

    let kind: ProviderErrorKind = classifyHttpStatus(status);
    if (status === 422 && body?.['error'] === 'VALIDATION_ERROR') {
      kind = 'VALIDATION_FAILURE';
    }
    if (status === 409) {
      kind = 'DUPLICATE_CONFLICT';
    }

    const message =
      (typeof body?.['error'] === 'string' && body['error']) ||
      (typeof body?.['message'] === 'string' && body['message']) ||
      `Provider HTTP ${status} for ${ctx.operation}`;

    return new ProviderClientError({
      kind,
      message,
      correlationId: ctx.correlationId,
      statusCode: status,
      operation: ctx.operation,
      ...(body !== undefined ? { details: body } : {}),
      ...(ctx.idempotencyKey !== undefined && kind === 'AMBIGUOUS_RESULT'
        ? { idempotencyKey: ctx.idempotencyKey }
        : {}),
    });
  }
}

function createTimeoutSignal(connectionTimeoutMs: number, responseTimeoutMs: number): AbortSignal {
  const connection = AbortSignal.timeout(connectionTimeoutMs);
  const response = AbortSignal.timeout(responseTimeoutMs);
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([connection, response]);
  }
  return response;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
