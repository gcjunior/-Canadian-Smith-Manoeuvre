/**
 * History pressure snapshot — Workflow-sandbox safe (no Node APIs).
 *
 * Use for Continue-As-New decisions on long-lived entity / monitoring Workflows.
 * Finite monthly/interest Workflows do not need Continue-As-New (see docs).
 */

export type HistoryPressureSnapshot = {
  historyLength: number;
  /** Bytes; 0 on Temporal Server &lt; 1.20 */
  historySize: number;
  /** Server hint (Temporal ≥ 1.20) */
  continueAsNewSuggested: boolean;
};

export type HistoryPressureThresholds = {
  /** Soft warn — emit metrics / logs via Activity or sink; do not CAN yet */
  warnHistoryLength: number;
  /** Hard — Continue-As-New after handlers drain */
  maxHistoryLength: number;
  /** Soft warn bytes */
  warnHistorySizeBytes: number;
  /** Hard bytes */
  maxHistorySizeBytes: number;
};

/** Defaults aligned with Temporal guidance (≈10k events / ~50MiB soft). */
export const DEFAULT_HISTORY_THRESHOLDS: HistoryPressureThresholds = {
  warnHistoryLength: 8_000,
  maxHistoryLength: 10_000,
  warnHistorySizeBytes: 40 * 1024 * 1024,
  maxHistorySizeBytes: 50 * 1024 * 1024,
};

export type HistoryPressureLevel = 'ok' | 'warn' | 'critical';

export function classifyHistoryPressure(
  snap: HistoryPressureSnapshot,
  thresholds: HistoryPressureThresholds = DEFAULT_HISTORY_THRESHOLDS,
): HistoryPressureLevel {
  if (
    snap.continueAsNewSuggested ||
    snap.historyLength >= thresholds.maxHistoryLength ||
    snap.historySize >= thresholds.maxHistorySizeBytes
  ) {
    return 'critical';
  }
  if (
    snap.historyLength >= thresholds.warnHistoryLength ||
    snap.historySize >= thresholds.warnHistorySizeBytes
  ) {
    return 'warn';
  }
  return 'ok';
}

/**
 * Monitor-friendly summarizer for Query responses or Activity args.
 * Keep payloads tiny — never embed Signal/event bodies.
 */
export function summarizeHistoryPressure(
  snap: HistoryPressureSnapshot,
  thresholds: HistoryPressureThresholds = DEFAULT_HISTORY_THRESHOLDS,
): {
  level: HistoryPressureLevel;
  historyLength: number;
  historySize: number;
  continueAsNewSuggested: boolean;
  shouldContinueAsNew: boolean;
} {
  const level = classifyHistoryPressure(snap, thresholds);
  return {
    level,
    historyLength: snap.historyLength,
    historySize: snap.historySize,
    continueAsNewSuggested: snap.continueAsNewSuggested,
    shouldContinueAsNew: level === 'critical',
  };
}
