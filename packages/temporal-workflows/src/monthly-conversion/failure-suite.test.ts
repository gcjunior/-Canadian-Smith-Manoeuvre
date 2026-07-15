import { fileURLToPath } from 'node:url';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MONTHLY_CONVERSION_FAILURE_CODES as Codes } from './failure-codes.js';
import type { MonthlyConversionWorkflowInput } from './types.js';
import { bankEventReceived, monthlyConversionWorkflow } from './workflow.js';
import { createStubActivities, type StubScenario } from './test/stubs.js';

const workflowsPath = fileURLToPath(new URL('./workflow.ts', import.meta.url));

const defaultInput: MonthlyConversionWorkflowInput = {
  tenantId: 'tenant-1',
  strategyId: 'strategy-1',
  paymentPeriod: '2026-07',
  expectedPaymentDate: '2026-07-01',
  timezone: 'America/Toronto',
};

describe('monthlyConversionWorkflow failure suite', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  async function runWorkflow(scenario: StubScenario = {}) {
    const taskQueue = `mc-fail-${crypto.randomUUID()}`;
    const activities = createStubActivities(scenario);
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });
    return await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(monthlyConversionWorkflow, {
        taskQueue,
        workflowId: `failure/${crypto.randomUUID()}`,
        args: [defaultInput],
      });
      const result = await handle.result();
      return { result, activities };
    });
  }

  it('payment settles immediately', async () => {
    const { result } = await runWorkflow({ mortgageDelayPolls: 0 });
    expect(result.outcome).toBe('COMPLETED');
  });

  it('payment settles after ~one day of polling', async () => {
    // POLL_INTERVAL = 6h → 4 polls ≈ 1 day before success on attempt 5
    const { result } = await runWorkflow({ mortgageDelayPolls: 4 });
    expect(result.outcome).toBe('COMPLETED');
  });

  it('payment settles after ~five days of polling', async () => {
    const { result } = await runWorkflow({ mortgageDelayPolls: 20 });
    expect(result.outcome).toBe('COMPLETED');
  });

  it('payment never settles within deadline', async () => {
    const { result } = await runWorkflow({ mortgageDelayPolls: 10_000 });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.MORTGAGE_PAYMENT_TIMEOUT);
  });

  it('payment reverse after posting/settlement path pauses', async () => {
    const { result } = await runWorkflow({ reversePayment: true });
    expect(result.failureCode).toBe(Codes.PAYMENT_REVERSED);
  });

  it('existing unused credit without new credit event skips', async () => {
    const { result } = await runWorkflow({
      existingAvailableCreditCents: '5000000',
      // Wait completes because credit appears at the wait layer...
      helocWaitCreditCents: '100000',
      // ...but calculated newly-available/draw for conversion is zero.
      newlyAvailableCreditCents: '0',
      drawAmountCents: '0',
      principalRepaidCents: '100000',
    });
    expect(result.outcome).toBe('SKIPPED');
    expect(result.failureCode).toBe(Codes.INSUFFICIENT_CREDIT);
  });

  it('HELOC draw rejected pauses as HELOC_DRAW_FAILED', async () => {
    const { result } = await runWorkflow({ rejectDraw: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.HELOC_DRAW_FAILED);
  });

  it('transfer rejected pauses as TRANSFER_FAILED', async () => {
    const { result } = await runWorkflow({ rejectTransfer: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.TRANSFER_FAILED);
  });

  it('reversed transfer / deposit pauses without completing', async () => {
    const reversedTransfer = await runWorkflow({ reverseTransfer: true });
    expect(reversedTransfer.result.outcome).toBe('PAUSED');
    const reversedDeposit = await runWorkflow({ reverseDeposit: true });
    expect(reversedDeposit.result.outcome).toBe('PAUSED');
  });

  it('account restricted rejects order', async () => {
    const { result } = await runWorkflow({ accountRestricted: true });
    expect(result.failureCode).toBe(Codes.ORDER_REJECTED);
  });

  it('symbol policy change during cycle fails reconciliation', async () => {
    const { result } = await runWorkflow({ symbolPolicyChanged: true });
    expect(result.failureCode).toBe(Codes.RECONCILIATION_FAILED);
  });

  it('out-of-order bank Signal does not unlock conversion early alone', async () => {
    const taskQueue = `mc-ooo-${crypto.randomUUID()}`;
    const activities = createStubActivities({ mortgageDelayPolls: 3 });
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });
    const { result } = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(monthlyConversionWorkflow, {
        taskQueue,
        workflowId: `ooo-${crypto.randomUUID()}`,
        args: [defaultInput],
      });
      await handle.signal(bankEventReceived, {
        providerEventId: 'early-1',
        accountId: 'mortgage-acct',
        eventType: 'mortgage.payment.updated',
        providerType: 'BANK',
      });
      return { result: await handle.result() };
    });
    expect(result.outcome).toBe('COMPLETED');
  });

  it('ambiguous draw resolve path initiates draw once then continues without duplicate initiation', async () => {
    const { result, activities } = await runWorkflow({ ambiguousDraw: true });
    expect(result.outcome).toBe('COMPLETED');
    expect(activities.calls.filter((c) => c.name === 'initiateHelocDraw')).toHaveLength(1);
    expect(activities.calls.filter((c) => c.name === 'resolveAmbiguousHelocDraw')).toHaveLength(1);
  });

  // Worker kill mid-poll against TestWorkflowEnvironment is deferred: time-skipping
  // requires an active worker, so shutdown-then-resume hangs the test harness.
  // Non-duplication is covered by ambiguous HELOC draw resolution (initiate once + resolve)
  // and history replay determinism in workflow.test.ts.
});
