import { z } from 'zod';

import { nonNegativeCadCentsSchema, positiveCadCentsSchema } from './money.js';
import {
  correlationIdSchema,
  decimalStringSchema,
  isoDateTimeSchema,
  uuidSchema,
} from './primitives.js';
import { investmentOrderStateSchema } from './states.js';

export const investmentOrderSideSchema = z.enum(['BUY', 'SELL']);

const orderBase = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  brokerageAccountId: uuidSchema,
  providerOrderId: z.string().min(1).nullable(),
  idempotencyKey: uuidSchema,
  symbol: z.string().min(1).max(32),
  side: investmentOrderSideSchema,
  notionalCents: positiveCadCentsSchema,
  quantity: decimalStringSchema.nullable(),
  limitPrice: decimalStringSchema.nullable(),
  correlationId: correlationIdSchema,
  cycleId: uuidSchema.optional(),
  submittedAt: isoDateTimeSchema.nullable(),
  filledAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
});

export const investmentOrderSchema = z.discriminatedUnion('state', [
  orderBase.extend({ state: z.literal('CREATED') }).strict(),
  orderBase
    .extend({
      state: z.literal('SUBMITTED'),
      submittedAt: isoDateTimeSchema,
      providerOrderId: z.string().min(1),
    })
    .strict(),
  orderBase
    .extend({
      state: z.literal('PARTIALLY_FILLED'),
      submittedAt: isoDateTimeSchema,
      providerOrderId: z.string().min(1),
      quantity: decimalStringSchema,
    })
    .strict(),
  orderBase
    .extend({
      state: z.literal('FILLED'),
      submittedAt: isoDateTimeSchema,
      filledAt: isoDateTimeSchema,
      providerOrderId: z.string().min(1),
      quantity: decimalStringSchema,
    })
    .strict(),
  orderBase.extend({ state: z.literal('CANCELLED') }).strict(),
  orderBase.extend({ state: z.literal('REJECTED') }).strict(),
  orderBase.extend({ state: z.literal('UNKNOWN') }).strict(),
]);

export type InvestmentOrder = z.infer<typeof investmentOrderSchema>;

export const notionalMarketOrderRequestSchema = z
  .object({
    brokerageAccountId: uuidSchema,
    symbol: z.string().min(1).max(32),
    side: z.literal('BUY'),
    notionalCents: positiveCadCentsSchema,
    idempotencyKey: uuidSchema,
    cycleId: uuidSchema.optional(),
  })
  .strict();

export type NotionalMarketOrderRequest = z.infer<typeof notionalMarketOrderRequestSchema>;

export const investmentFillSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    orderId: uuidSchema,
    providerFillId: z.string().min(1),
    quantity: decimalStringSchema,
    price: decimalStringSchema,
    amountCents: nonNegativeCadCentsSchema,
    filledAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export type InvestmentFill = z.infer<typeof investmentFillSchema>;

export { investmentOrderStateSchema };
