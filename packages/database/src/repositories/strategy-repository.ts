import { assertStrategyAccountBindings, DomainError, asCanadianTimezone } from '@csm/domain';
import type { Strategy, StrategyInvestmentPolicy, StrategyState } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface StrategyCreateInput {
  userId: string;
  name: string;
  timezone: string;
  expectedPaymentDay: number;
  expectedInterestChargeDay?: number;
  mortgageAccountId: string;
  helocAccountId: string;
  bankAccountId: string;
  brokerageAccountId: string;
  state?: StrategyState;
  symbol: string;
  userMonthlyCapCents: bigint;
}

export interface StrategyRepository {
  create(tenantId: string, input: StrategyCreateInput): Promise<Strategy>;
  findById(tenantId: string, strategyId: string): Promise<Strategy | null>;
  listForUser(tenantId: string, userId: string): Promise<Strategy[]>;
  listForTenant(tenantId: string): Promise<Strategy[]>;
  updateDraft(
    tenantId: string,
    strategyId: string,
    version: number,
    patch: {
      name?: string;
      timezone?: string;
      expectedPaymentDay?: number;
      symbol?: string;
      userMonthlyCapCents?: bigint;
      allowFractionalShares?: boolean;
    },
  ): Promise<Strategy>;
  updateState(
    tenantId: string,
    strategyId: string,
    version: number,
    state: StrategyState,
    pauseReason?: string,
  ): Promise<Strategy>;
  findPolicy(tenantId: string, strategyId: string): Promise<StrategyInvestmentPolicy | null>;
  findActiveOrPausedUsingAccounts(
    tenantId: string,
    accountIds: string[],
    excludeStrategyId?: string,
  ): Promise<Strategy[]>;
}

export function createStrategyRepository(db: DbClient): StrategyRepository {
  return {
    async create(tenantId, input) {
      const timezone = asCanadianTimezone(input.timezone);
      const accounts = await db.financialAccount.findMany({
        where: {
          tenantId,
          id: {
            in: [
              input.mortgageAccountId,
              input.helocAccountId,
              input.bankAccountId,
              input.brokerageAccountId,
            ],
          },
        },
      });
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const requireAccount = (id: string) => {
        const account = byId.get(id);
        if (!account) {
          throw new DomainError('NOT_FOUND', `Account not found in tenant: ${id}`);
        }
        return account;
      };

      assertStrategyAccountBindings({
        tenantId,
        userId: input.userId,
        mortgage: requireAccount(input.mortgageAccountId),
        heloc: requireAccount(input.helocAccountId),
        bankOperating: requireAccount(input.bankAccountId),
        brokerageCash: requireAccount(input.brokerageAccountId),
      });

      try {
        return await db.strategy.create({
          data: {
            tenantId,
            userId: input.userId,
            name: input.name,
            timezone,
            expectedPaymentDay: input.expectedPaymentDay,
            expectedInterestChargeDay: input.expectedInterestChargeDay ?? 1,
            mortgageAccountId: input.mortgageAccountId,
            helocAccountId: input.helocAccountId,
            bankAccountId: input.bankAccountId,
            brokerageAccountId: input.brokerageAccountId,
            state: input.state ?? 'DRAFT',
            investmentPolicy: {
              create: {
                tenant: { connect: { id: tenantId } },
                symbol: input.symbol,
                userMonthlyCapCents: input.userMonthlyCapCents,
              },
            },
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },

    findById(tenantId, strategyId) {
      return db.strategy.findFirst({ where: { id: strategyId, tenantId } });
    },

    listForUser(tenantId, userId) {
      return db.strategy.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
      });
    },

    listForTenant(tenantId) {
      return db.strategy.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
    },

    async updateDraft(tenantId, strategyId, version, patch) {
      try {
        const current = await db.strategy.findFirst({
          where: { id: strategyId, tenantId, version, state: 'DRAFT' },
        });
        if (!current) {
          throw new DomainError('NOT_FOUND', 'Draft strategy not found or version conflict');
        }
        await db.strategy.update({
          where: { id: strategyId },
          data: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.timezone !== undefined
              ? { timezone: asCanadianTimezone(patch.timezone) }
              : {}),
            ...(patch.expectedPaymentDay !== undefined
              ? { expectedPaymentDay: patch.expectedPaymentDay }
              : {}),
            version: { increment: 1 },
          },
        });
        if (
          patch.symbol !== undefined ||
          patch.userMonthlyCapCents !== undefined ||
          patch.allowFractionalShares !== undefined
        ) {
          await db.strategyInvestmentPolicy.updateMany({
            where: { strategyId, tenantId },
            data: {
              ...(patch.symbol !== undefined ? { symbol: patch.symbol } : {}),
              ...(patch.userMonthlyCapCents !== undefined
                ? { userMonthlyCapCents: patch.userMonthlyCapCents }
                : {}),
              ...(patch.allowFractionalShares !== undefined
                ? { allowFractionalShares: patch.allowFractionalShares }
                : {}),
              version: { increment: 1 },
            },
          });
        }
        const strategy = await db.strategy.findFirst({ where: { id: strategyId, tenantId } });
        if (!strategy) {
          throw new DomainError('NOT_FOUND', 'Strategy not found');
        }
        return strategy;
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        mapPrismaError(error);
      }
    },

    async updateState(tenantId, strategyId, version, state, pauseReason) {
      try {
        const updated = await db.strategy.updateMany({
          where: { id: strategyId, tenantId, version },
          data: {
            state,
            version: { increment: 1 },
            ...(pauseReason !== undefined ? { pauseReason } : { pauseReason: null }),
          },
        });
        if (updated.count === 0) {
          throw new DomainError('OPTIMISTIC_CONCURRENCY_CONFLICT', 'Strategy version conflict');
        }
        const strategy = await db.strategy.findFirst({ where: { id: strategyId, tenantId } });
        if (!strategy) {
          throw new DomainError('NOT_FOUND', 'Strategy not found');
        }
        return strategy;
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        mapPrismaError(error);
      }
    },

    findPolicy(tenantId, strategyId) {
      return db.strategyInvestmentPolicy.findFirst({ where: { strategyId, tenantId } });
    },

    findActiveOrPausedUsingAccounts(tenantId, accountIds, excludeStrategyId) {
      return db.strategy.findMany({
        where: {
          tenantId,
          state: { in: ['ACTIVE', 'PAUSED'] },
          ...(excludeStrategyId !== undefined ? { id: { not: excludeStrategyId } } : {}),
          OR: [
            { mortgageAccountId: { in: accountIds } },
            { helocAccountId: { in: accountIds } },
            { bankAccountId: { in: accountIds } },
            { brokerageAccountId: { in: accountIds } },
          ],
        },
      });
    },
  };
}
