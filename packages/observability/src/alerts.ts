import type { Logger } from './logger.js';
import { csmMetrics } from './metrics.js';
import { redactObject } from './redact.js';

/** Alert codes for ops / Alertmanager-style rules (see docs/operations-runbook.md). */
export const ALERT_CODES = {
  FINANCIAL_UNKNOWN_STATE: 'FINANCIAL_UNKNOWN_STATE',
  CYCLE_STUCK: 'CYCLE_STUCK',
  RECONCILIATION_MISMATCH: 'RECONCILIATION_MISMATCH',
  REPEATED_ACTIVITY_FAILURE: 'REPEATED_ACTIVITY_FAILURE',
  INTEREST_DEBIT_FAILURE: 'INTEREST_DEBIT_FAILURE',
  SCHEDULE_MISSING: 'SCHEDULE_MISSING',
  LEDGER_IMBALANCE: 'LEDGER_IMBALANCE',
  CROSS_TENANT_AUTHORIZATION: 'CROSS_TENANT_AUTHORIZATION',
} as const;

export type AlertCode = (typeof ALERT_CODES)[keyof typeof ALERT_CODES];

export function emitAlert(
  logger: Logger,
  code: AlertCode,
  details: Record<string, unknown> = {},
): void {
  const safe = redactObject(details);
  csmMetrics.alertsFired.add(1, { code });
  logger.error(
    {
      alert: true,
      alertCode: code,
      ...safe,
    },
    `alert:${code}`,
  );
}
