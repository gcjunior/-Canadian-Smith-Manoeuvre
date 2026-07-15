import { fileURLToPath } from 'node:url';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MONTHLY_CONVERSION_FAILURE_CODES as Codes } from './failure-codes.js';
import type { MonthlyConversionStatus, MonthlyConversionWorkflowInput } from './types.js';
import {
  bankEventReceived,
  brokerageEventReceived,
  getCurrentWaitReason,
  getStatus,
  monthlyConversionWorkflow,
  strategyPaused,
} from './workflow.js';
import { createStubActivities, type StubScenario } from './test/stubs.js';

const workflowsPath = fileURLToPath(new URL('./workflow.ts', import.meta.url));

const defaultInput: MonthlyConversionWorkflowInput = {
  tenantId: 'tenant-1',
  strategyId: 'strategy-1',
  paymentPeriod: '2026-07',
  expectedPaymentDate: '2026-07-01',
  timezone: 'America/Toronto',
};

describe('monthlyConversionWorkflow', () => {
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
      input?: Partial<MonthlyConversionWorkflowInput>;
      during?: (handle: {
        signal: (def: unknown, ...args: unknown[]) => Promise<void>;
        query: (def: unknown) => Promise<unknown>;
      }) => Promise<void>;
    },
  ) {
    const taskQueue = `mc-${crypto.randomUUID()}`;
    const activities = createStubActivities(scenario);
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });

    const input: MonthlyConversionWorkflowInput = {
      ...defaultInput,
      ...options?.input,
    };

    return await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(monthlyConversionWorkflow, {
        taskQueue,
        workflowId: `monthly-conversion/${input.tenantId}/${input.strategyId}/${input.paymentPeriod}-${crypto.randomUUID()}`,
        args: [input],
      });
      if (options?.during) {
        await options.during(handle as never);
      }
      const result = await handle.result();
      return { result, activities, handle };
    });
  }

  it('immediate settlement completes conversion', async () => {
    const { result, activities } = await runWorkflow();
    expect(result.outcome).toBe('COMPLETED');
    expect(result.drawAmountCents).toBe('100000');
    expect(activities.calls.some((c: { name: string }) => c.name === 'completeCycle')).toBe(true);
  });

  it('three-day mortgage delay then settles', async () => {
    const { result, activities } = await runWorkflow({ mortgageDelayPolls: 12 });
    expect(result.outcome).toBe('COMPLETED');
    expect(
      activities.calls.filter((c) => c.name === 'findSettledMortgagePayment').length,
    ).toBeGreaterThan(12);
  });

  it('HELOC readvance delay then proceeds', async () => {
    const { result, activities } = await runWorkflow({ helocCreditDelayPolls: 4 });
    expect(result.outcome).toBe('COMPLETED');
    expect(
      activities.calls.filter((c) => c.name === 'getHelocAvailability').length,
    ).toBeGreaterThan(4);
  });

  it('webhook wakes mortgage polling early', async () => {
    const taskQueue = `mc-wake-${crypto.randomUUID()}`;
    const activities = createStubActivities({ mortgageDelayPolls: 2 });
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(monthlyConversionWorkflow, {
        taskQueue,
        workflowId: `wake-${crypto.randomUUID()}`,
        args: [defaultInput],
      });
      await testEnv.sleep('1 hour');
      const wait = await handle.query(getCurrentWaitReason);
      expect(wait === 'MORTGAGE_PAYMENT' || wait === null).toBe(true);
      await handle.signal(bankEventReceived, {
        providerEventId: 'evt-wake-1',
        accountId: 'acct-mortgage',
        eventType: 'mortgage.payment.updated',
        providerType: 'BANK',
        providerResourceId: 'ppay-pending',
      });
      await testEnv.sleep('6 hours');
      await handle.signal(bankEventReceived, {
        providerEventId: 'evt-wake-2',
        accountId: 'acct-mortgage',
        eventType: 'mortgage.payment.updated',
        providerType: 'BANK',
      });
      const result = await handle.result();
      expect(result.outcome).toBe('COMPLETED');
    });
  });

  it('ignores duplicate bank Signals safely', async () => {
    const { result } = await runWorkflow(
      { mortgageDelayPolls: 1 },
      {
        during: async (handle) => {
          const event = {
            providerEventId: 'dup-1',
            accountId: 'acct-mortgage',
            eventType: 'mortgage.payment.updated',
            providerType: 'BANK' as const,
          };
          await handle.signal(bankEventReceived, event);
          await handle.signal(bankEventReceived, event);
          await handle.signal(bankEventReceived, event);
        },
      },
    );
    expect(result.outcome).toBe('COMPLETED');
  });

  it('ignores unrelated / wrong-provider Signals', async () => {
    const { result } = await runWorkflow(
      { mortgageDelayPolls: 1 },
      {
        during: async (handle) => {
          await handle.signal(bankEventReceived, {
            providerEventId: 'wrong-provider',
            accountId: 'acct-broker',
            eventType: 'brokerage.order.updated',
            providerType: 'BROKERAGE',
          });
          await handle.signal(brokerageEventReceived, {
            providerEventId: 'bankish',
            accountId: 'acct-mortgage',
            eventType: 'mortgage.payment.updated',
            providerType: 'BANK',
          });
        },
      },
    );
    expect(result.outcome).toBe('COMPLETED');
  });

  it('payment reversal pauses strategy', async () => {
    const { result, activities } = await runWorkflow({ reversePayment: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.PAYMENT_REVERSED);
    expect(activities.calls.some((c) => c.name === 'pauseStrategyWithException')).toBe(true);
  });

  it('insufficient credit skips with reason', async () => {
    const { result } = await runWorkflow({
      helocWaitCreditCents: '100000',
      newlyAvailableCreditCents: '0',
      drawAmountCents: '0',
      principalRepaidCents: '100000',
    });
    expect(result.outcome).toBe('SKIPPED');
    expect(result.failureCode).toBe(Codes.INSUFFICIENT_CREDIT);
  });

  it('monthly cap produces skipped zero-draw path', async () => {
    const { result } = await runWorkflow({
      userMonthlyCapCents: '0',
      drawAmountCents: '0',
      newlyAvailableCreditCents: '100000',
      helocWaitCreditCents: '100000',
    });
    expect(result.outcome).toBe('SKIPPED');
    expect(result.failureCode).toBe(Codes.MONTHLY_CAP);
  });

  it('platform cap path skips when draw is zero', async () => {
    const { result } = await runWorkflow({
      drawAmountCents: '0',
      newlyAvailableCreditCents: '100000',
      helocWaitCreditCents: '100000',
      principalRepaidCents: '100000',
      userMonthlyCapCents: '500000',
    });
    expect(result.outcome).toBe('SKIPPED');
    expect(result.failureCode).toBe(Codes.NO_DRAW_CAPACITY);
  });

  it('amount below minimum skips', async () => {
    const { result, activities } = await runWorkflow({ drawAmountCents: '50' });
    expect(result.outcome).toBe('SKIPPED');
    expect(result.failureCode).toBe(Codes.AMOUNT_BELOW_MINIMUM);
    expect(activities.calls.some((c) => c.name === 'skipCycle')).toBe(true);
  });

  it('HELOC draw timeout after success preserves provider refs', async () => {
    const { result } = await runWorkflow({ drawConfirmTimeout: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.HELOC_DRAW_TIMEOUT);
    expect(result.providerRefs.helocDrawId).toBe('draw-1');
  });

  it('transfer timeout after success preserves provider refs', async () => {
    const { result } = await runWorkflow({ transferConfirmTimeout: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.TRANSFER_TIMEOUT);
    expect(result.providerRefs.providerTransferId).toBe('xfer-1');
    expect(result.providerRefs.providerDepositId).toBe('dep-1');
  });

  it('order timeout after success preserves provider refs', async () => {
    const { result } = await runWorkflow({ orderConfirmTimeout: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.ORDER_TIMEOUT);
    expect(result.providerRefs.providerOrderId).toBe('ord-1');
  });

  it('order rejection pauses', async () => {
    const { result } = await runWorkflow({ rejectOrder: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.ORDER_REJECTED);
  });

  it('partial fill pauses', async () => {
    const { result } = await runWorkflow({ partialFill: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.PARTIAL_FILL);
  });

  it('reconciliation mismatch pauses', async () => {
    const { result } = await runWorkflow({ failReconcile: true });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.RECONCILIATION_FAILED);
  });

  it('14-day mortgage timeout pauses', async () => {
    const { result } = await runWorkflow({ mortgageDelayPolls: 10_000 });
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.MORTGAGE_PAYMENT_TIMEOUT);
  });

  it('strategy paused during mortgage wait', async () => {
    const { result } = await runWorkflow(
      { mortgageDelayPolls: 10_000 },
      {
        during: async (handle) => {
          await testEnv.sleep('1 hour');
          await handle.signal(strategyPaused, {
            reasonCode: 'USER_PAUSE',
            message: 'User paused strategy',
          });
        },
      },
    );
    expect(result.outcome).toBe('PAUSED');
    expect(result.failureCode).toBe(Codes.STRATEGY_PAUSED);
  });

  it('strategy paused after draw preserves provider refs', async () => {
    let entered = false;
    let release = false;
    const taskQueue = `mc-pause-draw-${crypto.randomUUID()}`;
    const activities = createStubActivities({
      onDrawConfirmEntered: () => {
        entered = true;
      },
      holdAfterDrawConfirm: { released: () => release },
    });
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(monthlyConversionWorkflow, {
        taskQueue,
        workflowId: `pause-after-draw-${crypto.randomUUID()}`,
        args: [defaultInput],
      });

      for (let i = 0; i < 200 && !entered; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(entered).toBe(true);
      await handle.signal(strategyPaused, {
        reasonCode: 'OPS_PAUSE',
        message: 'Paused after draw',
      });
      release = true;
      const result = await handle.result();
      expect(result.outcome).toBe('PAUSED');
      expect(result.failureCode).toBe(Codes.STRATEGY_PAUSED);
      expect(result.providerRefs.helocDrawId).toBe('draw-1');
    });
  });

  it('resolves ambiguous HELOC draw via lookup', async () => {
    const { result, activities } = await runWorkflow({ ambiguousDraw: true });
    expect(result.outcome).toBe('COMPLETED');
    expect(activities.calls.some((c) => c.name === 'resolveAmbiguousHelocDraw')).toBe(true);
  });

  it('worker restart / replay remains deterministic', async () => {
    const taskQueue = `mc-replay-${crypto.randomUUID()}`;
    const activities = createStubActivities();
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });

    const history = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(monthlyConversionWorkflow, {
        taskQueue,
        workflowId: `replay-${crypto.randomUUID()}`,
        args: [defaultInput],
      });
      const result = await handle.result();
      expect(result.outcome).toBe('COMPLETED');
      return handle.fetchHistory();
    });

    await Worker.runReplayHistory({ workflowsPath }, history);
  });

  it('exposes status and progress queries', async () => {
    const taskQueue = `mc-query-${crypto.randomUUID()}`;
    const activities = createStubActivities({ mortgageDelayPolls: 2 });
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start(monthlyConversionWorkflow, {
        taskQueue,
        workflowId: `query-${crypto.randomUUID()}`,
        args: [defaultInput],
      });
      await testEnv.sleep('1 hour');
      const status: MonthlyConversionStatus = await handle.query(getStatus);
      expect(status.phase).toBe('WAITING_FOR_MORTGAGE');
      expect(status.cycleId).toBe('cycle-1');
      const wait = await handle.query(getCurrentWaitReason);
      expect(wait).toBe('MORTGAGE_PAYMENT');

      await handle.signal(bankEventReceived, {
        providerEventId: 'q-1',
        accountId: 'acct-mortgage',
        eventType: 'mortgage.payment.updated',
        providerType: 'BANK',
      });
      await testEnv.sleep('6 hours');
      await handle.signal(bankEventReceived, {
        providerEventId: 'q-2',
        accountId: 'acct-mortgage',
        eventType: 'mortgage.payment.updated',
        providerType: 'BANK',
      });
      const result = await handle.result();
      expect(result.outcome).toBe('COMPLETED');
    });
  });
});
