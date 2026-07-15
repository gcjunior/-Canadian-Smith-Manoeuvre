/**
 * Workflow bundle / compat version metadata.
 *
 * **Not** a Temporal `getVersion` change-id. This is the Worker-facing label for
 * the workflow *package* shipped with a Worker build. Bump when shipping
 * intentional Workflow behavior changes that need an ops/comms trail.
 *
 * Replay safety is enforced by CI fixtures + Temporal `patched`/`getVersion`
 * gates for mid-flight divergence — see docs/temporal-versioning.md.
 */
export const WORKFLOW_BUNDLE_VERSION = '1.0.0';

/**
 * Registered Temporal change ids (passed to `getVersion` / `patched`).
 *
 * Only add an id when introducing a command-path change that must coexist with
 * in-flight executions. Do **not** invent ids "just in case".
 *
 * Naming: `csm.<workflow>.<yyyy-mm-dd>.<slug>`
 */
export const WORKFLOW_CHANGE_IDS = {
  /**
   * Reserved example — unused in production Workflows today.
   * Shows the naming convention for the first real gated change.
   */
  EXAMPLE_RESERVED: 'csm.example.2026-07-15.reserved',
} as const;

export type WorkflowChangeId = (typeof WORKFLOW_CHANGE_IDS)[keyof typeof WORKFLOW_CHANGE_IDS];

/** Finite cycle Workflows shipped today (no Continue-As-New required). */
export const FINITE_WORKFLOW_TYPES = [
  'monthlyConversionWorkflow',
  'monthlyConversionScheduleKickoff',
  'helocInterestPaymentWorkflow',
  'helocInterestScheduleKickoff',
  'pingWorkflow',
] as const;

export type FiniteWorkflowType = (typeof FINITE_WORKFLOW_TYPES)[number];
