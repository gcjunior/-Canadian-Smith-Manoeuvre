import { describe, expect, it } from 'vitest';

import { SimulatorClock } from './clock.js';

describe('SimulatorClock', () => {
  it('advances deterministically', () => {
    const clock = new SimulatorClock(new Date('2026-01-15T12:00:00.000Z'));
    expect(clock.toISOString()).toBe('2026-01-15T12:00:00.000Z');
    clock.advance(5_000);
    expect(clock.nowMs()).toBe(Date.parse('2026-01-15T12:00:05.000Z'));
  });

  it('rejects rewind', () => {
    const clock = new SimulatorClock(new Date('2026-01-15T12:00:00.000Z'));
    expect(() => clock.advance(-1)).toThrow(/rewind/);
  });
});
