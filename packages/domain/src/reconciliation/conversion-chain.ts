import { depositMatchesTransfer } from '../ledger/fees.js';
import { summarizeLedgerBalance } from '../ledger/balance.js';

export type ReconItemResult = 'PASS' | 'FAIL' | 'WARN';

export interface ReconCheckItem {
  code: string;
  result: ReconItemResult;
  expectedValue: string | null;
  actualValue: string | null;
  detail: string | null;
}

export interface ConversionReconFacts {
  mortgagePaymentState: string | null;
  principalRepaidCents: bigint | null;
  paymentPeriod: string;
  helocCreditRelatedPeriod: string | null;
  newlyAvailableCreditCents: bigint | null;
  drawAmountCents: bigint | null;
  drawState: string | null;
  drawProviderTxId: string | null;
  transferAmountCents: bigint | null;
  transferState: string | null;
  transferProviderTxId: string | null;
  depositAmountCents: bigint | null;
  depositState: string | null;
  depositProviderId: string | null;
  depositFeeCents: bigint;
  orderNotionalCents: bigint | null;
  orderState: string | null;
  orderSymbol: string | null;
  orderBrokerageAccountId: string | null;
  expectedSymbol: string;
  expectedBrokerageAccountId: string;
  fillOrderId: string | null;
  fillAmountCents: bigint | null;
  remainingCashCents: bigint | null;
  remainingCashExplicitlyRecorded: boolean;
  providerTxLinkedElsewhere: boolean;
  movementsCrossTenantOrUser: boolean;
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
 * Eleven-point monthly conversion money-trail reconciliation.
 */
export function evaluateConversionReconciliation(facts: ConversionReconFacts): ReconCheckItem[] {
  const items: ReconCheckItem[] = [];

  items.push(
    item(
      'MORTGAGE_PAYMENT_SETTLED',
      facts.mortgagePaymentState === 'SETTLED',
      'SETTLED',
      facts.mortgagePaymentState,
    ),
  );

  items.push(
    item(
      'PRINCIPAL_POSITIVE',
      facts.principalRepaidCents !== null && facts.principalRepaidCents > 0n,
      '>0',
      facts.principalRepaidCents?.toString() ?? null,
    ),
  );

  items.push(
    item(
      'HELOC_CREDIT_FOR_PERIOD',
      facts.helocCreditRelatedPeriod === facts.paymentPeriod &&
        facts.newlyAvailableCreditCents !== null &&
        facts.newlyAvailableCreditCents > 0n,
      facts.paymentPeriod,
      facts.helocCreditRelatedPeriod,
      'HELOC credit event must associate with mortgage settlement period',
    ),
  );

  // Draw must not exceed newly available credit / calculated investment amount.
  items.push(
    item(
      'DRAW_WITHIN_CAPACITY',
      Boolean(
        facts.drawState === 'SETTLED' &&
          facts.drawAmountCents !== null &&
          facts.drawAmountCents > 0n &&
          facts.newlyAvailableCreditCents !== null &&
          facts.drawAmountCents <= facts.newlyAvailableCreditCents,
      ),
      facts.newlyAvailableCreditCents?.toString() ?? null,
      facts.drawAmountCents?.toString() ?? null,
      'HELOC draw must not exceed newly available / calculated investment amount',
    ),
  );

  items.push(
    item(
      'TRANSFER_MATCHES_DRAW',
      Boolean(
        facts.drawAmountCents !== null &&
          facts.transferAmountCents !== null &&
          facts.transferState === 'SETTLED' &&
          facts.drawAmountCents === facts.transferAmountCents,
      ),
      facts.drawAmountCents?.toString() ?? null,
      facts.transferAmountCents?.toString() ?? null,
    ),
  );

  items.push(
    item(
      'DEPOSIT_MATCHES_TRANSFER',
      Boolean(
        facts.transferAmountCents !== null &&
          facts.depositAmountCents !== null &&
          facts.depositState === 'SETTLED' &&
          depositMatchesTransfer({
            transferCents: facts.transferAmountCents,
            depositCents: facts.depositAmountCents,
            feeCents: facts.depositFeeCents,
          }),
      ),
      facts.transferAmountCents?.toString() ?? null,
      facts.depositAmountCents?.toString() ?? null,
      'Deposit must match transfer after explicitly supported fees only',
    ),
  );

  items.push(
    item(
      'ORDER_WITHIN_CASH',
      Boolean(
        facts.orderNotionalCents !== null &&
          facts.depositAmountCents !== null &&
          facts.orderState === 'FILLED' &&
          facts.orderNotionalCents <= facts.depositAmountCents,
      ),
      `<=${facts.depositAmountCents?.toString() ?? '?'}`,
      facts.orderNotionalCents?.toString() ?? null,
    ),
  );

  items.push(
    item(
      'FILL_MATCHES_ORDER',
      Boolean(
        facts.orderState === 'FILLED' &&
          facts.orderSymbol === facts.expectedSymbol &&
          facts.orderBrokerageAccountId === facts.expectedBrokerageAccountId &&
          (facts.fillOrderId === null || facts.fillAmountCents !== null),
      ),
      facts.expectedSymbol,
      facts.orderSymbol,
      'Fill must belong to expected order, account, and symbol',
    ),
  );

  const remaining =
    facts.remainingCashCents ??
    (facts.depositAmountCents !== null && facts.orderNotionalCents !== null
      ? facts.depositAmountCents - facts.orderNotionalCents
      : null);
  items.push(
    item(
      'REMAINING_CASH_RECORDED',
      remaining !== null && facts.remainingCashExplicitlyRecorded,
      remaining?.toString() ?? null,
      facts.remainingCashExplicitlyRecorded ? (remaining?.toString() ?? null) : null,
      'Remaining cash after order must be explicitly recorded (including zero)',
    ),
  );

  items.push(
    item(
      'PROVIDER_TX_UNIQUE',
      !facts.providerTxLinkedElsewhere,
      'unique',
      facts.providerTxLinkedElsewhere ? 'linked_elsewhere' : 'unique',
      'No provider transaction may already be linked to another cycle',
    ),
  );

  items.push(
    item(
      'TENANT_BOUNDARY',
      !facts.movementsCrossTenantOrUser,
      'same_tenant_user',
      facts.movementsCrossTenantOrUser ? 'cross_boundary' : 'ok',
      'Money movements must not cross tenant or user boundaries',
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

export function conversionReconciliationPassed(items: ReconCheckItem[]): boolean {
  return items.every((i) => i.result !== 'FAIL');
}
