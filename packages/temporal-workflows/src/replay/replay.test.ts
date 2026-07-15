/**
 * Replay stored Event Histories against the current Workflow source modules.
 * Fails with DeterminismViolationError if command paths diverge.
 */
import { fileURLToPath } from 'node:url';

import { Worker } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';

import { WORKFLOW_BUNDLE_VERSION } from '../versioning/bundle-version.js';
import {
  assertFixturesPresent,
  listReplayFixtureMetas,
  loadReplayHistory,
} from './load-fixtures.js';

const workflowPaths: Record<string, string> = {
  monthlyConversionWorkflow: fileURLToPath(
    new URL('../monthly-conversion/workflow.ts', import.meta.url),
  ),
  helocInterestPaymentWorkflow: fileURLToPath(
    new URL('../heloc-interest/workflow.ts', import.meta.url),
  ),
};

describe('stored history replay', () => {
  it('manifest lists fixtures and bundle version is set', () => {
    assertFixturesPresent();
    const metas = listReplayFixtureMetas();
    expect(metas.length).toBeGreaterThanOrEqual(2);
    expect(WORKFLOW_BUNDLE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('replays every committed fixture without DeterminismViolationError', async () => {
    assertFixturesPresent();
    for (const meta of listReplayFixtureMetas()) {
      const workflowsPath = workflowPaths[meta.workflowType];
      expect(workflowsPath, `unknown workflowType ${meta.workflowType}`).toBeTruthy();
      const history = loadReplayHistory(meta.historyFile);
      await Worker.runReplayHistory(
        { workflowsPath: workflowsPath! },
        history,
        `replay/${meta.name}`,
      );
    }
  });
});
