import { describe, expect, it } from 'vitest';

import { parseSimulatorEnv } from '@csm/contracts';
import { CORRELATION_ID_HEADER, createLogger } from '@csm/observability';

import { buildSimulatorApp } from './app.js';
import { SimulatorClock } from './clock.js';

async function createApp() {
  const env = parseSimulatorEnv({}, { serviceName: 'bank-simulator', port: 3002 });
  const logger = createLogger({ service: 'bank-simulator', level: 'error', pretty: false });
  const clock = new SimulatorClock(new Date('2026-04-01T00:00:00.000Z'));
  return buildSimulatorApp({ env, logger, clock });
}

describe('bank-simulator health', () => {
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
      service: 'bank-simulator',
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
    });
    await app.close();
  });

  it('exposes OpenAPI docs', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { info: { title: string }; paths: Record<string, unknown> };
    expect(body.info.title).toBe('CSM Bank Simulator');
    expect(body.paths['/bank/helocs/{helocId}/draws']).toBeDefined();
    expect(body.paths['/sim/admin/scenarios']).toBeDefined();
    await app.close();
  });
});

describe('bank-simulator HTTP integration', () => {
  it('runs mortgage → readvance → draw via admin + bank APIs', async () => {
    const app = await createApp();

    await app.inject({
      method: 'POST',
      url: '/sim/admin/scenarios',
      payload: { fixtureId: 'happy-path' },
    });

    const userRes = await app.inject({
      method: 'POST',
      url: '/sim/admin/users',
      payload: { externalUserId: 'ext-1', displayName: 'Alex' },
    });
    const userId = userRes.json().id as string;

    const mortgageRes = await app.inject({
      method: 'POST',
      url: '/sim/admin/accounts',
      payload: {
        userId,
        kind: 'MORTGAGE',
        displayAlias: 'mtg',
        providerAccountId: 'p-mtg',
      },
    });
    const mortgageId = mortgageRes.json().mortgage.id as string;

    const helocRes = await app.inject({
      method: 'POST',
      url: '/sim/admin/accounts',
      payload: {
        userId,
        kind: 'HELOC',
        displayAlias: 'heloc',
        providerAccountId: 'p-heloc',
      },
    });
    const helocId = helocRes.json().heloc.id as string;

    await app.inject({
      method: 'POST',
      url: '/sim/admin/accounts',
      payload: {
        userId,
        kind: 'ORDINARY',
        displayAlias: 'cheq',
        providerAccountId: 'p-ord',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/sim/admin/mortgage-payments',
      payload: {
        mortgageId,
        paymentPeriod: '2026-04',
        totalAmountCents: '250000',
        principalAmountCents: '100000',
        interestAmountCents: '150000',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/sim/admin/run-events',
      payload: { advanceMs: 6_000 },
    });

    const availability = await app.inject({
      method: 'GET',
      url: `/bank/helocs/${helocId}/availability`,
    });
    expect(availability.statusCode).toBe(200);
    expect(availability.json()).toMatchObject({
      newlyAvailableCreditCents: '100000',
      existingAvailableCreditCents: '1000000',
    });

    const drawRes = await app.inject({
      method: 'POST',
      url: `/bank/helocs/${helocId}/draws`,
      payload: { amountCents: '100000', idempotencyKey: 'k1' },
    });
    expect(drawRes.statusCode).toBe(202);
    const drawId = drawRes.json().id as string;

    const replay = await app.inject({
      method: 'POST',
      url: `/bank/helocs/${helocId}/draws`,
      payload: { amountCents: '100000', idempotencyKey: 'k1' },
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json().id).toBe(drawId);

    const conflict = await app.inject({
      method: 'POST',
      url: `/bank/helocs/${helocId}/draws`,
      payload: { amountCents: '999', idempotencyKey: 'k1' },
    });
    expect(conflict.statusCode).toBe(409);

    const byKey = await app.inject({
      method: 'GET',
      url: `/bank/helocs/${helocId}/draws/by-idempotency-key/k1`,
    });
    expect(byKey.statusCode).toBe(200);
    expect(byKey.json().id).toBe(drawId);

    await app.inject({
      method: 'POST',
      url: '/sim/admin/run-events',
      payload: { advanceMs: 1_000 },
    });

    const settled = await app.inject({
      method: 'GET',
      url: `/bank/helocs/${helocId}/draws/${drawId}`,
    });
    expect(settled.json().state).toBe('SETTLED');

    await app.close();
  });

  it('returns 422 when HELOC credit is insufficient', async () => {
    const app = await createApp();
    await app.inject({
      method: 'POST',
      url: '/sim/admin/scenarios',
      payload: { fixtureId: 'insufficient-heloc' },
    });
    const userId = (
      await app.inject({
        method: 'POST',
        url: '/sim/admin/users',
        payload: { externalUserId: 'ext-2', displayName: 'Blair' },
      })
    ).json().id as string;

    const helocId = (
      await app.inject({
        method: 'POST',
        url: '/sim/admin/accounts',
        payload: {
          userId,
          kind: 'HELOC',
          displayAlias: 'heloc',
          providerAccountId: 'p-heloc',
        },
      })
    ).json().heloc.id as string;

    const drawRes = await app.inject({
      method: 'POST',
      url: `/bank/helocs/${helocId}/draws`,
      payload: { amountCents: '100', idempotencyKey: 'nsf-draw' },
    });
    expect(drawRes.statusCode).toBe(422);
    expect(drawRes.json().failureCode).toBe('INSUFFICIENT_HELOC_CREDIT');
    await app.close();
  });
});
