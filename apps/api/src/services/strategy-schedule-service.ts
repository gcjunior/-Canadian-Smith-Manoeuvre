import {
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  type Client,
  type ScheduleDescription,
  type ScheduleOptions,
  type ScheduleUpdateOptions,
  type ScheduleOptionsStartWorkflowAction,
  type Workflow,
} from '@temporalio/client';

import type { Repositories } from '@csm/database';
import { ALERT_CODES, csmMetrics, emitAlert, type Logger } from '@csm/observability';
import {
  buildHelocInterestCalendarSpecs,
  buildMonthlyConversionCalendarSpecs,
  helocInterestScheduleId,
  strategyScheduleId,
} from '@csm/domain';

/** Explicit catch-up after downtime (not the server default). */
export const STRATEGY_SCHEDULE_CATCHUP_WINDOW = '3 days';

export const STRATEGY_SCHEDULE_OVERLAP = ScheduleOverlapPolicy.SKIP;

export interface StrategyScheduleTarget {
  tenantId: string;
  strategyId: string;
  timezone: string;
  expectedPaymentDay: number;
  expectedInterestChargeDay: number;
  correlationId: string;
  paused?: boolean;
  simulatorScenarioId?: string;
}

export interface ScheduleDescribeResult {
  scheduleId: string;
  paused: boolean;
  note?: string;
  timezone?: string;
  overlap?: string;
  catchupWindow?: string | number;
  nextActionTimes?: Date[];
  raw?: ScheduleDescription;
}

export interface ReconcileScheduleResult {
  strategyId: string;
  action:
    | 'noop'
    | 'created_missing_schedule'
    | 'created_missing_db_ref'
    | 'updated'
    | 'paused'
    | 'unpaused'
    | 'deleted'
    | 'error';
  detail?: string;
}

export interface TemporalScheduleGateway {
  create(options: ScheduleOptions): Promise<void>;
  update(
    scheduleId: string,
    updater: (
      previous: ScheduleDescription,
    ) => ScheduleUpdateOptions<ScheduleOptionsStartWorkflowAction<Workflow>>,
  ): Promise<void>;
  pause(scheduleId: string, note: string): Promise<void>;
  unpause(scheduleId: string, note: string): Promise<void>;
  delete(scheduleId: string): Promise<void>;
  describe(scheduleId: string): Promise<ScheduleDescription | null>;
}

export function createTemporalScheduleGateway(client: Client): TemporalScheduleGateway {
  return {
    async create(options) {
      await client.schedule.create(options);
    },
    async update(scheduleId, updater) {
      await client.schedule.getHandle(scheduleId).update(updater);
    },
    async pause(scheduleId, note) {
      await client.schedule.getHandle(scheduleId).pause(note);
    },
    async unpause(scheduleId, note) {
      await client.schedule.getHandle(scheduleId).unpause(note);
    },
    async delete(scheduleId) {
      await client.schedule.getHandle(scheduleId).delete();
    },
    async describe(scheduleId) {
      try {
        return await client.schedule.getHandle(scheduleId).describe();
      } catch (error) {
        if (error instanceof ScheduleNotFoundError) {
          return null;
        }
        throw error;
      }
    },
  };
}

function toCalendarSpecs(specs: ReturnType<typeof buildMonthlyConversionCalendarSpecs>) {
  return specs.map((spec) => ({
    dayOfMonth: spec.dayOfMonth,
    hour: spec.hour,
    minute: spec.minute,
    second: spec.second,
    ...(spec.month !== undefined ? { month: spec.month as 'MARCH' } : {}),
    ...(spec.comment !== undefined ? { comment: spec.comment } : {}),
  }));
}

export class StrategyScheduleService {
  constructor(
    private readonly gateway: TemporalScheduleGateway,
    private readonly repos: Repositories,
    private readonly taskQueue: string,
    private readonly namespace: string,
    private readonly logger: Logger,
  ) {}

  static fromClient(
    client: Client,
    repos: Repositories,
    taskQueue: string,
    namespace: string,
    logger: Logger,
  ): StrategyScheduleService {
    return new StrategyScheduleService(
      createTemporalScheduleGateway(client),
      repos,
      taskQueue,
      namespace,
      logger,
    );
  }

  scheduleIdFor(tenantId: string, strategyId: string): string {
    return strategyScheduleId(tenantId, strategyId);
  }

  interestScheduleIdFor(tenantId: string, strategyId: string): string {
    return helocInterestScheduleId({ tenantId, strategyId });
  }

  buildScheduleOptions(target: StrategyScheduleTarget): ScheduleOptions {
    const scheduleId = this.scheduleIdFor(target.tenantId, target.strategyId);
    const calendars = toCalendarSpecs(
      buildMonthlyConversionCalendarSpecs(target.expectedPaymentDay),
    );

    return {
      scheduleId,
      spec: {
        calendars,
        timezone: target.timezone,
        jitter: '30 seconds',
      },
      action: {
        type: 'startWorkflow',
        workflowType: 'monthlyConversionScheduleKickoff',
        taskQueue: this.taskQueue,
        args: [
          {
            tenantId: target.tenantId,
            strategyId: target.strategyId,
            timezone: target.timezone,
            expectedPaymentDay: target.expectedPaymentDay,
          },
        ],
        memo: {
          tenantId: target.tenantId,
          strategyId: target.strategyId,
          correlationId: target.correlationId,
        },
      },
      policies: {
        overlap: STRATEGY_SCHEDULE_OVERLAP,
        catchupWindow: STRATEGY_SCHEDULE_CATCHUP_WINDOW,
        pauseOnFailure: false,
      },
      state: {
        paused: target.paused ?? false,
        note: target.paused
          ? 'Paused with strategy'
          : 'Monthly conversion check — not proof of mortgage settlement',
      },
      memo: {
        tenantId: target.tenantId,
        strategyId: target.strategyId,
        correlationId: target.correlationId,
      },
    };
  }

  buildInterestScheduleOptions(target: StrategyScheduleTarget): ScheduleOptions {
    const scheduleId = this.interestScheduleIdFor(target.tenantId, target.strategyId);
    const calendars = toCalendarSpecs(
      buildHelocInterestCalendarSpecs({
        expectedInterestChargeDay: target.expectedInterestChargeDay,
      }),
    );

    return {
      scheduleId,
      spec: {
        calendars,
        timezone: target.timezone,
        jitter: '30 seconds',
      },
      action: {
        type: 'startWorkflow',
        workflowType: 'helocInterestScheduleKickoff',
        taskQueue: this.taskQueue,
        args: [
          {
            tenantId: target.tenantId,
            strategyId: target.strategyId,
            timezone: target.timezone,
            expectedInterestChargeDay: target.expectedInterestChargeDay,
            ...(target.simulatorScenarioId !== undefined
              ? { simulatorScenarioId: target.simulatorScenarioId }
              : {}),
          },
        ],
        memo: {
          tenantId: target.tenantId,
          strategyId: target.strategyId,
          correlationId: target.correlationId,
        },
      },
      policies: {
        overlap: STRATEGY_SCHEDULE_OVERLAP,
        catchupWindow: STRATEGY_SCHEDULE_CATCHUP_WINDOW,
        pauseOnFailure: false,
      },
      state: {
        paused: target.paused ?? false,
        note: target.paused
          ? 'Paused with strategy'
          : 'HELOC interest check — not proof of interest charge',
      },
      memo: {
        tenantId: target.tenantId,
        strategyId: target.strategyId,
        correlationId: target.correlationId,
      },
    };
  }

  async createStrategySchedule(target: StrategyScheduleTarget): Promise<{
    scheduleId: string;
    interestScheduleId: string;
    created: boolean;
  }> {
    const conversionCreated = await this.ensureSchedule(
      this.buildScheduleOptions(target),
      (t) => this.updateConversionScheduleOnly(t),
      target,
    );
    const interestCreated = await this.ensureSchedule(
      this.buildInterestScheduleOptions(target),
      (t) => this.updateInterestScheduleOnly(t),
      target,
    );
    const scheduleId = this.scheduleIdFor(target.tenantId, target.strategyId);
    const interestScheduleId = this.interestScheduleIdFor(target.tenantId, target.strategyId);
    await this.persistRef(target, scheduleId, interestScheduleId, target.paused ?? false);
    this.logger.info(
      {
        scheduleId,
        interestScheduleId,
        strategyId: target.strategyId,
        correlationId: target.correlationId,
      },
      'created strategy schedules',
    );
    return {
      scheduleId,
      interestScheduleId,
      created: conversionCreated || interestCreated,
    };
  }

  async updateStrategySchedule(target: StrategyScheduleTarget): Promise<{
    scheduleId: string;
    interestScheduleId: string;
  }> {
    await this.updateConversionScheduleOnly(target);
    await this.updateInterestScheduleOnly(target);
    const scheduleId = this.scheduleIdFor(target.tenantId, target.strategyId);
    const interestScheduleId = this.interestScheduleIdFor(target.tenantId, target.strategyId);
    await this.persistRef(target, scheduleId, interestScheduleId, target.paused ?? false);
    this.logger.info(
      {
        scheduleId,
        interestScheduleId,
        strategyId: target.strategyId,
        correlationId: target.correlationId,
      },
      'updated strategy schedules',
    );
    return { scheduleId, interestScheduleId };
  }

  async pauseStrategySchedule(
    tenantId: string,
    strategyId: string,
    correlationId: string,
    note = 'Strategy paused',
  ): Promise<void> {
    await this.pauseOne(this.scheduleIdFor(tenantId, strategyId), note, correlationId);
    await this.pauseOne(this.interestScheduleIdFor(tenantId, strategyId), note, correlationId);
    await this.repos.strategySchedules.markPaused(tenantId, strategyId, true);
  }

  async resumeStrategySchedule(
    tenantId: string,
    strategyId: string,
    correlationId: string,
    note = 'Strategy resumed',
  ): Promise<void> {
    const conversionId = this.scheduleIdFor(tenantId, strategyId);
    const interestId = this.interestScheduleIdFor(tenantId, strategyId);
    const conversionMissing = await this.unpauseOrMissing(conversionId, note);
    const interestMissing = await this.unpauseOrMissing(interestId, note);

    if (conversionMissing || interestMissing) {
      const strategy = await this.repos.strategies.findById(tenantId, strategyId);
      if (strategy) {
        await this.createStrategySchedule({
          tenantId,
          strategyId,
          timezone: strategy.timezone,
          expectedPaymentDay: strategy.expectedPaymentDay,
          expectedInterestChargeDay: strategy.expectedInterestChargeDay,
          correlationId,
          paused: false,
        });
        return;
      }
    }
    await this.repos.strategySchedules.markPaused(tenantId, strategyId, false);
  }

  async deleteStrategySchedule(
    tenantId: string,
    strategyId: string,
    correlationId: string,
  ): Promise<void> {
    await this.deleteOne(this.scheduleIdFor(tenantId, strategyId), correlationId);
    await this.deleteOne(this.interestScheduleIdFor(tenantId, strategyId), correlationId);
    await this.repos.strategySchedules.softDelete(tenantId, strategyId);
  }

  async describeStrategySchedule(
    tenantId: string,
    strategyId: string,
  ): Promise<ScheduleDescribeResult | null> {
    const scheduleId = this.scheduleIdFor(tenantId, strategyId);
    const desc = await this.gateway.describe(scheduleId);
    if (!desc) {
      return null;
    }
    return {
      scheduleId,
      paused: desc.state.paused,
      ...(desc.state.note !== undefined ? { note: desc.state.note } : {}),
      ...(desc.spec.timezone !== undefined ? { timezone: desc.spec.timezone } : {}),
      ...(desc.policies.overlap !== undefined ? { overlap: String(desc.policies.overlap) } : {}),
      ...(desc.policies.catchupWindow !== undefined
        ? { catchupWindow: desc.policies.catchupWindow }
        : {}),
      nextActionTimes: desc.info.nextActionTimes,
      raw: desc,
    };
  }

  async reconcileStrategySchedules(
    tenantId: string,
    correlationId: string,
  ): Promise<ReconcileScheduleResult[]> {
    const results: ReconcileScheduleResult[] = [];
    const strategies = await this.repos.strategies.listForTenant(tenantId);
    const refs = await this.repos.strategySchedules.listActiveRefs(tenantId);
    const refByStrategy = new Map(refs.map((r) => [r.strategyId, r]));

    for (const strategy of strategies) {
      const ref = refByStrategy.get(strategy.id);
      try {
        if (strategy.state === 'ACTIVE' || strategy.state === 'PAUSED') {
          const wantPaused = strategy.state === 'PAUSED';
          const described = await this.describeStrategySchedule(tenantId, strategy.id);
          const interestDescribed = await this.gateway.describe(
            this.interestScheduleIdFor(tenantId, strategy.id),
          );
          if (!described || !interestDescribed) {
            emitAlert(this.logger, ALERT_CODES.SCHEDULE_MISSING, {
              correlationId,
              tenantId,
              strategyId: strategy.id,
              conversionPresent: Boolean(described),
              interestPresent: Boolean(interestDescribed),
            });
            csmMetrics.scheduleReconciliationFailures.add(1, {
              reason: 'missing_schedule',
            });
            await this.createStrategySchedule({
              tenantId,
              strategyId: strategy.id,
              timezone: strategy.timezone,
              expectedPaymentDay: strategy.expectedPaymentDay,
              expectedInterestChargeDay: strategy.expectedInterestChargeDay,
              correlationId,
              paused: wantPaused,
            });
            results.push({
              strategyId: strategy.id,
              action: 'created_missing_schedule',
              detail: ref
                ? 'db ref existed but Temporal Schedule missing'
                : 'schedule and ref missing',
            });
            continue;
          }
          if (described && !ref) {
            await this.persistRef(
              {
                tenantId,
                strategyId: strategy.id,
                timezone: strategy.timezone,
                expectedPaymentDay: strategy.expectedPaymentDay,
                expectedInterestChargeDay: strategy.expectedInterestChargeDay,
                correlationId,
              },
              described.scheduleId,
              this.interestScheduleIdFor(tenantId, strategy.id),
              described.paused,
            );
            results.push({ strategyId: strategy.id, action: 'created_missing_db_ref' });
          }
          if (described.paused !== wantPaused) {
            if (wantPaused) {
              await this.pauseStrategySchedule(tenantId, strategy.id, correlationId);
              results.push({ strategyId: strategy.id, action: 'paused' });
            } else {
              await this.resumeStrategySchedule(tenantId, strategy.id, correlationId);
              results.push({ strategyId: strategy.id, action: 'unpaused' });
            }
            continue;
          }
          const needsUpdate =
            strategy.timezone !== ref?.timezone ||
            strategy.expectedPaymentDay !== ref?.expectedPaymentDay ||
            strategy.expectedInterestChargeDay !== ref?.expectedInterestChargeDay ||
            !ref?.temporalInterestScheduleId;
          if (needsUpdate) {
            await this.updateStrategySchedule({
              tenantId,
              strategyId: strategy.id,
              timezone: strategy.timezone,
              expectedPaymentDay: strategy.expectedPaymentDay,
              expectedInterestChargeDay: strategy.expectedInterestChargeDay,
              correlationId,
              paused: wantPaused,
            });
            results.push({ strategyId: strategy.id, action: 'updated' });
            continue;
          }
          results.push({ strategyId: strategy.id, action: 'noop' });
        } else if (strategy.state === 'CLOSED' || strategy.state === 'DRAFT') {
          const described = await this.describeStrategySchedule(tenantId, strategy.id);
          const interestDescribed = await this.gateway.describe(
            this.interestScheduleIdFor(tenantId, strategy.id),
          );
          if (described || interestDescribed || ref) {
            await this.deleteStrategySchedule(tenantId, strategy.id, correlationId);
            results.push({ strategyId: strategy.id, action: 'deleted' });
          } else {
            results.push({ strategyId: strategy.id, action: 'noop' });
          }
        }
      } catch (error) {
        csmMetrics.scheduleReconciliationFailures.add(1, { reason: 'error' });
        emitAlert(this.logger, ALERT_CODES.SCHEDULE_MISSING, {
          correlationId,
          tenantId,
          strategyId: strategy.id,
          detail: error instanceof Error ? error.message : String(error),
        });
        results.push({
          strategyId: strategy.id,
          action: 'error',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const ref of refs) {
      if (strategies.some((s) => s.id === ref.strategyId)) {
        continue;
      }
      await this.deleteStrategySchedule(tenantId, ref.strategyId, correlationId);
      results.push({
        strategyId: ref.strategyId,
        action: 'deleted',
        detail: 'orphan db ref without strategy',
      });
    }

    return results;
  }

  private async ensureSchedule(
    options: ScheduleOptions,
    onAlreadyRunning: (target: StrategyScheduleTarget) => Promise<unknown>,
    target: StrategyScheduleTarget,
  ): Promise<boolean> {
    try {
      await this.gateway.create(options);
      return true;
    } catch (error) {
      if (error instanceof ScheduleAlreadyRunning) {
        await onAlreadyRunning(target);
        return false;
      }
      throw error;
    }
  }

  private async updateConversionScheduleOnly(target: StrategyScheduleTarget): Promise<void> {
    const scheduleId = this.scheduleIdFor(target.tenantId, target.strategyId);
    const options = this.buildScheduleOptions(target);
    await this.updateOrCreate(scheduleId, options, target);
  }

  private async updateInterestScheduleOnly(target: StrategyScheduleTarget): Promise<void> {
    const scheduleId = this.interestScheduleIdFor(target.tenantId, target.strategyId);
    const options = this.buildInterestScheduleOptions(target);
    await this.updateOrCreate(scheduleId, options, target);
  }

  private async updateOrCreate(
    scheduleId: string,
    options: ScheduleOptions,
    target: StrategyScheduleTarget,
  ): Promise<void> {
    try {
      await this.gateway.update(scheduleId, () => ({
        spec: options.spec,
        action: options.action,
        policies: options.policies ?? {
          overlap: STRATEGY_SCHEDULE_OVERLAP,
          catchupWindow: STRATEGY_SCHEDULE_CATCHUP_WINDOW,
          pauseOnFailure: false,
        },
        state: {
          paused: target.paused ?? false,
          ...(options.state?.note !== undefined ? { note: options.state.note } : {}),
        },
      }));
    } catch (error) {
      if (error instanceof ScheduleNotFoundError) {
        await this.gateway.create(options);
      } else {
        throw error;
      }
    }
  }

  private async pauseOne(scheduleId: string, note: string, correlationId: string): Promise<void> {
    try {
      await this.gateway.pause(scheduleId, note);
    } catch (error) {
      if (!(error instanceof ScheduleNotFoundError)) {
        throw error;
      }
      this.logger.warn({ scheduleId, correlationId }, 'pause: schedule not found');
    }
  }

  private async unpauseOrMissing(scheduleId: string, note: string): Promise<boolean> {
    try {
      await this.gateway.unpause(scheduleId, note);
      return false;
    } catch (error) {
      if (error instanceof ScheduleNotFoundError) {
        return true;
      }
      throw error;
    }
  }

  private async deleteOne(scheduleId: string, correlationId: string): Promise<void> {
    try {
      await this.gateway.delete(scheduleId);
    } catch (error) {
      if (error instanceof ScheduleNotFoundError) {
        this.logger.warn({ scheduleId, correlationId }, 'delete: schedule already absent');
      } else {
        try {
          await this.gateway.pause(scheduleId, 'Strategy closed — permanent pause fallback');
        } catch {
          /* ignore */
        }
        this.logger.error(
          { scheduleId, err: String(error), correlationId },
          'delete schedule failed; attempted permanent pause',
        );
      }
    }
  }

  private async persistRef(
    target: StrategyScheduleTarget,
    scheduleId: string,
    interestScheduleId: string,
    paused: boolean,
  ): Promise<void> {
    await this.repos.strategySchedules.upsert(target.tenantId, {
      strategyId: target.strategyId,
      temporalScheduleId: scheduleId,
      temporalInterestScheduleId: interestScheduleId,
      temporalNamespace: this.namespace,
      paused,
      timezone: target.timezone,
      expectedPaymentDay: target.expectedPaymentDay,
      expectedInterestChargeDay: target.expectedInterestChargeDay,
    });
  }
}
