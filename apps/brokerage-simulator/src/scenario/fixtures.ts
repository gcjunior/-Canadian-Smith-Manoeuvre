import type { BrokerageScenarioConfig } from './schema.js';

export const happyPathScenario: BrokerageScenarioConfig = {
  scenarioId: 'happy-path',
  mode: 'deterministic',
  etfSymbol: 'XEQT',
  quotePrice: '30.0000000000',
  spread: '0.01',
  commissionCents: 0n,
  depositSettlementDelayMs: 1_000,
  orderAckDelayMs: 500,
  fillDelayMs: 1_000,
  fillPriceMove: '0.05',
  partialFillFraction: '0.40',
  initialSettledCashCents: 0n,
  deterministicFailureSteps: [],
  seededRandomFailureRate: 0,
  webhooksEnabled: true,
  webhookOutOfOrder: false,
  webhookDuplicateDelivery: false,
  allowFractionalUnits: true,
};

export const partialFillScenario: BrokerageScenarioConfig = {
  ...happyPathScenario,
  scenarioId: 'partial-fill',
  deterministicFailureSteps: ['PARTIAL_FILL'],
};

export const insufficientCashScenario: BrokerageScenarioConfig = {
  ...happyPathScenario,
  scenarioId: 'insufficient-cash',
  initialSettledCashCents: 0n,
  deterministicFailureSteps: ['INSUFFICIENT_SETTLED_CASH'],
};

export const restrictedAccountScenario: BrokerageScenarioConfig = {
  ...happyPathScenario,
  scenarioId: 'account-restricted',
  initialSettledCashCents: 100_000_00n,
  deterministicFailureSteps: ['ACCOUNT_RESTRICTION'],
};

export const priceMoveScenario: BrokerageScenarioConfig = {
  ...happyPathScenario,
  scenarioId: 'price-move',
  initialSettledCashCents: 100_000_00n,
  deterministicFailureSteps: ['PRICE_MOVEMENT'],
};

const HOUR = 3_600_000;

/** Brokering side of the Edmonton demo — XEQT @ $61.99, fractional, 4h deposit settle. */
export const edmontonDemoScenario: BrokerageScenarioConfig = {
  scenarioId: 'edmonton-demo',
  mode: 'deterministic',
  etfSymbol: 'XEQT',
  quotePrice: '61.9900000000',
  spread: '0.01',
  commissionCents: 0n,
  depositSettlementDelayMs: 4 * HOUR,
  orderAckDelayMs: 30 * 60_000,
  fillDelayMs: 30 * 60_000,
  fillPriceMove: '0.00',
  partialFillFraction: '0.40',
  initialSettledCashCents: 0n,
  deterministicFailureSteps: [],
  seededRandomFailureRate: 0,
  webhooksEnabled: true,
  webhookOutOfOrder: false,
  webhookDuplicateDelivery: false,
  allowFractionalUnits: true,
};

export const SCENARIO_FIXTURES = {
  'happy-path': happyPathScenario,
  'partial-fill': partialFillScenario,
  'insufficient-cash': insufficientCashScenario,
  'account-restricted': restrictedAccountScenario,
  'price-move': priceMoveScenario,
  'edmonton-demo': edmontonDemoScenario,
} as const;
