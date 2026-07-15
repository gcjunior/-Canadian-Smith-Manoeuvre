import {
  WEBHOOK_MAX_ATTEMPTS,
  nextWebhookAttemptAt,
  type Repositories,
  type WebhookRepository,
} from '@csm/database';
import type { Logger } from '@csm/observability';

import type { TemporalAppService } from './temporal-app-service.js';
import {
  extractInterestPeriod,
  extractPaymentPeriod,
  isInterestRelatedWebhook,
  normalizeWebhookSignal,
  type NormalizedWebhookSignal,
} from './webhook-normalize.js';

export type WebhookProvider = 'bank-sim' | 'brokerage-sim';

type ClaimedWebhook = NonNullable<Awaited<ReturnType<WebhookRepository['findById']>>>;

/**
 * Durable webhook processor backed by provider_webhook_events (outbox / retry table).
 * No external message broker — claim with SKIP LOCKED, backoff in next_attempt_at.
 */
export class WebhookProcessor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly repos: Repositories,
    private readonly temporal: TemporalAppService,
    private readonly logger: Logger,
    private readonly options: { intervalMs?: number; batchSize?: number } = {},
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    const intervalMs = this.options.intervalMs ?? 2_000;
    this.timer = setInterval(() => {
      void this.processDue().catch((error: unknown) => {
        this.logger.error({ err: error }, 'webhook processor tick failed');
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Drain due RECEIVED/RETRYABLE rows. Safe for concurrent API replicas. */
  async processDue(limit = this.options.batchSize ?? 25): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      const claimed = await this.repos.webhooks.claimDue(limit);
      for (const row of claimed) {
        await this.processClaimed(row);
      }
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  async processClaimed(row: ClaimedWebhook): Promise<void> {
    try {
      await this.dispatch(row);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { err: error, eventId: row.id, attempts: row.attempts },
        'webhook processing failed',
      );
      if (row.attempts >= WEBHOOK_MAX_ATTEMPTS) {
        await this.repos.webhooks.markDeadLetter(
          row.tenantId,
          row.id,
          'MAX_ATTEMPTS_EXCEEDED',
          message,
        );
        return;
      }
      await this.repos.webhooks.markRetryable(
        row.tenantId,
        row.id,
        row.attempts,
        nextWebhookAttemptAt(row.attempts),
        message,
      );
    }
  }

  private async dispatch(row: ClaimedWebhook): Promise<void> {
    if (!row.financialAccountId) {
      await this.repos.webhooks.markDeadLetter(row.tenantId, row.id, 'MISSING_FINANCIAL_ACCOUNT');
      return;
    }

    const providerType: 'BANK' | 'BROKERAGE' =
      row.provider === 'brokerage-sim' ? 'BROKERAGE' : 'BANK';
    const payload =
      row.payloadRedacted && typeof row.payloadRedacted === 'object'
        ? (row.payloadRedacted as Record<string, unknown>)
        : {};
    const data =
      (payload.data as Record<string, unknown> | undefined) ??
      (payload.payload as Record<string, unknown> | undefined) ??
      {};
    const occurredAt = typeof payload.occurredAt === 'string' ? payload.occurredAt : undefined;
    const paymentPeriod = extractPaymentPeriod(data);
    const interestPeriod = extractInterestPeriod(data);
    const interestRelated = isInterestRelatedWebhook(row.eventType, interestPeriod);

    const signal: NormalizedWebhookSignal = normalizeWebhookSignal({
      providerEventId: row.providerEventId,
      accountId: row.financialAccountId,
      eventType: row.eventType,
      providerType,
      data,
      ...(occurredAt !== undefined ? { occurredAt } : {}),
    });

    const strategies = await this.repos.strategies.findActiveOrPausedUsingAccounts(row.tenantId, [
      row.financialAccountId,
    ]);
    if (strategies.length === 0) {
      const periodHint = paymentPeriod ?? interestPeriod;
      await this.repos.webhooks.markRetained(row.tenantId, row.id, 'NO_ACTIVE_STRATEGY', {
        ...(periodHint !== undefined ? { paymentPeriod: periodHint } : {}),
      });
      return;
    }

    const signalName =
      providerType === 'BANK'
        ? ('bankEventReceived' as const)
        : ('brokerageEventReceived' as const);

    let anySignaled = false;
    let strategyId: string | undefined;
    let retainedOutcome: string | undefined;
    let signaledPeriod: string | undefined;
    let signaledInterestPeriod: string | undefined;

    for (const strategy of strategies) {
      strategyId = strategy.id;

      const outcome = await this.temporal.signalConversionEvent(
        row.tenantId,
        strategy.id,
        signalName,
        signal,
        paymentPeriod !== undefined ? { paymentPeriod } : undefined,
      );
      if (outcome.status === 'SIGNALED') {
        anySignaled = true;
        signaledPeriod = outcome.paymentPeriod;
      } else if (outcome.status === 'CYCLE_TERMINAL') {
        retainedOutcome = retainedOutcome ?? 'WORKFLOW_ALREADY_COMPLETE';
        signaledPeriod = outcome.paymentPeriod ?? signaledPeriod;
      } else if (outcome.status === 'WORKFLOW_NOT_RUNNING') {
        retainedOutcome = retainedOutcome ?? 'WORKFLOW_NOT_RUNNING';
        signaledPeriod = outcome.paymentPeriod ?? signaledPeriod;
      } else {
        retainedOutcome = retainedOutcome ?? 'NO_WORKFLOW_YET';
        signaledPeriod = outcome.paymentPeriod ?? signaledPeriod;
      }

      if (interestRelated) {
        const interestOutcome = await this.temporal.signalInterestEvent(
          row.tenantId,
          strategy.id,
          signal,
          interestPeriod !== undefined ? { interestPeriod } : undefined,
        );
        if (interestOutcome.status === 'SIGNALED') {
          anySignaled = true;
          signaledInterestPeriod = interestOutcome.interestPeriod;
        } else if (interestOutcome.status === 'CYCLE_TERMINAL') {
          retainedOutcome = retainedOutcome ?? 'WORKFLOW_ALREADY_COMPLETE';
          signaledInterestPeriod = interestOutcome.interestPeriod ?? signaledInterestPeriod;
        } else if (interestOutcome.status === 'WORKFLOW_NOT_RUNNING') {
          retainedOutcome = retainedOutcome ?? 'WORKFLOW_NOT_RUNNING';
          signaledInterestPeriod = interestOutcome.interestPeriod ?? signaledInterestPeriod;
        } else {
          retainedOutcome = retainedOutcome ?? 'NO_WORKFLOW_YET';
          signaledInterestPeriod = interestOutcome.interestPeriod ?? signaledInterestPeriod;
        }
      }
    }

    // Webhook row stores a single YYYY-MM period tip (conversion or interest).
    const period = signaledPeriod ?? paymentPeriod ?? signaledInterestPeriod ?? interestPeriod;
    const periodPatch = period !== undefined ? { paymentPeriod: period } : {};

    if (anySignaled) {
      await this.repos.webhooks.markProcessed(row.tenantId, row.id, 'SIGNALLED', {
        ...(strategyId !== undefined ? { strategyId } : {}),
        ...periodPatch,
      });
      return;
    }

    // No running workflow — retain for polling/reconciliation (webhook is never sole correctness).
    await this.repos.webhooks.markRetained(
      row.tenantId,
      row.id,
      retainedOutcome ?? 'RETAINED_FOR_POLLING',
      {
        ...(strategyId !== undefined ? { strategyId } : {}),
        ...periodPatch,
      },
    );
  }
}
