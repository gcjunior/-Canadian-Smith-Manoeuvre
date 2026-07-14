import { z } from 'zod';

import { nonNegativeCadCentsSchema, positiveCadCentsSchema } from './money.js';
import { canadianTimezoneSchema, isoDateTimeSchema, uuidSchema } from './primitives.js';
import { strategyStateSchema } from './states.js';

export const strategyInvestmentPolicySchema = z
  .object({
    symbol: z.string().min(1).max(32),
    exchange: z.string().min(1).max(16).default('TSX'),
    userMonthlyCapCents: positiveCadCentsSchema,
    allowFractionalShares: z.boolean().default(true),
  })
  .strict();

/** HTTP: create / configure a strategy (external boundary — strict). */
export const strategySetupRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    timezone: canadianTimezoneSchema,
    expectedPaymentDay: z.number().int().min(1).max(28),
    mortgageAccountId: uuidSchema,
    helocAccountId: uuidSchema,
    bankAccountId: uuidSchema,
    brokerageAccountId: uuidSchema,
    investmentPolicy: strategyInvestmentPolicySchema,
  })
  .strict();

export type StrategySetupRequest = z.infer<typeof strategySetupRequestSchema>;

export const strategyActivationRequestSchema = z
  .object({
    strategyId: uuidSchema,
    acknowledgeRiskDisclosures: z.literal(true),
  })
  .strict();

export type StrategyActivationRequest = z.infer<typeof strategyActivationRequestSchema>;

export const strategyPauseRequestSchema = z
  .object({
    strategyId: uuidSchema,
    reason: z.string().min(1).max(500),
  })
  .strict();

export type StrategyPauseRequest = z.infer<typeof strategyPauseRequestSchema>;

export const strategyResumeRequestSchema = z
  .object({
    strategyId: uuidSchema,
    clearanceNote: z.string().min(1).max(500),
  })
  .strict();

export type StrategyResumeRequest = z.infer<typeof strategyResumeRequestSchema>;

export const strategyResponseSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    userId: uuidSchema,
    name: z.string(),
    state: strategyStateSchema,
    timezone: canadianTimezoneSchema,
    expectedPaymentDay: z.number().int().min(1).max(28),
    mortgageAccountId: uuidSchema,
    helocAccountId: uuidSchema,
    bankAccountId: uuidSchema,
    brokerageAccountId: uuidSchema,
    pauseReason: z.string().nullable(),
    investmentPolicy: strategyInvestmentPolicySchema.extend({
      id: uuidSchema,
      userMonthlyCapCents: nonNegativeCadCentsSchema,
    }),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    version: z.number().int().positive(),
  })
  .strict();

export type StrategyResponse = z.infer<typeof strategyResponseSchema>;
