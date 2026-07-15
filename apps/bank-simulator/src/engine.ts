import { createHash, createHmac, randomUUID } from 'node:crypto';

import type { Logger } from '@csm/observability';

import type { Clock } from './clock.js';
import { createSeededRng } from './rng.js';
import type { BankScenarioConfig, DeterministicFailureStep } from './scenario/schema.js';
import { type BankSimulatorStore } from './store.js';
import type {
  BankTransfer,
  HelocDraw,
  InterestCharge,
  InterestPaymentView,
  MortgagePayment,
  ScheduledJob,
  SimAccount,
  SimHeloc,
  SimMortgage,
  SimUser,
} from './types.js';

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

export interface BankSimulatorDeps {
  clock: Clock;
  store: BankSimulatorStore;
  logger: Logger;
  webhookSigningSecret: string;
  webhookTargetUrl?: string;
  webhooksEnabledDefault: boolean;
}

function hashRequest(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function extractSimulatorExternalAccountId(payload: Record<string, unknown>): string {
  for (const key of [
    'mortgageId',
    'helocId',
    'accountId',
    'debitAccountId',
    'sourceAccountId',
    'externalAccountId',
  ]) {
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

export class BankSimulatorEngine {
  private readonly clock: Clock;
  private readonly store: BankSimulatorStore;
  private readonly logger: Logger;
  private readonly webhookSigningSecret: string;
  private readonly webhookTargetUrl: string | undefined;
  private readonly webhooksEnabledDefault: boolean;
  private rng: (() => number) | null = null;

  constructor(deps: BankSimulatorDeps) {
    this.clock = deps.clock;
    this.store = deps.store;
    this.logger = deps.logger;
    this.webhookSigningSecret = deps.webhookSigningSecret;
    this.webhookTargetUrl = deps.webhookTargetUrl;
    this.webhooksEnabledDefault = deps.webhooksEnabledDefault;
  }

  getStore(): BankSimulatorStore {
    return this.store;
  }

  getClock(): Clock {
    return this.clock;
  }

  reset(): void {
    this.store.reset();
    this.rng = null;
  }

  loadScenario(config: BankScenarioConfig): BankScenarioConfig {
    this.store.reset();
    this.store.scenario = config;
    this.rng = config.seed !== undefined ? createSeededRng(config.seed) : null;
    if (config.deterministicFailureSteps.includes('STALE_AVAILABILITY')) {
      this.store.staleAvailabilityUntilMs = this.clock.nowMs() + 60_000;
    }
    return config;
  }

  createUser(input: { externalUserId: string; displayName: string }): SimUser {
    const user: SimUser = {
      id: randomUUID(),
      externalUserId: input.externalUserId,
      displayName: input.displayName,
      createdAt: this.iso(),
    };
    this.store.users.set(user.id, user);
    return user;
  }

  createAccount(input: {
    userId: string;
    kind: SimAccount['kind'];
    displayAlias: string;
    providerAccountId: string;
    /** Optional fixed account UUID — used to align bank rails with brokerage account IDs. */
    id?: string;
    balanceCents?: bigint;
    mortgage?: { outstandingPrincipalCents: bigint; expectedPaymentDay: number };
    heloc?: {
      creditLimitCents: bigint;
      balanceOwedCents: bigint;
      existingAvailableCreditCents: bigint;
    };
  }): {
    account: SimAccount;
    mortgage?: SimMortgage;
    heloc?: SimHeloc;
  } {
    if (!this.store.users.has(input.userId)) {
      throw new SimulatorHttpError(404, 'User not found');
    }
    const scenario = this.requireScenario();
    const accountId = input.id ?? randomUUID();
    if (this.store.accounts.has(accountId)) {
      throw new SimulatorHttpError(409, 'Account id already exists');
    }
    const account: SimAccount = {
      id: accountId,
      userId: input.userId,
      kind: input.kind,
      displayAlias: input.displayAlias,
      providerAccountId: input.providerAccountId,
      currencyCode: 'CAD',
      balanceCents:
        input.balanceCents ??
        (input.kind === 'ORDINARY' ? scenario.initialBalances.ordinaryBankBalanceCents : 0n),
      createdAt: this.iso(),
    };
    this.store.accounts.set(account.id, account);

    let mortgage: SimMortgage | undefined;
    let heloc: SimHeloc | undefined;

    if (input.kind === 'MORTGAGE') {
      mortgage = {
        id: randomUUID(),
        accountId: account.id,
        outstandingPrincipalCents:
          input.mortgage?.outstandingPrincipalCents ??
          scenario.initialBalances.mortgagePrincipalCents,
        expectedPaymentDay: input.mortgage?.expectedPaymentDay ?? 1,
      };
      this.store.mortgages.set(mortgage.id, mortgage);
    }

    if (input.kind === 'HELOC') {
      heloc = {
        id: randomUUID(),
        accountId: account.id,
        creditLimitCents:
          input.heloc?.creditLimitCents ?? scenario.initialBalances.helocCreditLimitCents,
        balanceOwedCents:
          input.heloc?.balanceOwedCents ?? scenario.initialBalances.helocBalanceOwedCents,
        existingAvailableCreditCents:
          input.heloc?.existingAvailableCreditCents ??
          scenario.initialBalances.helocExistingAvailableCreditCents,
        newlyAvailableCreditCents: 0n,
      };
      this.store.helocs.set(heloc.id, heloc);
    }

    return {
      account,
      ...(mortgage ? { mortgage } : {}),
      ...(heloc ? { heloc } : {}),
    };
  }

  /** Advance clock and process due jobs. */
  runEvents(advanceMs = 0): { advancedMs: number; jobsProcessed: number; now: string } {
    if (advanceMs > 0) {
      this.clock.advance(advanceMs);
    }
    let jobsProcessed = 0;
    // Process in waves until quiescent at current time
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

  scheduleMortgagePayment(input: {
    mortgageId: string;
    paymentPeriod: string;
    totalAmountCents: bigint;
    principalAmountCents: bigint;
    interestAmountCents: bigint;
  }): MortgagePayment {
    const scenario = this.requireScenario();
    this.maybeFail('scheduleMortgage');
    const mortgage = this.requireMortgage(input.mortgageId);

    const payment: MortgagePayment = {
      id: randomUUID(),
      mortgageId: mortgage.id,
      providerPaymentId: `pay_${randomUUID()}`,
      paymentPeriod: input.paymentPeriod,
      totalAmountCents: input.totalAmountCents,
      principalAmountCents: input.principalAmountCents,
      interestAmountCents: input.interestAmountCents,
      state: 'SCHEDULED',
      scheduledAt: this.iso(),
      postedAt: null,
      settledAt: null,
      reversedAt: null,
    };
    this.store.payments.set(payment.id, payment);
    this.schedule('MORTGAGE_POST', payment.id, scenario.mortgagePostingDelayMs);
    this.emitWebhook('mortgage.payment.updated', this.paymentPayload(payment));
    return payment;
  }

  listMortgagePayments(mortgageIdOrAccountId: string): MortgagePayment[] {
    const mortgage = this.requireMortgage(mortgageIdOrAccountId);
    return [...this.store.payments.values()].filter((p) => p.mortgageId === mortgage.id);
  }

  getHelocAvailability(helocId: string): {
    helocId: string;
    availableCreditCents: string;
    existingAvailableCreditCents: string;
    newlyAvailableCreditCents: string;
    creditLimitCents: string;
    balanceOwedCents: string;
    observedAt: string;
    stale: boolean;
  } {
    const heloc = this.requireHeloc(helocId);
    const stale = this.clock.nowMs() < this.store.staleAvailabilityUntilMs;
    const available = heloc.existingAvailableCreditCents + heloc.newlyAvailableCreditCents;
    return {
      helocId,
      availableCreditCents: moneyJson(stale ? heloc.existingAvailableCreditCents : available),
      existingAvailableCreditCents: moneyJson(heloc.existingAvailableCreditCents),
      newlyAvailableCreditCents: moneyJson(stale ? 0n : heloc.newlyAvailableCreditCents),
      creditLimitCents: moneyJson(heloc.creditLimitCents),
      balanceOwedCents: moneyJson(heloc.balanceOwedCents),
      observedAt: this.iso(),
      stale,
    };
  }

  listInterestCharges(helocIdOrAccountId: string): InterestCharge[] {
    const heloc = this.requireHeloc(helocIdOrAccountId);
    return [...this.store.interestCharges.values()].filter((c) => c.helocId === heloc.id);
  }

  createHelocDraw(
    helocIdOrAccountId: string,
    input: { amountCents: bigint; idempotencyKey: string },
  ): { statusCode: number; body: unknown } {
    const scenario = this.requireScenario();
    const heloc = this.requireHeloc(helocIdOrAccountId);
    const facilityId = heloc.id;
    const scope = 'heloc.draw';
    const requestHash = hashRequest({
      helocId: facilityId,
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

    this.maybeFail('draw');

    const available = heloc.existingAvailableCreditCents + heloc.newlyAvailableCreditCents;

    const rejectedCode = this.consumeFailure('HELOC_BLOCKED')
      ? 'HELOC_BLOCKED'
      : this.consumeFailure('HELOC_DELINQUENT')
        ? 'HELOC_DELINQUENT'
        : this.consumeFailure('DRAW_REJECTED')
          ? 'DRAW_REJECTED'
          : this.consumeFailure('INSUFFICIENT_HELOC_CREDIT') || input.amountCents > available
            ? 'INSUFFICIENT_HELOC_CREDIT'
            : null;

    if (rejectedCode) {
      const failed: HelocDraw = {
        id: randomUUID(),
        helocId: facilityId,
        amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey,
        state: 'FAILED',
        providerTransactionId: `draw_${randomUUID()}`,
        requestedAt: this.iso(),
        settledAt: null,
        failureCode: rejectedCode,
        requestHash,
      };
      this.store.draws.set(failed.id, failed);
      const body = this.drawPayload(failed);
      this.persistIdempotency(scope, input.idempotencyKey, requestHash, 422, body);
      this.emitWebhook('heloc.draw.updated', body);
      return { statusCode: 422, body };
    }

    const draw: HelocDraw = {
      id: randomUUID(),
      helocId: facilityId,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      state: 'REQUESTED',
      providerTransactionId: `draw_${randomUUID()}`,
      requestedAt: this.iso(),
      settledAt: null,
      failureCode: null,
      requestHash,
    };
    this.store.draws.set(draw.id, draw);
    draw.state = 'PENDING';
    const delay = this.consumeFailure('DELAYED_SETTLEMENT')
      ? scenario.drawSettlementDelayMs + 86_400_000
      : scenario.drawSettlementDelayMs;
    this.schedule('DRAW_SETTLE', draw.id, delay);
    const body = this.drawPayload(draw);
    this.persistIdempotency(scope, input.idempotencyKey, requestHash, 202, body);
    this.emitWebhook('heloc.draw.updated', body);

    if (this.consumeFailure('TIMEOUT_AFTER_SUCCESS')) {
      throw new SimulatorHttpError(504, 'Gateway timeout after processing', {
        processed: true,
        drawId: draw.id,
      });
    }

    return { statusCode: 202, body };
  }

  getDraw(helocIdOrAccountId: string, drawId: string): HelocDraw {
    const facilityId = this.requireHeloc(helocIdOrAccountId).id;
    const draw = this.store.draws.get(drawId);
    if (!draw || draw.helocId !== facilityId) {
      throw new SimulatorHttpError(404, 'Draw not found');
    }
    return draw;
  }

  getDrawByIdempotency(helocIdOrAccountId: string, key: string): HelocDraw {
    const facilityId = this.requireHeloc(helocIdOrAccountId).id;
    const draw = this.store.findDrawByIdempotency(facilityId, key);
    if (!draw) {
      throw new SimulatorHttpError(404, 'Draw not found for idempotency key');
    }
    return draw;
  }

  createTransfer(input: {
    sourceAccountId: string;
    destinationAccountId: string;
    amountCents: bigint;
    idempotencyKey: string;
  }): { statusCode: number; body: unknown } {
    const scenario = this.requireScenario();
    const scope = 'bank.transfer';
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

    this.maybeFail('transfer');

    if (!this.store.accounts.has(input.sourceAccountId)) {
      throw new SimulatorHttpError(404, 'Source account not found');
    }
    if (!this.store.accounts.has(input.destinationAccountId)) {
      throw new SimulatorHttpError(404, 'Destination account not found');
    }

    if (this.consumeFailure('TRANSFER_REJECTED')) {
      const failed: BankTransfer = {
        id: randomUUID(),
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
        amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey,
        state: 'FAILED',
        providerTransactionId: `xfer_${randomUUID()}`,
        requestedAt: this.iso(),
        settledAt: null,
        failureCode: 'TRANSFER_REJECTED',
        requestHash,
      };
      this.store.transfers.set(failed.id, failed);
      const body = this.transferPayload(failed);
      this.persistIdempotency(scope, input.idempotencyKey, requestHash, 422, body);
      this.emitWebhook('bank.transfer.updated', body);
      return { statusCode: 422, body };
    }

    const transfer: BankTransfer = {
      id: randomUUID(),
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      state: 'PENDING',
      providerTransactionId: `xfer_${randomUUID()}`,
      requestedAt: this.iso(),
      settledAt: null,
      failureCode: null,
      requestHash,
    };
    this.store.transfers.set(transfer.id, transfer);
    this.schedule('TRANSFER_SETTLE', transfer.id, scenario.transferSettlementDelayMs);
    const body = this.transferPayload(transfer);
    this.persistIdempotency(scope, input.idempotencyKey, requestHash, 202, body);
    this.emitWebhook('bank.transfer.updated', body);

    if (this.consumeFailure('TIMEOUT_AFTER_SUCCESS')) {
      throw new SimulatorHttpError(504, 'Gateway timeout after processing', {
        processed: true,
        transferId: transfer.id,
      });
    }

    return { statusCode: 202, body };
  }

  getTransfer(transferId: string): BankTransfer {
    const transfer = this.store.transfers.get(transferId);
    if (!transfer) {
      throw new SimulatorHttpError(404, 'Transfer not found');
    }
    return transfer;
  }

  getTransferByIdempotency(key: string): BankTransfer {
    const transfer = this.store.findTransferByIdempotency(key);
    if (!transfer) {
      throw new SimulatorHttpError(404, 'Transfer not found for idempotency key');
    }
    return transfer;
  }

  getOrdinaryDebit(accountId: string, debitId: string) {
    const debit = this.store.ordinaryDebits.get(debitId);
    if (!debit || debit.accountId !== accountId) {
      throw new SimulatorHttpError(404, 'Debit not found');
    }
    return debit;
  }

  listOrdinaryDebits(accountId: string) {
    if (!this.store.accounts.has(accountId)) {
      throw new SimulatorHttpError(404, 'Account not found');
    }
    return [...this.store.ordinaryDebits.values()].filter((d) => d.accountId === accountId);
  }

  listInterestPayments(helocIdOrAccountId: string): InterestPaymentView[] {
    const heloc = this.requireHeloc(helocIdOrAccountId);
    const charges = [...this.store.interestCharges.values()].filter((c) => c.helocId === heloc.id);
    const debitByPaymentId = new Map(
      [...this.store.ordinaryDebits.values()]
        .filter((d) => d.relatedInterestPaymentId != null)
        .map((d) => [d.relatedInterestPaymentId as string, d]),
    );
    const views: InterestPaymentView[] = [];
    for (const charge of charges) {
      const payment = [...this.store.interestPayments.values()].find(
        (p) => p.chargeId === charge.id,
      );
      if (!payment) {
        continue;
      }
      const debit = debitByPaymentId.get(payment.id) ?? null;
      views.push({
        chargeId: charge.id,
        providerChargeId: charge.providerChargeId,
        interestPeriod: charge.interestPeriod,
        chargeState: charge.state,
        chargeAmountCents: charge.amountCents,
        paymentId: payment.id,
        providerPaymentId: payment.providerPaymentId,
        paymentState: payment.state,
        ordinaryAccountId: payment.ordinaryAccountId,
        debitId: debit?.id ?? null,
        amountCents: payment.amountCents,
        failureCode: payment.failureCode,
        settledAt: payment.settledAt,
      });
    }
    return views;
  }

  listAccountTransactions(accountId: string) {
    if (!this.store.accounts.has(accountId)) {
      throw new SimulatorHttpError(404, 'Account not found');
    }
    return this.store.transactions.filter((t) => t.accountId === accountId);
  }

  getAccount(accountId: string): SimAccount {
    const account = this.store.accounts.get(accountId);
    if (!account) {
      throw new SimulatorHttpError(404, 'Account not found');
    }
    return account;
  }

  postInterestCharge(input: {
    helocId: string;
    interestPeriod: string;
    amountCents: bigint;
    ordinaryAccountId: string;
  }): { charge: InterestCharge; paymentId: string } {
    const scenario = this.requireScenario();
    const heloc = this.requireHeloc(input.helocId);
    if (!this.store.accounts.has(input.ordinaryAccountId)) {
      throw new SimulatorHttpError(404, 'Ordinary account not found');
    }
    const charge: InterestCharge = {
      id: randomUUID(),
      helocId: heloc.id,
      providerChargeId: `int_${randomUUID()}`,
      interestPeriod: input.interestPeriod,
      amountCents: input.amountCents,
      state: 'POSTED',
      postedAt: this.iso(),
      createdAt: this.iso(),
    };
    this.store.interestCharges.set(charge.id, charge);
    this.emitWebhook('heloc.interest-charged', {
      id: charge.id,
      helocId: charge.helocId,
      amountCents: moneyJson(charge.amountCents),
      interestPeriod: charge.interestPeriod,
      state: charge.state,
    });

    const paymentId = randomUUID();
    const payment = {
      id: paymentId,
      chargeId: charge.id,
      ordinaryAccountId: input.ordinaryAccountId,
      providerPaymentId: `intdebit_${randomUUID()}`,
      amountCents: input.amountCents,
      state: 'PENDING' as const,
      settledAt: null,
      createdAt: this.iso(),
      failureCode: null,
    };
    this.store.interestPayments.set(payment.id, payment);
    this.schedule('INTEREST_DEBIT', payment.id, scenario.interestDebitDelayMs);
    this.emitWebhook('heloc.interest-payment.updated', {
      id: payment.id,
      chargeId: payment.chargeId,
      amountCents: moneyJson(payment.amountCents),
      state: payment.state,
    });
    return { charge, paymentId };
  }

  // ---- internals ----

  private executeJob(jobId: string): void {
    const job = this.store.jobs.find((j) => j.id === jobId);
    if (!job || job.done) {
      return;
    }
    job.done = true;
    switch (job.type) {
      case 'MORTGAGE_POST':
        this.postMortgage(job.refId, job.runAtMs);
        break;
      case 'MORTGAGE_SETTLE':
        this.settleMortgage(job.refId, job.runAtMs);
        break;
      case 'HELOC_READVANCE':
        this.readvanceHeloc(job.refId);
        break;
      case 'DRAW_SETTLE':
        this.settleDraw(job.refId);
        break;
      case 'TRANSFER_SETTLE':
        this.settleTransfer(job.refId);
        break;
      case 'INTEREST_DEBIT':
        this.settleInterestDebit(job.refId);
        break;
      case 'WEBHOOK_DELIVER':
        void this.deliverWebhook(job.refId);
        break;
      default:
        break;
    }
  }

  private postMortgage(paymentId: string, effectiveAtMs: number): void {
    const scenario = this.requireScenario();
    const payment = this.store.payments.get(paymentId);
    if (!payment || payment.state !== 'SCHEDULED') {
      return;
    }
    payment.state = 'POSTED';
    payment.postedAt = this.iso();
    this.emitWebhook('mortgage.payment.updated', this.paymentPayload(payment));

    if (this.consumeFailure('REVERSED_AFTER_POSTING')) {
      payment.state = 'REVERSED';
      payment.reversedAt = this.iso();
      this.emitWebhook('mortgage.payment.updated', this.paymentPayload(payment));
      return;
    }

    this.schedule('MORTGAGE_SETTLE', payment.id, scenario.mortgageSettlementDelayMs, effectiveAtMs);
  }

  private settleMortgage(paymentId: string, effectiveAtMs: number): void {
    const scenario = this.requireScenario();
    const payment = this.store.payments.get(paymentId);
    if (!payment || payment.state !== 'POSTED') {
      return;
    }

    if (this.consumeFailure('REVERSED_MORTGAGE_PAYMENT')) {
      payment.state = 'REVERSED';
      payment.reversedAt = this.iso();
      this.emitWebhook('mortgage.payment.updated', this.paymentPayload(payment));
      return;
    }

    payment.state = 'SETTLED';
    payment.settledAt = this.iso();
    const mortgage = this.store.mortgages.get(payment.mortgageId);
    if (mortgage) {
      mortgage.outstandingPrincipalCents -= payment.principalAmountCents;
    }
    this.emitWebhook('mortgage.payment.updated', this.paymentPayload(payment));
    this.schedule('HELOC_READVANCE', payment.id, scenario.helocReadvanceDelayMs, effectiveAtMs);
  }

  private readvanceHeloc(paymentId: string): void {
    const payment = this.store.payments.get(paymentId);
    if (!payment || payment.state !== 'SETTLED') {
      return;
    }
    // Attach to first HELOC for the mortgage owner's user via shared user account graph
    const mortgage = this.store.mortgages.get(payment.mortgageId);
    if (!mortgage) {
      return;
    }
    const mortgageAccount = this.store.accounts.get(mortgage.accountId);
    if (!mortgageAccount) {
      return;
    }
    const heloc = [...this.store.helocs.values()].find((h) => {
      const account = this.store.accounts.get(h.accountId);
      return account?.userId === mortgageAccount.userId;
    });
    if (!heloc) {
      return;
    }

    heloc.newlyAvailableCreditCents += payment.principalAmountCents;
    const available = heloc.existingAvailableCreditCents + heloc.newlyAvailableCreditCents;
    const event = {
      id: randomUUID(),
      helocId: heloc.id,
      providerEventId: `cred_${randomUUID()}`,
      creditDeltaCents: payment.principalAmountCents,
      availableCreditCents: available,
      relatedPaymentPeriod: payment.paymentPeriod,
      relatedMortgagePaymentId: payment.id,
      observedAt: this.iso(),
      isNewlyCreated: true,
    };
    this.store.creditEvents.push(event);
    this.emitWebhook('heloc.availability.updated', {
      helocId: heloc.id,
      availableCreditCents: moneyJson(available),
      existingAvailableCreditCents: moneyJson(heloc.existingAvailableCreditCents),
      newlyAvailableCreditCents: moneyJson(heloc.newlyAvailableCreditCents),
      creditEventId: event.id,
      relatedPaymentPeriod: payment.paymentPeriod,
      isNewlyCreated: true,
    });
  }

  private settleDraw(drawId: string): void {
    const draw = this.store.draws.get(drawId);
    if (!draw || draw.state !== 'PENDING') {
      return;
    }
    const heloc = this.requireHeloc(draw.helocId);
    // Prefer consuming newly available credit first, then existing
    let remaining = draw.amountCents;
    const fromNew =
      remaining <= heloc.newlyAvailableCreditCents ? remaining : heloc.newlyAvailableCreditCents;
    heloc.newlyAvailableCreditCents -= fromNew;
    remaining -= fromNew;
    heloc.existingAvailableCreditCents -= remaining;
    heloc.balanceOwedCents += draw.amountCents;
    draw.state = 'SETTLED';
    draw.settledAt = this.iso();
    this.store.transactions.push({
      id: randomUUID(),
      accountId: heloc.accountId,
      amountCents: draw.amountCents,
      narrative: 'HELOC draw',
      createdAt: this.iso(),
      relatedId: draw.id,
    });
    this.emitWebhook('heloc.draw.updated', this.drawPayload(draw));
  }

  private settleTransfer(transferId: string): void {
    const transfer = this.store.transfers.get(transferId);
    if (!transfer || transfer.state !== 'PENDING') {
      return;
    }
    if (this.consumeFailure('TRANSFER_REVERSED')) {
      transfer.state = 'REVERSED';
      transfer.failureCode = 'TRANSFER_REVERSED';
      this.emitWebhook('bank.transfer.updated', this.transferPayload(transfer));
      return;
    }
    transfer.state = 'SETTLED';
    transfer.settledAt = this.iso();
    this.store.transactions.push({
      id: randomUUID(),
      accountId: transfer.sourceAccountId,
      amountCents: -transfer.amountCents,
      narrative: 'Bank transfer out',
      createdAt: this.iso(),
      relatedId: transfer.id,
    });
    this.store.transactions.push({
      id: randomUUID(),
      accountId: transfer.destinationAccountId,
      amountCents: transfer.amountCents,
      narrative: 'Bank transfer in',
      createdAt: this.iso(),
      relatedId: transfer.id,
    });
    this.emitWebhook('bank.transfer.updated', this.transferPayload(transfer));
  }

  private settleInterestDebit(paymentId: string): void {
    const payment = this.store.interestPayments.get(paymentId);
    if (!payment || payment.state !== 'PENDING') {
      return;
    }
    const account = this.store.accounts.get(payment.ordinaryAccountId);
    if (!account) {
      return;
    }

    const nsf =
      this.consumeFailure('ORDINARY_ACCOUNT_NSF') || account.balanceCents < payment.amountCents;

    if (nsf) {
      payment.state = 'FAILED';
      payment.failureCode = 'INSUFFICIENT_FUNDS';
      this.emitWebhook('heloc.interest-payment.updated', {
        id: payment.id,
        chargeId: payment.chargeId,
        amountCents: moneyJson(payment.amountCents),
        state: payment.state,
        failureCode: payment.failureCode,
      });
      return;
    }

    account.balanceCents -= payment.amountCents;
    payment.state = 'SETTLED';
    payment.settledAt = this.iso();
    const charge = this.store.interestCharges.get(payment.chargeId);
    const debit = {
      id: randomUUID(),
      accountId: account.id,
      amountCents: payment.amountCents,
      relatedInterestPaymentId: payment.id,
      narrative: 'HELOC interest debit',
      state: 'SETTLED' as const,
      createdAt: this.iso(),
      settledAt: this.iso(),
      ...(charge
        ? {
            interestPeriod: charge.interestPeriod,
            helocId: charge.helocId,
            providerPaymentId: payment.providerPaymentId,
          }
        : {}),
    };
    this.store.ordinaryDebits.set(debit.id, debit);
    this.store.transactions.push({
      id: randomUUID(),
      accountId: account.id,
      amountCents: -payment.amountCents,
      narrative: 'HELOC interest debit',
      createdAt: this.iso(),
      relatedId: payment.id,
    });
    this.emitWebhook('heloc.interest-payment.updated', {
      id: payment.id,
      chargeId: payment.chargeId,
      debitId: debit.id,
      amountCents: moneyJson(payment.amountCents),
      state: payment.state,
    });
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
      // No target configured — mark delivered after local retention (test-friendly).
      event.delivered = true;
      this.logger.info({ webhookType: event.type, eventId }, 'webhook retained (no target URL)');
      return;
    }
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-bank-sim-signature': event.signature,
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
    if (this.consumeFailure('HTTP_429')) {
      throw new SimulatorHttpError(429, 'Rate limited');
    }
    if (this.consumeFailure('HTTP_500_TRANSIENT')) {
      throw new SimulatorHttpError(500, 'Transient upstream failure');
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
    // Allow matching any remaining occurrence of this step (order-preserving consume)
    const idx = scenario.deterministicFailureSteps.indexOf(step, this.store.failureStepIndex);
    if (idx === this.store.failureStepIndex) {
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

  private requireScenario(): BankScenarioConfig {
    if (!this.store.scenario) {
      throw new SimulatorHttpError(400, 'No scenario loaded. POST /sim/admin/scenarios first.');
    }
    return this.store.scenario;
  }

  private requireHeloc(helocIdOrAccountId: string): SimHeloc {
    const direct = this.store.helocs.get(helocIdOrAccountId);
    if (direct) {
      return direct;
    }
    const byAccount = [...this.store.helocs.values()].find(
      (h) => h.accountId === helocIdOrAccountId,
    );
    if (!byAccount) {
      throw new SimulatorHttpError(404, 'HELOC not found');
    }
    return byAccount;
  }

  private requireMortgage(mortgageIdOrAccountId: string): SimMortgage {
    const direct = this.store.mortgages.get(mortgageIdOrAccountId);
    if (direct) {
      return direct;
    }
    const byAccount = [...this.store.mortgages.values()].find(
      (m) => m.accountId === mortgageIdOrAccountId,
    );
    if (!byAccount) {
      throw new SimulatorHttpError(404, 'Mortgage not found');
    }
    return byAccount;
  }

  private iso(): string {
    return this.clock.now().toISOString();
  }

  paymentPayload(payment: MortgagePayment): Record<string, unknown> {
    return {
      id: payment.id,
      mortgageId: payment.mortgageId,
      providerPaymentId: payment.providerPaymentId,
      paymentPeriod: payment.paymentPeriod,
      state: payment.state,
      totalAmountCents: moneyJson(payment.totalAmountCents),
      principalAmountCents: moneyJson(payment.principalAmountCents),
      interestAmountCents: moneyJson(payment.interestAmountCents),
      scheduledAt: payment.scheduledAt,
      postedAt: payment.postedAt,
      settledAt: payment.settledAt,
      reversedAt: payment.reversedAt,
    };
  }

  drawPayload(draw: HelocDraw): Record<string, unknown> {
    return {
      id: draw.id,
      helocId: draw.helocId,
      amountCents: moneyJson(draw.amountCents),
      idempotencyKey: draw.idempotencyKey,
      state: draw.state,
      providerTransactionId: draw.providerTransactionId,
      requestedAt: draw.requestedAt,
      settledAt: draw.settledAt,
      failureCode: draw.failureCode,
    };
  }

  transferPayload(transfer: BankTransfer): Record<string, unknown> {
    return {
      id: transfer.id,
      sourceAccountId: transfer.sourceAccountId,
      destinationAccountId: transfer.destinationAccountId,
      amountCents: moneyJson(transfer.amountCents),
      idempotencyKey: transfer.idempotencyKey,
      state: transfer.state,
      providerTransactionId: transfer.providerTransactionId,
      requestedAt: transfer.requestedAt,
      settledAt: transfer.settledAt,
      failureCode: transfer.failureCode,
    };
  }
}
