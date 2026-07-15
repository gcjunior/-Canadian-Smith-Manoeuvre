import { ApplicationFailure } from '@temporalio/activity';
import { ALERT_CODES, csmMetrics, redactObject } from '@csm/observability';

export function nonRetryable(
  message: string,
  type: string,
  details?: Record<string, unknown>,
): never {
  if (type === 'AMBIGUOUS_RESULT') {
    csmMetrics.ambiguousProviderOutcomes.add(1, {
      operation: typeof details?.['operation'] === 'string' ? details['operation'] : 'unknown',
    });
    csmMetrics.alertsFired.add(1, { code: ALERT_CODES.FINANCIAL_UNKNOWN_STATE });
  }
  if (type === 'DEBIT_FAILED') {
    csmMetrics.interestPaymentFailures.add(1);
    csmMetrics.alertsFired.add(1, { code: ALERT_CODES.INTEREST_DEBIT_FAILURE });
  }
  if (type === 'RECONCILIATION_FAILED') {
    csmMetrics.reconciliationMismatches.add(1);
    const codes = details?.['failedCodes'];
    const ledgerImbalance =
      details?.['ledgerImbalance'] === true ||
      (Array.isArray(codes) && codes.includes('LEDGER_BALANCED'));
    csmMetrics.alertsFired.add(1, {
      code: ledgerImbalance ? ALERT_CODES.LEDGER_IMBALANCE : ALERT_CODES.RECONCILIATION_MISMATCH,
    });
  }
  throw ApplicationFailure.nonRetryable(
    message,
    type,
    details ? [redactObject(details)] : undefined,
  );
}

export function retryable(message: string, type: string, details?: Record<string, unknown>): never {
  throw ApplicationFailure.create({
    message,
    type,
    nonRetryable: false,
    ...(details ? { details: [redactObject(details)] } : {}),
  });
}

function providerKind(error: unknown): string | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'kind' in error &&
    typeof (error as { kind: unknown }).kind === 'string'
  ) {
    return (error as { kind: string }).kind;
  }
  return undefined;
}

function providerMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Map provider client errors: business/auth/validation/ambiguous → non-retryable. */
export function mapProviderError(error: unknown, operation: string): never {
  const kind = providerKind(error);
  const nonRetryableKinds = new Set([
    'BUSINESS_REJECTION',
    'VALIDATION_FAILURE',
    'DUPLICATE_CONFLICT',
    'AUTHENTICATION_FAILURE',
    'AMBIGUOUS_RESULT',
  ]);
  if (kind && nonRetryableKinds.has(kind)) {
    nonRetryable(`${operation}: ${providerMessage(error)}`, kind, {
      operation,
      kind,
      statusCode: (error as { statusCode?: number }).statusCode,
      idempotencyKey: (error as { idempotencyKey?: string }).idempotencyKey,
    });
  }
  if (kind) {
    retryable(`${operation}: ${providerMessage(error)}`, kind, {
      operation,
      kind,
      statusCode: (error as { statusCode?: number }).statusCode,
    });
  }
  throw error;
}
