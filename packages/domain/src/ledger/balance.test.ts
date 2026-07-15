import { describe, expect, it } from 'vitest';

import { assertLedgerBalanced, summarizeLedgerBalance } from './balance.js';
import { buildConversionLedgerPackage } from './event-ids.js';

describe('ledger balance', () => {
  it('summarizes debit and credit totals', () => {
    const summary = summarizeLedgerBalance([
      { direction: 'DEBIT', amountCents: 100n },
      { direction: 'CREDIT', amountCents: 60n },
      { direction: 'CREDIT', amountCents: 40n },
    ]);
    expect(summary.debitCents).toBe(100n);
    expect(summary.creditCents).toBe(100n);
    expect(summary.balanced).toBe(true);
  });

  it('$770 conversion package is debit==credit', () => {
    const legs = buildConversionLedgerPackage({
      cycleId: 'cycle-770',
      amountCents: 77_000n,
      remainingCashCents: 0n,
      mortgageAccountId: 'mtg',
      helocAccountId: 'heloc',
      bankAccountId: 'bank',
      brokerageCashAccountId: 'brkg-cash',
      brokeragePositionAccountId: 'brkg-cash',
    });
    const summary = summarizeLedgerBalance(legs);
    expect(summary.debitCents).toBe(77_000n * 3n);
    expect(summary.creditCents).toBe(77_000n * 3n);
    expect(summary.balanced).toBe(true);
    assertLedgerBalanced(legs);
  });

  it('assertLedgerBalanced throws on mismatch', () => {
    expect(() =>
      assertLedgerBalanced([
        { direction: 'DEBIT', amountCents: 100n },
        { direction: 'CREDIT', amountCents: 99n },
      ]),
    ).toThrow(/unbalanced/i);
  });
});
