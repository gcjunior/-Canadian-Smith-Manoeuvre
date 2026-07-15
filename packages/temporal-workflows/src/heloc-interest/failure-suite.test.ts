import { fileURLToPath } from 'node:url';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { HelocInterestWorkflowInput } from './types.js';
import { helocInterestPaymentWorkflow } from './workflow.js';
import { createStubActivities } from './test/stubs.js';

const workflowsPath = fileURLToPath(new URL('./workflow.ts', import.meta.url));

const defaultInput: HelocInterestWorkflowInput = {
  tenantId: 'tenant-1',
  strategyId: 'strategy-1',
  interestPeriod: '2026-07',
  expectedInterestChargeDate: '2026-07-01',
  timezone: 'America/Toronto',
};

describe('helocInterestPaymentWorkflow failure suite', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  async function run(scenario: Parameters<typeof createStubActivities>[0] = {}) {
    const taskQueue = `hi-fail-${crypto.randomUUID()}`;
    const activities = createStubActivities(scenario);
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });
    return await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(helocInterestPaymentWorkflow, {
        taskQueue,
        workflowId: `interest-fail/${crypto.randomUUID()}`,
        args: [defaultInput],
      });
      return handle.result();
    });
  }

  it('debit succeeds on happy path', async () => {
    const result = await run();
    expect(result.outcome).toBe('COMPLETED');
  });

  it('insufficient ordinary-account funds pauses', async () => {
    const result = await run({ debitFailureCode: 'INSUFFICIENT_FUNDS', debitState: 'FAILED' });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe('INSUFFICIENT_FUNDS');
  });

  it('interest payment reversed pauses', async () => {
    const result = await run({ debitState: 'REVERSED' });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe('DEBIT_REVERSED');
  });

  it('interest paid from unexpected account pauses', async () => {
    const result = await run({ unexpectedSource: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe('INTEREST_UNEXPECTED_SOURCE');
  });

  it('amount mismatch pauses', async () => {
    const result = await run({ amountMismatch: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe('INTEREST_AMOUNT_MISMATCH');
  });

  it('replay history remains deterministic after completion', async () => {
    const taskQueue = `hi-replay-${crypto.randomUUID()}`;
    const activities = createStubActivities();
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });
    const handle = await worker.runUntil(async () => {
      const h = await testEnv.client.workflow.start(helocInterestPaymentWorkflow, {
        taskQueue,
        workflowId: `interest-replay/${crypto.randomUUID()}`,
        args: [defaultInput],
      });
      await h.result();
      return h;
    });
    const history = await handle.fetchHistory();
    await Worker.runReplayHistory({ workflowsPath }, history);
  });
});
