import { describe, expect, it } from 'vitest';

import { computeNextExpectedCheckAt, serializeCycle } from './serialize.js';

describe('serializeCycle', () => {
  it('serializes money fields as digit strings', () => {
    const now = new Date('2026-07-01T12:00:00.000Z');
    const serialized = serializeCycle({
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      strategyId: '33333333-3333-4333-8333-333333333333',
      paymentPeriod: '2026-07',
      state: 'COMPLETED',
      mortgagePaymentId: null,
      principalRepaidCents: 770_00n,
      newlyAvailableCreditCents: 770_00n,
      drawAmountCents: 770_00n,
      correlationId: '44444444-4444-4444-8444-444444444444',
      failureCode: null,
      failureMessage: null,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    expect(serialized.principalRepaidCents).toBe('77000');
    expect(serialized.drawAmountCents).toBe('77000');
  });
});

describe('computeNextExpectedCheckAt', () => {
  it('returns an ISO timestamp', () => {
    const iso = computeNextExpectedCheckAt(
      'America/Toronto',
      1,
      new Date('2026-07-15T15:00:00.000Z'),
    );
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
