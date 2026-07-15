import { randomUUID } from 'node:crypto';

import { createPrismaClient, createRepositories, type PrismaClient } from '@csm/database';

import { DEMO, type DemoScenarioKind } from './constants.js';
import { resolveDemoDatabaseUrl } from './database-url.js';
import { createBankAdmin, createBrokerageAdmin } from './sim-admin.js';

export interface SeedResult {
  tenantId: string;
  userId: string;
  strategyId: string;
  bankUserId: string;
  mortgageAccountId: string;
  mortgageFacilityId: string;
  helocAccountId: string;
  helocFacilityId: string;
  ordinaryAccountId: string;
  brokerageAccountId: string;
  bankBrokerageLinkId: string;
  scenarioKind: DemoScenarioKind;
}

export interface SeedOptions {
  bankBaseUrl: string;
  brokerageBaseUrl: string;
  databaseUrl?: string;
  scenarioKind?: DemoScenarioKind;
  /** When true, wipe app financial tables before seeding. */
  wipeDb?: boolean;
  prisma?: PrismaClient;
}

async function wipeFinancialTables(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('SELECT pg_advisory_lock(88224402)');
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
    await prisma.$executeRawUnsafe('SELECT pg_advisory_unlock(88224402)');
  }
}

/**
 * Reset simulators, load the Edmonton scenario fixture, create mirrored provider
 * accounts, and seed Postgres so FinancialAccount.providerAccountId matches
 * simulator account UUIDs (required for live BankClient / BrokerageClient calls).
 */
export async function seedEdmontonDemo(options: SeedOptions): Promise<SeedResult> {
  const scenarioKind = options.scenarioKind ?? 'edmonton-demo';
  const bank = createBankAdmin(options.bankBaseUrl);
  const brokerage = createBrokerageAdmin(options.brokerageBaseUrl);

  await bank.reset();
  try {
    await brokerage.reset();
  } catch {
    // Brokerage reset path may differ when talking to an older sim process.
  }

  await bank.loadScenario(
    scenarioKind === 'edmonton-ambiguous-draw' ? 'edmonton-ambiguous-draw' : 'edmonton-demo',
  );
  await brokerage.loadScenario('edmonton-demo');

  const simUser = await bank.createUser({
    externalUserId: `edmonton-${randomUUID().slice(0, 8)}`,
    displayName: DEMO.userDisplayName,
  });

  const mortgageCreated = await bank.createAccount({
    userId: simUser.id,
    kind: 'MORTGAGE',
    displayAlias: 'Primary mortgage',
    providerAccountId: 'edmonton-mortgage',
    mortgage: {
      outstandingPrincipalCents: '45000000',
      expectedPaymentDay: DEMO.expectedPaymentDay,
    },
  });
  const helocCreated = await bank.createAccount({
    userId: simUser.id,
    kind: 'HELOC',
    displayAlias: 'Readvanceable HELOC',
    providerAccountId: 'edmonton-heloc',
    heloc: {
      creditLimitCents: '20000000',
      balanceOwedCents: '0',
      existingAvailableCreditCents: '5000000',
    },
  });
  const ordinaryCreated = await bank.createAccount({
    userId: simUser.id,
    kind: 'ORDINARY',
    displayAlias: 'Everyday chequing',
    providerAccountId: 'edmonton-ordinary',
    balanceCents: '2500000',
  });

  const brokerageId = randomUUID();
  const brokerageCreated = await brokerage.createAccount({
    id: brokerageId,
    externalAccountId: 'edmonton-brokerage',
    displayName: 'Non-registered brokerage',
    settledCashCents: '0',
  });
  await brokerage.upsertQuote({
    symbol: DEMO.symbol,
    mid: DEMO.etfQuoteMid,
    spread: '0.01',
  });

  const linkCreated = await bank.createAccount({
    userId: simUser.id,
    kind: 'BROKERAGE_LINK',
    displayAlias: 'Brokerage funding rail',
    providerAccountId: 'edmonton-brokerage-link',
    id: brokerageCreated.id,
  });

  const databaseUrl = options.databaseUrl ?? resolveDemoDatabaseUrl();
  const prisma = options.prisma ?? createPrismaClient(databaseUrl);
  const ownsPrisma = !options.prisma;

  try {
    if (options.wipeDb !== false) {
      await wipeFinancialTables(prisma);
    }

    const repos = createRepositories(prisma);
    const tenant = await repos.tenants.create({
      slug: DEMO.tenantSlug,
      name: DEMO.tenantName,
    });
    const user = await repos.users.create(tenant.id, {
      email: DEMO.userEmail,
      displayName: DEMO.userDisplayName,
    });

    const bankConn = await repos.accounts.createConnection(tenant.id, {
      userId: user.id,
      providerType: 'BANK',
      providerConnectionId: `bank-${DEMO.tenantSlug}`,
      displayAlias: 'Simulated Canadian bank',
    });
    const brokerConn = await repos.accounts.createConnection(tenant.id, {
      userId: user.id,
      providerType: 'BROKERAGE',
      providerConnectionId: `broker-${DEMO.tenantSlug}`,
      displayAlias: 'Simulated Canadian brokerage',
    });

    const mortgage = await repos.accounts.createAccount(tenant.id, {
      userId: user.id,
      connectionId: bankConn.id,
      kind: 'MORTGAGE',
      displayAlias: 'Primary mortgage',
      providerAccountId: mortgageCreated.account.id,
    });
    const heloc = await repos.accounts.createAccount(tenant.id, {
      userId: user.id,
      connectionId: bankConn.id,
      kind: 'HELOC',
      displayAlias: 'Readvanceable HELOC',
      providerAccountId: helocCreated.account.id,
    });
    const ordinary = await repos.accounts.createAccount(tenant.id, {
      userId: user.id,
      connectionId: bankConn.id,
      kind: 'BANK_OPERATING',
      displayAlias: 'Everyday chequing',
      providerAccountId: ordinaryCreated.account.id,
    });
    const brokerageAcct = await repos.accounts.createAccount(tenant.id, {
      userId: user.id,
      connectionId: brokerConn.id,
      kind: 'BROKERAGE_CASH',
      displayAlias: 'Non-registered brokerage',
      providerAccountId: brokerageCreated.id,
    });

    await repos.accounts.createMortgage(tenant.id, {
      accountId: mortgage.id,
      outstandingPrincipalCents: 450_000_00n,
      contractualPaymentCents: DEMO.mortgagePayment.totalAmountCents,
      expectedPaymentDay: DEMO.expectedPaymentDay,
    });
    await repos.accounts.createHeloc(tenant.id, {
      accountId: heloc.id,
      creditLimitCents: 200_000_00n,
      balanceOwedCents: 0n,
      availableCreditCents: 50_000_00n,
    });
    await repos.accounts.createOrdinaryBankAccount(tenant.id, ordinary.id);
    await repos.accounts.createBrokerageAccount(tenant.id, brokerageAcct.id);

    const strategy = await repos.strategies.create(tenant.id, {
      userId: user.id,
      name: 'Edmonton Smith Manoeuvre',
      timezone: DEMO.timezone,
      expectedPaymentDay: DEMO.expectedPaymentDay,
      expectedInterestChargeDay: 15,
      mortgageAccountId: mortgage.id,
      helocAccountId: heloc.id,
      bankAccountId: ordinary.id,
      brokerageAccountId: brokerageAcct.id,
      state: 'ACTIVE',
      symbol: DEMO.symbol,
      userMonthlyCapCents: DEMO.userMonthlyCapCents,
    });

    return {
      tenantId: tenant.id,
      userId: user.id,
      strategyId: strategy.id,
      bankUserId: simUser.id,
      mortgageAccountId: mortgage.id,
      mortgageFacilityId: mortgageCreated.mortgage!.id,
      helocAccountId: heloc.id,
      helocFacilityId: helocCreated.heloc!.id,
      ordinaryAccountId: ordinaryCreated.account.id,
      brokerageAccountId: brokerageCreated.id,
      bankBrokerageLinkId: linkCreated.account.id,
      scenarioKind,
    };
  } finally {
    if (ownsPrisma) {
      await prisma.$disconnect();
    }
  }
}
