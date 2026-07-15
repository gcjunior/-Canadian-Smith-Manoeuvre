import {
  AppError,
  assertStrategyTransition,
  hasAccountCapability,
  toCustomerCycleStatus,
  type MonthlyConversionCycleState,
  type StrategyPatchRequest,
  type StrategySetupRequest,
  type TenantContext,
} from '@csm/contracts';
import type { PrismaClient, Repositories } from '@csm/database';
import { assertStrategyActivation } from '@csm/domain';
import { csmMetrics } from '@csm/observability';

import { assertCustomerOwnsUser, requireRoles } from '../auth/guards.js';
import { computeNextExpectedCheckAt, serializeCycle, serializeMoney } from '../lib/serialize.js';
import type { TemporalAppService } from './temporal-app-service.js';

export class StrategyAppService {
  constructor(
    private readonly repos: Repositories,
    private readonly prisma: PrismaClient,
    private readonly temporal: TemporalAppService,
    private readonly platformMonthlyDrawCapCents: bigint,
  ) {}

  async create(auth: TenantContext, input: StrategySetupRequest, correlationId: string) {
    requireRoles(auth, ['CUSTOMER'], correlationId);
    const strategy = await this.repos.strategies.create(auth.tenantId, {
      userId: auth.userId,
      name: input.name,
      timezone: input.timezone,
      expectedPaymentDay: input.expectedPaymentDay,
      mortgageAccountId: input.mortgageAccountId,
      helocAccountId: input.helocAccountId,
      bankAccountId: input.bankAccountId,
      brokerageAccountId: input.brokerageAccountId,
      symbol: input.investmentPolicy.symbol,
      userMonthlyCapCents: input.investmentPolicy.userMonthlyCapCents,
    });
    return this.toResponse(auth.tenantId, strategy.id);
  }

  async list(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['CUSTOMER', 'OPERATIONS'], correlationId);
    const strategies =
      auth.roles.includes('OPERATIONS') || auth.roles.includes('ADMIN')
        ? await this.repos.strategies.listForTenant(auth.tenantId)
        : await this.repos.strategies.listForUser(auth.tenantId, auth.userId);
    const out = [];
    for (const s of strategies) {
      out.push(await this.toResponse(auth.tenantId, s.id));
    }
    return out;
  }

  async get(auth: TenantContext, strategyId: string, correlationId: string) {
    const strategy = await this.requireStrategy(auth, strategyId, correlationId);
    assertCustomerOwnsUser(auth, strategy.userId, correlationId);
    return this.toResponse(auth.tenantId, strategy.id);
  }

  async patch(
    auth: TenantContext,
    strategyId: string,
    patch: StrategyPatchRequest,
    correlationId: string,
  ) {
    requireRoles(auth, ['CUSTOMER'], correlationId);
    const strategy = await this.requireStrategy(auth, strategyId, correlationId);
    assertCustomerOwnsUser(auth, strategy.userId, correlationId);
    if (strategy.state !== 'DRAFT') {
      throw new AppError({
        code: 'INVALID_STATUS_TRANSITION',
        message: 'Only DRAFT strategies can be patched',
        correlationId,
      });
    }
    await this.repos.strategies.updateDraft(auth.tenantId, strategyId, strategy.version, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(patch.expectedPaymentDay !== undefined
        ? { expectedPaymentDay: patch.expectedPaymentDay }
        : {}),
      ...(patch.investmentPolicy?.symbol !== undefined
        ? { symbol: patch.investmentPolicy.symbol }
        : {}),
      ...(patch.investmentPolicy?.userMonthlyCapCents !== undefined
        ? { userMonthlyCapCents: patch.investmentPolicy.userMonthlyCapCents }
        : {}),
      ...(patch.investmentPolicy?.allowFractionalShares !== undefined
        ? { allowFractionalShares: patch.investmentPolicy.allowFractionalShares }
        : {}),
    });
    return this.toResponse(auth.tenantId, strategyId);
  }

  async activate(
    auth: TenantContext,
    strategyId: string,
    acknowledgeRiskDisclosures: true,
    correlationId: string,
  ) {
    requireRoles(auth, ['CUSTOMER'], correlationId);
    const strategy = await this.requireStrategy(auth, strategyId, correlationId);
    assertCustomerOwnsUser(auth, strategy.userId, correlationId);
    assertStrategyTransition(strategy.state, 'ACTIVE');

    const [mortgage, heloc, bank, brokerage, brokerageDetail, policy, linked] = await Promise.all([
      this.repos.accounts.findAccountById(auth.tenantId, strategy.mortgageAccountId),
      this.repos.accounts.findAccountById(auth.tenantId, strategy.helocAccountId),
      this.repos.accounts.findAccountById(auth.tenantId, strategy.bankAccountId),
      this.repos.accounts.findAccountById(auth.tenantId, strategy.brokerageAccountId),
      this.repos.accounts.findBrokerageDetail(auth.tenantId, strategy.brokerageAccountId),
      this.repos.strategies.findPolicy(auth.tenantId, strategyId),
      this.repos.strategies.findActiveOrPausedUsingAccounts(
        auth.tenantId,
        [
          strategy.mortgageAccountId,
          strategy.helocAccountId,
          strategy.bankAccountId,
          strategy.brokerageAccountId,
        ],
        strategyId,
      ),
    ]);

    if (!mortgage || !heloc || !bank || !brokerage || !brokerageDetail) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: 'Required strategy accounts not found',
        correlationId,
      });
    }

    assertStrategyActivation({
      tenantId: auth.tenantId,
      userId: auth.userId,
      timezone: strategy.timezone,
      expectedPaymentDay: strategy.expectedPaymentDay,
      acknowledgeRiskDisclosures,
      accounts: {
        mortgage,
        heloc,
        bankOperating: bank,
        brokerageCash: brokerage,
        brokerageRegistrationType: brokerageDetail.registrationType,
        mortgageCapabilitiesOk: hasAccountCapability('MORTGAGE', 'canReadPayments'),
        helocCapabilitiesOk:
          hasAccountCapability('HELOC', 'canReadAvailability') &&
          hasAccountCapability('HELOC', 'canDraw'),
        bankCapabilitiesOk: hasAccountCapability('BANK_OPERATING', 'canDebitInterest'),
        brokerageCapabilitiesOk:
          hasAccountCapability('BROKERAGE_CASH', 'canDeposit') &&
          hasAccountCapability('BROKERAGE_CASH', 'canPlaceNotionalMarketOrder'),
      },
      policy: policy
        ? {
            symbol: policy.symbol,
            userMonthlyCapCents: policy.userMonthlyCapCents,
            platformMonthlyDrawCapCents: this.platformMonthlyDrawCapCents,
          }
        : null,
      incompatiblyLinkedAccountIds: [
        ...new Set(
          linked.flatMap((s) => [
            s.mortgageAccountId,
            s.helocAccountId,
            s.bankAccountId,
            s.brokerageAccountId,
          ]),
        ),
      ].filter((id) =>
        [
          strategy.mortgageAccountId,
          strategy.helocAccountId,
          strategy.bankAccountId,
          strategy.brokerageAccountId,
        ].includes(id),
      ),
    });

    await this.repos.strategies.updateState(auth.tenantId, strategyId, strategy.version, 'ACTIVE');
    await this.repos.audit.create(auth.tenantId, {
      actorType: 'USER',
      actorId: auth.userId,
      action: 'strategy.activate',
      resourceType: 'strategy',
      resourceId: strategyId,
      correlationId,
      payloadRedacted: { acknowledgeRiskDisclosures: true },
    });

    await this.temporal.createStrategySchedule({
      tenantId: auth.tenantId,
      strategyId,
      timezone: strategy.timezone,
      expectedPaymentDay: strategy.expectedPaymentDay,
      expectedInterestChargeDay: strategy.expectedInterestChargeDay,
      correlationId,
      paused: false,
    });

    csmMetrics.activeStrategies.add(1);
    return this.toResponse(auth.tenantId, strategyId);
  }

  async pause(auth: TenantContext, strategyId: string, reason: string, correlationId: string) {
    requireRoles(auth, ['CUSTOMER', 'OPERATIONS'], correlationId);
    const strategy = await this.requireStrategy(auth, strategyId, correlationId);
    assertCustomerOwnsUser(auth, strategy.userId, correlationId);
    assertStrategyTransition(strategy.state, 'PAUSED');
    await this.repos.strategies.updateState(
      auth.tenantId,
      strategyId,
      strategy.version,
      'PAUSED',
      reason,
    );
    await this.repos.audit.create(auth.tenantId, {
      actorType: 'USER',
      actorId: auth.userId,
      action: 'strategy.pause',
      resourceType: 'strategy',
      resourceId: strategyId,
      correlationId,
      payloadRedacted: { reason },
    });
    await this.temporal.pauseStrategySchedule(auth.tenantId, strategyId, correlationId, reason);
    csmMetrics.activeStrategies.add(-1);
    return this.toResponse(auth.tenantId, strategyId);
  }

  async resume(
    auth: TenantContext,
    strategyId: string,
    clearanceNote: string,
    correlationId: string,
  ) {
    requireRoles(auth, ['CUSTOMER', 'OPERATIONS'], correlationId);
    const strategy = await this.requireStrategy(auth, strategyId, correlationId);
    assertCustomerOwnsUser(auth, strategy.userId, correlationId);
    assertStrategyTransition(strategy.state, 'ACTIVE');
    await this.repos.strategies.updateState(auth.tenantId, strategyId, strategy.version, 'ACTIVE');
    await this.repos.audit.create(auth.tenantId, {
      actorType: 'USER',
      actorId: auth.userId,
      action: 'strategy.resume',
      resourceType: 'strategy',
      resourceId: strategyId,
      correlationId,
      payloadRedacted: { clearanceNote },
    });
    await this.temporal.resumeStrategySchedule(
      auth.tenantId,
      strategyId,
      correlationId,
      clearanceNote,
    );
    csmMetrics.activeStrategies.add(1);
    return this.toResponse(auth.tenantId, strategyId);
  }

  async close(auth: TenantContext, strategyId: string, reason: string, correlationId: string) {
    requireRoles(auth, ['CUSTOMER', 'OPERATIONS', 'ADMIN'], correlationId);
    const strategy = await this.requireStrategy(auth, strategyId, correlationId);
    assertCustomerOwnsUser(auth, strategy.userId, correlationId);
    assertStrategyTransition(strategy.state, 'CLOSED');
    await this.repos.strategies.updateState(auth.tenantId, strategyId, strategy.version, 'CLOSED');
    await this.repos.audit.create(auth.tenantId, {
      actorType: 'USER',
      actorId: auth.userId,
      action: 'strategy.close',
      resourceType: 'strategy',
      resourceId: strategyId,
      correlationId,
      payloadRedacted: { reason },
    });
    await this.temporal.deleteStrategySchedule(auth.tenantId, strategyId, correlationId);
    if (strategy.state === 'ACTIVE') {
      csmMetrics.activeStrategies.add(-1);
    }
    return this.toResponse(auth.tenantId, strategyId);
  }

  async listCycles(auth: TenantContext, strategyId: string, correlationId: string) {
    const strategy = await this.requireStrategy(auth, strategyId, correlationId);
    assertCustomerOwnsUser(auth, strategy.userId, correlationId);
    const cycles = await this.repos.cycles.listForStrategy(auth.tenantId, strategyId);
    return cycles.map(serializeCycle);
  }

  async getCycle(auth: TenantContext, strategyId: string, cycleId: string, correlationId: string) {
    const strategy = await this.requireStrategy(auth, strategyId, correlationId);
    assertCustomerOwnsUser(auth, strategy.userId, correlationId);
    const cycle = await this.repos.cycles.findById(auth.tenantId, cycleId);
    if (!cycle || cycle.strategyId !== strategyId) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Cycle not found', correlationId });
    }
    return serializeCycle(cycle);
  }

  async getDashboard(auth: TenantContext, strategyId: string, correlationId: string) {
    const strategy = await this.requireStrategy(auth, strategyId, correlationId);
    assertCustomerOwnsUser(auth, strategy.userId, correlationId);
    const strategyResponse = await this.toResponse(auth.tenantId, strategyId);
    const cycles = await this.repos.cycles.listForStrategy(auth.tenantId, strategyId);
    const latest = cycles[0] ?? null;

    const heloc = await this.repos.accounts.findHelocDetail(auth.tenantId, strategy.helocAccountId);
    const ordinary = await this.repos.accounts.findOrdinaryBankDetail(
      auth.tenantId,
      strategy.bankAccountId,
    );

    let latestMortgagePaymentCents: string | null = null;
    let latestInvestedCents: string | null = null;
    let helocInterestPaidFromOrdinaryCents: string | null = null;

    if (latest?.mortgagePaymentId) {
      const mortgagePayment = await this.prisma.mortgagePayment.findFirst({
        where: { id: latest.mortgagePaymentId, tenantId: auth.tenantId },
      });
      if (mortgagePayment) {
        latestMortgagePaymentCents = serializeMoney(mortgagePayment.totalAmountCents);
      }
    }

    if (latest) {
      const orderAgg = await this.prisma.investmentOrder.aggregate({
        where: { tenantId: auth.tenantId, cycleId: latest.id, state: 'FILLED' },
        _sum: { notionalCents: true },
      });
      latestInvestedCents = serializeMoney(orderAgg._sum.notionalCents ?? 0n);
    }

    if (ordinary) {
      const interestAgg = await this.prisma.helocInterestPayment.aggregate({
        where: {
          tenantId: auth.tenantId,
          ordinaryBankAccountId: ordinary.id,
          state: 'SETTLED',
        },
        _sum: { amountCents: true },
      });
      helocInterestPaidFromOrdinaryCents = serializeMoney(interestAgg._sum.amountCents ?? 0n);
    }

    const exceptions = await this.repos.exceptions.listOpen(auth.tenantId);
    const strategyExceptions = exceptions.filter((e) => e.strategyId === strategyId);

    const automationLabel =
      strategy.state === 'ACTIVE'
        ? ('active' as const)
        : strategy.state === 'PAUSED'
          ? ('paused' as const)
          : strategy.state === 'DRAFT'
            ? ('draft' as const)
            : ('closed' as const);

    return {
      strategy: strategyResponse,
      automationActive: strategy.state === 'ACTIVE',
      automationLabel,
      nextExpectedCheckAt:
        strategy.state === 'ACTIVE' || strategy.state === 'PAUSED'
          ? computeNextExpectedCheckAt(strategy.timezone, strategy.expectedPaymentDay)
          : null,
      timezone: strategy.timezone,
      latestMortgagePaymentCents,
      principalRepaidCents: serializeMoney(latest?.principalRepaidCents ?? null),
      latestBorrowedCents: serializeMoney(latest?.drawAmountCents ?? null),
      latestInvestedCents,
      investmentLoanBalanceCents: serializeMoney(heloc?.balanceOwedCents ?? null),
      helocInterestPaidFromOrdinaryCents,
      latestCycle: latest
        ? {
            id: latest.id,
            paymentPeriod: latest.paymentPeriod,
            customerStatus: toCustomerCycleStatus(latest.state as MonthlyConversionCycleState),
            updatedAt: latest.updatedAt.toISOString(),
          }
        : null,
      exceptionsRequiringAttention: strategyExceptions.map((e) => ({
        id: e.id,
        code: e.code,
        message: e.message,
        severity: e.severity,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async listLedger(auth: TenantContext, strategyId: string, correlationId: string) {
    const strategy = await this.requireStrategy(auth, strategyId, correlationId);
    assertCustomerOwnsUser(auth, strategy.userId, correlationId);
    return this.repos.ledger.listByStrategyAccounts(auth.tenantId, [
      strategy.mortgageAccountId,
      strategy.helocAccountId,
      strategy.bankAccountId,
      strategy.brokerageAccountId,
    ]);
  }

  private async requireStrategy(auth: TenantContext, strategyId: string, correlationId: string) {
    const strategy = await this.repos.strategies.findById(auth.tenantId, strategyId);
    if (!strategy) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Strategy not found', correlationId });
    }
    return strategy;
  }

  private async toResponse(tenantId: string, strategyId: string) {
    const strategy = await this.repos.strategies.findById(tenantId, strategyId);
    const policy = await this.repos.strategies.findPolicy(tenantId, strategyId);
    if (!strategy || !policy) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Strategy not found' });
    }
    return {
      id: strategy.id,
      tenantId: strategy.tenantId,
      userId: strategy.userId,
      name: strategy.name,
      state: strategy.state,
      timezone: strategy.timezone,
      expectedPaymentDay: strategy.expectedPaymentDay,
      mortgageAccountId: strategy.mortgageAccountId,
      helocAccountId: strategy.helocAccountId,
      bankAccountId: strategy.bankAccountId,
      brokerageAccountId: strategy.brokerageAccountId,
      pauseReason: strategy.pauseReason,
      investmentPolicy: {
        id: policy.id,
        symbol: policy.symbol,
        exchange: policy.exchange,
        userMonthlyCapCents: serializeMoney(policy.userMonthlyCapCents),
        allowFractionalShares: policy.allowFractionalShares,
      },
      createdAt: strategy.createdAt.toISOString(),
      updatedAt: strategy.updatedAt.toISOString(),
      version: strategy.version,
    };
  }
}
