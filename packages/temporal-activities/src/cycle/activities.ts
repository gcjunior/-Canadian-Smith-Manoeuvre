import {
  createRepositories,
  withTransaction,
  type PrismaClient,
  type Repositories,
} from '@csm/database';
import {
  conversionLedgerEventId,
  conversionReconciliationPassed,
  evaluateConversionReconciliation,
  SUPPORTED_BROKERAGE_DEPOSIT_FEE_CENTS,
} from '@csm/domain';
import type { Logger } from '@csm/observability';
import { csmMetrics, redactObject } from '@csm/observability';
import type { MonthlyConversionCycleState, Prisma } from '@prisma/client';

import type { ActivityContext } from '../shared/context.js';
import { activityLogFields } from '../shared/context.js';
import { nonRetryable } from '../shared/errors.js';
import { mapDomainOrContractError, requireCycleId } from '../shared/guards.js';
import { activityHeartbeat } from '../shared/heartbeat.js';
import { noteSafetyPauseMetrics } from '../shared/observability.js';
import {
  assertSnapshotMatchesCtx,
  loadAuthoritativeStrategySnapshot,
  type StrategySnapshot,
} from '../shared/strategy-snapshot.js';

function serializeSnapshot(snapshot: StrategySnapshot) {
  return {
    ...snapshot,
    userMonthlyCapCents: snapshot.userMonthlyCapCents.toString(),
  };
}

export function createCycleActivities(deps: {
  logger: Logger;
  repos: Repositories;
  prisma: PrismaClient;
}) {
  return {
    async loadStrategySnapshot(
      ctx: ActivityContext,
    ): Promise<ReturnType<typeof serializeSnapshot>> {
      deps.logger.info(
        { ...activityLogFields(ctx), activity: 'loadStrategySnapshot' },
        'loading authoritative strategy snapshot',
      );
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx, {
        requireActive: true,
      });
      assertSnapshotMatchesCtx(snapshot, ctx);
      return serializeSnapshot(snapshot);
    },

    async reserveMonthlyCycle(ctx: ActivityContext & { paymentPeriod: string }): Promise<{
      cycleId: string;
      state: MonthlyConversionCycleState;
      paymentPeriod: string;
      created: boolean;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      const period = ctx.paymentPeriod;
      if (!period) {
        nonRetryable('paymentPeriod required', 'VALIDATION_FAILURE');
      }

      try {
        return await withTransaction(deps.prisma, async (tx) => {
          const repos = createRepositories(tx);

          const existing = await repos.cycles.findByPeriod(ctx.tenantId, ctx.strategyId, period);
          if (existing) {
            if (existing.state === 'SCHEDULED') {
              const updated = await repos.cycles.updateState(
                ctx.tenantId,
                existing.id,
                existing.version,
                'SCHEDULED',
                'WAITING_FOR_MORTGAGE',
              );
              await repos.cycles.patchFields(ctx.tenantId, updated.id, updated.version, {
                startedAt: new Date(),
              });
              const refreshed = await repos.cycles.findById(ctx.tenantId, updated.id);
              return {
                cycleId: updated.id,
                state: refreshed?.state ?? 'WAITING_FOR_MORTGAGE',
                paymentPeriod: period,
                created: false,
              };
            }
            return {
              cycleId: existing.id,
              state: existing.state,
              paymentPeriod: existing.paymentPeriod,
              created: false,
            };
          }

          const created = await repos.cycles.create(ctx.tenantId, {
            strategyId: ctx.strategyId,
            paymentPeriod: period,
            correlationId: ctx.correlationId,
            state: 'SCHEDULED',
          });
          const reserved = await repos.cycles.updateState(
            ctx.tenantId,
            created.id,
            created.version,
            'SCHEDULED',
            'WAITING_FOR_MORTGAGE',
          );
          await repos.cycles.patchFields(ctx.tenantId, reserved.id, reserved.version, {
            startedAt: new Date(),
          });
          csmMetrics.cyclesStarted.add(1, { tenantId: ctx.tenantId });
          return {
            cycleId: reserved.id,
            state: 'WAITING_FOR_MORTGAGE' as const,
            paymentPeriod: period,
            created: true,
          };
        });
      } catch (error) {
        mapDomainOrContractError(error);
      }
    },

    async transitionCycleState(
      ctx: ActivityContext & {
        fromState: MonthlyConversionCycleState;
        toState: MonthlyConversionCycleState;
      },
    ): Promise<{ cycleId: string; state: MonthlyConversionCycleState }> {
      const cycleId = requireCycleId(ctx.cycleId);
      await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      activityHeartbeat({ phase: 'transition', from: ctx.fromState, to: ctx.toState });

      try {
        return await withTransaction(deps.prisma, async (tx) => {
          const repos = createRepositories(tx);
          const cycle = await repos.cycles.findById(ctx.tenantId, cycleId);
          if (!cycle || cycle.strategyId !== ctx.strategyId) {
            nonRetryable('Cycle not found for strategy', 'NOT_FOUND');
          }
          if (cycle.state === ctx.toState && cycle.state !== ctx.fromState) {
            // Idempotent re-entry after successful prior transition
            return { cycleId: cycle.id, state: cycle.state };
          }
          if (cycle.state !== ctx.fromState) {
            if (cycle.state === ctx.toState) {
              return { cycleId: cycle.id, state: cycle.state };
            }
            nonRetryable('Cycle state mismatch', 'INVALID_STATUS_TRANSITION', {
              expected: ctx.fromState,
              actual: cycle.state,
              to: ctx.toState,
            });
          }
          const updated = await repos.cycles.updateState(
            ctx.tenantId,
            cycle.id,
            cycle.version,
            ctx.fromState,
            ctx.toState,
          );
          return { cycleId: updated.id, state: updated.state };
        });
      } catch (error) {
        mapDomainOrContractError(error);
      }
    },

    async recordOperation(
      ctx: ActivityContext & {
        operationKey: string;
        operationType: string;
        payload: Record<string, unknown>;
      },
    ): Promise<{ recorded: true; operationKey: string; auditId: string }> {
      await loadAuthoritativeStrategySnapshot(deps.repos, ctx, { requireActive: false });
      const scope = 'cycle.operation';
      const existing = await deps.repos.idempotency.find(ctx.tenantId, scope, ctx.operationKey);
      if (existing?.state === 'COMPLETED' && existing.responseBody) {
        const body = existing.responseBody as { auditId?: string };
        if (body.auditId) {
          return { recorded: true, operationKey: ctx.operationKey, auditId: body.auditId };
        }
      }

      let record = existing;
      if (!record) {
        try {
          record = await deps.repos.idempotency.create(ctx.tenantId, {
            scope,
            key: ctx.operationKey,
            requestHash: ctx.operationType,
          });
        } catch (error) {
          mapDomainOrContractError(error);
        }
      }

      const audit = await deps.repos.audit.create(ctx.tenantId, {
        actorType: 'SYSTEM',
        action: 'OPERATION_RECORDED',
        resourceType: 'MonthlyConversionCycle',
        ...(ctx.cycleId !== undefined ? { resourceId: ctx.cycleId } : {}),
        correlationId: ctx.correlationId,
        payloadRedacted: redactObject({
          strategyId: ctx.strategyId,
          cycleId: ctx.cycleId,
          operationKey: ctx.operationKey,
          operationType: ctx.operationType,
          ...ctx.payload,
        }) as Prisma.InputJsonValue,
      });

      await deps.repos.idempotency.complete(ctx.tenantId, record.id, record.version, {
        auditId: audit.id,
      });

      deps.logger.info(
        {
          ...activityLogFields(ctx),
          activity: 'recordOperation',
          operationKey: ctx.operationKey,
          auditId: audit.id,
        },
        'recorded cycle operation',
      );

      return { recorded: true, operationKey: ctx.operationKey, auditId: audit.id };
    },

    async reconcileCycle(ctx: ActivityContext): Promise<{
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
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'reconcile' });

      const cycle = await deps.repos.cycles.findById(ctx.tenantId, cycleId);
      if (!cycle || cycle.strategyId !== ctx.strategyId) {
        nonRetryable('Cycle not found', 'NOT_FOUND');
      }

      const existing = await deps.repos.reconciliations.findByCycle(ctx.tenantId, cycleId);
      if (existing?.state === 'PASSED' || existing?.state === 'FAILED') {
        return {
          reconciliationId: existing.id,
          state: existing.state,
          summary: existing.summary ?? existing.state,
          items: [],
        };
      }

      const mortgagePayment = cycle.mortgagePaymentId
        ? await deps.prisma.mortgagePayment.findFirst({
            where: { id: cycle.mortgagePaymentId, tenantId: ctx.tenantId },
          })
        : null;

      const helocCredit = await deps.prisma.helocCreditEvent.findFirst({
        where: {
          tenantId: ctx.tenantId,
          helocId: snapshot.helocFacilityId,
          relatedPaymentPeriod: cycle.paymentPeriod,
        },
        orderBy: { observedAt: 'desc' },
      });

      const draw = await deps.repos.moneyMovements.findByCycleAndType(
        ctx.tenantId,
        cycleId,
        'HELOC_DRAW',
      );
      const transfer = await deps.repos.moneyMovements.findByCycleAndType(
        ctx.tenantId,
        cycleId,
        'HELOC_TO_BROKERAGE_TRANSFER',
      );
      const deposit = await deps.repos.moneyMovements.findByCycleAndType(
        ctx.tenantId,
        cycleId,
        'BROKERAGE_DEPOSIT',
      );
      const orders = await deps.prisma.investmentOrder.findMany({
        where: { tenantId: ctx.tenantId, cycleId },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      const order = orders[0] ?? null;
      const fills = order
        ? await deps.prisma.investmentFill.findMany({
            where: { tenantId: ctx.tenantId, orderId: order.id },
            orderBy: { filledAt: 'asc' },
          })
        : [];
      const fillAmountCents = fills.reduce((sum, f) => sum + f.amountCents, 0n);
      const fill = fills[0] ?? null;

      const ledger = await deps.repos.ledger.listByCycle(ctx.tenantId, cycleId);
      const remainingCashEventIds = new Set([
        conversionLedgerEventId(cycleId, 'remaining-cash:hold'),
        conversionLedgerEventId(cycleId, 'remaining-cash:clear'),
      ]);
      const hasRemainingCashLedger = ledger.some((e) =>
        remainingCashEventIds.has(e.businessEventId),
      );
      const remainingCash = deposit && order ? deposit.amountCents - order.notionalCents : null;
      const remainingCashExplicitlyRecorded =
        remainingCash !== null && (remainingCash === 0n || hasRemainingCashLedger);

      const providerIds = [
        draw?.providerTransactionId,
        transfer?.providerTransactionId,
        deposit?.providerTransactionId,
      ].filter((id): id is string => Boolean(id));
      let providerTxLinkedElsewhere = false;
      if (providerIds.length > 0) {
        const elsewhere = await deps.prisma.moneyMovement.findFirst({
          where: {
            tenantId: ctx.tenantId,
            providerTransactionId: { in: providerIds },
            cycleId: { not: cycleId },
          },
        });
        providerTxLinkedElsewhere = elsewhere !== null;
      }

      const accountIds = [
        draw?.sourceAccountId,
        draw?.destinationAccountId,
        transfer?.sourceAccountId,
        transfer?.destinationAccountId,
        deposit?.sourceAccountId,
        deposit?.destinationAccountId,
      ].filter((id): id is string => Boolean(id));
      let movementsCrossTenantOrUser = false;
      for (const accountId of accountIds) {
        const account = await deps.repos.accounts.findAccountById(ctx.tenantId, accountId);
        if (!account || account.userId !== snapshot.userId || account.tenantId !== ctx.tenantId) {
          movementsCrossTenantOrUser = true;
          break;
        }
      }

      const items = evaluateConversionReconciliation({
        mortgagePaymentState: mortgagePayment?.state ?? null,
        principalRepaidCents: cycle.principalRepaidCents,
        paymentPeriod: cycle.paymentPeriod,
        helocCreditRelatedPeriod: helocCredit?.relatedPaymentPeriod ?? null,
        newlyAvailableCreditCents: cycle.newlyAvailableCreditCents,
        drawAmountCents: draw?.amountCents ?? cycle.drawAmountCents,
        drawState: draw?.state ?? null,
        drawProviderTxId: draw?.providerTransactionId ?? null,
        transferAmountCents: transfer?.amountCents ?? null,
        transferState: transfer?.state ?? null,
        transferProviderTxId: transfer?.providerTransactionId ?? null,
        depositAmountCents: deposit?.amountCents ?? null,
        depositState: deposit?.state ?? null,
        depositProviderId: deposit?.providerTransactionId ?? null,
        depositFeeCents: SUPPORTED_BROKERAGE_DEPOSIT_FEE_CENTS,
        orderNotionalCents: order?.notionalCents ?? null,
        orderState: order?.state ?? null,
        orderSymbol: order?.symbol ?? null,
        orderBrokerageAccountId: order?.brokerageAccountId ?? null,
        expectedSymbol: snapshot.symbol,
        expectedBrokerageAccountId: snapshot.brokerageFacilityId,
        fillOrderId: fill?.orderId ?? null,
        fillAmountCents: fill ? fillAmountCents : null,
        remainingCashCents: remainingCash,
        remainingCashExplicitlyRecorded,
        providerTxLinkedElsewhere,
        movementsCrossTenantOrUser,
        ledgerLegs: ledger.map((e) => ({
          direction: e.direction,
          amountCents: e.amountCents,
        })),
      });

      const passed = conversionReconciliationPassed(items);
      const state = passed ? ('PASSED' as const) : ('FAILED' as const);
      const failed = items.filter((i) => i.result === 'FAIL');
      const summary =
        state === 'PASSED'
          ? 'Cycle money trail reconciled'
          : `Reconciliation failed: ${failed.map((f) => f.code).join(', ')}`;

      const pending =
        existing ??
        (await deps.repos.reconciliations.create(ctx.tenantId, {
          strategyId: ctx.strategyId,
          cycleId,
          kind: 'MONTHLY_CONVERSION',
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

    async skipCycle(
      ctx: ActivityContext & { reasonCode: string; reason: string },
    ): Promise<{ cycleId: string; state: 'SKIPPED' }> {
      const cycleId = requireCycleId(ctx.cycleId);
      await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      try {
        return await withTransaction(deps.prisma, async (tx) => {
          const repos = createRepositories(tx);
          const cycle = await repos.cycles.findById(ctx.tenantId, cycleId);
          if (!cycle || cycle.strategyId !== ctx.strategyId) {
            nonRetryable('Cycle not found', 'NOT_FOUND');
          }
          if (cycle.state === 'SKIPPED') {
            return { cycleId: cycle.id, state: 'SKIPPED' as const };
          }
          if (cycle.state !== 'WAITING_FOR_HELOC') {
            nonRetryable('Cycle must be WAITING_FOR_HELOC to skip', 'INVALID_STATUS_TRANSITION', {
              state: cycle.state,
            });
          }
          const updated = await repos.cycles.updateState(
            ctx.tenantId,
            cycle.id,
            cycle.version,
            'WAITING_FOR_HELOC',
            'SKIPPED',
          );
          await repos.audit.create(ctx.tenantId, {
            actorType: 'SYSTEM',
            action: 'CYCLE_SKIPPED',
            resourceType: 'MonthlyConversionCycle',
            resourceId: cycle.id,
            correlationId: ctx.correlationId,
            payloadRedacted: redactObject({
              reasonCode: ctx.reasonCode,
              reason: ctx.reason,
              strategyId: ctx.strategyId,
              paymentPeriod: cycle.paymentPeriod,
            }) as Prisma.InputJsonValue,
          });
          return { cycleId: updated.id, state: 'SKIPPED' as const };
        });
      } catch (error) {
        mapDomainOrContractError(error);
      }
    },

    async completeCycle(ctx: ActivityContext): Promise<{ cycleId: string; state: 'COMPLETED' }> {
      const cycleId = requireCycleId(ctx.cycleId);
      await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      try {
        return await withTransaction(deps.prisma, async (tx) => {
          const repos = createRepositories(tx);
          const cycle = await repos.cycles.findById(ctx.tenantId, cycleId);
          if (!cycle || cycle.strategyId !== ctx.strategyId) {
            nonRetryable('Cycle not found', 'NOT_FOUND');
          }
          if (cycle.state === 'COMPLETED') {
            return { cycleId: cycle.id, state: 'COMPLETED' as const };
          }
          if (cycle.state !== 'RECONCILING') {
            nonRetryable('Cycle must be RECONCILING to complete', 'INVALID_STATUS_TRANSITION', {
              state: cycle.state,
            });
          }
          const updated = await repos.cycles.updateState(
            ctx.tenantId,
            cycle.id,
            cycle.version,
            'RECONCILING',
            'COMPLETED',
          );
          csmMetrics.cyclesCompleted.add(1, { tenantId: ctx.tenantId });
          return { cycleId: updated.id, state: 'COMPLETED' as const };
        });
      } catch (error) {
        mapDomainOrContractError(error);
      }
    },

    async pauseStrategyWithException(
      ctx: ActivityContext & {
        code: string;
        message: string;
        details?: Record<string, unknown>;
        cycleTerminalState?: Extract<MonthlyConversionCycleState, 'PAUSED' | 'FAILED'>;
      },
    ): Promise<{ strategyId: string; state: 'PAUSED'; exceptionId: string }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx, {
        requireActive: false,
      });
      assertSnapshotMatchesCtx(snapshot, ctx);

      try {
        return await withTransaction(deps.prisma, async (tx) => {
          const repos = createRepositories(tx);
          const strategy = await repos.strategies.findById(ctx.tenantId, ctx.strategyId);
          if (!strategy) {
            nonRetryable('Strategy not found', 'NOT_FOUND');
          }

          const exception = await repos.exceptions.create(ctx.tenantId, {
            strategyId: ctx.strategyId,
            ...(ctx.cycleId !== undefined ? { cycleId: ctx.cycleId } : {}),
            code: ctx.code,
            message: ctx.message,
            correlationId: ctx.correlationId,
            details: redactObject(ctx.details ?? {}) as Prisma.InputJsonValue,
          });

          let paused = strategy;
          if (strategy.state !== 'PAUSED') {
            paused = await repos.strategies.updateState(
              ctx.tenantId,
              strategy.id,
              strategy.version,
              'PAUSED',
              ctx.code,
            );
          }

          if (ctx.cycleId && ctx.cycleTerminalState) {
            const cycle = await repos.cycles.findById(ctx.tenantId, ctx.cycleId);
            if (
              cycle &&
              cycle.state !== 'COMPLETED' &&
              cycle.state !== 'SKIPPED' &&
              cycle.state !== 'PAUSED' &&
              cycle.state !== 'FAILED'
            ) {
              await repos.cycles.updateState(
                ctx.tenantId,
                cycle.id,
                cycle.version,
                cycle.state,
                ctx.cycleTerminalState,
              );
            }
          }

          await repos.audit.create(ctx.tenantId, {
            actorType: 'SYSTEM',
            action: 'SAFETY_PAUSE',
            resourceType: 'Strategy',
            resourceId: strategy.id,
            correlationId: ctx.correlationId,
            payloadRedacted: redactObject({
              code: ctx.code,
              message: ctx.message,
              cycleId: ctx.cycleId,
              exceptionId: exception.id,
            }) as Prisma.InputJsonValue,
          });

          deps.logger.info(
            {
              ...activityLogFields(ctx),
              activity: 'pauseStrategyWithException',
              exceptionId: exception.id,
              code: ctx.code,
            },
            'strategy paused with exception',
          );
          noteSafetyPauseMetrics(deps.logger, ctx.code, ctx.correlationId);

          return {
            strategyId: paused.id,
            state: 'PAUSED' as const,
            exceptionId: exception.id,
          };
        });
      } catch (error) {
        mapDomainOrContractError(error);
      }
    },
  };
}

export type CycleActivities = ReturnType<typeof createCycleActivities>;
