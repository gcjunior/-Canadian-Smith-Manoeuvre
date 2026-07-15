import type {
  Reconciliation,
  ReconciliationItem,
  ReconciliationItemResult,
  ReconciliationKind,
  ReconciliationState,
} from '@prisma/client';
import { DomainError } from '@csm/domain';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface ReconciliationItemInput {
  code: string;
  result: ReconciliationItemResult;
  expectedValue?: string | null;
  actualValue?: string | null;
  detail?: string | null;
}

export interface ReconciliationRepository {
  create(
    tenantId: string,
    input: {
      strategyId: string;
      cycleId?: string;
      interestCycleId?: string;
      kind?: ReconciliationKind;
      correlationId: string;
      state?: ReconciliationState;
      summary?: string | null;
    },
  ): Promise<Reconciliation>;
  findByCycle(tenantId: string, cycleId: string): Promise<Reconciliation | null>;
  findByInterestCycle(tenantId: string, interestCycleId: string): Promise<Reconciliation | null>;
  findByKindSince(
    tenantId: string,
    kind: ReconciliationKind,
    since: Date,
  ): Promise<Reconciliation[]>;
  complete(
    tenantId: string,
    id: string,
    version: number,
    state: Extract<ReconciliationState, 'PASSED' | 'FAILED'>,
    summary: string,
    items: ReconciliationItemInput[],
  ): Promise<{ reconciliation: Reconciliation; items: ReconciliationItem[] }>;
}

export function createReconciliationRepository(db: DbClient): ReconciliationRepository {
  return {
    async create(tenantId, input) {
      try {
        return await db.reconciliation.create({
          data: {
            tenantId,
            strategyId: input.strategyId,
            correlationId: input.correlationId,
            state: input.state ?? 'PENDING',
            kind: input.kind ?? 'MONTHLY_CONVERSION',
            ...(input.cycleId !== undefined ? { cycleId: input.cycleId } : {}),
            ...(input.interestCycleId !== undefined
              ? { interestCycleId: input.interestCycleId }
              : {}),
            ...(input.summary !== undefined ? { summary: input.summary } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findByCycle(tenantId, cycleId) {
      return db.reconciliation.findFirst({
        where: { tenantId, cycleId },
        orderBy: { createdAt: 'desc' },
      });
    },
    findByInterestCycle(tenantId, interestCycleId) {
      return db.reconciliation.findFirst({
        where: { tenantId, interestCycleId },
        orderBy: { createdAt: 'desc' },
      });
    },
    findByKindSince(tenantId, kind, since) {
      return db.reconciliation.findMany({
        where: {
          tenantId,
          kind,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'asc' },
      });
    },
    async complete(tenantId, id, version, state, summary, items) {
      try {
        const updated = await db.reconciliation.updateMany({
          where: { id, tenantId, version },
          data: {
            state,
            summary,
            completedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (updated.count === 0) {
          throw new DomainError(
            'OPTIMISTIC_CONCURRENCY_CONFLICT',
            'Reconciliation version conflict',
          );
        }
        const createdItems: ReconciliationItem[] = [];
        for (const item of items) {
          createdItems.push(
            await db.reconciliationItem.create({
              data: {
                tenantId,
                reconciliationId: id,
                code: item.code,
                result: item.result,
                ...(item.expectedValue !== undefined ? { expectedValue: item.expectedValue } : {}),
                ...(item.actualValue !== undefined ? { actualValue: item.actualValue } : {}),
                ...(item.detail !== undefined ? { detail: item.detail } : {}),
              },
            }),
          );
        }
        const reconciliation = await db.reconciliation.findFirst({ where: { id, tenantId } });
        if (!reconciliation) {
          throw new DomainError('NOT_FOUND', 'Reconciliation not found');
        }
        return { reconciliation, items: createdItems };
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        mapPrismaError(error);
      }
    },
  };
}
