import type { Prisma, PrismaClient } from '@prisma/client';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type TransactionFn<T> = (tx: Prisma.TransactionClient) => Promise<T>;

export async function withTransaction<T>(
  prisma: PrismaClient,
  fn: TransactionFn<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  },
): Promise<T> {
  return prisma.$transaction(fn, options);
}
