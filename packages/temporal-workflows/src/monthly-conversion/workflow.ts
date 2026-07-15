import {
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  uuid4,
  workflowInfo,
} from '@temporalio/workflow';

import { resolveWorkflowCorrelationId } from '../shared/correlation.js';
import type { MonthlyConversionActivities } from './activity-types.js';
import {
  HELOC_CREDIT_DEADLINE,
  MIN_INVESTMENT_CENTS,
  MORTGAGE_DEADLINE,
  WORKFLOW_ACTIVITY_OPTIONS,
} from './constants.js';
import { MONTHLY_CONVERSION_FAILURE_CODES as Codes } from './failure-codes.js';
import {
  activityFailureType,
  durationToMs,
  idempotencyKey,
  isAmbiguous,
  isNotFound,
  isPaymentReversed,
  isReconciliationFailed,
  waitForSignalOrPollInterval,
  zeroDrawReasonCode,
} from './helpers.js';
import type {
  MonthlyConversionProgress,
  MonthlyConversionProviderRefs,
  MonthlyConversionStatus,
  MonthlyConversionWorkflowInput,
  MonthlyConversionWorkflowResult,
  NormalizedProviderEventRef,
  StrategyLifecycleSignal,
  WaitReason,
  WorkflowOutcome,
  WorkflowPhase,
} from './types.js';

export const bankEventReceived = defineSignal<[NormalizedProviderEventRef]>('bankEventReceived');
export const brokerageEventReceived =
  defineSignal<[NormalizedProviderEventRef]>('brokerageEventReceived');
export const strategyPaused = defineSignal<[StrategyLifecycleSignal]>('strategyPaused');
export const strategyClosed = defineSignal<[StrategyLifecycleSignal]>('strategyClosed');

export const getStatus = defineQuery<MonthlyConversionStatus>('getStatus');
export const getProgress = defineQuery<MonthlyConversionProgress>('getProgress');
export const getCurrentWaitReason = defineQuery<WaitReason>('getCurrentWaitReason');

const read = proxyActivities<MonthlyConversionActivities>(WORKFLOW_ACTIVITY_OPTIONS.read);
const db = proxyActivities<MonthlyConversionActivities>(WORKFLOW_ACTIVITY_OPTIONS.database);
const mutate = proxyActivities<MonthlyConversionActivities>(
  WORKFLOW_ACTIVITY_OPTIONS.financialMutation,
);
const poll = proxyActivities<MonthlyConversionActivities>(WORKFLOW_ACTIVITY_OPTIONS.polling);

export async function monthlyConversionWorkflow(
  input: MonthlyConversionWorkflowInput,
): Promise<MonthlyConversionWorkflowResult> {
  const correlationId = resolveWorkflowCorrelationId({
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    memo: workflowInfo().memo,
    fallback: uuid4(),
  });
  const seenBankEvents = new Set<string>();
  const seenBrokerageEvents = new Set<string>();

  let bankWake = false;
  let _brokerageWake = false;
  let pausedSignal: StrategyLifecycleSignal | null = null;
  let closedSignal: StrategyLifecycleSignal | null = null;

  let phase: WorkflowPhase = 'STARTED';
  let waitReason: WaitReason = null;
  let outcome: WorkflowOutcome | null = null;
  let failureCode: string | null = null;
  let cycleId: string | null = null;
  let strategyState: string | null = null;
  let pollsCompleted = 0;
  let principalRepaidCents: string | null = null;
  let newlyAvailableCreditCents: string | null = null;
  let drawAmountCents: string | null = null;
  const providerRefs: MonthlyConversionProviderRefs = {};

  const nowMs = () => Date.now();

  setHandler(bankEventReceived, (event) => {
    if (!event?.providerEventId || seenBankEvents.has(event.providerEventId)) {
      return;
    }
    if (event.providerType !== 'BANK') {
      return;
    }
    seenBankEvents.add(event.providerEventId);
    bankWake = true;
  });

  setHandler(brokerageEventReceived, (event) => {
    if (!event?.providerEventId || seenBrokerageEvents.has(event.providerEventId)) {
      return;
    }
    if (event.providerType !== 'BROKERAGE') {
      return;
    }
    seenBrokerageEvents.add(event.providerEventId);
    _brokerageWake = true;
  });

  setHandler(strategyPaused, (signal) => {
    pausedSignal = signal;
  });

  setHandler(strategyClosed, (signal) => {
    closedSignal = signal;
  });

  setHandler(getStatus, () => ({
    phase,
    outcome,
    cycleId,
    failureCode,
    strategyState,
  }));

  setHandler(getProgress, () => ({
    phase,
    cycleId,
    paymentPeriod: input.paymentPeriod,
    principalRepaidCents,
    newlyAvailableCreditCents,
    drawAmountCents,
    providerRefs: { ...providerRefs },
    pollsCompleted,
  }));

  setHandler(getCurrentWaitReason, () => waitReason);

  const baseCtx = () => ({
    tenantId: input.tenantId,
    strategyId: input.strategyId,
    correlationId,
    paymentPeriod: input.paymentPeriod,
    ...(cycleId ? { cycleId } : {}),
  });

  const finish = (
    result: Omit<MonthlyConversionWorkflowResult, 'paymentPeriod' | 'providerRefs'> & {
      providerRefs?: MonthlyConversionProviderRefs;
    },
  ): MonthlyConversionWorkflowResult => {
    outcome = result.outcome;
    failureCode = result.failureCode ?? null;
    phase = 'DONE';
    waitReason = null;
    return {
      ...result,
      paymentPeriod: input.paymentPeriod,
      providerRefs: { ...providerRefs, ...result.providerRefs },
    };
  };

  const pause = async (
    code: string,
    message: string,
    cycleTerminalState: 'PAUSED' | 'FAILED' = 'PAUSED',
  ): Promise<MonthlyConversionWorkflowResult> => {
    phase = 'PAUSING';
    await db.pauseStrategyWithException({
      ...baseCtx(),
      code,
      message,
      cycleTerminalState,
      details: {
        providerRefs,
        drawAmountCents,
        principalRepaidCents,
        simulatorScenarioId: input.simulatorScenarioId,
      },
    });
    await db.createAuditPackageMetadata({
      ...baseCtx(),
      packageType: 'SAFETY_PAUSE',
      metadata: {
        code,
        message,
        providerRefs,
      },
    });
    return finish({
      outcome: 'PAUSED',
      cycleId: cycleId!,
      failureCode: code,
      reason: message,
      ...(drawAmountCents ? { drawAmountCents } : {}),
      ...(principalRepaidCents ? { principalRepaidCents } : {}),
    });
  };

  const checkLifecycle = async (): Promise<MonthlyConversionWorkflowResult | null> => {
    if (closedSignal) {
      return pause(
        Codes.STRATEGY_CLOSED,
        closedSignal.message ?? 'Strategy closed during conversion',
        'FAILED',
      );
    }
    if (pausedSignal) {
      return pause(Codes.STRATEGY_PAUSED, pausedSignal.message ?? pausedSignal.reasonCode);
    }
    return null;
  };

  // --- 1–3: snapshot, ACTIVE check, reserve cycle (also moves to WAITING_FOR_MORTGAGE)
  phase = 'LOADING_SNAPSHOT';
  let snapshot;
  try {
    snapshot = await read.loadStrategySnapshot(baseCtx());
  } catch (err) {
    if (activityFailureType(err) === 'FORBIDDEN') {
      return finish({
        outcome: 'FAILED',
        cycleId: '',
        failureCode: Codes.STRATEGY_NOT_ACTIVE,
        reason: 'Strategy is not ACTIVE',
      });
    }
    throw err;
  }
  strategyState = snapshot.state;
  if (snapshot.state !== 'ACTIVE') {
    return finish({
      outcome: 'FAILED',
      cycleId: '',
      failureCode: Codes.STRATEGY_NOT_ACTIVE,
      reason: `Strategy state is ${snapshot.state}`,
    });
  }

  phase = 'RESERVING_CYCLE';
  const reserved = await db.reserveMonthlyCycle({
    ...baseCtx(),
    paymentPeriod: input.paymentPeriod,
  });
  cycleId = reserved.cycleId;

  if (input.simulatorScenarioId) {
    await db.recordOperation({
      ...baseCtx(),
      operationKey: idempotencyKey(
        input.tenantId,
        input.strategyId,
        input.paymentPeriod,
        'scenario',
      ),
      operationType: 'SIMULATOR_SCENARIO',
      payload: { simulatorScenarioId: input.simulatorScenarioId },
    });
  }

  // --- 5–7: mortgage poll (signal or 6h) until settled or 14-day deadline
  phase = 'WAITING_FOR_MORTGAGE';
  const mortgageDeadline = nowMs() + durationToMs(MORTGAGE_DEADLINE);
  let mortgagePayment: Awaited<ReturnType<typeof read.findSettledMortgagePayment>> | null = null;

  while (!mortgagePayment) {
    const life = await checkLifecycle();
    if (life) {
      return life;
    }

    try {
      mortgagePayment = await read.findSettledMortgagePayment(baseCtx());
      providerRefs.mortgagePaymentId = mortgagePayment.mortgagePaymentId;
      providerRefs.providerPaymentId = mortgagePayment.providerPaymentId;
      break;
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
    }

    pollsCompleted += 1;
    const wait = await waitForSignalOrPollInterval({
      shouldWake: () => bankWake || Boolean(pausedSignal) || Boolean(closedSignal),
      clearConsumedSignals: () => {
        bankWake = false;
      },
      setWaitReason: (r) => {
        waitReason = r;
      },
      waitReason: 'MORTGAGE_PAYMENT',
      deadlineMs: mortgageDeadline,
      nowMs,
    });
    if (wait === 'deadline') {
      return pause(
        Codes.MORTGAGE_PAYMENT_TIMEOUT,
        'Mortgage payment not settled within 14-day deadline',
      );
    }
  }

  // --- 8–9: verify not reversed, record principal
  phase = 'VERIFYING_MORTGAGE';
  try {
    await read.verifyPaymentNotReversed({
      ...baseCtx(),
      providerPaymentId: mortgagePayment!.providerPaymentId,
    });
  } catch (err) {
    if (isPaymentReversed(err)) {
      return pause(Codes.PAYMENT_REVERSED, 'Mortgage payment was reversed');
    }
    throw err;
  }

  const principal = await read.identifyPrincipalRepaid({
    ...baseCtx(),
    mortgagePaymentId: mortgagePayment!.mortgagePaymentId,
  });
  principalRepaidCents = principal.principalRepaidCents;

  await db.transitionCycleState({
    ...baseCtx(),
    fromState: 'WAITING_FOR_MORTGAGE',
    toState: 'WAITING_FOR_HELOC',
  });

  // --- 11–12: HELOC credit wait (signal or 6h) until enough new credit or 7-day deadline
  phase = 'WAITING_FOR_HELOC';
  const helocDeadline = nowMs() + durationToMs(HELOC_CREDIT_DEADLINE);
  let creditReady = false;

  while (!creditReady) {
    const life = await checkLifecycle();
    if (life) {
      return life;
    }

    const avail = await read.getHelocAvailability(baseCtx());
    newlyAvailableCreditCents = avail.newlyAvailableCreditCents;
    pollsCompleted += 1;

    if (BigInt(avail.newlyAvailableCreditCents) >= BigInt(principalRepaidCents!)) {
      creditReady = true;
      break;
    }

    const wait = await waitForSignalOrPollInterval({
      shouldWake: () => bankWake || Boolean(pausedSignal) || Boolean(closedSignal),
      clearConsumedSignals: () => {
        bankWake = false;
      },
      setWaitReason: (r) => {
        waitReason = r;
      },
      waitReason: 'HELOC_CREDIT',
      deadlineMs: helocDeadline,
      nowMs,
    });
    if (wait === 'deadline') {
      return pause(
        Codes.HELOC_CREDIT_LAG_TIMEOUT,
        'HELOC newly available credit did not reflect principal within 7 days',
      );
    }
  }

  // --- 13–14: calculate amount; skip if below minimum / zero
  phase = 'CALCULATING_AMOUNT';
  const calc = await read.calculateNewlyAvailableCredit({
    ...baseCtx(),
    principalRepaidCents: principalRepaidCents!,
  });
  newlyAvailableCreditCents = calc.newlyAvailableCreditCents;
  drawAmountCents = calc.drawAmountCents;

  if (BigInt(drawAmountCents) <= 0n) {
    phase = 'SKIPPING';
    const reasonCode = zeroDrawReasonCode({
      principalRepaidCents: principalRepaidCents!,
      newlyAvailableCreditCents: newlyAvailableCreditCents!,
      userMonthlyCapCents: snapshot.userMonthlyCapCents,
      drawAmountCents,
    });
    await db.skipCycle({
      ...baseCtx(),
      reasonCode,
      reason: `Draw amount is zero (${reasonCode})`,
    });
    await db.createAuditPackageMetadata({
      ...baseCtx(),
      packageType: 'CYCLE_SKIPPED',
      metadata: { reasonCode, drawAmountCents, principalRepaidCents, newlyAvailableCreditCents },
    });
    return finish({
      outcome: 'SKIPPED',
      cycleId: cycleId!,
      failureCode: reasonCode,
      reason: `Draw amount is zero (${reasonCode})`,
      drawAmountCents,
      principalRepaidCents: principalRepaidCents!,
    });
  }

  if (BigInt(drawAmountCents) < BigInt(MIN_INVESTMENT_CENTS)) {
    phase = 'SKIPPING';
    await db.skipCycle({
      ...baseCtx(),
      reasonCode: Codes.AMOUNT_BELOW_MINIMUM,
      reason: `Draw ${drawAmountCents} below minimum ${MIN_INVESTMENT_CENTS}`,
    });
    await db.createAuditPackageMetadata({
      ...baseCtx(),
      packageType: 'CYCLE_SKIPPED',
      metadata: {
        reasonCode: Codes.AMOUNT_BELOW_MINIMUM,
        drawAmountCents,
        minInvestmentCents: MIN_INVESTMENT_CENTS,
      },
    });
    return finish({
      outcome: 'SKIPPED',
      cycleId: cycleId!,
      failureCode: Codes.AMOUNT_BELOW_MINIMUM,
      reason: `Draw ${drawAmountCents} below minimum ${MIN_INVESTMENT_CENTS}`,
      drawAmountCents,
      principalRepaidCents: principalRepaidCents!,
    });
  }

  // --- 15–17: HELOC draw + resolve ambiguous + confirm
  phase = 'HELOC_DRAW';
  const drawKey = idempotencyKey(
    input.tenantId,
    input.strategyId,
    input.paymentPeriod,
    'heloc-draw',
  );

  await db.transitionCycleState({
    ...baseCtx(),
    fromState: 'WAITING_FOR_HELOC',
    toState: 'HELOC_DRAW_PENDING',
  });

  let draw;
  try {
    draw = await mutate.initiateHelocDraw({
      ...baseCtx(),
      amountCents: drawAmountCents,
      idempotencyKey: drawKey,
    });
  } catch (err) {
    if (isAmbiguous(err)) {
      try {
        draw = await poll.resolveAmbiguousHelocDraw({
          ...baseCtx(),
          idempotencyKey: drawKey,
        });
      } catch {
        return pause(
          Codes.AMBIGUOUS_UNRESOLVED,
          'HELOC draw result remains ambiguous after provider lookup',
        );
      }
    } else {
      return pause(
        Codes.HELOC_DRAW_FAILED,
        `HELOC draw initiation failed: ${activityFailureType(err) ?? 'unknown'}`,
      );
    }
  }

  providerRefs.helocDrawId = draw.providerDrawId;
  providerRefs.moneyMovementDrawId = draw.moneyMovementId;

  try {
    waitReason = 'HELOC_DRAW_SETTLEMENT';
    await poll.confirmHelocDraw({
      ...baseCtx(),
      providerDrawId: draw.providerDrawId,
      idempotencyKey: drawKey,
    });
    waitReason = null;
  } catch (err) {
    waitReason = null;
    return pause(
      Codes.HELOC_DRAW_TIMEOUT,
      `HELOC draw settlement not confirmed: ${activityFailureType(err) ?? 'timeout'}`,
    );
  }

  const lifeAfterDrawConfirm = await checkLifecycle();
  if (lifeAfterDrawConfirm) {
    return lifeAfterDrawConfirm;
  }

  await db.transitionCycleState({
    ...baseCtx(),
    fromState: 'HELOC_DRAW_PENDING',
    toState: 'HELOC_DRAW_CONFIRMED',
  });

  // --- 18–20: transfer + resolve + confirm
  phase = 'BROKERAGE_TRANSFER';
  const transferKey = idempotencyKey(
    input.tenantId,
    input.strategyId,
    input.paymentPeriod,
    'brokerage-transfer',
  );

  await db.transitionCycleState({
    ...baseCtx(),
    fromState: 'HELOC_DRAW_CONFIRMED',
    toState: 'BROKERAGE_TRANSFER_PENDING',
  });

  let transfer;
  try {
    transfer = await mutate.initiateBrokerageTransfer({
      ...baseCtx(),
      amountCents: drawAmountCents,
      idempotencyKey: transferKey,
    });
  } catch (err) {
    if (isAmbiguous(err)) {
      try {
        const resolved = await poll.resolveAmbiguousBrokerageTransfer({
          ...baseCtx(),
          idempotencyKey: transferKey,
        });
        transfer = {
          moneyMovementId: resolved.moneyMovementId,
          providerTransferId: resolved.providerTransferId,
          depositMoneyMovementId: resolved.depositMoneyMovementId ?? '',
          providerDepositId: resolved.providerDepositId ?? '',
          state: resolved.transferState,
          amountCents: drawAmountCents,
        };
        if (!resolved.providerDepositId) {
          return pause(
            Codes.AMBIGUOUS_UNRESOLVED,
            'Brokerage transfer resolved without deposit reference',
          );
        }
      } catch {
        return pause(
          Codes.AMBIGUOUS_UNRESOLVED,
          'Brokerage transfer remains ambiguous after provider lookup',
        );
      }
    } else {
      return pause(
        Codes.TRANSFER_FAILED,
        `Brokerage transfer initiation failed: ${activityFailureType(err) ?? 'unknown'}`,
      );
    }
  }

  providerRefs.providerTransferId = transfer.providerTransferId;
  providerRefs.providerDepositId = transfer.providerDepositId;
  providerRefs.moneyMovementTransferId = transfer.moneyMovementId;

  try {
    waitReason = 'BROKERAGE_TRANSFER_SETTLEMENT';
    // Wake on brokerage signals during retries via concurrent signal flags — confirm Activity
    // holds Temporal retries; signal remains optimization for outer waits only.
    await poll.confirmBrokerageTransfer({
      ...baseCtx(),
      idempotencyKey: transferKey,
      providerTransferId: transfer.providerTransferId,
      providerDepositId: transfer.providerDepositId,
    });
    waitReason = null;
    _brokerageWake = false;
  } catch (err) {
    waitReason = null;
    return pause(
      Codes.TRANSFER_TIMEOUT,
      `Brokerage transfer/deposit not confirmed: ${activityFailureType(err) ?? 'timeout'}`,
    );
  }

  await db.transitionCycleState({
    ...baseCtx(),
    fromState: 'BROKERAGE_TRANSFER_PENDING',
    toState: 'BROKERAGE_FUNDED',
  });

  // --- 21–24: order + resolve + fill + settlement
  phase = 'INVESTMENT_ORDER';
  const orderKey = idempotencyKey(
    input.tenantId,
    input.strategyId,
    input.paymentPeriod,
    'investment-order',
  );

  await db.transitionCycleState({
    ...baseCtx(),
    fromState: 'BROKERAGE_FUNDED',
    toState: 'ORDER_PENDING',
  });

  let order;
  try {
    order = await mutate.submitInvestmentOrder({
      ...baseCtx(),
      notionalCents: drawAmountCents,
      idempotencyKey: orderKey,
    });
  } catch (err) {
    if (isAmbiguous(err)) {
      try {
        order = await poll.resolveAmbiguousInvestmentOrder({
          ...baseCtx(),
          idempotencyKey: orderKey,
        });
      } catch {
        return pause(
          Codes.AMBIGUOUS_UNRESOLVED,
          'Investment order remains ambiguous after provider lookup',
        );
      }
    } else if (activityFailureType(err) === 'BUSINESS_REJECTION') {
      return pause(Codes.ORDER_REJECTED, 'Investment order rejected by provider');
    } else {
      return pause(
        Codes.UNSAFE_OUTCOME,
        `Investment order submission failed: ${activityFailureType(err) ?? 'unknown'}`,
      );
    }
  }

  providerRefs.providerOrderId = order.providerOrderId;
  providerRefs.investmentOrderId = order.investmentOrderId;

  try {
    waitReason = 'INVESTMENT_FILL';
    const filled = await poll.confirmInvestmentOrder({
      ...baseCtx(),
      idempotencyKey: orderKey,
      providerOrderId: order.providerOrderId,
    });
    waitReason = null;
    if (filled.state === 'PARTIALLY_FILLED') {
      return pause(Codes.PARTIAL_FILL, 'Investment order only partially filled', 'PAUSED');
    }
    if (filled.state === 'REJECTED' || filled.state === 'CANCELLED') {
      return pause(Codes.ORDER_REJECTED, `Investment order ${filled.state}`);
    }
  } catch (err) {
    waitReason = null;
    if (activityFailureType(err) === 'BUSINESS_REJECTION') {
      return pause(Codes.ORDER_REJECTED, 'Investment order rejected');
    }
    if (activityFailureType(err) === 'PARTIAL_FILL') {
      return pause(Codes.PARTIAL_FILL, 'Investment order only partially filled');
    }
    return pause(
      Codes.ORDER_TIMEOUT,
      `Investment fill not confirmed: ${activityFailureType(err) ?? 'timeout'}`,
    );
  }

  try {
    waitReason = 'INVESTMENT_SETTLEMENT';
    await poll.confirmInvestmentSettlement({
      ...baseCtx(),
      idempotencyKey: orderKey,
      expectedNotionalCents: drawAmountCents,
    });
    waitReason = null;
  } catch (err) {
    waitReason = null;
    return pause(
      Codes.ORDER_TIMEOUT,
      `Investment settlement not confirmed: ${activityFailureType(err) ?? 'timeout'}`,
    );
  }

  await db.transitionCycleState({
    ...baseCtx(),
    fromState: 'ORDER_PENDING',
    toState: 'ORDER_FILLED',
  });

  // --- 25–27: ledger, reconcile, complete
  phase = 'RECONCILING';
  await db.transitionCycleState({
    ...baseCtx(),
    fromState: 'ORDER_FILLED',
    toState: 'RECONCILING',
  });

  // Full conversion package (MVP: remainingCash=0, position legs use brokerage cash account id).
  // Mirrors @csm/domain buildConversionLedgerPackage without importing domain into the workflow sandbox.
  await db.appendLedgerEntries({
    ...baseCtx(),
    entries: [
      {
        accountId: snapshot.helocAccountId,
        businessEventId: `conversion:${cycleId}:heloc-draw:debit`,
        direction: 'DEBIT',
        amountCents: drawAmountCents,
        narrative: 'Increase HELOC liability (draw for investment)',
        cycleId: cycleId!,
        ...(providerRefs.helocDrawId
          ? { providerRefType: 'HELOC_DRAW', providerRefId: providerRefs.helocDrawId }
          : {}),
      },
      {
        accountId: snapshot.bankAccountId,
        businessEventId: `conversion:${cycleId}:heloc-draw:credit`,
        direction: 'CREDIT',
        amountCents: drawAmountCents,
        narrative: 'HELOC draw proceeds in ordinary bank (CLEARING path)',
        cycleId: cycleId!,
        ...(providerRefs.helocDrawId
          ? { providerRefType: 'HELOC_DRAW', providerRefId: providerRefs.helocDrawId }
          : {}),
      },
      {
        accountId: snapshot.bankAccountId,
        businessEventId: `conversion:${cycleId}:brokerage-transfer:debit`,
        direction: 'DEBIT',
        amountCents: drawAmountCents,
        narrative: 'Transfer out of ordinary bank to brokerage',
        cycleId: cycleId!,
        ...(providerRefs.providerTransferId
          ? {
              providerRefType: 'HELOC_TO_BROKERAGE_TRANSFER',
              providerRefId: providerRefs.providerTransferId,
            }
          : {}),
      },
      {
        accountId: snapshot.brokerageAccountId,
        businessEventId: `conversion:${cycleId}:brokerage-transfer:credit`,
        direction: 'CREDIT',
        amountCents: drawAmountCents,
        narrative: 'Brokerage cash deposit (non-registered)',
        cycleId: cycleId!,
        ...(providerRefs.providerDepositId
          ? {
              providerRefType: 'BROKERAGE_DEPOSIT',
              providerRefId: providerRefs.providerDepositId,
            }
          : {}),
      },
      {
        accountId: snapshot.brokerageAccountId,
        businessEventId: `conversion:${cycleId}:investment:debit`,
        direction: 'DEBIT',
        amountCents: drawAmountCents,
        narrative: 'Spend brokerage cash on ETF purchase',
        cycleId: cycleId!,
        ...(providerRefs.providerOrderId
          ? {
              providerRefType: 'INVESTMENT_ORDER',
              providerRefId: providerRefs.providerOrderId,
            }
          : {}),
      },
      {
        accountId: snapshot.brokerageAccountId,
        businessEventId: `conversion:${cycleId}:investment:credit`,
        direction: 'CREDIT',
        amountCents: drawAmountCents,
        narrative: 'Record ETF position (investment asset)',
        cycleId: cycleId!,
        ...(providerRefs.providerOrderId
          ? {
              providerRefType: 'INVESTMENT_ORDER',
              providerRefId: providerRefs.providerOrderId,
            }
          : {}),
      },
    ],
  });

  try {
    await poll.reconcileCycle(baseCtx());
  } catch (err) {
    if (isReconciliationFailed(err)) {
      return pause(Codes.RECONCILIATION_FAILED, 'Cycle money trail failed reconciliation');
    }
    throw err;
  }

  phase = 'COMPLETING';
  await db.completeCycle(baseCtx());
  await db.createAuditPackageMetadata({
    ...baseCtx(),
    packageType: 'CYCLE_COMPLETED',
    metadata: {
      drawAmountCents,
      principalRepaidCents,
      newlyAvailableCreditCents,
      providerRefs,
      symbol: snapshot.symbol,
    },
  });

  return finish({
    outcome: 'COMPLETED',
    cycleId: cycleId!,
    drawAmountCents,
    principalRepaidCents: principalRepaidCents!,
  });
}
