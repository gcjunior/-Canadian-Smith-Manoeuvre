import type { OperationalException, OperationalExceptionState, Prisma } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface ExceptionRepository {
  listOpen(tenantId: string): Promise<OperationalException[]>;
  findByCycle(tenantId: string, cycleId: string): Promise<OperationalException[]>;
  create(
    tenantId: string,
    input: {
      strategyId?: string;
      cycleId?: string;
      code: string;
      message: string;
      correlationId?: string;
      details?: Prisma.InputJsonValue;
    },
  ): Promise<OperationalException>;
  updateState(
    tenantId: string,
    id: string,
    state: OperationalExceptionState,
  ): Promise<OperationalException>;
}

export function createExceptionRepository(db: DbClient): ExceptionRepository {
  return {
    listOpen(tenantId) {
      return db.operationalException.findMany({
        where: { tenantId, state: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        orderBy: { createdAt: 'desc' },
      });
    },
    findByCycle(tenantId, cycleId) {
      return db.operationalException.findMany({
        where: { tenantId, cycleId },
        orderBy: { createdAt: 'desc' },
      });
    },
    async create(tenantId, input) {
      try {
        return await db.operationalException.create({
          data: {
            tenantId,
            code: input.code,
            message: input.message,
            ...(input.strategyId !== undefined ? { strategyId: input.strategyId } : {}),
            ...(input.cycleId !== undefined ? { cycleId: input.cycleId } : {}),
            ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
            ...(input.details !== undefined ? { details: input.details } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    async updateState(_tenantId, id, state) {
      try {
        return await db.operationalException.update({
          where: { id },
          data: { state, version: { increment: 1 } },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
  };
}
