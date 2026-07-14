import { describe, expect, it } from 'vitest';

import { createCorrelationId, normalizeCorrelationId } from './correlation.js';

describe('correlation', () => {
  it('creates uuid correlation ids', () => {
    expect(createCorrelationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('normalizes invalid ids', () => {
    const valid = '550e8400-e29b-41d4-a716-446655440000';
    expect(normalizeCorrelationId(valid)).toBe(valid);
    expect(normalizeCorrelationId('nope')).not.toBe('nope');
  });
});
