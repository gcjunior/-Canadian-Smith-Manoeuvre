export interface Clock {
  now(): Date;
  nowMs(): number;
  advance(ms: number): void;
  set(isoOrDate: string | Date): void;
  toISOString(): string;
}

/** Deterministic test clock. Advance via /sim/admin/brokerage/run-events. */
export class SimulatorClock implements Clock {
  private currentMs: number;

  constructor(start: Date = new Date()) {
    this.currentMs = start.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  nowMs(): number {
    return this.currentMs;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new Error('Cannot rewind clock');
    }
    this.currentMs += ms;
  }

  set(isoOrDate: string | Date): void {
    const ms = typeof isoOrDate === 'string' ? Date.parse(isoOrDate) : isoOrDate.getTime();
    if (Number.isNaN(ms)) {
      throw new Error('Invalid date');
    }
    this.currentMs = ms;
  }

  toISOString(): string {
    return this.now().toISOString();
  }
}
