import { ScheduleOverlapPolicy } from '@temporalio/client';
import { describe, expect, it } from 'vitest';

import {
  STRATEGY_SCHEDULE_CATCHUP_WINDOW,
  STRATEGY_SCHEDULE_OVERLAP,
} from './strategy-schedule-service.js';

describe('schedule double-trigger policy', () => {
  it('configures SKIP overlap so a second schedule fire does not start a twin workflow', () => {
    expect(STRATEGY_SCHEDULE_OVERLAP).toBe(ScheduleOverlapPolicy.SKIP);
    expect(STRATEGY_SCHEDULE_CATCHUP_WINDOW).toBeTruthy();
  });
});
