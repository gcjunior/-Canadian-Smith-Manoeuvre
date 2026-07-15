import type { BankClient } from '@csm/bank-client';
import type { Repositories } from '@csm/database';
import type { Logger } from '@csm/observability';
import { csmMetrics } from '@csm/observability';
import type { MortgagePaymentState } from '@prisma/client';

import type { ActivityContext } from '../shared/context.js';
import { activityLogFields } from '../shared/context.js';
import { mapProviderError, nonRetryable } from '../shared/errors.js';
import { activityHeartbeat } from '../shared/heartbeat.js';
import {
  assertSnapshotMatchesCtx,
  loadAuthoritativeStrategySnapshot,
} from '../shared/strategy-snapshot.js';

function mapProviderPaymentState(state: string): MortgagePaymentState {
  switch (state) {
    case 'SETTLED':
      return 'SETTLED';
    case 'REVERSED':
      return 'CANCELLED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

export function createMortgageActivities(deps: {
  logger: Logger;
  repos: Repositories;
  bankClient: BankClient;
}) {
  return {
    async findSettledMortgagePayment(ctx: ActivityContext): Promise<{
      mortgagePaymentId: string;
      providerPaymentId: string;
      principalAmountCents: string;
      interestAmountCents: string;
      totalAmountCents: string;
      paymentPeriod: string;
      state: MortgagePaymentState;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      const period = ctx.paymentPeriod;
      if (!period) {
        nonRetryable('paymentPeriod required', 'VALIDATION_FAILURE');
      }

      deps.logger.info(
        { ...activityLogFields(ctx), activity: 'findSettledMortgagePayment' },
        'loading mortgage payments from provider',
      );
      activityHeartbeat({ phase: 'list' });

      let payments;
      try {
        payments = await deps.bankClient.listMortgagePayments(
          snapshot.mortgageProviderId,
          ctx.correlationId,
        );
      } catch (error) {
        mapProviderError(error, 'findSettledMortgagePayment');
      }

      const match = payments.find(
        (p) => p.paymentPeriod === period && String(p.state) === 'SETTLED',
      );
      if (!match) {
        nonRetryable('No SETTLED mortgage payment for period', 'NOT_FOUND', { period });
      }

      if (ctx.cycleId) {
        const cycle = await deps.repos.cycles.findById(ctx.tenantId, ctx.cycleId);
        if (cycle?.startedAt) {
          csmMetrics.settlementWaitMs.record(Date.now() - cycle.startedAt.getTime(), {
            tenantId: ctx.tenantId,
          });
        }
      }

      const saved = await deps.repos.mortgagePayments.upsertFromProvider(ctx.tenantId, {
        mortgageId: snapshot.mortgageFacilityId,
        providerPaymentId: String(match.providerPaymentId),
        paymentPeriod: period,
        totalAmountCents: BigInt(match.totalAmountCents),
        principalAmountCents: BigInt(match.principalAmountCents),
        interestAmountCents: BigInt(match.interestAmountCents),
        state: mapProviderPaymentState(String(match.state)),
        settledAt: match.settledAt ? new Date(String(match.settledAt)) : new Date(),
      });

      return {
        mortgagePaymentId: saved.id,
        providerPaymentId: saved.providerPaymentId,
        principalAmountCents: saved.principalAmountCents.toString(),
        interestAmountCents: saved.interestAmountCents.toString(),
        totalAmountCents: saved.totalAmountCents.toString(),
        paymentPeriod: saved.paymentPeriod,
        state: saved.state,
      };
    },

    async identifyPrincipalRepaid(
      ctx: ActivityContext & { mortgagePaymentId: string },
    ): Promise<{ principalRepaidCents: string }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      const period = ctx.paymentPeriod;
      if (!period) {
        nonRetryable('paymentPeriod required', 'VALIDATION_FAILURE');
      }

      const settled = await deps.repos.mortgagePayments.findByPeriod(
        ctx.tenantId,
        snapshot.mortgageFacilityId,
        period,
      );
      if (!settled || settled.id !== ctx.mortgagePaymentId || settled.state !== 'SETTLED') {
        nonRetryable('Settled mortgage payment not found in DB', 'NOT_FOUND');
      }
      if (settled.principalAmountCents < 0n) {
        nonRetryable('Invalid principal amount', 'VALIDATION_FAILURE');
      }

      if (ctx.cycleId) {
        const cycle = await deps.repos.cycles.findById(ctx.tenantId, ctx.cycleId);
        if (cycle) {
          await deps.repos.cycles.patchFields(ctx.tenantId, cycle.id, cycle.version, {
            mortgagePaymentId: settled.id,
            principalRepaidCents: settled.principalAmountCents,
          });
        }
      }

      return { principalRepaidCents: settled.principalAmountCents.toString() };
    },

    async verifyPaymentNotReversed(
      ctx: ActivityContext & { providerPaymentId: string },
    ): Promise<{ ok: true; state: string }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'verify' });

      let payments;
      try {
        payments = await deps.bankClient.listMortgagePayments(
          snapshot.mortgageProviderId,
          ctx.correlationId,
        );
      } catch (error) {
        mapProviderError(error, 'verifyPaymentNotReversed');
      }
      const match = payments.find((p) => String(p.providerPaymentId) === ctx.providerPaymentId);
      if (!match) {
        nonRetryable('Provider payment missing during reverse check', 'NOT_FOUND');
      }
      if (String(match.state) === 'REVERSED') {
        nonRetryable('Mortgage payment was reversed', 'PAYMENT_REVERSED', {
          providerPaymentId: ctx.providerPaymentId,
        });
      }
      await deps.repos.mortgagePayments.upsertFromProvider(ctx.tenantId, {
        mortgageId: snapshot.mortgageFacilityId,
        providerPaymentId: String(match.providerPaymentId),
        paymentPeriod: String(match.paymentPeriod),
        totalAmountCents: BigInt(match.totalAmountCents),
        principalAmountCents: BigInt(match.principalAmountCents),
        interestAmountCents: BigInt(match.interestAmountCents),
        state: mapProviderPaymentState(String(match.state)),
        settledAt: match.settledAt ? new Date(String(match.settledAt)) : null,
      });
      return { ok: true, state: String(match.state) };
    },
  };
}

export type MortgageActivities = ReturnType<typeof createMortgageActivities>;
