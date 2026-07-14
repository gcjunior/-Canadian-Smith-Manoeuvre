import { describe, expect, it } from 'vitest';

import { computeDrawAmountCents } from './caps.js';
import { formatCadCents, parseCadDollarsToCents } from './money.js';

describe('money', () => {
  it('parses and formats CAD cents', () => {
    expect(parseCadDollarsToCents('12.34')).toBe(1234n);
    expect(formatCadCents(1234n)).toBe('12.34');
  });

  it('computes draw as min of four caps', () => {
    expect(
      computeDrawAmountCents({
        principalRepaidCents: 1000n,
        newlyAvailableHelocCreditCents: 800n,
        userMonthlyCapCents: 900n,
        platformMonthlyCapCents: 500_000n,
      }),
    ).toBe(800n);
  });
});
