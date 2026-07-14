import { z } from 'zod';

import { nonNegativeCadCentsSchema, positiveCadCentsSchema } from './money.js';
import {
  correlationIdSchema,
  isoDateTimeSchema,
  paymentPeriodSchema,
  uuidSchema,
} from './primitives.js';
import {
  helocInterestChargeStateSchema,
  helocInterestPaymentStateSchema,
  moneyMovementStateSchema,
} from './states.js';

export const helocAvailabilitySchema = z
  .object({
    helocAccountId: uuidSchema,
    tenantId: uuidSchema,
    availableCreditCents: nonNegativeCadCentsSchema,
    creditLimitCents: positiveCadCentsSchema,
    balanceOwedCents: nonNegativeCadCentsSchema,
    observedAt: isoDateTimeSchema,
    relatedPaymentPeriod: paymentPeriodSchema.optional(),
  })
  .strict();

export type HelocAvailability = z.infer<typeof helocAvailabilitySchema>;

const helocDrawBaseSchema = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  helocAccountId: uuidSchema,
  amountCents: positiveCadCentsSchema,
  idempotencyKey: uuidSchema,
  correlationId: correlationIdSchema,
  providerTransactionId: z.string().min(1).nullable(),
  cycleId: uuidSchema.optional(),
  requestedAt: isoDateTimeSchema,
  settledAt: isoDateTimeSchema.nullable(),
  version: z.number().int().positive(),
});

export const helocDrawSchema = z.discriminatedUnion('state', [
  helocDrawBaseSchema.extend({ state: z.literal('REQUESTED') }).strict(),
  helocDrawBaseSchema.extend({ state: z.literal('PENDING') }).strict(),
  helocDrawBaseSchema
    .extend({
      state: z.literal('SETTLED'),
      settledAt: isoDateTimeSchema,
      providerTransactionId: z.string().min(1),
    })
    .strict(),
  helocDrawBaseSchema.extend({ state: z.literal('FAILED') }).strict(),
  helocDrawBaseSchema.extend({ state: z.literal('UNKNOWN') }).strict(),
  helocDrawBaseSchema.extend({ state: z.literal('REVERSED') }).strict(),
]);

export type HelocDraw = z.infer<typeof helocDrawSchema>;

export const helocDrawRequestSchema = z
  .object({
    helocAccountId: uuidSchema,
    amountCents: positiveCadCentsSchema,
    idempotencyKey: uuidSchema,
    cycleId: uuidSchema.optional(),
  })
  .strict();

export type HelocDrawRequest = z.infer<typeof helocDrawRequestSchema>;

const interestChargeBase = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  helocId: uuidSchema,
  providerChargeId: z.string().min(1),
  interestPeriod: paymentPeriodSchema,
  amountCents: positiveCadCentsSchema,
  postedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
});

export const helocInterestChargeSchema = z.discriminatedUnion('state', [
  interestChargeBase.extend({ state: z.literal('PENDING') }).strict(),
  interestChargeBase.extend({ state: z.literal('POSTED'), postedAt: isoDateTimeSchema }).strict(),
  interestChargeBase.extend({ state: z.literal('FAILED') }).strict(),
]);

export type HelocInterestCharge = z.infer<typeof helocInterestChargeSchema>;

const interestPaymentBase = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  chargeId: uuidSchema,
  ordinaryBankAccountId: uuidSchema,
  providerPaymentId: z.string().min(1),
  amountCents: positiveCadCentsSchema,
  settledAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
});

export const helocInterestPaymentSchema = z.discriminatedUnion('state', [
  interestPaymentBase.extend({ state: z.literal('PENDING') }).strict(),
  interestPaymentBase
    .extend({ state: z.literal('SETTLED'), settledAt: isoDateTimeSchema })
    .strict(),
  interestPaymentBase.extend({ state: z.literal('FAILED') }).strict(),
]);

export type HelocInterestPayment = z.infer<typeof helocInterestPaymentSchema>;

export {
  helocInterestChargeStateSchema,
  helocInterestPaymentStateSchema,
  moneyMovementStateSchema,
};
