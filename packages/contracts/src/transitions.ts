import { z } from 'zod';

import {
  investmentOrderStateSchema,
  moneyMovementStateSchema,
  monthlyConversionCycleStateSchema,
  type InvestmentOrderState,
  type MoneyMovementState,
  type MonthlyConversionCycleState,
  type StrategyState,
  strategyStateSchema,
} from './states.js';

export const STRATEGY_TRANSITIONS: Record<StrategyState, readonly StrategyState[]> = {
  DRAFT: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['PAUSED', 'CLOSED'],
  PAUSED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
};

export const CYCLE_TRANSITIONS: Record<
  MonthlyConversionCycleState,
  readonly MonthlyConversionCycleState[]
> = {
  SCHEDULED: ['WAITING_FOR_MORTGAGE', 'PAUSED', 'FAILED'],
  WAITING_FOR_MORTGAGE: ['WAITING_FOR_HELOC', 'PAUSED', 'FAILED'],
  WAITING_FOR_HELOC: ['HELOC_DRAW_PENDING', 'PAUSED', 'FAILED'],
  HELOC_DRAW_PENDING: ['HELOC_DRAW_CONFIRMED', 'PAUSED', 'FAILED'],
  HELOC_DRAW_CONFIRMED: ['BROKERAGE_TRANSFER_PENDING', 'PAUSED', 'FAILED'],
  BROKERAGE_TRANSFER_PENDING: ['BROKERAGE_FUNDED', 'PAUSED', 'FAILED'],
  BROKERAGE_FUNDED: ['ORDER_PENDING', 'PAUSED', 'FAILED'],
  ORDER_PENDING: ['ORDER_FILLED', 'PAUSED', 'FAILED'],
  ORDER_FILLED: ['RECONCILING', 'PAUSED', 'FAILED'],
  RECONCILING: ['COMPLETED', 'PAUSED', 'FAILED'],
  COMPLETED: [],
  PAUSED: [],
  FAILED: [],
};

export const MONEY_MOVEMENT_TRANSITIONS: Record<MoneyMovementState, readonly MoneyMovementState[]> =
  {
    REQUESTED: ['PENDING', 'FAILED', 'UNKNOWN'],
    PENDING: ['SETTLED', 'FAILED', 'UNKNOWN'],
    SETTLED: ['REVERSED'],
    FAILED: [],
    UNKNOWN: ['SETTLED', 'FAILED', 'PENDING'],
    REVERSED: [],
  };

export const INVESTMENT_ORDER_TRANSITIONS: Record<
  InvestmentOrderState,
  readonly InvestmentOrderState[]
> = {
  CREATED: ['SUBMITTED', 'CANCELLED', 'REJECTED'],
  SUBMITTED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'UNKNOWN'],
  PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'UNKNOWN'],
  FILLED: [],
  CANCELLED: [],
  REJECTED: [],
  UNKNOWN: ['SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED'],
};

export class ContractTransitionError extends Error {
  readonly code = 'INVALID_STATUS_TRANSITION' as const;

  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid ${entity} transition: ${from} -> ${to}`);
    this.name = 'ContractTransitionError';
  }
}

function assertTransition<T extends string>(
  entity: string,
  map: Record<T, readonly T[]>,
  from: T,
  to: T,
): void {
  if (!map[from].includes(to)) {
    throw new ContractTransitionError(entity, from, to);
  }
}

export function assertStrategyTransition(from: StrategyState, to: StrategyState): void {
  strategyStateSchema.parse(from);
  strategyStateSchema.parse(to);
  assertTransition('strategy', STRATEGY_TRANSITIONS, from, to);
}

export function assertCycleTransition(
  from: MonthlyConversionCycleState,
  to: MonthlyConversionCycleState,
): void {
  monthlyConversionCycleStateSchema.parse(from);
  monthlyConversionCycleStateSchema.parse(to);
  assertTransition('monthlyConversionCycle', CYCLE_TRANSITIONS, from, to);
}

export function assertMoneyMovementTransition(
  from: MoneyMovementState,
  to: MoneyMovementState,
): void {
  moneyMovementStateSchema.parse(from);
  moneyMovementStateSchema.parse(to);
  assertTransition('moneyMovement', MONEY_MOVEMENT_TRANSITIONS, from, to);
}

export function assertInvestmentOrderTransition(
  from: InvestmentOrderState,
  to: InvestmentOrderState,
): void {
  investmentOrderStateSchema.parse(from);
  investmentOrderStateSchema.parse(to);
  assertTransition('investmentOrder', INVESTMENT_ORDER_TRANSITIONS, from, to);
}

export const statusTransitionRequestSchema = z
  .object({
    entity: z.enum(['strategy', 'monthlyConversionCycle', 'moneyMovement', 'investmentOrder']),
    from: z.string(),
    to: z.string(),
  })
  .strict();
