/**
 * Deterministic businessEventId helpers for conversion / interest ledger packages.
 * Format: `{scope}:{cycleId}:{leg}` — stable across retries for idempotent append.
 */

export function conversionLedgerEventId(cycleId: string, leg: string): string {
  return `conversion:${cycleId}:${leg}`;
}

export function interestLedgerEventId(interestCycleId: string, leg: string): string {
  return `interest:${interestCycleId}:${leg}`;
}

export function compensatingLedgerEventId(
  originalBusinessEventId: string,
  reasonCode: string,
): string {
  return `compensate:${originalBusinessEventId}:${reasonCode}`;
}

/**
 * Full conversion ledger package for a settled draw of `amountCents` that is fully invested.
 * Example package ($770.00 = 77000¢): heloc draw + bank clearing + brokerage cash + ETF spend + remaining=0.
 */
export function buildConversionLedgerPackage(input: {
  cycleId: string;
  amountCents: bigint;
  remainingCashCents: bigint;
  mortgageAccountId: string;
  helocAccountId: string;
  bankAccountId: string;
  brokerageCashAccountId: string;
  brokeragePositionAccountId: string;
}): Array<{
  accountId: string;
  businessEventId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountCents: bigint;
  narrative: string;
  providerRefType?: string;
  providerRefId?: string;
}> {
  const amt = input.amountCents;
  const rem = input.remainingCashCents;
  const legs: Array<{
    accountId: string;
    businessEventId: string;
    direction: 'DEBIT' | 'CREDIT';
    amountCents: bigint;
    narrative: string;
  }> = [
    {
      accountId: input.helocAccountId,
      businessEventId: conversionLedgerEventId(input.cycleId, 'heloc-draw:debit'),
      direction: 'DEBIT',
      amountCents: amt,
      narrative: 'Increase HELOC liability (draw for investment)',
    },
    {
      accountId: input.bankAccountId,
      businessEventId: conversionLedgerEventId(input.cycleId, 'heloc-draw:credit'),
      direction: 'CREDIT',
      amountCents: amt,
      narrative: 'HELOC draw proceeds in ordinary bank (CLEARING path)',
    },
    {
      accountId: input.bankAccountId,
      businessEventId: conversionLedgerEventId(input.cycleId, 'brokerage-transfer:debit'),
      direction: 'DEBIT',
      amountCents: amt,
      narrative: 'Transfer out of ordinary bank to brokerage',
    },
    {
      accountId: input.brokerageCashAccountId,
      businessEventId: conversionLedgerEventId(input.cycleId, 'brokerage-transfer:credit'),
      direction: 'CREDIT',
      amountCents: amt,
      narrative: 'Brokerage cash deposit (non-registered)',
    },
    {
      accountId: input.brokerageCashAccountId,
      businessEventId: conversionLedgerEventId(input.cycleId, 'investment:debit'),
      direction: 'DEBIT',
      amountCents: amt - rem,
      narrative: 'Spend brokerage cash on ETF purchase',
    },
    {
      accountId: input.brokeragePositionAccountId,
      businessEventId: conversionLedgerEventId(input.cycleId, 'investment:credit'),
      direction: 'CREDIT',
      amountCents: amt - rem,
      narrative: 'Record ETF position (investment asset)',
    },
  ];

  if (rem > 0n) {
    // Balanced marker pair: remaining cash is explicitly held after the order.
    legs.push({
      accountId: input.brokerageCashAccountId,
      businessEventId: conversionLedgerEventId(input.cycleId, 'remaining-cash:hold'),
      direction: 'CREDIT',
      amountCents: rem,
      narrative: 'Explicit remaining brokerage cash after order',
    });
    legs.push({
      accountId: input.brokerageCashAccountId,
      businessEventId: conversionLedgerEventId(input.cycleId, 'remaining-cash:clear'),
      direction: 'DEBIT',
      amountCents: rem,
      narrative: 'Clear remaining cash marker (net zero with hold)',
    });
  }

  // Zero remaining cash is recorded via reconciliation item REMAINING_CASH_RECORDED (no zero-amount ledger row).
  return legs;
}
