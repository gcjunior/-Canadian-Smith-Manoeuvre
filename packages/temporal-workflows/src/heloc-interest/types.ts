/** Workflow ID: heloc-interest/{tenantId}/{strategyId}/{interestPeriod} */
export function helocInterestWorkflowId(input: {
  tenantId: string;
  strategyId: string;
  interestPeriod: string;
}): string {
  return `heloc-interest/${input.tenantId}/${input.strategyId}/${input.interestPeriod}`;
}

/**
 * Stable Workflow input — identifiers and non-sensitive scheduling only.
 * Never include provider credentials or full account details.
 */
export interface HelocInterestWorkflowInput {
  tenantId: string;
  strategyId: string;
  interestPeriod: string;
  /** ISO calendar date of the expected HELOC interest charge (YYYY-MM-DD). */
  expectedInterestChargeDate: string;
  /** IANA timezone for scheduling context (strategy authoritative value may differ). */
  timezone: string;
  /** Propagated from Schedule/HTTP — written to cycle + provider/DB rows. */
  correlationId?: string;
  /** Optional bank simulator scenario selector. */
  simulatorScenarioId?: string;
}

/**
 * Small normalized provider event reference for Temporal Signals — wake-up hint only.
 * Never include full webhook payloads; Workflow Activities remain source of truth.
 */
export interface NormalizedProviderEventRef {
  providerEventId: string;
  accountId: string;
  eventType: string;
  providerType: 'BANK' | 'BROKERAGE';
  providerResourceId?: string;
  occurredAt?: string;
}

export interface StrategyLifecycleSignal {
  reasonCode: string;
  message?: string;
}

export type WorkflowOutcome = 'COMPLETED' | 'PAUSED' | 'FAILED';

export interface HelocInterestProviderRefs {
  chargeId?: string;
  providerChargeId?: string;
  debitId?: string;
  paymentId?: string;
  providerPaymentId?: string;
  ordinaryAccountId?: string;
}

export interface HelocInterestWorkflowResult {
  outcome: WorkflowOutcome;
  cycleId: string;
  interestPeriod: string;
  failureCode?: string;
  reason?: string;
  chargeAmountCents?: string;
  debitAmountCents?: string;
  providerRefs: HelocInterestProviderRefs;
}

export type WorkflowPhase =
  | 'STARTED'
  | 'LOADING_SNAPSHOT'
  | 'RESERVING_CYCLE'
  | 'WAITING_FOR_CHARGE'
  | 'RECORDING_CHARGE'
  | 'WAITING_FOR_DEBIT'
  | 'CONFIRMING_DEBIT'
  | 'VALIDATING'
  | 'RECONCILING'
  | 'COMPLETING'
  | 'PAUSING'
  | 'DONE';

export interface HelocInterestStatus {
  phase: WorkflowPhase;
  outcome: WorkflowOutcome | null;
  cycleId: string | null;
  failureCode: string | null;
  strategyState: string | null;
}

export interface HelocInterestProgress {
  phase: WorkflowPhase;
  cycleId: string | null;
  interestPeriod: string;
  chargeAmountCents: string | null;
  debitAmountCents: string | null;
  providerRefs: HelocInterestProviderRefs;
  pollsCompleted: number;
}

export type WaitReason = 'INTEREST_CHARGE' | 'INTEREST_DEBIT' | 'INTEREST_DEBIT_SETTLEMENT' | null;
