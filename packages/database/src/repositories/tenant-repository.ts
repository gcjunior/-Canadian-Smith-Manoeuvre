import type { Tenant } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface TenantRepository {
  create(input: { slug: string; name: string }): Promise<Tenant>;
  findById(tenantId: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
}

export function createTenantRepository(db: DbClient): TenantRepository {
  return {
    async create(input) {
      try {
        return await db.tenant.create({ data: input });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findById(tenantId) {
      return db.tenant.findUnique({ where: { id: tenantId } });
    },
    findBySlug(slug) {
      return db.tenant.findUnique({ where: { slug } });
    },
  };
}
