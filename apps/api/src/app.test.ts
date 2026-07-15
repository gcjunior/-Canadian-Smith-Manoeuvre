import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseApiEnv } from '@csm/contracts';
import { CORRELATION_ID_HEADER, createLogger } from '@csm/observability';

import { buildApiApp } from './app.js';
import { JwtService } from './auth/jwt.js';
import { verifyHmacSha256 } from './plugins/raw-body.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function mockTemporal() {
  return {
    connection: { close: async () => undefined },
    workflowService: { getSystemInfo: async () => ({}) },
    workflow: {
      start: async () => ({ firstExecutionRunId: 'run-1' }),
      getHandle: () => ({
        signal: async () => undefined,
        describe: async () => ({ status: { name: 'RUNNING' } }),
      }),
    },
    schedule: {
      create: async () => ({ scheduleId: 'sched-1' }),
      getHandle: () => ({
        update: async () => undefined,
        pause: async () => undefined,
        unpause: async () => undefined,
        delete: async () => undefined,
        describe: async () => ({
          scheduleId: 'sched-1',
          state: { paused: false },
          spec: { timezone: 'America/Toronto' },
          policies: { overlap: 'SKIP', catchupWindow: '3 days' },
          info: { nextActionTimes: [] },
        }),
      }),
    },
  } as never;
}

function mockPrisma() {
  return {
    $queryRaw: async () => [{ ok: 1 }],
  } as never;
}

describe('JWT auth', () => {
  it('signs and verifies tenant context from token only', async () => {
    const jwt = new JwtService({ secret: 'local-dev-jwt-signing-secret', expiresSeconds: 60 });
    const { accessToken } = await jwt.sign({
      tenantId: TENANT,
      userId: USER,
      roles: ['CUSTOMER'],
    });
    const ctx = await jwt.verify(accessToken);
    expect(ctx).toEqual({ tenantId: TENANT, userId: USER, roles: ['CUSTOMER'] });
  });
});

describe('webhook signature', () => {
  it('verifies HMAC over raw body', () => {
    const raw = Buffer.from(JSON.stringify({ type: 'test', data: {} }));
    const secret = 'local-dev-webhook-secret';
    const sig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(verifyHmacSha256(raw, secret, sig)).toBe(true);
    expect(verifyHmacSha256(raw, secret, 'sha256=deadbeef')).toBe(false);
  });
});

describe('api app', () => {
  it('issues a dev token and rejects unauthorized strategy list', async () => {
    const env = parseApiEnv({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/csm',
      NODE_ENV: 'test',
    });
    const logger = createLogger({ service: 'api', level: 'error', pretty: false });
    const app = await buildApiApp({
      env,
      logger,
      prisma: mockPrisma(),
      temporal: mockTemporal(),
      bankClient: { health: async () => ({ status: 'ok', service: 'bank' }) } as never,
      brokerageClient: { health: async () => ({ status: 'ok', service: 'brokerage' }) } as never,
    });

    const unauthorized = await app.inject({ method: 'GET', url: '/strategies' });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error.code).toBe('UNAUTHORIZED');

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/auth/dev-token',
      payload: { tenantId: TENANT, userId: USER, roles: ['CUSTOMER'] },
      headers: { [CORRELATION_ID_HEADER]: '550e8400-e29b-41d4-a716-446655440000' },
    });
    expect(tokenRes.statusCode).toBe(201);
    expect(tokenRes.json().tokenType).toBe('Bearer');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const docs = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(docs.statusCode).toBe(200);
    expect(docs.json().paths['/strategies']).toBeDefined();
    expect(docs.json().paths['/auth/dev-token']).toBeDefined();

    await app.close();
  });
});
