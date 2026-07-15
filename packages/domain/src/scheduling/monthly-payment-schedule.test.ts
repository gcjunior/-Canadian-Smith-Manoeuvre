import { describe, expect, it } from 'vitest';

import {
  buildMonthlyConversionCalendarSpecs,
  clampPaymentDay,
  daysInMonth,
  deriveAnchorsFromCheckInstant,
  strategyScheduleId,
} from './monthly-payment-schedule.js';

describe('monthly payment schedule policy', () => {
  it('clamps February 30 to last day of month', () => {
    expect(clampPaymentDay(2026, 1, 30)).toBe(28);
    expect(clampPaymentDay(2024, 1, 30)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2024, 1)).toBe(29);
  });

  it('derives paymentPeriod from check instant (day after payment)', () => {
    // 2026-08-16 13:00 UTC ≈ 09:00 America/Toronto on Aug 16
    const instant = new Date('2026-08-16T13:00:00.000Z');
    const anchors = deriveAnchorsFromCheckInstant({
      instant,
      timeZone: 'America/Toronto',
      expectedPaymentDay: 15,
    });
    expect(anchors.expectedPaymentDate).toBe('2026-08-15');
    expect(anchors.paymentPeriod).toBe('2026-08');
    expect(anchors.checkDate).toBe('2026-08-16');
  });

  it('handles month boundary check after payment day 28', () => {
    // 2026-03-01 14:00 UTC ≈ 09:00 America/Toronto on Mar 1
    const instant = new Date('2026-03-01T14:00:00.000Z');
    const anchors = deriveAnchorsFromCheckInstant({
      instant,
      timeZone: 'America/Toronto',
      expectedPaymentDay: 28,
    });
    expect(anchors.expectedPaymentDate).toBe('2026-02-28');
    expect(anchors.paymentPeriod).toBe('2026-02');
    expect(anchors.checkDate).toBe('2026-03-01');
  });

  it('builds a single calendar when check day always exists', () => {
    const specs = buildMonthlyConversionCalendarSpecs(15);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.dayOfMonth).toBe(16);
    expect(specs[0]?.hour).toBe(9);
  });

  it('adds March 1 catch calendar when payment day is 28', () => {
    const specs = buildMonthlyConversionCalendarSpecs(28);
    expect(specs).toHaveLength(2);
    expect(specs[0]?.dayOfMonth).toBe(29);
    expect(specs[1]?.month).toBe('MARCH');
    expect(specs[1]?.dayOfMonth).toBe(1);
  });

  it('builds stable schedule ids', () => {
    expect(strategyScheduleId('t1', 's1')).toBe('monthly-conversion-schedule/t1/s1');
  });
});
