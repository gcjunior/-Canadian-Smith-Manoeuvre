import type { BankClient, ProviderHelocDraw } from '@csm/bank-client';
import type { PrismaClient, Repositories } from '@csm/database';
import { computeDrawAmountCents } from '@csm/domain';
import type { Logger } from '@csm/observability';
import { csmMetrics } from '@csm/observability';

import type { ActivityContext } from '../shared/context.js';
import { activityLogFields } from '../shared/context.js';
import { mapProviderError, nonRetryable, retryable } from '../shared/errors.js';
import {
  isProviderAmbiguous,
  isProviderNotFound,
  providerErrorMessage,
} from '../shared/provider-errors.js';
import { applyMoneyMovementState, mapProviderToMoneyMovementState } from '../shared/guards.js';
import { activityHeartbeat } from '../shared/heartbeat.js';
import {
  assertSnapshotMatchesCtx,
  loadAuthoritativeStrategySnapshot,
} from '../shared/strategy-snapshot.js';

export function createHelocActivities(deps: {
  logger: Logger;
  repos: Repositories;
  prisma: PrismaClient;
  bankClient: BankClient;
  platformMonthlyDrawCapCents: bigint;
}) {
  return {
    async getHelocAvailability(ctx: ActivityContext): Promise<{
      availableCreditCents: string;
      existingAvailableCreditCents: string;
      newlyAvailableCreditCents: string;
      stale: boolean;
      observedAt: string;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'availability' });
      try {
        const avail = await deps.bankClient.getHelocAvailability(
          snapshot.helocProviderId,
          ctx.correlationId,
        );
        return {
          availableCreditCents: avail.availableCreditCents.toString(),
          existingAvailableCreditCents: avail.existingAvailableCreditCents.toString(),
          newlyAvailableCreditCents: avail.newlyAvailableCreditCents.toString(),
          stale: avail.stale,
          observedAt: avail.observedAt,
        };
      } catch (error) {
        mapProviderError(error, 'getHelocAvailability');
      }
    },

    async calculateNewlyAvailableCredit(
      ctx: ActivityContext & { principalRepaidCents: string },
    ): Promise<{ newlyAvailableCreditCents: string; drawAmountCents: string }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      let avail;
      try {
        avail = await deps.bankClient.getHelocAvailability(
          snapshot.helocProviderId,
          ctx.correlationId,
        );
      } catch (error) {
        mapProviderError(error, 'calculateNewlyAvailableCredit');
      }
      const principal = BigInt(ctx.principalRepaidCents);
      const newly =
        avail.newlyAvailableCreditCents < principal ? avail.newlyAvailableCreditCents : principal;
      const draw = computeDrawAmountCents({
        principalRepaidCents: principal,
        newlyAvailableHelocCreditCents: newly,
        userMonthlyCapCents: snapshot.userMonthlyCapCents,
        platformMonthlyCapCents: deps.platformMonthlyDrawCapCents,
      });

      if (ctx.cycleId) {
        const cycle = await deps.repos.cycles.findById(ctx.tenantId, ctx.cycleId);
        if (cycle) {
          await deps.repos.cycles.patchFields(ctx.tenantId, cycle.id, cycle.version, {
            newlyAvailableCreditCents: newly,
            drawAmountCents: draw,
          });
          if (cycle.startedAt && newly > 0n) {
            csmMetrics.helocReadvanceWaitMs.record(Date.now() - cycle.startedAt.getTime(), {
              tenantId: ctx.tenantId,
            });
          }
        }
      }

      if (newly > 0n && ctx.paymentPeriod) {
        const existingCredit = await deps.prisma.helocCreditEvent.findFirst({
          where: {
            tenantId: ctx.tenantId,
            helocId: snapshot.helocFacilityId,
            relatedPaymentPeriod: ctx.paymentPeriod,
          },
        });
        if (!existingCredit) {
          await deps.prisma.helocCreditEvent.create({
            data: {
              tenantId: ctx.tenantId,
              helocId: snapshot.helocFacilityId,
              providerEventId: `cred_${ctx.paymentPeriod}_${snapshot.helocFacilityId}`,
              availableCreditCents: newly + avail.existingAvailableCreditCents,
              creditDeltaCents: newly,
              relatedPaymentPeriod: ctx.paymentPeriod,
              observedAt: new Date(avail.observedAt),
            },
          });
        }
      }

      return {
        newlyAvailableCreditCents: newly.toString(),
        drawAmountCents: draw.toString(),
      };
    },

    async initiateHelocDraw(
      ctx: ActivityContext & { amountCents: string; idempotencyKey: string },
    ): Promise<{
      moneyMovementId: string;
      providerDrawId: string;
      state: string;
      amountCents: string;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      const amountCents = BigInt(ctx.amountCents);
      if (amountCents <= 0n) {
        nonRetryable('Draw amount must be positive', 'VALIDATION_FAILURE');
      }

      let movement = await deps.repos.moneyMovements.findByIdempotencyKey(
        ctx.tenantId,
        ctx.idempotencyKey,
      );
      if (movement?.providerTransactionId) {
        return {
          moneyMovementId: movement.id,
          providerDrawId: movement.providerTransactionId,
          state: movement.state,
          amountCents: movement.amountCents.toString(),
        };
      }

      if (!movement) {
        movement = await deps.repos.moneyMovements.create(ctx.tenantId, {
          ...(ctx.cycleId !== undefined ? { cycleId: ctx.cycleId } : {}),
          type: 'HELOC_DRAW',
          amountCents,
          sourceAccountId: snapshot.helocAccountId,
          destinationAccountId: snapshot.bankAccountId,
          idempotencyKey: ctx.idempotencyKey,
          correlationId: ctx.correlationId,
          state: 'REQUESTED',
        });
      }

      // Intent exists without provider id — GET by key before any re-POST (Worker restart).
      try {
        const existing = await deps.bankClient.findHelocDrawByIdempotencyKey(
          snapshot.helocProviderId,
          ctx.idempotencyKey,
          ctx.correlationId,
        );
        const toState = mapProviderToMoneyMovementState(existing.state);
        let current = movement;
        if (current.state === 'REQUESTED' && toState !== 'REQUESTED' && toState !== 'PENDING') {
          current = await applyMoneyMovementState(
            deps.repos.moneyMovements,
            ctx.tenantId,
            current,
            'PENDING',
            { providerTransactionId: existing.providerTransactionId },
          );
        }
        const updated = await applyMoneyMovementState(
          deps.repos.moneyMovements,
          ctx.tenantId,
          current,
          toState === 'REQUESTED' ? 'PENDING' : toState,
          {
            providerTransactionId: existing.providerTransactionId,
            failureCode: existing.failureCode,
            settledAt: existing.settledAt ? new Date(existing.settledAt) : null,
          },
        );
        if (existing.state === 'FAILED') {
          nonRetryable('HELOC draw rejected', 'BUSINESS_REJECTION', {
            failureCode: existing.failureCode,
          });
        }
        return {
          moneyMovementId: updated.id,
          providerDrawId: existing.providerTransactionId,
          state: existing.state,
          amountCents: existing.amountCents.toString(),
        };
      } catch (error) {
        if (!isProviderNotFound(error)) {
          mapProviderError(error, 'initiateHelocDraw.preflight');
        }
      }

      deps.logger.info(
        { ...activityLogFields(ctx), activity: 'initiateHelocDraw', moneyMovementId: movement.id },
        'initiating HELOC draw',
      );

      let draw: ProviderHelocDraw;
      try {
        draw = await deps.bankClient.initiateHelocDraw({
          helocId: snapshot.helocProviderId,
          amountCents,
          idempotencyKey: ctx.idempotencyKey,
          correlationId: ctx.correlationId,
        });
      } catch (error) {
        if (isProviderAmbiguous(error)) {
          if (movement.state === 'REQUESTED' || movement.state === 'PENDING') {
            await applyMoneyMovementState(
              deps.repos.moneyMovements,
              ctx.tenantId,
              movement,
              'UNKNOWN',
            );
          }
          nonRetryable(providerErrorMessage(error), 'AMBIGUOUS_RESULT', {
            idempotencyKey: ctx.idempotencyKey,
            moneyMovementId: movement.id,
          });
        }
        mapProviderError(error, 'initiateHelocDraw');
      }

      const toState = mapProviderToMoneyMovementState(draw.state);
      const updated = await applyMoneyMovementState(
        deps.repos.moneyMovements,
        ctx.tenantId,
        movement,
        toState === 'REQUESTED' ? 'PENDING' : toState,
        {
          providerTransactionId: draw.providerTransactionId,
          failureCode: draw.failureCode,
          settledAt: draw.settledAt ? new Date(draw.settledAt) : null,
        },
      );

      if (draw.state === 'FAILED') {
        nonRetryable('HELOC draw rejected', 'BUSINESS_REJECTION', {
          failureCode: draw.failureCode,
        });
      }

      return {
        moneyMovementId: updated.id,
        providerDrawId: draw.providerTransactionId,
        state: draw.state,
        amountCents: draw.amountCents.toString(),
      };
    },

    async resolveAmbiguousHelocDraw(ctx: ActivityContext & { idempotencyKey: string }): Promise<{
      moneyMovementId: string;
      providerDrawId: string;
      state: string;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'resolve-draw' });
      let draw: ProviderHelocDraw;
      try {
        draw = await deps.bankClient.resolveAmbiguousHelocDraw({
          helocId: snapshot.helocProviderId,
          idempotencyKey: ctx.idempotencyKey,
          correlationId: ctx.correlationId,
        });
      } catch (error) {
        mapProviderError(error, 'resolveAmbiguousHelocDraw');
      }

      const movement = await deps.repos.moneyMovements.findByIdempotencyKey(
        ctx.tenantId,
        ctx.idempotencyKey,
      );
      if (!movement) {
        nonRetryable('Money movement intent missing for ambiguous draw', 'NOT_FOUND');
      }
      let current = movement;
      const toState = mapProviderToMoneyMovementState(draw.state);
      // REQUESTED cannot jump straight to SETTLED — intermediate PENDING if needed.
      if (current.state === 'REQUESTED' && toState !== 'REQUESTED' && toState !== 'PENDING') {
        current = await applyMoneyMovementState(
          deps.repos.moneyMovements,
          ctx.tenantId,
          current,
          'PENDING',
          { providerTransactionId: draw.providerTransactionId },
        );
      }
      const updated = await applyMoneyMovementState(
        deps.repos.moneyMovements,
        ctx.tenantId,
        current,
        toState,
        {
          providerTransactionId: draw.providerTransactionId,
          settledAt: draw.settledAt ? new Date(draw.settledAt) : null,
          failureCode: draw.failureCode,
        },
      );
      return {
        moneyMovementId: updated.id,
        providerDrawId: draw.providerTransactionId,
        state: draw.state,
      };
    },

    async confirmHelocDraw(
      ctx: ActivityContext & { providerDrawId: string; idempotencyKey: string },
    ): Promise<{ state: string; settledAt: string | null }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'confirm-draw' });

      let draw: ProviderHelocDraw;
      try {
        draw = await deps.bankClient.findHelocDrawByIdempotencyKey(
          snapshot.helocProviderId,
          ctx.idempotencyKey,
          ctx.correlationId,
        );
      } catch (error) {
        mapProviderError(error, 'confirmHelocDraw');
      }

      if (draw.providerTransactionId !== ctx.providerDrawId) {
        nonRetryable('Provider draw id mismatch', 'VALIDATION_FAILURE');
      }

      const movement = await deps.repos.moneyMovements.findByIdempotencyKey(
        ctx.tenantId,
        ctx.idempotencyKey,
      );
      if (!movement) {
        nonRetryable('Money movement not found', 'NOT_FOUND');
      }

      if (draw.state !== 'SETTLED' && draw.state !== 'FAILED') {
        retryable(`HELOC draw not settled yet (${draw.state})`, 'DRAW_PENDING');
      }

      await applyMoneyMovementState(
        deps.repos.moneyMovements,
        ctx.tenantId,
        movement,
        mapProviderToMoneyMovementState(draw.state),
        {
          providerTransactionId: draw.providerTransactionId,
          settledAt: draw.settledAt ? new Date(draw.settledAt) : null,
          failureCode: draw.failureCode,
        },
      );

      if (draw.state === 'FAILED') {
        nonRetryable('HELOC draw failed', 'BUSINESS_REJECTION', {
          failureCode: draw.failureCode,
        });
      }

      return { state: draw.state, settledAt: draw.settledAt };
    },

    async getHelocInterestCharge(ctx: ActivityContext & { interestPeriod: string }): Promise<{
      providerChargeId: string;
      amountCents: string;
      state: string;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      try {
        const charges = await deps.bankClient.listInterestCharges(
          snapshot.helocProviderId,
          ctx.correlationId,
        );
        const match = charges.find((c) => String(c.interestPeriod) === ctx.interestPeriod);
        if (!match) {
          nonRetryable('Interest charge not found for period', 'NOT_FOUND', {
            interestPeriod: ctx.interestPeriod,
          });
        }
        return {
          providerChargeId: String(match.providerChargeId),
          amountCents: match.amountCents.toString(),
          state: String(match.state),
        };
      } catch (error) {
        mapProviderError(error, 'getHelocInterestCharge');
      }
    },

    async confirmInterestPayment(
      ctx: ActivityContext & { ordinaryAccountId: string; debitId: string },
    ): Promise<{ state: string; amountCents: string }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      const ordinary = await deps.repos.accounts.findOrdinaryBankDetail(
        ctx.tenantId,
        snapshot.bankAccountId,
      );
      if (!ordinary || ordinary.id !== ctx.ordinaryAccountId) {
        nonRetryable('Ordinary bank account mismatch', 'FORBIDDEN');
      }
      try {
        const debit = await deps.bankClient.getOrdinaryDebit(
          snapshot.bankProviderId,
          ctx.debitId,
          ctx.correlationId,
        );
        return {
          state: String(debit.state),
          amountCents: debit.amountCents.toString(),
        };
      } catch (error) {
        mapProviderError(error, 'confirmInterestPayment');
      }
    },
  };
}

export type HelocActivities = ReturnType<typeof createHelocActivities>;
