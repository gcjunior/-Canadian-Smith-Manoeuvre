import { Context } from '@temporalio/activity';

import { ALERT_CODES, csmMetrics, emitAlert, withSpan, type Logger } from '@csm/observability';

/** Best-effort Activity attempt from Temporal context (1 outside workers/tests). */
export function getActivityAttempt(): number {
  try {
    return Context.current().info.attempt;
  } catch {
    return 1;
  }
}

export function noteActivityAttempt(
  activity: string,
  logger: Logger,
  correlationId?: string,
): void {
  const attempt = getActivityAttempt();
  if (attempt > 1) {
    csmMetrics.activityRetries.add(1, { activity });
    logger.warn({ activity, attempt, correlationId }, 'activity retry attempt');
  }
  if (attempt >= 3) {
    emitAlert(logger, ALERT_CODES.REPEATED_ACTIVITY_FAILURE, {
      activity,
      attempt,
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
  }
}

export async function runInstrumentedActivity<T>(
  name: string,
  logger: Logger,
  correlationId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  noteActivityAttempt(name, logger, correlationId);
  return withSpan(`activity.${name}`, correlationId ? { correlationId } : {}, async () => fn());
}

export function noteAmbiguousOutcome(
  logger: Logger,
  operation: string,
  correlationId: string,
  details: Record<string, unknown> = {},
): void {
  csmMetrics.ambiguousProviderOutcomes.add(1, { operation });
  emitAlert(logger, ALERT_CODES.FINANCIAL_UNKNOWN_STATE, {
    operation,
    correlationId,
    ...details,
  });
}

export function noteReconciliationFailure(
  logger: Logger,
  kind: 'conversion' | 'interest',
  correlationId: string,
  details: Record<string, unknown> = {},
): void {
  csmMetrics.reconciliationMismatches.add(1, { kind });
  const code =
    details['rule'] === 'LEDGER_BALANCED' || details['ledgerImbalance'] === true
      ? ALERT_CODES.LEDGER_IMBALANCE
      : ALERT_CODES.RECONCILIATION_MISMATCH;
  emitAlert(logger, code, { kind, correlationId, ...details });
}

export function noteInterestDebitFailure(
  logger: Logger,
  correlationId: string,
  details: Record<string, unknown> = {},
): void {
  csmMetrics.interestPaymentFailures.add(1);
  emitAlert(logger, ALERT_CODES.INTEREST_DEBIT_FAILURE, { correlationId, ...details });
}

export function noteCycleStuck(
  logger: Logger,
  correlationId: string,
  details: Record<string, unknown> = {},
): void {
  emitAlert(logger, ALERT_CODES.CYCLE_STUCK, { correlationId, ...details });
}

const STUCK_CODES = new Set([
  'HELOC_CREDIT_LAG_TIMEOUT',
  'MORTGAGE_SETTLEMENT_TIMEOUT',
  'HELOC_DRAW_TIMEOUT',
  'TRANSFER_TIMEOUT',
  'INVESTMENT_SETTLEMENT_TIMEOUT',
  'ORDER_FILL_TIMEOUT',
]);

export function noteSafetyPauseMetrics(logger: Logger, code: string, correlationId: string): void {
  csmMetrics.cyclesPaused.add(1, { code });
  if (STUCK_CODES.has(code)) {
    noteCycleStuck(logger, correlationId, { failureCode: code });
  }
  if (code.includes('AMBIGUOUS') || code.includes('UNKNOWN')) {
    csmMetrics.ambiguousProviderOutcomes.add(1, { code });
    emitAlert(logger, ALERT_CODES.FINANCIAL_UNKNOWN_STATE, { correlationId, failureCode: code });
  }
  if (code.includes('INTEREST') || code.includes('DEBIT')) {
    noteInterestDebitFailure(logger, correlationId, { failureCode: code });
  }
}
