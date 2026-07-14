import { describe, expect, it } from 'vitest';

import { DomainError } from '../errors.js';
import { assertStrategyAccountBindings } from './account-validation.js';

const base = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
};

function acct(kind: 'MORTGAGE' | 'HELOC' | 'BANK_OPERATING' | 'BROKERAGE_CASH', id: string) {
  return {
    id,
    tenantId: base.tenantId,
    userId: base.userId,
    kind,
  };
}

describe('assertStrategyAccountBindings', () => {
  it('accepts matching tenant/user/kinds', () => {
    expect(() =>
      assertStrategyAccountBindings({
        ...base,
        mortgage: acct('MORTGAGE', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        heloc: acct('HELOC', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        bankOperating: acct('BANK_OPERATING', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        brokerageCash: acct('BROKERAGE_CASH', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
      }),
    ).not.toThrow();
  });

  it('rejects cross-tenant account', () => {
    expect(() =>
      assertStrategyAccountBindings({
        ...base,
        mortgage: {
          ...acct('MORTGAGE', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
          tenantId: '99999999-9999-4999-8999-999999999999',
        },
        heloc: acct('HELOC', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        bankOperating: acct('BANK_OPERATING', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        brokerageCash: acct('BROKERAGE_CASH', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
      }),
    ).toThrow(DomainError);
  });

  it('rejects wrong account kind', () => {
    expect(() =>
      assertStrategyAccountBindings({
        ...base,
        mortgage: acct('HELOC', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        heloc: acct('HELOC', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        bankOperating: acct('BANK_OPERATING', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        brokerageCash: acct('BROKERAGE_CASH', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
      }),
    ).toThrow(/must be MORTGAGE/);
  });
});
