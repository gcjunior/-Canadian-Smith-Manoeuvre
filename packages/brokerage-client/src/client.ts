import type { Logger } from '@csm/observability';
import { z } from 'zod';

import { ProviderClientError, isProviderClientError } from './errors.js';
import { ProviderHttpClient, type HttpClientOptions } from './http.js';
import {
  brokerageHealthSchema,
  providerBrokerageAccountSchema,
  providerCashSchema,
  providerDepositSchema,
  providerOrderSchema,
  providerPositionSchema,
  type ProviderDeposit,
  type ProviderOrder,
} from './schemas.js';

export interface BrokerageClientOptions extends HttpClientOptions {
  logger: Logger;
  baseUrl: string;
}

export interface DepositInitiateInput {
  accountId: string;
  amountCents: bigint;
  idempotencyKey: string;
  correlationId: string;
}

export interface OrderSubmitInput {
  accountId: string;
  symbol: string;
  side: 'BUY';
  notionalCents: bigint;
  idempotencyKey: string;
  correlationId: string;
}

const positionsResponseSchema = z
  .object({
    positions: z.array(providerPositionSchema),
  })
  .strict();

export class BrokerageClient {
  private readonly http: ProviderHttpClient;

  constructor(options: BrokerageClientOptions) {
    this.http = new ProviderHttpClient({ ...options, providerLabel: 'brokerage' });
  }

  async health(correlationId: string) {
    const { data } = await this.http.requestJson('GET', '/health', brokerageHealthSchema, {
      correlationId,
      operation: 'brokerage.health',
      safeToRetry: true,
    });
    return data;
  }

  async getAccount(accountId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/brokerage/accounts/${accountId}`,
      providerBrokerageAccountSchema,
      { correlationId, operation: 'brokerage.getAccount', safeToRetry: true },
    );
    return data;
  }

  async getCash(accountId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/brokerage/accounts/${accountId}/cash`,
      providerCashSchema,
      { correlationId, operation: 'brokerage.getCash', safeToRetry: true },
    );
    return data;
  }

  async listPositions(accountId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/brokerage/accounts/${accountId}/positions`,
      positionsResponseSchema,
      { correlationId, operation: 'brokerage.listPositions', safeToRetry: true },
    );
    return data.positions;
  }

  async initiateDeposit(input: DepositInitiateInput): Promise<ProviderDeposit> {
    const { data } = await this.http.requestJson(
      'POST',
      '/brokerage/deposits',
      providerDepositSchema,
      {
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        operation: 'brokerage.initiateDeposit',
        financialMutation: true,
      },
      {
        accountId: input.accountId,
        amountCents: input.amountCents.toString(),
        idempotencyKey: input.idempotencyKey,
      },
    );
    return data;
  }

  async getDeposit(depositId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/brokerage/deposits/${depositId}`,
      providerDepositSchema,
      { correlationId, operation: 'brokerage.getDeposit', safeToRetry: true },
    );
    return data;
  }

  async findDepositByIdempotencyKey(idempotencyKey: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/brokerage/deposits/by-idempotency-key?key=${encodeURIComponent(idempotencyKey)}`,
      providerDepositSchema,
      { correlationId, operation: 'brokerage.findDepositByIdempotencyKey', safeToRetry: true },
    );
    return data;
  }

  async resolveAmbiguousDeposit(input: {
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderDeposit> {
    try {
      return await this.findDepositByIdempotencyKey(input.idempotencyKey, input.correlationId);
    } catch (error) {
      if (isProviderClientError(error) && error.statusCode === 404) {
        throw new ProviderClientError({
          kind: 'AMBIGUOUS_RESULT',
          message:
            'Deposit still unresolved after ambiguous POST; provider has no matching idempotency key yet',
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          operation: 'brokerage.resolveAmbiguousDeposit',
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Financial POST — never auto-retried.
   * On timeout throws AMBIGUOUS_RESULT; use resolveAmbiguousOrder.
   */
  async submitOrder(input: OrderSubmitInput): Promise<ProviderOrder> {
    const { data } = await this.http.requestJson(
      'POST',
      '/brokerage/orders',
      providerOrderSchema,
      {
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        operation: 'brokerage.submitOrder',
        financialMutation: true,
      },
      {
        accountId: input.accountId,
        symbol: input.symbol,
        side: input.side,
        notionalCents: input.notionalCents.toString(),
        idempotencyKey: input.idempotencyKey,
      },
    );
    return data;
  }

  async getOrder(orderId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/brokerage/orders/${orderId}`,
      providerOrderSchema,
      { correlationId, operation: 'brokerage.getOrder', safeToRetry: true },
    );
    return data;
  }

  async findOrderByIdempotencyKey(idempotencyKey: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/brokerage/orders/by-idempotency-key?key=${encodeURIComponent(idempotencyKey)}`,
      providerOrderSchema,
      { correlationId, operation: 'brokerage.findOrderByIdempotencyKey', safeToRetry: true },
    );
    return data;
  }

  async resolveAmbiguousOrder(input: {
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderOrder> {
    try {
      return await this.findOrderByIdempotencyKey(input.idempotencyKey, input.correlationId);
    } catch (error) {
      if (isProviderClientError(error) && error.statusCode === 404) {
        throw new ProviderClientError({
          kind: 'AMBIGUOUS_RESULT',
          message:
            'Order still unresolved after ambiguous POST; provider has no matching idempotency key yet',
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          operation: 'brokerage.resolveAmbiguousOrder',
          cause: error,
        });
      }
      throw error;
    }
  }
}
