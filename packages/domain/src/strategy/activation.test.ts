import { describe, expect, it } from 'vitest';

import { assertStrategyActivation } from '@csm/domain';

describe('assertStrategyActivation', () => {
  const baseAccounts = {
    mortgage: {
      id: '1',
      tenantId: 't',
      userId: 'u',
      kind: 'MORTGAGE' as const,
    },
    heloc: { id: '2', tenantId: 't', userId: 'u', kind: 'HELOC' as const },
    bankOperating: {
      id: '3',
      tenantId: 't',
      userId: 'u',
      kind: 'BANK_OPERATING' as const,
    },
    brokerageCash: {
      id: '4',
      tenantId: 't',
      userId: 'u',
      kind: 'BROKERAGE_CASH' as const,
    },
    brokerageRegistrationType: 'NON_REGISTERED' as const,
    mortgageCapabilitiesOk: true,
    helocCapabilitiesOk: true,
    bankCapabilitiesOk: true,
    brokerageCapabilitiesOk: true,
  };

  it('accepts a valid activation bundle', () => {
    expect(() =>
      assertStrategyActivation({
        tenantId: 't',
        userId: 'u',
        timezone: 'America/Toronto',
        expectedPaymentDay: 1,
        acknowledgeRiskDisclosures: true,
        accounts: baseAccounts,
        policy: {
          symbol: 'XEQT',
          userMonthlyCapCents: 100_000n,
          platformMonthlyDrawCapCents: 500_000n,
        },
        incompatiblyLinkedAccountIds: [],
      }),
    ).not.toThrow();
  });

  it('rejects registered brokerage and linked accounts', () => {
    expect(() =>
      assertStrategyActivation({
        tenantId: 't',
        userId: 'u',
        timezone: 'America/Toronto',
        expectedPaymentDay: 1,
        acknowledgeRiskDisclosures: true,
        accounts: { ...baseAccounts, brokerageRegistrationType: 'TFSA' },
        policy: {
          symbol: 'XEQT',
          userMonthlyCapCents: 100_000n,
          platformMonthlyDrawCapCents: 500_000n,
        },
        incompatiblyLinkedAccountIds: [],
      }),
    ).toThrow(/non-registered/);

    expect(() =>
      assertStrategyActivation({
        tenantId: 't',
        userId: 'u',
        timezone: 'America/Toronto',
        expectedPaymentDay: 1,
        acknowledgeRiskDisclosures: true,
        accounts: baseAccounts,
        policy: {
          symbol: 'XEQT',
          userMonthlyCapCents: 100_000n,
          platformMonthlyDrawCapCents: 500_000n,
        },
        incompatiblyLinkedAccountIds: ['1'],
      }),
    ).toThrow(/already linked/);
  });
});
