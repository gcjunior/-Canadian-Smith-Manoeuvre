import { z } from 'zod';

import { nonNegativeCadCentsSchema, positiveCadCentsSchema } from './money.js';
import { isoDateTimeSchema, paymentPeriodSchema, uuidSchema } from './primitives.js';
import { mortgagePaymentStateSchema } from './states.js';

const mortgagePaymentBaseSchema = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  mortgageId: uuidSchema,
  providerPaymentId: z.string().min(1),
  paymentPeriod: paymentPeriodSchema,
  totalAmountCents: positiveCadCentsSchema,
  principalAmountCents: nonNegativeCadCentsSchema,
  interestAmountCents: nonNegativeCadCentsSchema,
  paidAt: isoDateTimeSchema.nullable(),
  settledAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
});

export const mortgagePaymentSchema = z.discriminatedUnion('state', [
  mortgagePaymentBaseSchema.extend({ state: z.literal('PENDING') }).strict(),
  mortgagePaymentBaseSchema
    .extend({
      state: z.literal('SETTLED'),
      settledAt: isoDateTimeSchema,
      principalAmountCents: nonNegativeCadCentsSchema,
    })
    .strict(),
  mortgagePaymentBaseSchema.extend({ state: z.literal('FAILED') }).strict(),
  mortgagePaymentBaseSchema.extend({ state: z.literal('CANCELLED') }).strict(),
]);

export type MortgagePayment = z.infer<typeof mortgagePaymentSchema>;

export { mortgagePaymentStateSchema };
