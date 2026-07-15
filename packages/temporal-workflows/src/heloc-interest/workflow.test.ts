import { fileURLToPath } from 'node:url';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HELOC_INTEREST_FAILURE_CODES as Codes } from './failure-codes.js';
import type { HelocInterestWorkflowInput } from './types.js';
import {
  getCurrentWaitReason,
  helocInterestPaymentWorkflow,
  interestBankEventReceived,
} from './workflow.js';
import { createStubActivities, type StubScenario } from './test/stubs.js';

const workflowsPath = fileURLToPath(new URL('./workflow.ts', import.meta.url));

const defaultInput: HelocInterestWorkflowInput = {
  tenantId: 'tenant-1',
  strategyId: 'strategy-1',
  interestPeriod: '2026-07',
  expectedInterestChargeDate: '2026-07-01',
  timezone: 'America/Toronto',
};

describe('helocInterestPaymentWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  async function runWorkflow(
    scenario: StubScenario = {},
    options?: {
      input?: Partial<HelocInterestWorkflowInput>;
      during?: (handle: {
        signal: (def: unknown, ...args: unknown[]) => Promise<void>;
        query: (def: unknown) => Promise<unknown>;
      }) => Promise<void>;
    },
  ) {
    const taskQueue = `hi-${crypto.randomUUID()}`;
    const activities = createStubActivities(scenario);
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });

    const input: HelocInterestWorkflowInput = {
      ...defaultInput,
      ...options?.input,
    };

    return await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(helocInterestPaymentWorkflow, {
        taskQueue,
        workflowId: `heloc-interest/${input.tenantId}/${input.strategyId}/${input.interestPeriod}-${crypto.randomUUID()}`,
        args: [input],
      });
      if (options?.during) {
        await options.during(handle as never);
      }
      const result = await handle.result();
      return { result, activities, handle };
    });
  }

  it('happy path: charge present → debit settled → COMPLETED', async () => {
    const { result, activities } = await runWorkflow();
    expect(result.outcome).toBe('COMPLETED');
    expect(result.chargeAmountCents).toBe('50000');
    expect(result.debitAmountCents).toBe('50000');
    expect(result.providerRefs.providerChargeId).toBe('pchg-1');
    expect(activities.calls.some((c) => c.name === 'completeInterestCycle')).toBe(true);
    expect(activities.calls.some((c) => c.name === 'appendLedgerEntries')).toBe(true);
  });

  it('charge absent: wait signal then succeeds', async () => {
    const taskQueue = `hi-wake-${crypto.randomUUID()}`;
    const activities = createStubActivities({ chargeDelayPolls: 2 });
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(helocInterestPaymentWorkflow, {
        taskQueue,
        workflowId: `wake-${crypto.randomUUID()}`,
        args: [defaultInput],
      });
      await testEnv.sleep('1 hour');
      const wait = await handle.query(getCurrentWaitReason);
      expect(wait === 'INTEREST_CHARGE' || wait === null).toBe(true);
      await handle.signal(interestBankEventReceived, {
        providerEventId: 'evt-interest-1',
        accountId: 'heloc-acct',
        eventType: 'heloc.interest.posted',
        providerType: 'BANK',
        providerResourceId: 'pchg-pending',
      });
      await testEnv.sleep('6 hours');
      await handle.signal(interestBankEventReceived, {
        providerEventId: 'evt-interest-2',
        accountId: 'heloc-acct',
        eventType: 'heloc.interest.posted',
        providerType: 'BANK',
      });
      const result = await handle.result();
      expect(result.outcome).toBe('COMPLETED');
      expect(
        activities.calls.filter((c) => c.name === 'findPostedInterestCharge').length,
      ).toBeGreaterThan(1);
    });
  });

  it('charge timeout → PAUSED INTEREST_CHARGE_TIMEOUT', async () => {
    const { result, activities } = await runWorkflow({ chargeDelayPolls: 10_000 });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.INTEREST_CHARGE_TIMEOUT);
    expect(activities.calls.some((c) => c.name === 'failInterestCycle')).toBe(true);
    expect(
      activities.calls.some(
        (c) =>
          c.name === 'createAuditPackageMetadata' &&
          (c.args as { packageType?: string }).packageType === 'SAFETY_PAUSE',
      ),
    ).toBe(true);
  });

  it('NSF / debit FAILED → PAUSED INSUFFICIENT_FUNDS', async () => {
    const { result, activities } = await runWorkflow({
      debitState: 'FAILED',
      debitFailureCode: 'INSUFFICIENT_FUNDS',
    });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.INSUFFICIENT_FUNDS);
    expect(activities.calls.some((c) => c.name === 'failInterestCycle')).toBe(true);
  });

  it('amount mismatch → PAUSED INTEREST_AMOUNT_MISMATCH', async () => {
    const { result } = await runWorkflow({
      chargeAmountCents: '50000',
      debitAmountCents: '49999',
    });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.INTEREST_AMOUNT_MISMATCH);
  });

  it('duplicate signal ignored', async () => {
    const { result } = await runWorkflow(
      { chargeDelayPolls: 1 },
      {
        during: async (handle) => {
          const event = {
            providerEventId: 'dup-interest-1',
            accountId: 'heloc-acct',
            eventType: 'heloc.interest.posted',
            providerType: 'BANK' as const,
          };
          await handle.signal(interestBankEventReceived, event);
          await handle.signal(interestBankEventReceived, event);
          await handle.signal(interestBankEventReceived, event);
        },
      },
    );
    expect(result.outcome).toBe('COMPLETED');
  });

  it('strategy not active → FAILED', async () => {
    const { result } = await runWorkflow({ strategyState: 'PAUSED' });
    expect(result.outcome).toBe('FAILED');
    expect(result.failureCode).toBe(Codes.STRATEGY_NOT_ACTIVE);
    expect(result.cycleId).toBe('');
  });

  it('strategy not active via FORBIDDEN from snapshot → FAILED', async () => {
    const { result } = await runWorkflow({ loadSnapshotForbidden: true });
    expect(result.outcome).toBe('FAILED');
    expect(result.failureCode).toBe(Codes.STRATEGY_NOT_ACTIVE);
  });
});
