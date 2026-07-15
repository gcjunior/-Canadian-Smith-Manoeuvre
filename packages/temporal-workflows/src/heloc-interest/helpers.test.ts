import { describe, expect, it } from 'vitest';

import { durationToMs, idempotencyKey } from './helpers.js';
import { helocInterestWorkflowId } from './types.js';

describe('heloc interest helpers', () => {
  it('builds workflow id', () => {
    expect(
      helocInterestWorkflowId({
        tenantId: 't1',
        strategyId: 's1',
        interestPeriod: '2026-07',
      }),
    ).toBe('heloc-interest/t1/s1/2026-07');
  });

  it('parses poll durations', () => {
    expect(durationToMs('6 hours')).toBe(6 * 60 * 60 * 1000);
    expect(durationToMs('14 days')).toBe(14 * 24 * 60 * 60 * 1000);
    expect(durationToMs('7 days')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('builds hi: idempotency keys', () => {
    expect(idempotencyKey('t1', 's1', '2026-07', 'scenario')).toBe('hi:t1:s1:2026-07:scenario');
  });
});
