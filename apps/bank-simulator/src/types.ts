export type MortgagePaymentState = 'SCHEDULED' | 'POSTED' | 'SETTLED' | 'REVERSED';
export type DrawState = 'REQUESTED' | 'PENDING' | 'SETTLED' | 'FAILED' | 'UNKNOWN';
export type TransferState = 'REQUESTED' | 'PENDING' | 'SETTLED' | 'FAILED' | 'UNKNOWN';
export type InterestChargeState = 'PENDING' | 'POSTED' | 'FAILED';
export type InterestPaymentState = 'PENDING' | 'SETTLED' | 'FAILED';
export type AccountKind = 'MORTGAGE' | 'HELOC' | 'ORDINARY' | 'BROKERAGE_LINK';

export interface SimUser {
  id: string;
  externalUserId: string;
  displayName: string;
  createdAt: string;
}

export interface SimAccount {
  id: string;
  userId: string;
  kind: AccountKind;
  displayAlias: string;
  providerAccountId: string;
  currencyCode: 'CAD';
  /** Ordinary bank cash balance in cents. */
  balanceCents: bigint;
  createdAt: string;
}

export interface SimMortgage {
  id: string;
  accountId: string;
  outstandingPrincipalCents: bigint;
  expectedPaymentDay: number;
}

export interface SimHeloc {
  id: string;
  accountId: string;
  creditLimitCents: bigint;
  balanceOwedCents: bigint;
  /** Pre-existing unused available credit (before period readvance). */
  existingAvailableCreditCents: bigint;
  /** Credit newly created during the payment period via readvance events. */
  newlyAvailableCreditCents: bigint;
}

export interface HelocCreditEvent {
  id: string;
  helocId: string;
  providerEventId: string;
  creditDeltaCents: bigint;
  availableCreditCents: bigint;
  relatedPaymentPeriod: string | null;
  relatedMortgagePaymentId: string | null;
  observedAt: string;
  /** true = newly created by readvance; false = snapshot of existing pool */
  isNewlyCreated: boolean;
}

export interface MortgagePayment {
  id: string;
  mortgageId: string;
  providerPaymentId: string;
  paymentPeriod: string;
  totalAmountCents: bigint;
  principalAmountCents: bigint;
  interestAmountCents: bigint;
  state: MortgagePaymentState;
  scheduledAt: string;
  postedAt: string | null;
  settledAt: string | null;
  reversedAt: string | null;
}

export interface HelocDraw {
  id: string;
  helocId: string;
  amountCents: bigint;
  idempotencyKey: string;
  state: DrawState;
  providerTransactionId: string;
  requestedAt: string;
  settledAt: string | null;
  failureCode: string | null;
  requestHash: string;
}

export interface BankTransfer {
  id: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: bigint;
  idempotencyKey: string;
  state: TransferState;
  providerTransactionId: string;
  requestedAt: string;
  settledAt: string | null;
  failureCode: string | null;
  requestHash: string;
}

export interface InterestCharge {
  id: string;
  helocId: string;
  providerChargeId: string;
  interestPeriod: string;
  amountCents: bigint;
  state: InterestChargeState;
  postedAt: string | null;
  createdAt: string;
}

export interface InterestPayment {
  id: string;
  chargeId: string;
  ordinaryAccountId: string;
  providerPaymentId: string;
  amountCents: bigint;
  state: InterestPaymentState;
  settledAt: string | null;
  createdAt: string;
  failureCode: string | null;
}

export interface OrdinaryDebit {
  id: string;
  accountId: string;
  amountCents: bigint;
  relatedInterestPaymentId: string | null;
  narrative: string;
  state: InterestPaymentState;
  createdAt: string;
  settledAt: string | null;
}

export interface LedgerTxn {
  id: string;
  accountId: string;
  amountCents: bigint;
  narrative: string;
  createdAt: string;
  relatedId: string | null;
}

export interface IdempotencyRecord {
  key: string;
  scope: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  createdAt: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  deliverAt: string;
  attempts: number;
  delivered: boolean;
  dropped: boolean;
  signature: string;
  malformed: boolean;
}

export interface ScheduledJob {
  id: string;
  type:
    | 'MORTGAGE_POST'
    | 'MORTGAGE_SETTLE'
    | 'HELOC_READVANCE'
    | 'DRAW_SETTLE'
    | 'TRANSFER_SETTLE'
    | 'INTEREST_DEBIT'
    | 'WEBHOOK_DELIVER';
  runAtMs: number;
  refId: string;
  done: boolean;
}
