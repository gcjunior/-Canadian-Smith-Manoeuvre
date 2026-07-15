import type { MoneyMovement, MoneyMovementState, MoneyMovementType } from '@prisma/client';
import { DomainError } from '@csm/domain';
import { assertMoneyMovementTransition } from '@csm/contracts';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface MoneyMovementRepository {
  create(
    tenantId: string,
    input: {
      cycleId?: string;
      type: MoneyMovementType;
      amountCents: bigint;
      sourceAccountId?: string;
      destinationAccountId?: string;
      idempotencyKey: string;
      correlationId: string;
      state?: MoneyMovementState;
    },
  ): Promise<MoneyMovement>;
  findByIdempotencyKey(tenantId: string, key: string): Promise<MoneyMovement | null>;
  findById(tenantId: string, id: string): Promise<MoneyMovement | null>;
  findByCycleAndType(
    tenantId: string,
    cycleId: string,
    type: MoneyMovementType,
  ): Promise<MoneyMovement | null>;
  updateState(
    tenantId: string,
    id: string,
    version: number,
    from: MoneyMovementState,
    to: MoneyMovementState,
    patch?: {
      providerTransactionId?: string;
      settledAt?: Date | null;
      failureCode?: string | null;
    },
  ): Promise<MoneyMovement>;
}

export function createMoneyMovementRepository(db: DbClient): MoneyMovementRepository {
  return {
    async create(tenantId, input) {
      try {
        return await db.moneyMovement.create({
          data: {
            tenantId,
            type: input.type,
            amountCents: input.amountCents,
            idempotencyKey: input.idempotencyKey,
            correlationId: input.correlationId,
            state: input.state ?? 'REQUESTED',
            ...(input.cycleId !== undefined ? { cycleId: input.cycleId } : {}),
            ...(input.sourceAccountId !== undefined
              ? { sourceAccountId: input.sourceAccountId }
              : {}),
            ...(input.destinationAccountId !== undefined
              ? { destinationAccountId: input.destinationAccountId }
              : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findByIdempotencyKey(tenantId, key) {
      return db.moneyMovement.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } },
      });
    },
    findById(tenantId, id) {
      return db.moneyMovement.findFirst({ where: { id, tenantId } });
    },
    findByCycleAndType(tenantId, cycleId, type) {
      return db.moneyMovement.findFirst({
        where: { tenantId, cycleId, type },
        orderBy: { createdAt: 'desc' },
      });
    },
    async updateState(tenantId, id, version, from, to, patch) {
      assertMoneyMovementTransition(from, to);
      try {
        const updated = await db.moneyMovement.updateMany({
          where: { id, tenantId, version, state: from },
          data: {
            state: to,
            version: { increment: 1 },
            ...(patch?.providerTransactionId !== undefined
              ? { providerTransactionId: patch.providerTransactionId }
              : {}),
            ...(patch?.settledAt !== undefined ? { settledAt: patch.settledAt } : {}),
            ...(patch?.failureCode !== undefined ? { failureCode: patch.failureCode } : {}),
          },
        });
        if (updated.count === 0) {
          throw new DomainError(
            'OPTIMISTIC_CONCURRENCY_CONFLICT',
            'MoneyMovement version conflict',
          );
        }
        const row = await db.moneyMovement.findFirst({ where: { id, tenantId } });
        if (!row) {
          throw new DomainError('NOT_FOUND', 'MoneyMovement not found');
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
