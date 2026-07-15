import { z } from 'zod';

import { isoDateTimeSchema, uuidSchema } from './primitives.js';

export const providerWebhookSchema = z
  .object({
    provider: z.enum(['bank-sim', 'brokerage-sim']),
    providerEventId: z.string().min(1).max(128),
    eventType: z.string().min(1).max(128),
    occurredAt: isoDateTimeSchema,
    /** Server maps external account → tenant; body must not be trusted for tenancy. */
    externalAccountId: z.string().min(1).max(128),
    payload: z.record(z.unknown()),
    signature: z.string().min(1),
  })
  .strict();

export type ProviderWebhook = z.infer<typeof providerWebhookSchema>;

export const webhookProcessingStateSchema = z.enum([
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'RETAINED',
  'RETRYABLE',
  'DEAD_LETTERED',
]);

export type WebhookProcessingState = z.infer<typeof webhookProcessingStateSchema>;

/** Tiny Signal tip for MonthlyConversionWorkflow — never a full provider payload. */
export const webhookSignalSchema = z
  .object({
    providerEventId: z.string().min(1).max(128),
    accountId: uuidSchema,
    eventType: z.string().min(1).max(128),
    providerResourceId: z.string().min(1).max(128).optional(),
    occurredAt: isoDateTimeSchema.optional(),
    providerType: z.enum(['BANK', 'BROKERAGE']),
  })
  .strict();

export type WebhookSignal = z.infer<typeof webhookSignalSchema>;

export const providerWebhookRecordSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    provider: z.string().min(1),
    providerEventId: z.string().min(1),
    eventType: z.string().min(1),
    payloadRedacted: z.record(z.unknown()),
    processingState: webhookProcessingStateSchema,
    attempts: z.number().int().nonnegative(),
    nextAttemptAt: isoDateTimeSchema.nullable(),
    lastError: z.string().nullable(),
    deadLetterReason: z.string().nullable(),
    financialAccountId: uuidSchema.nullable(),
    strategyId: uuidSchema.nullable(),
    paymentPeriod: z.string().nullable(),
    outcome: z.string().nullable(),
    receivedAt: isoDateTimeSchema,
    processedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export type ProviderWebhookRecord = z.infer<typeof providerWebhookRecordSchema>;
