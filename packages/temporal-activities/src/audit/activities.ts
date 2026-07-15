import type { LedgerAppendInput, Repositories } from '@csm/database';
import { categoryForAccountKind } from '@csm/domain';
import type { Logger } from '@csm/observability';
import { redactObject } from '@csm/observability';
import type { LedgerAccountCategory, Prisma } from '@prisma/client';

import type { ActivityContext } from '../shared/context.js';
import { activityLogFields } from '../shared/context.js';
import { nonRetryable } from '../shared/errors.js';
import { mapDomainOrContractError } from '../shared/guards.js';
import {
  assertSnapshotMatchesCtx,
  loadAuthoritativeStrategySnapshot,
} from '../shared/strategy-snapshot.js';

export interface LedgerEntryInput {
  accountId: string;
  businessEventId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountCents: string;
  narrative: string;
  cycleId?: string;
  interestCycleId?: string;
  currencyCode?: string;
  accountCategory?: LedgerAccountCategory;
  strategyId?: string;
  providerRefType?: string;
  providerRefId?: string;
  reversesBusinessEventId?: string;
}

export function createAuditActivities(deps: { logger: Logger; repos: Repositories }) {
  return {
    async appendLedgerEntries(
      ctx: ActivityContext & { entries: LedgerEntryInput[] },
    ): Promise<{ entryIds: string[]; createdCount: number; skippedCount: number }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      if (!ctx.entries.length) {
        nonRetryable('At least one ledger entry required', 'VALIDATION_FAILURE');
      }

      const allowed = new Set([
        snapshot.mortgageAccountId,
        snapshot.helocAccountId,
        snapshot.bankAccountId,
        snapshot.brokerageAccountId,
      ]);

      const entryIds: string[] = [];
      let createdCount = 0;
      let skippedCount = 0;

      for (const entry of ctx.entries) {
        if (!allowed.has(entry.accountId)) {
          nonRetryable('Ledger account not bound to strategy', 'FORBIDDEN', {
            accountId: entry.accountId,
          });
        }
        const amountCents = BigInt(entry.amountCents);
        if (amountCents <= 0n) {
          nonRetryable('Ledger amount must be positive', 'VALIDATION_FAILURE');
        }

        let accountCategory = entry.accountCategory;
        if (!accountCategory) {
          const account = await deps.repos.accounts.findAccountById(ctx.tenantId, entry.accountId);
          if (!account) {
            nonRetryable('Ledger account not found', 'NOT_FOUND', {
              accountId: entry.accountId,
            });
          }
          accountCategory = categoryForAccountKind(account.kind) as LedgerAccountCategory;
        }

        const existing = await deps.repos.ledger.findByBusinessEventId(
          ctx.tenantId,
          entry.businessEventId,
        );
        if (existing) {
          if (
            existing.accountId !== entry.accountId ||
            existing.amountCents !== amountCents ||
            existing.direction !== entry.direction ||
            existing.accountCategory !== accountCategory
          ) {
            nonRetryable(
              'Ledger businessEventId reuse with different payload',
              'DUPLICATE_CONFLICT',
              {
                businessEventId: entry.businessEventId,
              },
            );
          }
          entryIds.push(existing.id);
          skippedCount += 1;
          continue;
        }

        const appendInput: LedgerAppendInput = {
          accountId: entry.accountId,
          businessEventId: entry.businessEventId,
          direction: entry.direction,
          amountCents,
          currencyCode: entry.currencyCode ?? 'CAD',
          accountCategory,
          correlationId: ctx.correlationId,
          narrative: entry.narrative,
          strategyId: entry.strategyId ?? ctx.strategyId,
          ...(entry.cycleId !== undefined
            ? { cycleId: entry.cycleId }
            : ctx.cycleId !== undefined && entry.interestCycleId === undefined
              ? { cycleId: ctx.cycleId }
              : {}),
          ...(entry.interestCycleId !== undefined
            ? { interestCycleId: entry.interestCycleId }
            : {}),
          ...(entry.providerRefType !== undefined
            ? { providerRefType: entry.providerRefType }
            : {}),
          ...(entry.providerRefId !== undefined ? { providerRefId: entry.providerRefId } : {}),
          ...(entry.reversesBusinessEventId !== undefined
            ? { reversesBusinessEventId: entry.reversesBusinessEventId }
            : {}),
        };

        try {
          const created = await deps.repos.ledger.append(ctx.tenantId, [appendInput]);
          const first = created[0];
          if (!first) {
            nonRetryable('Ledger append returned no rows', 'VALIDATION_FAILURE');
          }
          entryIds.push(first.id);
          createdCount += 1;
        } catch (error) {
          mapDomainOrContractError(error);
        }
      }

      deps.logger.info(
        {
          ...activityLogFields(ctx),
          activity: 'appendLedgerEntries',
          createdCount,
          skippedCount,
        },
        'appended ledger entries',
      );

      return { entryIds, createdCount, skippedCount };
    },

    async createAuditPackageMetadata(
      ctx: ActivityContext & {
        packageType: string;
        metadata: Record<string, unknown>;
      },
    ): Promise<{ auditDocumentId: string }> {
      await loadAuthoritativeStrategySnapshot(deps.repos, ctx, { requireActive: false });
      const doc = await deps.repos.audit.create(ctx.tenantId, {
        actorType: 'SYSTEM',
        action: 'AUDIT_PACKAGE',
        resourceType: ctx.packageType,
        ...(ctx.cycleId !== undefined
          ? { resourceId: ctx.cycleId }
          : { resourceId: ctx.strategyId }),
        correlationId: ctx.correlationId,
        payloadRedacted: redactObject({
          tenantId: ctx.tenantId,
          strategyId: ctx.strategyId,
          cycleId: ctx.cycleId,
          paymentPeriod: ctx.paymentPeriod,
          ...ctx.metadata,
        }) as Prisma.InputJsonValue,
      });

      deps.logger.info(
        {
          ...activityLogFields(ctx),
          activity: 'createAuditPackageMetadata',
          auditDocumentId: doc.id,
        },
        'created audit package metadata',
      );

      return { auditDocumentId: doc.id };
    },
  };
}

export type AuditActivities = ReturnType<typeof createAuditActivities>;
