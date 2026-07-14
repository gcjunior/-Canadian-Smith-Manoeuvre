import { DomainError } from '@csm/domain';
import { Prisma } from '@prisma/client';

export function mapPrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new DomainError('DUPLICATE_ENTITY', 'Unique constraint violated', {
        target: error.meta?.['target'],
      });
    }
    if (error.code === 'P2025') {
      throw new DomainError('NOT_FOUND', 'Record not found');
    }
  }
  throw error;
}
