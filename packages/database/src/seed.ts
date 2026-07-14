import { randomUUID } from 'node:crypto';

import {
  createPrismaClient,
  createRepositories,
  disconnectPrisma,
  withTransaction,
} from './index.js';

async function seedTenant(
  slug: string,
  name: string,
  userEmail: string,
  suffix: string,
): Promise<void> {
  const prisma = createPrismaClient();

  await withTransaction(prisma, async (tx) => {
    const r = createRepositories(tx);

    const tenant = await r.tenants.create({ slug, name });
    const user = await r.users.create(tenant.id, {
      email: userEmail,
      displayName: `${name} Owner`,
    });

    const bankConn = await r.accounts.createConnection(tenant.id, {
      userId: user.id,
      providerType: 'BANK',
      providerConnectionId: `sim-bank-conn-${suffix}`,
      displayAlias: `${name} Bank Connection`,
    });
    const brokerConn = await r.accounts.createConnection(tenant.id, {
      userId: user.id,
      providerType: 'BROKERAGE',
      providerConnectionId: `sim-broker-conn-${suffix}`,
      displayAlias: `${name} Brokerage Connection`,
    });

    const mortgageAcct = await r.accounts.createAccount(tenant.id, {
      userId: user.id,
      connectionId: bankConn.id,
      kind: 'MORTGAGE',
      displayAlias: 'Primary Mortgage',
      providerAccountId: `sim-mortgage-${suffix}`,
      accountNumberLast4: '1001',
    });
    const helocAcct = await r.accounts.createAccount(tenant.id, {
      userId: user.id,
      connectionId: bankConn.id,
      kind: 'HELOC',
      displayAlias: 'Investment HELOC',
      providerAccountId: `sim-heloc-${suffix}`,
      accountNumberLast4: '2002',
    });
    const bankAcct = await r.accounts.createAccount(tenant.id, {
      userId: user.id,
      connectionId: bankConn.id,
      kind: 'BANK_OPERATING',
      displayAlias: 'Chequing',
      providerAccountId: `sim-chequing-${suffix}`,
      accountNumberLast4: '3003',
    });
    const brokerageAcct = await r.accounts.createAccount(tenant.id, {
      userId: user.id,
      connectionId: brokerConn.id,
      kind: 'BROKERAGE_CASH',
      displayAlias: 'Non-registered Cash',
      providerAccountId: `sim-broker-cash-${suffix}`,
      accountNumberLast4: '4004',
    });

    await r.accounts.createMortgage(tenant.id, {
      accountId: mortgageAcct.id,
      outstandingPrincipalCents: 450_000_00n,
      contractualPaymentCents: 2_400_00n,
      expectedPaymentDay: 1,
    });
    await r.accounts.createHeloc(tenant.id, {
      accountId: helocAcct.id,
      creditLimitCents: 200_000_00n,
      balanceOwedCents: 10_000_00n,
      availableCreditCents: 190_000_00n,
    });
    await r.accounts.createOrdinaryBankAccount(tenant.id, bankAcct.id);
    await r.accounts.createBrokerageAccount(tenant.id, brokerageAcct.id);

    const strategy = await r.strategies.create(tenant.id, {
      userId: user.id,
      name: `${name} Smith Manoeuvre`,
      timezone: 'America/Toronto',
      expectedPaymentDay: 1,
      mortgageAccountId: mortgageAcct.id,
      helocAccountId: helocAcct.id,
      bankAccountId: bankAcct.id,
      brokerageAccountId: brokerageAcct.id,
      state: 'ACTIVE',
      symbol: 'VCN.TO',
      userMonthlyCapCents: 5_000_00n,
    });

    await r.cycles.create(tenant.id, {
      strategyId: strategy.id,
      paymentPeriod: '2026-07',
      correlationId: randomUUID(),
      state: 'SCHEDULED',
    });
  });

  await disconnectPrisma();
  // recreate client next call; seedTenant uses fresh createPrismaClient each time but
  // disconnect clears singleton — fine for seed script sequential calls
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  // Wipe seedable tables in dependency order for idempotent local seed
  await prisma.ledgerEntry.deleteMany();
  await prisma.reconciliationItem.deleteMany();
  await prisma.reconciliation.deleteMany();
  await prisma.investmentFill.deleteMany();
  await prisma.investmentOrder.deleteMany();
  await prisma.brokerageDeposit.deleteMany();
  await prisma.moneyMovement.deleteMany();
  await prisma.workflowReference.deleteMany();
  await prisma.monthlyConversionCycle.deleteMany();
  await prisma.helocInterestPayment.deleteMany();
  await prisma.helocInterestCharge.deleteMany();
  await prisma.helocCreditEvent.deleteMany();
  await prisma.mortgagePayment.deleteMany();
  await prisma.strategyInvestmentPolicy.deleteMany();
  await prisma.strategy.deleteMany();
  await prisma.mortgage.deleteMany();
  await prisma.heloc.deleteMany();
  await prisma.brokerageAccount.deleteMany();
  await prisma.ordinaryBankAccount.deleteMany();
  await prisma.financialAccount.deleteMany();
  await prisma.financialConnection.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.providerWebhookEvent.deleteMany();
  await prisma.operationalException.deleteMany();
  await prisma.auditDocument.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
  await disconnectPrisma();

  await seedTenant('northstar-advisors', 'Northstar Advisors', 'owner@northstar.example', 't1');
  await seedTenant('maple-household', 'Maple Household', 'jordan@maple.example', 't2');

  console.info(
    JSON.stringify({
      level: 'info',
      message: 'seed complete',
      tenants: ['northstar-advisors', 'maple-household'],
    }),
  );
}

main().catch(async (error: unknown) => {
  console.error(JSON.stringify({ level: 'error', message: 'seed failed', err: String(error) }));
  await disconnectPrisma();
  process.exit(1);
});
