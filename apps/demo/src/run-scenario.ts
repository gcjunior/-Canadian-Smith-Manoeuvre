import { createBankAdmin } from './sim-admin.js';
import { AcceleratedSimulatorClock } from './clock.js';
import { DEMO } from './constants.js';
import type { SeedResult } from './seed.js';

export interface ScenarioRunOptions {
  bankBaseUrl: string;
  brokerageBaseUrl: string;
  seed: SeedResult;
  /** Called after each gated clock phase for assertions. */
  onPhase?: (phase: ScenarioPhase) => Promise<void>;
}

export type ScenarioPhase =
  | 'seeded'
  | 'payment_scheduled'
  | 'mortgage_posted'
  | 'mortgage_settled'
  | 'heloc_readvanced'
  | 'conversion_settlements_driving'
  | 'interest_posted'
  | 'interest_settled';

/**
 * Drive the Edmonton mortgage → HELOC → conversion timeline on accelerated
 * simulator clocks. Does not start Temporal Workflows — pair with worker/e2e.
 */
export async function driveEdmontonScenario(options: ScenarioRunOptions): Promise<{
  clock: AcceleratedSimulatorClock;
  stopSettlementDriver: (() => void) | null;
}> {
  const bank = createBankAdmin(options.bankBaseUrl);
  const clock = new AcceleratedSimulatorClock(options.bankBaseUrl, options.brokerageBaseUrl);

  await options.onPhase?.('seeded');

  await bank.scheduleMortgagePayment({
    mortgageId: options.seed.mortgageFacilityId,
    paymentPeriod: DEMO.paymentPeriod,
    totalAmountCents: DEMO.mortgagePayment.totalAmountCents.toString(),
    principalAmountCents: DEMO.mortgagePayment.principalAmountCents.toString(),
    interestAmountCents: DEMO.mortgagePayment.interestAmountCents.toString(),
  });
  await options.onPhase?.('payment_scheduled');

  await clock.toMortgagePosted();
  await options.onPhase?.('mortgage_posted');

  await clock.toMortgageSettled();
  await options.onPhase?.('mortgage_settled');

  await clock.toHelocReadvanced();
  await options.onPhase?.('heloc_readvanced');

  const stopSettlementDriver = clock.startSettlementDriver();
  await options.onPhase?.('conversion_settlements_driving');

  return { clock, stopSettlementDriver };
}

export async function postAndSettleHelocInterest(options: {
  bankBaseUrl: string;
  brokerageBaseUrl: string;
  seed: SeedResult;
  onPhase?: (phase: ScenarioPhase) => Promise<void>;
}): Promise<void> {
  const bank = createBankAdmin(options.bankBaseUrl);
  const clock = new AcceleratedSimulatorClock(options.bankBaseUrl, options.brokerageBaseUrl);

  await bank.postInterestCharge({
    helocId: options.seed.helocFacilityId,
    ordinaryAccountId: options.seed.ordinaryAccountId,
    interestPeriod: DEMO.interestPeriod,
    amountCents: DEMO.helocInterestChargeCents.toString(),
  });
  await options.onPhase?.('interest_posted');
  await clock.advance(DEMO.delays.interestDebitMs);
  await options.onPhase?.('interest_settled');
}
