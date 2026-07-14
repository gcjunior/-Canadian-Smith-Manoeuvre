import type { PrismaClient } from '@prisma/client';

import type { DbClient } from '../transaction.js';
import { createAccountRepository, type AccountRepository } from './account-repository.js';
import { createCycleRepository, type CycleRepository } from './cycle-repository.js';
import {
  createIdempotencyRepository,
  type IdempotencyRepository,
} from './idempotency-repository.js';
import { createLedgerRepository, type LedgerRepository } from './ledger-repository.js';
import { createStrategyRepository, type StrategyRepository } from './strategy-repository.js';
import { createTenantRepository, type TenantRepository } from './tenant-repository.js';
import { createUserRepository, type UserRepository } from './user-repository.js';
import { createWebhookRepository, type WebhookRepository } from './webhook-repository.js';

export interface Repositories {
  tenants: TenantRepository;
  users: UserRepository;
  accounts: AccountRepository;
  strategies: StrategyRepository;
  cycles: CycleRepository;
  ledger: LedgerRepository;
  idempotency: IdempotencyRepository;
  webhooks: WebhookRepository;
}

export function createRepositories(db: DbClient): Repositories {
  return {
    tenants: createTenantRepository(db),
    users: createUserRepository(db),
    accounts: createAccountRepository(db),
    strategies: createStrategyRepository(db),
    cycles: createCycleRepository(db),
    ledger: createLedgerRepository(db),
    idempotency: createIdempotencyRepository(db),
    webhooks: createWebhookRepository(db),
  };
}

export type { AccountRepository } from './account-repository.js';
export type { CycleRepository } from './cycle-repository.js';
export type { IdempotencyRepository } from './idempotency-repository.js';
export type { LedgerRepository } from './ledger-repository.js';
export type { StrategyRepository } from './strategy-repository.js';
export type { TenantRepository } from './tenant-repository.js';
export type { UserRepository } from './user-repository.js';
export type { WebhookRepository } from './webhook-repository.js';
export type { PrismaClient };
