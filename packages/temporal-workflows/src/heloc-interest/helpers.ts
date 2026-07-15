import { ApplicationFailure } from '@temporalio/common';
import { condition, sleep } from '@temporalio/workflow';

import { POLL_INTERVAL } from './constants.js';
import type { WaitReason } from './types.js';

export function activityFailureType(err: unknown): string | undefined {
  const maybe = err as { cause?: unknown; type?: string; name?: string };
  if (maybe?.cause && typeof maybe.cause === 'object' && maybe.cause !== null) {
    const cause = maybe.cause as { type?: string };
    if (typeof cause.type === 'string') {
      return cause.type;
    }
  }
  if (typeof maybe?.type === 'string') {
    return maybe.type;
  }
  return undefined;
}

export function isNotFound(err: unknown): boolean {
  return activityFailureType(err) === 'NOT_FOUND';
}

export function isReconciliationFailed(err: unknown): boolean {
  return activityFailureType(err) === 'RECONCILIATION_FAILED';
}

/** Parse Temporal duration strings used by this Workflow (hours/days). */
export function durationToMs(duration: string): number {
  const match = /^(\d+)\s+(hour|hours|day|days)$/.exec(duration.trim());
  if (!match) {
    throw ApplicationFailure.nonRetryable(
      `Unsupported duration: ${duration}`,
      'VALIDATION_FAILURE',
    );
  }
  const n = Number(match[1]);
  const unit = match[2]!;
  if (unit.startsWith('day')) {
    return n * 24 * 60 * 60 * 1000;
  }
  return n * 60 * 60 * 1000;
}

export function remainingMs(deadlineMs: number, nowMs: number): number {
  return Math.max(0, deadlineMs - nowMs);
}

/**
 * Wait for a signal flag OR the six-hour poll interval, bounded by a deadline.
 * Uses Temporal `condition` (not Promise.race). Caller must reset signal flags
 * after consuming a relevant Signal — this helper clears via `clearConsumedSignals`.
 */
export async function waitForSignalOrPollInterval(input: {
  shouldWake: () => boolean;
  clearConsumedSignals: () => void;
  setWaitReason: (reason: WaitReason) => void;
  waitReason: Exclude<WaitReason, null>;
  deadlineMs: number;
  /** Temporal-deterministic clock (Date.now in Workflow isolate). */
  nowMs: () => number;
}): Promise<'signal' | 'timer' | 'deadline'> {
  const remaining = remainingMs(input.deadlineMs, input.nowMs());
  if (remaining <= 0) {
    return 'deadline';
  }

  input.setWaitReason(input.waitReason);
  const woke = await condition(input.shouldWake, Math.min(durationToMs(POLL_INTERVAL), remaining));
  input.setWaitReason(null);

  if (input.shouldWake()) {
    input.clearConsumedSignals();
    return 'signal';
  }
  if (remainingMs(input.deadlineMs, input.nowMs()) <= 0) {
    return 'deadline';
  }
  if (!woke) {
    return 'timer';
  }
  input.clearConsumedSignals();
  return 'signal';
}

export async function boundedSleep(
  deadlineMs: number,
  nowMs: () => number,
): Promise<'timer' | 'deadline'> {
  const remaining = remainingMs(deadlineMs, nowMs());
  if (remaining <= 0) {
    return 'deadline';
  }
  await sleep(Math.min(durationToMs(POLL_INTERVAL), remaining));
  return remainingMs(deadlineMs, nowMs()) <= 0 ? 'deadline' : 'timer';
}

export function idempotencyKey(
  tenantId: string,
  strategyId: string,
  interestPeriod: string,
  operation: string,
): string {
  return `hi:${tenantId}:${strategyId}:${interestPeriod}:${operation}`;
}

/** Map Activity failure types onto pause codes when present. */
export function pauseCodeFromActivityFailure(err: unknown, fallback: string): string {
  return activityFailureType(err) ?? fallback;
}
