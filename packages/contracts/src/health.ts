import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'degraded', 'error']);

export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  service: z.string().min(1),
  version: z.string().min(1).default('0.0.0'),
  correlationId: z.string().uuid().optional(),
  checks: z
    .record(
      z.object({
        status: healthStatusSchema,
        detail: z.string().optional(),
      }),
    )
    .optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
