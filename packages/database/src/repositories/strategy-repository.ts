import { assertStrategyAccountBindings, DomainError, asCanadianTimezone } from '@csm/domain';
import type { Strategy, StrategyInvestmentPolicy, StrategyState } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface StrategyCreateInput {
  userId: string;
  name: string;
  timezone: string;
  expectedPaymentDay: number;
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
  updateState(
    tenantId: string,
    strategyId: string,
    version: number,
    state: StrategyState,
    pauseReason?: string,
  ): Promise<Strategy>;
  findPolicy(tenantId: string, strategyId: string): Promise<StrategyInvestmentPolicy | null>;
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
  };
}
