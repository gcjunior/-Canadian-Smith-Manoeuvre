import type { ActivityOptions } from '@temporalio/common';

/** Explicit retry policies by Activity category — reference for Workflow authors. */
export const ACTIVITY_RETRY_POLICIES = {
  /** Safe GETs / DB reads. */
  read: {
    startToCloseTimeout: '2 minutes',
    heartbeatTimeout: '30 seconds',
    retry: {
      initialInterval: '1 second',
      backoffCoefficient: 2,
      maximumInterval: '30 seconds',
      maximumAttempts: 8,
      nonRetryableErrorTypes: [
        'BUSINESS_REJECTION',
        'VALIDATION_FAILURE',
        'AUTHENTICATION_FAILURE',
        'FORBIDDEN',
        'NOT_FOUND',
      ],
    },
  } satisfies ActivityOptions,

  /** Cycle / ledger transitions (DB). */
  database: {
    startToCloseTimeout: '1 minute',
    retry: {
      initialInterval: '500 milliseconds',
      backoffCoefficient: 2,
      maximumInterval: '10 seconds',
      maximumAttempts: 5,
      nonRetryableErrorTypes: [
        'BUSINESS_REJECTION',
        'VALIDATION_FAILURE',
        'INVALID_STATUS_TRANSITION',
        'FORBIDDEN',
        'NOT_FOUND',
      ],
    },
  } satisfies ActivityOptions,

  /**
   * Financial POST initiation.
   * Ambiguous results must NOT be retried — resolve via lookup Activities.
   * maximumAttempts > 1 only covers Worker crash recovery; Activities GET-before-POST.
   */
  financialMutation: {
    startToCloseTimeout: '2 minutes',
    retry: {
      initialInterval: '2 seconds',
      backoffCoefficient: 2,
      maximumInterval: '30 seconds',
      maximumAttempts: 2,
      nonRetryableErrorTypes: [
        'BUSINESS_REJECTION',
        'VALIDATION_FAILURE',
        'DUPLICATE_CONFLICT',
        'AUTHENTICATION_FAILURE',
        'AMBIGUOUS_RESULT',
        'FORBIDDEN',
        'NOT_FOUND',
      ],
    },
  } satisfies ActivityOptions,

  /** Polling confirmations / reconciliation. */
  polling: {
    startToCloseTimeout: '10 minutes',
    heartbeatTimeout: '30 seconds',
    retry: {
      initialInterval: '2 seconds',
      backoffCoefficient: 1.5,
      maximumInterval: '1 minute',
      maximumAttempts: 20,
      nonRetryableErrorTypes: [
        'BUSINESS_REJECTION',
        'VALIDATION_FAILURE',
        'AMBIGUOUS_RESULT',
        'FORBIDDEN',
        'NOT_FOUND',
        'PAYMENT_REVERSED',
        'RECONCILIATION_FAILED',
        'PARTIAL_FILL',
      ],
    },
  } satisfies ActivityOptions,
} as const;

export type ActivityRetryCategory = keyof typeof ACTIVITY_RETRY_POLICIES;
