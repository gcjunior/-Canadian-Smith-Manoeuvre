import { DomainError } from '../errors.js';

/** Calendar month in strategy timezone, e.g. 2026-07 */
export type PaymentPeriod = string & { readonly __brand: 'PaymentPeriod' };

const RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function asPaymentPeriod(value: string): PaymentPeriod {
  if (!RE.test(value)) {
    throw new DomainError('INVALID_PAYMENT_PERIOD', `Invalid payment period: ${value}`);
  }
  return value as PaymentPeriod;
}
