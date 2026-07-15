import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Span,
  type SpanOptions,
} from '@opentelemetry/api';

import { CORRELATION_ID_HEADER, createCorrelationId, isValidCorrelationId } from './correlation.js';
import { getTracer } from './telemetry.js';

export const TEMPORAL_MEMO_CORRELATION_KEY = 'correlationId';

/** Build Temporal Workflow/Schedule memo that carries the HTTP correlation ID. */
export function correlationMemo(correlationId: string): Record<string, string> {
  return { [TEMPORAL_MEMO_CORRELATION_KEY]: correlationId };
}

export function resolveCorrelationId(candidates: Array<string | undefined | null>): string {
  for (const candidate of candidates) {
    if (isValidCorrelationId(candidate)) {
      return candidate.trim();
    }
  }
  return createCorrelationId();
}

export function extractCorrelationFromMemo(memo: unknown): string | undefined {
  if (!memo || typeof memo !== 'object') return undefined;
  const value = (memo as Record<string, unknown>)[TEMPORAL_MEMO_CORRELATION_KEY];
  if (typeof value !== 'string' || !isValidCorrelationId(value)) {
    return undefined;
  }
  return value.trim();
}

/** Inject W3C + correlation header into outbound HTTP headers. */
export function injectTraceHeaders(
  headers: Record<string, string>,
  correlationId: string,
): Record<string, string> {
  const carrier: Record<string, string> = {
    ...headers,
    [CORRELATION_ID_HEADER]: correlationId,
  };
  propagation.inject(context.active(), carrier);
  return carrier;
}

export async function withSpan<T>(
  name: string,
  options: SpanOptions & { correlationId?: string } = {},
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  const { correlationId, ...spanOptions } = options;
  return tracer.startActiveSpan(name, spanOptions, async (span) => {
    if (correlationId) {
      span.setAttribute('csm.correlation_id', correlationId);
    }
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'error',
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function currentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
}
