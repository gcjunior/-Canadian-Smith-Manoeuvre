import { z } from 'zod';

import {
  brokerageCapabilitiesSchema,
  helocCapabilitiesSchema,
  mortgageCapabilitiesSchema,
  ordinaryBankCapabilitiesSchema,
  accountKindSchema,
} from './capabilities.js';
import { nonNegativeCadCentsSchema, positiveCadCentsSchema } from './money.js';
import { isoDateTimeSchema, uuidSchema } from './primitives.js';

const accountBaseSchema = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  userId: uuidSchema,
  connectionId: uuidSchema,
  displayAlias: z.string().min(1).max(120),
  providerAccountId: z.string().min(1).max(128),
  accountNumberLast4: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  currencyCode: z.literal('CAD'),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
});

export const mortgageAccountSchema = accountBaseSchema
  .extend({
    kind: z.literal('MORTGAGE'),
    outstandingPrincipalCents: nonNegativeCadCentsSchema,
    contractualPaymentCents: positiveCadCentsSchema,
    expectedPaymentDay: z.number().int().min(1).max(28),
    capabilities: mortgageCapabilitiesSchema,
  })
  .strict();

export const helocAccountSchema = accountBaseSchema
  .extend({
    kind: z.literal('HELOC'),
    creditLimitCents: positiveCadCentsSchema,
    balanceOwedCents: nonNegativeCadCentsSchema,
    availableCreditCents: nonNegativeCadCentsSchema,
    capabilities: helocCapabilitiesSchema,
  })
  .strict();

export const ordinaryBankAccountSchema = accountBaseSchema
  .extend({
    kind: z.literal('BANK_OPERATING'),
    capabilities: ordinaryBankCapabilitiesSchema,
  })
  .strict();

export const brokerageAccountSchema = accountBaseSchema
  .extend({
    kind: z.literal('BROKERAGE_CASH'),
    registrationType: z.literal('NON_REGISTERED'),
    capabilities: brokerageCapabilitiesSchema,
  })
  .strict();

export const financialAccountSchema = z.discriminatedUnion('kind', [
  mortgageAccountSchema,
  helocAccountSchema,
  ordinaryBankAccountSchema,
  brokerageAccountSchema,
]);

export type MortgageAccount = z.infer<typeof mortgageAccountSchema>;
export type HelocAccount = z.infer<typeof helocAccountSchema>;
export type OrdinaryBankAccount = z.infer<typeof ordinaryBankAccountSchema>;
export type BrokerageAccount = z.infer<typeof brokerageAccountSchema>;
export type FinancialAccount = z.infer<typeof financialAccountSchema>;

export { accountKindSchema };
