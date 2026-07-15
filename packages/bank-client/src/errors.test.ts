import { describe, expect, it } from 'vitest';

import { classifyHttpStatus, isAbortError, ProviderClientError } from './errors.js';

describe('error classification', () => {
  it('maps HTTP statuses to provider error kinds', () => {
    expect(classifyHttpStatus(401)).toBe('AUTHENTICATION_FAILURE');
    expect(classifyHttpStatus(403)).toBe('AUTHENTICATION_FAILURE');
    expect(classifyHttpStatus(429)).toBe('RATE_LIMITED');
    expect(classifyHttpStatus(409)).toBe('DUPLICATE_CONFLICT');
    expect(classifyHttpStatus(400)).toBe('VALIDATION_FAILURE');
    expect(classifyHttpStatus(422)).toBe('BUSINESS_REJECTION');
    expect(classifyHttpStatus(503)).toBe('PROVIDER_UNAVAILABLE');
    expect(classifyHttpStatus(504)).toBe('PROVIDER_UNAVAILABLE');
    expect(classifyHttpStatus(500)).toBe('RETRYABLE_TRANSPORT');
  });

  it('marks transport/rate-limit as retryable, ambiguous as not', () => {
    expect(new ProviderClientError({ kind: 'RETRYABLE_TRANSPORT', message: 'x' }).retryable).toBe(
      true,
    );
    expect(new ProviderClientError({ kind: 'RATE_LIMITED', message: 'x' }).retryable).toBe(true);
    expect(new ProviderClientError({ kind: 'AMBIGUOUS_RESULT', message: 'x' }).retryable).toBe(
      false,
    );
    expect(new ProviderClientError({ kind: 'BUSINESS_REJECTION', message: 'x' }).retryable).toBe(
      false,
    );
  });

  it('detects abort/timeout errors', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isAbortError(abort)).toBe(true);
    const timeout = new Error('Timeout');
    timeout.name = 'TimeoutError';
    expect(isAbortError(timeout)).toBe(true);
    expect(isAbortError(new Error('CONNECT_TIMEOUT'))).toBe(true);
  });
});
