import { describe, expect, it } from 'vitest';

import { assertAccountCapability, hasAccountCapability } from './capabilities.js';
import { AppError } from './errors.js';

describe('account capabilities', () => {
  it('supports documented capabilities per account kind', () => {
    expect(hasAccountCapability('MORTGAGE', 'canReadPayments')).toBe(true);
    expect(hasAccountCapability('HELOC', 'canDraw')).toBe(true);
    expect(hasAccountCapability('BANK_OPERATING', 'canDebitInterest')).toBe(true);
    expect(hasAccountCapability('BROKERAGE_CASH', 'canPlaceNotionalMarketOrder')).toBe(true);
    expect(hasAccountCapability('BROKERAGE_CASH', 'supportsFractionalUnits')).toBe(true);
  });

  it('rejects unsupported account capabilities', () => {
    expect(() => assertAccountCapability('MORTGAGE', 'canDraw')).toThrow(AppError);
    expect(() => assertAccountCapability('HELOC', 'canDeposit')).toThrow(AppError);
    expect(() => assertAccountCapability('BROKERAGE_CASH', 'canDebitInterest')).toThrow(AppError);
    expect(() => assertAccountCapability('BANK_OPERATING', 'canPlaceNotionalMarketOrder')).toThrow(
      AppError,
    );

    try {
      assertAccountCapability('MORTGAGE', 'canDraw', '550e8400-e29b-41d4-a716-446655440000');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('UNSUPPORTED_ACCOUNT_CAPABILITY');
      expect((error as AppError).correlationId).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });
});
