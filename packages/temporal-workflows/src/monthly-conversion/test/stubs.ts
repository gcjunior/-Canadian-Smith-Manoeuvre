import { ApplicationFailure } from '@temporalio/common';

import type { MonthlyConversionActivities } from '../activity-types.js';

export type StubScenario = {
  /** Attempts until mortgage is found (0 = immediate). */
  mortgageDelayPolls?: number;
  /** Attempts until HELOC newlyAvailable >= principal. */
  helocCreditDelayPolls?: number;
  principalRepaidCents?: string;
  /** Newly available credit reported during HELOC wait polling. */
  helocWaitCreditCents?: string;
  /** Existing unused HELOC credit (does not unlock a new conversion by itself). */
  existingAvailableCreditCents?: string;
  /** Newly available credit returned from calculateNewlyAvailableCredit. */
  newlyAvailableCreditCents?: string;
  /** When set, overrides calculateNewlyAvailableCredit.drawAmountCents. */
  drawAmountCents?: string;
  userMonthlyCapCents?: string;
  strategyState?: string;
  reversePayment?: boolean;
  rejectOrder?: boolean;
  rejectDraw?: boolean;
  rejectTransfer?: boolean;
  reverseTransfer?: boolean;
  reverseDeposit?: boolean;
  accountRestricted?: boolean;
  symbolPolicyChanged?: boolean;
  partialFill?: boolean;
  failReconcile?: boolean;
  drawConfirmTimeout?: boolean;
  transferConfirmTimeout?: boolean;
  orderConfirmTimeout?: boolean;
  ambiguousDraw?: boolean;
  ambiguousTransfer?: boolean;
  ambiguousOrder?: boolean;
  onDrawConfirmEntered?: () => void;
  /** Gate release for confirmHelocDraw (pause-after-draw tests). */
  holdAfterDrawConfirm?: { released: () => boolean };
};

export function createStubActivities(scenario: StubScenario = {}): MonthlyConversionActivities & {
  calls: { name: string; args: unknown }[];
} {
  const calls: { name: string; args: unknown }[] = [];
  let mortgagePolls = 0;
  let helocPolls = 0;
  let drawAmbiguousThrown = false;
  let transferAmbiguousThrown = false;
  let orderAmbiguousThrown = false;

  const principal = scenario.principalRepaidCents ?? '100000';
  const waitCredit =
    scenario.helocWaitCreditCents ?? scenario.newlyAvailableCreditCents ?? principal;
  const newly = scenario.newlyAvailableCreditCents ?? principal;
  const userCap = scenario.userMonthlyCapCents ?? '500000';
  const draw =
    scenario.drawAmountCents ??
    [BigInt(principal), BigInt(newly), BigInt(userCap), 500_000n]
      .reduce((a, b) => (a < b ? a : b))
      .toString();

  const track =
    <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      calls.push({ name, args: args[0] });
      return fn(...args);
    };

  const activities: MonthlyConversionActivities = {
    loadStrategySnapshot: track('loadStrategySnapshot', async () => ({
      strategyId: 'strategy-1',
      tenantId: 'tenant-1',
      state: scenario.strategyState ?? 'ACTIVE',
      timezone: 'America/Toronto',
      userMonthlyCapCents: userCap,
      symbol: 'VCN.TO',
      mortgageAccountId: 'mortgage-acct',
      helocAccountId: 'heloc-acct',
      bankAccountId: 'bank-acct',
      brokerageAccountId: 'brokerage-acct',
      allowFractionalShares: true,
    })),

    reserveMonthlyCycle: track('reserveMonthlyCycle', async (ctx) => ({
      cycleId: 'cycle-1',
      state: 'WAITING_FOR_MORTGAGE',
      paymentPeriod: ctx.paymentPeriod,
      created: true,
    })),

    transitionCycleState: track('transitionCycleState', async (ctx) => ({
      cycleId: ctx.cycleId ?? 'cycle-1',
      state: ctx.toState,
    })),

    findSettledMortgagePayment: track('findSettledMortgagePayment', async (ctx) => {
      mortgagePolls += 1;
      const delay = scenario.mortgageDelayPolls ?? 0;
      if (mortgagePolls <= delay) {
        throw ApplicationFailure.nonRetryable(
          'No SETTLED mortgage payment for period',
          'NOT_FOUND',
        );
      }
      return {
        mortgagePaymentId: 'mp-1',
        providerPaymentId: 'ppay-1',
        principalAmountCents: principal,
        interestAmountCents: '140000',
        totalAmountCents: String(BigInt(principal) + 140_000n),
        paymentPeriod: ctx.paymentPeriod ?? '2026-07',
        state: 'SETTLED',
      };
    }),

    identifyPrincipalRepaid: track('identifyPrincipalRepaid', async () => ({
      principalRepaidCents: principal,
    })),

    verifyPaymentNotReversed: track('verifyPaymentNotReversed', async () => {
      if (scenario.reversePayment) {
        throw ApplicationFailure.nonRetryable('Payment reversed', 'PAYMENT_REVERSED');
      }
      return { ok: true as const, state: 'SETTLED' };
    }),

    getHelocAvailability: track('getHelocAvailability', async () => {
      helocPolls += 1;
      const delay = scenario.helocCreditDelayPolls ?? 0;
      const credit = helocPolls <= delay ? String(BigInt(principal) / 2n) : waitCredit;
      return {
        availableCreditCents: String(
          BigInt(credit) + BigInt(scenario.existingAvailableCreditCents ?? '0'),
        ),
        existingAvailableCreditCents: scenario.existingAvailableCreditCents ?? '0',
        newlyAvailableCreditCents: credit,
        stale: false,
        observedAt: '2026-07-01T12:00:00.000Z',
      };
    }),

    calculateNewlyAvailableCredit: track('calculateNewlyAvailableCredit', async () => ({
      newlyAvailableCreditCents: newly,
      drawAmountCents: draw,
    })),

    initiateHelocDraw: track('initiateHelocDraw', async (ctx) => {
      if (scenario.rejectDraw) {
        throw ApplicationFailure.nonRetryable('Draw rejected', 'BUSINESS_REJECTION');
      }
      if (scenario.ambiguousDraw && !drawAmbiguousThrown) {
        drawAmbiguousThrown = true;
        throw ApplicationFailure.nonRetryable('Ambiguous draw', 'AMBIGUOUS_RESULT');
      }
      return {
        moneyMovementId: 'mm-draw-1',
        providerDrawId: 'draw-1',
        state: 'PENDING',
        amountCents: ctx.amountCents,
      };
    }),

    resolveAmbiguousHelocDraw: track('resolveAmbiguousHelocDraw', async () => ({
      moneyMovementId: 'mm-draw-1',
      providerDrawId: 'draw-1',
      state: 'PENDING',
    })),

    confirmHelocDraw: track('confirmHelocDraw', async () => {
      if (scenario.drawConfirmTimeout) {
        throw ApplicationFailure.nonRetryable('Draw settlement timeout', 'DRAW_PENDING');
      }
      scenario.onDrawConfirmEntered?.();
      if (scenario.holdAfterDrawConfirm) {
        while (!scenario.holdAfterDrawConfirm.released()) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      return { state: 'SETTLED', settledAt: '2026-07-01T13:00:00.000Z' };
    }),

    initiateBrokerageTransfer: track('initiateBrokerageTransfer', async (ctx) => {
      if (scenario.rejectTransfer) {
        throw ApplicationFailure.nonRetryable('Transfer rejected', 'BUSINESS_REJECTION');
      }
      if (scenario.ambiguousTransfer && !transferAmbiguousThrown) {
        transferAmbiguousThrown = true;
        throw ApplicationFailure.nonRetryable('Ambiguous transfer', 'AMBIGUOUS_RESULT');
      }
      return {
        moneyMovementId: 'mm-xfer-1',
        providerTransferId: 'xfer-1',
        depositMoneyMovementId: 'mm-dep-1',
        providerDepositId: 'dep-1',
        state: 'PENDING',
        amountCents: ctx.amountCents,
      };
    }),

    resolveAmbiguousBrokerageTransfer: track('resolveAmbiguousBrokerageTransfer', async () => ({
      moneyMovementId: 'mm-xfer-1',
      providerTransferId: 'xfer-1',
      depositMoneyMovementId: 'mm-dep-1',
      providerDepositId: 'dep-1',
      transferState: 'PENDING',
      depositState: 'PENDING',
    })),

    confirmBrokerageTransfer: track('confirmBrokerageTransfer', async () => {
      if (scenario.transferConfirmTimeout) {
        throw ApplicationFailure.nonRetryable('Transfer settlement timeout', 'TRANSFER_PENDING');
      }
      if (scenario.reverseTransfer) {
        throw ApplicationFailure.nonRetryable('Transfer reversed', 'TRANSFER_REVERSED');
      }
      if (scenario.reverseDeposit) {
        throw ApplicationFailure.nonRetryable('Deposit reversed', 'DEPOSIT_REVERSED');
      }
      return { transferState: 'SETTLED', depositState: 'SETTLED' };
    }),

    submitInvestmentOrder: track('submitInvestmentOrder', async (ctx) => {
      if (scenario.accountRestricted) {
        throw ApplicationFailure.nonRetryable('Account restricted', 'BUSINESS_REJECTION');
      }
      if (scenario.ambiguousOrder && !orderAmbiguousThrown) {
        orderAmbiguousThrown = true;
        throw ApplicationFailure.nonRetryable('Ambiguous order', 'AMBIGUOUS_RESULT');
      }
      if (scenario.rejectOrder) {
        throw ApplicationFailure.nonRetryable('Rejected', 'BUSINESS_REJECTION');
      }
      return {
        investmentOrderId: 'io-1',
        providerOrderId: 'ord-1',
        state: 'SUBMITTED',
        symbol: scenario.symbolPolicyChanged ? 'VFV.TO' : 'VCN.TO',
        notionalCents: ctx.notionalCents,
      };
    }),

    resolveAmbiguousInvestmentOrder: track('resolveAmbiguousInvestmentOrder', async () => ({
      investmentOrderId: 'io-1',
      providerOrderId: 'ord-1',
      state: 'SUBMITTED',
    })),

    confirmInvestmentOrder: track('confirmInvestmentOrder', async () => {
      if (scenario.orderConfirmTimeout) {
        throw ApplicationFailure.nonRetryable('Order fill timeout', 'ORDER_PENDING');
      }
      if (scenario.partialFill) {
        throw ApplicationFailure.nonRetryable('Partial fill', 'PARTIAL_FILL');
      }
      return {
        state: 'FILLED',
        filledQuantity: '10',
        filledAt: '2026-07-01T14:00:00.000Z',
      };
    }),

    confirmInvestmentSettlement: track('confirmInvestmentSettlement', async () => ({
      settled: true as const,
      settledCashCents: '0',
      symbol: 'VCN.TO',
    })),

    reconcileCycle: track('reconcileCycle', async () => {
      if (scenario.failReconcile || scenario.symbolPolicyChanged) {
        throw ApplicationFailure.nonRetryable('Mismatch', 'RECONCILIATION_FAILED');
      }
      return {
        reconciliationId: 'rec-1',
        state: 'PASSED' as const,
        summary: 'ok',
      };
    }),

    appendLedgerEntries: track('appendLedgerEntries', async () => ({
      entryIds: ['le-1', 'le-2'],
      createdCount: 4,
      skippedCount: 0,
    })),

    completeCycle: track('completeCycle', async (ctx) => ({
      cycleId: ctx.cycleId ?? 'cycle-1',
      state: 'COMPLETED' as const,
    })),

    skipCycle: track('skipCycle', async (ctx) => ({
      cycleId: ctx.cycleId ?? 'cycle-1',
      state: 'SKIPPED' as const,
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
