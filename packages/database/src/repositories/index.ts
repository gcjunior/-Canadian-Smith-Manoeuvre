import type { PrismaClient } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { createAccountRepository, type AccountRepository } from './account-repository.js';
import { createAuditRepository, type AuditRepository } from './audit-repository.js';
import { createCycleRepository, type CycleRepository } from './cycle-repository.js';
import { createExceptionRepository, type ExceptionRepository } from './exception-repository.js';
import {
  createIdempotencyRepository,
  type IdempotencyRepository,
} from './idempotency-repository.js';
import {
  createInterestCycleRepository,
  type InterestCycleRepository,
} from './interest-cycle-repository.js';
import { createInterestRepository, type InterestRepository } from './interest-repository.js';
import {
  createInvestmentOrderRepository,
  type InvestmentOrderRepository,
} from './investment-order-repository.js';
import { createLedgerRepository, type LedgerRepository } from './ledger-repository.js';
import {
  createBrokerageDepositRepository,
  type BrokerageDepositRepository,
} from './brokerage-deposit-repository.js';
import {
  createDailyReconciliationReportRepository,
  type DailyReconciliationReportRepository,
} from './daily-reconciliation-report-repository.js';
import {
  createMoneyMovementRepository,
  type MoneyMovementRepository,
} from './money-movement-repository.js';
import {
  createMortgagePaymentRepository,
  type MortgagePaymentRepository,
} from './mortgage-payment-repository.js';
import {
  createReconciliationRepository,
  type ReconciliationRepository,
} from './reconciliation-repository.js';
import {
  createStrategyScheduleRepository,
  type StrategyScheduleRepository,
} from './strategy-schedule-repository.js';
import { createStrategyRepository, type StrategyRepository } from './strategy-repository.js';
import { createTenantRepository, type TenantRepository } from './tenant-repository.js';
import { createUserRepository, type UserRepository } from './user-repository.js';
import { createWebhookRepository, type WebhookRepository } from './webhook-repository.js';

export interface Repositories {
  tenants: TenantRepository;
  users: UserRepository;
  accounts: AccountRepository;
  strategies: StrategyRepository;
  strategySchedules: StrategyScheduleRepository;
  cycles: CycleRepository;
  interestCycles: InterestCycleRepository;
  interest: InterestRepository;
  ledger: LedgerRepository;
  idempotency: IdempotencyRepository;
  webhooks: WebhookRepository;
  audit: AuditRepository;
  exceptions: ExceptionRepository;
  moneyMovements: MoneyMovementRepository;
  mortgagePayments: MortgagePaymentRepository;
  investmentOrders: InvestmentOrderRepository;
  brokerageDeposits: BrokerageDepositRepository;
  reconciliations: ReconciliationRepository;
  dailyReconciliationReports: DailyReconciliationReportRepository;
}

export function createRepositories(db: DbClient): Repositories {
  return {
    tenants: createTenantRepository(db),
    users: createUserRepository(db),
    accounts: createAccountRepository(db),
    strategies: createStrategyRepository(db),
    strategySchedules: createStrategyScheduleRepository(db),
    cycles: createCycleRepository(db),
    interestCycles: createInterestCycleRepository(db),
    interest: createInterestRepository(db),
    ledger: createLedgerRepository(db),
    idempotency: createIdempotencyRepository(db),
    webhooks: createWebhookRepository(db),
    audit: createAuditRepository(db),
    exceptions: createExceptionRepository(db),
    moneyMovements: createMoneyMovementRepository(db),
    mortgagePayments: createMortgagePaymentRepository(db),
    investmentOrders: createInvestmentOrderRepository(db),
    brokerageDeposits: createBrokerageDepositRepository(db),
    reconciliations: createReconciliationRepository(db),
    dailyReconciliationReports: createDailyReconciliationReportRepository(db),
  };
}

export type { AccountRepository } from './account-repository.js';
export type { AuditRepository } from './audit-repository.js';
export type { CycleRepository } from './cycle-repository.js';
export type { ExceptionRepository } from './exception-repository.js';
export type { IdempotencyRepository } from './idempotency-repository.js';
export type { InterestCycleRepository } from './interest-cycle-repository.js';
export type { InterestRepository } from './interest-repository.js';
export type { InvestmentOrderRepository } from './investment-order-repository.js';
export type { LedgerRepository, LedgerAppendInput, LedgerSumFilter } from './ledger-repository.js';
export type { MoneyMovementRepository } from './money-movement-repository.js';
export type { MortgagePaymentRepository } from './mortgage-payment-repository.js';
export type { BrokerageDepositRepository } from './brokerage-deposit-repository.js';
export type { ReconciliationRepository } from './reconciliation-repository.js';
export type {
  DailyReconciliationReportRepository,
  DailyReconciliationReportUpsertInput,
} from './daily-reconciliation-report-repository.js';
export type { StrategyScheduleRepository } from './strategy-schedule-repository.js';
export type { StrategyRepository } from './strategy-repository.js';
export type { TenantRepository } from './tenant-repository.js';
export type { UserRepository } from './user-repository.js';
export type { WebhookRepository } from './webhook-repository.js';
export {
  WEBHOOK_MAX_ATTEMPTS,
  nextWebhookAttemptAt,
  createWebhookRepository,
} from './webhook-repository.js';
export type { PrismaClient };
