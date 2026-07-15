import { describe, expect, it } from 'vitest';

import { deriveAnchorsFromCheckInstant } from './schedule-anchors.js';

describe('schedule-anchors (workflow copy)', () => {
  it('derives Feb period from March 1 check', () => {
    const anchors = deriveAnchorsFromCheckInstant({
      instant: new Date('2026-03-01T14:00:00.000Z'),
      timeZone: 'America/Toronto',
      expectedPaymentDay: 28,
    });
    expect(anchors.paymentPeriod).toBe('2026-02');
    expect(anchors.expectedPaymentDate).toBe('2026-02-28');
  });
});
