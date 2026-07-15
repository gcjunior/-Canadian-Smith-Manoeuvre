import { describe, expect, it } from 'vitest';

import { buildConversionLedgerPackage } from '../ledger/event-ids.js';
import {
  conversionReconciliationPassed,
  evaluateConversionReconciliation,
  type ConversionReconFacts,
} from './conversion-chain.js';

function baseFacts(overrides: Partial<ConversionReconFacts> = {}): ConversionReconFacts {
  const amount = 77_000n;
  const legs = buildConversionLedgerPackage({
    cycleId: 'c1',
    amountCents: amount,
    remainingCashCents: 0n,
    mortgageAccountId: 'mtg',
    helocAccountId: 'heloc',
    bankAccountId: 'bank',
    brokerageCashAccountId: 'cash',
    brokeragePositionAccountId: 'cash',
  });
  return {
    mortgagePaymentState: 'SETTLED',
    principalRepaidCents: amount,
    paymentPeriod: '2026-07',
    helocCreditRelatedPeriod: '2026-07',
    newlyAvailableCreditCents: amount,
    drawAmountCents: amount,
    drawState: 'SETTLED',
    drawProviderTxId: 'draw-1',
    transferAmountCents: amount,
    transferState: 'SETTLED',
    transferProviderTxId: 'xfer-1',
    depositAmountCents: amount,
    depositState: 'SETTLED',
    depositProviderId: 'dep-1',
    depositFeeCents: 0n,
    orderNotionalCents: amount,
    orderState: 'FILLED',
    orderSymbol: 'VCN.TO',
    orderBrokerageAccountId: 'brkg-facility',
    expectedSymbol: 'VCN.TO',
    expectedBrokerageAccountId: 'brkg-facility',
    fillOrderId: 'order-1',
    fillAmountCents: amount,
    remainingCashCents: 0n,
    remainingCashExplicitlyRecorded: true,
    providerTxLinkedElsewhere: false,
    movementsCrossTenantOrUser: false,
    ledgerLegs: legs.map((l) => ({ direction: l.direction, amountCents: l.amountCents })),
    ...overrides,
  };
}

describe('evaluateConversionReconciliation', () => {
  it('passes all conversion checks for a balanced $770 package', () => {
    const items = evaluateConversionReconciliation(baseFacts());
    expect(items.map((i) => i.code)).toEqual([
      'MORTGAGE_PAYMENT_SETTLED',
      'PRINCIPAL_POSITIVE',
      'HELOC_CREDIT_FOR_PERIOD',
      'DRAW_WITHIN_CAPACITY',
      'TRANSFER_MATCHES_DRAW',
      'DEPOSIT_MATCHES_TRANSFER',
      'ORDER_WITHIN_CASH',
      'FILL_MATCHES_ORDER',
      'REMAINING_CASH_RECORDED',
      'PROVIDER_TX_UNIQUE',
      'TENANT_BOUNDARY',
      'LEDGER_BALANCED',
    ]);
    expect(conversionReconciliationPassed(items)).toBe(true);
    expect(items.every((i) => i.result === 'PASS')).toBe(true);
  });

  it('fails on amount mismatch between draw and transfer', () => {
    const items = evaluateConversionReconciliation(baseFacts({ transferAmountCents: 76_999n }));
    expect(conversionReconciliationPassed(items)).toBe(false);
    expect(items.find((i) => i.code === 'TRANSFER_MATCHES_DRAW')?.result).toBe('FAIL');
  });

  it('fails when provider transaction is linked elsewhere', () => {
    const items = evaluateConversionReconciliation(baseFacts({ providerTxLinkedElsewhere: true }));
    expect(items.find((i) => i.code === 'PROVIDER_TX_UNIQUE')?.result).toBe('FAIL');
  });
});
