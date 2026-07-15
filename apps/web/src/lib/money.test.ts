import { describe, expect, it } from 'vitest';

import { dollarsInputToCents, formatCadCents } from './money';

describe('formatCadCents', () => {
  it('formats integer cents as CAD', () => {
    expect(formatCadCents('123456')).toMatch(/1[\s,]?234\.56/);
    expect(formatCadCents(0)).toMatch(/0\.00/);
  });

  it('renders em dash for empty values', () => {
    expect(formatCadCents(null)).toBe('—');
    expect(formatCadCents(undefined)).toBe('—');
  });
});

describe('dollarsInputToCents', () => {
  it('converts dollars to cents string without float rounding', () => {
    expect(dollarsInputToCents('50.25')).toBe('5025');
    expect(dollarsInputToCents('19.99')).toBe('1999');
    expect(dollarsInputToCents('100')).toBe('10000');
  });

  it('rejects invalid amounts', () => {
    expect(() => dollarsInputToCents('0')).toThrow(/positive/);
    expect(() => dollarsInputToCents('1.234')).toThrow(/2 decimal/);
  });
});
