import { z } from 'zod';

import { correlationIdSchema, isoDateTimeSchema, uuidSchema } from './primitives.js';
import { reconciliationStateSchema } from './states.js';

export const reconciliationItemResultSchema = z.enum(['PASS', 'FAIL', 'WARN']);

export const reconciliationItemSchema = z
  .object({
    code: z.string().min(1),
    result: reconciliationItemResultSchema,
    expectedValue: z.string().nullable(),
    actualValue: z.string().nullable(),
    detail: z.string().nullable(),
  })
  .strict();

export const reconciliationResultSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    strategyId: uuidSchema,
    cycleId: uuidSchema.nullable(),
    state: reconciliationStateSchema,
    correlationId: correlationIdSchema,
    summary: z.string().nullable(),
    items: z.array(reconciliationItemSchema),
    completedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    version: z.number().int().positive(),
  })
  .strict();

export type ReconciliationResult = z.infer<typeof reconciliationResultSchema>;
export type ReconciliationItem = z.infer<typeof reconciliationItemSchema>;
