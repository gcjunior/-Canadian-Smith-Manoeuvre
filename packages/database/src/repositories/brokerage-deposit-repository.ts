import type { BrokerageDeposit, MoneyMovementState } from '@prisma/client';
import { DomainError } from '@csm/domain';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface BrokerageDepositRepository {
  create(
    tenantId: string,
    input: {
      cycleId?: string;
      brokerageAccountId: string;
      moneyMovementId: string;
      amountCents: bigint;
      providerDepositId: string;
      state?: MoneyMovementState;
    },
  ): Promise<BrokerageDeposit>;
  findByMoneyMovementId(
    tenantId: string,
    moneyMovementId: string,
  ): Promise<BrokerageDeposit | null>;
  findByProviderDepositId(
    tenantId: string,
    providerDepositId: string,
  ): Promise<BrokerageDeposit | null>;
  updateState(
    tenantId: string,
    id: string,
    version: number,
    state: MoneyMovementState,
    patch?: { settledAt?: Date | null },
  ): Promise<BrokerageDeposit>;
}

export function createBrokerageDepositRepository(db: DbClient): BrokerageDepositRepository {
  return {
    async create(tenantId, input) {
      try {
        return await db.brokerageDeposit.create({
          data: {
            tenantId,
            brokerageAccountId: input.brokerageAccountId,
            moneyMovementId: input.moneyMovementId,
            amountCents: input.amountCents,
            providerDepositId: input.providerDepositId,
            state: input.state ?? 'REQUESTED',
            ...(input.cycleId !== undefined ? { cycleId: input.cycleId } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findByMoneyMovementId(tenantId, moneyMovementId) {
      return db.brokerageDeposit.findFirst({ where: { tenantId, moneyMovementId } });
    },
    findByProviderDepositId(tenantId, providerDepositId) {
      return db.brokerageDeposit.findUnique({
        where: { tenantId_providerDepositId: { tenantId, providerDepositId } },
      });
    },
    async updateState(tenantId, id, version, state, patch) {
      try {
        const updated = await db.brokerageDeposit.updateMany({
          where: { id, tenantId, version },
          data: {
            state,
            version: { increment: 1 },
            ...(patch?.settledAt !== undefined ? { settledAt: patch.settledAt } : {}),
          },
        });
        if (updated.count === 0) {
          throw new DomainError(
            'OPTIMISTIC_CONCURRENCY_CONFLICT',
            'BrokerageDeposit version conflict',
          );
        }
        const row = await db.brokerageDeposit.findFirst({ where: { id, tenantId } });
        if (!row) {
          throw new DomainError('NOT_FOUND', 'BrokerageDeposit not found');
        }
        return row;
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        mapPrismaError(error);
      }
    },
  };
}
