import type { BankClient, ProviderTransfer } from '@csm/bank-client';
import type { BrokerageClient, ProviderDeposit } from '@csm/brokerage-client';
import type { Repositories } from '@csm/database';
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

function depositIdempotencyKey(transferKey: string): string {
  return `${transferKey}:deposit`;
}

export function createTransferActivities(deps: {
  logger: Logger;
  repos: Repositories;
  bankClient: BankClient;
  brokerageClient: BrokerageClient;
}) {
  return {
    async initiateBrokerageTransfer(
      ctx: ActivityContext & { amountCents: string; idempotencyKey: string },
    ): Promise<{
      moneyMovementId: string;
      providerTransferId: string;
      depositMoneyMovementId: string;
      providerDepositId: string;
      state: string;
      amountCents: string;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      const amountCents = BigInt(ctx.amountCents);
      if (amountCents <= 0n) {
        nonRetryable('Transfer amount must be positive', 'VALIDATION_FAILURE');
      }

      let transferMm = await deps.repos.moneyMovements.findByIdempotencyKey(
        ctx.tenantId,
        ctx.idempotencyKey,
      );
      if (transferMm?.providerTransactionId && transferMm.state !== 'REQUESTED') {
        const depositKey = depositIdempotencyKey(ctx.idempotencyKey);
        const depositMm = await deps.repos.moneyMovements.findByIdempotencyKey(
          ctx.tenantId,
          depositKey,
        );
        if (depositMm?.providerTransactionId) {
          return {
            moneyMovementId: transferMm.id,
            providerTransferId: transferMm.providerTransactionId,
            depositMoneyMovementId: depositMm.id,
            providerDepositId: depositMm.providerTransactionId,
            state: transferMm.state,
            amountCents: transferMm.amountCents.toString(),
          };
        }
      }

      if (!transferMm) {
        transferMm = await deps.repos.moneyMovements.create(ctx.tenantId, {
          ...(ctx.cycleId !== undefined ? { cycleId: ctx.cycleId } : {}),
          type: 'HELOC_TO_BROKERAGE_TRANSFER',
          amountCents,
          // Ordinary bank clearing path (HELOC draw funds operating account first).
          sourceAccountId: snapshot.bankAccountId,
          destinationAccountId: snapshot.brokerageAccountId,
          idempotencyKey: ctx.idempotencyKey,
          correlationId: ctx.correlationId,
          state: 'REQUESTED',
        });
      }

      deps.logger.info(
        {
          ...activityLogFields(ctx),
          activity: 'initiateBrokerageTransfer',
          moneyMovementId: transferMm.id,
        },
        'initiating bank transfer to brokerage rail',
      );

      let transfer: ProviderTransfer | undefined;
      // Intent without provider id — GET by key before any re-POST.
      if (!transferMm.providerTransactionId) {
        try {
          transfer = await deps.bankClient.findTransferByIdempotencyKey(
            ctx.idempotencyKey,
            ctx.correlationId,
          );
        } catch (error) {
          if (!isProviderNotFound(error)) {
            mapProviderError(error, 'initiateBrokerageTransfer.preflight');
          }
        }
      }

      if (!transfer) {
        try {
          transfer = await deps.bankClient.initiateTransfer({
            sourceAccountId: snapshot.bankProviderId,
            destinationAccountId: snapshot.brokerageProviderId,
            amountCents,
            idempotencyKey: ctx.idempotencyKey,
            correlationId: ctx.correlationId,
          });
        } catch (error) {
          if (isProviderAmbiguous(error)) {
            if (transferMm.state === 'REQUESTED' || transferMm.state === 'PENDING') {
              await applyMoneyMovementState(
                deps.repos.moneyMovements,
                ctx.tenantId,
                transferMm,
                'UNKNOWN',
              );
            }
            nonRetryable(providerErrorMessage(error), 'AMBIGUOUS_RESULT', {
              idempotencyKey: ctx.idempotencyKey,
              moneyMovementId: transferMm.id,
            });
          }
          mapProviderError(error, 'initiateBrokerageTransfer');
        }
      }

      transferMm = await applyMoneyMovementState(
        deps.repos.moneyMovements,
        ctx.tenantId,
        transferMm,
        mapProviderToMoneyMovementState(transfer.state === 'PENDING' ? 'PENDING' : transfer.state),
        {
          providerTransactionId: transfer.providerTransactionId,
          failureCode: transfer.failureCode,
          settledAt: transfer.settledAt ? new Date(transfer.settledAt) : null,
        },
      );

      if (transfer.state === 'FAILED') {
        nonRetryable('Brokerage transfer rejected', 'BUSINESS_REJECTION', {
          failureCode: transfer.failureCode,
        });
      }

      const depositKey = depositIdempotencyKey(ctx.idempotencyKey);
      let depositMm = await deps.repos.moneyMovements.findByIdempotencyKey(
        ctx.tenantId,
        depositKey,
      );
      if (!depositMm) {
        depositMm = await deps.repos.moneyMovements.create(ctx.tenantId, {
          ...(ctx.cycleId !== undefined ? { cycleId: ctx.cycleId } : {}),
          type: 'BROKERAGE_DEPOSIT',
          amountCents,
          sourceAccountId: snapshot.bankAccountId,
          destinationAccountId: snapshot.brokerageAccountId,
          idempotencyKey: depositKey,
          correlationId: ctx.correlationId,
          state: 'REQUESTED',
        });
      }

      let deposit: ProviderDeposit | undefined;
      if (!depositMm.providerTransactionId) {
        try {
          deposit = await deps.brokerageClient.findDepositByIdempotencyKey(
            depositKey,
            ctx.correlationId,
          );
        } catch (error) {
          if (!isProviderNotFound(error)) {
            mapProviderError(error, 'initiateBrokerageTransfer.depositPreflight');
          }
        }
      }

      if (!deposit) {
        try {
          deposit = await deps.brokerageClient.initiateDeposit({
            accountId: snapshot.brokerageProviderId,
            amountCents,
            idempotencyKey: depositKey,
            correlationId: ctx.correlationId,
          });
        } catch (error) {
          if (isProviderAmbiguous(error)) {
            if (depositMm.state === 'REQUESTED' || depositMm.state === 'PENDING') {
              await applyMoneyMovementState(
                deps.repos.moneyMovements,
                ctx.tenantId,
                depositMm,
                'UNKNOWN',
              );
            }
            nonRetryable(providerErrorMessage(error), 'AMBIGUOUS_RESULT', {
              idempotencyKey: depositKey,
              moneyMovementId: depositMm.id,
            });
          }
          mapProviderError(error, 'initiateBrokerageTransfer.deposit');
        }
      }

      depositMm = await applyMoneyMovementState(
        deps.repos.moneyMovements,
        ctx.tenantId,
        depositMm,
        mapProviderToMoneyMovementState(deposit.state === 'PENDING' ? 'PENDING' : deposit.state),
        {
          providerTransactionId: deposit.providerDepositId,
          failureCode: deposit.failureCode,
          settledAt: deposit.settledAt ? new Date(deposit.settledAt) : null,
        },
      );

      const existingDeposit = await deps.repos.brokerageDeposits.findByMoneyMovementId(
        ctx.tenantId,
        depositMm.id,
      );
      if (!existingDeposit) {
        await deps.repos.brokerageDeposits.create(ctx.tenantId, {
          ...(ctx.cycleId !== undefined ? { cycleId: ctx.cycleId } : {}),
          brokerageAccountId: snapshot.brokerageFacilityId,
          moneyMovementId: depositMm.id,
          amountCents,
          providerDepositId: deposit.providerDepositId,
          state: mapProviderToMoneyMovementState(deposit.state),
        });
      }

      return {
        moneyMovementId: transferMm.id,
        providerTransferId: transfer.providerTransactionId,
        depositMoneyMovementId: depositMm.id,
        providerDepositId: deposit.providerDepositId,
        state: transfer.state,
        amountCents: amountCents.toString(),
      };
    },

    async resolveAmbiguousBrokerageTransfer(
      ctx: ActivityContext & { idempotencyKey: string },
    ): Promise<{
      moneyMovementId: string;
      providerTransferId: string;
      depositMoneyMovementId: string | null;
      providerDepositId: string | null;
      transferState: string;
      depositState: string | null;
    }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'resolve-transfer' });

      let transfer: ProviderTransfer;
      try {
        transfer = await deps.bankClient.resolveAmbiguousTransfer({
          idempotencyKey: ctx.idempotencyKey,
          correlationId: ctx.correlationId,
        });
      } catch (error) {
        mapProviderError(error, 'resolveAmbiguousBrokerageTransfer');
      }

      const transferMm = await deps.repos.moneyMovements.findByIdempotencyKey(
        ctx.tenantId,
        ctx.idempotencyKey,
      );
      if (!transferMm) {
        nonRetryable('Transfer money movement intent missing', 'NOT_FOUND');
      }
      await applyMoneyMovementState(
        deps.repos.moneyMovements,
        ctx.tenantId,
        transferMm,
        mapProviderToMoneyMovementState(transfer.state),
        {
          providerTransactionId: transfer.providerTransactionId,
          settledAt: transfer.settledAt ? new Date(transfer.settledAt) : null,
          failureCode: transfer.failureCode,
        },
      );

      const depositKey = depositIdempotencyKey(ctx.idempotencyKey);
      let depositMm = await deps.repos.moneyMovements.findByIdempotencyKey(
        ctx.tenantId,
        depositKey,
      );
      let depositState: string | null = null;
      let providerDepositId: string | null = null;

      if (depositMm) {
        try {
          const deposit = await deps.brokerageClient.resolveAmbiguousDeposit({
            idempotencyKey: depositKey,
            correlationId: ctx.correlationId,
          });
          depositMm = await applyMoneyMovementState(
            deps.repos.moneyMovements,
            ctx.tenantId,
            depositMm,
            mapProviderToMoneyMovementState(deposit.state),
            {
              providerTransactionId: deposit.providerDepositId,
              settledAt: deposit.settledAt ? new Date(deposit.settledAt) : null,
              failureCode: deposit.failureCode,
            },
          );
          depositState = deposit.state;
          providerDepositId = deposit.providerDepositId;
        } catch (error) {
          mapProviderError(error, 'resolveAmbiguousBrokerageTransfer.deposit');
        }
      }

      return {
        moneyMovementId: transferMm.id,
        providerTransferId: transfer.providerTransactionId,
        depositMoneyMovementId: depositMm?.id ?? null,
        providerDepositId,
        transferState: transfer.state,
        depositState,
      };
    },

    async confirmBrokerageTransfer(
      ctx: ActivityContext & {
        idempotencyKey: string;
        providerTransferId: string;
        providerDepositId: string;
      },
    ): Promise<{ transferState: string; depositState: string }> {
      const snapshot = await loadAuthoritativeStrategySnapshot(deps.repos, ctx);
      assertSnapshotMatchesCtx(snapshot, ctx);
      activityHeartbeat({ phase: 'confirm-transfer' });

      let transfer: ProviderTransfer;
      try {
        transfer = await deps.bankClient.findTransferByIdempotencyKey(
          ctx.idempotencyKey,
          ctx.correlationId,
        );
      } catch (error) {
        mapProviderError(error, 'confirmBrokerageTransfer');
      }
      if (transfer.providerTransactionId !== ctx.providerTransferId) {
        nonRetryable('Provider transfer id mismatch', 'VALIDATION_FAILURE');
      }

      const transferMm = await deps.repos.moneyMovements.findByIdempotencyKey(
        ctx.tenantId,
        ctx.idempotencyKey,
      );
      if (!transferMm) {
        nonRetryable('Transfer money movement not found', 'NOT_FOUND');
      }

      if (transfer.state !== 'SETTLED' && transfer.state !== 'FAILED') {
        retryable(`Transfer not settled yet (${transfer.state})`, 'TRANSFER_PENDING');
      }

      await applyMoneyMovementState(
        deps.repos.moneyMovements,
        ctx.tenantId,
        transferMm,
        mapProviderToMoneyMovementState(transfer.state),
        {
          providerTransactionId: transfer.providerTransactionId,
          settledAt: transfer.settledAt ? new Date(transfer.settledAt) : null,
          failureCode: transfer.failureCode,
        },
      );

      if (transfer.state === 'FAILED') {
        nonRetryable('Brokerage transfer failed', 'BUSINESS_REJECTION', {
          failureCode: transfer.failureCode,
        });
      }

      const depositKey = depositIdempotencyKey(ctx.idempotencyKey);
      let deposit: ProviderDeposit;
      try {
        deposit = await deps.brokerageClient.findDepositByIdempotencyKey(
          depositKey,
          ctx.correlationId,
        );
      } catch (error) {
        mapProviderError(error, 'confirmBrokerageTransfer.deposit');
      }
      if (deposit.providerDepositId !== ctx.providerDepositId) {
        nonRetryable('Provider deposit id mismatch', 'VALIDATION_FAILURE');
      }

      let depositMm = await deps.repos.moneyMovements.findByIdempotencyKey(
        ctx.tenantId,
        depositKey,
      );
      if (!depositMm) {
        nonRetryable('Deposit money movement not found', 'NOT_FOUND');
      }

      if (deposit.state !== 'SETTLED' && deposit.state !== 'FAILED') {
        retryable(`Deposit not settled yet (${deposit.state})`, 'DEPOSIT_PENDING');
      }

      depositMm = await applyMoneyMovementState(
        deps.repos.moneyMovements,
        ctx.tenantId,
        depositMm,
        mapProviderToMoneyMovementState(deposit.state),
        {
          providerTransactionId: deposit.providerDepositId,
          settledAt: deposit.settledAt ? new Date(deposit.settledAt) : null,
          failureCode: deposit.failureCode,
        },
      );

      const bd = await deps.repos.brokerageDeposits.findByMoneyMovementId(
        ctx.tenantId,
        depositMm.id,
      );
      if (bd && bd.state !== depositMm.state) {
        await deps.repos.brokerageDeposits.updateState(
          ctx.tenantId,
          bd.id,
          bd.version,
          depositMm.state,
          { settledAt: deposit.settledAt ? new Date(deposit.settledAt) : null },
        );
      }

      if (deposit.state === 'FAILED') {
        nonRetryable('Brokerage deposit failed', 'BUSINESS_REJECTION', {
          failureCode: deposit.failureCode,
        });
      }

      if (transferMm.createdAt) {
        csmMetrics.transferDurationMs.record(Date.now() - transferMm.createdAt.getTime(), {
          tenantId: ctx.tenantId,
        });
      }

      return { transferState: transfer.state, depositState: deposit.state };
    },
  };
}

export type TransferActivities = ReturnType<typeof createTransferActivities>;
