/**
 * HELOC interest Schedule calendar — same day-after / 09:00 local policy as
 * monthly conversion checks (see monthly-payment-schedule.ts).
 *
 * Schedule fire is never proof that a charge exists; the Workflow polls.
 */

import {
  MONTHLY_CONVERSION_CHECK_HOUR_LOCAL,
  buildMonthlyConversionCalendarSpecs,
  deriveAnchorsFromCheckInstant,
  type MonthlyConversionAnchors,
} from '../scheduling/monthly-payment-schedule.js';

export const HELOC_INTEREST_CHECK_HOUR_LOCAL = MONTHLY_CONVERSION_CHECK_HOUR_LOCAL;

export type HelocInterestAnchors = MonthlyConversionAnchors & {
  /** Alias of paymentPeriod for interest naming. */
  interestPeriod: string;
  expectedInterestChargeDate: string;
};

export function deriveInterestAnchorsFromCheckInstant(input: {
  instant: Date;
  timeZone: string;
  expectedInterestChargeDay: number;
}): HelocInterestAnchors {
  const anchors = deriveAnchorsFromCheckInstant({
    instant: input.instant,
    timeZone: input.timeZone,
    expectedPaymentDay: input.expectedInterestChargeDay,
  });
  return {
    ...anchors,
    interestPeriod: anchors.paymentPeriod,
    expectedInterestChargeDate: anchors.expectedPaymentDate,
  };
}

export function buildHelocInterestCalendarSpecs(input: {
  expectedInterestChargeDay: number;
}): ReturnType<typeof buildMonthlyConversionCalendarSpecs> {
  return buildMonthlyConversionCalendarSpecs(input.expectedInterestChargeDay);
}

export function helocInterestScheduleId(input: { tenantId: string; strategyId: string }): string {
  return `heloc-interest-schedule/${input.tenantId}/${input.strategyId}`;
}
