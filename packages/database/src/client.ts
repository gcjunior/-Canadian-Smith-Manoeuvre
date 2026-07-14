import { PrismaClient } from '@prisma/client';

export type { PrismaClient };

let prisma: PrismaClient | undefined;

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const log: Array<'warn' | 'error'> =
    process.env.NODE_ENV === 'test'
      ? []
      : process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'];

  if (databaseUrl !== undefined) {
    return new PrismaClient({
      datasources: {
        db: { url: databaseUrl },
      },
      log,
    });
  }

  return new PrismaClient({ log });
}

export function getPrismaClient(databaseUrl?: string): PrismaClient {
  if (!prisma) {
    prisma = createPrismaClient(databaseUrl);
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
