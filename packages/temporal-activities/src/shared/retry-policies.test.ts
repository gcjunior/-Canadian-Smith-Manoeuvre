import { describe, expect, it } from 'vitest';

import { ACTIVITY_RETRY_POLICIES } from './retry-policies.js';
import { nonRetryable } from './errors.js';
import { ApplicationFailure } from '@temporalio/activity';

describe('activity retry policies', () => {
  it('marks ambiguous financial results non-retryable', () => {
    expect(ACTIVITY_RETRY_POLICIES.financialMutation.retry.nonRetryableErrorTypes).toContain(
      'AMBIGUOUS_RESULT',
    );
    expect(ACTIVITY_RETRY_POLICIES.financialMutation.retry.nonRetryableErrorTypes).toContain(
      'BUSINESS_REJECTION',
    );
  });

  it('polling policy includes PAYMENT_REVERSED', () => {
    expect(ACTIVITY_RETRY_POLICIES.polling.retry.nonRetryableErrorTypes).toContain(
      'PAYMENT_REVERSED',
    );
  });
});

describe('error redaction', () => {
  it('nonRetryable throws ApplicationFailure', () => {
    expect(() =>
      nonRetryable('secret account 1234', 'BUSINESS_REJECTION', {
        accountNumber: '123456789',
        ok: true,
      }),
    ).toThrow(ApplicationFailure);
  });
});
