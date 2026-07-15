import type { AuditActorType, AuditDocument, Prisma } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface AuditRepository {
  create(
    tenantId: string,
    input: {
      actorType: AuditActorType;
      actorId?: string;
      action: string;
      resourceType: string;
      resourceId?: string;
      correlationId?: string;
      payloadRedacted: Prisma.InputJsonValue;
    },
  ): Promise<AuditDocument>;
}

export function createAuditRepository(db: DbClient): AuditRepository {
  return {
    async create(tenantId, input) {
      try {
        return await db.auditDocument.create({
          data: {
            tenantId,
            actorType: input.actorType,
            action: input.action,
            resourceType: input.resourceType,
            payloadRedacted: input.payloadRedacted,
            ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
            ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
            ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
  };
}
