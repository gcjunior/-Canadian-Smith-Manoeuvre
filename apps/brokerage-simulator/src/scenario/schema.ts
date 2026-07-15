import { z } from 'zod';

import { nonNegativeCadCentsSchema } from '@csm/contracts';
import { decimalStringSchema } from '@csm/contracts';

export const deterministicFailureStepSchema = z.enum([
  'NONE',
  'TIMEOUT_BEFORE_PROCESSING',
  'TIMEOUT_AFTER_SUCCESS',
  'DUPLICATE_REQUEST',
  'INSUFFICIENT_SETTLED_CASH',
  'ACCOUNT_RESTRICTION',
  'REJECTED_ORDER',
  'PARTIAL_FILL',
  'PRICE_MOVEMENT',
  'DEPOSIT_FAIL',
  'DEPOSIT_REVERSED',
  'DROP_WEBHOOK',
  'MALFORMED_WEBHOOK',
  'OUT_OF_ORDER_WEBHOOK',
]);

export const brokerageScenarioConfigSchema = z
  .object({
    scenarioId: z.string().min(1).max(64),
    mode: z.enum(['deterministic', 'demo']).default('deterministic'),
    seed: z.number().int().nonnegative().optional(),
    etfSymbol: z.string().min(1).max(32).default('XEQT'),
    quotePrice: decimalStringSchema.default('30.0000000000'),
    spread: decimalStringSchema.default('0.01'),
    commissionCents: nonNegativeCadCentsSchema.default(0n),
    depositSettlementDelayMs: z.number().int().nonnegative().default(1_000),
    orderAckDelayMs: z.number().int().nonnegative().default(500),
    fillDelayMs: z.number().int().nonnegative().default(1_000),
    /** Absolute dollar move applied at fill when PRICE_MOVEMENT is active. */
    fillPriceMove: decimalStringSchema.default('0.05'),
    /** Fraction of quantity filled on first partial fill (0–1), as decimal string. */
    partialFillFraction: decimalStringSchema.default('0.40'),
    initialSettledCashCents: nonNegativeCadCentsSchema.default(0n),
    deterministicFailureSteps: z.array(deterministicFailureStepSchema).default([]),
    seededRandomFailureRate: z.number().min(0).max(1).default(0),
    webhooksEnabled: z.boolean().default(true),
    webhookOutOfOrder: z.boolean().default(false),
    webhookDuplicateDelivery: z.boolean().default(false),
    allowFractionalUnits: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'demo' && value.seed === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'demo mode requires seed',
        path: ['seed'],
      });
    }
  });

export type BrokerageScenarioConfig = z.infer<typeof brokerageScenarioConfigSchema>;
export type DeterministicFailureStep = z.infer<typeof deterministicFailureStepSchema>;
