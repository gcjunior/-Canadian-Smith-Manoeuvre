/**
 * Continue-As-New (CAN) policy for **long-lived** entity / monitoring Workflows.
 *
 * Monthly conversion and HELOC interest Workflows are **finite per period** and
 * normally must NOT Continue-As-New (ADR-0007 / ADR-0008). This module exists so
 * any future coordinator-style Workflow follows a single safe checklist.
 */

import {
  classifyHistoryPressure,
  DEFAULT_HISTORY_THRESHOLDS,
  type HistoryPressureSnapshot,
  type HistoryPressureThresholds,
} from './history-pressure.js';

export type ContinueAsNewGate = {
  /** From workflowInfo().continueAsNewSuggested or history pressure critical */
  historySuggestsContinueAsNew: boolean;
  /**
   * All Signal/Update handlers must finish before CAN.
   * Set false while a handler is awaiting Activities / timers.
   */
  signalAndUpdateHandlersIdle: boolean;
  /** No in-flight child Workflow we need to await before cutting over */
  childrenSettledOrAbandoned: boolean;
};

export type CompactContinueAsNewState = {
  /** Bundle version that produced this state */
  workflowBundleVersion: string;
  /** Opaque compact checkpoint — identifiers only, no provider payloads */
  checkpoint: Record<string, string | number | boolean | null>;
};

/**
 * Decide whether it is safe to call continueAsNew.
 *
 * Mechanisms:
 * 1. Server/history pressure hint (`continueAsNewSuggested` / length / size)
 * 2. Handler drain — avoid cutting over mid-Signal (lost wakeups)
 * 3. Child settlement policy
 * 4. Compact state only — never full webhook/event payloads
 */
export function shouldContinueAsNew(
  snap: HistoryPressureSnapshot,
  gate: ContinueAsNewGate,
  thresholds: HistoryPressureThresholds = DEFAULT_HISTORY_THRESHOLDS,
): { proceed: boolean; reason: string } {
  const level = classifyHistoryPressure(snap, thresholds);
  const pressure =
    gate.historySuggestsContinueAsNew || snap.continueAsNewSuggested || level === 'critical';

  if (!pressure) {
    return { proceed: false, reason: 'history_pressure_ok' };
  }
  if (!gate.signalAndUpdateHandlersIdle) {
    return { proceed: false, reason: 'handlers_busy' };
  }
  if (!gate.childrenSettledOrAbandoned) {
    return { proceed: false, reason: 'children_inflight' };
  }
  return { proceed: true, reason: 'safe_to_continue_as_new' };
}

/**
 * Validate compact state before continuing as new.
 * Rejects keys that look like raw payloads (defense in depth).
 */
export function assertCompactContinueAsNewState(state: CompactContinueAsNewState): void {
  const forbidden = /(payload|rawBody|webhook|jwt|token|secret|accountNumber)/i;
  for (const key of Object.keys(state.checkpoint)) {
    if (forbidden.test(key)) {
      throw new Error(`Continue-As-New checkpoint key forbidden: ${key}`);
    }
  }
}

/**
 * Why finite monthly / interest Workflows skip Continue-As-New.
 * Exported for docs + compatibility tests — not runtime control flow.
 */
export const FINITE_WORKFLOW_NO_CONTINUE_AS_NEW_RATIONALE = [
  'Each conversion/interest run is scoped to one payment/interest period (ADR-0007).',
  'Temporal Schedule starts a fresh Workflow Id per period (ADR-0008 Option B).',
  'Bounded waits (mortgage ≤14d, HELOC credit ≤7d, poll every 6h) produce finite histories.',
  'Signals are wake tips only; Activities poll providers — histories stay compact.',
  'Continue-As-New would add cutover risk without operational benefit for MVP cadence.',
] as const;
