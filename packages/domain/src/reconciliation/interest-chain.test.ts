import { describe, expect, it } from 'vitest';

import {
  evaluateInterestReconciliation,
  interestReconciliationPassed,
  type InterestReconFacts,
} from './interest-chain.js';

function baseFacts(overrides: Partial<InterestReconFacts> = {}): InterestReconFacts {
  const amount = 25_000n;
  return {
    chargeState: 'POSTED',
    chargeAmountCents: amount,
    chargePeriod: '2026-07',
    expectedPeriod: '2026-07',
    debitState: 'SETTLED',
    debitAmountCents: amount,
    debitReversed: false,
    ordinaryAccountId: 'ordinary-1',
    configuredOrdinaryAccountId: 'ordinary-1',
    helocIdentifiedOnDebit: true,
    ledgerLegs: [
      { direction: 'DEBIT', amountCents: amount },
      { direction: 'CREDIT', amountCents: amount },
    ],
    ...overrides,
  };
}

describe('evaluateInterestReconciliation', () => {
  it('passes a balanced interest package', () => {
    const items = evaluateInterestReconciliation(baseFacts());
    expect(interestReconciliationPassed(items)).toBe(true);
    expect(items.find((i) => i.code === 'LEDGER_BALANCED')?.result).toBe('PASS');
  });

  it('fails on amount mismatch', () => {
    const items = evaluateInterestReconciliation(baseFacts({ debitAmountCents: 24_999n }));
    expect(interestReconciliationPassed(items)).toBe(false);
    expect(items.find((i) => i.code === 'AMOUNT_AND_PERIOD_MATCH')?.result).toBe('FAIL');
  });

  it('fails when ledger is unbalanced', () => {
    const items = evaluateInterestReconciliation(
      baseFacts({
        ledgerLegs: [
          { direction: 'DEBIT', amountCents: 25_000n },
          { direction: 'CREDIT', amountCents: 1n },
        ],
      }),
    );
    expect(items.find((i) => i.code === 'LEDGER_BALANCED')?.result).toBe('FAIL');
  });
});
