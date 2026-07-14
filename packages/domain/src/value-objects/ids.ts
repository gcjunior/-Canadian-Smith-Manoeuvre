import { randomUUID } from 'node:crypto';

import { DomainError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantId = string & { readonly __brand: 'TenantId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type StrategyId = string & { readonly __brand: 'StrategyId' };
export type AccountId = string & { readonly __brand: 'AccountId' };
export type CycleId = string & { readonly __brand: 'CycleId' };

export function newId(): string {
  return randomUUID();
}

export function assertUuid(value: string, label = 'id'): string {
  if (!UUID_RE.test(value)) {
    throw new DomainError('TENANT_SCOPE_VIOLATION', `Invalid UUID for ${label}`);
  }
  return value;
}

export function asTenantId(value: string): TenantId {
  return assertUuid(value, 'tenantId') as TenantId;
}

export function asUserId(value: string): UserId {
  return assertUuid(value, 'userId') as UserId;
}

export function asStrategyId(value: string): StrategyId {
  return assertUuid(value, 'strategyId') as StrategyId;
}

export function asAccountId(value: string): AccountId {
  return assertUuid(value, 'accountId') as AccountId;
}

export function asCycleId(value: string): CycleId {
  return assertUuid(value, 'cycleId') as CycleId;
}
