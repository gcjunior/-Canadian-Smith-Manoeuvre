/**
 * Regenerates golden Event History fixtures when UPDATE_REPLAY_FIXTURES=1.
 * Skipped in normal CI — use committed replay-fixtures/*.bin instead.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStubActivities as createInterestStubs } from '../heloc-interest/test/stubs.js';
import type { HelocInterestWorkflowInput } from '../heloc-interest/types.js';
import { helocInterestPaymentWorkflow } from '../heloc-interest/workflow.js';
import { createStubActivities as createConversionStubs } from '../monthly-conversion/test/stubs.js';
import type { MonthlyConversionWorkflowInput } from '../monthly-conversion/types.js';
import { monthlyConversionWorkflow } from '../monthly-conversion/workflow.js';
import { WORKFLOW_BUNDLE_VERSION } from '../versioning/bundle-version.js';
import { writeHistoryFixture } from './history-codec.js';

const shouldUpdate = process.env.UPDATE_REPLAY_FIXTURES === '1';
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixturesDir = join(packageRoot, 'replay-fixtures');
const conversionWorkflowsPath = join(packageRoot, 'src/monthly-conversion/workflow.ts');
const interestWorkflowsPath = join(packageRoot, 'src/heloc-interest/workflow.ts');

const conversionInput: MonthlyConversionWorkflowInput = {
  tenantId: 'fixture-tenant',
  strategyId: 'fixture-strategy',
  paymentPeriod: '2026-07',
  expectedPaymentDate: '2026-07-01',
  timezone: 'America/Toronto',
};

const interestInput: HelocInterestWorkflowInput = {
  tenantId: 'fixture-tenant',
  strategyId: 'fixture-strategy',
  interestPeriod: '2026-07',
  expectedInterestChargeDate: '2026-07-01',
  timezone: 'America/Toronto',
};

describe.runIf(shouldUpdate)('generate replay fixtures', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    mkdirSync(fixturesDir, { recursive: true });
  }, 120_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  it('writes monthly-conversion-happy.bin and heloc-interest-happy.bin', async () => {
    const conversionHistory = await (async () => {
      const taskQueue = `fixture-mc-${crypto.randomUUID()}`;
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue,
        workflowsPath: conversionWorkflowsPath,
        activities: createConversionStubs(),
      });
      return worker.runUntil(async () => {
        const handle = await testEnv.client.workflow.start(monthlyConversionWorkflow, {
          taskQueue,
          workflowId: 'monthly-conversion/fixture-tenant/fixture-strategy/2026-07',
          args: [conversionInput],
        });
        const result = await handle.result();
        expect(result.outcome).toBe('COMPLETED');
        return handle.fetchHistory();
      });
    })();

    const interestHistory = await (async () => {
      const taskQueue = `fixture-hi-${crypto.randomUUID()}`;
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue,
        workflowsPath: interestWorkflowsPath,
        activities: createInterestStubs(),
      });
      return worker.runUntil(async () => {
        const handle = await testEnv.client.workflow.start(helocInterestPaymentWorkflow, {
          taskQueue,
          workflowId: 'heloc-interest/fixture-tenant/fixture-strategy/2026-07',
          args: [interestInput],
        });
        const result = await handle.result();
        expect(result.outcome).toBe('COMPLETED');
        return handle.fetchHistory();
      });
    })();

    const conversionFile = 'monthly-conversion-happy.bin';
    const interestFile = 'heloc-interest-happy.bin';
    const capturedAt = new Date().toISOString();

    writeHistoryFixture(join(fixturesDir, conversionFile), conversionHistory);
    writeHistoryFixture(join(fixturesDir, interestFile), interestHistory);

    const manifest = {
      workflowBundleVersion: WORKFLOW_BUNDLE_VERSION,
      capturedAt,
      format: 'temporal.api.history.v1.History protobuf binary (.bin)',
      note: 'Golden Event Histories for Worker.runReplayHistory. Regenerate only with intentional Workflow command-path changes (UPDATE_REPLAY_FIXTURES=1).',
      fixtures: [
        {
          name: 'monthly-conversion-happy',
          workflowType: 'monthlyConversionWorkflow',
          description: 'Happy-path monthly conversion through reconcile + complete',
          capturedAt,
          workflowBundleVersion: WORKFLOW_BUNDLE_VERSION,
          historyFile: conversionFile,
        },
        {
          name: 'heloc-interest-happy',
          workflowType: 'helocInterestPaymentWorkflow',
          description: 'Happy-path HELOC interest charge + debit + reconcile',
          capturedAt,
          workflowBundleVersion: WORKFLOW_BUNDLE_VERSION,
          historyFile: interestFile,
        },
      ],
    };
    writeFileSync(join(fixturesDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }, 120_000);
});
