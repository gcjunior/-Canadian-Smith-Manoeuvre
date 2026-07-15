import type { Repositories } from '@csm/database';

import { nonRetryable } from './errors.js';
import type { ActivityContext } from './context.js';

export interface StrategySnapshot {
  strategyId: string;
  tenantId: string;
  userId: string;
  state: string;
  timezone: string;
  expectedPaymentDay: number;
  paymentPeriod: string | undefined;
  mortgageAccountId: string;
  helocAccountId: string;
  bankAccountId: string;
  brokerageAccountId: string;
  /** Provider resource IDs used with bank/brokerage clients. */
  mortgageProviderId: string;
  helocProviderId: string;
  bankProviderId: string;
  brokerageProviderId: string;
  mortgageFacilityId: string;
  helocFacilityId: string;
  ordinaryBankFacilityId: string;
  brokerageFacilityId: string;
  symbol: string;
  userMonthlyCapCents: bigint;
  allowFractionalShares: boolean;
}

export async function loadAuthoritativeStrategySnapshot(
  repos: Repositories,
  ctx: ActivityContext,
  options?: { requireActive?: boolean },
): Promise<StrategySnapshot> {
  const strategy = await repos.strategies.findById(ctx.tenantId, ctx.strategyId);
  if (!strategy) {
    nonRetryable('Strategy not found for tenant', 'NOT_FOUND', {
      tenantId: ctx.tenantId,
      strategyId: ctx.strategyId,
    });
  }
  if (options?.requireActive !== false && strategy.state !== 'ACTIVE') {
    nonRetryable('Strategy must be ACTIVE for financial activities', 'FORBIDDEN', {
      state: strategy.state,
    });
  }

  const [
    mortgageAcct,
    helocAcct,
    bankAcct,
    brokerageAcct,
    policy,
    mortgage,
    heloc,
    ordinary,
    brokerage,
  ] = await Promise.all([
    repos.accounts.findAccountById(ctx.tenantId, strategy.mortgageAccountId),
    repos.accounts.findAccountById(ctx.tenantId, strategy.helocAccountId),
    repos.accounts.findAccountById(ctx.tenantId, strategy.bankAccountId),
    repos.accounts.findAccountById(ctx.tenantId, strategy.brokerageAccountId),
    repos.strategies.findPolicy(ctx.tenantId, strategy.id),
    repos.accounts.findMortgageDetail(ctx.tenantId, strategy.mortgageAccountId),
    repos.accounts.findHelocDetail(ctx.tenantId, strategy.helocAccountId),
    repos.accounts.findOrdinaryBankDetail(ctx.tenantId, strategy.bankAccountId),
    repos.accounts.findBrokerageDetail(ctx.tenantId, strategy.brokerageAccountId),
  ]);

  if (!mortgageAcct || !helocAcct || !bankAcct || !brokerageAcct || !policy) {
    nonRetryable('Strategy accounts or policy missing', 'NOT_FOUND');
  }
  if (!mortgage || !heloc || !ordinary || !brokerage) {
    nonRetryable('Strategy facility details missing', 'NOT_FOUND');
  }
  if (
    mortgageAcct.userId !== strategy.userId ||
    helocAcct.userId !== strategy.userId ||
    bankAcct.userId !== strategy.userId ||
    brokerageAcct.userId !== strategy.userId
  ) {
    nonRetryable('Account ownership mismatch', 'FORBIDDEN');
  }
  if (brokerage.registrationType !== 'NON_REGISTERED') {
    nonRetryable('Brokerage must be non-registered', 'VALIDATION_FAILURE');
  }

  return {
    strategyId: strategy.id,
    tenantId: strategy.tenantId,
    userId: strategy.userId,
    state: strategy.state,
    timezone: strategy.timezone,
    expectedPaymentDay: strategy.expectedPaymentDay,
    paymentPeriod: ctx.paymentPeriod,
    mortgageAccountId: strategy.mortgageAccountId,
    helocAccountId: strategy.helocAccountId,
    bankAccountId: strategy.bankAccountId,
    brokerageAccountId: strategy.brokerageAccountId,
    mortgageProviderId: mortgageAcct.providerAccountId,
    helocProviderId: helocAcct.providerAccountId,
    bankProviderId: bankAcct.providerAccountId,
    brokerageProviderId: brokerageAcct.providerAccountId,
    mortgageFacilityId: mortgage.id,
    helocFacilityId: heloc.id,
    ordinaryBankFacilityId: ordinary.id,
    brokerageFacilityId: brokerage.id,
    symbol: policy.symbol,
    userMonthlyCapCents: policy.userMonthlyCapCents,
    allowFractionalShares: policy.allowFractionalShares,
  };
}

export function assertSnapshotMatchesCtx(snapshot: StrategySnapshot, ctx: ActivityContext): void {
  if (snapshot.tenantId !== ctx.tenantId || snapshot.strategyId !== ctx.strategyId) {
    nonRetryable('Snapshot tenant/strategy mismatch', 'TENANT_SCOPE_VIOLATION');
  }
}
