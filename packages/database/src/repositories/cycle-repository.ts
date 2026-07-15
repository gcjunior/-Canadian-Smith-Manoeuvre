import { assertCycleTransition } from '@csm/contracts';
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
  listForStrategy(tenantId: string, strategyId: string): Promise<MonthlyConversionCycle[]>;
  updateState(
    tenantId: string,
    cycleId: string,
    version: number,
    from: MonthlyConversionCycleState,
    to: MonthlyConversionCycleState,
  ): Promise<MonthlyConversionCycle>;
  patchFields(
    tenantId: string,
    cycleId: string,
    version: number,
    patch: {
      mortgagePaymentId?: string | null;
      principalRepaidCents?: bigint | null;
      newlyAvailableCreditCents?: bigint | null;
      drawAmountCents?: bigint | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
    },
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
    listForStrategy(tenantId, strategyId) {
      return db.monthlyConversionCycle.findMany({
        where: { tenantId, strategyId },
        orderBy: { paymentPeriod: 'desc' },
      });
    },
    async updateState(tenantId, cycleId, version, from, to) {
      assertCycleTransition(from, to);
      const updated = await db.monthlyConversionCycle.updateMany({
        where: { id: cycleId, tenantId, version, state: from },
        data: {
          state: to,
          version: { increment: 1 },
          ...(to === 'COMPLETED' ? { completedAt: new Date() } : {}),
        },
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
    async patchFields(tenantId, cycleId, version, patch) {
      const updated = await db.monthlyConversionCycle.updateMany({
        where: { id: cycleId, tenantId, version },
        data: {
          version: { increment: 1 },
          ...(patch.mortgagePaymentId !== undefined
            ? { mortgagePaymentId: patch.mortgagePaymentId }
            : {}),
          ...(patch.principalRepaidCents !== undefined
            ? { principalRepaidCents: patch.principalRepaidCents }
            : {}),
          ...(patch.newlyAvailableCreditCents !== undefined
            ? { newlyAvailableCreditCents: patch.newlyAvailableCreditCents }
            : {}),
          ...(patch.drawAmountCents !== undefined
            ? { drawAmountCents: patch.drawAmountCents }
            : {}),
          ...(patch.failureCode !== undefined ? { failureCode: patch.failureCode } : {}),
          ...(patch.failureMessage !== undefined ? { failureMessage: patch.failureMessage } : {}),
          ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
          ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        },
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
