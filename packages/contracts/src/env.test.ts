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

it('refuses default JWT secrets in production', () => {
  expect(() =>
    parseApiEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://smith:smith@localhost:5432/smith_manoeuvre',
      SERVICE_NAME: 'api',
    }),
  ).toThrow(/JWT_SIGNING_SECRET|WEBHOOK_SIGNING_SECRET/);
});

it('accepts strong secrets in production', () => {
  const env = parseApiEnv({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://smith:smith@localhost:5432/smith_manoeuvre',
    SERVICE_NAME: 'api',
    JWT_SIGNING_SECRET: 'production-jwt-signing-secret-32chars-min!!',
    WEBHOOK_SIGNING_SECRET: 'production-webhook-secret-32chars-min!!',
  });
  expect(env.NODE_ENV).toBe('production');
});
