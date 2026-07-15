import { createHmac, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '@csm/contracts';
import {
  createPrismaClient,
  createRepositories,
  disconnectPrisma,
  type PrismaClient,
  type Repositories,
} from '@csm/database';
import { createLogger } from '@csm/observability';

import type {
  ConversionEventSignal,
  InterestEventSignal,
  SignalConversionOutcome,
  SignalInterestOutcome,
  TemporalAppService,
} from './temporal-app-service.js';
import { WebhookAppService } from './webhook-app-service.js';
import { WebhookProcessor } from './webhook-processor.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';

const SECRET = 'test-webhook-signing-secret';

function sign(raw: Buffer): string {
  return `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
}

class FakeTemporal
  implements Pick<TemporalAppService, 'signalConversionEvent' | 'signalInterestEvent'>
{
  signals: Array<{
    tenantId: string;
    strategyId: string;
    signalName: string;
    event: ConversionEventSignal;
    paymentPeriod?: string;
  }> = [];
  interestSignals: Array<{
    tenantId: string;
    strategyId: string;
    event: InterestEventSignal;
    interestPeriod?: string;
  }> = [];
  nextOutcome: SignalConversionOutcome = {
    status: 'SIGNALED',
    paymentPeriod: '2026-07',
  };
  nextInterestOutcome: SignalInterestOutcome = {
    status: 'SIGNALED',
    interestPeriod: '2026-07',
  };

  async signalConversionEvent(
    tenantId: string,
    strategyId: string,
    signalName: 'bankEventReceived' | 'brokerageEventReceived',
    event: ConversionEventSignal,
    options?: { paymentPeriod?: string },
  ): Promise<SignalConversionOutcome> {
    this.signals.push({
      tenantId,
      strategyId,
      signalName,
      event,
      ...(options?.paymentPeriod !== undefined ? { paymentPeriod: options.paymentPeriod } : {}),
    });
    return this.nextOutcome;
  }

  async signalInterestEvent(
    tenantId: string,
    strategyId: string,
    event: InterestEventSignal,
    options?: { interestPeriod?: string },
  ): Promise<SignalInterestOutcome> {
    this.interestSignals.push({
      tenantId,
      strategyId,
      event,
      ...(options?.interestPeriod !== undefined ? { interestPeriod: options.interestPeriod } : {}),
    });
    return this.nextInterestOutcome;
  }
}

async function provision(
  repos: Repositories,
  slug: string,
  opts?: { strategyState?: 'ACTIVE' | 'DRAFT'; providerPrefix?: string },
) {
  const prefix = opts?.providerPrefix ?? slug;
  const tenant = await repos.tenants.create({ slug, name: slug });
  const user = await repos.users.create(tenant.id, {
    email: `${slug}@example.com`,
    displayName: slug,
  });
  const bankConn = await repos.accounts.createConnection(tenant.id, {
    userId: user.id,
    providerType: 'BANK',
    providerConnectionId: `bank-${slug}`,
    displayAlias: 'Bank',
  });
  const brokerConn = await repos.accounts.createConnection(tenant.id, {
    userId: user.id,
    providerType: 'BROKERAGE',
    providerConnectionId: `broker-${slug}`,
    displayAlias: 'Broker',
  });
  const mortgage = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'MORTGAGE',
    displayAlias: 'Mortgage',
    providerAccountId: `m-${prefix}`,
  });
  const heloc = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'HELOC',
    displayAlias: 'HELOC',
    providerAccountId: `h-${prefix}`,
  });
  const bank = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'BANK_OPERATING',
    displayAlias: 'Bank',
    providerAccountId: `b-${prefix}`,
  });
  const brokerage = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: brokerConn.id,
    kind: 'BROKERAGE_CASH',
    displayAlias: 'Brokerage',
    providerAccountId: `br-${prefix}`,
  });
  await repos.accounts.createMortgage(tenant.id, {
    accountId: mortgage.id,
    outstandingPrincipalCents: 100_000_00n,
    contractualPaymentCents: 1_000_00n,
    expectedPaymentDay: 15,
  });
  await repos.accounts.createHeloc(tenant.id, {
    accountId: heloc.id,
    creditLimitCents: 50_000_00n,
    balanceOwedCents: 0n,
    availableCreditCents: 50_000_00n,
  });
  await repos.accounts.createOrdinaryBankAccount(tenant.id, bank.id);
  await repos.accounts.createBrokerageAccount(tenant.id, brokerage.id);

  const strategy = await repos.strategies.create(tenant.id, {
    userId: user.id,
    name: slug,
    timezone: 'America/Toronto',
    expectedPaymentDay: 15,
    mortgageAccountId: mortgage.id,
    helocAccountId: heloc.id,
    bankAccountId: bank.id,
    brokerageAccountId: brokerage.id,
    symbol: 'VCN.TO',
    userMonthlyCapCents: 200_000n,
    state: opts?.strategyState ?? 'ACTIVE',
  });

  return { tenant, user, mortgage, heloc, bank, brokerage, strategy };
}

function mortgageBody(input: {
  providerEventId: string;
  externalAccountId: string;
  paymentPeriod: string;
  state: string;
  paymentId?: string;
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: 'mortgage.payment.updated',
      providerEventId: input.providerEventId,
      externalAccountId: input.externalAccountId,
      occurredAt: '2026-07-15T14:00:00.000Z',
      data: {
        id: input.paymentId ?? 'pay-1',
        mortgageId: input.externalAccountId,
        providerPaymentId: 'ppay-1',
        paymentPeriod: input.paymentPeriod,
        state: input.state,
      },
    }),
  );
}

function interestBody(input: {
  providerEventId: string;
  externalAccountId: string;
  interestPeriod: string;
  chargeId?: string;
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: 'heloc.interest.charged',
      providerEventId: input.providerEventId,
      externalAccountId: input.externalAccountId,
      occurredAt: '2026-07-01T14:00:00.000Z',
      data: {
        id: input.chargeId ?? 'icharge-1',
        helocId: input.externalAccountId,
        providerChargeId: 'pcharge-1',
        interestPeriod: input.interestPeriod,
        state: 'POSTED',
      },
    }),
  );
}

describe('webhook processing', () => {
  let prisma: PrismaClient;
  let repos: Repositories;
  let temporal: FakeTemporal;
  let processor: WebhookProcessor;
  let webhooks: WebhookAppService;
  const logger = createLogger({ service: 'api-test', level: 'error', pretty: false });

  beforeAll(async () => {
    prisma = createPrismaClient(DATABASE_URL);
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  beforeEach(() => {
    repos = createRepositories(prisma);
    temporal = new FakeTemporal();
    processor = new WebhookProcessor(repos, temporal as unknown as TemporalAppService, logger, {
      intervalMs: 60_000,
    });
    webhooks = new WebhookAppService(repos, SECRET, logger);
  });

  it('accepts a valid webhook, persists uniquely, and signals with a tiny tip', async () => {
    const g = await provision(repos, `wh-ok-${randomUUID().slice(0, 8)}`);
    await repos.cycles.create(g.tenant.id, {
      strategyId: g.strategy.id,
      paymentPeriod: '2026-07',
      correlationId: randomUUID(),
      state: 'WAITING_FOR_MORTGAGE',
    });
    temporal.nextOutcome = { status: 'SIGNALED', paymentPeriod: '2026-07' };

    const raw = mortgageBody({
      providerEventId: 'evt-valid-1',
      externalAccountId: g.mortgage.providerAccountId,
      paymentPeriod: '2026-07',
      state: 'SETTLED',
    });
    const result = await webhooks.ingest({
      provider: 'bank-sim',
      rawBody: raw,
      signatureHeader: sign(raw),
      externalAccountIdHeader: undefined,
      correlationId: randomUUID(),
    });
    expect(result.duplicate).toBe(false);

    await processor.processDue(10);

    const row = await repos.webhooks.findById(g.tenant.id, result.eventId);
    expect(row?.processingState).toBe('PROCESSED');
    expect(row?.outcome).toBe('SIGNALLED');
    expect(temporal.signals).toHaveLength(1);
    const tip = temporal.signals[0]!.event;
    expect(tip).toMatchObject({
      providerEventId: 'evt-valid-1',
      accountId: g.mortgage.id,
      eventType: 'mortgage.payment.updated',
      providerType: 'BANK',
      providerResourceId: 'ppay-1',
    });
    expect(Object.keys(tip).sort()).toEqual(
      [
        'accountId',
        'eventType',
        'occurredAt',
        'providerEventId',
        'providerResourceId',
        'providerType',
      ].sort(),
    );
  });

  it('rejects invalid signature without persisting', async () => {
    const g = await provision(repos, `wh-sig-${randomUUID().slice(0, 8)}`);
    const raw = mortgageBody({
      providerEventId: 'evt-bad-sig',
      externalAccountId: g.mortgage.providerAccountId,
      paymentPeriod: '2026-07',
      state: 'SETTLED',
    });
    await expect(
      webhooks.ingest({
        provider: 'bank-sim',
        rawBody: raw,
        signatureHeader: 'sha256=deadbeef',
        externalAccountIdHeader: undefined,
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'MALFORMED_WEBHOOK' } satisfies Partial<AppError>);

    const found = await repos.webhooks.findByProviderEvent(g.tenant.id, 'bank-sim', 'evt-bad-sig');
    expect(found).toBeNull();
  });

  it('deduplicates identical provider event ids', async () => {
    const g = await provision(repos, `wh-dup-${randomUUID().slice(0, 8)}`);
    await repos.cycles.create(g.tenant.id, {
      strategyId: g.strategy.id,
      paymentPeriod: '2026-07',
      correlationId: randomUUID(),
      state: 'WAITING_FOR_MORTGAGE',
    });
    const raw = mortgageBody({
      providerEventId: 'evt-dup',
      externalAccountId: g.mortgage.providerAccountId,
      paymentPeriod: '2026-07',
      state: 'SETTLED',
    });
    const first = await webhooks.ingest({
      provider: 'bank-sim',
      rawBody: raw,
      signatureHeader: sign(raw),
      externalAccountIdHeader: undefined,
      correlationId: randomUUID(),
    });
    const second = await webhooks.ingest({
      provider: 'bank-sim',
      rawBody: raw,
      signatureHeader: sign(raw),
      externalAccountIdHeader: undefined,
      correlationId: randomUUID(),
    });
    expect(second.duplicate).toBe(true);
    expect(second.eventId).toBe(first.eventId);

    await processor.processDue(10);
    expect(temporal.signals).toHaveLength(1);
  });

  it('treats out-of-order events as independent wake tips (no status trust)', async () => {
    const g = await provision(repos, `wh-ooo-${randomUUID().slice(0, 8)}`);
    await repos.cycles.create(g.tenant.id, {
      strategyId: g.strategy.id,
      paymentPeriod: '2026-07',
      correlationId: randomUUID(),
      state: 'WAITING_FOR_MORTGAGE',
    });

    const settled = mortgageBody({
      providerEventId: 'evt-ooo-settled',
      externalAccountId: g.mortgage.providerAccountId,
      paymentPeriod: '2026-07',
      state: 'SETTLED',
      paymentId: 'pay-ooo',
    });
    const pending = mortgageBody({
      providerEventId: 'evt-ooo-pending',
      externalAccountId: g.mortgage.providerAccountId,
      paymentPeriod: '2026-07',
      state: 'PENDING',
      paymentId: 'pay-ooo',
    });

    await webhooks.ingest({
      provider: 'bank-sim',
      rawBody: settled,
      signatureHeader: sign(settled),
      externalAccountIdHeader: undefined,
      correlationId: randomUUID(),
    });
    await webhooks.ingest({
      provider: 'bank-sim',
      rawBody: pending,
      signatureHeader: sign(pending),
      externalAccountIdHeader: undefined,
      correlationId: randomUUID(),
    });
    await processor.processDue(10);

    expect(temporal.signals).toHaveLength(2);
    expect(temporal.signals.map((s) => s.event.providerEventId).sort()).toEqual([
      'evt-ooo-pending',
      'evt-ooo-settled',
    ]);
    // Signal tip never carries settlement status — Activity poll remains authoritative.
    for (const s of temporal.signals) {
      expect(s.event).not.toHaveProperty('state');
      expect(s.event).not.toHaveProperty('status');
    }
  });

  it('retains webhook when no workflow has started yet', async () => {
    const g = await provision(repos, `wh-before-${randomUUID().slice(0, 8)}`);
    temporal.nextOutcome = { status: 'NO_CYCLE', paymentPeriod: '2026-07' };

    const raw = mortgageBody({
      providerEventId: 'evt-before',
      externalAccountId: g.mortgage.providerAccountId,
      paymentPeriod: '2026-07',
      state: 'SETTLED',
    });
    const result = await webhooks.ingest({
      provider: 'bank-sim',
      rawBody: raw,
      signatureHeader: sign(raw),
      externalAccountIdHeader: undefined,
      correlationId: randomUUID(),
    });
    await processor.processDue(10);

    const row = await repos.webhooks.findById(g.tenant.id, result.eventId);
    expect(row?.processingState).toBe('RETAINED');
    expect(row?.outcome).toBe('NO_WORKFLOW_YET');
  });

  it('retains webhook after workflow/cycle already completed', async () => {
    const g = await provision(repos, `wh-after-${randomUUID().slice(0, 8)}`);
    await repos.cycles.create(g.tenant.id, {
      strategyId: g.strategy.id,
      paymentPeriod: '2026-07',
      correlationId: randomUUID(),
      state: 'COMPLETED',
    });
    temporal.nextOutcome = {
      status: 'CYCLE_TERMINAL',
      paymentPeriod: '2026-07',
    };

    const raw = mortgageBody({
      providerEventId: 'evt-after',
      externalAccountId: g.mortgage.providerAccountId,
      paymentPeriod: '2026-07',
      state: 'SETTLED',
    });
    const result = await webhooks.ingest({
      provider: 'bank-sim',
      rawBody: raw,
      signatureHeader: sign(raw),
      externalAccountIdHeader: undefined,
      correlationId: randomUUID(),
    });
    await processor.processDue(10);

    const row = await repos.webhooks.findById(g.tenant.id, result.eventId);
    expect(row?.processingState).toBe('RETAINED');
    expect(row?.outcome).toBe('WORKFLOW_ALREADY_COMPLETE');
  });

  it('rejects unknown external account', async () => {
    const raw = mortgageBody({
      providerEventId: 'evt-unknown',
      externalAccountId: `unknown-${randomUUID()}`,
      paymentPeriod: '2026-07',
      state: 'SETTLED',
    });
    await expect(
      webhooks.ingest({
        provider: 'bank-sim',
        rawBody: raw,
        signatureHeader: sign(raw),
        externalAccountIdHeader: undefined,
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects cross-tenant account collision attempts', async () => {
    const sharedProviderId = `shared-${randomUUID().slice(0, 8)}`;
    await provision(repos, `wh-c1-${randomUUID().slice(0, 8)}`, {
      providerPrefix: sharedProviderId,
    });
    // Global unique on providerAccountId blocks colliding external IDs at write time
    // (H3) — stronger than waiting for webhook multi-match denial.
    await expect(
      provision(repos, `wh-c2-${randomUUID().slice(0, 8)}`, {
        providerPrefix: sharedProviderId,
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ENTITY' });
  });

  it('dropped webhook is covered by polling: retained event does not authorize money movement', async () => {
    const g = await provision(repos, `wh-drop-${randomUUID().slice(0, 8)}`);
    // Simulate a webhook that arrived with no running workflow — polling will still settle later.
    temporal.nextOutcome = { status: 'WORKFLOW_NOT_RUNNING', paymentPeriod: '2026-07' };
    await repos.cycles.create(g.tenant.id, {
      strategyId: g.strategy.id,
      paymentPeriod: '2026-07',
      correlationId: randomUUID(),
      state: 'WAITING_FOR_MORTGAGE',
    });

    const raw = mortgageBody({
      providerEventId: 'evt-dropped-fallback',
      externalAccountId: g.mortgage.providerAccountId,
      paymentPeriod: '2026-07',
      state: 'SETTLED',
    });
    const result = await webhooks.ingest({
      provider: 'bank-sim',
      rawBody: raw,
      signatureHeader: sign(raw),
      externalAccountIdHeader: undefined,
      correlationId: randomUUID(),
    });
    await processor.processDue(10);

    const row = await repos.webhooks.findById(g.tenant.id, result.eventId);
    expect(row?.processingState).toBe('RETAINED');
    expect(row?.outcome).toBe('WORKFLOW_NOT_RUNNING');
    // Signal was attempted as a tip only; no financial action is encoded in webhook processing.
    expect(temporal.signals[0]?.event.eventType).toBe('mortgage.payment.updated');
  });

  it('interest webhook with interestPeriod signals interest workflow tip', async () => {
    const g = await provision(repos, `wh-int-${randomUUID().slice(0, 8)}`);
    await repos.interestCycles.create(g.tenant.id, {
      strategyId: g.strategy.id,
      interestPeriod: '2026-07',
      correlationId: randomUUID(),
      state: 'AWAITING_CHARGE',
    });
    temporal.nextOutcome = { status: 'NO_CYCLE' };
    temporal.nextInterestOutcome = { status: 'SIGNALED', interestPeriod: '2026-07' };

    const raw = interestBody({
      providerEventId: 'evt-interest-1',
      externalAccountId: g.heloc.providerAccountId,
      interestPeriod: '2026-07',
    });
    const result = await webhooks.ingest({
      provider: 'bank-sim',
      rawBody: raw,
      signatureHeader: sign(raw),
      externalAccountIdHeader: undefined,
      correlationId: randomUUID(),
    });
    await processor.processDue(10);

    const row = await repos.webhooks.findById(g.tenant.id, result.eventId);
    expect(row?.processingState).toBe('PROCESSED');
    expect(row?.outcome).toBe('SIGNALLED');
    expect(row?.paymentPeriod).toBe('2026-07');
    expect(temporal.interestSignals).toHaveLength(1);
    expect(temporal.interestSignals[0]).toMatchObject({
      tenantId: g.tenant.id,
      strategyId: g.strategy.id,
      interestPeriod: '2026-07',
      event: {
        providerEventId: 'evt-interest-1',
        accountId: g.heloc.id,
        eventType: 'heloc.interest.charged',
        providerType: 'BANK',
        providerResourceId: 'pcharge-1',
      },
    });
  });

  it('dead-letters permanently invalid payloads for known accounts', async () => {
    const g = await provision(repos, `wh-dlq-${randomUUID().slice(0, 8)}`);
    const raw = Buffer.from(
      JSON.stringify({
        broken: true,
        type: 'mortgage.payment.updated',
        providerEventId: 'evt-dlq',
        externalAccountId: g.mortgage.providerAccountId,
      }),
    );
    const result = await webhooks.ingest({
      provider: 'bank-sim',
      rawBody: raw,
      signatureHeader: sign(raw),
      externalAccountIdHeader: g.mortgage.providerAccountId,
      correlationId: randomUUID(),
    });
    const row = await repos.webhooks.findById(g.tenant.id, result.eventId);
    expect(row?.processingState).toBe('DEAD_LETTERED');
    expect(row?.deadLetterReason).toBe('MALFORMED_PAYLOAD');
    expect(temporal.signals).toHaveLength(0);
  });
});
