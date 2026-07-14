export const STRATEGY_STATES = ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED'] as const;
export type StrategyState = (typeof STRATEGY_STATES)[number];

export const MONTHLY_CONVERSION_CYCLE_STATES = [
  'SCHEDULED',
  'WAITING_FOR_MORTGAGE',
  'WAITING_FOR_HELOC',
  'HELOC_DRAW_PENDING',
  'HELOC_DRAW_CONFIRMED',
  'BROKERAGE_TRANSFER_PENDING',
  'BROKERAGE_FUNDED',
  'ORDER_PENDING',
  'ORDER_FILLED',
  'RECONCILING',
  'COMPLETED',
  'PAUSED',
  'FAILED',
] as const;
export type MonthlyConversionCycleState = (typeof MONTHLY_CONVERSION_CYCLE_STATES)[number];

export const MONEY_MOVEMENT_STATES = [
  'REQUESTED',
  'PENDING',
  'SETTLED',
  'FAILED',
  'UNKNOWN',
  'REVERSED',
] as const;
export type MoneyMovementState = (typeof MONEY_MOVEMENT_STATES)[number];

export const INVESTMENT_ORDER_STATES = [
  'CREATED',
  'SUBMITTED',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'UNKNOWN',
] as const;
export type InvestmentOrderState = (typeof INVESTMENT_ORDER_STATES)[number];
