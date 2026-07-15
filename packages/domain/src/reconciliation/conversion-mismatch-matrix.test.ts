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

function expectFail(code: string, overrides: Partial<ConversionReconFacts>) {
  const items = evaluateConversionReconciliation(baseFacts(overrides));
  expect(conversionReconciliationPassed(items)).toBe(false);
  expect(items.find((i) => i.code === code)?.result).toBe('FAIL');
}

describe('conversion reconciliation mismatch matrix', () => {
  it('fails MORTGAGE_PAYMENT_SETTLED when payment is not SETTLED', () => {
    expectFail('MORTGAGE_PAYMENT_SETTLED', { mortgagePaymentState: 'POSTED' });
  });

  it('fails PRINCIPAL_POSITIVE when principal is zero', () => {
    expectFail('PRINCIPAL_POSITIVE', { principalRepaidCents: 0n });
  });

  it('fails HELOC_CREDIT_FOR_PERIOD on period mismatch', () => {
    expectFail('HELOC_CREDIT_FOR_PERIOD', { helocCreditRelatedPeriod: '2026-06' });
  });

  it('fails DRAW_WITHIN_CAPACITY when draw exceeds newly available credit', () => {
    expectFail('DRAW_WITHIN_CAPACITY', { drawAmountCents: 77_001n });
  });

  it('fails TRANSFER_MATCHES_DRAW on amount mismatch', () => {
    expectFail('TRANSFER_MATCHES_DRAW', { transferAmountCents: 76_999n });
  });

  it('fails DEPOSIT_MATCHES_TRANSFER on amount mismatch', () => {
    expectFail('DEPOSIT_MATCHES_TRANSFER', { depositAmountCents: 76_500n });
  });

  it('fails ORDER_WITHIN_CASH when notional exceeds deposit', () => {
    expectFail('ORDER_WITHIN_CASH', { orderNotionalCents: 80_000n });
  });

  it('fails FILL_MATCHES_ORDER when fill amount is missing', () => {
    expectFail('FILL_MATCHES_ORDER', { fillOrderId: 'order-1', fillAmountCents: null });
  });

  it('fails FILL_MATCHES_ORDER when symbol policy changed mid-cycle', () => {
    expectFail('FILL_MATCHES_ORDER', {
      orderSymbol: 'VFV.TO',
      expectedSymbol: 'VCN.TO',
    });
  });

  it('fails REMAINING_CASH_RECORDED when remaining cash is not recorded', () => {
    expectFail('REMAINING_CASH_RECORDED', { remainingCashExplicitlyRecorded: false });
  });

  it('fails PROVIDER_TX_UNIQUE for duplicate provider references', () => {
    expectFail('PROVIDER_TX_UNIQUE', { providerTxLinkedElsewhere: true });
  });

  it('fails TENANT_BOUNDARY on cross-tenant movements', () => {
    expectFail('TENANT_BOUNDARY', { movementsCrossTenantOrUser: true });
  });

  it('fails LEDGER_BALANCED on imbalance', () => {
    expectFail('LEDGER_BALANCED', {
      ledgerLegs: [
        { direction: 'DEBIT', amountCents: 77_000n },
        { direction: 'CREDIT', amountCents: 1n },
      ],
    });
  });

  it('rerunning the same failing facts remains deterministically failed', () => {
    const facts = baseFacts({ transferAmountCents: 1n });
    const first = evaluateConversionReconciliation(facts);
    const second = evaluateConversionReconciliation(facts);
    expect(first).toEqual(second);
    expect(conversionReconciliationPassed(first)).toBe(false);
  });
});
