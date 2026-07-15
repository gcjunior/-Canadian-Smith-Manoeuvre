import { AppError } from '@csm/contracts';
import type { Repositories } from '@csm/database';
import { DomainError } from '@csm/domain';
import type { Logger } from '@csm/observability';
import { ALERT_CODES, csmMetrics, emitAlert, redactObject } from '@csm/observability';

import { verifyHmacSha256 } from '../plugins/raw-body.js';
import { parseWebhookEnvelope } from './webhook-normalize.js';

export type WebhookProvider = 'bank-sim' | 'brokerage-sim';

/**
 * Webhook ingest: verify → parse → persist → ACK quickly.
 * Durable processing (Signal / retain / DLQ / retry) is owned by WebhookProcessor.
 * Signals are wake-up hints only; Activities poll authoritative provider state.
 */
export class WebhookAppService {
  constructor(
    private readonly repos: Repositories,
    private readonly signingSecret: string,
    private readonly logger: Logger,
  ) {}

  async ingest(input: {
    provider: WebhookProvider;
    rawBody: Buffer;
    signatureHeader: string | undefined;
    externalAccountIdHeader: string | undefined;
    correlationId: string;
  }): Promise<{ accepted: true; duplicate: boolean; eventId: string }> {
    if (
      !input.signatureHeader ||
      !verifyHmacSha256(input.rawBody, this.signingSecret, input.signatureHeader)
    ) {
      throw new AppError({
        code: 'MALFORMED_WEBHOOK',
        message: 'Invalid webhook signature',
        correlationId: input.correlationId,
      });
    }

    const envelope = parseWebhookEnvelope(input.rawBody, input.externalAccountIdHeader);

    if (!envelope.externalAccountId) {
      throw new AppError({
        code: 'MALFORMED_WEBHOOK',
        message: 'externalAccountId required (body or x-csm-external-account-id)',
        correlationId: input.correlationId,
      });
    }

    const accounts = await this.repos.accounts.findAccountsByProviderAccountId(
      envelope.externalAccountId,
    );
    if (accounts.length === 0) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: 'No financial account mapped for externalAccountId',
        correlationId: input.correlationId,
      });
    }
    if (accounts.length > 1) {
      const tenantIds = new Set(accounts.map((a) => a.tenantId));
      if (tenantIds.size > 1) {
        emitAlert(this.logger, ALERT_CODES.CROSS_TENANT_AUTHORIZATION, {
          correlationId: input.correlationId,
          kind: 'webhook_external_account_multi_tenant',
          externalAccountId: envelope.externalAccountId,
        });
        throw new AppError({
          code: 'FORBIDDEN',
          message: 'externalAccountId maps to multiple tenants',
          correlationId: input.correlationId,
        });
      }
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'Ambiguous externalAccountId mapping',
        correlationId: input.correlationId,
      });
    }

    const account = accounts[0]!;
    const payloadRedacted = JSON.parse(
      JSON.stringify(
        redactObject({
          type: envelope.eventType,
          eventType: envelope.eventType,
          providerEventId: envelope.providerEventId,
          externalAccountId: envelope.externalAccountId,
          occurredAt: envelope.occurredAt,
          data: envelope.data,
        }),
      ),
    ) as object;

    const markDuplicate = (eventId: string) => {
      csmMetrics.webhookDuplicates.add(1, { provider: input.provider });
      return { accepted: true as const, duplicate: true, eventId };
    };

    if (envelope.permanentlyInvalid) {
      const existingDead = await this.repos.webhooks.findByProviderEvent(
        account.tenantId,
        input.provider,
        envelope.providerEventId,
      );
      if (existingDead) {
        return markDuplicate(existingDead.id);
      }
      const dead = await this.repos.webhooks.create(account.tenantId, {
        provider: input.provider,
        providerEventId: envelope.providerEventId,
        eventType: envelope.eventType,
        payloadRedacted,
        financialAccountId: account.id,
        processingState: 'DEAD_LETTERED',
        deadLetterReason: envelope.invalidReason ?? 'PERMANENTLY_INVALID',
        outcome: 'DEAD_LETTER',
        ...(envelope.invalidReason !== undefined ? { lastError: envelope.invalidReason } : {}),
      });
      return { accepted: true, duplicate: false, eventId: dead.id };
    }

    const existing = await this.repos.webhooks.findByProviderEvent(
      account.tenantId,
      input.provider,
      envelope.providerEventId,
    );
    if (existing) {
      return markDuplicate(existing.id);
    }

    let event;
    try {
      event = await this.repos.webhooks.create(account.tenantId, {
        provider: input.provider,
        providerEventId: envelope.providerEventId,
        eventType: envelope.eventType,
        payloadRedacted,
        financialAccountId: account.id,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'DUPLICATE_ENTITY') {
        const raced = await this.repos.webhooks.findByProviderEvent(
          account.tenantId,
          input.provider,
          envelope.providerEventId,
        );
        if (raced) {
          return markDuplicate(raced.id);
        }
      }
      throw error;
    }

    // Processing is durable via provider_webhook_events + WebhookProcessor (DB-backed retries).
    // HTTP returns immediately; correctness never depends on this request completing the Signal.
    this.logger.info(
      {
        eventId: event.id,
        provider: input.provider,
        providerEventId: envelope.providerEventId,
        correlationId: input.correlationId,
      },
      'webhook accepted',
    );
    return { accepted: true, duplicate: false, eventId: event.id };
  }
}
