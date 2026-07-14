import { z } from 'zod';

import { nonNegativeCadCentsSchema, positiveCadCentsSchema } from '@csm/contracts';

export const deterministicFailureStepSchema = z.enum([
  'NONE',
  'HTTP_429',
  'HTTP_500_TRANSIENT',
  'TIMEOUT_BEFORE_PROCESSING',
  'TIMEOUT_AFTER_SUCCESS',
  'DUPLICATE_REQUEST',
  'INSUFFICIENT_HELOC_CREDIT',
  'ORDINARY_ACCOUNT_NSF',
  'DELAYED_SETTLEMENT',
  'REVERSED_MORTGAGE_PAYMENT',
  'STALE_AVAILABILITY',
  'MALFORMED_WEBHOOK',
  'DROP_WEBHOOK',
  'OUT_OF_ORDER_WEBHOOK',
]);

export const bankScenarioConfigSchema = z
  .object({
    scenarioId: z.string().min(1).max(64),
    mode: z.enum(['deterministic', 'demo']).default('deterministic'),
    seed: z.number().int().nonnegative().optional(),
    mortgagePostingDelayMs: z.number().int().nonnegative().default(0),
    mortgageSettlementDelayMs: z.number().int().nonnegative().default(0),
    helocReadvanceDelayMs: z.number().int().nonnegative().default(0),
    drawSettlementDelayMs: z.number().int().nonnegative().default(0),
    transferSettlementDelayMs: z.number().int().nonnegative().default(0),
    interestChargeDay: z.number().int().min(1).max(28).default(1),
    interestDebitDelayMs: z.number().int().nonnegative().default(0),
    initialBalances: z
      .object({
        mortgagePrincipalCents: nonNegativeCadCentsSchema.default(450_000_00n),
        helocCreditLimitCents: positiveCadCentsSchema.default(200_000_00n),
        helocBalanceOwedCents: nonNegativeCadCentsSchema.default(0n),
        helocExistingAvailableCreditCents: nonNegativeCadCentsSchema.default(0n),
        ordinaryBankBalanceCents: nonNegativeCadCentsSchema.default(5_000_00n),
      })
      .strict()
      .default({}),
    deterministicFailureSteps: z.array(deterministicFailureStepSchema).default([]),
    seededRandomFailureRate: z.number().min(0).max(1).default(0),
    webhooksEnabled: z.boolean().default(true),
    webhookOutOfOrder: z.boolean().default(false),
    webhookDuplicateDelivery: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'demo' && value.seed === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'demo mode requires seed', path: ['seed'] });
    }
  });

export type BankScenarioConfig = z.infer<typeof bankScenarioConfigSchema>;
export type DeterministicFailureStep = z.infer<typeof deterministicFailureStepSchema>;
