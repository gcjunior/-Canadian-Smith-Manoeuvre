import { z } from 'zod';

import { uuidSchema } from './primitives.js';

/** Authenticated tenant context derived from identity — never from request body alone. */
export const tenantContextSchema = z
  .object({
    tenantId: uuidSchema,
    userId: uuidSchema,
    roles: z.array(z.enum(['OWNER', 'MEMBER', 'OPS_READ'])).min(1),
  })
  .strict();

export type TenantContext = z.infer<typeof tenantContextSchema>;

export const tenantSummarySchema = z
  .object({
    id: uuidSchema,
    slug: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
  })
  .strict();

export type TenantSummary = z.infer<typeof tenantSummarySchema>;
