import { z } from 'zod';

import { cadCentsSchema, nonNegativeCadCentsSchema, positiveCadCentsSchema } from '@csm/contracts';
import { decimalStringSchema } from '@csm/contracts';

export const wireCentsSchema = cadCentsSchema;

export const providerBrokerageAccountSchema = z
  .object({
    id: z.string().uuid(),
    externalAccountId: z.string(),
    displayName: z.string(),
    currencyCode: z.literal('CAD'),
    registrationType: z.literal('NON_REGISTERED'),
    settledCashCents: wireCentsSchema,
    pendingCashCents: nonNegativeCadCentsSchema,
    restricted: z.boolean(),
    restrictionReason: z.string().nullable(),
    createdAt: z.string(),
  })
  .passthrough();

export const providerCashSchema = z
  .object({
    accountId: z.string().uuid(),
    currencyCode: z.literal('CAD'),
    settledCashCents: wireCentsSchema,
    pendingCashCents: nonNegativeCadCentsSchema,
    availableCashCents: wireCentsSchema,
    restricted: z.boolean(),
    observedAt: z.string(),
  })
  .passthrough();

export const providerPositionSchema = z
  .object({
    accountId: z.string().uuid(),
    symbol: z.string(),
    quantity: decimalStringSchema,
    averageCostCentsPerUnit: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const providerDepositSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    amountCents: positiveCadCentsSchema,
    idempotencyKey: z.string().min(1),
    state: z.enum(['REQUESTED', 'PENDING', 'SETTLED', 'FAILED', 'UNKNOWN', 'REVERSED']),
    providerDepositId: z.string(),
    requestedAt: z.string(),
    settledAt: z.string().nullable(),
    failureCode: z.string().nullable(),
  })
  .passthrough();

export const providerOrderSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    symbol: z.string(),
    side: z.literal('BUY'),
    notionalCents: positiveCadCentsSchema,
    quantity: decimalStringSchema.nullable(),
    filledQuantity: z.string(),
    limitPrice: decimalStringSchema.nullable(),
    averageFillPrice: decimalStringSchema.nullable(),
    idempotencyKey: z.string().min(1),
    state: z.enum([
      'CREATED',
      'SUBMITTED',
      'PARTIALLY_FILLED',
      'FILLED',
      'REJECTED',
      'CANCELLED',
      'UNKNOWN',
    ]),
    providerOrderId: z.string(),
    createdAt: z.string(),
    submittedAt: z.string().nullable(),
    filledAt: z.string().nullable(),
    failureCode: z.string().nullable(),
    commissionCents: nonNegativeCadCentsSchema,
  })
  .passthrough();

export const brokerageHealthSchema = z
  .object({
    status: z.string(),
    service: z.string(),
    version: z.string().optional(),
    correlationId: z.string().optional(),
    simulator: z.string().optional(),
  })
  .passthrough();

export type ProviderDeposit = z.infer<typeof providerDepositSchema>;
export type ProviderOrder = z.infer<typeof providerOrderSchema>;
export type ProviderBrokerageAccount = z.infer<typeof providerBrokerageAccountSchema>;
export type ProviderCash = z.infer<typeof providerCashSchema>;
