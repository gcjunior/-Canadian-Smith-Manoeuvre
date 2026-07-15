import { heartbeat } from '@temporalio/activity';

/** Heartbeat when running inside Temporal; no-op outside (unit tests). */
export function activityHeartbeat(details?: unknown): void {
  try {
    heartbeat(details);
  } catch {
    // Context.current() unavailable outside an Activity.
  }
}
