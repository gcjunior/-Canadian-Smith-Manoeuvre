import { ApplicationFailure } from '@temporalio/common';

import type { HelocInterestActivities } from '../activity-types.js';

export type StubScenario = {
  /** Attempts until posted charge is found (0 = immediate). */
  chargeDelayPolls?: number;
  /** Attempts until ordinary debit is found (0 = immediate). */
  debitDelayPolls?: number;
  strategyState?: string;
  chargeAmountCents?: string;
  debitAmountCents?: string;
  chargeState?: string;
  debitState?: string;
  debitFailureCode?: string | null;
  confirmDebitThrows?: string;
  amountMismatch?: boolean;
  unexpectedSource?: boolean;
  failReconcile?: boolean;
  loadSnapshotForbidden?: boolean;
};

export function createStubActivities(scenario: StubScenario = {}): HelocInterestActivities & {
  calls: { name: string; args: unknown }[];
} {
  const calls: { name: string; args: unknown }[] = [];
  let chargePolls = 0;
  let debitPolls = 0;

  const chargeCents = scenario.chargeAmountCents ?? '50000';
  const debitCents = scenario.debitAmountCents ?? chargeCents;

  const track =
    <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      calls.push({ name, args: args[0] });
      return fn(...args);
    };

  const activities: HelocInterestActivities = {
    loadStrategySnapshot: track('loadStrategySnapshot', async () => {
      if (scenario.loadSnapshotForbidden) {
        throw ApplicationFailure.nonRetryable('Strategy must be ACTIVE', 'FORBIDDEN');
      }
      return {
        strategyId: 'strategy-1',
        tenantId: 'tenant-1',
        state: scenario.strategyState ?? 'ACTIVE',
        timezone: 'America/Toronto',
        helocAccountId: 'heloc-acct',
        bankAccountId: 'bank-acct',
        brokerageAccountId: 'brokerage-acct',
      };
    }),

    reserveInterestCycle: track('reserveInterestCycle', async (ctx) => ({
      cycleId: 'interest-cycle-1',
      state: 'AWAITING_CHARGE',
      interestPeriod: ctx.interestPeriod,
      created: true,
    })),

    transitionInterestCycleState: track('transitionInterestCycleState', async (ctx) => ({
      cycleId: ctx.cycleId ?? 'interest-cycle-1',
      state: ctx.toState,
    })),

    findPostedInterestCharge: track('findPostedInterestCharge', async (ctx) => {
      chargePolls += 1;
      const delay = scenario.chargeDelayPolls ?? 0;
      if (chargePolls <= delay) {
        throw ApplicationFailure.nonRetryable(
          'No posted HELOC interest charge for period',
          'NOT_FOUND',
        );
      }
      return {
        chargeId: 'charge-1',
        providerChargeId: 'pchg-1',
        amountCents: chargeCents,
        state: scenario.chargeState ?? 'POSTED',
        interestPeriod: ctx.interestPeriod ?? '2026-07',
      };
    }),

    findOrdinaryInterestDebit: track('findOrdinaryInterestDebit', async () => {
      debitPolls += 1;
      const delay = scenario.debitDelayPolls ?? 0;
      if (debitPolls <= delay) {
        throw ApplicationFailure.nonRetryable(
          'No ordinary interest debit for charge/period',
          'NOT_FOUND',
        );
      }
      return {
        debitId: 'debit-1',
        paymentId: 'pay-1',
        providerPaymentId: 'ppay-1',
        amountCents: debitCents,
        state: scenario.debitState ?? 'SETTLED',
        ordinaryAccountId: 'bank-acct',
        failureCode: scenario.debitFailureCode ?? null,
      };
    }),

    confirmInterestDebitSettlement: track('confirmInterestDebitSettlement', async () => {
      if (scenario.confirmDebitThrows) {
        throw ApplicationFailure.nonRetryable(
          scenario.confirmDebitThrows,
          scenario.confirmDebitThrows,
        );
      }
      if (scenario.debitState === 'FAILED' || scenario.debitFailureCode === 'INSUFFICIENT_FUNDS') {
        throw ApplicationFailure.nonRetryable('NSF', 'INSUFFICIENT_FUNDS');
      }
      if (scenario.debitState === 'REVERSED') {
        throw ApplicationFailure.nonRetryable('Reversed', 'DEBIT_REVERSED');
      }
      return { state: 'SETTLED' as const, settledAt: '2026-07-15T12:00:00.000Z' };
    }),

    validateInterestPaymentRules: track('validateInterestPaymentRules', async () => {
      if (scenario.amountMismatch) {
        throw ApplicationFailure.nonRetryable(
          'Interest charge and debit amounts differ',
          'INTEREST_AMOUNT_MISMATCH',
        );
      }
      if (scenario.unexpectedSource) {
        throw ApplicationFailure.nonRetryable(
          'Interest debit source must be BANK_OPERATING',
          'INTEREST_UNEXPECTED_SOURCE',
        );
      }
      if (chargeCents !== debitCents) {
        throw ApplicationFailure.nonRetryable(
          'Interest charge and debit amounts differ',
          'INTEREST_AMOUNT_MISMATCH',
        );
      }
      return { ok: true as const };
    }),

    reconcileInterestCycle: track('reconcileInterestCycle', async () => {
      if (scenario.failReconcile) {
        throw ApplicationFailure.nonRetryable('Mismatch', 'RECONCILIATION_FAILED');
      }
      return {
        reconciliationId: 'rec-interest-1',
        state: 'PASSED' as const,
        summary: 'ok',
      };
    }),

    appendLedgerEntries: track('appendLedgerEntries', async () => ({
      entryIds: ['le-1', 'le-2'],
      createdCount: 2,
      skippedCount: 0,
    })),

    completeInterestCycle: track('completeInterestCycle', async (ctx) => ({
      cycleId: ctx.cycleId ?? 'interest-cycle-1',
      state: 'COMPLETED' as const,
    })),

    failInterestCycle: track('failInterestCycle', async (ctx) => ({
      strategyId: ctx.strategyId,
      state: 'PAUSED' as const,
      exceptionId: 'ex-interest-1',
      cycleId: ctx.cycleId ?? 'interest-cycle-1',
    })),

    pauseStrategyWithException: track('pauseStrategyWithException', async (ctx) => ({
      strategyId: ctx.strategyId,
      state: 'PAUSED' as const,
      exceptionId: 'ex-1',
    })),

    createAuditPackageMetadata: track('createAuditPackageMetadata', async () => ({
      auditDocumentId: 'audit-1',
    })),

    recordOperation: track('recordOperation', async (ctx) => ({
      recorded: true as const,
      operationKey: ctx.operationKey,
      auditId: 'op-audit-1',
    })),
  };

  return Object.assign(activities, { calls });
}
