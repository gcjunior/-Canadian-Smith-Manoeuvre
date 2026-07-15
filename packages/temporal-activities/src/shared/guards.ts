import type { MoneyMovement, MoneyMovementState } from '@prisma/client';
import { ContractTransitionError } from '@csm/contracts';
import { isDomainError } from '@csm/domain';
import type { MoneyMovementRepository } from '@csm/database';

import { nonRetryable, retryable } from './errors.js';

export function mapDomainOrContractError(error: unknown): never {
  if (isDomainError(error)) {
    const nonRetryableCodes = new Set([
      'NOT_FOUND',
      'FORBIDDEN',
      'TENANT_SCOPE_VIOLATION',
      'VALIDATION_ERROR',
      'DUPLICATE_ENTITY',
      'UNSUPPORTED_ACCOUNT_CAPABILITY',
      'INVALID_PAYMENT_PERIOD',
      'INVALID_TIMEZONE',
      'INVALID_QUANTITY',
    ]);
    if (error.code === 'OPTIMISTIC_CONCURRENCY_CONFLICT') {
      retryable(error.message, error.code, error.details);
    }
    if (nonRetryableCodes.has(error.code)) {
      nonRetryable(
        error.message,
        error.code === 'VALIDATION_ERROR' ? 'VALIDATION_FAILURE' : error.code,
        error.details,
      );
    }
    retryable(error.message, error.code, error.details);
  }
  if (error instanceof ContractTransitionError) {
    nonRetryable(error.message, 'INVALID_STATUS_TRANSITION', {
      entity: error.entity,
      from: error.from,
      to: error.to,
    });
  }
  throw error;
}

export function mapProviderToMoneyMovementState(state: string): MoneyMovementState {
  switch (state) {
    case 'SETTLED':
      return 'SETTLED';
    case 'FAILED':
      return 'FAILED';
    case 'UNKNOWN':
      return 'UNKNOWN';
    case 'REVERSED':
      return 'REVERSED';
    case 'REQUESTED':
      return 'REQUESTED';
    default:
      return 'PENDING';
  }
}

/** Idempotent state apply — no-op when already at target. */
export async function applyMoneyMovementState(
  repo: MoneyMovementRepository,
  tenantId: string,
  movement: MoneyMovement,
  to: MoneyMovementState,
  patch?: {
    providerTransactionId?: string;
    settledAt?: Date | null;
    failureCode?: string | null;
  },
): Promise<MoneyMovement> {
  if (movement.state === to) {
    if (
      patch?.providerTransactionId !== undefined &&
      movement.providerTransactionId &&
      movement.providerTransactionId !== patch.providerTransactionId
    ) {
      nonRetryable('Provider transaction id mismatch on idempotent replay', 'DUPLICATE_CONFLICT');
    }
    return movement;
  }
  try {
    return await repo.updateState(
      tenantId,
      movement.id,
      movement.version,
      movement.state,
      to,
      patch,
    );
  } catch (error) {
    mapDomainOrContractError(error);
  }
}

export function requireCycleId(cycleId: string | undefined): string {
  if (!cycleId) {
    nonRetryable('cycleId required', 'VALIDATION_FAILURE');
  }
  return cycleId;
}
