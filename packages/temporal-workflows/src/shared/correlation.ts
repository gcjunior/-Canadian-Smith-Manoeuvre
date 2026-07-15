/**
 * Workflow-sandbox-safe correlation helpers (no Node / @csm/observability imports).
 */

const CORRELATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function correlationIdFromMemo(memo: unknown): string | undefined {
  if (!memo || typeof memo !== 'object') return undefined;
  const value = (memo as Record<string, unknown>).correlationId;
  if (typeof value === 'string' && CORRELATION_ID_PATTERN.test(value.trim())) {
    return value.trim();
  }
  return undefined;
}

export function resolveWorkflowCorrelationId(input: {
  correlationId?: string;
  memo?: unknown;
  fallback?: string;
}): string {
  if (input.correlationId && CORRELATION_ID_PATTERN.test(input.correlationId.trim())) {
    return input.correlationId.trim();
  }
  const fromMemo = correlationIdFromMemo(input.memo);
  if (fromMemo) return fromMemo;
  if (input.fallback && CORRELATION_ID_PATTERN.test(input.fallback.trim())) {
    return input.fallback.trim();
  }
  // Temporal uuid4() preferred by callers — last resort keeps a stable string for logs.
  return input.fallback ?? input.correlationId ?? '00000000-0000-4000-8000-000000000000';
}
