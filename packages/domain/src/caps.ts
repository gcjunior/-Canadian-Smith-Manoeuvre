import { minCents, type CadCents } from './money.js';

/**
 * Draw amount for a conversion cycle.
 * Financial workflows will call this later; scaffold includes the pure formula only.
 */
export function computeDrawAmountCents(input: {
  principalRepaidCents: CadCents;
  newlyAvailableHelocCreditCents: CadCents;
  userMonthlyCapCents: CadCents;
  platformMonthlyCapCents: CadCents;
}): CadCents {
  return minCents(
    input.principalRepaidCents,
    input.newlyAvailableHelocCreditCents,
    input.userMonthlyCapCents,
    input.platformMonthlyCapCents,
  );
}
