import type { LedgerAccountCategory } from './categories.js';

/**
 * Compensating entry builder — corrections never mutate posted rows.
 * The new businessEventId must be unique; reversesBusinessEventId points at the original.
 */
export function buildCompensatingLedgerLeg(input: {
  originalBusinessEventId: string;
  originalAccountId: string;
  originalDirection: 'DEBIT' | 'CREDIT';
  originalAmountCents: bigint;
  originalCategory: LedgerAccountCategory;
  compensatingBusinessEventId: string;
  narrative: string;
}): {
  accountId: string;
  businessEventId: string;
  direction: 'DEBIT' | 'CREDIT';
  amountCents: bigint;
  accountCategory: LedgerAccountCategory;
  reversesBusinessEventId: string;
  narrative: string;
} {
  return {
    accountId: input.originalAccountId,
    businessEventId: input.compensatingBusinessEventId,
    direction: input.originalDirection === 'DEBIT' ? 'CREDIT' : 'DEBIT',
    amountCents: input.originalAmountCents,
    accountCategory: input.originalCategory,
    reversesBusinessEventId: input.originalBusinessEventId,
    narrative: input.narrative,
  };
}
