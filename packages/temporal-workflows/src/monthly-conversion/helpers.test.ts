import { describe, expect, it } from 'vitest';

import { durationToMs, zeroDrawReasonCode } from './helpers.js';
import { monthlyConversionWorkflowId } from './types.js';

describe('monthly conversion helpers', () => {
  it('builds workflow id', () => {
    expect(
      monthlyConversionWorkflowId({
        tenantId: 't1',
        strategyId: 's1',
        paymentPeriod: '2026-07',
      }),
    ).toBe('monthly-conversion/t1/s1/2026-07');
  });

  it('parses poll durations', () => {
    expect(durationToMs('6 hours')).toBe(6 * 60 * 60 * 1000);
    expect(durationToMs('14 days')).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('classifies zero-draw reasons', () => {
    expect(
      zeroDrawReasonCode({
        principalRepaidCents: '100',
        newlyAvailableCreditCents: '0',
        userMonthlyCapCents: '500',
        drawAmountCents: '0',
      }),
    ).toBe('INSUFFICIENT_CREDIT');

    expect(
      zeroDrawReasonCode({
        principalRepaidCents: '100',
        newlyAvailableCreditCents: '100',
        userMonthlyCapCents: '0',
        drawAmountCents: '0',
      }),
    ).toBe('MONTHLY_CAP');
  });
});
