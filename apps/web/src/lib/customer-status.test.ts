import { describe, expect, it } from 'vitest';

import { mapInternalCycleState } from './customer-status';

describe('mapInternalCycleState', () => {
  it('never exposes Temporal-style wording', () => {
    expect(mapInternalCycleState('WAITING_FOR_MORTGAGE')).toBe('Waiting for mortgage payment');
    expect(mapInternalCycleState('HELOC_DRAW_PENDING')).toBe('Transferring funds');
    expect(mapInternalCycleState('ORDER_PENDING')).toBe('Investing');
    expect(mapInternalCycleState('RECONCILING')).toBe('Confirming transactions');
    expect(mapInternalCycleState('COMPLETED')).toBe('Completed');
    expect(mapInternalCycleState('FAILED')).toBe('Paused');
  });
});
