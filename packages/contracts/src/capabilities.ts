import { z } from 'zod';

import { AppError } from './errors.js';

export const mortgageCapabilitiesSchema = z
  .object({
    canReadPayments: z.literal(true),
  })
  .strict();

export const helocCapabilitiesSchema = z
  .object({
    canReadAvailability: z.literal(true),
    canDraw: z.literal(true),
    canReadInterestCharges: z.literal(true),
  })
  .strict();

export const ordinaryBankCapabilitiesSchema = z
  .object({
    canDebitInterest: z.literal(true),
    canReadTransactions: z.literal(true),
  })
  .strict();

export const brokerageCapabilitiesSchema = z
  .object({
    canDeposit: z.literal(true),
    canPlaceNotionalMarketOrder: z.literal(true),
    canReadOrder: z.literal(true),
    supportsFractionalUnits: z.literal(true),
  })
  .strict();

export const MORTGAGE_CAPABILITIES = {
  canReadPayments: true,
} as const satisfies z.infer<typeof mortgageCapabilitiesSchema>;

export const HELOC_CAPABILITIES = {
  canReadAvailability: true,
  canDraw: true,
  canReadInterestCharges: true,
} as const satisfies z.infer<typeof helocCapabilitiesSchema>;

export const ORDINARY_BANK_CAPABILITIES = {
  canDebitInterest: true,
  canReadTransactions: true,
} as const satisfies z.infer<typeof ordinaryBankCapabilitiesSchema>;

export const BROKERAGE_CAPABILITIES = {
  canDeposit: true,
  canPlaceNotionalMarketOrder: true,
  canReadOrder: true,
  supportsFractionalUnits: true,
} as const satisfies z.infer<typeof brokerageCapabilitiesSchema>;

export const accountKindSchema = z.enum([
  'MORTGAGE',
  'HELOC',
  'BANK_OPERATING',
  'BROKERAGE_CASH',
  'BROKERAGE_POSITION',
]);

export type AccountKind = z.infer<typeof accountKindSchema>;

export type AccountCapabilityMap = {
  MORTGAGE: typeof MORTGAGE_CAPABILITIES;
  HELOC: typeof HELOC_CAPABILITIES;
  BANK_OPERATING: typeof ORDINARY_BANK_CAPABILITIES;
  BROKERAGE_CASH: typeof BROKERAGE_CAPABILITIES;
  BROKERAGE_POSITION: { readonly supportsFractionalUnits: true };
};

export const ACCOUNT_CAPABILITIES: AccountCapabilityMap = {
  MORTGAGE: MORTGAGE_CAPABILITIES,
  HELOC: HELOC_CAPABILITIES,
  BANK_OPERATING: ORDINARY_BANK_CAPABILITIES,
  BROKERAGE_CASH: BROKERAGE_CAPABILITIES,
  BROKERAGE_POSITION: { supportsFractionalUnits: true },
};

export function assertAccountCapability(
  kind: AccountKind,
  capability: string,
  correlationId?: string,
): void {
  const caps = ACCOUNT_CAPABILITIES[kind] as Record<string, boolean>;
  if (caps[capability] !== true) {
    throw new AppError({
      code: 'UNSUPPORTED_ACCOUNT_CAPABILITY',
      message: `Account kind ${kind} does not support capability ${capability}`,
      details: { kind, capability },
      ...(correlationId !== undefined ? { correlationId } : {}),
      retryable: false,
    });
  }
}

export function hasAccountCapability(kind: AccountKind, capability: string): boolean {
  const caps = ACCOUNT_CAPABILITIES[kind] as Record<string, boolean>;
  return caps[capability] === true;
}
