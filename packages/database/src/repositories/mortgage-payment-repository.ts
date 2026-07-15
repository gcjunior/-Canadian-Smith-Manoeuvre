import type { MortgagePayment, MortgagePaymentState } from '@prisma/client';
import { DomainError } from '@csm/domain';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface MortgagePaymentRepository {
  upsertFromProvider(
    tenantId: string,
    input: {
      mortgageId: string;
      providerPaymentId: string;
      paymentPeriod: string;
      totalAmountCents: bigint;
      principalAmountCents: bigint;
      interestAmountCents: bigint;
      state: MortgagePaymentState;
      settledAt?: Date | null;
    },
  ): Promise<MortgagePayment>;
  findByProviderId(tenantId: string, providerPaymentId: string): Promise<MortgagePayment | null>;
  findByPeriod(
    tenantId: string,
    mortgageId: string,
    paymentPeriod: string,
  ): Promise<MortgagePayment | null>;
}

export function createMortgagePaymentRepository(db: DbClient): MortgagePaymentRepository {
  return {
    async upsertFromProvider(tenantId, input) {
      try {
        const existing = await db.mortgagePayment.findUnique({
          where: {
            tenantId_providerPaymentId: {
              tenantId,
              providerPaymentId: input.providerPaymentId,
            },
          },
        });
        if (existing) {
          return db.mortgagePayment.update({
            where: { id: existing.id },
            data: {
              state: input.state,
              totalAmountCents: input.totalAmountCents,
              principalAmountCents: input.principalAmountCents,
              interestAmountCents: input.interestAmountCents,
              ...(input.settledAt !== undefined ? { settledAt: input.settledAt } : {}),
              version: { increment: 1 },
            },
          });
        }
        return await db.mortgagePayment.create({
          data: {
            tenantId,
            mortgageId: input.mortgageId,
            providerPaymentId: input.providerPaymentId,
            paymentPeriod: input.paymentPeriod,
            totalAmountCents: input.totalAmountCents,
            principalAmountCents: input.principalAmountCents,
            interestAmountCents: input.interestAmountCents,
            state: input.state,
            ...(input.settledAt !== undefined ? { settledAt: input.settledAt } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findByProviderId(tenantId, providerPaymentId) {
      return db.mortgagePayment.findUnique({
        where: { tenantId_providerPaymentId: { tenantId, providerPaymentId } },
      });
    },
    findByPeriod(tenantId, mortgageId, paymentPeriod) {
      return db.mortgagePayment.findFirst({
        where: { tenantId, mortgageId, paymentPeriod },
        orderBy: { createdAt: 'desc' },
      });
    },
  };
}

export function requireMortgagePayment(
  payment: MortgagePayment | null,
  message = 'Mortgage payment not found',
): MortgagePayment {
  if (!payment) {
    throw new DomainError('NOT_FOUND', message);
  }
  return payment;
}
