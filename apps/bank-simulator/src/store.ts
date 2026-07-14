import type {
  BankTransfer,
  HelocCreditEvent,
  HelocDraw,
  IdempotencyRecord,
  InterestCharge,
  InterestPayment,
  LedgerTxn,
  MortgagePayment,
  OrdinaryDebit,
  ScheduledJob,
  SimAccount,
  SimHeloc,
  SimMortgage,
  SimUser,
  WebhookEvent,
} from './types.js';
import type { BankScenarioConfig } from './scenario/schema.js';

export class BankSimulatorStore {
  scenario: BankScenarioConfig | null = null;
  users = new Map<string, SimUser>();
  accounts = new Map<string, SimAccount>();
  mortgages = new Map<string, SimMortgage>();
  helocs = new Map<string, SimHeloc>();
  payments = new Map<string, MortgagePayment>();
  creditEvents: HelocCreditEvent[] = [];
  draws = new Map<string, HelocDraw>();
  transfers = new Map<string, BankTransfer>();
  interestCharges = new Map<string, InterestCharge>();
  interestPayments = new Map<string, InterestPayment>();
  ordinaryDebits = new Map<string, OrdinaryDebit>();
  transactions: LedgerTxn[] = [];
  idempotency = new Map<string, IdempotencyRecord>();
  webhooks: WebhookEvent[] = [];
  jobs: ScheduledJob[] = [];
  /** Tracks consumed deterministic failure steps by index. */
  failureStepIndex = 0;
  staleAvailabilityUntilMs = 0;

  reset(): void {
    this.scenario = null;
    this.users.clear();
    this.accounts.clear();
    this.mortgages.clear();
    this.helocs.clear();
    this.payments.clear();
    this.creditEvents = [];
    this.draws.clear();
    this.transfers.clear();
    this.interestCharges.clear();
    this.interestPayments.clear();
    this.ordinaryDebits.clear();
    this.transactions = [];
    this.idempotency.clear();
    this.webhooks = [];
    this.jobs = [];
    this.failureStepIndex = 0;
    this.staleAvailabilityUntilMs = 0;
  }

  idempotencyLookup(scope: string, key: string): IdempotencyRecord | undefined {
    return this.idempotency.get(`${scope}:${key}`);
  }

  findDrawByIdempotency(helocId: string, key: string): HelocDraw | undefined {
    return [...this.draws.values()].find((d) => d.helocId === helocId && d.idempotencyKey === key);
  }

  findTransferByIdempotency(key: string): BankTransfer | undefined {
    return [...this.transfers.values()].find((t) => t.idempotencyKey === key);
  }
}
