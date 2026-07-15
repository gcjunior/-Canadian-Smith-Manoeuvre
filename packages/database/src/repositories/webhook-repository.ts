import type { Prisma, ProviderWebhookEvent, WebhookProcessingState } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export const WEBHOOK_MAX_ATTEMPTS = 8;

export interface WebhookRepository {
  create(
    tenantId: string,
    input: {
      provider: string;
      providerEventId: string;
      eventType: string;
      payloadRedacted: Prisma.InputJsonValue;
      financialAccountId?: string;
      nextAttemptAt?: Date;
      processingState?: WebhookProcessingState;
      deadLetterReason?: string;
      outcome?: string;
      lastError?: string;
    },
  ): Promise<ProviderWebhookEvent>;
  findByProviderEvent(
    tenantId: string,
    provider: string,
    providerEventId: string,
  ): Promise<ProviderWebhookEvent | null>;
  findById(tenantId: string, id: string): Promise<ProviderWebhookEvent | null>;
  /** Claim due RECEIVED/RETRYABLE rows for processing (SKIP LOCKED). */
  claimDue(limit: number, now?: Date): Promise<ProviderWebhookEvent[]>;
  markProcessed(
    tenantId: string,
    id: string,
    outcome: string,
    patch?: {
      strategyId?: string;
      paymentPeriod?: string;
    },
  ): Promise<ProviderWebhookEvent>;
  markRetained(
    tenantId: string,
    id: string,
    outcome: string,
    patch?: { strategyId?: string; paymentPeriod?: string },
  ): Promise<ProviderWebhookEvent>;
  markRetryable(
    tenantId: string,
    id: string,
    attempts: number,
    nextAttemptAt: Date,
    lastError: string,
  ): Promise<ProviderWebhookEvent>;
  markDeadLetter(
    tenantId: string,
    id: string,
    reason: string,
    lastError?: string,
  ): Promise<ProviderWebhookEvent>;
}

function backoffMs(attempts: number): number {
  const base = Math.min(2 ** attempts * 1_000, 5 * 60_000);
  return base;
}

export function nextWebhookAttemptAt(attempts: number, from = new Date()): Date {
  return new Date(from.getTime() + backoffMs(attempts));
}

export function createWebhookRepository(db: DbClient): WebhookRepository {
  return {
    async create(tenantId, input) {
      try {
        const state = input.processingState ?? 'RECEIVED';
        return await db.providerWebhookEvent.create({
          data: {
            tenantId,
            provider: input.provider,
            providerEventId: input.providerEventId,
            eventType: input.eventType,
            payloadRedacted: input.payloadRedacted,
            processingState: state,
            nextAttemptAt:
              state === 'RECEIVED' || state === 'RETRYABLE'
                ? (input.nextAttemptAt ?? new Date())
                : null,
            ...(input.financialAccountId !== undefined
              ? { financialAccountId: input.financialAccountId }
              : {}),
            ...(input.deadLetterReason !== undefined
              ? { deadLetterReason: input.deadLetterReason }
              : {}),
            ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
            ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
            ...(state === 'DEAD_LETTERED' || state === 'PROCESSED' || state === 'RETAINED'
              ? { processedAt: new Date() }
              : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },

    findByProviderEvent(tenantId, provider, providerEventId) {
      return db.providerWebhookEvent.findUnique({
        where: {
          tenantId_provider_providerEventId: { tenantId, provider, providerEventId },
        },
      });
    },

    findById(tenantId, id) {
      return db.providerWebhookEvent.findFirst({ where: { tenantId, id } });
    },

    async claimDue(limit, now = new Date()) {
      // Atomic claim via raw SQL with SKIP LOCKED for concurrent API replicas.
      const rows = await db.$queryRaw<Array<{ id: string; tenant_id: string }>>`
        UPDATE provider_webhook_events AS e
        SET processing_state = 'PROCESSING'::"WebhookProcessingState",
            attempts = e.attempts + 1,
            updated_at = ${now}
        WHERE e.id IN (
          SELECT id FROM provider_webhook_events
          WHERE processing_state IN (
            'RECEIVED'::"WebhookProcessingState",
            'RETRYABLE'::"WebhookProcessingState"
          )
            AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
          ORDER BY received_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        RETURNING e.id, e.tenant_id
      `;
      if (rows.length === 0) {
        return [];
      }
      return db.providerWebhookEvent.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
    },

    async markProcessed(tenantId, id, outcome, patch) {
      try {
        return await db.providerWebhookEvent.update({
          where: { id_tenantId: { id, tenantId } },
          data: {
            processingState: 'PROCESSED' satisfies WebhookProcessingState,
            processedAt: new Date(),
            outcome,
            lastError: null,
            nextAttemptAt: null,
            ...(patch?.strategyId !== undefined ? { strategyId: patch.strategyId } : {}),
            ...(patch?.paymentPeriod !== undefined ? { paymentPeriod: patch.paymentPeriod } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },

    async markRetained(tenantId, id, outcome, patch) {
      try {
        return await db.providerWebhookEvent.update({
          where: { id_tenantId: { id, tenantId } },
          data: {
            processingState: 'RETAINED' satisfies WebhookProcessingState,
            processedAt: new Date(),
            outcome,
            lastError: null,
            nextAttemptAt: null,
            ...(patch?.strategyId !== undefined ? { strategyId: patch.strategyId } : {}),
            ...(patch?.paymentPeriod !== undefined ? { paymentPeriod: patch.paymentPeriod } : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },

    async markRetryable(tenantId, id, attempts, nextAttemptAt, lastError) {
      try {
        return await db.providerWebhookEvent.update({
          where: { id_tenantId: { id, tenantId } },
          data: {
            processingState: 'RETRYABLE' satisfies WebhookProcessingState,
            attempts,
            nextAttemptAt,
            lastError: lastError.slice(0, 2000),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },

    async markDeadLetter(tenantId, id, reason, lastError) {
      try {
        return await db.providerWebhookEvent.update({
          where: { id_tenantId: { id, tenantId } },
          data: {
            processingState: 'DEAD_LETTERED' satisfies WebhookProcessingState,
            deadLetterReason: reason.slice(0, 500),
            lastError: lastError?.slice(0, 2000) ?? null,
            processedAt: new Date(),
            nextAttemptAt: null,
            outcome: 'DEAD_LETTER',
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
  };
}
