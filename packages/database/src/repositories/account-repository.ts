import type {
  BrokerageAccount,
  FinancialAccount,
  FinancialAccountKind,
  FinancialConnection,
  FinancialProviderType,
  Heloc,
  Mortgage,
  OrdinaryBankAccount,
} from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { mapPrismaError } from '../errors.js';

export interface AccountRepository {
  createConnection(
    tenantId: string,
    input: {
      userId: string;
      providerType: FinancialProviderType;
      providerConnectionId: string;
      displayAlias: string;
    },
  ): Promise<FinancialConnection>;
  createAccount(
    tenantId: string,
    input: {
      userId: string;
      connectionId: string;
      kind: FinancialAccountKind;
      displayAlias: string;
      providerAccountId: string;
      accountNumberLast4?: string;
    },
  ): Promise<FinancialAccount>;
  findAccountById(tenantId: string, accountId: string): Promise<FinancialAccount | null>;
  findAccountByProviderAccountId(
    tenantId: string | undefined,
    providerAccountId: string,
  ): Promise<FinancialAccount | null>;
  findAccountByProviderAccountIdAnyTenant(
    providerAccountId: string,
  ): Promise<FinancialAccount | null>;
  /** All accounts sharing a provider id (collision detection across tenants). */
  findAccountsByProviderAccountId(providerAccountId: string): Promise<FinancialAccount[]>;
  listConnectionsForUser(tenantId: string, userId: string): Promise<FinancialConnection[]>;
  listAccountsForUser(tenantId: string, userId: string): Promise<FinancialAccount[]>;
  findBrokerageDetail(tenantId: string, accountId: string): Promise<BrokerageAccount | null>;
  findMortgageDetail(tenantId: string, accountId: string): Promise<Mortgage | null>;
  findHelocDetail(tenantId: string, accountId: string): Promise<Heloc | null>;
  findOrdinaryBankDetail(tenantId: string, accountId: string): Promise<OrdinaryBankAccount | null>;
  createMortgage(
    tenantId: string,
    input: {
      accountId: string;
      outstandingPrincipalCents: bigint;
      contractualPaymentCents: bigint;
      expectedPaymentDay: number;
    },
  ): Promise<Mortgage>;
  createHeloc(
    tenantId: string,
    input: {
      accountId: string;
      creditLimitCents: bigint;
      balanceOwedCents: bigint;
      availableCreditCents: bigint;
    },
  ): Promise<Heloc>;
  createBrokerageAccount(tenantId: string, accountId: string): Promise<BrokerageAccount>;
  createOrdinaryBankAccount(tenantId: string, accountId: string): Promise<OrdinaryBankAccount>;
}

export function createAccountRepository(db: DbClient): AccountRepository {
  return {
    async createConnection(tenantId, input) {
      try {
        return await db.financialConnection.create({ data: { tenantId, ...input } });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    async createAccount(tenantId, input) {
      try {
        return await db.financialAccount.create({
          data: {
            tenantId,
            userId: input.userId,
            connectionId: input.connectionId,
            kind: input.kind,
            displayAlias: input.displayAlias,
            providerAccountId: input.providerAccountId,
            ...(input.accountNumberLast4 !== undefined
              ? { accountNumberLast4: input.accountNumberLast4 }
              : {}),
          },
        });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    findAccountById(tenantId, accountId) {
      return db.financialAccount.findFirst({ where: { id: accountId, tenantId } });
    },
    findAccountByProviderAccountId(tenantId, providerAccountId) {
      return db.financialAccount.findFirst({
        where: {
          providerAccountId,
          ...(tenantId !== undefined ? { tenantId } : {}),
        },
      });
    },
    findAccountByProviderAccountIdAnyTenant(providerAccountId) {
      return db.financialAccount.findFirst({ where: { providerAccountId } });
    },
    findAccountsByProviderAccountId(providerAccountId) {
      return db.financialAccount.findMany({ where: { providerAccountId } });
    },
    listConnectionsForUser(tenantId, userId) {
      return db.financialConnection.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
      });
    },
    listAccountsForUser(tenantId, userId) {
      return db.financialAccount.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
      });
    },
    findBrokerageDetail(tenantId, accountId) {
      return db.brokerageAccount.findFirst({ where: { tenantId, accountId } });
    },
    findMortgageDetail(tenantId, accountId) {
      return db.mortgage.findFirst({ where: { tenantId, accountId } });
    },
    findHelocDetail(tenantId, accountId) {
      return db.heloc.findFirst({ where: { tenantId, accountId } });
    },
    findOrdinaryBankDetail(tenantId, accountId) {
      return db.ordinaryBankAccount.findFirst({ where: { tenantId, accountId } });
    },
    async createMortgage(tenantId, input) {
      try {
        return await db.mortgage.create({ data: { tenantId, ...input } });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    async createHeloc(tenantId, input) {
      try {
        return await db.heloc.create({ data: { tenantId, ...input } });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    async createBrokerageAccount(tenantId, accountId) {
      try {
        return await db.brokerageAccount.create({ data: { tenantId, accountId } });
      } catch (error) {
        mapPrismaError(error);
      }
    },
    async createOrdinaryBankAccount(tenantId, accountId) {
      try {
        return await db.ordinaryBankAccount.create({ data: { tenantId, accountId } });
      } catch (error) {
        mapPrismaError(error);
      }
    },
  };
}
