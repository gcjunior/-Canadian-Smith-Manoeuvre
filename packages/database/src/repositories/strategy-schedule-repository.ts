import type { Prisma, StrategySchedule } from '@prisma/client';

import type { DbClient } from '../transaction.js';

export interface StrategyScheduleRepository {
  findByStrategy(tenantId: string, strategyId: string): Promise<StrategySchedule | null>;
  findByTemporalId(tenantId: string, temporalScheduleId: string): Promise<StrategySchedule | null>;
  listForTenant(tenantId: string): Promise<StrategySchedule[]>;
  listActiveRefs(tenantId: string): Promise<StrategySchedule[]>;
  upsert(
    tenantId: string,
    data: {
      strategyId: string;
      temporalScheduleId: string;
      temporalInterestScheduleId?: string | null;
      temporalNamespace: string;
      paused: boolean;
      timezone: string;
      expectedPaymentDay: number;
      expectedInterestChargeDay?: number;
    },
  ): Promise<StrategySchedule>;
  markPaused(
    tenantId: string,
    strategyId: string,
    paused: boolean,
  ): Promise<StrategySchedule | null>;
  softDelete(tenantId: string, strategyId: string): Promise<StrategySchedule | null>;
  deleteHard(tenantId: string, strategyId: string): Promise<void>;
}

export function createStrategyScheduleRepository(db: DbClient): StrategyScheduleRepository {
  return {
    async findByStrategy(tenantId, strategyId) {
      return db.strategySchedule.findFirst({
        where: { tenantId, strategyId, deletedAt: null },
      });
    },

    async findByTemporalId(tenantId, temporalScheduleId) {
      return db.strategySchedule.findFirst({
        where: { tenantId, temporalScheduleId, deletedAt: null },
      });
    },

    async listForTenant(tenantId) {
      return db.strategySchedule.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
    },

    async listActiveRefs(tenantId) {
      return db.strategySchedule.findMany({
        where: { tenantId, deletedAt: null },
      });
    },

    async upsert(tenantId, data) {
      const existing = await db.strategySchedule.findUnique({
        where: {
          tenantId_strategyId: { tenantId, strategyId: data.strategyId },
        },
      });
      if (existing) {
        return db.strategySchedule.update({
          where: { id: existing.id },
          data: {
            temporalScheduleId: data.temporalScheduleId,
            temporalNamespace: data.temporalNamespace,
            paused: data.paused,
            timezone: data.timezone,
            expectedPaymentDay: data.expectedPaymentDay,
            ...(data.temporalInterestScheduleId !== undefined
              ? { temporalInterestScheduleId: data.temporalInterestScheduleId }
              : {}),
            ...(data.expectedInterestChargeDay !== undefined
              ? { expectedInterestChargeDay: data.expectedInterestChargeDay }
              : {}),
            deletedAt: null,
            version: { increment: 1 },
          },
        });
      }
      return db.strategySchedule.create({
        data: {
          tenantId,
          strategyId: data.strategyId,
          temporalScheduleId: data.temporalScheduleId,
          temporalNamespace: data.temporalNamespace,
          paused: data.paused,
          timezone: data.timezone,
          expectedPaymentDay: data.expectedPaymentDay,
          ...(data.temporalInterestScheduleId !== undefined
            ? { temporalInterestScheduleId: data.temporalInterestScheduleId }
            : {}),
          expectedInterestChargeDay: data.expectedInterestChargeDay ?? 1,
        },
      });
    },

    async markPaused(tenantId, strategyId, paused) {
      const row = await db.strategySchedule.findFirst({
        where: { tenantId, strategyId, deletedAt: null },
      });
      if (!row) {
        return null;
      }
      return db.strategySchedule.update({
        where: { id: row.id },
        data: { paused, version: { increment: 1 } },
      });
    },

    async softDelete(tenantId, strategyId) {
      const row = await db.strategySchedule.findFirst({
        where: { tenantId, strategyId, deletedAt: null },
      });
      if (!row) {
        return null;
      }
      return db.strategySchedule.update({
        where: { id: row.id },
        data: {
          deletedAt: new Date(),
          paused: true,
          version: { increment: 1 },
        },
      });
    },

    async deleteHard(tenantId, strategyId) {
      await db.strategySchedule.deleteMany({ where: { tenantId, strategyId } });
    },
  };
}

export type { StrategySchedule };
export type StrategyScheduleCreate = Prisma.StrategyScheduleCreateInput;
