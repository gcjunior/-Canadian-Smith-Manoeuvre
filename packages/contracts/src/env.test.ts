import { describe, expect, it } from 'vitest';

import { parseApiEnv, parseWorkerEnv } from './env.js';

describe('env contracts', () => {
  it('parses api env with required database url', () => {
    const env = parseApiEnv({
      DATABASE_URL: 'postgresql://smith:smith@localhost:5432/smith_manoeuvre',
      SERVICE_NAME: 'api',
    });
    expect(env.PORT).toBe(3001);
    expect(env.TEMPORAL_TASK_QUEUE).toBe('smith-manoeuvre');
  });

  it('parses worker env', () => {
    const env = parseWorkerEnv({
      DATABASE_URL: 'postgresql://smith:smith@localhost:5432/smith_manoeuvre',
      SERVICE_NAME: 'worker',
      LOG_LEVEL: 'debug',
    });
    expect(env.LOG_LEVEL).toBe('debug');
  });
});
