import { createHash, createHmac, randomUUID } from 'node:crypto';

import type { Logger } from '@csm/observability';

import type { Clock } from './clock.js';
import {
  applyPriceMove,
  formatDecimal,
  multiplyToCents,
  parseDecimal,
  quantityFromNotionalCents,
  SCALE,
} from './decimal.js';
import { createSeededRng } from './rng.js';
import type { BrokerageScenarioConfig, DeterministicFailureStep } from './scenario/schema.js';
import { type BrokerageSimulatorStore } from './store.js';
import type { BrokerageAccount, Deposit, Fill, Order, Quote, ScheduledJob } from './types.js';

export class SimulatorHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SimulatorHttpError';
  }
}

export interface BrokerageSimulatorDeps {
  clock: Clock;
  store: BrokerageSimulatorStore;
  logger: Logger;
  webhookSigningSecret: string;
  webhookTargetUrl?: string;
  webhooksEnabledDefault: boolean;
}

function hashRequest(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function extractSimulatorExternalAccountId(payload: Record<string, unknown>): string {
  for (const key of ['accountId', 'externalAccountId']) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return 'unknown-account';
}

function buildSimulatorProviderEventId(type: string, payload: Record<string, unknown>): string {
  const id = typeof payload.id === 'string' ? payload.id : randomUUID();
  const state = typeof payload.state === 'string' ? payload.state : 'na';
  return `${type}:${id}:${state}`;
}

function moneyJson(cents: bigint): string {
  return cents.toString();
}

export class BrokerageSimulatorEngine {
  private readonly clock: Clock;
  private readonly store: BrokerageSimulatorStore;
  private readonly logger: Logger;
  private readonly webhookSigningSecret: string;
  private readonly webhookTargetUrl: string | undefined;
  private readonly webhooksEnabledDefault: boolean;
  private rng: (() => number) | null = null;

  constructor(deps: BrokerageSimulatorDeps) {
    this.clock = deps.clock;
    this.store = deps.store;
    this.logger = deps.logger;
    this.webhookSigningSecret = deps.webhookSigningSecret;
    this.webhookTargetUrl = deps.webhookTargetUrl;
    this.webhooksEnabledDefault = deps.webhooksEnabledDefault;
  }

  getStore(): BrokerageSimulatorStore {
    return this.store;
  }

  getClock(): Clock {
    return this.clock;
  }

  reset(): void {
    this.store.reset();
    this.rng = null;
  }

  loadScenario(config: BrokerageScenarioConfig): BrokerageScenarioConfig {
    this.store.reset();
    this.store.scenario = config;
    this.rng = config.seed !== undefined ? createSeededRng(config.seed) : null;
    const mid = parseDecimal(config.quotePrice);
    const spread = parseDecimal(config.spread);
    const half = spread / 2n;
    this.store.quotes.set(config.etfSymbol, {
      symbol: config.etfSymbol,
      bid: formatDecimal(mid - half > 0n ? mid - half : 1n),
      ask: formatDecimal(mid + half),
      mid: formatDecimal(mid),
      observedAt: this.iso(),
    });
    return config;
  }

  createAccount(input: {
    externalAccountId: string;
    displayName: string;
    settledCashCents?: bigint;
    /** Optional deterministic account UUID (aligned with bank BROKERAGE_LINK). */
    id?: string;
  }): BrokerageAccount {
    const scenario = this.requireScenario();
    const accountId = input.id ?? randomUUID();
    if (this.store.accounts.has(accountId)) {
      throw new SimulatorHttpError(409, 'Account id already exists');
    }
    const account: BrokerageAccount = {
      id: accountId,
      externalAccountId: input.externalAccountId,
      displayName: input.displayName,
      currencyCode: 'CAD',
      registrationType: 'NON_REGISTERED',
      settledCashCents: input.settledCashCents ?? scenario.initialSettledCashCents,
      pendingCashCents: 0n,
      restricted: false,
      restrictionReason: null,
      createdAt: this.iso(),
    };
    this.store.accounts.set(account.id, account);
    return account;
  }

  upsertQuote(input: { symbol: string; mid: string; spread?: string }): Quote {
    const mid = parseDecimal(input.mid);
    const spread = parseDecimal(input.spread ?? this.requireScenario().spread);
    const half = spread / 2n;
    const quote: Quote = {
      symbol: input.symbol,
      bid: formatDecimal(mid - half > 0n ? mid - half : 1n),
      ask: formatDecimal(mid + half),
      mid: formatDecimal(mid),
      observedAt: this.iso(),
    };
    this.store.quotes.set(input.symbol, quote);
    const scenario = this.store.scenario;
    if (scenario && scenario.etfSymbol === input.symbol) {
      scenario.quotePrice = quote.mid;
      scenario.spread = formatDecimal(spread);
    }
    return quote;
  }

  runEvents(advanceMs = 0): { advancedMs: number; jobsProcessed: number; now: string } {
    if (advanceMs > 0) {
      this.clock.advance(advanceMs);
    }
    let jobsProcessed = 0;
    for (let pass = 0; pass < 50; pass += 1) {
      const due = this.store.jobs
        .filter((j) => !j.done && j.runAtMs <= this.clock.nowMs())
        .sort((a, b) => a.runAtMs - b.runAtMs);
      if (due.length === 0) {
        break;
      }
      for (const job of due) {
        this.executeJob(job.id);
        jobsProcessed += 1;
      }
    }
    return { advancedMs: advanceMs, jobsProcessed, now: this.iso() };
  }

  getAccount(accountId: string): BrokerageAccount {
    const account = this.store.accounts.get(accountId);
    if (!account) {
      throw new SimulatorHttpError(404, 'Account not found');
    }
    return account;
  }

  getCash(accountId: string) {
    const account = this.getAccount(accountId);
    return {
      accountId,
      currencyCode: 'CAD' as const,
      settledCashCents: moneyJson(account.settledCashCents),
      pendingCashCents: moneyJson(account.pendingCashCents),
      availableCashCents: moneyJson(account.settledCashCents),
      restricted: account.restricted,
      observedAt: this.iso(),
    };
  }

  listPositions(accountId: string) {
    this.getAccount(accountId);
    return [...this.store.positions.values()].filter((p) => p.accountId === accountId);
  }

  createDeposit(input: { accountId: string; amountCents: bigint; idempotencyKey: string }): {
    statusCode: number;
    body: unknown;
  } {
    const scenario = this.requireScenario();
    const scope = 'brokerage.deposit';
    const requestHash = hashRequest({
      ...input,
      amountCents: input.amountCents.toString(),
    });
    const existing = this.store.idempotencyLookup(scope, input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new SimulatorHttpError(409, 'Idempotency key reused with different payload');
      }
      return { statusCode: existing.statusCode, body: existing.responseBody };
    }

    this.maybeFail('deposit');
    this.getAccount(input.accountId);

    const deposit: Deposit = {
      id: randomUUID(),
      accountId: input.accountId,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      state: 'REQUESTED',
      providerDepositId: `dep_${randomUUID()}`,
      requestedAt: this.iso(),
      settledAt: null,
      failureCode: null,
      requestHash,
    };
    this.store.deposits.set(deposit.id, deposit);
    deposit.state = 'PENDING';
    const account = this.getAccount(input.accountId);
    account.pendingCashCents += input.amountCents;

    this.schedule('DEPOSIT_SETTLE', deposit.id, scenario.depositSettlementDelayMs);
    const body = this.depositPayload(deposit);
    this.persistIdempotency(scope, input.idempotencyKey, requestHash, 202, body);
    this.emitWebhook('brokerage.deposit.updated', body);

    if (this.consumeFailure('TIMEOUT_AFTER_SUCCESS')) {
      throw new SimulatorHttpError(504, 'Gateway timeout after processing', {
        processed: true,
        depositId: deposit.id,
      });
    }

    return { statusCode: 202, body };
  }

  getDeposit(depositId: string): Deposit {
    const deposit = this.store.deposits.get(depositId);
    if (!deposit) {
      throw new SimulatorHttpError(404, 'Deposit not found');
    }
    return deposit;
  }

  getDepositByIdempotency(key: string): Deposit {
    const deposit = this.store.findDepositByIdempotency(key);
    if (!deposit) {
      throw new SimulatorHttpError(404, 'Deposit not found for idempotency key');
    }
    return deposit;
  }

  createOrder(input: {
    accountId: string;
    symbol: string;
    side: 'BUY';
    notionalCents: bigint;
    idempotencyKey: string;
  }): { statusCode: number; body: unknown } {
    const scenario = this.requireScenario();
    const scope = 'brokerage.order';
    const requestHash = hashRequest({
      ...input,
      notionalCents: input.notionalCents.toString(),
    });
    const existing = this.store.idempotencyLookup(scope, input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new SimulatorHttpError(409, 'Idempotency key reused with different payload');
      }
      return { statusCode: existing.statusCode, body: existing.responseBody };
    }

    this.maybeFail('order');
    const account = this.getAccount(input.accountId);

    if (this.consumeFailure('ACCOUNT_RESTRICTION') || account.restricted) {
      account.restricted = true;
      account.restrictionReason = account.restrictionReason ?? 'SIMULATED_RESTRICTION';
      this.emitWebhook('brokerage.account.restricted', {
        accountId: account.id,
        reason: account.restrictionReason,
        restrictedAt: this.iso(),
      });
      const rejected = this.buildOrder(input, 'REJECTED', 'ACCOUNT_RESTRICTED');
      this.store.orders.set(rejected.id, rejected);
      const body = this.orderPayload(rejected);
      this.persistIdempotency(scope, input.idempotencyKey, requestHash, 422, body);
      this.emitWebhook('brokerage.order.updated', body);
      return { statusCode: 422, body };
    }

    if (this.consumeFailure('REJECTED_ORDER')) {
      const rejected = this.buildOrder(input, 'REJECTED', 'ORDER_REJECTED');
      this.store.orders.set(rejected.id, rejected);
      const body = this.orderPayload(rejected);
      this.persistIdempotency(scope, input.idempotencyKey, requestHash, 422, body);
      this.emitWebhook('brokerage.order.updated', body);
      return { statusCode: 422, body };
    }

    const quote = this.store.quotes.get(input.symbol);
    if (!quote) {
      throw new SimulatorHttpError(404, `No quote for symbol ${input.symbol}`);
    }

    const commission = scenario.commissionCents;
    const needCash =
      this.consumeFailure('INSUFFICIENT_SETTLED_CASH') ||
      account.settledCashCents < input.notionalCents + commission;

    if (needCash) {
      const rejected = this.buildOrder(input, 'REJECTED', 'INSUFFICIENT_SETTLED_CASH');
      this.store.orders.set(rejected.id, rejected);
      const body = this.orderPayload(rejected);
      this.persistIdempotency(scope, input.idempotencyKey, requestHash, 422, body);
      this.emitWebhook('brokerage.order.updated', body);
      return { statusCode: 422, body };
    }

    const order = this.buildOrder(input, 'CREATED', null);
    const ask = parseDecimal(quote.ask);
    const qty = quantityFromNotionalCents(input.notionalCents, ask);
    if (!scenario.allowFractionalUnits) {
      const whole = (qty / SCALE) * SCALE;
      order.quantity = formatDecimal(whole > 0n ? whole : 0n);
    } else {
      order.quantity = formatDecimal(qty);
    }
    this.store.orders.set(order.id, order);
    this.schedule('ORDER_ACK', order.id, scenario.orderAckDelayMs);
    const body = this.orderPayload(order);
    this.persistIdempotency(scope, input.idempotencyKey, requestHash, 202, body);
    this.emitWebhook('brokerage.order.updated', body);

    if (this.consumeFailure('TIMEOUT_AFTER_SUCCESS')) {
      throw new SimulatorHttpError(504, 'Gateway timeout after processing', {
        processed: true,
        orderId: order.id,
      });
    }

    return { statusCode: 202, body };
  }

  getOrder(orderId: string): Order {
    const order = this.store.orders.get(orderId);
    if (!order) {
      throw new SimulatorHttpError(404, 'Order not found');
    }
    return order;
  }

  getOrderByIdempotency(key: string): Order {
    const order = this.store.findOrderByIdempotency(key);
    if (!order) {
      throw new SimulatorHttpError(404, 'Order not found for idempotency key');
    }
    return order;
  }

  depositPayload(deposit: Deposit): Record<string, unknown> {
    return {
      id: deposit.id,
      accountId: deposit.accountId,
      amountCents: moneyJson(deposit.amountCents),
      idempotencyKey: deposit.idempotencyKey,
      state: deposit.state,
      providerDepositId: deposit.providerDepositId,
      requestedAt: deposit.requestedAt,
      settledAt: deposit.settledAt,
      failureCode: deposit.failureCode,
    };
  }

  orderPayload(order: Order): Record<string, unknown> {
    return {
      id: order.id,
      accountId: order.accountId,
      symbol: order.symbol,
      side: order.side,
      notionalCents: moneyJson(order.notionalCents),
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      limitPrice: order.limitPrice,
      averageFillPrice: order.averageFillPrice,
      idempotencyKey: order.idempotencyKey,
      state: order.state,
      providerOrderId: order.providerOrderId,
      createdAt: order.createdAt,
      submittedAt: order.submittedAt,
      filledAt: order.filledAt,
      failureCode: order.failureCode,
      commissionCents: moneyJson(order.commissionCents),
    };
  }

  fillPayload(fill: Fill): Record<string, unknown> {
    return {
      id: fill.id,
      orderId: fill.orderId,
      accountId: fill.accountId,
      symbol: fill.symbol,
      providerFillId: fill.providerFillId,
      quantity: fill.quantity,
      price: fill.price,
      amountCents: moneyJson(fill.amountCents),
      filledAt: fill.filledAt,
      createdAt: fill.createdAt,
    };
  }

  accountPayload(account: BrokerageAccount): Record<string, unknown> {
    return {
      ...account,
      settledCashCents: moneyJson(account.settledCashCents),
      pendingCashCents: moneyJson(account.pendingCashCents),
    };
  }

  // ---- internals ----

  private buildOrder(
    input: {
      accountId: string;
      symbol: string;
      side: 'BUY';
      notionalCents: bigint;
      idempotencyKey: string;
    },
    state: Order['state'],
    failureCode: string | null,
  ): Order {
    const scenario = this.requireScenario();
    return {
      id: randomUUID(),
      accountId: input.accountId,
      symbol: input.symbol,
      side: input.side,
      notionalCents: input.notionalCents,
      quantity: null,
      filledQuantity: '0',
      limitPrice: null,
      averageFillPrice: null,
      idempotencyKey: input.idempotencyKey,
      state,
      providerOrderId: `ord_${randomUUID()}`,
      createdAt: this.iso(),
      submittedAt: null,
      filledAt: null,
      failureCode,
      requestHash: '',
      commissionCents: scenario.commissionCents,
    };
  }

  private executeJob(jobId: string): void {
    const job = this.store.jobs.find((j) => j.id === jobId);
    if (!job || job.done) {
      return;
    }
    job.done = true;
    switch (job.type) {
      case 'DEPOSIT_SETTLE':
        this.settleDeposit(job.refId);
        break;
      case 'ORDER_ACK':
        this.ackOrder(job.refId, job.runAtMs);
        break;
      case 'ORDER_FILL':
        this.fillOrder(job.refId, false);
        break;
      case 'ORDER_FILL_REMAINING':
        this.fillOrder(job.refId, true);
        break;
      case 'WEBHOOK_DELIVER':
        void this.deliverWebhook(job.refId);
        break;
      default:
        break;
    }
  }

  private settleDeposit(depositId: string): void {
    const deposit = this.store.deposits.get(depositId);
    if (!deposit || deposit.state !== 'PENDING') {
      return;
    }
    const account = this.store.accounts.get(deposit.accountId);
    if (!account) {
      return;
    }

    if (this.consumeFailure('DEPOSIT_FAIL')) {
      deposit.state = 'FAILED';
      deposit.failureCode = 'DEPOSIT_REJECTED';
      account.pendingCashCents -= deposit.amountCents;
      this.emitWebhook('brokerage.deposit.updated', this.depositPayload(deposit));
      return;
    }

    if (this.consumeFailure('DEPOSIT_REVERSED')) {
      deposit.state = 'REVERSED';
      deposit.failureCode = 'DEPOSIT_REVERSED';
      account.pendingCashCents -= deposit.amountCents;
      this.emitWebhook('brokerage.deposit.updated', this.depositPayload(deposit));
      return;
    }

    account.pendingCashCents -= deposit.amountCents;
    account.settledCashCents += deposit.amountCents;
    deposit.state = 'SETTLED';
    deposit.settledAt = this.iso();
    this.emitWebhook('brokerage.deposit.updated', this.depositPayload(deposit));
  }

  private ackOrder(orderId: string, effectiveAtMs: number): void {
    const scenario = this.requireScenario();
    const order = this.store.orders.get(orderId);
    if (!order || order.state !== 'CREATED') {
      return;
    }
    order.state = 'SUBMITTED';
    order.submittedAt = this.iso();
    this.emitWebhook('brokerage.order.updated', this.orderPayload(order));
    this.schedule('ORDER_FILL', order.id, scenario.fillDelayMs, effectiveAtMs);
  }

  private fillOrder(orderId: string, remainingOnly: boolean): void {
    const scenario = this.requireScenario();
    const order = this.store.orders.get(orderId);
    if (!order) {
      return;
    }
    if (order.state !== 'SUBMITTED' && !(remainingOnly && order.state === 'PARTIALLY_FILLED')) {
      return;
    }

    const quote = this.store.quotes.get(order.symbol);
    if (!quote || !order.quantity) {
      order.state = 'UNKNOWN';
      this.emitWebhook('brokerage.order.updated', this.orderPayload(order));
      return;
    }

    const account = this.getAccount(order.accountId);
    let fillPrice = parseDecimal(quote.ask);
    if (!remainingOnly && this.consumeFailure('PRICE_MOVEMENT')) {
      fillPrice = applyPriceMove(fillPrice, parseDecimal(scenario.fillPriceMove));
    }

    const totalQty = parseDecimal(order.quantity);
    const filledSoFar = parseDecimal(order.filledQuantity);
    const remaining = totalQty - filledSoFar;
    if (remaining <= 0n) {
      return;
    }

    let fillQty = remaining;
    if (!remainingOnly && this.consumeFailure('PARTIAL_FILL')) {
      const fraction = parseDecimal(scenario.partialFillFraction);
      fillQty = (remaining * fraction) / SCALE;
      if (fillQty <= 0n || fillQty >= remaining) {
        fillQty = remaining / 2n > 0n ? remaining / 2n : remaining;
      }
    }

    const amountCents = multiplyToCents(fillQty, fillPrice);
    const cost = amountCents + (remainingOnly ? 0n : order.commissionCents);

    if (account.settledCashCents < cost) {
      order.state = 'REJECTED';
      order.failureCode = 'INSUFFICIENT_SETTLED_CASH';
      this.emitWebhook('brokerage.order.updated', this.orderPayload(order));
      return;
    }

    account.settledCashCents -= cost;
    const fill: Fill = {
      id: randomUUID(),
      orderId: order.id,
      accountId: order.accountId,
      symbol: order.symbol,
      providerFillId: `fill_${randomUUID()}`,
      quantity: formatDecimal(fillQty),
      price: formatDecimal(fillPrice),
      amountCents,
      filledAt: this.iso(),
      createdAt: this.iso(),
    };
    this.store.fills.push(fill);
    this.applyPosition(account.id, order.symbol, fillQty, amountCents);

    const newFilled = filledSoFar + fillQty;
    order.filledQuantity = formatDecimal(newFilled);
    order.averageFillPrice = this.computeAveragePrice(order.id);

    this.emitWebhook('brokerage.fill.created', this.fillPayload(fill));

    if (newFilled < totalQty) {
      order.state = 'PARTIALLY_FILLED';
      this.emitWebhook('brokerage.order.updated', this.orderPayload(order));
      this.schedule('ORDER_FILL_REMAINING', order.id, scenario.fillDelayMs);
    } else {
      order.state = 'FILLED';
      order.filledAt = this.iso();
      this.emitWebhook('brokerage.order.updated', this.orderPayload(order));
    }
  }

  private applyPosition(
    accountId: string,
    symbol: string,
    qtyScaled: bigint,
    amountCents: bigint,
  ): void {
    const key = this.store.positionKey(accountId, symbol);
    const existing = this.store.positions.get(key);
    if (!existing) {
      this.store.positions.set(key, {
        accountId,
        symbol,
        quantity: formatDecimal(qtyScaled),
        averageCostCentsPerUnit: formatDecimal((amountCents * SCALE) / qtyScaled),
        updatedAt: this.iso(),
      });
      return;
    }
    const prevQty = parseDecimal(existing.quantity);
    const newQty = prevQty + qtyScaled;
    const prevCost = parseDecimal(existing.averageCostCentsPerUnit);
    // average cost in cents-per-unit as decimal: weighted
    const prevNotional = (prevQty * prevCost) / SCALE;
    const newAvg = ((prevNotional + amountCents) * SCALE) / newQty;
    existing.quantity = formatDecimal(newQty);
    existing.averageCostCentsPerUnit = formatDecimal(newAvg);
    existing.updatedAt = this.iso();
  }

  private computeAveragePrice(orderId: string): string {
    const fills = this.store.fills.filter((f) => f.orderId === orderId);
    let qtySum = 0n;
    let notional = 0n;
    for (const f of fills) {
      const q = parseDecimal(f.quantity);
      const p = parseDecimal(f.price);
      qtySum += q;
      notional += q * p;
    }
    if (qtySum === 0n) {
      return '0';
    }
    return formatDecimal(notional / qtySum);
  }

  private schedule(
    type: ScheduledJob['type'],
    refId: string,
    delayMs: number,
    fromMs = this.clock.nowMs(),
  ): void {
    this.store.jobs.push({
      id: randomUUID(),
      type,
      runAtMs: fromMs + delayMs,
      refId,
      done: false,
    });
  }

  private emitWebhook(type: string, payload: Record<string, unknown>): void {
    const scenario = this.store.scenario;
    const enabled = scenario?.webhooksEnabled ?? this.webhooksEnabledDefault;
    if (!enabled) {
      return;
    }

    const dropped = this.consumeFailure('DROP_WEBHOOK');
    const malformed = this.consumeFailure('MALFORMED_WEBHOOK');
    const outOfOrder =
      scenario?.webhookOutOfOrder === true || this.consumeFailure('OUT_OF_ORDER_WEBHOOK');
    const duplicate = scenario?.webhookDuplicateDelivery === true;

    const externalAccountId = extractSimulatorExternalAccountId(payload);
    const providerEventId = buildSimulatorProviderEventId(type, payload);
    const body = malformed
      ? { broken: true, type, providerEventId, externalAccountId }
      : {
          type,
          data: payload,
          occurredAt: this.iso(),
          providerEventId,
          externalAccountId,
        };
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', this.webhookSigningSecret).update(raw).digest('hex');

    const deliverDelay = outOfOrder ? 5_000 : 0;
    const event = {
      id: randomUUID(),
      type,
      payload: body as Record<string, unknown>,
      createdAt: this.iso(),
      deliverAt: new Date(this.clock.nowMs() + deliverDelay).toISOString(),
      attempts: 0,
      delivered: false,
      dropped,
      signature: `sha256=${signature}`,
      malformed,
      externalAccountId,
    };
    this.store.webhooks.push(event);
    if (!dropped) {
      this.schedule('WEBHOOK_DELIVER', event.id, deliverDelay);
    }
    if (duplicate && !dropped) {
      const dup = { ...event, id: randomUUID() };
      this.store.webhooks.push(dup);
      this.schedule('WEBHOOK_DELIVER', dup.id, deliverDelay + 10);
    }
  }

  private async deliverWebhook(eventId: string): Promise<void> {
    const event = this.store.webhooks.find((w) => w.id === eventId);
    if (!event || event.dropped || event.delivered) {
      return;
    }
    event.attempts += 1;
    if (!this.webhookTargetUrl) {
      event.delivered = true;
      this.logger.info({ webhookType: event.type, eventId }, 'webhook retained (no target URL)');
      return;
    }
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-brokerage-sim-signature': event.signature,
      };
      if (event.externalAccountId) {
        headers['x-csm-external-account-id'] = event.externalAccountId;
      }
      const response = await fetch(this.webhookTargetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(event.payload),
      });
      if (!response.ok && event.attempts < 3) {
        event.delivered = false;
        this.schedule('WEBHOOK_DELIVER', event.id, 1_000 * event.attempts);
        return;
      }
      event.delivered = response.ok;
    } catch (error) {
      this.logger.warn({ err: error, eventId }, 'webhook delivery failed');
      if (event.attempts < 3) {
        this.schedule('WEBHOOK_DELIVER', event.id, 1_000 * event.attempts);
      }
    }
  }

  private maybeFail(op: string): void {
    if (this.consumeFailure('TIMEOUT_BEFORE_PROCESSING')) {
      throw new SimulatorHttpError(504, `Timeout before processing ${op}`);
    }
    if (this.consumeFailure('DUPLICATE_REQUEST')) {
      throw new SimulatorHttpError(409, `Duplicate request for ${op}`);
    }
    const scenario = this.store.scenario;
    if (
      scenario?.mode === 'demo' &&
      this.rng &&
      scenario.seededRandomFailureRate > 0 &&
      this.rng() < scenario.seededRandomFailureRate
    ) {
      throw new SimulatorHttpError(500, 'Seeded random failure');
    }
  }

  private consumeFailure(step: DeterministicFailureStep): boolean {
    const scenario = this.store.scenario;
    if (!scenario) {
      return false;
    }
    const next = scenario.deterministicFailureSteps[this.store.failureStepIndex];
    if (next === step) {
      this.store.failureStepIndex += 1;
      return true;
    }
    return false;
  }

  private persistIdempotency(
    scope: string,
    key: string,
    requestHash: string,
    statusCode: number,
    responseBody: unknown,
  ): void {
    this.store.idempotency.set(`${scope}:${key}`, {
      key,
      scope,
      requestHash,
      statusCode,
      responseBody,
      createdAt: this.iso(),
    });
  }

  private requireScenario(): BrokerageScenarioConfig {
    if (!this.store.scenario) {
      throw new SimulatorHttpError(
        400,
        'No scenario loaded. POST /sim/admin/brokerage/scenarios first.',
      );
    }
    return this.store.scenario;
  }

  private iso(): string {
    return this.clock.now().toISOString();
  }
}
