import { describe, expect, it } from 'vitest';

import { DomainError } from '../errors.js';
import {
  assertInterestAmountsEqual,
  assertInterestDebitSourceAllowed,
  INTEREST_FAILURE_POLICY,
  shouldPauseFutureConversionsOnInterestFailure,
} from './rules.js';

describe('interest rules', () => {
  it('requires exact amount match', () => {
    expect(() => assertInterestAmountsEqual(100n, 100n)).not.toThrow();
    expect(() => assertInterestAmountsEqual(100n, 99n)).toThrow(DomainError);
  });

  it('allows only configured BANK_OPERATING source', () => {
    expect(() =>
      assertInterestDebitSourceAllowed({
        sourceAccountKind: 'BANK_OPERATING',
        sourceAccountId: 'bank-1',
        configuredOrdinaryAccountId: 'bank-1',
        helocAccountId: 'heloc-1',
        brokerageAccountId: 'brok-1',
      }),
    ).not.toThrow();

    expect(() =>
      assertInterestDebitSourceAllowed({
        sourceAccountKind: 'BROKERAGE_CASH',
        sourceAccountId: 'brok-1',
        configuredOrdinaryAccountId: 'bank-1',
        helocAccountId: 'heloc-1',
        brokerageAccountId: 'brok-1',
      }),
    ).toThrow(DomainError);
  });

  it('defaults to pausing future conversions on interest failure', () => {
    expect(INTEREST_FAILURE_POLICY.pauseFutureConversions).toBe(true);
    expect(INTEREST_FAILURE_POLICY.pauseInterestMonitoringOnly).toBe(false);
    expect(shouldPauseFutureConversionsOnInterestFailure()).toBe(true);
  });
});
