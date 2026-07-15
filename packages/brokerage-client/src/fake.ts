import { ProviderClientError } from './errors.js';
import type { ProviderCash, ProviderDeposit, ProviderOrder } from './schemas.js';

/** In-memory brokerage provider for unit tests — no network. */
export class FakeBrokerageClient {
  deposits = new Map<string, ProviderDeposit>();
  orders = new Map<string, ProviderOrder>();
  cash = new Map<string, ProviderCash>();
  failNextOrderWith?: ProviderClientError | undefined;
  failNextDepositWith?: ProviderClientError | undefined;

  async health(correlationId: string) {
    return {
      status: 'ok',
      service: 'fake-brokerage',
      correlationId,
      simulator: 'brokerage',
    };
  }

  async getCash(accountId: string, _correlationId: string): Promise<ProviderCash> {
    const value = this.cash.get(accountId);
    if (!value) {
      return {
        accountId,
        currencyCode: 'CAD',
        settledCashCents: 0n,
        pendingCashCents: 0n,
        availableCashCents: 0n,
        restricted: false,
        observedAt: new Date().toISOString(),
      };
    }
    return value;
  }

  async initiateDeposit(input: {
    accountId: string;
    amountCents: bigint;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderDeposit> {
    if (this.failNextDepositWith) {
      const err = this.failNextDepositWith;
      this.failNextDepositWith = undefined;
      throw err;
    }
    const existing = [...this.deposits.values()].find(
      (d) => d.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (existing.amountCents !== input.amountCents) {
        throw new ProviderClientError({
          kind: 'DUPLICATE_CONFLICT',
          message: 'Idempotency key reused with different payload',
          statusCode: 409,
          correlationId: input.correlationId,
          operation: 'fake.initiateDeposit',
        });
      }
      return existing;
    }
    const deposit: ProviderDeposit = {
      id: crypto.randomUUID(),
      accountId: input.accountId,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      state: 'PENDING',
      providerDepositId: `dep_${crypto.randomUUID()}`,
      requestedAt: new Date().toISOString(),
      settledAt: null,
      failureCode: null,
    };
    this.deposits.set(deposit.id, deposit);
    return deposit;
  }

  async getDeposit(depositId: string, correlationId: string) {
    const deposit =
      this.deposits.get(depositId) ??
      [...this.deposits.values()].find((d) => d.providerDepositId === depositId);
    if (!deposit) {
      throw new ProviderClientError({
        kind: 'BUSINESS_REJECTION',
        message: 'Deposit not found',
        statusCode: 404,
        correlationId,
        operation: 'fake.getDeposit',
      });
    }
    return deposit;
  }

  async findDepositByIdempotencyKey(idempotencyKey: string, correlationId: string) {
    const deposit = [...this.deposits.values()].find((d) => d.idempotencyKey === idempotencyKey);
    if (!deposit) {
      throw new ProviderClientError({
        kind: 'BUSINESS_REJECTION',
        message: 'Deposit not found',
        statusCode: 404,
        correlationId,
        operation: 'fake.findDepositByIdempotencyKey',
      });
    }
    return deposit;
  }

  async resolveAmbiguousDeposit(input: {
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderDeposit> {
    try {
      return await this.findDepositByIdempotencyKey(input.idempotencyKey, input.correlationId);
    } catch (error) {
      if (error instanceof ProviderClientError && error.statusCode === 404) {
        throw new ProviderClientError({
          kind: 'AMBIGUOUS_RESULT',
          message: 'Deposit still unresolved',
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          operation: 'fake.resolveAmbiguousDeposit',
        });
      }
      throw error;
    }
  }

  settleDeposit(idempotencyKey: string): void {
    for (const deposit of this.deposits.values()) {
      if (deposit.idempotencyKey === idempotencyKey) {
        deposit.state = 'SETTLED';
        deposit.settledAt = new Date().toISOString();
        const cash = this.cash.get(deposit.accountId) ?? {
          accountId: deposit.accountId,
          currencyCode: 'CAD' as const,
          settledCashCents: 0n,
          pendingCashCents: 0n,
          availableCashCents: 0n,
          restricted: false,
          observedAt: new Date().toISOString(),
        };
        cash.settledCashCents += deposit.amountCents;
        cash.availableCashCents += deposit.amountCents;
        cash.observedAt = new Date().toISOString();
        this.cash.set(deposit.accountId, cash);
      }
    }
  }

  async submitOrder(input: {
    accountId: string;
    symbol: string;
    side: 'BUY';
    notionalCents: bigint;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderOrder> {
    if (this.failNextOrderWith) {
      const err = this.failNextOrderWith;
      this.failNextOrderWith = undefined;
      throw err;
    }
    const existing = [...this.orders.values()].find(
      (o) => o.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (existing.notionalCents !== input.notionalCents) {
        throw new ProviderClientError({
          kind: 'DUPLICATE_CONFLICT',
          message: 'Idempotency key reused with different payload',
          statusCode: 409,
          correlationId: input.correlationId,
          operation: 'fake.submitOrder',
        });
      }
      return existing;
    }
    const order: ProviderOrder = {
      id: crypto.randomUUID(),
      accountId: input.accountId,
      symbol: input.symbol,
      side: 'BUY',
      notionalCents: input.notionalCents,
      quantity: '10',
      filledQuantity: '0',
      limitPrice: null,
      averageFillPrice: null,
      idempotencyKey: input.idempotencyKey,
      state: 'CREATED',
      providerOrderId: `ord_${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      submittedAt: null,
      filledAt: null,
      failureCode: null,
      commissionCents: 0n,
    };
    this.orders.set(order.id, order);
    return order;
  }

  async getOrder(orderId: string, correlationId: string) {
    const order =
      this.orders.get(orderId) ??
      [...this.orders.values()].find((o) => o.providerOrderId === orderId);
    if (!order) {
      throw new ProviderClientError({
        kind: 'BUSINESS_REJECTION',
        message: 'Order not found',
        statusCode: 404,
        correlationId,
        operation: 'fake.getOrder',
      });
    }
    return order;
  }

  async findOrderByIdempotencyKey(idempotencyKey: string, correlationId: string) {
    const order = [...this.orders.values()].find((o) => o.idempotencyKey === idempotencyKey);
    if (!order) {
      throw new ProviderClientError({
        kind: 'BUSINESS_REJECTION',
        message: 'Order not found',
        statusCode: 404,
        correlationId,
        operation: 'fake.findOrderByIdempotencyKey',
      });
    }
    return order;
  }

  async resolveAmbiguousOrder(input: {
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderOrder> {
    try {
      return await this.findOrderByIdempotencyKey(input.idempotencyKey, input.correlationId);
    } catch (error) {
      if (error instanceof ProviderClientError && error.statusCode === 404) {
        throw new ProviderClientError({
          kind: 'AMBIGUOUS_RESULT',
          message: 'Order still unresolved',
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          operation: 'fake.resolveAmbiguousOrder',
        });
      }
      throw error;
    }
  }

  fillOrder(idempotencyKey: string): void {
    for (const order of this.orders.values()) {
      if (order.idempotencyKey === idempotencyKey) {
        order.state = 'FILLED';
        order.submittedAt = order.submittedAt ?? new Date().toISOString();
        order.filledAt = new Date().toISOString();
        order.filledQuantity = order.quantity ?? '1';
        const cash = this.cash.get(order.accountId);
        if (cash) {
          cash.settledCashCents -= order.notionalCents;
          cash.availableCashCents -= order.notionalCents;
          cash.observedAt = new Date().toISOString();
        }
      }
    }
  }
}
