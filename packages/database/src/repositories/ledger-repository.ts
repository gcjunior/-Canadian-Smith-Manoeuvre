import type { LedgerEntry, LedgerEntryDirection } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface LedgerAppendInput {
  accountId: string;
  cycleId?: string;
  businessEventId: string;
  direction: LedgerEntryDirection;
  amountCents: bigint;
  correlationId: string;
  narrative: string;
}

/**
 * Append-only ledger repository. No update/delete methods are provided.
 */
export interface LedgerRepository {
  append(tenantId: string, entries: LedgerAppendInput[]): Promise<LedgerEntry[]>;
  listByCycle(tenantId: string, cycleId: string): Promise<LedgerEntry[]>;
  findByBusinessEventId(tenantId: string, businessEventId: string): Promise<LedgerEntry | null>;
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
                ...(entry.cycleId !== undefined ? { cycleId: entry.cycleId } : {}),
                businessEventId: entry.businessEventId,
                direction: entry.direction,
                amountCents: entry.amountCents,
                correlationId: entry.correlationId,
                narrative: entry.narrative,
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
    findByBusinessEventId(tenantId, businessEventId) {
      return db.ledgerEntry.findUnique({
        where: { tenantId_businessEventId: { tenantId, businessEventId } },
      });
    },
  };
}
