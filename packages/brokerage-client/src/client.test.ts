import { describe, expect, it } from 'vitest';

import { createLogger } from '@csm/observability';

import { BrokerageClient } from './client.js';
import { classifyHttpStatus, ProviderClientError } from './errors.js';
import { FakeBrokerageClient } from './fake.js';
import { IDEMPOTENCY_KEY_HEADER } from './http.js';
import { providerDepositSchema, providerOrderSchema } from './schemas.js';

const CORRELATION = '550e8400-e29b-41d4-a716-446655440000';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function logger() {
  return createLogger({ service: 'brokerage-client-test', level: 'error', pretty: false });
}

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    accountId: ACCOUNT,
    symbol: 'XEQT',
    side: 'BUY',
    notionalCents: '150000',
    quantity: '5',
    filledQuantity: '0',
    limitPrice: null,
    averageFillPrice: null,
    idempotencyKey: 'order-1',
    state: 'CREATED',
    providerOrderId: 'ord_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    submittedAt: null,
    filledAt: null,
    failureCode: null,
    commissionCents: '0',
    ...overrides,
  };
}

describe('error mapping', () => {
  it('classifies auth and rate limit', () => {
    expect(classifyHttpStatus(401)).toBe('AUTHENTICATION_FAILURE');
    expect(classifyHttpStatus(429)).toBe('RATE_LIMITED');
  });
});

describe('provider contract schemas', () => {
  it('accepts brokerage simulator wire shapes', () => {
    expect(providerOrderSchema.parse(orderBody()).notionalCents).toBe(150_000n);
    expect(
      providerDepositSchema.parse({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        accountId: ACCOUNT,
        amountCents: '500000',
        idempotencyKey: 'dep-1',
        state: 'PENDING',
        providerDepositId: 'dep_1',
        requestedAt: '2026-01-01T00:00:00.000Z',
        settledAt: null,
        failureCode: null,
      }).amountCents,
    ).toBe(500_000n);
  });
});

describe('BrokerageClient', () => {
  it('sets correlation and idempotency on submitOrder', async () => {
    let headers: Headers | undefined;
    const client = new BrokerageClient({
      baseUrl: 'http://brokerage.test',
      logger: logger(),
      fetchImpl: async (_url, init) => {
        headers = new Headers(init?.headers);
        return new Response(JSON.stringify(orderBody()), { status: 202 });
      },
    });
    await client.submitOrder({
      accountId: ACCOUNT,
      symbol: 'XEQT',
      side: 'BUY',
      notionalCents: 150_000n,
      idempotencyKey: 'order-1',
      correlationId: CORRELATION,
    });
    expect(headers?.get('x-correlation-id')).toBe(CORRELATION);
    expect(headers?.get(IDEMPOTENCY_KEY_HEADER)).toBe('order-1');
  });

  it('does not retry financial POST on timeout; resolves via idempotency GET', async () => {
    let posts = 0;
    const client = new BrokerageClient({
      baseUrl: 'http://brokerage.test',
      logger: logger(),
      fetchImpl: async (_url, init) => {
        if (init?.method === 'POST') {
          posts += 1;
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        }
        return new Response(JSON.stringify(orderBody({ idempotencyKey: 'amb-order' })), {
          status: 200,
        });
      },
    });
    await expect(
      client.submitOrder({
        accountId: ACCOUNT,
        symbol: 'XEQT',
        side: 'BUY',
        notionalCents: 150_000n,
        idempotencyKey: 'amb-order',
        correlationId: CORRELATION,
      }),
    ).rejects.toMatchObject({ kind: 'AMBIGUOUS_RESULT' });
    expect(posts).toBe(1);

    const resolved = await client.resolveAmbiguousOrder({
      idempotencyKey: 'amb-order',
      correlationId: CORRELATION,
    });
    expect(resolved.idempotencyKey).toBe('amb-order');
  });

  it('maps 504 processed:true after order submit to AMBIGUOUS_RESULT', async () => {
    const client = new BrokerageClient({
      baseUrl: 'http://brokerage.test',
      logger: logger(),
      fetchImpl: async () =>
        new Response(JSON.stringify({ processed: true, orderId: 'x' }), { status: 504 }),
    });
    await expect(
      client.submitOrder({
        accountId: ACCOUNT,
        symbol: 'XEQT',
        side: 'BUY',
        notionalCents: 1n,
        idempotencyKey: 't',
        correlationId: CORRELATION,
      }),
    ).rejects.toMatchObject({ kind: 'AMBIGUOUS_RESULT', idempotencyKey: 't' });
  });
});

describe('FakeBrokerageClient', () => {
  it('idempotent submitOrder and conflict', async () => {
    const fake = new FakeBrokerageClient();
    const a = await fake.submitOrder({
      accountId: ACCOUNT,
      symbol: 'XEQT',
      side: 'BUY',
      notionalCents: 100n,
      idempotencyKey: 'o1',
      correlationId: CORRELATION,
    });
    const b = await fake.submitOrder({
      accountId: ACCOUNT,
      symbol: 'XEQT',
      side: 'BUY',
      notionalCents: 100n,
      idempotencyKey: 'o1',
      correlationId: CORRELATION,
    });
    expect(b.id).toBe(a.id);
    await expect(
      fake.submitOrder({
        accountId: ACCOUNT,
        symbol: 'XEQT',
        side: 'BUY',
        notionalCents: 200n,
        idempotencyKey: 'o1',
        correlationId: CORRELATION,
      }),
    ).rejects.toBeInstanceOf(ProviderClientError);
  });
});
