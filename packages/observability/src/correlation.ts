import { randomUUID } from 'node:crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

const CORRELATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createCorrelationId(): string {
  return randomUUID();
}

export function isValidCorrelationId(value: string | undefined | null): value is string {
  return Boolean(value && CORRELATION_ID_PATTERN.test(value.trim()));
}

export function normalizeCorrelationId(value: string | undefined | null): string {
  if (isValidCorrelationId(value)) {
    return value.trim();
  }
  return createCorrelationId();
}
