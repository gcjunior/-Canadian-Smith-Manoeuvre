/**
 * Monthly mortgage payment → conversion-check calendar policy (MVP).
 *
 * ## Selected date policy (including “February 30”)
 *
 * 1. Clamp the configured `expectedPaymentDay` to the last calendar day of the
 *    month in the strategy timezone (`1..lastDay`). A configured day that does
 *    not exist (e.g. 30 or 31 in February) becomes the last day of that month
 *    (28 or 29). The product API currently accepts days `1..28`, so clamping is
 *    primarily a defensive / documentation guarantee for schedule math.
 * 2. Schedule the first conversion **check** at **09:00 local time on the
 *    calendar day after** that (clamped) payment day.
 * 3. Schedule execution is **not** proof of payment — the Workflow verifies
 *    settlement via Activities.
 * 4. `paymentPeriod` is stable `YYYY-MM` of the (clamped) expected payment date.
 *
 * When the “day after” would be day 29 and February has no 29th, Temporal
 * calendar specs also fire on **1 March 09:00** so the February cycle is still
 * started. Duplicate leap-year fires for the same period are absorbed by the
 * deterministic conversion Workflow ID.
 */

export const MONTHLY_CONVERSION_CHECK_HOUR_LOCAL = 9;

export interface MonthlyConversionAnchors {
  /** Clamped payment calendar date YYYY-MM-DD in strategy timezone. */
  expectedPaymentDate: string;
  /** Stable period id, e.g. 2026-08. */
  paymentPeriod: string;
  /** Local date of the 09:00 conversion check YYYY-MM-DD. */
  checkDate: string;
}

export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export function clampPaymentDay(year: number, monthIndex0: number, configuredDay: number): number {
  const last = daysInMonth(year, monthIndex0);
  const day = Math.trunc(configuredDay);
  if (day < 1) {
    return 1;
  }
  return Math.min(day, last);
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatIsoDate(year: number, monthIndex0: number, day: number): string {
  return `${year}-${pad2(monthIndex0 + 1)}-${pad2(day)}`;
}

export function paymentPeriodFromParts(year: number, monthIndex0: number): string {
  return `${year}-${pad2(monthIndex0 + 1)}`;
}

/** Add one calendar day to a Y-M-D triple. */
export function addOneCalendarDay(
  year: number,
  monthIndex0: number,
  day: number,
): { year: number; monthIndex0: number; day: number } {
  const last = daysInMonth(year, monthIndex0);
  if (day < last) {
    return { year, monthIndex0, day: day + 1 };
  }
  if (monthIndex0 === 11) {
    return { year: year + 1, monthIndex0: 0, day: 1 };
  }
  return { year, monthIndex0: monthIndex0 + 1, day: 1 };
}

export function subtractOneCalendarDay(
  year: number,
  monthIndex0: number,
  day: number,
): { year: number; monthIndex0: number; day: number } {
  if (day > 1) {
    return { year, monthIndex0, day: day - 1 };
  }
  if (monthIndex0 === 0) {
    return { year: year - 1, monthIndex0: 11, day: daysInMonth(year - 1, 11) };
  }
  const prevMonth = monthIndex0 - 1;
  return { year, monthIndex0: prevMonth, day: daysInMonth(year, prevMonth) };
}

/**
 * Given a Schedule fire instant, derive payment anchors.
 * Assumes the Schedule fires at ~09:00 local on the check date.
 */
export function deriveAnchorsFromCheckInstant(input: {
  instant: Date;
  timeZone: string;
  expectedPaymentDay: number;
}): MonthlyConversionAnchors {
  const parts = zonedDateParts(input.instant, input.timeZone);
  const payment = subtractOneCalendarDay(parts.year, parts.monthIndex0, parts.day);
  // Re-clamp payment day for the month of the payment date (handles Feb 30 → 28/29).
  const clampedDay = clampPaymentDay(payment.year, payment.monthIndex0, input.expectedPaymentDay);
  const expectedPaymentDate = formatIsoDate(payment.year, payment.monthIndex0, clampedDay);
  const check = addOneCalendarDay(payment.year, payment.monthIndex0, clampedDay);
  return {
    expectedPaymentDate,
    paymentPeriod: paymentPeriodFromParts(payment.year, payment.monthIndex0),
    checkDate: formatIsoDate(check.year, check.monthIndex0, check.day),
  };
}

/** Build Temporal calendar specs for the monthly check (09:00 local). */
export function buildMonthlyConversionCalendarSpecs(expectedPaymentDay: number): Array<{
  dayOfMonth: number;
  hour: number;
  minute: number;
  second: number;
  month?: string | string[];
  comment?: string;
}> {
  const day = Math.min(Math.max(Math.trunc(expectedPaymentDay), 1), 31);
  const checkDay = day + 1;
  const hour = MONTHLY_CONVERSION_CHECK_HOUR_LOCAL;

  if (checkDay <= 28) {
    return [
      {
        dayOfMonth: checkDay,
        hour,
        minute: 0,
        second: 0,
        comment: `Check day after expected payment day ${day}`,
      },
    ];
  }

  // Payment day 28 → check day 29 when it exists; plus 1 March for short February.
  return [
    {
      dayOfMonth: 29,
      hour,
      minute: 0,
      second: 0,
      comment: 'Day after the 28th when the month has a 29th (includes leap Februaries)',
    },
    {
      month: 'MARCH',
      dayOfMonth: 1,
      hour,
      minute: 0,
      second: 0,
      comment: 'Day after Feb 28 when February has no 29th (non-leap years)',
    },
  ];
}

export function strategyScheduleId(tenantId: string, strategyId: string): string {
  return `monthly-conversion-schedule/${tenantId}/${strategyId}`;
}

export function zonedDateParts(
  instant: Date,
  timeZone: string,
): { year: number; monthIndex0: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const bags: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== 'literal') {
      bags[part.type] = part.value;
    }
  }
  return {
    year: Number(bags.year),
    monthIndex0: Number(bags.month) - 1,
    day: Number(bags.day),
    hour: Number(bags.hour),
  };
}
