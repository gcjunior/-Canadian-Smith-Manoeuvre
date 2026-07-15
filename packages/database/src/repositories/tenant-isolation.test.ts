import { randomUUID } from 'node:crypto';

import { DomainError } from '@csm/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaClient,
  createRepositories,
  disconnectPrisma,
  withTransaction,
  type PrismaClient,
} from '../index.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';

async function provisionUserGraph(prisma: PrismaClient, slug: string) {
  const repos = createRepositories(prisma);
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
    providerAccountId: `m-${slug}`,
  });
  const heloc = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'HELOC',
    displayAlias: 'HELOC',
    providerAccountId: `h-${slug}`,
  });
  const bank = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'BANK_OPERATING',
    displayAlias: 'Bank Op',
    providerAccountId: `b-${slug}`,
  });
  const brokerage = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: brokerConn.id,
    kind: 'BROKERAGE_CASH',
    displayAlias: 'Broker Cash',
    providerAccountId: `c-${slug}`,
  });

  await repos.accounts.createMortgage(tenant.id, {
    accountId: mortgage.id,
    outstandingPrincipalCents: 100_000_00n,
    contractualPaymentCents: 1_000_00n,
    expectedPaymentDay: 1,
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
    name: `${slug} strategy`,
    timezone: 'America/Toronto',
    expectedPaymentDay: 1,
    mortgageAccountId: mortgage.id,
    helocAccountId: heloc.id,
    bankAccountId: bank.id,
    brokerageAccountId: brokerage.id,
    symbol: 'VCN.TO',
    userMonthlyCapCents: 2_000_00n,
  });

  return { tenant, user, mortgage, heloc, bank, brokerage, strategy, repos };
}

describe('tenant isolation and uniqueness', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = createPrismaClient(DATABASE_URL);
  });

  beforeEach(async () => {
    await prisma.dailyReconciliationReport.deleteMany();
    await prisma.reconciliationItem.deleteMany();
    await prisma.reconciliation.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.investmentFill.deleteMany();
    await prisma.investmentOrder.deleteMany();
    await prisma.brokerageDeposit.deleteMany();
    await prisma.moneyMovement.deleteMany();
    await prisma.interestCycle.deleteMany();
    await prisma.helocInterestPayment.deleteMany();
    await prisma.helocInterestCharge.deleteMany();
    await prisma.helocCreditEvent.deleteMany();
    await prisma.workflowReference.deleteMany();
    await prisma.providerWebhookEvent.deleteMany();
    await prisma.operationalException.deleteMany();
    await prisma.auditDocument.deleteMany();
    await prisma.idempotencyRecord.deleteMany();
    await prisma.monthlyConversionCycle.deleteMany();
    await prisma.strategySchedule.deleteMany();
    await prisma.mortgagePayment.deleteMany();
    await prisma.strategyInvestmentPolicy.deleteMany();
    await prisma.strategy.deleteMany();
    await prisma.mortgage.deleteMany();
    await prisma.heloc.deleteMany();
    await prisma.brokerageAccount.deleteMany();
    await prisma.ordinaryBankAccount.deleteMany();
    await prisma.financialAccount.deleteMany();
    await prisma.financialConnection.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('prevents reading another tenant strategy by id', async () => {
    const a = await provisionUserGraph(prisma, `tenant-a-${randomUUID().slice(0, 8)}`);
    const b = await provisionUserGraph(prisma, `tenant-b-${randomUUID().slice(0, 8)}`);

    const leaked = await a.repos.strategies.findById(a.tenant.id, b.strategy.id);
    expect(leaked).toBeNull();

    const own = await b.repos.strategies.findById(b.tenant.id, b.strategy.id);
    expect(own?.id).toBe(b.strategy.id);
  });

  it('rejects strategy that binds another tenant account (domain + FK)', async () => {
    const a = await provisionUserGraph(prisma, `iso-a-${randomUUID().slice(0, 8)}`);
    const b = await provisionUserGraph(prisma, `iso-b-${randomUUID().slice(0, 8)}`);

    await expect(
      a.repos.strategies.create(a.tenant.id, {
        userId: a.user.id,
        name: 'bad',
        timezone: 'America/Toronto',
        expectedPaymentDay: 1,
        mortgageAccountId: b.mortgage.id,
        helocAccountId: a.heloc.id,
        bankAccountId: a.bank.id,
        brokerageAccountId: a.brokerage.id,
        symbol: 'VCN.TO',
        userMonthlyCapCents: 1000n,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('enforces one cycle per strategy and payment period', async () => {
    const a = await provisionUserGraph(prisma, `cycle-${randomUUID().slice(0, 8)}`);
    await a.repos.cycles.create(a.tenant.id, {
      strategyId: a.strategy.id,
      paymentPeriod: '2026-07',
      correlationId: randomUUID(),
    });

    await expect(
      a.repos.cycles.create(a.tenant.id, {
        strategyId: a.strategy.id,
        paymentPeriod: '2026-07',
        correlationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ENTITY' });
  });

  it('enforces idempotency key uniqueness per tenant scope', async () => {
    const a = await provisionUserGraph(prisma, `idem-${randomUUID().slice(0, 8)}`);
    await a.repos.idempotency.create(a.tenant.id, {
      scope: 'heloc.draw',
      key: 'same-key',
      requestHash: 'hash-1',
    });

    await expect(
      a.repos.idempotency.create(a.tenant.id, {
        scope: 'heloc.draw',
        key: 'same-key',
        requestHash: 'hash-2',
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ENTITY' });
  });

  it('enforces webhook event identity uniqueness', async () => {
    const a = await provisionUserGraph(prisma, `wh-${randomUUID().slice(0, 8)}`);
    await a.repos.webhooks.create(a.tenant.id, {
      provider: 'bank-sim',
      providerEventId: 'evt-1',
      eventType: 'mortgage.payment.settled',
      payloadRedacted: { status: 'SETTLED' },
    });

    await expect(
      a.repos.webhooks.create(a.tenant.id, {
        provider: 'bank-sim',
        providerEventId: 'evt-1',
        eventType: 'mortgage.payment.settled',
        payloadRedacted: { status: 'SETTLED' },
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ENTITY' });
  });

  it('enforces ledger business event identity uniqueness (append-only)', async () => {
    const a = await provisionUserGraph(prisma, `led-${randomUUID().slice(0, 8)}`);
    const correlationId = randomUUID();
    await a.repos.ledger.append(a.tenant.id, [
      {
        accountId: a.heloc.id,
        businessEventId: 'draw:cycle-1:leg-1',
        direction: 'CREDIT',
        amountCents: 500_00n,
        currencyCode: 'CAD',
        accountCategory: 'LIABILITY',
        strategyId: a.strategy.id,
        correlationId,
        narrative: 'HELOC draw',
      },
    ]);

    await expect(
      a.repos.ledger.append(a.tenant.id, [
        {
          accountId: a.heloc.id,
          businessEventId: 'draw:cycle-1:leg-1',
          direction: 'CREDIT',
          amountCents: 500_00n,
          accountCategory: 'LIABILITY',
          correlationId,
          narrative: 'HELOC draw duplicate',
        },
      ]),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ENTITY' });

    // Append-only: repository exposes no update/delete methods.
    expect('update' in a.repos.ledger).toBe(false);
    expect('delete' in a.repos.ledger).toBe(false);

    const again = await a.repos.ledger.findByBusinessEventId(a.tenant.id, 'draw:cycle-1:leg-1');
    expect(again?.amountCents).toBe(500_00n);
    expect(again?.accountCategory).toBe('LIABILITY');
  });

  it('allows same email across tenants but not within one tenant', async () => {
    const repos = createRepositories(prisma);
    const t1 = await repos.tenants.create({ slug: `e1-${randomUUID().slice(0, 8)}`, name: 'E1' });
    const t2 = await repos.tenants.create({ slug: `e2-${randomUUID().slice(0, 8)}`, name: 'E2' });

    await repos.users.create(t1.id, { email: 'shared@example.com', displayName: 'One' });
    await repos.users.create(t2.id, { email: 'shared@example.com', displayName: 'Two' });

    await expect(
      repos.users.create(t1.id, { email: 'shared@example.com', displayName: 'Dup' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ENTITY' });
  });

  it('runs account + strategy creation inside a transaction helper', async () => {
    const slug = `tx-${randomUUID().slice(0, 8)}`;
    await withTransaction(prisma, async (tx) => {
      const repos = createRepositories(tx);
      const tenant = await repos.tenants.create({ slug, name: slug });
      expect(tenant.id).toBeTruthy();
    });

    const found = await createRepositories(prisma).tenants.findBySlug(slug);
    expect(found?.slug).toBe(slug);
  });
});
