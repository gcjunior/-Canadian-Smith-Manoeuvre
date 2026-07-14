import { z } from 'zod';

import { nonNegativeCadCentsSchema, positiveCadCentsSchema } from './money.js';
import {
  correlationIdSchema,
  isoDateTimeSchema,
  paymentPeriodSchema,
  uuidSchema,
} from './primitives.js';
import { monthlyConversionCycleStateSchema } from './states.js';

export const monthlyCycleStatusSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    strategyId: uuidSchema,
    paymentPeriod: paymentPeriodSchema,
    state: monthlyConversionCycleStateSchema,
    mortgagePaymentId: uuidSchema.nullable(),
    principalRepaidCents: nonNegativeCadCentsSchema.nullable(),
    newlyAvailableCreditCents: nonNegativeCadCentsSchema.nullable(),
    drawAmountCents: nonNegativeCadCentsSchema.nullable(),
    correlationId: correlationIdSchema,
    failureCode: z.string().nullable(),
    failureMessage: z.string().nullable(),
    startedAt: isoDateTimeSchema.nullable(),
    completedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    version: z.number().int().positive(),
  })
  .strict();

export type MonthlyCycleStatus = z.infer<typeof monthlyCycleStatusSchema>;

export const monthlyCycleCreateRequestSchema = z
  .object({
    strategyId: uuidSchema,
    paymentPeriod: paymentPeriodSchema,
  })
  .strict();

export type MonthlyCycleCreateRequest = z.infer<typeof monthlyCycleCreateRequestSchema>;

/** Ensures draw fields are coherent when present. */
export const monthlyCycleStatusWithDrawSchema = monthlyCycleStatusSchema.superRefine(
  (value, ctx) => {
    if (value.drawAmountCents !== null && value.drawAmountCents > 0n) {
      if (value.principalRepaidCents === null || value.newlyAvailableCreditCents === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Draw amount requires principal and newly available credit',
        });
      }
    }
    if (
      value.drawAmountCents !== null &&
      value.principalRepaidCents !== null &&
      value.drawAmountCents > value.principalRepaidCents
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Draw cannot exceed principal repaid',
      });
    }
  },
);

export { monthlyConversionCycleStateSchema, positiveCadCentsSchema };
