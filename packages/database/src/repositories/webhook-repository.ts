import type { Prisma, ProviderWebhookEvent } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface WebhookRepository {
  create(
    tenantId: string,
    input: {
      provider: string;
      providerEventId: string;
      eventType: string;
      payloadRedacted: Prisma.InputJsonValue;
    },
  ): Promise<ProviderWebhookEvent>;
  findByProviderEvent(
    tenantId: string,
    provider: string,
    providerEventId: string,
  ): Promise<ProviderWebhookEvent | null>;
}

export function createWebhookRepository(db: DbClient): WebhookRepository {
  return {
    async create(tenantId, input) {
      try {
        return await db.providerWebhookEvent.create({
          data: { tenantId, ...input },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findByProviderEvent(tenantId, provider, providerEventId) {
      return db.providerWebhookEvent.findUnique({
        where: {
          tenantId_provider_providerEventId: { tenantId, provider, providerEventId },
        },
      });
    },
  };
}
