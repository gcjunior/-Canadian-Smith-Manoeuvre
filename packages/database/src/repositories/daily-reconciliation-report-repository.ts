import type { DailyReconciliationReport, Prisma } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface DailyReconciliationReportUpsertInput {
  reportDate: Date;
  conversionPassedCount: number;
  conversionFailedCount: number;
  interestPassedCount: number;
  interestFailedCount: number;
  ledgerDebitCents: bigint;
  ledgerCreditCents: bigint;
  ledgerBalanced: boolean;
  summaryJson: Record<string, unknown>;
}

export interface DailyReconciliationReportRepository {
  upsertByDate(
    tenantId: string,
    input: DailyReconciliationReportUpsertInput,
  ): Promise<DailyReconciliationReport>;
  findByDate(tenantId: string, reportDate: Date): Promise<DailyReconciliationReport | null>;
  listForTenant(tenantId: string): Promise<DailyReconciliationReport[]>;
}

function asUtcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function createDailyReconciliationReportRepository(
  db: DbClient,
): DailyReconciliationReportRepository {
  return {
    async upsertByDate(tenantId, input) {
      try {
        const reportDate = asUtcDateOnly(input.reportDate);
        return await db.dailyReconciliationReport.upsert({
          where: {
            tenantId_reportDate: { tenantId, reportDate },
          },
          create: {
            tenantId,
            reportDate,
            conversionPassedCount: input.conversionPassedCount,
            conversionFailedCount: input.conversionFailedCount,
            interestPassedCount: input.interestPassedCount,
            interestFailedCount: input.interestFailedCount,
            ledgerDebitCents: input.ledgerDebitCents,
            ledgerCreditCents: input.ledgerCreditCents,
            ledgerBalanced: input.ledgerBalanced,
            summaryJson: input.summaryJson as Prisma.InputJsonValue,
          },
          update: {
            conversionPassedCount: input.conversionPassedCount,
            conversionFailedCount: input.conversionFailedCount,
            interestPassedCount: input.interestPassedCount,
            interestFailedCount: input.interestFailedCount,
            ledgerDebitCents: input.ledgerDebitCents,
            ledgerCreditCents: input.ledgerCreditCents,
            ledgerBalanced: input.ledgerBalanced,
            summaryJson: input.summaryJson as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findByDate(tenantId, reportDate) {
      return db.dailyReconciliationReport.findUnique({
        where: {
          tenantId_reportDate: {
            tenantId,
            reportDate: asUtcDateOnly(reportDate),
          },
        },
      });
    },
    listForTenant(tenantId) {
      return db.dailyReconciliationReport.findMany({
        where: { tenantId },
        orderBy: { reportDate: 'desc' },
      });
    },
  };
}
