export type DepositState =
  | 'REQUESTED'
  | 'PENDING'
  | 'SETTLED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'REVERSED';

export type OrderState =
  | 'CREATED'
  | 'SUBMITTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface BrokerageAccount {
  id: string;
  externalAccountId: string;
  displayName: string;
  currencyCode: 'CAD';
  registrationType: 'NON_REGISTERED';
  settledCashCents: bigint;
  pendingCashCents: bigint;
  restricted: boolean;
  restrictionReason: string | null;
  createdAt: string;
}

export interface Quote {
  symbol: string;
  bid: string;
  ask: string;
  mid: string;
  observedAt: string;
}

export interface Position {
  accountId: string;
  symbol: string;
  /** Decimal string quantity. */
  quantity: string;
  averageCostCentsPerUnit: string;
  updatedAt: string;
}

export interface Deposit {
  id: string;
  accountId: string;
  amountCents: bigint;
  idempotencyKey: string;
  state: DepositState;
  providerDepositId: string;
  requestedAt: string;
  settledAt: string | null;
  failureCode: string | null;
  requestHash: string;
}

export interface Order {
  id: string;
  accountId: string;
  symbol: string;
  side: 'BUY';
  notionalCents: bigint;
  /** Target quantity derived at submit (decimal string). */
  quantity: string | null;
  filledQuantity: string;
  limitPrice: string | null;
  averageFillPrice: string | null;
  idempotencyKey: string;
  state: OrderState;
  providerOrderId: string;
  createdAt: string;
  submittedAt: string | null;
  filledAt: string | null;
  failureCode: string | null;
  requestHash: string;
  commissionCents: bigint;
}

export interface Fill {
  id: string;
  orderId: string;
  accountId: string;
  symbol: string;
  providerFillId: string;
  quantity: string;
  price: string;
  amountCents: bigint;
  filledAt: string;
  createdAt: string;
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

export type JobType =
  | 'DEPOSIT_SETTLE'
  | 'ORDER_ACK'
  | 'ORDER_FILL'
  | 'ORDER_FILL_REMAINING'
  | 'WEBHOOK_DELIVER';

export interface ScheduledJob {
  id: string;
  type: JobType;
  runAtMs: number;
  refId: string;
  done: boolean;
}
