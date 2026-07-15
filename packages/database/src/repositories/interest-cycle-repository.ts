import { assertInterestCycleTransition } from '@csm/contracts';
import { asPaymentPeriod, DomainError } from '@csm/domain';
import type { InterestCycle, InterestCycleState } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface InterestCycleRepository {
  create(
    tenantId: string,
    input: {
      strategyId: string;
      interestPeriod: string;
      correlationId: string;
      state?: InterestCycleState;
    },
  ): Promise<InterestCycle>;
  findById(tenantId: string, cycleId: string): Promise<InterestCycle | null>;
  findByPeriod(
    tenantId: string,
    strategyId: string,
    interestPeriod: string,
  ): Promise<InterestCycle | null>;
  listForStrategy(tenantId: string, strategyId: string): Promise<InterestCycle[]>;
  updateState(
    tenantId: string,
    cycleId: string,
    version: number,
    from: InterestCycleState,
    to: InterestCycleState,
  ): Promise<InterestCycle>;
  patchFields(
    tenantId: string,
    cycleId: string,
    version: number,
    patch: {
      chargeId?: string | null;
      paymentId?: string | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
    },
  ): Promise<InterestCycle>;
}

export function createInterestCycleRepository(db: DbClient): InterestCycleRepository {
  return {
    async create(tenantId, input) {
      const interestPeriod = asPaymentPeriod(input.interestPeriod);
      try {
        return await db.interestCycle.create({
          data: {
            tenantId,
            strategyId: input.strategyId,
            interestPeriod,
            correlationId: input.correlationId,
            state: input.state ?? 'SCHEDULED',
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findById(tenantId, cycleId) {
      return db.interestCycle.findFirst({ where: { id: cycleId, tenantId } });
    },
    findByPeriod(tenantId, strategyId, interestPeriod) {
      return db.interestCycle.findUnique({
        where: {
          tenantId_strategyId_interestPeriod: {
            tenantId,
            strategyId,
            interestPeriod,
          },
        },
      });
    },
    listForStrategy(tenantId, strategyId) {
      return db.interestCycle.findMany({
        where: { tenantId, strategyId },
        orderBy: { interestPeriod: 'desc' },
      });
    },
    async updateState(tenantId, cycleId, version, from, to) {
      assertInterestCycleTransition(from, to);
      const updated = await db.interestCycle.updateMany({
        where: { id: cycleId, tenantId, version, state: from },
        data: {
          state: to,
          version: { increment: 1 },
          ...(to === 'COMPLETED' ? { completedAt: new Date() } : {}),
        },
      });
      if (updated.count === 0) {
        throw new DomainError('OPTIMISTIC_CONCURRENCY_CONFLICT', 'Interest cycle version conflict');
      }
      const cycle = await db.interestCycle.findFirst({ where: { id: cycleId, tenantId } });
      if (!cycle) {
        throw new DomainError('NOT_FOUND', 'Interest cycle not found');
      }
      return cycle;
    },
    async patchFields(tenantId, cycleId, version, patch) {
      const updated = await db.interestCycle.updateMany({
        where: { id: cycleId, tenantId, version },
        data: {
          version: { increment: 1 },
          ...(patch.chargeId !== undefined ? { chargeId: patch.chargeId } : {}),
          ...(patch.paymentId !== undefined ? { paymentId: patch.paymentId } : {}),
          ...(patch.failureCode !== undefined ? { failureCode: patch.failureCode } : {}),
          ...(patch.failureMessage !== undefined ? { failureMessage: patch.failureMessage } : {}),
          ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
          ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        },
      });
      if (updated.count === 0) {
        throw new DomainError('OPTIMISTIC_CONCURRENCY_CONFLICT', 'Interest cycle version conflict');
      }
      const cycle = await db.interestCycle.findFirst({ where: { id: cycleId, tenantId } });
      if (!cycle) {
        throw new DomainError('NOT_FOUND', 'Interest cycle not found');
      }
      return cycle;
    },
  };
}
