/**
 * Temporal TypeScript patching wrappers for Workflow code only.
 *
 * TypeScript SDK uses `patched` / `deprecatePatch` (not Java-style `getVersion`).
 * Do not import from Node unit tests that lack a Workflow isolate.
 */

import { deprecatePatch, patched } from '@temporalio/workflow';

import type { WorkflowChangeId } from './bundle-version.js';

/**
 * Returns true when this execution should take the **new** code path.
 *
 * - New (non-replay) executions: always true (marker recorded).
 * - Replay of history that already recorded this patch: true.
 * - Replay of pre-patch history: false → keep old commands.
 */
export function gatedPatch(changeId: WorkflowChangeId | string): boolean {
  return patched(changeId);
}

/**
 * Phase-out marker once no Worker without `patched(changeId)` remains,
 * and all pre-patch histories have left retention.
 */
export function gatedDeprecatePatch(changeId: WorkflowChangeId | string): void {
  deprecatePatch(changeId);
}
