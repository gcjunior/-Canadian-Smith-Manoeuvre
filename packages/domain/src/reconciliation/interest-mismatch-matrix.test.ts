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

describe('interest reconciliation failure matrix', () => {
  it('fails INTEREST_CHARGE_PRESENT when charge missing', () => {
    const items = evaluateInterestReconciliation(baseFacts({ chargeState: null }));
    expect(items.find((i) => i.code === 'INTEREST_CHARGE_PRESENT')?.result).toBe('FAIL');
  });

  it('fails ORDINARY_DEBIT_PRESENT when debit from unexpected account', () => {
    const items = evaluateInterestReconciliation(baseFacts({ ordinaryAccountId: 'wrong-account' }));
    expect(items.find((i) => i.code === 'ORDINARY_DEBIT_PRESENT')?.result).toBe('FAIL');
  });

  it('fails DEBIT_IDENTIFIES_HELOC when HELOC not identified', () => {
    const items = evaluateInterestReconciliation(baseFacts({ helocIdentifiedOnDebit: false }));
    expect(items.find((i) => i.code === 'DEBIT_IDENTIFIES_HELOC')?.result).toBe('FAIL');
  });

  it('fails AMOUNT_AND_PERIOD_MATCH on amount mismatch', () => {
    const items = evaluateInterestReconciliation(baseFacts({ debitAmountCents: 24_999n }));
    expect(items.find((i) => i.code === 'AMOUNT_AND_PERIOD_MATCH')?.result).toBe('FAIL');
  });

  it('fails PAYMENT_SETTLED_NOT_REVERSED when debit reversed', () => {
    const items = evaluateInterestReconciliation(baseFacts({ debitReversed: true }));
    expect(items.find((i) => i.code === 'PAYMENT_SETTLED_NOT_REVERSED')?.result).toBe('FAIL');
  });

  it('fails LEDGER_BALANCED on imbalance', () => {
    const items = evaluateInterestReconciliation(
      baseFacts({
        ledgerLegs: [
          { direction: 'DEBIT', amountCents: 25_000n },
          { direction: 'CREDIT', amountCents: 10n },
        ],
      }),
    );
    expect(interestReconciliationPassed(items)).toBe(false);
    expect(items.find((i) => i.code === 'LEDGER_BALANCED')?.result).toBe('FAIL');
  });

  it('rerun of failing interest recon is stable', () => {
    const facts = baseFacts({ debitReversed: true });
    expect(evaluateInterestReconciliation(facts)).toEqual(evaluateInterestReconciliation(facts));
  });
});
