/** Shared constants for the deterministic Edmonton Canadian Smith Manoeuvre demo. */

export const HOUR_MS = 3_600_000;

export const DEMO = {
  tenantSlug: 'edmonton-demo',
  tenantName: 'Edmonton Demo Household',
  userEmail: 'pat.edmonton@example.ca',
  userDisplayName: 'Pat Edmonton',
  timezone: 'America/Edmonton',
  expectedPaymentDay: 1,
  paymentPeriod: '2026-07',
  interestPeriod: '2026-07',
  expectedPaymentDate: '2026-07-01',
  expectedInterestChargeDate: '2026-07-15',
  symbol: 'XEQT',
  etfQuoteMid: '61.99',
  /** Strategy monthly investment cap ($1,000). */
  userMonthlyCapCents: 100_000n,
  /** Platform monthly draw cap ($5,000). */
  platformMonthlyCapCents: 500_000n,
  mortgagePayment: {
    totalAmountCents: 240_000n,
    interestAmountCents: 163_000n,
    principalAmountCents: 77_000n,
  },
  /** min(principal, newly available, user cap, platform cap) = $770. */
  expectedInvestmentCents: 77_000n,
  /** Sample HELOC interest charge paid from the ordinary bank account. */
  helocInterestChargeCents: 8_500n,
  delays: {
    mortgagePostingMs: 12 * HOUR_MS,
    mortgageSettlementMs: 48 * HOUR_MS,
    helocReadvanceMs: 12 * HOUR_MS,
    drawSettlementMs: 2 * HOUR_MS,
    depositSettlementMs: 4 * HOUR_MS,
    interestDebitMs: HOUR_MS,
  },
  clockStartIso: '2026-07-01T06:00:00.000Z',
} as const;

export type DemoScenarioKind = 'edmonton-demo' | 'edmonton-ambiguous-draw';
