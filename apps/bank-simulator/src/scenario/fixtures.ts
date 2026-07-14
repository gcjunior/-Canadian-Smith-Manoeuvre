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

export const SCENARIO_FIXTURES = {
  'happy-path': happyPathScenario,
  'delayed-readvance': delayedReadvanceScenario,
  'nsf-interest': nsfInterestScenario,
  'insufficient-heloc': insufficientHelocScenario,
} as const;
