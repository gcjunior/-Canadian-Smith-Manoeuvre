import type { PrismaClient } from '@prisma/client';

export async function checkDatabaseHealth(client: PrismaClient): Promise<void> {
  await client.$queryRaw`SELECT 1`;
}
