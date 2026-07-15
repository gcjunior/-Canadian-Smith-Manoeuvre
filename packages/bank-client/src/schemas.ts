import { z } from 'zod';

import { cadCentsSchema, nonNegativeCadCentsSchema, positiveCadCentsSchema } from '@csm/contracts';

/** Wire money: digit string or bigint → bigint. */
export const wireCentsSchema = cadCentsSchema;

export const providerAccountSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    kind: z.enum(['MORTGAGE', 'HELOC', 'ORDINARY', 'BROKERAGE_LINK']),
    displayAlias: z.string(),
    providerAccountId: z.string(),
    currencyCode: z.literal('CAD'),
    balanceCents: wireCentsSchema,
    createdAt: z.string(),
  })
  .passthrough();

export const providerTransactionSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    amountCents: wireCentsSchema,
    narrative: z.string(),
    createdAt: z.string(),
    relatedId: z.string().nullable(),
  })
  .passthrough();

export const providerMortgagePaymentSchema = z
  .object({
    id: z.string().uuid(),
    mortgageId: z.string().uuid(),
    providerPaymentId: z.string(),
    paymentPeriod: z.string(),
    state: z.enum(['SCHEDULED', 'POSTED', 'SETTLED', 'REVERSED']),
    totalAmountCents: wireCentsSchema,
    principalAmountCents: nonNegativeCadCentsSchema,
    interestAmountCents: nonNegativeCadCentsSchema,
    scheduledAt: z.string(),
    postedAt: z.string().nullable(),
    settledAt: z.string().nullable(),
    reversedAt: z.string().nullable(),
  })
  .passthrough();

export const providerHelocAvailabilitySchema = z
  .object({
    helocId: z.string().uuid(),
    availableCreditCents: wireCentsSchema,
    existingAvailableCreditCents: wireCentsSchema,
    newlyAvailableCreditCents: wireCentsSchema,
    creditLimitCents: positiveCadCentsSchema,
    balanceOwedCents: nonNegativeCadCentsSchema,
    observedAt: z.string(),
    stale: z.boolean(),
  })
  .passthrough();

export const providerHelocDrawSchema = z
  .object({
    id: z.string().uuid(),
    helocId: z.string().uuid(),
    amountCents: positiveCadCentsSchema,
    idempotencyKey: z.string().min(1),
    state: z.enum(['REQUESTED', 'PENDING', 'SETTLED', 'FAILED', 'UNKNOWN']),
    providerTransactionId: z.string(),
    requestedAt: z.string(),
    settledAt: z.string().nullable(),
    failureCode: z.string().nullable(),
  })
  .passthrough();

export const providerTransferSchema = z
  .object({
    id: z.string().uuid(),
    sourceAccountId: z.string().uuid(),
    destinationAccountId: z.string().uuid(),
    amountCents: positiveCadCentsSchema,
    idempotencyKey: z.string().min(1),
    state: z.enum(['PENDING', 'SETTLED', 'FAILED', 'UNKNOWN']),
    providerTransactionId: z.string(),
    requestedAt: z.string(),
    settledAt: z.string().nullable(),
    failureCode: z.string().nullable(),
  })
  .passthrough();

export const providerOrdinaryDebitSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    amountCents: positiveCadCentsSchema,
    relatedInterestPaymentId: z.string().uuid().nullable(),
    narrative: z.string(),
    state: z.string(),
    createdAt: z.string(),
    settledAt: z.string().nullable(),
    interestPeriod: z.string().optional(),
    helocId: z.string().uuid().optional(),
    providerPaymentId: z.string().optional(),
  })
  .passthrough();

export const providerInterestChargeSchema = z
  .object({
    id: z.string().uuid(),
    helocId: z.string().uuid(),
    providerChargeId: z.string(),
    interestPeriod: z.string(),
    amountCents: positiveCadCentsSchema,
    state: z.string(),
    postedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .passthrough();

export const providerInterestPaymentViewSchema = z
  .object({
    chargeId: z.string().uuid(),
    providerChargeId: z.string(),
    interestPeriod: z.string(),
    chargeState: z.string(),
    chargeAmountCents: positiveCadCentsSchema,
    paymentId: z.string().uuid(),
    providerPaymentId: z.string(),
    paymentState: z.string(),
    ordinaryAccountId: z.string().uuid(),
    debitId: z.string().uuid().nullable(),
    amountCents: positiveCadCentsSchema,
    failureCode: z.string().nullable(),
    settledAt: z.string().nullable(),
  })
  .passthrough();

export const bankHealthSchema = z
  .object({
    status: z.string(),
    service: z.string(),
    version: z.string().optional(),
    correlationId: z.string().optional(),
    simulator: z.string().optional(),
  })
  .passthrough();

export type ProviderHelocDraw = z.infer<typeof providerHelocDrawSchema>;
export type ProviderTransfer = z.infer<typeof providerTransferSchema>;
export type ProviderHelocAvailability = z.infer<typeof providerHelocAvailabilitySchema>;
export type ProviderOrdinaryDebit = z.infer<typeof providerOrdinaryDebitSchema>;
export type ProviderInterestPaymentView = z.infer<typeof providerInterestPaymentViewSchema>;
