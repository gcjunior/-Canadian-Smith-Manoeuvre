import { z } from 'zod';

import { nonNegativeCadCentsSchema, positiveCadCentsSchema } from './money.js';
import { paymentPeriodSchema } from './primitives.js';

export const simulatorFailureModeSchema = z.enum([
  'NONE',
  'PAYMENT_LATE',
  'HELOC_CREDIT_LAG',
  'DRAW_TIMEOUT_THEN_SETTLE',
  'DEPOSIT_FAIL',
  'ORDER_REJECT',
  'INTEREST_NSF',
  'DUPLICATE_WEBHOOK',
]);

export const simulatorScenarioConfigSchema = z
  .object({
    scenarioId: z.string().min(1).max(64),
    mode: z.enum(['deterministic', 'demo']),
    seed: z.number().int().nonnegative().optional(),
    paymentPeriod: paymentPeriodSchema,
    mortgagePrincipalCents: positiveCadCentsSchema,
    helocAvailableCreditCents: nonNegativeCadCentsSchema,
    settleAfterHours: z.number().int().nonnegative().default(0),
    helocCreditLagHours: z.number().int().nonnegative().default(0),
    etfSymbol: z.string().min(1).max(32),
    fillPrice: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/),
    failureMode: simulatorFailureModeSchema.default('NONE'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'demo' && value.seed === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Demo mode requires a seed',
        path: ['seed'],
      });
    }
    if (value.mode === 'deterministic' && value.seed !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Deterministic mode must not set a random seed',
        path: ['seed'],
      });
    }
  });

export type SimulatorScenarioConfig = z.infer<typeof simulatorScenarioConfigSchema>;
