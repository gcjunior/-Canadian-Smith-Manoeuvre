import { z } from 'zod';

import { positiveCadCentsSchema } from './money.js';
import { correlationIdSchema, isoDateTimeSchema, uuidSchema } from './primitives.js';

const movementBase = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  amountCents: positiveCadCentsSchema,
  currencyCode: z.literal('CAD'),
  idempotencyKey: uuidSchema,
  correlationId: correlationIdSchema,
  providerTransactionId: z.string().min(1).nullable(),
  cycleId: uuidSchema.optional(),
  requestedAt: isoDateTimeSchema,
  settledAt: isoDateTimeSchema.nullable(),
  version: z.number().int().positive(),
});

export const bankTransferSchema = z.discriminatedUnion('state', [
  movementBase
    .extend({
      type: z.literal('HELOC_TO_BROKERAGE_TRANSFER'),
      state: z.literal('REQUESTED'),
      sourceAccountId: uuidSchema,
      destinationAccountId: uuidSchema,
    })
    .strict(),
  movementBase
    .extend({
      type: z.literal('HELOC_TO_BROKERAGE_TRANSFER'),
      state: z.literal('PENDING'),
      sourceAccountId: uuidSchema,
      destinationAccountId: uuidSchema,
    })
    .strict(),
  movementBase
    .extend({
      type: z.literal('HELOC_TO_BROKERAGE_TRANSFER'),
      state: z.literal('SETTLED'),
      sourceAccountId: uuidSchema,
      destinationAccountId: uuidSchema,
      settledAt: isoDateTimeSchema,
      providerTransactionId: z.string().min(1),
    })
    .strict(),
  movementBase
    .extend({
      type: z.literal('HELOC_TO_BROKERAGE_TRANSFER'),
      state: z.literal('FAILED'),
      sourceAccountId: uuidSchema,
      destinationAccountId: uuidSchema,
    })
    .strict(),
  movementBase
    .extend({
      type: z.literal('HELOC_TO_BROKERAGE_TRANSFER'),
      state: z.literal('UNKNOWN'),
      sourceAccountId: uuidSchema,
      destinationAccountId: uuidSchema,
    })
    .strict(),
  movementBase
    .extend({
      type: z.literal('HELOC_TO_BROKERAGE_TRANSFER'),
      state: z.literal('REVERSED'),
      sourceAccountId: uuidSchema,
      destinationAccountId: uuidSchema,
    })
    .strict(),
]);

export type BankTransfer = z.infer<typeof bankTransferSchema>;

export const bankTransferRequestSchema = z
  .object({
    sourceAccountId: uuidSchema,
    destinationAccountId: uuidSchema,
    amountCents: positiveCadCentsSchema,
    idempotencyKey: uuidSchema,
    cycleId: uuidSchema.optional(),
  })
  .strict();

export type BankTransferRequest = z.infer<typeof bankTransferRequestSchema>;

const depositBase = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  brokerageAccountId: uuidSchema,
  moneyMovementId: uuidSchema,
  amountCents: positiveCadCentsSchema,
  providerDepositId: z.string().min(1),
  cycleId: uuidSchema.optional(),
  settledAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
});

export const brokerageDepositSchema = z.discriminatedUnion('state', [
  depositBase.extend({ state: z.literal('REQUESTED') }).strict(),
  depositBase.extend({ state: z.literal('PENDING') }).strict(),
  depositBase.extend({ state: z.literal('SETTLED'), settledAt: isoDateTimeSchema }).strict(),
  depositBase.extend({ state: z.literal('FAILED') }).strict(),
  depositBase.extend({ state: z.literal('UNKNOWN') }).strict(),
  depositBase.extend({ state: z.literal('REVERSED') }).strict(),
]);

export type BrokerageDeposit = z.infer<typeof brokerageDepositSchema>;

export const brokerageDepositRequestSchema = z
  .object({
    brokerageAccountId: uuidSchema,
    amountCents: positiveCadCentsSchema,
    idempotencyKey: uuidSchema,
    cycleId: uuidSchema.optional(),
  })
  .strict();

export type BrokerageDepositRequest = z.infer<typeof brokerageDepositRequestSchema>;
