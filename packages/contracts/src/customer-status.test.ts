import { describe, expect, it } from 'vitest';

import { toCustomerCycleStatus } from './customer-status.js';

describe('toCustomerCycleStatus', () => {
  it('maps internal states to the customer vocabulary', () => {
    expect(toCustomerCycleStatus('WAITING_FOR_HELOC')).toBe('Waiting for available credit');
    expect(toCustomerCycleStatus('BROKERAGE_TRANSFER_PENDING')).toBe('Transferring funds');
    expect(toCustomerCycleStatus('SKIPPED')).toBe('Completed');
  });
});
