import { randomUUID } from 'node:crypto';

import {
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  type ScheduleDescription,
  type ScheduleOptions,
  type ScheduleUpdateOptions,
  type ScheduleOptionsStartWorkflowAction,
  type Workflow,
} from '@temporalio/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaClient,
  createRepositories,
  type PrismaClient,
  type Repositories,
} from '@csm/database';
import { createLogger } from '@csm/observability';

import {
  STRATEGY_SCHEDULE_CATCHUP_WINDOW,
  STRATEGY_SCHEDULE_OVERLAP,
  StrategyScheduleService,
  type TemporalScheduleGateway,
} from './strategy-schedule-service.js';

type Stored = {
  options: ScheduleOptions;
  paused: boolean;
  note?: string;
};

class FakeScheduleGateway implements TemporalScheduleGateway {
  readonly store = new Map<string, Stored>();
  createCalls = 0;
  updateCalls = 0;
  pauseCalls = 0;
  unpauseCalls = 0;
  deleteCalls = 0;
  triggers: string[] = [];

  async create(options: ScheduleOptions): Promise<void> {
    if (this.store.has(options.scheduleId)) {
      throw new ScheduleAlreadyRunning('already running', options.scheduleId);
    }
    this.createCalls += 1;
    const row: Stored = {
      options,
      paused: options.state?.paused ?? false,
    };
    if (options.state?.note !== undefined) {
      row.note = options.state.note;
    }
    this.store.set(options.scheduleId, row);
  }

  async update(
    scheduleId: string,
    updater: (
      previous: ScheduleDescription,
    ) => ScheduleUpdateOptions<ScheduleOptionsStartWorkflowAction<Workflow>>,
  ): Promise<void> {
    const existing = this.store.get(scheduleId);
    if (!existing) {
      throw new ScheduleNotFoundError('not found', scheduleId);
    }
    this.updateCalls += 1;
    const next = updater(this.toDescription(scheduleId, existing));
    const nextState = next.state as { paused?: boolean; note?: string };
    existing.options = {
      scheduleId: existing.options.scheduleId,
      spec: next.spec,
      action: next.action,
      policies: next.policies ?? {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: '3 days',
        pauseOnFailure: false,
      },
      ...(existing.options.memo !== undefined ? { memo: existing.options.memo } : {}),
      state: nextState,
    };
    if (nextState.paused !== undefined) {
      existing.paused = nextState.paused;
    }
    if (nextState.note !== undefined) {
      existing.note = nextState.note;
    }
  }

  async pause(scheduleId: string, note: string): Promise<void> {
    const existing = this.store.get(scheduleId);
    if (!existing) {
      throw new ScheduleNotFoundError('not found', scheduleId);
    }
    this.pauseCalls += 1;
    existing.paused = true;
    existing.note = note;
  }

  async unpause(scheduleId: string, note: string): Promise<void> {
    const existing = this.store.get(scheduleId);
    if (!existing) {
      throw new ScheduleNotFoundError('not found', scheduleId);
    }
    this.unpauseCalls += 1;
    existing.paused = false;
    existing.note = note;
  }

  async delete(scheduleId: string): Promise<void> {
    if (!this.store.has(scheduleId)) {
      throw new ScheduleNotFoundError('not found', scheduleId);
    }
    this.deleteCalls += 1;
    this.store.delete(scheduleId);
  }

  async describe(scheduleId: string): Promise<ScheduleDescription | null> {
    const existing = this.store.get(scheduleId);
    if (!existing) {
      return null;
    }
    return this.toDescription(scheduleId, existing);
  }

  trigger(scheduleId: string): void {
    const existing = this.store.get(scheduleId);
    if (!existing || existing.paused) {
      return;
    }
    this.triggers.push(scheduleId);
  }

  private toDescription(scheduleId: string, existing: Stored): ScheduleDescription {
    return {
      scheduleId,
      spec: {
        calendars: [],
        intervals: [],
        cronExpressions: [],
        skip: [],
        timezone: existing.options.spec.timezone,
        jitter: 0,
      },
      action: existing.options.action as never,
      policies: {
        overlap: existing.options.policies?.overlap ?? ScheduleOverlapPolicy.SKIP,
        catchupWindow: existing.options.policies?.catchupWindow ?? '1 day',
        pauseOnFailure: existing.options.policies?.pauseOnFailure ?? false,
      },
      state: {
        paused: existing.paused,
        note: existing.note,
      },
      info: {
        nextActionTimes: [],
        recentActions: [],
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
        runningActions: [],
        numActionsTaken: 0,
        numActionsMissedCatchupWindow: 0,
        numActionsSkippedOverlap: 0,
      },
      raw: {} as never,
      memo: existing.options.memo,
      searchAttributes: {},
    } as unknown as ScheduleDescription;
  }
}

async function provisionStrategy(_prisma: PrismaClient, repos: Repositories, slug: string) {
  const tenant = await repos.tenants.create({ slug, name: slug });
  const user = await repos.users.create(tenant.id, {
    email: `${slug}@example.com`,
    displayName: slug,
  });
  const bankConn = await repos.accounts.createConnection(tenant.id, {
    userId: user.id,
    providerType: 'BANK',
    providerConnectionId: `bank-${slug}`,
    displayAlias: 'Bank',
  });
  const brokerConn = await repos.accounts.createConnection(tenant.id, {
    userId: user.id,
    providerType: 'BROKERAGE',
    providerConnectionId: `broker-${slug}`,
    displayAlias: 'Broker',
  });
  const mortgage = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'MORTGAGE',
    displayAlias: 'Mortgage',
    providerAccountId: `m-${slug}`,
  });
  const heloc = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'HELOC',
    displayAlias: 'HELOC',
    providerAccountId: `h-${slug}`,
  });
  const bank = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'BANK_OPERATING',
    displayAlias: 'Bank',
    providerAccountId: `b-${slug}`,
  });
  const brokerage = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: brokerConn.id,
    kind: 'BROKERAGE_CASH',
    displayAlias: 'Brokerage',
    providerAccountId: `br-${slug}`,
  });
  await repos.accounts.createMortgage(tenant.id, {
    accountId: mortgage.id,
    outstandingPrincipalCents: 100_000_00n,
    contractualPaymentCents: 1_000_00n,
    expectedPaymentDay: 15,
  });
  await repos.accounts.createHeloc(tenant.id, {
    accountId: heloc.id,
    creditLimitCents: 50_000_00n,
    balanceOwedCents: 0n,
    availableCreditCents: 50_000_00n,
  });
  await repos.accounts.createOrdinaryBankAccount(tenant.id, bank.id);
  await repos.accounts.createBrokerageAccount(tenant.id, brokerage.id);

  const strategy = await repos.strategies.create(tenant.id, {
    userId: user.id,
    name: slug,
    timezone: 'America/Toronto',
    expectedPaymentDay: 15,
    mortgageAccountId: mortgage.id,
    helocAccountId: heloc.id,
    bankAccountId: bank.id,
    brokerageAccountId: brokerage.id,
    symbol: 'VCN.TO',
    userMonthlyCapCents: 200_000n,
  });
  return { tenant, strategy };
}

describe('StrategyScheduleService', () => {
  const prisma = createPrismaClient(
    process.env.DATABASE_URL ??
      'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public',
  );
  let repos: Repositories;
  let gateway: FakeScheduleGateway;
  let service: StrategyScheduleService;
  let graph: Awaited<ReturnType<typeof provisionStrategy>>;

  beforeAll(() => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';
  });

  beforeEach(async () => {
    await prisma.strategySchedule.deleteMany().catch(() => undefined);
    await prisma.strategyInvestmentPolicy.deleteMany();
    await prisma.strategy.deleteMany();
    await prisma.mortgage.deleteMany();
    await prisma.heloc.deleteMany();
    await prisma.brokerageAccount.deleteMany();
    await prisma.ordinaryBankAccount.deleteMany();
    await prisma.financialAccount.deleteMany();
    await prisma.financialConnection.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();

    repos = createRepositories(prisma);
    gateway = new FakeScheduleGateway();
    service = new StrategyScheduleService(
      gateway,
      repos,
      'smith-manoeuvre',
      'default',
      createLogger({ service: 'schedule-test', level: 'silent' }),
    );
    graph = await provisionStrategy(prisma, repos, `sch-${randomUUID().slice(0, 8)}`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const target = () => ({
    tenantId: graph.tenant.id,
    strategyId: graph.strategy.id,
    timezone: 'America/Toronto',
    expectedPaymentDay: 15,
    expectedInterestChargeDay: 1,
    correlationId: randomUUID(),
  });

  it('activation creates conversion and interest Schedules with timezone and policies', async () => {
    const result = await service.createStrategySchedule(target());
    expect(result.created).toBe(true);
    expect(gateway.createCalls).toBe(2);
    expect(gateway.store.size).toBe(2);
    const stored = gateway.store.get(result.scheduleId);
    expect(stored?.options.spec.timezone).toBe('America/Toronto');
    expect(stored?.options.policies?.overlap).toBe(STRATEGY_SCHEDULE_OVERLAP);
    expect(stored?.options.policies?.catchupWindow).toBe(STRATEGY_SCHEDULE_CATCHUP_WINDOW);
    const interestStored = gateway.store.get(result.interestScheduleId);
    expect(interestStored?.options.action).toMatchObject({
      type: 'startWorkflow',
      workflowType: 'helocInterestScheduleKickoff',
    });
    expect(interestStored?.options.policies?.overlap).toBe(STRATEGY_SCHEDULE_OVERLAP);
    expect(interestStored?.options.policies?.catchupWindow).toBe(STRATEGY_SCHEDULE_CATCHUP_WINDOW);
    const ref = await repos.strategySchedules.findByStrategy(graph.tenant.id, graph.strategy.id);
    expect(ref?.temporalScheduleId).toBe(result.scheduleId);
    expect(ref?.temporalInterestScheduleId).toBe(result.interestScheduleId);
    expect(ref?.expectedInterestChargeDay).toBe(1);
  });

  it('repeated activation does not duplicate Schedules', async () => {
    await service.createStrategySchedule(target());
    const again = await service.createStrategySchedule(target());
    expect(again.created).toBe(false);
    expect(gateway.store.size).toBe(2);
    expect(gateway.createCalls).toBe(2);
    expect(gateway.updateCalls).toBeGreaterThanOrEqual(2);
  });

  it('uses strategy timezone on calendar specs', async () => {
    const t = { ...target(), timezone: 'America/Vancouver', expectedPaymentDay: 10 };
    const result = await service.createStrategySchedule(t);
    expect(gateway.store.get(result.scheduleId)?.options.spec.timezone).toBe('America/Vancouver');
    const calendars = gateway.store.get(result.scheduleId)?.options.spec.calendars ?? [];
    expect(calendars[0]?.dayOfMonth).toBe(11);
    expect(calendars[0]?.hour).toBe(9);
  });

  it('handles month-boundary payment day 28 calendars', async () => {
    const opts = service.buildScheduleOptions({ ...target(), expectedPaymentDay: 28 });
    const calendars = opts.spec.calendars ?? [];
    expect(calendars).toHaveLength(2);
    expect(calendars[0]?.dayOfMonth).toBe(29);
    expect(calendars[1]?.month).toBe('MARCH');
    expect(calendars[1]?.dayOfMonth).toBe(1);
  });

  it('documents missing calendar day via March 1 catch for day 28', async () => {
    const opts = service.buildScheduleOptions({ ...target(), expectedPaymentDay: 28 });
    expect(opts.spec.calendars?.some((c) => c.dayOfMonth === 1)).toBe(true);
  });

  it('pause and resume conversion and interest Schedules', async () => {
    await service.createStrategySchedule(target());
    await service.pauseStrategySchedule(graph.tenant.id, graph.strategy.id, randomUUID());
    expect(gateway.pauseCalls).toBe(2);
    let ref = await repos.strategySchedules.findByStrategy(graph.tenant.id, graph.strategy.id);
    expect(ref?.paused).toBe(true);
    await service.resumeStrategySchedule(graph.tenant.id, graph.strategy.id, randomUUID());
    expect(gateway.unpauseCalls).toBe(2);
    ref = await repos.strategySchedules.findByStrategy(graph.tenant.id, graph.strategy.id);
    expect(ref?.paused).toBe(false);
  });

  it('overlap policy is SKIP (duplicate concurrent prevented)', async () => {
    const opts = service.buildScheduleOptions(target());
    expect(opts.policies?.overlap).toBe(ScheduleOverlapPolicy.SKIP);
  });

  it('catch-up window is explicit 3 days after downtime', async () => {
    const opts = service.buildScheduleOptions(target());
    expect(opts.policies?.catchupWindow).toBe('3 days');
  });

  it('duplicate trigger leaves conversion and interest Schedule records', async () => {
    const created = await service.createStrategySchedule(target());
    gateway.trigger(created.scheduleId);
    gateway.trigger(created.scheduleId);
    expect(gateway.triggers).toHaveLength(2);
    expect(gateway.store.size).toBe(2);
  });

  it('reconcile recreates Temporal Schedule when DB ref exists but Schedule missing', async () => {
    await service.createStrategySchedule(target());
    const scheduleId = service.scheduleIdFor(graph.tenant.id, graph.strategy.id);
    const interestScheduleId = service.interestScheduleIdFor(graph.tenant.id, graph.strategy.id);
    gateway.store.delete(scheduleId);
    const current = await repos.strategies.findById(graph.tenant.id, graph.strategy.id);
    await repos.strategies.updateState(
      graph.tenant.id,
      graph.strategy.id,
      current!.version,
      'ACTIVE',
    );
    const results = await service.reconcileStrategySchedules(graph.tenant.id, randomUUID());
    expect(results.some((r) => r.action === 'created_missing_schedule')).toBe(true);
    expect(gateway.store.has(scheduleId)).toBe(true);
    expect(gateway.store.has(interestScheduleId)).toBe(true);
  });

  it('reconcile creates DB ref when Schedule exists but reference is missing', async () => {
    await service.createStrategySchedule(target());
    await repos.strategySchedules.deleteHard(graph.tenant.id, graph.strategy.id);
    const current = await repos.strategies.findById(graph.tenant.id, graph.strategy.id);
    await repos.strategies.updateState(
      graph.tenant.id,
      graph.strategy.id,
      current!.version,
      'ACTIVE',
    );
    const results = await service.reconcileStrategySchedules(graph.tenant.id, randomUUID());
    expect(results.some((r) => r.action === 'created_missing_db_ref')).toBe(true);
    const ref = await repos.strategySchedules.findByStrategy(graph.tenant.id, graph.strategy.id);
    expect(ref).toBeTruthy();
  });

  it('delete removes conversion and interest Schedules on strategy close path', async () => {
    await service.createStrategySchedule(target());
    await service.deleteStrategySchedule(graph.tenant.id, graph.strategy.id, randomUUID());
    expect(gateway.deleteCalls).toBe(2);
    expect(gateway.store.size).toBe(0);
  });
});
