import type {
  ProviderHelocAvailability,
  ProviderHelocDraw,
  ProviderInterestPaymentView,
  ProviderOrdinaryDebit,
  ProviderTransfer,
} from './schemas.js';
import { ProviderClientError } from './errors.js';

/** In-memory bank provider for unit tests — no network. */
export class FakeBankClient {
  draws = new Map<string, ProviderHelocDraw>();
  transfers = new Map<string, ProviderTransfer>();
  availability = new Map<string, ProviderHelocAvailability>();
  mortgagePayments = new Map<
    string,
    Array<{
      id: string;
      mortgageId: string;
      providerPaymentId: string;
      paymentPeriod: string;
      state: 'SCHEDULED' | 'POSTED' | 'SETTLED' | 'REVERSED';
      totalAmountCents: bigint;
      principalAmountCents: bigint;
      interestAmountCents: bigint;
      scheduledAt: string;
      postedAt: string | null;
      settledAt: string | null;
      reversedAt: string | null;
    }>
  >();
  interestCharges = new Map<
    string,
    Array<{
      id: string;
      helocId: string;
      providerChargeId: string;
      interestPeriod: string;
      amountCents: bigint;
      state: string;
      postedAt: string | null;
      createdAt: string;
    }>
  >();
  /** Joined interest payment views keyed by helocId. */
  interestPayments = new Map<string, ProviderInterestPaymentView[]>();
  ordinaryDebits = new Map<string, ProviderOrdinaryDebit>();
  failNextDrawWith?: ProviderClientError | undefined;
  failNextTransferWith?: ProviderClientError | undefined;

  async health(correlationId: string) {
    return {
      status: 'ok',
      service: 'fake-bank',
      correlationId,
      simulator: 'bank-mortgage-heloc',
    };
  }

  async listMortgagePayments(mortgageId: string, _correlationId: string) {
    return this.mortgagePayments.get(mortgageId) ?? [];
  }

  async listInterestCharges(helocId: string, _correlationId: string) {
    return this.interestCharges.get(helocId) ?? [];
  }

  async getOrdinaryDebit(accountId: string, debitId: string, correlationId: string) {
    const debit = this.ordinaryDebits.get(debitId);
    if (!debit || debit.accountId !== accountId) {
      throw new ProviderClientError({
        kind: 'BUSINESS_REJECTION',
        message: 'Debit not found',
        statusCode: 404,
        correlationId,
        operation: 'fake.getOrdinaryDebit',
      });
    }
    return debit;
  }

  async listOrdinaryDebits(accountId: string, _correlationId: string) {
    return [...this.ordinaryDebits.values()].filter((d) => d.accountId === accountId);
  }

  async listInterestPayments(helocId: string, _correlationId: string) {
    return this.interestPayments.get(helocId) ?? [];
  }

  async getHelocAvailability(helocId: string, _correlationId: string) {
    const value = this.availability.get(helocId);
    if (!value) {
      throw new ProviderClientError({
        kind: 'BUSINESS_REJECTION',
        message: 'HELOC not found',
        statusCode: 404,
        operation: 'fake.getHelocAvailability',
      });
    }
    return value;
  }

  async initiateHelocDraw(input: {
    helocId: string;
    amountCents: bigint;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderHelocDraw> {
    if (this.failNextDrawWith) {
      const err = this.failNextDrawWith;
      this.failNextDrawWith = undefined;
      throw err;
    }
    const existing = [...this.draws.values()].find(
      (d) => d.helocId === input.helocId && d.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (existing.amountCents !== input.amountCents) {
        throw new ProviderClientError({
          kind: 'DUPLICATE_CONFLICT',
          message: 'Idempotency key reused with different payload',
          statusCode: 409,
          correlationId: input.correlationId,
          operation: 'fake.initiateHelocDraw',
        });
      }
      return existing;
    }
    const draw: ProviderHelocDraw = {
      id: crypto.randomUUID(),
      helocId: input.helocId,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      state: 'PENDING',
      providerTransactionId: `draw_${crypto.randomUUID()}`,
      requestedAt: new Date().toISOString(),
      settledAt: null,
      failureCode: null,
    };
    this.draws.set(draw.id, draw);
    return draw;
  }

  async getHelocDraw(helocId: string, drawId: string, correlationId: string) {
    const draw = [...this.draws.values()].find(
      (d) => d.helocId === helocId && (d.id === drawId || d.providerTransactionId === drawId),
    );
    if (!draw) {
      throw new ProviderClientError({
        kind: 'BUSINESS_REJECTION',
        message: 'Draw not found',
        statusCode: 404,
        correlationId,
        operation: 'fake.getHelocDraw',
      });
    }
    return draw;
  }

  async findHelocDrawByIdempotencyKey(
    helocId: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<ProviderHelocDraw> {
    const draw = [...this.draws.values()].find(
      (d) => d.helocId === helocId && d.idempotencyKey === idempotencyKey,
    );
    if (!draw) {
      throw new ProviderClientError({
        kind: 'BUSINESS_REJECTION',
        message: 'Draw not found',
        statusCode: 404,
        correlationId,
        operation: 'fake.findHelocDrawByIdempotencyKey',
      });
    }
    return draw;
  }

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
      if (error instanceof ProviderClientError && error.statusCode === 404) {
        throw new ProviderClientError({
          kind: 'AMBIGUOUS_RESULT',
          message: 'Heloc draw still unresolved',
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          operation: 'fake.resolveAmbiguousHelocDraw',
        });
      }
      throw error;
    }
  }

  settleDraw(idempotencyKey: string): void {
    for (const draw of this.draws.values()) {
      if (draw.idempotencyKey === idempotencyKey) {
        draw.state = 'SETTLED';
        draw.settledAt = new Date().toISOString();
      }
    }
  }

  async initiateTransfer(input: {
    sourceAccountId: string;
    destinationAccountId: string;
    amountCents: bigint;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderTransfer> {
    if (this.failNextTransferWith) {
      const err = this.failNextTransferWith;
      this.failNextTransferWith = undefined;
      throw err;
    }
    const existing = [...this.transfers.values()].find(
      (t) => t.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (existing.amountCents !== input.amountCents) {
        throw new ProviderClientError({
          kind: 'DUPLICATE_CONFLICT',
          message: 'Idempotency key reused with different payload',
          statusCode: 409,
          correlationId: input.correlationId,
          operation: 'fake.initiateTransfer',
        });
      }
      return existing;
    }
    const transfer: ProviderTransfer = {
      id: crypto.randomUUID(),
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      state: 'PENDING',
      providerTransactionId: `xfer_${crypto.randomUUID()}`,
      requestedAt: new Date().toISOString(),
      settledAt: null,
      failureCode: null,
    };
    this.transfers.set(transfer.id, transfer);
    return transfer;
  }

  async getTransfer(transferId: string, correlationId: string) {
    const transfer =
      this.transfers.get(transferId) ??
      [...this.transfers.values()].find((t) => t.providerTransactionId === transferId);
    if (!transfer) {
      throw new ProviderClientError({
        kind: 'BUSINESS_REJECTION',
        message: 'Transfer not found',
        statusCode: 404,
        correlationId,
        operation: 'fake.getTransfer',
      });
    }
    return transfer;
  }

  async findTransferByIdempotencyKey(idempotencyKey: string, correlationId: string) {
    const transfer = [...this.transfers.values()].find((t) => t.idempotencyKey === idempotencyKey);
    if (!transfer) {
      throw new ProviderClientError({
        kind: 'BUSINESS_REJECTION',
        message: 'Transfer not found',
        statusCode: 404,
        correlationId,
        operation: 'fake.findTransferByIdempotencyKey',
      });
    }
    return transfer;
  }

  async resolveAmbiguousTransfer(input: {
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ProviderTransfer> {
    try {
      return await this.findTransferByIdempotencyKey(input.idempotencyKey, input.correlationId);
    } catch (error) {
      if (error instanceof ProviderClientError && error.statusCode === 404) {
        throw new ProviderClientError({
          kind: 'AMBIGUOUS_RESULT',
          message: 'Transfer still unresolved',
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          operation: 'fake.resolveAmbiguousTransfer',
        });
      }
      throw error;
    }
  }

  settleTransfer(idempotencyKey: string): void {
    for (const transfer of this.transfers.values()) {
      if (transfer.idempotencyKey === idempotencyKey) {
        transfer.state = 'SETTLED';
        transfer.settledAt = new Date().toISOString();
      }
    }
  }
}
