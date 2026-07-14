import type { User } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface UserRepository {
  create(
    tenantId: string,
    input: { email: string; displayName: string; passwordHash?: string },
  ): Promise<User>;
  findById(tenantId: string, userId: string): Promise<User | null>;
  findByEmail(tenantId: string, email: string): Promise<User | null>;
}

export function createUserRepository(db: DbClient): UserRepository {
  return {
    async create(tenantId, input) {
      try {
        return await db.user.create({
          data: {
            tenantId,
            email: input.email,
            displayName: input.displayName,
            ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findById(tenantId, userId) {
      return db.user.findFirst({ where: { id: userId, tenantId } });
    },
    findByEmail(tenantId, email) {
      return db.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
    },
  };
}
