/** Workflow ID: monthly-conversion/{tenantId}/{strategyId}/{paymentPeriod} */
export function monthlyConversionWorkflowId(input: {
  tenantId: string;
  strategyId: string;
  paymentPeriod: string;
}): string {
  return `monthly-conversion/${input.tenantId}/${input.strategyId}/${input.paymentPeriod}`;
}

/**
 * Stable Workflow input — identifiers and non-sensitive scheduling only.
 * Never include provider credentials or full account details.
 */
export interface MonthlyConversionWorkflowInput {
  tenantId: string;
  strategyId: string;
  paymentPeriod: string;
  /** ISO calendar date of the expected mortgage payment (YYYY-MM-DD). */
  expectedPaymentDate: string;
  /** IANA timezone for scheduling context (strategy authoritative value may differ). */
  timezone: string;
  /** Propagated from Schedule/HTTP — written to cycle + provider/DB rows. */
  correlationId?: string;
  /** Optional bank/brokerage simulator scenario selector. */
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

export type WorkflowOutcome = 'COMPLETED' | 'SKIPPED' | 'PAUSED' | 'FAILED';

export interface MonthlyConversionProviderRefs {
  mortgagePaymentId?: string;
  providerPaymentId?: string;
  helocDrawId?: string;
  providerTransferId?: string;
  providerDepositId?: string;
  providerOrderId?: string;
  investmentOrderId?: string;
  moneyMovementDrawId?: string;
  moneyMovementTransferId?: string;
}

export interface MonthlyConversionWorkflowResult {
  outcome: WorkflowOutcome;
  cycleId: string;
  paymentPeriod: string;
  failureCode?: string;
  reason?: string;
  drawAmountCents?: string;
  principalRepaidCents?: string;
  providerRefs: MonthlyConversionProviderRefs;
}

export type WorkflowPhase =
  | 'STARTED'
  | 'LOADING_SNAPSHOT'
  | 'RESERVING_CYCLE'
  | 'WAITING_FOR_MORTGAGE'
  | 'VERIFYING_MORTGAGE'
  | 'WAITING_FOR_HELOC'
  | 'CALCULATING_AMOUNT'
  | 'HELOC_DRAW'
  | 'BROKERAGE_TRANSFER'
  | 'INVESTMENT_ORDER'
  | 'RECONCILING'
  | 'COMPLETING'
  | 'SKIPPING'
  | 'PAUSING'
  | 'DONE';

export interface MonthlyConversionStatus {
  phase: WorkflowPhase;
  outcome: WorkflowOutcome | null;
  cycleId: string | null;
  failureCode: string | null;
  strategyState: string | null;
}

export interface MonthlyConversionProgress {
  phase: WorkflowPhase;
  cycleId: string | null;
  paymentPeriod: string;
  principalRepaidCents: string | null;
  newlyAvailableCreditCents: string | null;
  drawAmountCents: string | null;
  providerRefs: MonthlyConversionProviderRefs;
  pollsCompleted: number;
}

export type WaitReason =
  | 'MORTGAGE_PAYMENT'
  | 'HELOC_CREDIT'
  | 'HELOC_DRAW_SETTLEMENT'
  | 'BROKERAGE_TRANSFER_SETTLEMENT'
  | 'INVESTMENT_FILL'
  | 'INVESTMENT_SETTLEMENT'
  | null;
