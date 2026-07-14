import { DomainError } from '@csm/domain';
import type { IdempotencyRecord, IdempotencyRecordState, Prisma } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface IdempotencyRepository {
  create(
    tenantId: string,
    input: { scope: string; key: string; requestHash: string },
  ): Promise<IdempotencyRecord>;
  find(tenantId: string, scope: string, key: string): Promise<IdempotencyRecord | null>;
  complete(
    tenantId: string,
    id: string,
    version: number,
    responseBody: Prisma.InputJsonValue,
  ): Promise<void>;
}

export function createIdempotencyRepository(db: DbClient): IdempotencyRepository {
  return {
    async create(tenantId, input) {
      try {
        return await db.idempotencyRecord.create({
          data: {
            tenantId,
            scope: input.scope,
            key: input.key,
            requestHash: input.requestHash,
            state: 'IN_PROGRESS' satisfies IdempotencyRecordState,
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    find(tenantId, scope, key) {
      return db.idempotencyRecord.findUnique({
        where: { tenantId_scope_key: { tenantId, scope, key } },
      });
    },
    async complete(tenantId, id, version, responseBody) {
      const updated = await db.idempotencyRecord.updateMany({
        where: { id, tenantId, version },
        data: {
          state: 'COMPLETED',
          responseBody,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new DomainError('OPTIMISTIC_CONCURRENCY_CONFLICT', 'Idempotency version conflict');
      }
    },
  };
}
