import { WorkflowNotFoundError, type Client } from '@temporalio/client';
import type { Logger } from '@csm/observability';
import type { Repositories } from '@csm/database';

import {
  StrategyScheduleService,
  type ReconcileScheduleResult,
  type ScheduleDescribeResult,
  type StrategyScheduleTarget,
} from './strategy-schedule-service.js';

function monthlyConversionWorkflowId(input: {
  tenantId: string;
  strategyId: string;
  paymentPeriod: string;
}): string {
  return `monthly-conversion/${input.tenantId}/${input.strategyId}/${input.paymentPeriod}`;
}

function helocInterestWorkflowId(input: {
  tenantId: string;
  strategyId: string;
  interestPeriod: string;
}): string {
  return `heloc-interest/${input.tenantId}/${input.strategyId}/${input.interestPeriod}`;
}

/** Mirrors workflow Signal tip — keep tiny; never full provider payloads. */
export interface ConversionEventSignal {
  providerEventId: string;
  accountId: string;
  eventType: string;
  providerType: 'BANK' | 'BROKERAGE';
  providerResourceId?: string;
  occurredAt?: string;
}

/** Same tip shape as conversion — wakes HelocInterestPaymentWorkflow only. */
export type InterestEventSignal = ConversionEventSignal;

const TERMINAL_CYCLE_STATES = new Set(['COMPLETED', 'SKIPPED', 'FAILED', 'PAUSED']);
const TERMINAL_INTEREST_CYCLE_STATES = new Set(['COMPLETED', 'FAILED', 'PAUSED']);

export type SignalConversionOutcome =
  | { status: 'SIGNALED'; paymentPeriod: string }
  | { status: 'NO_CYCLE'; paymentPeriod?: string }
  | { status: 'WORKFLOW_NOT_RUNNING'; paymentPeriod?: string }
  | { status: 'CYCLE_TERMINAL'; paymentPeriod: string };

export type SignalInterestOutcome =
  | { status: 'SIGNALED'; interestPeriod: string }
  | { status: 'NO_CYCLE'; interestPeriod?: string }
  | { status: 'WORKFLOW_NOT_RUNNING'; interestPeriod?: string }
  | { status: 'CYCLE_TERMINAL'; interestPeriod: string };

/**
 * Temporal façade for the API process.
 * Schedule lifecycle lives here — HTTP handlers never touch Temporal directly.
 */
export class TemporalAppService {
  readonly schedules: StrategyScheduleService;

  constructor(
    private readonly temporal: Client,
    private readonly repos: Repositories,
    taskQueue: string,
    namespace: string,
    private readonly logger: Logger,
  ) {
    this.schedules = StrategyScheduleService.fromClient(
      temporal,
      repos,
      taskQueue,
      namespace,
      logger,
    );
  }

  async createStrategySchedule(target: StrategyScheduleTarget) {
    return this.schedules.createStrategySchedule(target);
  }

  async updateStrategySchedule(target: StrategyScheduleTarget) {
    return this.schedules.updateStrategySchedule(target);
  }

  async pauseStrategySchedule(
    tenantId: string,
    strategyId: string,
    correlationId: string,
    note?: string,
  ) {
    return this.schedules.pauseStrategySchedule(tenantId, strategyId, correlationId, note);
  }

  async resumeStrategySchedule(
    tenantId: string,
    strategyId: string,
    correlationId: string,
    note?: string,
  ) {
    return this.schedules.resumeStrategySchedule(tenantId, strategyId, correlationId, note);
  }

  async deleteStrategySchedule(tenantId: string, strategyId: string, correlationId: string) {
    return this.schedules.deleteStrategySchedule(tenantId, strategyId, correlationId);
  }

  async describeStrategySchedule(
    tenantId: string,
    strategyId: string,
  ): Promise<ScheduleDescribeResult | null> {
    return this.schedules.describeStrategySchedule(tenantId, strategyId);
  }

  async reconcileStrategySchedules(
    tenantId: string,
    correlationId: string,
  ): Promise<ReconcileScheduleResult[]> {
    return this.schedules.reconcileStrategySchedules(tenantId, correlationId);
  }

  /**
   * Wake an already-scheduled MonthlyConversionWorkflow with a small Signal tip.
   * Never SignalWithStart — webhooks supplement polling; Schedules own kickoff.
   * Never passes full webhook payloads into Workflow history.
   */
  async signalConversionEvent(
    tenantId: string,
    strategyId: string,
    signalName: 'bankEventReceived' | 'brokerageEventReceived',
    event: ConversionEventSignal,
    options?: { paymentPeriod?: string },
  ): Promise<SignalConversionOutcome> {
    if (options?.paymentPeriod) {
      return this.signalPeriod(tenantId, strategyId, options.paymentPeriod, signalName, event);
    }

    const cycles = await this.repos.cycles.listForStrategy(tenantId, strategyId);
    const open = cycles.filter((c) => !TERMINAL_CYCLE_STATES.has(c.state));
    if (open.length === 0) {
      const terminal = cycles.find((c) => TERMINAL_CYCLE_STATES.has(c.state));
      if (terminal) {
        return { status: 'CYCLE_TERMINAL', paymentPeriod: terminal.paymentPeriod };
      }
      return { status: 'NO_CYCLE' };
    }

    let signaledPeriod: string | undefined;
    let notRunningPeriod: string | undefined;
    for (const cycle of open) {
      const outcome = await this.signalPeriod(
        tenantId,
        strategyId,
        cycle.paymentPeriod,
        signalName,
        event,
      );
      if (outcome.status === 'SIGNALED') {
        signaledPeriod = cycle.paymentPeriod;
      } else if (outcome.status === 'WORKFLOW_NOT_RUNNING') {
        notRunningPeriod = cycle.paymentPeriod;
      } else if (outcome.status === 'CYCLE_TERMINAL' && !signaledPeriod) {
        return outcome;
      }
    }
    if (signaledPeriod !== undefined) {
      return { status: 'SIGNALED', paymentPeriod: signaledPeriod };
    }
    if (notRunningPeriod !== undefined) {
      return { status: 'WORKFLOW_NOT_RUNNING', paymentPeriod: notRunningPeriod };
    }
    return { status: 'NO_CYCLE' };
  }

  /**
   * Wake an already-scheduled HelocInterestPaymentWorkflow with a small Signal tip.
   * Never SignalWithStart — Schedules own interest kickoff.
   */
  async signalInterestEvent(
    tenantId: string,
    strategyId: string,
    event: InterestEventSignal,
    options?: { interestPeriod?: string },
  ): Promise<SignalInterestOutcome> {
    if (options?.interestPeriod) {
      return this.signalInterestPeriod(tenantId, strategyId, options.interestPeriod, event);
    }

    const cycles = await this.repos.interestCycles.listForStrategy(tenantId, strategyId);
    const open = cycles.filter((c) => !TERMINAL_INTEREST_CYCLE_STATES.has(c.state));
    if (open.length === 0) {
      const terminal = cycles.find((c) => TERMINAL_INTEREST_CYCLE_STATES.has(c.state));
      if (terminal) {
        return { status: 'CYCLE_TERMINAL', interestPeriod: terminal.interestPeriod };
      }
      return { status: 'NO_CYCLE' };
    }

    let signaledPeriod: string | undefined;
    let notRunningPeriod: string | undefined;
    for (const cycle of open) {
      const outcome = await this.signalInterestPeriod(
        tenantId,
        strategyId,
        cycle.interestPeriod,
        event,
      );
      if (outcome.status === 'SIGNALED') {
        signaledPeriod = cycle.interestPeriod;
      } else if (outcome.status === 'WORKFLOW_NOT_RUNNING') {
        notRunningPeriod = cycle.interestPeriod;
      } else if (outcome.status === 'CYCLE_TERMINAL' && !signaledPeriod) {
        return outcome;
      }
    }
    if (signaledPeriod !== undefined) {
      return { status: 'SIGNALED', interestPeriod: signaledPeriod };
    }
    if (notRunningPeriod !== undefined) {
      return { status: 'WORKFLOW_NOT_RUNNING', interestPeriod: notRunningPeriod };
    }
    return { status: 'NO_CYCLE' };
  }

  private async signalPeriod(
    tenantId: string,
    strategyId: string,
    paymentPeriod: string,
    signalName: 'bankEventReceived' | 'brokerageEventReceived',
    event: ConversionEventSignal,
  ): Promise<SignalConversionOutcome> {
    const cycle = await this.repos.cycles.findByPeriod(tenantId, strategyId, paymentPeriod);
    if (!cycle) {
      return { status: 'NO_CYCLE', paymentPeriod };
    }
    if (TERMINAL_CYCLE_STATES.has(cycle.state)) {
      return { status: 'CYCLE_TERMINAL', paymentPeriod };
    }

    const workflowId = monthlyConversionWorkflowId({ tenantId, strategyId, paymentPeriod });
    try {
      await this.temporal.workflow.getHandle(workflowId).signal(signalName, event);
      return { status: 'SIGNALED', paymentPeriod };
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        this.logger.warn({ workflowId, signalName }, 'conversion workflow not found for signal');
        return { status: 'WORKFLOW_NOT_RUNNING', paymentPeriod };
      }
      const name =
        error instanceof Error
          ? error.name
          : typeof error === 'object' && error && 'name' in error
            ? String((error as { name: unknown }).name)
            : '';
      if (name.includes('WorkflowExecutionAlreadyCompleted') || name.includes('WorkflowNotFound')) {
        this.logger.warn({ workflowId, signalName, name }, 'conversion workflow not signalable');
        return { status: 'WORKFLOW_NOT_RUNNING', paymentPeriod };
      }
      throw error;
    }
  }

  private async signalInterestPeriod(
    tenantId: string,
    strategyId: string,
    interestPeriod: string,
    event: InterestEventSignal,
  ): Promise<SignalInterestOutcome> {
    const cycle = await this.repos.interestCycles.findByPeriod(
      tenantId,
      strategyId,
      interestPeriod,
    );
    if (!cycle) {
      return { status: 'NO_CYCLE', interestPeriod };
    }
    if (TERMINAL_INTEREST_CYCLE_STATES.has(cycle.state)) {
      return { status: 'CYCLE_TERMINAL', interestPeriod };
    }

    const workflowId = helocInterestWorkflowId({ tenantId, strategyId, interestPeriod });
    try {
      await this.temporal.workflow.getHandle(workflowId).signal('interestBankEventReceived', event);
      return { status: 'SIGNALED', interestPeriod };
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        this.logger.warn({ workflowId }, 'interest workflow not found for signal');
        return { status: 'WORKFLOW_NOT_RUNNING', interestPeriod };
      }
      const name =
        error instanceof Error
          ? error.name
          : typeof error === 'object' && error && 'name' in error
            ? String((error as { name: unknown }).name)
            : '';
      if (name.includes('WorkflowExecutionAlreadyCompleted') || name.includes('WorkflowNotFound')) {
        this.logger.warn({ workflowId, name }, 'interest workflow not signalable');
        return { status: 'WORKFLOW_NOT_RUNNING', interestPeriod };
      }
      throw error;
    }
  }
}
