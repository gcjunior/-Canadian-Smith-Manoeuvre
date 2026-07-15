import { summarizeLedgerBalance } from '../ledger/balance.js';
import type { ReconCheckItem } from './conversion-chain.js';

export interface InterestReconFacts {
  chargeState: string | null;
  chargeAmountCents: bigint | null;
  chargePeriod: string | null;
  expectedPeriod: string;
  debitState: string | null;
  debitAmountCents: bigint | null;
  debitReversed: boolean;
  ordinaryAccountId: string | null;
  configuredOrdinaryAccountId: string;
  helocIdentifiedOnDebit: boolean;
  ledgerLegs: Array<{ direction: 'DEBIT' | 'CREDIT'; amountCents: bigint }>;
}

function item(
  code: string,
  pass: boolean,
  expected: string | null,
  actual: string | null,
  detail?: string,
): ReconCheckItem {
  return {
    code,
    result: pass ? 'PASS' : 'FAIL',
    expectedValue: expected,
    actualValue: actual,
    detail: detail ?? null,
  };
}

/**
 * Five-point HELOC interest reconciliation chain.
 */
export function evaluateInterestReconciliation(facts: InterestReconFacts): ReconCheckItem[] {
  const items: ReconCheckItem[] = [];

  items.push(
    item(
      'INTEREST_CHARGE_PRESENT',
      facts.chargeState === 'POSTED' || facts.chargeState === 'SETTLED',
      'POSTED',
      facts.chargeState,
    ),
  );

  items.push(
    item(
      'ORDINARY_DEBIT_PRESENT',
      facts.debitState === 'SETTLED' &&
        facts.ordinaryAccountId === facts.configuredOrdinaryAccountId,
      facts.configuredOrdinaryAccountId,
      facts.ordinaryAccountId,
    ),
  );

  items.push(
    item(
      'DEBIT_IDENTIFIES_HELOC',
      facts.helocIdentifiedOnDebit,
      'true',
      facts.helocIdentifiedOnDebit ? 'true' : 'false',
      'Debit destination/reference must identify the HELOC',
    ),
  );

  items.push(
    item(
      'AMOUNT_AND_PERIOD_MATCH',
      Boolean(
        facts.chargeAmountCents !== null &&
          facts.debitAmountCents !== null &&
          facts.chargeAmountCents === facts.debitAmountCents &&
          facts.chargePeriod === facts.expectedPeriod,
      ),
      `${facts.expectedPeriod}:${facts.chargeAmountCents?.toString() ?? '?'}`,
      `${facts.chargePeriod ?? '?'}:${facts.debitAmountCents?.toString() ?? '?'}`,
    ),
  );

  items.push(
    item(
      'PAYMENT_SETTLED_NOT_REVERSED',
      facts.debitState === 'SETTLED' && !facts.debitReversed,
      'SETTLED',
      facts.debitReversed ? 'REVERSED' : facts.debitState,
    ),
  );

  const balance = summarizeLedgerBalance(facts.ledgerLegs);
  items.push(
    item(
      'LEDGER_BALANCED',
      balance.balanced,
      balance.creditCents.toString(),
      balance.debitCents.toString(),
    ),
  );

  return items;
}

export function interestReconciliationPassed(items: ReconCheckItem[]): boolean {
  return items.every((i) => i.result !== 'FAIL');
}
