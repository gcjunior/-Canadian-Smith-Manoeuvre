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

export const providerWebhookRecordSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    provider: z.string().min(1),
    providerEventId: z.string().min(1),
    eventType: z.string().min(1),
    payloadRedacted: z.record(z.unknown()),
    receivedAt: isoDateTimeSchema,
    processedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export type ProviderWebhookRecord = z.infer<typeof providerWebhookRecordSchema>;
