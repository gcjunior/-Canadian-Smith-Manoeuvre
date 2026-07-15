import { randomUUID } from 'node:crypto';

import type { BankClient } from '@csm/bank-client';
import { FakeBankClient } from '@csm/bank-client';
import type { BrokerageClient } from '@csm/brokerage-client';
import { FakeBrokerageClient } from '@csm/brokerage-client';
import {
  createPrismaClient,
  createRepositories,
  type PrismaClient,
  type Repositories,
} from '@csm/database';
import { createLogger } from '@csm/observability';

import { createActivities } from '../create-activities.js';

export const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';

export function testLogger() {
  return createLogger({ service: 'temporal-activities-test', level: 'silent' });
}

export async function wipeFinancialTables(prisma: PrismaClient): Promise<void> {
  // Serialize destructive setup across test files that share local Postgres.
  await prisma.$executeRawUnsafe('SELECT pg_advisory_lock(88224401)');
  try {
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
    // Cycles Restrict-reference mortgage payments — delete cycles first.
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
  } finally {
    await prisma.$executeRawUnsafe('SELECT pg_advisory_unlock(88224401)');
  }
}

export async function provisionActiveStrategy(prisma: PrismaClient, slug: string) {
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

  const mortgageProviderId = randomUUID();
  const helocProviderId = randomUUID();
  const bankProviderId = randomUUID();
  const brokerageProviderId = randomUUID();

  const mortgage = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'MORTGAGE',
    displayAlias: 'Mortgage',
    providerAccountId: mortgageProviderId,
  });
  const heloc = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'HELOC',
    displayAlias: 'HELOC',
    providerAccountId: helocProviderId,
  });
  const bank = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: bankConn.id,
    kind: 'BANK_OPERATING',
    displayAlias: 'Bank Op',
    providerAccountId: bankProviderId,
  });
  const brokerage = await repos.accounts.createAccount(tenant.id, {
    userId: user.id,
    connectionId: brokerConn.id,
    kind: 'BROKERAGE_CASH',
    displayAlias: 'Broker Cash',
    providerAccountId: brokerageProviderId,
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
    state: 'ACTIVE',
    symbol: 'VCN.TO',
    userMonthlyCapCents: 2_000_00n,
  });

  return {
    repos,
    tenant,
    user,
    mortgage,
    heloc,
    bank,
    brokerage,
    strategy,
    mortgageProviderId,
    helocProviderId,
    bankProviderId,
    brokerageProviderId,
  };
}

export function createTestActivities(options: {
  prisma: PrismaClient;
  repos?: Repositories;
  bankClient?: BankClient;
  brokerageClient?: BrokerageClient;
  platformMonthlyDrawCapCents?: bigint;
}) {
  const bankClient = options.bankClient ?? new FakeBankClient();
  const brokerageClient = options.brokerageClient ?? new FakeBrokerageClient();
  return {
    bankClient: bankClient as FakeBankClient,
    brokerageClient: brokerageClient as FakeBrokerageClient,
    activities: createActivities({
      logger: testLogger(),
      prisma: options.prisma,
      repos: options.repos ?? createRepositories(options.prisma),
      bankClient: bankClient as BankClient,
      brokerageClient: brokerageClient as BrokerageClient,
      platformMonthlyDrawCapCents: options.platformMonthlyDrawCapCents ?? 500_000n,
    }),
  };
}

export function createPrismaForTests(): PrismaClient {
  process.env.DATABASE_URL = DATABASE_URL;
  return createPrismaClient(DATABASE_URL);
}
