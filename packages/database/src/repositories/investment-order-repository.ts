import type { InvestmentOrder, InvestmentOrderState, Prisma } from '@prisma/client';
import { DomainError } from '@csm/domain';
import { assertInvestmentOrderTransition } from '@csm/contracts';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface InvestmentOrderRepository {
  create(
    tenantId: string,
    input: {
      cycleId?: string;
      brokerageAccountId: string;
      idempotencyKey: string;
      symbol: string;
      notionalCents: bigint;
      correlationId: string;
      state?: InvestmentOrderState;
    },
  ): Promise<InvestmentOrder>;
  findByIdempotencyKey(tenantId: string, key: string): Promise<InvestmentOrder | null>;
  findById(tenantId: string, id: string): Promise<InvestmentOrder | null>;
  updateState(
    tenantId: string,
    id: string,
    version: number,
    from: InvestmentOrderState,
    to: InvestmentOrderState,
    patch?: {
      providerOrderId?: string | null;
      submittedAt?: Date | null;
      filledAt?: Date | null;
      quantity?: Prisma.Decimal | null;
    },
  ): Promise<InvestmentOrder>;
}

export function createInvestmentOrderRepository(db: DbClient): InvestmentOrderRepository {
  return {
    async create(tenantId, input) {
      try {
        return await db.investmentOrder.create({
          data: {
            tenantId,
            brokerageAccountId: input.brokerageAccountId,
            idempotencyKey: input.idempotencyKey,
            symbol: input.symbol,
            notionalCents: input.notionalCents,
            correlationId: input.correlationId,
            state: input.state ?? 'CREATED',
            ...(input.cycleId !== undefined ? { cycleId: input.cycleId } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findByIdempotencyKey(tenantId, key) {
      return db.investmentOrder.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } },
      });
    },
    findById(tenantId, id) {
      return db.investmentOrder.findFirst({ where: { id, tenantId } });
    },
    async updateState(tenantId, id, version, from, to, patch) {
      assertInvestmentOrderTransition(from, to);
      try {
        const updated = await db.investmentOrder.updateMany({
          where: { id, tenantId, version, state: from },
          data: {
            state: to,
            version: { increment: 1 },
            ...(patch?.providerOrderId !== undefined
              ? { providerOrderId: patch.providerOrderId }
              : {}),
            ...(patch?.submittedAt !== undefined ? { submittedAt: patch.submittedAt } : {}),
            ...(patch?.filledAt !== undefined ? { filledAt: patch.filledAt } : {}),
            ...(patch?.quantity !== undefined ? { quantity: patch.quantity } : {}),
          },
        });
        if (updated.count === 0) {
          throw new DomainError(
            'OPTIMISTIC_CONCURRENCY_CONFLICT',
            'InvestmentOrder version conflict',
          );
        }
        const row = await db.investmentOrder.findFirst({ where: { id, tenantId } });
        if (!row) {
          throw new DomainError('NOT_FOUND', 'InvestmentOrder not found');
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
