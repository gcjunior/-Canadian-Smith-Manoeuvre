import type { ActivityOptions } from '@temporalio/common';

/** Six-hour durable poll interval between truth checks. */
export const POLL_INTERVAL = '6 hours';

/** HELOC interest charge wait budget from Workflow start. */
export const CHARGE_DEADLINE = '14 days';

/** Ordinary-bank interest debit wait budget after charge is recorded. */
export const DEBIT_DEADLINE = '7 days';

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
        'INSUFFICIENT_FUNDS',
        'INTEREST_AMOUNT_MISMATCH',
        'INTEREST_UNEXPECTED_SOURCE',
        'DUPLICATE_CONFLICT',
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
        'DUPLICATE_CONFLICT',
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
        'FORBIDDEN',
        'NOT_FOUND',
        'INSUFFICIENT_FUNDS',
        'DEBIT_FAILED',
        'DEBIT_REVERSED',
        'RECONCILIATION_FAILED',
        'INTEREST_AMOUNT_MISMATCH',
        'INTEREST_UNEXPECTED_SOURCE',
        'DUPLICATE_CONFLICT',
      ],
    },
  } satisfies ActivityOptions,
} as const;
