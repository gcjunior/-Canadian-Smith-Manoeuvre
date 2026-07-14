import { describe, expect, it } from 'vitest';

import {
  formatDecimal,
  multiplyToCents,
  parseDecimal,
  quantityFromNotionalCents,
} from './decimal.js';

describe('decimal math', () => {
  it('parses and formats without floats', () => {
    expect(formatDecimal(parseDecimal('30.15'))).toBe('30.15');
    expect(formatDecimal(parseDecimal('0.0000000001'))).toBe('0.0000000001');
  });

  it('computes notional quantity and fill cents with half-up rounding', () => {
    const price = parseDecimal('30');
    const qty = quantityFromNotionalCents(3_000_00n, price);
    expect(formatDecimal(qty)).toBe('100');
    expect(multiplyToCents(qty, price)).toBe(3_000_00n);

    const fractional = quantityFromNotionalCents(100_00n, parseDecimal('30.15'));
    expect(formatDecimal(fractional)).toMatch(/^3\.316/);
    const cents = multiplyToCents(fractional, parseDecimal('30.15'));
    expect(cents).toBeLessThanOrEqual(100_00n);
  });

  it('rejects invalid decimals', () => {
    expect(() => parseDecimal('1.23456789012')).toThrow(/Invalid/);
    expect(() => parseDecimal('abc')).toThrow(/Invalid/);
  });
});
