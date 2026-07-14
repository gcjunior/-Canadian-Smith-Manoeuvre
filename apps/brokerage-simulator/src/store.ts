import type { BrokerageScenarioConfig } from './scenario/schema.js';
import type {
  BrokerageAccount,
  Deposit,
  Fill,
  IdempotencyRecord,
  Order,
  Position,
  Quote,
  ScheduledJob,
  WebhookEvent,
} from './types.js';

export class BrokerageSimulatorStore {
  scenario: BrokerageScenarioConfig | null = null;
  accounts = new Map<string, BrokerageAccount>();
  quotes = new Map<string, Quote>();
  positions = new Map<string, Position>();
  deposits = new Map<string, Deposit>();
  orders = new Map<string, Order>();
  fills: Fill[] = [];
  idempotency = new Map<string, IdempotencyRecord>();
  webhooks: WebhookEvent[] = [];
  jobs: ScheduledJob[] = [];
  failureStepIndex = 0;

  reset(): void {
    this.scenario = null;
    this.accounts.clear();
    this.quotes.clear();
    this.positions.clear();
    this.deposits.clear();
    this.orders.clear();
    this.fills = [];
    this.idempotency.clear();
    this.webhooks = [];
    this.jobs = [];
    this.failureStepIndex = 0;
  }

  positionKey(accountId: string, symbol: string): string {
    return `${accountId}:${symbol}`;
  }

  idempotencyLookup(scope: string, key: string): IdempotencyRecord | undefined {
    return this.idempotency.get(`${scope}:${key}`);
  }

  findDepositByIdempotency(key: string): Deposit | undefined {
    return [...this.deposits.values()].find((d) => d.idempotencyKey === key);
  }

  findOrderByIdempotency(key: string): Order | undefined {
    return [...this.orders.values()].find((o) => o.idempotencyKey === key);
  }
}
