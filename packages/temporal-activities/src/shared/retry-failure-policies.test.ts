import { describe, expect, it } from 'vitest';

import { ACTIVITY_RETRY_POLICIES } from './retry-policies.js';

describe('activity retry policies under failure', () => {
  it('does not retry AMBIGUOUS_RESULT financial mutations', () => {
    expect(ACTIVITY_RETRY_POLICIES.financialMutation.retry?.nonRetryableErrorTypes).toContain(
      'AMBIGUOUS_RESULT',
    );
  });

  it('allows polling activities many attempts with a hard deadline envelope', () => {
    expect(ACTIVITY_RETRY_POLICIES.polling.retry?.maximumAttempts).toBeGreaterThan(5);
    expect(ACTIVITY_RETRY_POLICIES.polling.startToCloseTimeout).toBeTruthy();
  });
});

it('limits financialMutation attempts (GET-before-POST recovery only)', () => {
  expect(ACTIVITY_RETRY_POLICIES.financialMutation.retry?.maximumAttempts).toBe(2);
});
