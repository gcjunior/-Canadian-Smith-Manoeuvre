import { z } from 'zod';

import { uuidSchema } from './primitives.js';

export const appRoleSchema = z.enum(['CUSTOMER', 'OPERATIONS', 'ADMIN']);
export type AppRole = z.infer<typeof appRoleSchema>;

/** Authenticated context derived from signed identity — never from request body alone. */
export const tenantContextSchema = z
  .object({
    tenantId: uuidSchema,
    userId: uuidSchema,
    roles: z.array(appRoleSchema).min(1),
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

export const devTokenRequestSchema = z
  .object({
    tenantId: uuidSchema,
    userId: uuidSchema,
    roles: z.array(appRoleSchema).min(1),
  })
  .strict();

export type DevTokenRequest = z.infer<typeof devTokenRequestSchema>;

export const devTokenResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().positive(),
  })
  .strict();

export type DevTokenResponse = z.infer<typeof devTokenResponseSchema>;
