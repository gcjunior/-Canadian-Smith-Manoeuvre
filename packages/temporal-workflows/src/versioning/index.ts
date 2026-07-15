/** Node-safe versioning exports (no Workflow isolate APIs). */

export {
  FINITE_WORKFLOW_TYPES,
  WORKFLOW_BUNDLE_VERSION,
  WORKFLOW_CHANGE_IDS,
  type FiniteWorkflowType,
  type WorkflowChangeId,
} from './bundle-version.js';

export {
  DEFAULT_HISTORY_THRESHOLDS,
  classifyHistoryPressure,
  summarizeHistoryPressure,
  type HistoryPressureLevel,
  type HistoryPressureSnapshot,
  type HistoryPressureThresholds,
} from './history-pressure.js';

export {
  FINITE_WORKFLOW_NO_CONTINUE_AS_NEW_RATIONALE,
  assertCompactContinueAsNewState,
  shouldContinueAsNew,
  type CompactContinueAsNewState,
  type ContinueAsNewGate,
} from './continue-as-new-policy.js';

export { REPLAY_BREAKING_CHANGE_CLASSES, REPLAY_SAFE_CHANGE_CLASSES } from './replay-breakage.js';
