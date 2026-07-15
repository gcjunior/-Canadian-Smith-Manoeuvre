import {
  createRepositories,
  withTransaction,
  type PrismaClient,
  type Repositories,
} from '@csm/database';
import type { BankClient } from '@csm/bank-client';
import {
  assertInterestAmountsEqual,
  assertInterestDebitSourceAllowed,
  evaluateInterestReconciliation,
  interestReconciliationPassed,
  shouldPauseFutureConversionsOnInterestFailure,
} from '@csm/domain';
import type { Logger } from '@csm/observability';
import { redactObject } from '@csm/observability';
import type { InterestCycleState, Prisma } from '@prisma/client';

import type { ActivityContext } from '../shared/context.js';
import { activityLogFields } from '../shared/context.js';
import { mapProviderError, nonRetryable } from '../shared/errors.js';
import { mapDomainOrContractError, requireCycleId } from '../shared/guards.js';
import { activityHeartbeat } from '../shared/heartbeat.js';
import {
  assertSnapshotMatchesCtx,
  loadAuthoritativeStrategySnapshot,
} from '../shared/strategy-snapshot.js';

function requireInterestPeriod(period: string | undefined): string {
  if (!period) {
    nonRetryable('interestPeriod required', 'VALIDATION_FAILURE');
  }
  return period;
}

export function createInterestActivities(deps: {
  logger: Logger;
  repos: Repositories;
  prisma: PrismaClient;
  bankClient: BankClient;
}) {
  return {
    async reserveInterestCycle(ctx: ActivityContext & { interestPeriod: string }): Promise<{
      cycleId: string;
      state: InterestCycleState;
      interestPeriod: string;
      created: boolean;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      const period = requireInterestPeriod(ctx.interestPeriod);

      try {
        return await withTransaction(deps.prisma, async (tx) => {
          const repos = createRepositories(tx);
          const existing = await repos.interestCycles.findByPeriod(
            ctx.tenantId,
            ctx.strategyId,
            period,
          );
          if (existing) {
            if (existing.state === 'SCHEDULED') {
              const updated = await repos.interestCycles.updateState(
                ctx.tenantId,
                existing.id,
                existing.version,
                'SCHEDULED',
                'AWAITING_CHARGE',
              );
              await repos.interestCycles.patchFields(ctx.tenantId, updated.id, updated.version, {
                startedAt: new Date(),
              });
              return {
                cycleId: updated.id,
                state: 'AWAITING_CHARGE',
                interestPeriod: period,
                created: false,
              };
            }
            return {
              cycleId: existing.id,
              state: existing.state,
              interestPeriod: existing.interestPeriod,
              created: false,
            };
          }

          const created = await repos.interestCycles.create(ctx.tenantId, {
            strategyId: ctx.strategyId,
            interestPeriod: period,
            correlationId: ctx.correlationId,
            state: 'SCHEDULED',
          });
          const moved = await repos.interestCycles.updateState(
            ctx.tenantId,
            created.id,
            created.version,
            'SCHEDULED',
            'AWAITING_CHARGE',
          );
          await repos.interestCycles.patchFields(ctx.tenantId, moved.id, moved.version, {
            startedAt: new Date(),
          });
          return {
            cycleId: moved.id,
            state: 'AWAITING_CHARGE',
            interestPeriod: period,
            created: true,
          };
        });
      } catch (error) {
        mapDomainOrContractError(error);
      }
    },

    async transitionInterestCycleState(
      ctx: ActivityContext & { fromState: string; toState: string },
    ): Promise<{ cycleId: string; state: string }> {
      const cycleId = requireCycleId(ctx.cycleId);
      try {
        return await withTransaction(deps.prisma, async (tx) => {
          const repos = createRepositories(tx);
          const cycle = await repos.interestCycles.findById(ctx.tenantId, cycleId);
          if (!cycle || cycle.strategyId !== ctx.strategyId) {
            nonRetryable('Interest cycle not found', 'NOT_FOUND');
          }
          if (cycle.state !== ctx.fromState) {
            if (cycle.state === ctx.toState) {
              return { cycleId: cycle.id, state: cycle.state };
            }
            nonRetryable('Interest cycle state mismatch', 'INVALID_STATUS_TRANSITION', {
              expected: ctx.fromState,
              actual: cycle.state,
            });
          }
          const updated = await repos.interestCycles.updateState(
            ctx.tenantId,
            cycle.id,
            cycle.version,
            ctx.fromState as InterestCycleState,
            ctx.toState as InterestCycleState,
          );
          return { cycleId: updated.id, state: updated.state };
        });
      } catch (error) {
        mapDomainOrContractError(error);
      }
    },

    async findPostedInterestCharge(ctx: ActivityContext): Promise<{
      chargeId: string;
      providerChargeId: string;
      amountCents: string;
      state: string;
      interestPeriod: string;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      const period = requireInterestPeriod(ctx.interestPeriod);
      activityHeartbeat({ phase: 'findPostedInterestCharge' });

      try {
        const charges = await deps.bankClient.listInterestCharges(
          snapshot.helocProviderId,
          ctx.correlationId,
        );
        const matches = charges.filter((c) => String(c.interestPeriod) === period);
        if (matches.length === 0) {
          nonRetryable('Interest charge not found for period', 'NOT_FOUND', {
            interestPeriod: period,
          });
        }
        if (matches.length > 1) {
          nonRetryable('Duplicate interest charges for period', 'DUPLICATE_CONFLICT', {
            interestPeriod: period,
            count: matches.length,
          });
        }
        const match = matches[0]!;
        const postedAt =
          match.postedAt !== null && match.postedAt !== undefined ? new Date(match.postedAt) : null;

        const heloc = await deps.repos.accounts.findHelocDetail(
          ctx.tenantId,
          snapshot.helocAccountId,
        );
        if (!heloc) {
          nonRetryable('HELOC facility missing', 'NOT_FOUND');
        }

        const charge = await deps.repos.interest.upsertCharge(ctx.tenantId, {
          helocId: heloc.id,
          providerChargeId: String(match.providerChargeId),
          interestPeriod: period,
          amountCents: BigInt(match.amountCents.toString()),
          state:
            match.state === 'FAILED' ? 'FAILED' : match.state === 'PENDING' ? 'PENDING' : 'POSTED',
          postedAt,
        });

        if (ctx.cycleId) {
          const cycle = await deps.repos.interestCycles.findById(ctx.tenantId, ctx.cycleId);
          if (cycle && cycle.chargeId !== charge.id) {
            await deps.repos.interestCycles.patchFields(ctx.tenantId, cycle.id, cycle.version, {
              chargeId: charge.id,
            });
          }
        }

        return {
          chargeId: charge.id,
          providerChargeId: charge.providerChargeId,
          amountCents: charge.amountCents.toString(),
          state: String(match.state),
          interestPeriod: period,
        };
      } catch (error) {
        mapProviderError(error, 'findPostedInterestCharge');
      }
    },

    async findOrdinaryInterestDebit(
      ctx: ActivityContext & { chargeId: string; providerChargeId: string },
    ): Promise<{
      debitId: string;
      paymentId: string;
      providerPaymentId?: string;
      amountCents: string;
      state: string;
      ordinaryAccountId: string;
      failureCode?: string | null;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx, {
        requireActive: false,
      });
      assertSnapshotMatchesCtx(snapshot, ctx);
      const period = requireInterestPeriod(ctx.interestPeriod);
      activityHeartbeat({ phase: 'findOrdinaryInterestDebit' });

      try {
        const payments = await deps.bankClient.listInterestPayments(
          snapshot.helocProviderId,
          ctx.correlationId,
        );
        const matches = payments.filter(
          (p) => p.interestPeriod === period && p.providerChargeId === ctx.providerChargeId,
        );
        if (matches.length === 0) {
          nonRetryable('Interest payment/debit not found for period', 'NOT_FOUND', {
            interestPeriod: period,
            providerChargeId: ctx.providerChargeId,
          });
        }
        if (matches.length > 1) {
          nonRetryable('Duplicate interest payments for period', 'DUPLICATE_CONFLICT', {
            interestPeriod: period,
            count: matches.length,
          });
        }
        const view = matches[0]!;

        if (view.ordinaryAccountId !== snapshot.bankProviderId) {
          nonRetryable(
            'Interest debit from unexpected ordinary account',
            'INTEREST_UNEXPECTED_SOURCE',
            {
              ordinaryAccountId: view.ordinaryAccountId,
              expected: snapshot.bankProviderId,
            },
          );
        }

        const ordinary = await deps.repos.accounts.findOrdinaryBankDetail(
          ctx.tenantId,
          snapshot.bankAccountId,
        );
        if (!ordinary) {
          nonRetryable('Ordinary bank facility missing', 'NOT_FOUND');
        }

        const payment = await deps.repos.interest.upsertPayment(ctx.tenantId, {
          chargeId: ctx.chargeId,
          ordinaryBankAccountId: ordinary.id,
          providerPaymentId: view.providerPaymentId,
          amountCents: BigInt(view.amountCents.toString()),
          state:
            view.paymentState === 'SETTLED'
              ? 'SETTLED'
              : view.paymentState === 'FAILED'
                ? 'FAILED'
                : 'PENDING',
          providerDebitId: view.debitId,
          settledAt: view.settledAt ? new Date(view.settledAt) : null,
          failureCode: view.failureCode,
        });

        if (ctx.cycleId) {
          const cycle = await deps.repos.interestCycles.findById(ctx.tenantId, ctx.cycleId);
          if (cycle && cycle.paymentId !== payment.id) {
            await deps.repos.interestCycles.patchFields(ctx.tenantId, cycle.id, cycle.version, {
              paymentId: payment.id,
            });
          }
        }

        if (!view.debitId && view.paymentState !== 'FAILED' && view.paymentState !== 'SETTLED') {
          nonRetryable('Ordinary debit id not yet available', 'NOT_FOUND', {
            paymentId: view.paymentId,
            paymentState: view.paymentState,
          });
        }

        return {
          debitId: view.debitId ?? payment.providerDebitId ?? `pending:${payment.id}`,
          paymentId: payment.id,
          providerPaymentId: view.providerPaymentId,
          amountCents: view.amountCents.toString(),
          state: view.paymentState,
          ordinaryAccountId: ordinary.id,
          failureCode: view.failureCode,
        };
      } catch (error) {
        mapProviderError(error, 'findOrdinaryInterestDebit');
      }
    },

    async confirmInterestDebitSettlement(
      ctx: ActivityContext & { debitId: string; paymentId: string },
    ): Promise<{ state: 'SETTLED'; settledAt: string | null }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx, {
        requireActive: false,
      });
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'confirmInterestDebitSettlement' });

      try {
        const debit = await deps.bankClient.getOrdinaryDebit(
          snapshot.bankProviderId,
          ctx.debitId,
          ctx.correlationId,
        );
        if (debit.state === 'FAILED') {
          nonRetryable('Interest debit failed', 'DEBIT_FAILED', {
            failureCode: 'FAILED',
          });
        }
        if (debit.state === 'REVERSED') {
          nonRetryable('Interest debit reversed', 'DEBIT_REVERSED');
        }
        if (debit.state !== 'SETTLED') {
          nonRetryable('Interest debit not settled yet', 'DEBIT_PENDING', {
            state: debit.state,
          });
        }

        const ordinary = await deps.repos.accounts.findOrdinaryBankDetail(
          ctx.tenantId,
          snapshot.bankAccountId,
        );
        if (!ordinary) {
          nonRetryable('Ordinary bank facility missing', 'NOT_FOUND');
        }

        // Keep local payment row aligned with provider settlement.
        try {
          const payments = await deps.bankClient.listInterestPayments(
            snapshot.helocProviderId,
            ctx.correlationId,
          );
          const view = payments.find((p) => p.debitId === ctx.debitId);
          const period = requireInterestPeriod(ctx.interestPeriod);
          const csmCharge = await deps.repos.interest.findChargeByPeriod(
            ctx.tenantId,
            (await deps.repos.accounts.findHelocDetail(ctx.tenantId, snapshot.helocAccountId))
              ?.id ?? '',
            period,
          );
          if (view && csmCharge) {
            await deps.repos.interest.upsertPayment(ctx.tenantId, {
              chargeId: csmCharge.id,
              ordinaryBankAccountId: ordinary.id,
              providerPaymentId: view.providerPaymentId,
              amountCents: BigInt(view.amountCents.toString()),
              state: 'SETTLED',
              providerDebitId: ctx.debitId,
              settledAt: debit.settledAt ? new Date(debit.settledAt) : new Date(),
              failureCode: null,
            });
          }
        } catch {
          // Persistence alignment is best-effort; provider SETTLED is authoritative.
        }

        return { state: 'SETTLED', settledAt: debit.settledAt };
      } catch (error) {
        mapProviderError(error, 'confirmInterestDebitSettlement');
      }
    },

    async validateInterestPaymentRules(
      ctx: ActivityContext & {
        chargeId: string;
        debitId: string;
        chargeAmountCents: string;
        debitAmountCents: string;
        ordinaryAccountId: string;
      },
    ): Promise<{ ok: true }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx, {
        requireActive: false,
      });
      assertSnapshotMatchesCtx(snapshot, ctx);
      const ordinary = await deps.repos.accounts.findOrdinaryBankDetail(
        ctx.tenantId,
        snapshot.bankAccountId,
      );
      if (!ordinary || ordinary.id !== ctx.ordinaryAccountId) {
        nonRetryable('Ordinary account mismatch', 'INTEREST_UNEXPECTED_SOURCE');
      }

      try {
        assertInterestAmountsEqual(BigInt(ctx.chargeAmountCents), BigInt(ctx.debitAmountCents));
      } catch {
        nonRetryable('Interest charge and debit amounts differ', 'INTEREST_AMOUNT_MISMATCH', {
          chargeAmountCents: ctx.chargeAmountCents,
          debitAmountCents: ctx.debitAmountCents,
        });
      }

      try {
        assertInterestDebitSourceAllowed({
          sourceAccountKind: 'BANK_OPERATING',
          sourceAccountId: snapshot.bankAccountId,
          configuredOrdinaryAccountId: snapshot.bankAccountId,
          helocAccountId: snapshot.helocAccountId,
          brokerageAccountId: snapshot.brokerageAccountId,
        });
      } catch {
        nonRetryable('Interest debit source not allowed', 'INTEREST_UNEXPECTED_SOURCE');
      }

      // Provider debit must still match configured ordinary account.
      try {
        const debit = await deps.bankClient.getOrdinaryDebit(
          snapshot.bankProviderId,
          ctx.debitId,
          ctx.correlationId,
        );
        if (debit.accountId !== snapshot.bankProviderId) {
          nonRetryable('Debit account is not strategy ordinary bank', 'INTEREST_UNEXPECTED_SOURCE');
        }
      } catch (error) {
        mapProviderError(error, 'validateInterestPaymentRules');
      }

      return { ok: true };
    },

    async reconcileInterestCycle(ctx: ActivityContext): Promise<{
      reconciliationId: string;
      state: 'PASSED' | 'FAILED';
      summary: string;
      items: Array<{
        code: string;
        result: 'PASS' | 'FAIL' | 'WARN';
        expectedValue: string | null;
        actualValue: string | null;
      }>;
    }> {
      const cycleId = requireCycleId(ctx.cycleId);
      const period = requireInterestPeriod(ctx.interestPeriod);
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx, {
        requireActive: false,
      });
      assertSnapshotMatchesCtx(snapshot, ctx);

      const cycle = await deps.repos.interestCycles.findById(ctx.tenantId, cycleId);
      if (!cycle || cycle.strategyId !== ctx.strategyId) {
        nonRetryable('Interest cycle not found', 'NOT_FOUND');
      }

      const existing = await deps.repos.reconciliations.findByInterestCycle(ctx.tenantId, cycleId);
      if (existing?.state === 'PASSED' || existing?.state === 'FAILED') {
        return {
          reconciliationId: existing.id,
          state: existing.state,
          summary: existing.summary ?? existing.state,
          items: [],
        };
      }

      const charge = cycle.chargeId
        ? await deps.prisma.helocInterestCharge.findFirst({
            where: { id: cycle.chargeId, tenantId: ctx.tenantId },
          })
        : null;
      const payment = cycle.paymentId
        ? await deps.prisma.helocInterestPayment.findFirst({
            where: { id: cycle.paymentId, tenantId: ctx.tenantId },
          })
        : null;

      let ledger = await deps.repos.ledger.listByInterestCycle(ctx.tenantId, cycleId);
      if (ledger.length === 0) {
        // Legacy rows may lack interestCycleId — match by businessEventId prefix.
        const all = await deps.repos.ledger.listByTenant(ctx.tenantId);
        const prefix = `interest:${cycleId}:`;
        ledger = all.filter((e) => e.businessEventId.startsWith(prefix));
      }

      const helocIdentifiedOnDebit = Boolean(
        charge && payment && payment.chargeId === charge.id && charge.interestPeriod === period,
      );

      const items = evaluateInterestReconciliation({
        chargeState: charge?.state ?? null,
        chargeAmountCents: charge?.amountCents ?? null,
        chargePeriod: charge?.interestPeriod ?? null,
        expectedPeriod: period,
        debitState: payment?.state ?? null,
        debitAmountCents: payment?.amountCents ?? null,
        debitReversed: payment?.state === 'FAILED',
        ordinaryAccountId: payment?.ordinaryBankAccountId ?? null,
        configuredOrdinaryAccountId: snapshot.ordinaryBankFacilityId,
        helocIdentifiedOnDebit,
        ledgerLegs: ledger.map((e) => ({
          direction: e.direction,
          amountCents: e.amountCents,
        })),
      });

      const passed = interestReconciliationPassed(items);
      const state = passed ? ('PASSED' as const) : ('FAILED' as const);
      const failed = items.filter((i) => i.result === 'FAIL');
      const summary =
        state === 'PASSED'
          ? `Interest ${period} charge ${charge?.providerChargeId ?? '?'} matched debit ${payment?.providerPaymentId ?? '?'}`
          : `Interest reconciliation failed: ${failed.map((f) => f.code).join(', ')}`;

      const pending =
        existing ??
        (await deps.repos.reconciliations.create(ctx.tenantId, {
          strategyId: ctx.strategyId,
          interestCycleId: cycleId,
          kind: 'HELOC_INTEREST',
          correlationId: ctx.correlationId,
          state: 'PENDING',
        }));

      const completed = await deps.repos.reconciliations.complete(
        ctx.tenantId,
        pending.id,
        pending.version,
        state,
        summary,
        items,
      );

      deps.logger.info(
        {
          ...activityLogFields(ctx),
          activity: 'reconcileInterestCycle',
          reconciliationId: completed.reconciliation.id,
          state,
        },
        'interest cycle reconciled',
      );

      if (state === 'FAILED') {
        nonRetryable(summary, 'RECONCILIATION_FAILED', {
          reconciliationId: completed.reconciliation.id,
          failedCodes: failed.map((f) => f.code),
          ledgerImbalance: failed.some((f) => f.code === 'LEDGER_BALANCED'),
        });
      }

      return {
        reconciliationId: completed.reconciliation.id,
        state,
        summary,
        items: completed.items.map((i) => ({
          code: i.code,
          result: i.result,
          expectedValue: i.expectedValue,
          actualValue: i.actualValue,
        })),
      };
    },

    async completeInterestCycle(
      ctx: ActivityContext,
    ): Promise<{ cycleId: string; state: 'COMPLETED' }> {
      const cycleId = requireCycleId(ctx.cycleId);
      try {
        return await withTransaction(deps.prisma, async (tx) => {
          const repos = createRepositories(tx);
          const cycle = await repos.interestCycles.findById(ctx.tenantId, cycleId);
          if (!cycle || cycle.strategyId !== ctx.strategyId) {
            nonRetryable('Interest cycle not found', 'NOT_FOUND');
          }
          if (cycle.state === 'COMPLETED') {
            return { cycleId: cycle.id, state: 'COMPLETED' as const };
          }
          if (cycle.state !== 'RECONCILING') {
            nonRetryable(
              'Interest cycle must be RECONCILING to complete',
              'INVALID_STATUS_TRANSITION',
              {
                state: cycle.state,
              },
            );
          }
          const updated = await repos.interestCycles.updateState(
            ctx.tenantId,
            cycle.id,
            cycle.version,
            'RECONCILING',
            'COMPLETED',
          );
          await repos.interestCycles.patchFields(ctx.tenantId, updated.id, updated.version, {
            completedAt: new Date(),
          });
          return { cycleId: updated.id, state: 'COMPLETED' as const };
        });
      } catch (error) {
        mapDomainOrContractError(error);
      }
    },

    async failInterestCycle(
      ctx: ActivityContext & {
        code: string;
        message: string;
        details?: Record<string, unknown>;
        terminalState?: 'PAUSED' | 'FAILED';
      },
    ): Promise<{
      strategyId: string;
      state: 'PAUSED';
      exceptionId: string;
      cycleId: string;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx, {
        requireActive: false,
      });
      assertSnapshotMatchesCtx(snapshot, ctx);
      const terminal = ctx.terminalState ?? 'PAUSED';
      const pauseConversions = shouldPauseFutureConversionsOnInterestFailure();

      try {
        return await withTransaction(deps.prisma, async (tx) => {
          const repos = createRepositories(tx);
          const strategy = await repos.strategies.findById(ctx.tenantId, ctx.strategyId);
          if (!strategy) {
            nonRetryable('Strategy not found', 'NOT_FOUND');
          }

          let cycleId = ctx.cycleId ?? '';
          if (ctx.cycleId) {
            const cycle = await repos.interestCycles.findById(ctx.tenantId, ctx.cycleId);
            if (
              cycle &&
              cycle.state !== 'COMPLETED' &&
              cycle.state !== 'PAUSED' &&
              cycle.state !== 'FAILED'
            ) {
              const updated = await repos.interestCycles.updateState(
                ctx.tenantId,
                cycle.id,
                cycle.version,
                cycle.state,
                terminal,
              );
              await repos.interestCycles.patchFields(ctx.tenantId, updated.id, updated.version, {
                failureCode: ctx.code,
                failureMessage: ctx.message,
                completedAt: new Date(),
              });
              cycleId = updated.id;
            } else if (cycle) {
              cycleId = cycle.id;
            }
          }

          const exception = await repos.exceptions.create(ctx.tenantId, {
            strategyId: ctx.strategyId,
            code: ctx.code,
            message: ctx.message,
            correlationId: ctx.correlationId,
            details: redactObject({
              ...(ctx.details ?? {}),
              interestCycleId: cycleId,
              interestPeriod: ctx.interestPeriod,
              pauseFutureConversions: pauseConversions,
            }) as Prisma.InputJsonValue,
          });

          let paused = strategy;
          if (pauseConversions && strategy.state !== 'PAUSED') {
            paused = await repos.strategies.updateState(
              ctx.tenantId,
              strategy.id,
              strategy.version,
              'PAUSED',
              ctx.code,
            );
          }

          await repos.audit.create(ctx.tenantId, {
            actorType: 'SYSTEM',
            action: 'SAFETY_PAUSE',
            resourceType: 'InterestCycle',
            resourceId: cycleId || strategy.id,
            correlationId: ctx.correlationId,
            payloadRedacted: redactObject({
              code: ctx.code,
              message: ctx.message,
              interestCycleId: cycleId,
              pauseFutureConversions: pauseConversions,
              exceptionId: exception.id,
            }) as Prisma.InputJsonValue,
          });

          deps.logger.info(
            {
              ...activityLogFields(ctx),
              activity: 'failInterestCycle',
              exceptionId: exception.id,
              code: ctx.code,
              pauseFutureConversions: pauseConversions,
            },
            'interest cycle failed; strategy pause policy applied',
          );

          return {
            strategyId: paused.id,
            state: 'PAUSED' as const,
            exceptionId: exception.id,
            cycleId,
          };
        });
      } catch (error) {
        mapDomainOrContractError(error);
      }
    },
  };
}

export type InterestActivities = ReturnType<typeof createInterestActivities>;
