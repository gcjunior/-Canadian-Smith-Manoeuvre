import type { BrokerageClient, ProviderOrder } from '@csm/brokerage-client';
import type { Repositories } from '@csm/database';
import type { Logger } from '@csm/observability';
import { csmMetrics } from '@csm/observability';
import type { InvestmentOrderState } from '@prisma/client';
import { Prisma } from '@prisma/client';

import type { ActivityContext } from '../shared/context.js';
import { activityLogFields } from '../shared/context.js';
import { mapProviderError, nonRetryable, retryable } from '../shared/errors.js';
import {
  isProviderAmbiguous,
  isProviderNotFound,
  providerErrorMessage,
} from '../shared/provider-errors.js';
import { mapDomainOrContractError } from '../shared/guards.js';
import { activityHeartbeat } from '../shared/heartbeat.js';
import {
  assertSnapshotMatchesCtx,
  loadAuthoritativeStrategySnapshot,
} from '../shared/strategy-snapshot.js';

function mapProviderOrderState(state: string): InvestmentOrderState {
  switch (state) {
    // Provider "CREATED" means accepted; domain persists as SUBMITTED after POST.
    case 'CREATED':
    case 'SUBMITTED':
      return 'SUBMITTED';
    case 'PARTIALLY_FILLED':
      return 'PARTIALLY_FILLED';
    case 'FILLED':
      return 'FILLED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'REJECTED':
      return 'REJECTED';
    case 'UNKNOWN':
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}

async function applyOrderState(
  deps: { repos: Repositories },
  tenantId: string,
  order: NonNullable<Awaited<ReturnType<Repositories['investmentOrders']['findById']>>>,
  to: InvestmentOrderState,
  patch?: {
    providerOrderId?: string | null;
    submittedAt?: Date | null;
    filledAt?: Date | null;
    quantity?: Prisma.Decimal | null;
  },
) {
  let current = order;
  if (current.state === to) {
    return current;
  }

  const step = async (next: InvestmentOrderState) => {
    if (current.state === next) {
      return;
    }
    try {
      current = await deps.repos.investmentOrders.updateState(
        tenantId,
        current.id,
        current.version,
        current.state,
        next,
        patch,
      );
    } catch (error) {
      mapDomainOrContractError(error);
    }
  };

  // Walk legal transitions toward terminal provider state.
  if (current.state === 'CREATED' && to === 'UNKNOWN') {
    await step('UNKNOWN');
  } else if (
    current.state === 'CREATED' &&
    (to === 'SUBMITTED' || to === 'PARTIALLY_FILLED' || to === 'FILLED' || to === 'UNKNOWN')
  ) {
    await step('SUBMITTED');
  }
  if (current.state === 'SUBMITTED' && to === 'PARTIALLY_FILLED') {
    await step('PARTIALLY_FILLED');
  }
  if (
    (current.state === 'SUBMITTED' ||
      current.state === 'PARTIALLY_FILLED' ||
      current.state === 'UNKNOWN') &&
    to === 'FILLED'
  ) {
    await step(to);
  } else if (current.state !== to) {
    await step(to);
  }
  return current;
}

export function createBrokerageActivities(deps: {
  logger: Logger;
  repos: Repositories;
  brokerageClient: BrokerageClient;
}) {
  return {
    async getSettledCash(ctx: ActivityContext): Promise<{
      settledCashCents: string;
      pendingCashCents: string;
      availableCashCents: string;
      restricted: boolean;
      observedAt: string;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'cash' });
      try {
        const cash = await deps.brokerageClient.getCash(
          snapshot.brokerageProviderId,
          ctx.correlationId,
        );
        return {
          settledCashCents: cash.settledCashCents.toString(),
          pendingCashCents: cash.pendingCashCents.toString(),
          availableCashCents: cash.availableCashCents.toString(),
          restricted: cash.restricted,
          observedAt: cash.observedAt,
        };
      } catch (error) {
        mapProviderError(error, 'getSettledCash');
      }
    },

    async submitInvestmentOrder(
      ctx: ActivityContext & { notionalCents: string; idempotencyKey: string },
    ): Promise<{
      investmentOrderId: string;
      providerOrderId: string;
      state: string;
      symbol: string;
      notionalCents: string;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      const notionalCents = BigInt(ctx.notionalCents);
      if (notionalCents <= 0n) {
        nonRetryable('Order notional must be positive', 'VALIDATION_FAILURE');
      }
      if (!snapshot.allowFractionalShares) {
        nonRetryable('Fractional shares required for notional ETF buys', 'VALIDATION_FAILURE');
      }

      let order = await deps.repos.investmentOrders.findByIdempotencyKey(
        ctx.tenantId,
        ctx.idempotencyKey,
      );
      if (order?.providerOrderId) {
        return {
          investmentOrderId: order.id,
          providerOrderId: order.providerOrderId,
          state: order.state,
          symbol: order.symbol,
          notionalCents: order.notionalCents.toString(),
        };
      }

      if (!order) {
        order = await deps.repos.investmentOrders.create(ctx.tenantId, {
          ...(ctx.cycleId !== undefined ? { cycleId: ctx.cycleId } : {}),
          brokerageAccountId: snapshot.brokerageFacilityId,
          idempotencyKey: ctx.idempotencyKey,
          symbol: snapshot.symbol,
          notionalCents,
          correlationId: ctx.correlationId,
          state: 'CREATED',
        });
      }

      // Intent without provider order id — GET by key before any re-POST.
      let providerOrder: ProviderOrder | undefined;
      if (!order.providerOrderId) {
        try {
          providerOrder = await deps.brokerageClient.findOrderByIdempotencyKey(
            ctx.idempotencyKey,
            ctx.correlationId,
          );
        } catch (error) {
          if (!isProviderNotFound(error)) {
            mapProviderError(error, 'submitInvestmentOrder.preflight');
          }
        }
      }

      deps.logger.info(
        {
          ...activityLogFields(ctx),
          activity: 'submitInvestmentOrder',
          investmentOrderId: order.id,
        },
        'submitting investment order',
      );

      if (!providerOrder) {
        try {
          providerOrder = await deps.brokerageClient.submitOrder({
            accountId: snapshot.brokerageProviderId,
            symbol: snapshot.symbol,
            side: 'BUY',
            notionalCents,
            idempotencyKey: ctx.idempotencyKey,
            correlationId: ctx.correlationId,
          });
        } catch (error) {
          if (isProviderAmbiguous(error)) {
            if (order.state === 'CREATED' || order.state === 'SUBMITTED') {
              await applyOrderState(deps, ctx.tenantId, order, 'UNKNOWN');
            }
            nonRetryable(providerErrorMessage(error), 'AMBIGUOUS_RESULT', {
              idempotencyKey: ctx.idempotencyKey,
              investmentOrderId: order.id,
            });
          }
          mapProviderError(error, 'submitInvestmentOrder');
        }
      }

      order = await applyOrderState(
        deps,
        ctx.tenantId,
        order,
        mapProviderOrderState(providerOrder.state),
        {
          providerOrderId: providerOrder.providerOrderId,
          submittedAt: providerOrder.submittedAt ? new Date(providerOrder.submittedAt) : new Date(),
          quantity: providerOrder.quantity ? new Prisma.Decimal(providerOrder.quantity) : null,
        },
      );

      if (providerOrder.state === 'REJECTED' || providerOrder.state === 'CANCELLED') {
        nonRetryable('Investment order rejected', 'BUSINESS_REJECTION', {
          failureCode: providerOrder.failureCode,
        });
      }

      return {
        investmentOrderId: order.id,
        providerOrderId: providerOrder.providerOrderId,
        state: providerOrder.state,
        symbol: providerOrder.symbol,
        notionalCents: providerOrder.notionalCents.toString(),
      };
    },

    async resolveAmbiguousInvestmentOrder(
      ctx: ActivityContext & { idempotencyKey: string },
    ): Promise<{
      investmentOrderId: string;
      providerOrderId: string;
      state: string;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'resolve-order' });

      let providerOrder: ProviderOrder;
      try {
        providerOrder = await deps.brokerageClient.resolveAmbiguousOrder({
          idempotencyKey: ctx.idempotencyKey,
          correlationId: ctx.correlationId,
        });
      } catch (error) {
        mapProviderError(error, 'resolveAmbiguousInvestmentOrder');
      }

      const order = await deps.repos.investmentOrders.findByIdempotencyKey(
        ctx.tenantId,
        ctx.idempotencyKey,
      );
      if (!order) {
        nonRetryable('Investment order intent missing', 'NOT_FOUND');
      }

      const updated = await applyOrderState(
        deps,
        ctx.tenantId,
        order,
        mapProviderOrderState(providerOrder.state),
        {
          providerOrderId: providerOrder.providerOrderId,
          submittedAt: providerOrder.submittedAt ? new Date(providerOrder.submittedAt) : null,
          filledAt: providerOrder.filledAt ? new Date(providerOrder.filledAt) : null,
          quantity: providerOrder.quantity ? new Prisma.Decimal(providerOrder.quantity) : null,
        },
      );

      return {
        investmentOrderId: updated.id,
        providerOrderId: providerOrder.providerOrderId,
        state: providerOrder.state,
      };
    },

    async confirmInvestmentOrder(
      ctx: ActivityContext & { idempotencyKey: string; providerOrderId: string },
    ): Promise<{ state: string; filledQuantity: string; filledAt: string | null }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'confirm-order' });

      let providerOrder: ProviderOrder;
      try {
        providerOrder = await deps.brokerageClient.findOrderByIdempotencyKey(
          ctx.idempotencyKey,
          ctx.correlationId,
        );
      } catch (error) {
        mapProviderError(error, 'confirmInvestmentOrder');
      }
      if (providerOrder.providerOrderId !== ctx.providerOrderId) {
        nonRetryable('Provider order id mismatch', 'VALIDATION_FAILURE');
      }

      const order = await deps.repos.investmentOrders.findByIdempotencyKey(
        ctx.tenantId,
        ctx.idempotencyKey,
      );
      if (!order) {
        nonRetryable('Investment order not found', 'NOT_FOUND');
      }

      if (providerOrder.state === 'PARTIALLY_FILLED') {
        await applyOrderState(deps, ctx.tenantId, order, 'PARTIALLY_FILLED', {
          providerOrderId: providerOrder.providerOrderId,
          filledAt: providerOrder.filledAt ? new Date(providerOrder.filledAt) : null,
          quantity: providerOrder.quantity ? new Prisma.Decimal(providerOrder.quantity) : null,
        });
        nonRetryable('Investment order partially filled', 'PARTIAL_FILL', {
          state: providerOrder.state,
        });
      }

      if (
        providerOrder.state !== 'FILLED' &&
        providerOrder.state !== 'REJECTED' &&
        providerOrder.state !== 'CANCELLED'
      ) {
        retryable(`Order not filled yet (${providerOrder.state})`, 'ORDER_PENDING');
      }

      await applyOrderState(deps, ctx.tenantId, order, mapProviderOrderState(providerOrder.state), {
        providerOrderId: providerOrder.providerOrderId,
        filledAt: providerOrder.filledAt ? new Date(providerOrder.filledAt) : null,
        quantity: providerOrder.quantity ? new Prisma.Decimal(providerOrder.quantity) : null,
      });

      if (providerOrder.state === 'REJECTED' || providerOrder.state === 'CANCELLED') {
        nonRetryable('Investment order failed', 'BUSINESS_REJECTION', {
          failureCode: providerOrder.failureCode,
        });
      }

      if (order.submittedAt) {
        csmMetrics.orderFillDurationMs.record(Date.now() - order.submittedAt.getTime(), {
          tenantId: ctx.tenantId,
        });
      }

      return {
        state: providerOrder.state,
        filledQuantity: providerOrder.filledQuantity,
        filledAt: providerOrder.filledAt,
      };
    },

    async confirmInvestmentSettlement(
      ctx: ActivityContext & { idempotencyKey: string; expectedNotionalCents: string },
    ): Promise<{ settled: true; settledCashCents: string; symbol: string }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'confirm-settlement' });

      let providerOrder: ProviderOrder;
      try {
        providerOrder = await deps.brokerageClient.findOrderByIdempotencyKey(
          ctx.idempotencyKey,
          ctx.correlationId,
        );
      } catch (error) {
        mapProviderError(error, 'confirmInvestmentSettlement');
      }
      if (providerOrder.state !== 'FILLED') {
        retryable(`Order settlement pending (${providerOrder.state})`, 'SETTLEMENT_PENDING');
      }
      if (providerOrder.notionalCents !== BigInt(ctx.expectedNotionalCents)) {
        nonRetryable('Filled notional mismatch', 'BUSINESS_REJECTION', {
          expected: ctx.expectedNotionalCents,
          actual: providerOrder.notionalCents.toString(),
        });
      }

      let cash;
      try {
        cash = await deps.brokerageClient.getCash(snapshot.brokerageProviderId, ctx.correlationId);
      } catch (error) {
        mapProviderError(error, 'confirmInvestmentSettlement.cash');
      }
      if (cash.restricted) {
        nonRetryable('Brokerage account restricted after fill', 'BUSINESS_REJECTION');
      }

      return {
        settled: true,
        settledCashCents: cash.settledCashCents.toString(),
        symbol: snapshot.symbol,
      };
    },
  };
}

export type BrokerageActivities = ReturnType<typeof createBrokerageActivities>;
