import { asPaymentPeriod, DomainError } from '@csm/domain';
import type {
  HelocInterestCharge,
  HelocInterestChargeState,
  HelocInterestPayment,
  HelocInterestPaymentState,
} from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface InterestRepository {
  upsertCharge(
    tenantId: string,
    input: {
      helocId: string;
      providerChargeId: string;
      interestPeriod: string;
      amountCents: bigint;
      state?: HelocInterestChargeState;
      postedAt?: Date | null;
    },
  ): Promise<HelocInterestCharge>;
  findChargeByPeriod(
    tenantId: string,
    helocId: string,
    interestPeriod: string,
  ): Promise<HelocInterestCharge | null>;
  upsertPayment(
    tenantId: string,
    input: {
      chargeId: string;
      ordinaryBankAccountId: string;
      providerPaymentId: string;
      amountCents: bigint;
      state?: HelocInterestPaymentState;
      providerDebitId?: string | null;
      settledAt?: Date | null;
      failureCode?: string | null;
    },
  ): Promise<HelocInterestPayment>;
  updatePaymentState(
    tenantId: string,
    paymentId: string,
    version: number,
    from: HelocInterestPaymentState,
    to: HelocInterestPaymentState,
    patch?: {
      providerDebitId?: string | null;
      settledAt?: Date | null;
      failureCode?: string | null;
    },
  ): Promise<HelocInterestPayment>;
}

export function createInterestRepository(db: DbClient): InterestRepository {
  return {
    async upsertCharge(tenantId, input) {
      const interestPeriod = asPaymentPeriod(input.interestPeriod);
      try {
        const existing = await db.helocInterestCharge.findUnique({
          where: {
            tenantId_providerChargeId: {
              tenantId,
              providerChargeId: input.providerChargeId,
            },
          },
        });
        if (existing) {
          return db.helocInterestCharge.update({
            where: { id: existing.id },
            data: {
              amountCents: input.amountCents,
              state: input.state ?? existing.state,
              ...(input.postedAt !== undefined ? { postedAt: input.postedAt } : {}),
              version: { increment: 1 },
            },
          });
        }
        return await db.helocInterestCharge.create({
          data: {
            tenantId,
            helocId: input.helocId,
            providerChargeId: input.providerChargeId,
            interestPeriod,
            amountCents: input.amountCents,
            state: input.state ?? 'PENDING',
            ...(input.postedAt !== undefined ? { postedAt: input.postedAt } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findChargeByPeriod(tenantId, helocId, interestPeriod) {
      return db.helocInterestCharge.findUnique({
        where: {
          tenantId_helocId_interestPeriod: {
            tenantId,
            helocId,
            interestPeriod,
          },
        },
      });
    },
    async upsertPayment(tenantId, input) {
      try {
        const existing = await db.helocInterestPayment.findUnique({
          where: {
            tenantId_providerPaymentId: {
              tenantId,
              providerPaymentId: input.providerPaymentId,
            },
          },
        });
        if (existing) {
          return db.helocInterestPayment.update({
            where: { id: existing.id },
            data: {
              amountCents: input.amountCents,
              state: input.state ?? existing.state,
              ...(input.providerDebitId !== undefined
                ? { providerDebitId: input.providerDebitId }
                : {}),
              ...(input.settledAt !== undefined ? { settledAt: input.settledAt } : {}),
              ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
              version: { increment: 1 },
            },
          });
        }
        return await db.helocInterestPayment.create({
          data: {
            tenantId,
            chargeId: input.chargeId,
            ordinaryBankAccountId: input.ordinaryBankAccountId,
            providerPaymentId: input.providerPaymentId,
            amountCents: input.amountCents,
            state: input.state ?? 'PENDING',
            ...(input.providerDebitId !== undefined
              ? { providerDebitId: input.providerDebitId }
              : {}),
            ...(input.settledAt !== undefined ? { settledAt: input.settledAt } : {}),
            ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    async updatePaymentState(tenantId, paymentId, version, from, to, patch) {
      try {
        const updated = await db.helocInterestPayment.updateMany({
          where: { id: paymentId, tenantId, version, state: from },
          data: {
            state: to,
            version: { increment: 1 },
            ...(patch?.providerDebitId !== undefined
              ? { providerDebitId: patch.providerDebitId }
              : {}),
            ...(patch?.settledAt !== undefined ? { settledAt: patch.settledAt } : {}),
            ...(patch?.failureCode !== undefined ? { failureCode: patch.failureCode } : {}),
          },
        });
        if (updated.count === 0) {
          throw new DomainError(
            'OPTIMISTIC_CONCURRENCY_CONFLICT',
            'Interest payment version conflict',
          );
        }
        const payment = await db.helocInterestPayment.findFirst({
          where: { id: paymentId, tenantId },
        });
        if (!payment) {
          throw new DomainError('NOT_FOUND', 'Interest payment not found');
        }
        return payment;
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        mapPrismaError(error);
      }
    },
  };
}
