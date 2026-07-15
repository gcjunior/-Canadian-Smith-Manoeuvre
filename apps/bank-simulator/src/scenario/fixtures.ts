import type { BankScenarioConfig } from './schema.js';

export const happyPathScenario: BankScenarioConfig = {
  scenarioId: 'happy-path',
  mode: 'deterministic',
  mortgagePostingDelayMs: 1_000,
  mortgageSettlementDelayMs: 2_000,
  helocReadvanceDelayMs: 3_000,
  drawSettlementDelayMs: 1_000,
  transferSettlementDelayMs: 1_000,
  interestChargeDay: 1,
  interestDebitDelayMs: 1_000,
  initialBalances: {
    mortgagePrincipalCents: 450_000_00n,
    helocCreditLimitCents: 200_000_00n,
    helocBalanceOwedCents: 0n,
    helocExistingAvailableCreditCents: 10_000_00n,
    ordinaryBankBalanceCents: 5_000_00n,
  },
  deterministicFailureSteps: [],
  seededRandomFailureRate: 0,
  webhooksEnabled: true,
  webhookOutOfOrder: false,
  webhookDuplicateDelivery: false,
};

export const delayedReadvanceScenario: BankScenarioConfig = {
  ...happyPathScenario,
  scenarioId: 'delayed-readvance',
  helocReadvanceDelayMs: 86_400_000,
};

export const nsfInterestScenario: BankScenarioConfig = {
  ...happyPathScenario,
  scenarioId: 'nsf-interest',
  initialBalances: {
    ...happyPathScenario.initialBalances,
    ordinaryBankBalanceCents: 10_00n,
  },
  deterministicFailureSteps: ['ORDINARY_ACCOUNT_NSF'],
};

export const insufficientHelocScenario: BankScenarioConfig = {
  ...happyPathScenario,
  scenarioId: 'insufficient-heloc',
  initialBalances: {
    ...happyPathScenario.initialBalances,
    helocExistingAvailableCreditCents: 0n,
  },
  deterministicFailureSteps: ['INSUFFICIENT_HELOC_CREDIT'],
};

const HOUR = 3_600_000;

/** Deterministic Edmonton demo: posted/settled/readvanced on the stated timeline. */
export const edmontonDemoScenario: BankScenarioConfig = {
  scenarioId: 'edmonton-demo',
  mode: 'deterministic',
  mortgagePostingDelayMs: 12 * HOUR,
  mortgageSettlementDelayMs: 48 * HOUR,
  helocReadvanceDelayMs: 12 * HOUR,
  drawSettlementDelayMs: 2 * HOUR,
  transferSettlementDelayMs: 0,
  interestChargeDay: 15,
  interestDebitDelayMs: 1 * HOUR,
  initialBalances: {
    mortgagePrincipalCents: 450_000_00n,
    helocCreditLimitCents: 200_000_00n,
    helocBalanceOwedCents: 0n,
    helocExistingAvailableCreditCents: 50_000_00n,
    ordinaryBankBalanceCents: 25_000_00n,
  },
  deterministicFailureSteps: [],
  seededRandomFailureRate: 0,
  webhooksEnabled: true,
  webhookOutOfOrder: false,
  webhookDuplicateDelivery: false,
};

/** Same as Edmonton demo, but HELOC draw HTTP times out after the draw is persisted. */
export const edmontonAmbiguousDrawScenario: BankScenarioConfig = {
  ...edmontonDemoScenario,
  scenarioId: 'edmonton-ambiguous-draw',
  deterministicFailureSteps: ['TIMEOUT_AFTER_SUCCESS'],
};

export const SCENARIO_FIXTURES = {
  'happy-path': happyPathScenario,
  'delayed-readvance': delayedReadvanceScenario,
  'nsf-interest': nsfInterestScenario,
  'insufficient-heloc': insufficientHelocScenario,
  'edmonton-demo': edmontonDemoScenario,
  'edmonton-ambiguous-draw': edmontonAmbiguousDrawScenario,
} as const;
