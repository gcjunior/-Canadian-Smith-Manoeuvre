/**
 * Catalogue of change classes that break Temporal replay when applied ungated.
 * Pure data — safe to import from Node tests (no Workflow runtime).
 */

export const REPLAY_BREAKING_CHANGE_CLASSES = [
  {
    id: 'add_or_remove_activity_call',
    summary: 'Adding or removing an Activity invocation on an existing path',
    why: 'History expects ScheduleActivityTask / ActivityTaskCompleted pairs in order',
  },
  {
    id: 'change_timer_ordering',
    summary: 'Changing Timer durations or the order timers are started/awaited',
    why: 'TimerStarted / TimerFired event sequence must match replay',
  },
  {
    id: 'change_conditional_command_paths',
    summary: 'Changing if/else so a previously-taken branch now takes another Temporal command',
    why: 'Different commands are scheduled than those recorded in history',
  },
  {
    id: 'reorder_awaited_temporal_operations',
    summary: 'Reordering awaited Activities, Timers, Conditions, or child Workflows',
    why: 'Command sequence and awakenings no longer align with history',
  },
] as const;

/** Non-breaking (usually) when done carefully — still verify with replay fixtures. */
export const REPLAY_SAFE_CHANGE_CLASSES = [
  {
    id: 'activity_implementation_only',
    summary: 'Changing Activity worker code without changing Workflow call sites',
  },
  {
    id: 'query_handler_additive',
    summary: 'Adding a Query handler that produces no Workflow commands',
  },
  {
    id: 'log_or_metric_in_activity',
    summary: 'Logging/metrics inside Activities (not Workflow)',
  },
  {
    id: 'new_workflow_type_or_new_period_ids_only',
    summary: 'New finite Workflow Ids from Schedules (old histories untouched)',
  },
] as const;
