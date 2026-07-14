import { DomainError } from '../errors.js';
import type { AccountId, TenantId, UserId } from '../value-objects/ids.js';

export type FinancialAccountKind =
  | 'MORTGAGE'
  | 'HELOC'
  | 'BANK_OPERATING'
  | 'BROKERAGE_CASH'
  | 'BROKERAGE_POSITION';

export interface AccountRef {
  id: AccountId | string;
  tenantId: TenantId | string;
  userId: UserId | string;
  kind: FinancialAccountKind;
}

export interface StrategyAccountBindings {
  tenantId: TenantId | string;
  userId: UserId | string;
  mortgage: AccountRef;
  heloc: AccountRef;
  bankOperating: AccountRef;
  brokerageCash: AccountRef;
}

/**
 * Ensures strategy-linked accounts belong to the strategy tenant/user and have correct kinds.
 * Same-tenant/same-user is also enforced by composite FKs; kind checks are domain-only.
 */
export function assertStrategyAccountBindings(input: StrategyAccountBindings): void {
  const expected = [
    { ref: input.mortgage, kind: 'MORTGAGE' as const, label: 'mortgage' },
    { ref: input.heloc, kind: 'HELOC' as const, label: 'heloc' },
    { ref: input.bankOperating, kind: 'BANK_OPERATING' as const, label: 'bankOperating' },
    { ref: input.brokerageCash, kind: 'BROKERAGE_CASH' as const, label: 'brokerageCash' },
  ];

  for (const item of expected) {
    if (item.ref.tenantId !== input.tenantId) {
      throw new DomainError(
        'TENANT_SCOPE_VIOLATION',
        `Strategy ${item.label} account is in another tenant`,
        {
          expectedTenantId: input.tenantId,
          actualTenantId: item.ref.tenantId,
        },
      );
    }
    if (item.ref.userId !== input.userId) {
      throw new DomainError(
        'OWNERSHIP_VIOLATION',
        `Strategy ${item.label} account belongs to another user`,
        {
          expectedUserId: input.userId,
          actualUserId: item.ref.userId,
        },
      );
    }
    if (item.ref.kind !== item.kind) {
      throw new DomainError(
        'INVALID_ACCOUNT_KIND',
        `Strategy ${item.label} account must be ${item.kind}`,
        {
          actualKind: item.ref.kind,
        },
      );
    }
  }

  const ids = expected.map((e) => e.ref.id);
  if (new Set(ids).size !== ids.length) {
    throw new DomainError(
      'OWNERSHIP_VIOLATION',
      'Strategy account bindings must reference distinct accounts',
    );
  }
}
