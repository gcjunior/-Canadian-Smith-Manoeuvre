import { asPaymentPeriod, DomainError } from '@csm/domain';
import type { MonthlyConversionCycle, MonthlyConversionCycleState } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface CycleRepository {
  create(
    tenantId: string,
    input: {
      strategyId: string;
      paymentPeriod: string;
      correlationId: string;
      state?: MonthlyConversionCycleState;
    },
  ): Promise<MonthlyConversionCycle>;
  findById(tenantId: string, cycleId: string): Promise<MonthlyConversionCycle | null>;
  findByPeriod(
    tenantId: string,
    strategyId: string,
    paymentPeriod: string,
  ): Promise<MonthlyConversionCycle | null>;
  updateState(
    tenantId: string,
    cycleId: string,
    version: number,
    state: MonthlyConversionCycleState,
  ): Promise<MonthlyConversionCycle>;
}

export function createCycleRepository(db: DbClient): CycleRepository {
  return {
    async create(tenantId, input) {
      const paymentPeriod = asPaymentPeriod(input.paymentPeriod);
      try {
        return await db.monthlyConversionCycle.create({
          data: {
            tenantId,
            strategyId: input.strategyId,
            paymentPeriod,
            correlationId: input.correlationId,
            state: input.state ?? 'SCHEDULED',
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findById(tenantId, cycleId) {
      return db.monthlyConversionCycle.findFirst({ where: { id: cycleId, tenantId } });
    },
    findByPeriod(tenantId, strategyId, paymentPeriod) {
      return db.monthlyConversionCycle.findUnique({
        where: {
          tenantId_strategyId_paymentPeriod: {
            tenantId,
            strategyId,
            paymentPeriod,
          },
        },
      });
    },
    async updateState(tenantId, cycleId, version, state) {
      const updated = await db.monthlyConversionCycle.updateMany({
        where: { id: cycleId, tenantId, version },
        data: { state, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new DomainError('OPTIMISTIC_CONCURRENCY_CONFLICT', 'Cycle version conflict');
      }
      const cycle = await db.monthlyConversionCycle.findFirst({ where: { id: cycleId, tenantId } });
      if (!cycle) {
        throw new DomainError('NOT_FOUND', 'Cycle not found');
      }
      return cycle;
    },
  };
}
