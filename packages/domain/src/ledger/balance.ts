export interface LedgerBalanceLeg {
  direction: 'DEBIT' | 'CREDIT';
  amountCents: bigint;
}

export interface LedgerBalanceSummary {
  debitCents: bigint;
  creditCents: bigint;
  balanced: boolean;
}

export function summarizeLedgerBalance(legs: LedgerBalanceLeg[]): LedgerBalanceSummary {
  let debitCents = 0n;
  let creditCents = 0n;
  for (const leg of legs) {
    if (leg.amountCents <= 0n) {
      continue;
    }
    if (leg.direction === 'DEBIT') {
      debitCents += leg.amountCents;
    } else {
      creditCents += leg.amountCents;
    }
  }
  return {
    debitCents,
    creditCents,
    balanced: debitCents === creditCents,
  };
}

export function assertLedgerBalanced(legs: LedgerBalanceLeg[]): void {
  const summary = summarizeLedgerBalance(legs);
  if (!summary.balanced) {
    throw new Error(
      `Ledger unbalanced: debit=${summary.debitCents.toString()} credit=${summary.creditCents.toString()}`,
    );
  }
}
