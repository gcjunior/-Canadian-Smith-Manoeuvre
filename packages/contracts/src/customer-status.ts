import { z } from 'zod';

import { type monthlyConversionCycleStateSchema } from './states.js';

/** Customer-facing cycle labels — never expose Temporal / internal machine names. */
export const customerCycleStatusSchema = z.enum([
  'Waiting for mortgage payment',
  'Waiting for available credit',
  'Transferring funds',
  'Investing',
  'Confirming transactions',
  'Completed',
  'Paused',
]);

export type CustomerCycleStatus = z.infer<typeof customerCycleStatusSchema>;

const INTERNAL_TO_CUSTOMER: Record<
  z.infer<typeof monthlyConversionCycleStateSchema>,
  CustomerCycleStatus
> = {
  SCHEDULED: 'Waiting for mortgage payment',
  WAITING_FOR_MORTGAGE: 'Waiting for mortgage payment',
  WAITING_FOR_HELOC: 'Waiting for available credit',
  HELOC_DRAW_PENDING: 'Transferring funds',
  HELOC_DRAW_CONFIRMED: 'Transferring funds',
  BROKERAGE_TRANSFER_PENDING: 'Transferring funds',
  BROKERAGE_FUNDED: 'Investing',
  ORDER_PENDING: 'Investing',
  ORDER_FILLED: 'Confirming transactions',
  RECONCILING: 'Confirming transactions',
  COMPLETED: 'Completed',
  SKIPPED: 'Completed',
  PAUSED: 'Paused',
  FAILED: 'Paused',
};

export function toCustomerCycleStatus(
  state: z.infer<typeof monthlyConversionCycleStateSchema>,
): CustomerCycleStatus {
  return INTERNAL_TO_CUSTOMER[state];
}
