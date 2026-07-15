import type { ActivityOptions } from '@temporalio/common';

/** Six-hour durable poll interval between truth checks. */
export const POLL_INTERVAL = '6 hours';

/** Mortgage settlement wait budget from Workflow start. */
export const MORTGAGE_DEADLINE = '14 days';

/** HELOC readvance wait budget after principal is known. */
export const HELOC_CREDIT_DEADLINE = '7 days';

/**
 * Configured platform minimum investment (CAD cents).
 * Amounts below this complete as SKIPPED (not a financial failure).
 */
export const MIN_INVESTMENT_CENTS = '100';

/**
 * Explicit Activity retry policies by category.
 * Duplicated here so Workflow code never imports Activity implementations.
 */
export const WORKFLOW_ACTIVITY_OPTIONS = {
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

  financialMutation: {
    startToCloseTimeout: '2 minutes',
    retry: {
      initialInterval: '2 seconds',
      backoffCoefficient: 2,
      maximumInterval: '30 seconds',
      // Worker crash after POST needs one recovery attempt with GET-before-POST.
      // Uncertain provider outcomes throw AMBIGUOUS_RESULT (non-retryable).
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
