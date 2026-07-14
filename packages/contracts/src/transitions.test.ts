import { describe, expect, it } from 'vitest';

import {
  assertCycleTransition,
  assertInvestmentOrderTransition,
  assertMoneyMovementTransition,
  assertStrategyTransition,
  ContractTransitionError,
} from './transitions.js';

describe('status transitions', () => {
  it('allows valid strategy and cycle transitions', () => {
    expect(() => assertStrategyTransition('DRAFT', 'ACTIVE')).not.toThrow();
    expect(() => assertCycleTransition('WAITING_FOR_MORTGAGE', 'WAITING_FOR_HELOC')).not.toThrow();
    expect(() => assertMoneyMovementTransition('PENDING', 'SETTLED')).not.toThrow();
    expect(() => assertInvestmentOrderTransition('SUBMITTED', 'FILLED')).not.toThrow();
  });

  it('rejects invalid status transitions', () => {
    expect(() => assertStrategyTransition('CLOSED', 'ACTIVE')).toThrow(ContractTransitionError);
    expect(() => assertCycleTransition('COMPLETED', 'ORDER_PENDING')).toThrow(
      ContractTransitionError,
    );
    expect(() => assertMoneyMovementTransition('SETTLED', 'PENDING')).toThrow(
      ContractTransitionError,
    );
    expect(() => assertInvestmentOrderTransition('FILLED', 'SUBMITTED')).toThrow(
      ContractTransitionError,
    );
  });
});
