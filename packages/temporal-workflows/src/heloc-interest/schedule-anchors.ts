/**
 * Workflow-safe copy of domain interest schedule anchors (no Node-only imports).
 * Keep in sync with `@csm/domain` deriveInterestAnchorsFromCheckInstant.
 */

export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function clampPaymentDay(year: number, monthIndex0: number, configuredDay: number): number {
  const last = daysInMonth(year, monthIndex0);
  const day = Math.trunc(configuredDay);
  if (day < 1) {
    return 1;
  }
  return Math.min(day, last);
}

function subtractOneCalendarDay(
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

function addOneCalendarDay(
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

function zonedDateParts(
  instant: Date,
  timeZone: string,
): { year: number; monthIndex0: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
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
  };
}

export function deriveInterestAnchorsFromCheckInstant(input: {
  instant: Date;
  timeZone: string;
  expectedInterestChargeDay: number;
}): {
  expectedPaymentDate: string;
  paymentPeriod: string;
  checkDate: string;
  interestPeriod: string;
  expectedInterestChargeDate: string;
} {
  const parts = zonedDateParts(input.instant, input.timeZone);
  const payment = subtractOneCalendarDay(parts.year, parts.monthIndex0, parts.day);
  const clampedDay = clampPaymentDay(
    payment.year,
    payment.monthIndex0,
    input.expectedInterestChargeDay,
  );
  const check = addOneCalendarDay(payment.year, payment.monthIndex0, clampedDay);
  const expectedInterestChargeDate = `${payment.year}-${pad2(payment.monthIndex0 + 1)}-${pad2(clampedDay)}`;
  const interestPeriod = `${payment.year}-${pad2(payment.monthIndex0 + 1)}`;
  return {
    expectedPaymentDate: expectedInterestChargeDate,
    paymentPeriod: interestPeriod,
    checkDate: `${check.year}-${pad2(check.monthIndex0 + 1)}-${pad2(check.day)}`,
    interestPeriod,
    expectedInterestChargeDate,
  };
}
