import {
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  uuid4,
  workflowInfo,
} from '@temporalio/workflow';

import { resolveWorkflowCorrelationId } from '../shared/correlation.js';
import type { HelocInterestActivities } from './activity-types.js';
import { CHARGE_DEADLINE, DEBIT_DEADLINE, WORKFLOW_ACTIVITY_OPTIONS } from './constants.js';
import { HELOC_INTEREST_FAILURE_CODES as Codes } from './failure-codes.js';
import {
  activityFailureType,
  durationToMs,
  idempotencyKey,
  isNotFound,
  isReconciliationFailed,
  pauseCodeFromActivityFailure,
  waitForSignalOrPollInterval,
} from './helpers.js';
import type {
  HelocInterestProgress,
  HelocInterestProviderRefs,
  HelocInterestStatus,
  HelocInterestWorkflowInput,
  HelocInterestWorkflowResult,
  NormalizedProviderEventRef,
  StrategyLifecycleSignal,
  WaitReason,
  WorkflowOutcome,
  WorkflowPhase,
} from './types.js';

/**
 * Bank webhook wake for interest monitoring.
 * Payload shape matches monthly conversion's bankEventReceived; signal name is
 * interest-specific so webhooks can target this Workflow without colliding.
 */
export const interestBankEventReceived = defineSignal<[NormalizedProviderEventRef]>(
  'interestBankEventReceived',
);

export const strategyPaused = defineSignal<[StrategyLifecycleSignal]>('strategyPaused');
export const strategyClosed = defineSignal<[StrategyLifecycleSignal]>('strategyClosed');

export const getStatus = defineQuery<HelocInterestStatus>('getStatus');
export const getProgress = defineQuery<HelocInterestProgress>('getProgress');
export const getCurrentWaitReason = defineQuery<WaitReason>('getCurrentWaitReason');

const read = proxyActivities<HelocInterestActivities>(WORKFLOW_ACTIVITY_OPTIONS.read);
const db = proxyActivities<HelocInterestActivities>(WORKFLOW_ACTIVITY_OPTIONS.database);
const poll = proxyActivities<HelocInterestActivities>(WORKFLOW_ACTIVITY_OPTIONS.polling);

export async function helocInterestPaymentWorkflow(
  input: HelocInterestWorkflowInput,
): Promise<HelocInterestWorkflowResult> {
  const correlationId = resolveWorkflowCorrelationId({
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    memo: workflowInfo().memo,
    fallback: uuid4(),
  });
  const seenBankEvents = new Set<string>();

  let bankWake = false;
  let pausedSignal: StrategyLifecycleSignal | null = null;
  let closedSignal: StrategyLifecycleSignal | null = null;

  let phase: WorkflowPhase = 'STARTED';
  let waitReason: WaitReason = null;
  let outcome: WorkflowOutcome | null = null;
  let failureCode: string | null = null;
  let cycleId: string | null = null;
  let strategyState: string | null = null;
  let pollsCompleted = 0;
  let chargeAmountCents: string | null = null;
  let debitAmountCents: string | null = null;
  const providerRefs: HelocInterestProviderRefs = {};

  const nowMs = () => Date.now();

  setHandler(interestBankEventReceived, (event) => {
    if (!event?.providerEventId || seenBankEvents.has(event.providerEventId)) {
      return;
    }
    if (event.providerType !== 'BANK') {
      return;
    }
    seenBankEvents.add(event.providerEventId);
    bankWake = true;
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
    interestPeriod: input.interestPeriod,
    chargeAmountCents,
    debitAmountCents,
    providerRefs: { ...providerRefs },
    pollsCompleted,
  }));

  setHandler(getCurrentWaitReason, () => waitReason);

  const baseCtx = () => ({
    tenantId: input.tenantId,
    strategyId: input.strategyId,
    correlationId,
    interestPeriod: input.interestPeriod,
    ...(cycleId ? { cycleId } : {}),
  });

  const finish = (
    result: Omit<HelocInterestWorkflowResult, 'interestPeriod' | 'providerRefs'> & {
      providerRefs?: HelocInterestProviderRefs;
    },
  ): HelocInterestWorkflowResult => {
    outcome = result.outcome;
    failureCode = result.failureCode ?? null;
    phase = 'DONE';
    waitReason = null;
    return {
      ...result,
      interestPeriod: input.interestPeriod,
      providerRefs: { ...providerRefs, ...result.providerRefs },
    };
  };

  const pause = async (
    code: string,
    message: string,
    cycleTerminalState: 'PAUSED' | 'FAILED' = 'PAUSED',
  ): Promise<HelocInterestWorkflowResult> => {
    phase = 'PAUSING';
    await db.failInterestCycle({
      ...baseCtx(),
      code,
      message,
      terminalState: cycleTerminalState,
      details: {
        providerRefs,
        chargeAmountCents,
        debitAmountCents,
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
      ...(chargeAmountCents ? { chargeAmountCents } : {}),
      ...(debitAmountCents ? { debitAmountCents } : {}),
    });
  };

  const checkLifecycle = async (): Promise<HelocInterestWorkflowResult | null> => {
    if (closedSignal) {
      return pause(
        Codes.STRATEGY_CLOSED,
        closedSignal.message ?? 'Strategy closed during interest payment',
        'FAILED',
      );
    }
    if (pausedSignal) {
      return pause(Codes.STRATEGY_PAUSED, pausedSignal.message ?? pausedSignal.reasonCode);
    }
    return null;
  };

  // --- 1–2: snapshot (ACTIVE required), reserve interest cycle
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
  const reserved = await db.reserveInterestCycle({
    ...baseCtx(),
    interestPeriod: input.interestPeriod,
  });
  cycleId = reserved.cycleId;

  if (input.simulatorScenarioId) {
    await db.recordOperation({
      ...baseCtx(),
      operationKey: idempotencyKey(
        input.tenantId,
        input.strategyId,
        input.interestPeriod,
        'scenario',
      ),
      operationType: 'SIMULATOR_SCENARIO',
      payload: { simulatorScenarioId: input.simulatorScenarioId },
    });
  }

  // --- 3–4: poll for posted HELOC interest charge (signal or 6h, 14-day deadline)
  phase = 'WAITING_FOR_CHARGE';
  const chargeDeadline = nowMs() + durationToMs(CHARGE_DEADLINE);
  let charge: Awaited<ReturnType<typeof read.findPostedInterestCharge>> | null = null;

  while (!charge) {
    const life = await checkLifecycle();
    if (life) {
      return life;
    }

    try {
      charge = await read.findPostedInterestCharge(baseCtx());
      if (charge.state === 'FAILED') {
        return pause(Codes.INTEREST_CHARGE_FAILED, 'HELOC interest charge failed');
      }
      if (charge.state !== 'POSTED' && charge.state !== 'SETTLED') {
        charge = null;
      } else {
        providerRefs.chargeId = charge.chargeId;
        providerRefs.providerChargeId = charge.providerChargeId;
        chargeAmountCents = charge.amountCents;
        break;
      }
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
      waitReason: 'INTEREST_CHARGE',
      deadlineMs: chargeDeadline,
      nowMs,
    });
    if (wait === 'deadline') {
      return pause(
        Codes.INTEREST_CHARGE_TIMEOUT,
        'HELOC interest charge not posted within 14-day deadline',
      );
    }
  }

  phase = 'RECORDING_CHARGE';
  await db.transitionInterestCycleState({
    ...baseCtx(),
    fromState: 'AWAITING_CHARGE',
    toState: 'AWAITING_DEBIT',
  });

  // --- 5–6: find ordinary debit + confirm SETTLED (signal or 6h, 7-day deadline)
  phase = 'WAITING_FOR_DEBIT';
  const debitDeadline = nowMs() + durationToMs(DEBIT_DEADLINE);
  let debit: Awaited<ReturnType<typeof read.findOrdinaryInterestDebit>> | null = null;

  while (!debit) {
    const life = await checkLifecycle();
    if (life) {
      return life;
    }

    let found: Awaited<ReturnType<typeof read.findOrdinaryInterestDebit>> | null = null;
    try {
      found = await read.findOrdinaryInterestDebit({
        ...baseCtx(),
        chargeId: charge!.chargeId,
        providerChargeId: charge!.providerChargeId,
      });
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
    }

    if (found) {
      providerRefs.debitId = found.debitId;
      providerRefs.paymentId = found.paymentId;
      if (found.providerPaymentId !== undefined) {
        providerRefs.providerPaymentId = found.providerPaymentId;
      }
      providerRefs.ordinaryAccountId = found.ordinaryAccountId;
      debitAmountCents = found.amountCents;

      if (found.failureCode === 'INSUFFICIENT_FUNDS' || found.state === 'FAILED') {
        const code =
          found.failureCode === 'INSUFFICIENT_FUNDS'
            ? Codes.INSUFFICIENT_FUNDS
            : (found.failureCode ?? Codes.DEBIT_FAILED);
        return pause(
          code,
          code === Codes.INSUFFICIENT_FUNDS
            ? 'Ordinary bank debit failed: insufficient funds'
            : `Ordinary bank interest debit failed (${found.failureCode ?? found.state})`,
        );
      }
      if (found.state === 'REVERSED') {
        return pause(Codes.DEBIT_REVERSED, 'Ordinary bank interest debit was reversed');
      }

      phase = 'CONFIRMING_DEBIT';
      try {
        waitReason = 'INTEREST_DEBIT_SETTLEMENT';
        await poll.confirmInterestDebitSettlement({
          ...baseCtx(),
          debitId: found.debitId,
          paymentId: found.paymentId,
        });
        waitReason = null;
        debit = { ...found, state: 'SETTLED' };
        break;
      } catch (err) {
        waitReason = null;
        const type = activityFailureType(err);
        if (type === 'INSUFFICIENT_FUNDS') {
          return pause(Codes.INSUFFICIENT_FUNDS, 'Ordinary bank debit failed: insufficient funds');
        }
        if (type === 'DEBIT_REVERSED' || type === 'PAYMENT_REVERSED') {
          return pause(Codes.DEBIT_REVERSED, 'Ordinary bank interest debit was reversed');
        }
        if (type === 'DEBIT_FAILED' || type === 'BUSINESS_REJECTION') {
          return pause(Codes.DEBIT_FAILED, 'Ordinary bank interest debit rejected or failed');
        }
        if (!isNotFound(err) && type !== 'DEBIT_PENDING') {
          return pause(
            pauseCodeFromActivityFailure(err, Codes.UNSAFE_OUTCOME),
            `Ordinary bank debit settlement failed: ${type ?? 'unknown'}`,
          );
        }
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
      waitReason: 'INTEREST_DEBIT',
      deadlineMs: debitDeadline,
      nowMs,
    });
    if (wait === 'deadline') {
      return pause(
        Codes.INTEREST_DEBIT_TIMEOUT,
        'Ordinary bank interest debit not settled within 7-day deadline',
      );
    }
  }

  // --- 7: validate amount, HELOC destination, ordinary source, period, provider refs
  phase = 'VALIDATING';
  try {
    await read.validateInterestPaymentRules({
      ...baseCtx(),
      chargeId: charge!.chargeId,
      debitId: debit!.debitId,
      chargeAmountCents: chargeAmountCents!,
      debitAmountCents: debitAmountCents!,
      ordinaryAccountId: debit!.ordinaryAccountId,
    });
  } catch (err) {
    const type = activityFailureType(err);
    if (type === 'INTEREST_AMOUNT_MISMATCH') {
      return pause(Codes.INTEREST_AMOUNT_MISMATCH, 'Interest charge and debit amounts differ');
    }
    if (type === 'INTEREST_UNEXPECTED_SOURCE' || type === 'VALIDATION_FAILURE') {
      return pause(
        Codes.INTEREST_UNEXPECTED_SOURCE,
        'Interest debit source or destination failed validation',
      );
    }
    if (type === 'DUPLICATE_CONFLICT') {
      return pause(Codes.DUPLICATE_CONFLICT, 'Duplicate interest payment conflict');
    }
    return pause(
      pauseCodeFromActivityFailure(err, Codes.UNSAFE_OUTCOME),
      `Interest payment validation failed: ${type ?? 'unknown'}`,
    );
  }

  // --- 8–10: reconcile, ledger, audit, complete
  phase = 'RECONCILING';
  await db.transitionInterestCycleState({
    ...baseCtx(),
    fromState: 'AWAITING_DEBIT',
    toState: 'RECONCILING',
  });

  // Do not pass interest cycleId as ledger.cycleId — that FK is MonthlyConversionCycle only.
  // Append balanced legs before reconcile so LEDGER_BALANCED can evaluate.
  await db.appendLedgerEntries({
    ...baseCtx(),
    entries: [
      {
        accountId: snapshot.bankAccountId,
        businessEventId: `interest:${cycleId}:debit`,
        direction: 'DEBIT',
        amountCents: chargeAmountCents!,
        narrative: 'Ordinary bank debit for HELOC interest',
        interestCycleId: cycleId!,
        ...(providerRefs.debitId
          ? { providerRefType: 'HELOC_INTEREST_DEBIT', providerRefId: providerRefs.debitId }
          : {}),
      },
      {
        accountId: snapshot.helocAccountId,
        businessEventId: `interest:${cycleId}:credit`,
        direction: 'CREDIT',
        amountCents: chargeAmountCents!,
        narrative: 'HELOC interest charge payment',
        interestCycleId: cycleId!,
        ...(providerRefs.providerChargeId
          ? {
              providerRefType: 'HELOC_INTEREST_CHARGE',
              providerRefId: providerRefs.providerChargeId,
            }
          : {}),
      },
    ],
  });

  try {
    await poll.reconcileInterestCycle(baseCtx());
  } catch (err) {
    if (isReconciliationFailed(err)) {
      return pause(Codes.RECONCILIATION_FAILED, 'Interest cycle money trail failed reconciliation');
    }
    throw err;
  }

  phase = 'COMPLETING';
  await db.completeInterestCycle(baseCtx());
  await db.createAuditPackageMetadata({
    ...baseCtx(),
    packageType: 'INTEREST_CYCLE_COMPLETED',
    metadata: {
      chargeAmountCents,
      debitAmountCents,
      providerRefs,
    },
  });

  return finish({
    outcome: 'COMPLETED',
    cycleId: cycleId!,
    chargeAmountCents: chargeAmountCents!,
    debitAmountCents: debitAmountCents!,
  });
}

/** Alias for schedule / worker registration convenience. */
export { helocInterestPaymentWorkflow as HelocInterest };
