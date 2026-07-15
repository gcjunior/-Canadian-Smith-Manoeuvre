export function serializeMoney(value: bigint): string;
export function serializeMoney(value: bigint | null | undefined): string | null;
export function serializeMoney(value: bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

export function serializeCycle(cycle: {
  id: string;
  tenantId: string;
  strategyId: string;
  paymentPeriod: string;
  state: string;
  mortgagePaymentId: string | null;
  principalRepaidCents: bigint | null;
  newlyAvailableCreditCents: bigint | null;
  drawAmountCents: bigint | null;
  correlationId: string;
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}) {
  return {
    id: cycle.id,
    tenantId: cycle.tenantId,
    strategyId: cycle.strategyId,
    paymentPeriod: cycle.paymentPeriod,
    state: cycle.state,
    mortgagePaymentId: cycle.mortgagePaymentId,
    principalRepaidCents: serializeMoney(cycle.principalRepaidCents),
    newlyAvailableCreditCents: serializeMoney(cycle.newlyAvailableCreditCents),
    drawAmountCents: serializeMoney(cycle.drawAmountCents),
    correlationId: cycle.correlationId,
    failureCode: cycle.failureCode,
    failureMessage: cycle.failureMessage,
    startedAt: cycle.startedAt?.toISOString() ?? null,
    completedAt: cycle.completedAt?.toISOString() ?? null,
    createdAt: cycle.createdAt.toISOString(),
    updatedAt: cycle.updatedAt.toISOString(),
    version: cycle.version,
  };
}

/** Next 09:00 local on expectedPaymentDay (or following month if already past). */
export function computeNextExpectedCheckAt(
  timezone: string,
  expectedPaymentDay: number,
  from: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(from);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);

  let targetYear = year;
  let targetMonth = month;
  const targetDay = Math.min(expectedPaymentDay, 28);

  if (day > targetDay || (day === targetDay && localHour(from, timezone) >= 9)) {
    targetMonth += 1;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear += 1;
    }
  }

  // Approximate local 09:00 as UTC instant via iterative formatter (good enough for display).
  const approx = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, 14, 0, 0));
  return adjustToLocalHour(approx, timezone, 9).toISOString();
}

function localHour(date: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).format(date);
  return Number(hour);
}

function adjustToLocalHour(approx: Date, timezone: string, hour: number): Date {
  let cursor = approx;
  for (let i = 0; i < 48; i += 1) {
    if (localHour(cursor, timezone) === hour) return cursor;
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
  }
  return approx;
}
