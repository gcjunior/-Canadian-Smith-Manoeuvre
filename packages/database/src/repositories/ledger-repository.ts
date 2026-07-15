import type { LedgerAccountCategory, LedgerEntry, LedgerEntryDirection } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface LedgerAppendInput {
  accountId: string;
  cycleId?: string;
  strategyId?: string;
  interestCycleId?: string;
  businessEventId: string;
  direction: LedgerEntryDirection;
  amountCents: bigint;
  currencyCode?: string;
  accountCategory: LedgerAccountCategory;
  providerRefType?: string;
  providerRefId?: string;
  reversesBusinessEventId?: string;
  correlationId: string;
  narrative: string;
}

export interface LedgerSumFilter {
  from?: Date;
  to?: Date;
  strategyId?: string;
  cycleId?: string;
  interestCycleId?: string;
}

/**
 * Append-only ledger repository. No update/delete methods are provided.
 */
export interface LedgerRepository {
  append(tenantId: string, entries: LedgerAppendInput[]): Promise<LedgerEntry[]>;
  listByCycle(tenantId: string, cycleId: string): Promise<LedgerEntry[]>;
  listByInterestCycle(tenantId: string, interestCycleId: string): Promise<LedgerEntry[]>;
  listByTenant(tenantId: string, range?: { from?: Date; to?: Date }): Promise<LedgerEntry[]>;
  listByProviderRef(
    tenantId: string,
    providerRefType: string,
    providerRefId: string,
  ): Promise<LedgerEntry[]>;
  listByStrategyAccounts(tenantId: string, accountIds: string[]): Promise<LedgerEntry[]>;
  findByBusinessEventId(tenantId: string, businessEventId: string): Promise<LedgerEntry | null>;
  sumDebitsAndCredits(
    tenantId: string,
    filter?: LedgerSumFilter,
  ): Promise<{ debitCents: bigint; creditCents: bigint }>;
}

export function createLedgerRepository(db: DbClient): LedgerRepository {
  return {
    async append(tenantId, entries) {
      try {
        const created: LedgerEntry[] = [];
        for (const entry of entries) {
          created.push(
            await db.ledgerEntry.create({
              data: {
                tenantId,
                accountId: entry.accountId,
                businessEventId: entry.businessEventId,
                direction: entry.direction,
                amountCents: entry.amountCents,
                currencyCode: entry.currencyCode ?? 'CAD',
                accountCategory: entry.accountCategory,
                correlationId: entry.correlationId,
                narrative: entry.narrative,
                ...(entry.cycleId !== undefined ? { cycleId: entry.cycleId } : {}),
                ...(entry.strategyId !== undefined ? { strategyId: entry.strategyId } : {}),
                ...(entry.interestCycleId !== undefined
                  ? { interestCycleId: entry.interestCycleId }
                  : {}),
                ...(entry.providerRefType !== undefined
                  ? { providerRefType: entry.providerRefType }
                  : {}),
                ...(entry.providerRefId !== undefined
                  ? { providerRefId: entry.providerRefId }
                  : {}),
                ...(entry.reversesBusinessEventId !== undefined
                  ? { reversesBusinessEventId: entry.reversesBusinessEventId }
                  : {}),
              },
            }),
          );
        }
        return created;
      } catch (error) {
        mapPrismaError(error);
      }
    },
    listByCycle(tenantId, cycleId) {
      return db.ledgerEntry.findMany({
        where: { tenantId, cycleId },
        orderBy: { createdAt: 'asc' },
      });
    },
    listByInterestCycle(tenantId, interestCycleId) {
      return db.ledgerEntry.findMany({
        where: { tenantId, interestCycleId },
        orderBy: { createdAt: 'asc' },
      });
    },
    listByTenant(tenantId, range) {
      return db.ledgerEntry.findMany({
        where: {
          tenantId,
          ...(range?.from !== undefined || range?.to !== undefined
            ? {
                createdAt: {
                  ...(range.from !== undefined ? { gte: range.from } : {}),
                  ...(range.to !== undefined ? { lte: range.to } : {}),
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'asc' },
      });
    },
    listByProviderRef(tenantId, providerRefType, providerRefId) {
      return db.ledgerEntry.findMany({
        where: { tenantId, providerRefType, providerRefId },
        orderBy: { createdAt: 'asc' },
      });
    },
    listByStrategyAccounts(tenantId, accountIds) {
      return db.ledgerEntry.findMany({
        where: { tenantId, accountId: { in: accountIds } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    },
    findByBusinessEventId(tenantId, businessEventId) {
      return db.ledgerEntry.findUnique({
        where: { tenantId_businessEventId: { tenantId, businessEventId } },
      });
    },
    async sumDebitsAndCredits(tenantId, filter) {
      const where = {
        tenantId,
        ...(filter?.strategyId !== undefined ? { strategyId: filter.strategyId } : {}),
        ...(filter?.cycleId !== undefined ? { cycleId: filter.cycleId } : {}),
        ...(filter?.interestCycleId !== undefined
          ? { interestCycleId: filter.interestCycleId }
          : {}),
        ...(filter?.from !== undefined || filter?.to !== undefined
          ? {
              createdAt: {
                ...(filter?.from !== undefined ? { gte: filter.from } : {}),
                ...(filter?.to !== undefined ? { lte: filter.to } : {}),
              },
            }
          : {}),
      };
      const [debits, credits] = await Promise.all([
        db.ledgerEntry.aggregate({
          where: { ...where, direction: 'DEBIT' },
          _sum: { amountCents: true },
        }),
        db.ledgerEntry.aggregate({
          where: { ...where, direction: 'CREDIT' },
          _sum: { amountCents: true },
        }),
      ]);
      return {
        debitCents: debits._sum.amountCents ?? 0n,
        creditCents: credits._sum.amountCents ?? 0n,
      };
    },
  };
}
