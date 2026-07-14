import { describe, expect, it } from 'vitest';

import {
  cadCentsSchema,
  nonNegativeCadCentsSchema,
  parseCadCents,
  positiveCadCentsSchema,
  serializeCadCents,
} from './money.js';

describe('cadCentsSchema', () => {
  it('accepts bigint, int number, and digit strings', () => {
    expect(parseCadCents(100n)).toBe(100n);
    expect(parseCadCents(100)).toBe(100n);
    expect(parseCadCents('125000')).toBe(125000n);
    expect(serializeCadCents(125000n)).toBe('125000');
  });

  it('rejects floats and malformed money', () => {
    expect(() => cadCentsSchema.parse(12.34)).toThrow();
    expect(() => cadCentsSchema.parse('12.34')).toThrow();
    expect(() => cadCentsSchema.parse('abc')).toThrow();
    expect(() => positiveCadCentsSchema.parse(0n)).toThrow(/positive/);
    expect(() => nonNegativeCadCentsSchema.parse(-1n)).toThrow(/non-negative/);
  });
});
