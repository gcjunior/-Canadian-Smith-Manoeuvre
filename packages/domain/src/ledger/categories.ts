/** Chart-of-accounts categories used on posted ledger rows. */
export const LEDGER_ACCOUNT_CATEGORIES = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
  'CLEARING',
] as const;

export type LedgerAccountCategory = (typeof LEDGER_ACCOUNT_CATEGORIES)[number];

/** Map product FinancialAccountKind → accounting category. */
export function categoryForAccountKind(kind: string): LedgerAccountCategory {
  switch (kind) {
    case 'MORTGAGE':
    case 'HELOC':
      return 'LIABILITY';
    case 'BANK_OPERATING':
    case 'BROKERAGE_CASH':
    case 'BROKERAGE_POSITION':
      return 'ASSET';
    default:
      return 'CLEARING';
  }
}
