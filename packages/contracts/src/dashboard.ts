import { z } from 'zod';

import { customerCycleStatusSchema } from './customer-status.js';
import { nonNegativeCadCentsSchema } from './money.js';
import { canadianTimezoneSchema, isoDateTimeSchema, uuidSchema } from './primitives.js';
import { strategyResponseSchema } from './strategy.js';

export const dashboardExceptionSchema = z
  .object({
    id: uuidSchema,
    code: z.string(),
    message: z.string(),
    severity: z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const dashboardSummarySchema = z
  .object({
    strategy: strategyResponseSchema,
    automationActive: z.boolean(),
    automationLabel: z.enum(['active', 'paused', 'draft', 'closed']),
    nextExpectedCheckAt: isoDateTimeSchema.nullable(),
    timezone: canadianTimezoneSchema,
    latestMortgagePaymentCents: nonNegativeCadCentsSchema.nullable(),
    principalRepaidCents: nonNegativeCadCentsSchema.nullable(),
    latestBorrowedCents: nonNegativeCadCentsSchema.nullable(),
    latestInvestedCents: nonNegativeCadCentsSchema.nullable(),
    investmentLoanBalanceCents: nonNegativeCadCentsSchema.nullable(),
    helocInterestPaidFromOrdinaryCents: nonNegativeCadCentsSchema.nullable(),
    latestCycle: z
      .object({
        id: uuidSchema,
        paymentPeriod: z.string(),
        customerStatus: customerCycleStatusSchema,
        updatedAt: isoDateTimeSchema,
      })
      .nullable(),
    exceptionsRequiringAttention: z.array(dashboardExceptionSchema),
  })
  .strict();

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
