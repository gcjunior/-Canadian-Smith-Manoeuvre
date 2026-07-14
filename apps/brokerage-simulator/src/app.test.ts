import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseSimulatorEnv } from '@csm/contracts';
import { CORRELATION_ID_HEADER, createLogger } from '@csm/observability';

import { buildSimulatorApp } from './app.js';
import { SimulatorClock } from './clock.js';

async function createApp() {
  const env = parseSimulatorEnv({}, { serviceName: 'brokerage-simulator', port: 3003 });
  const logger = createLogger({ service: 'brokerage-simulator', level: 'error', pretty: false });
  const clock = new SimulatorClock(new Date('2026-06-01T00:00:00.000Z'));
  return buildSimulatorApp({ env, logger, clock });
}

describe('brokerage-simulator health', () => {
  it('returns ok', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { [CORRELATION_ID_HEADER]: '550e8400-e29b-41d4-a716-446655440000' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'brokerage-simulator',
      simulator: 'brokerage',
    });
    await app.close();
  });

  it('exposes OpenAPI docs', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { info: { title: string }; paths: Record<string, unknown> };
    expect(body.info.title).toBe('CSM Brokerage Simulator');
    expect(body.paths['/brokerage/orders']).toBeDefined();
    expect(body.paths['/sim/admin/brokerage/scenarios']).toBeDefined();
    await app.close();
  });
});

describe('brokerage-simulator HTTP integration', () => {
  it('deposit → order → fill via admin + brokerage APIs', async () => {
    const app = await createApp();

    await app.inject({
      method: 'POST',
      url: '/sim/admin/brokerage/scenarios',
      payload: { fixtureId: 'happy-path' },
    });

    const accountRes = await app.inject({
      method: 'POST',
      url: '/sim/admin/brokerage/accounts',
      payload: {
        externalAccountId: 'ext-http-1',
        displayName: 'Alex Non-Reg',
      },
    });
    expect(accountRes.statusCode).toBe(201);
    const accountId = accountRes.json().id as string;
    expect(accountRes.json().registrationType).toBe('NON_REGISTERED');
    expect(accountRes.json().currencyCode).toBe('CAD');

    const depKey = randomUUID();
    const depositRes = await app.inject({
      method: 'POST',
      url: '/brokerage/deposits',
      payload: {
        accountId,
        amountCents: '500000',
        idempotencyKey: depKey,
      },
    });
    expect(depositRes.statusCode).toBe(202);
    const depositId = depositRes.json().id as string;

    const replay = await app.inject({
      method: 'POST',
      url: '/brokerage/deposits',
      payload: {
        accountId,
        amountCents: '500000',
        idempotencyKey: depKey,
      },
    });
    expect(replay.json().id).toBe(depositId);

    await app.inject({
      method: 'POST',
      url: '/sim/admin/brokerage/run-events',
      payload: { advanceMs: 1_000 },
    });

    const cash = await app.inject({
      method: 'GET',
      url: `/brokerage/accounts/${accountId}/cash`,
    });
    expect(cash.json().settledCashCents).toBe('500000');

    const orderKey = randomUUID();
    const orderRes = await app.inject({
      method: 'POST',
      url: '/brokerage/orders',
      payload: {
        accountId,
        symbol: 'XEQT',
        side: 'BUY',
        notionalCents: '150000',
        idempotencyKey: orderKey,
      },
    });
    expect(orderRes.statusCode).toBe(202);
    const orderId = orderRes.json().id as string;

    const conflict = await app.inject({
      method: 'POST',
      url: '/brokerage/orders',
      payload: {
        accountId,
        symbol: 'XEQT',
        side: 'BUY',
        notionalCents: '150001',
        idempotencyKey: orderKey,
      },
    });
    expect(conflict.statusCode).toBe(409);

    await app.inject({
      method: 'POST',
      url: '/sim/admin/brokerage/run-events',
      payload: { advanceMs: 1_500 },
    });

    const order = await app.inject({
      method: 'GET',
      url: `/brokerage/orders/${orderId}`,
    });
    expect(order.json().state).toBe('FILLED');

    const byKey = await app.inject({
      method: 'GET',
      url: `/brokerage/orders/by-idempotency-key/${orderKey}`,
    });
    expect(byKey.json().id).toBe(orderId);

    const positions = await app.inject({
      method: 'GET',
      url: `/brokerage/accounts/${accountId}/positions`,
    });
    expect(positions.json().positions.length).toBe(1);

    await app.close();
  });

  it('rejects orders when account is restricted', async () => {
    const app = await createApp();
    await app.inject({
      method: 'POST',
      url: '/sim/admin/brokerage/scenarios',
      payload: { fixtureId: 'account-restricted' },
    });
    const accountId = (
      await app.inject({
        method: 'POST',
        url: '/sim/admin/brokerage/accounts',
        payload: { externalAccountId: 'r1', displayName: 'Restricted' },
      })
    ).json().id as string;

    const orderRes = await app.inject({
      method: 'POST',
      url: '/brokerage/orders',
      payload: {
        accountId,
        symbol: 'XEQT',
        side: 'BUY',
        notionalCents: '10000',
        idempotencyKey: randomUUID(),
      },
    });
    expect(orderRes.statusCode).toBe(422);
    expect(orderRes.json().failureCode).toBe('ACCOUNT_RESTRICTED');
    await app.close();
  });
});
