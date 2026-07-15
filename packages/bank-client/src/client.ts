import type { Logger } from '@csm/observability';
import { z } from 'zod';

import { ProviderClientError, isProviderClientError } from './errors.js';
import { ProviderHttpClient, type HttpClientOptions } from './http.js';
import {
  bankHealthSchema,
  providerAccountSchema,
  providerHelocAvailabilitySchema,
  providerHelocDrawSchema,
  providerInterestChargeSchema,
  providerInterestPaymentViewSchema,
  providerMortgagePaymentSchema,
  providerOrdinaryDebitSchema,
  providerTransactionSchema,
  providerTransferSchema,
  type ProviderHelocAvailability,
  type ProviderHelocDraw,
  type ProviderInterestPaymentView,
  type ProviderOrdinaryDebit,
  type ProviderTransfer,
} from './schemas.js';

export interface BankClientOptions extends HttpClientOptions {
  logger: Logger;
  baseUrl: string;
}

export interface HelocDrawInitiateInput {
  helocId: string;
  amountCents: bigint;
  idempotencyKey: string;
  correlationId: string;
}

export interface TransferInitiateInput {
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: bigint;
  idempotencyKey: string;
  correlationId: string;
}

const transactionsResponseSchema = z
  .object({
    transactions: z.array(providerTransactionSchema),
  })
  .strict();

const paymentsResponseSchema = z
  .object({
    payments: z.array(providerMortgagePaymentSchema),
  })
  .strict();

const chargesResponseSchema = z
  .object({
    charges: z.array(providerInterestChargeSchema),
  })
  .strict();

const ordinaryDebitsResponseSchema = z
  .object({
    debits: z.array(providerOrdinaryDebitSchema),
  })
  .strict();

const interestPaymentsResponseSchema = z
  .object({
    payments: z.array(providerInterestPaymentViewSchema),
  })
  .strict();

export class BankClient {
  private readonly http: ProviderHttpClient;

  constructor(options: BankClientOptions) {
    this.http = new ProviderHttpClient({ ...options, providerLabel: 'bank' });
  }

  async health(correlationId: string) {
    const { data } = await this.http.requestJson('GET', '/health', bankHealthSchema, {
      correlationId,
      operation: 'bank.health',
      safeToRetry: true,
    });
    return data;
  }

  async getAccount(accountId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/accounts/${accountId}`,
      providerAccountSchema,
      { correlationId, operation: 'bank.getAccount', safeToRetry: true },
    );
    return data;
  }

  async listAccountTransactions(accountId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/accounts/${accountId}/transactions`,
      transactionsResponseSchema,
      { correlationId, operation: 'bank.listAccountTransactions', safeToRetry: true },
    );
    return data.transactions;
  }

  async listMortgagePayments(mortgageId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/mortgages/${mortgageId}/payments`,
      paymentsResponseSchema,
      { correlationId, operation: 'bank.listMortgagePayments', safeToRetry: true },
    );
    return data.payments;
  }

  async getHelocAvailability(
    helocId: string,
    correlationId: string,
  ): Promise<ProviderHelocAvailability> {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/helocs/${helocId}/availability`,
      providerHelocAvailabilitySchema,
      { correlationId, operation: 'bank.getHelocAvailability', safeToRetry: true },
    );
    return data;
  }

  async listInterestCharges(helocId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/helocs/${helocId}/interest-charges`,
      chargesResponseSchema,
      { correlationId, operation: 'bank.listInterestCharges', safeToRetry: true },
    );
    return data.charges;
  }

  /**
   * Financial POST — never auto-retried.
   * On timeout throws AMBIGUOUS_RESULT; use resolveAmbiguousHelocDraw.
   */
  async initiateHelocDraw(input: HelocDrawInitiateInput): Promise<ProviderHelocDraw> {
    const { data } = await this.http.requestJson(
      'POST',
      `/bank/helocs/${input.helocId}/draws`,
      providerHelocDrawSchema,
      {
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        operation: 'bank.initiateHelocDraw',
        financialMutation: true,
      },
      {
        amountCents: input.amountCents.toString(),
        idempotencyKey: input.idempotencyKey,
      },
    );
    return data;
  }

  async getHelocDraw(helocId: string, drawId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/helocs/${helocId}/draws/${drawId}`,
      providerHelocDrawSchema,
      { correlationId, operation: 'bank.getHelocDraw', safeToRetry: true },
    );
    return data;
  }

  async findHelocDrawByIdempotencyKey(
    helocId: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<ProviderHelocDraw> {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/helocs/${helocId}/draws/by-idempotency-key?key=${encodeURIComponent(idempotencyKey)}`,
      providerHelocDrawSchema,
      { correlationId, operation: 'bank.findHelocDrawByIdempotencyKey', safeToRetry: true },
    );
    return data;
  }

  /**
   * Resolve an ambiguous draw POST by looking up the idempotency key.
   * Does not re-POST. Throws AMBIGUOUS_RESULT if still not found.
   */
  async resolveAmbiguousHelocDraw(input: {
    helocId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderHelocDraw> {
    try {
      return await this.findHelocDrawByIdempotencyKey(
        input.helocId,
        input.idempotencyKey,
        input.correlationId,
      );
    } catch (error) {
      if (isProviderClientError(error) && error.statusCode === 404) {
        throw new ProviderClientError({
          kind: 'AMBIGUOUS_RESULT',
          message:
            'Heloc draw still unresolved after ambiguous POST; provider has no matching idempotency key yet',
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          operation: 'bank.resolveAmbiguousHelocDraw',
          cause: error,
        });
      }
      throw error;
    }
  }

  async initiateTransfer(input: TransferInitiateInput): Promise<ProviderTransfer> {
    const { data } = await this.http.requestJson(
      'POST',
      '/bank/transfers',
      providerTransferSchema,
      {
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        operation: 'bank.initiateTransfer',
        financialMutation: true,
      },
      {
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
        amountCents: input.amountCents.toString(),
        idempotencyKey: input.idempotencyKey,
      },
    );
    return data;
  }

  async getTransfer(transferId: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/transfers/${transferId}`,
      providerTransferSchema,
      { correlationId, operation: 'bank.getTransfer', safeToRetry: true },
    );
    return data;
  }

  async findTransferByIdempotencyKey(idempotencyKey: string, correlationId: string) {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/transfers/by-idempotency-key?key=${encodeURIComponent(idempotencyKey)}`,
      providerTransferSchema,
      { correlationId, operation: 'bank.findTransferByIdempotencyKey', safeToRetry: true },
    );
    return data;
  }

  async resolveAmbiguousTransfer(input: {
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderTransfer> {
    try {
      return await this.findTransferByIdempotencyKey(input.idempotencyKey, input.correlationId);
    } catch (error) {
      if (isProviderClientError(error) && error.statusCode === 404) {
        throw new ProviderClientError({
          kind: 'AMBIGUOUS_RESULT',
          message:
            'Transfer still unresolved after ambiguous POST; provider has no matching idempotency key yet',
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          operation: 'bank.resolveAmbiguousTransfer',
          cause: error,
        });
      }
      throw error;
    }
  }

  async getOrdinaryDebit(
    accountId: string,
    debitId: string,
    correlationId: string,
  ): Promise<ProviderOrdinaryDebit> {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/ordinary-accounts/${accountId}/debits/${debitId}`,
      providerOrdinaryDebitSchema,
      { correlationId, operation: 'bank.getOrdinaryDebit', safeToRetry: true },
    );
    return data;
  }

  async listOrdinaryDebits(
    accountId: string,
    correlationId: string,
  ): Promise<ProviderOrdinaryDebit[]> {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/ordinary-accounts/${accountId}/debits`,
      ordinaryDebitsResponseSchema,
      { correlationId, operation: 'bank.listOrdinaryDebits', safeToRetry: true },
    );
    return data.debits;
  }

  async listInterestPayments(
    helocId: string,
    correlationId: string,
  ): Promise<ProviderInterestPaymentView[]> {
    const { data } = await this.http.requestJson(
      'GET',
      `/bank/helocs/${helocId}/interest-payments`,
      interestPaymentsResponseSchema,
      { correlationId, operation: 'bank.listInterestPayments', safeToRetry: true },
    );
    return data.payments;
  }
}
