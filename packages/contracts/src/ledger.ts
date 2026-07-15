import { z } from 'zod';

import { isoDateTimeSchema, uuidSchema } from './primitives.js';
import { cadCentsSchema } from './money.js';

export const ledgerAccountCategorySchema = z.enum([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
  'CLEARING',
]);

export const ledgerEntryDirectionSchema = z.enum(['DEBIT', 'CREDIT']);

export const ledgerEntrySchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    accountId: uuidSchema,
    strategyId: uuidSchema.nullable(),
    cycleId: uuidSchema.nullable(),
    interestCycleId: uuidSchema.nullable(),
    businessEventId: z.string().min(1),
    direction: ledgerEntryDirectionSchema,
    amountCents: cadCentsSchema,
    currencyCode: z.string().length(3),
    accountCategory: ledgerAccountCategorySchema,
    providerRefType: z.string().nullable(),
    providerRefId: z.string().nullable(),
    reversesBusinessEventId: z.string().nullable(),
    correlationId: uuidSchema,
    narrative: z.string().min(1),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const ledgerIntegrityReportSchema = z
  .object({
    tenantId: uuidSchema,
    debitCents: z.string(),
    creditCents: z.string(),
    balanced: z.boolean(),
    failedCycleIds: z.array(uuidSchema),
    crossLinkedProviderRefs: z.array(z.string()),
  })
  .strict();

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type LedgerAccountCategory = z.infer<typeof ledgerAccountCategorySchema>;
export type LedgerIntegrityReport = z.infer<typeof ledgerIntegrityReportSchema>;
