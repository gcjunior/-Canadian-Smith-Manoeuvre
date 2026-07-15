import { z } from 'zod';

export const strategyStateSchema = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED']);

export const monthlyConversionCycleStateSchema = z.enum([
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
  'SKIPPED',
  'PAUSED',
  'FAILED',
]);

export const moneyMovementStateSchema = z.enum([
  'REQUESTED',
  'PENDING',
  'SETTLED',
  'FAILED',
  'UNKNOWN',
  'REVERSED',
]);

export const investmentOrderStateSchema = z.enum([
  'CREATED',
  'SUBMITTED',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'UNKNOWN',
]);

export const mortgagePaymentStateSchema = z.enum(['PENDING', 'SETTLED', 'FAILED', 'CANCELLED']);

export const helocInterestChargeStateSchema = z.enum(['PENDING', 'POSTED', 'FAILED']);

export const helocInterestPaymentStateSchema = z.enum(['PENDING', 'SETTLED', 'FAILED']);

export const interestCycleStateSchema = z.enum([
  'SCHEDULED',
  'AWAITING_CHARGE',
  'AWAITING_DEBIT',
  'RECONCILING',
  'COMPLETED',
  'PAUSED',
  'FAILED',
]);

export const reconciliationStateSchema = z.enum(['PENDING', 'PASSED', 'FAILED']);

export type StrategyState = z.infer<typeof strategyStateSchema>;
export type MonthlyConversionCycleState = z.infer<typeof monthlyConversionCycleStateSchema>;
export type MoneyMovementState = z.infer<typeof moneyMovementStateSchema>;
export type InvestmentOrderState = z.infer<typeof investmentOrderStateSchema>;
export type InterestCycleState = z.infer<typeof interestCycleStateSchema>;
