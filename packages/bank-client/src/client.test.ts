import { describe, expect, it } from 'vitest';

import { createLogger } from '@csm/observability';

import { BankClient } from './client.js';
import { ProviderClientError } from './errors.js';
import { FakeBankClient } from './fake.js';
import { IDEMPOTENCY_KEY_HEADER } from './http.js';
import {
  providerHelocAvailabilitySchema,
  providerHelocDrawSchema,
  providerTransferSchema,
} from './schemas.js';

const CORRELATION = '550e8400-e29b-41d4-a716-446655440000';
const HELOC = '11111111-1111-4111-8111-111111111111';

function logger() {
  return createLogger({ service: 'bank-client-test', level: 'error', pretty: false });
}

function drawBody(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    helocId: HELOC,
    amountCents: '10000',
    idempotencyKey: 'draw-key-1',
    state: 'PENDING',
    providerTransactionId: 'draw_abc',
    requestedAt: '2026-01-01T00:00:00.000Z',
    settledAt: null,
    failureCode: null,
    ...overrides,
  };
}

describe('provider contract schemas', () => {
  it('accepts bank simulator wire shapes', () => {
    expect(providerHelocDrawSchema.parse(drawBody()).amountCents).toBe(10_000n);
    expect(
      providerHelocAvailabilitySchema.parse({
        helocId: HELOC,
        availableCreditCents: '1100000',
        existingAvailableCreditCents: '1000000',
        newlyAvailableCreditCents: '100000',
        creditLimitCents: '20000000',
        balanceOwedCents: '0',
        observedAt: '2026-01-01T00:00:00.000Z',
        stale: false,
      }).newlyAvailableCreditCents,
    ).toBe(100_000n);
    expect(
      providerTransferSchema.parse({
        id: '33333333-3333-4333-8333-333333333333',
        sourceAccountId: '44444444-4444-4444-8444-444444444444',
        destinationAccountId: '55555555-5555-4555-8555-555555555555',
        amountCents: '5000',
        idempotencyKey: 'xfer-1',
        state: 'PENDING',
        providerTransactionId: 'xfer_1',
        requestedAt: '2026-01-01T00:00:00.000Z',
        settledAt: null,
        failureCode: null,
      }).amountCents,
    ).toBe(5_000n);
  });
});

describe('BankClient HTTP', () => {
  it('sets correlation and idempotency headers on financial POST', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push(init !== undefined ? { url: String(url), init } : { url: String(url) });
      return new Response(JSON.stringify(drawBody()), { status: 202 });
    };
    const client = new BankClient({
      baseUrl: 'http://bank.test',
      logger: logger(),
      fetchImpl,
    });
    await client.initiateHelocDraw({
      helocId: HELOC,
      amountCents: 10_000n,
      idempotencyKey: 'draw-key-1',
      correlationId: CORRELATION,
    });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('x-correlation-id')).toBe(CORRELATION);
    expect(headers.get(IDEMPOTENCY_KEY_HEADER)).toBe('draw-key-1');
  });

  it('maps 409 to DUPLICATE_CONFLICT and 422 to BUSINESS_REJECTION', async () => {
    const client409 = new BankClient({
      baseUrl: 'http://bank.test',
      logger: logger(),
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: 'Idempotency key reused' }), { status: 409 }),
    });
    await expect(
      client409.initiateHelocDraw({
        helocId: HELOC,
        amountCents: 1n,
        idempotencyKey: 'k',
        correlationId: CORRELATION,
      }),
    ).rejects.toMatchObject({ kind: 'DUPLICATE_CONFLICT', statusCode: 409 });

    const client422 = new BankClient({
      baseUrl: 'http://bank.test',
      logger: logger(),
      fetchImpl: async () =>
        new Response(
          JSON.stringify(
            drawBody({ state: 'FAILED', failureCode: 'INSUFFICIENT_HELOC_CREDIT' }),
          ),
          { status: 422 },
        ),
    });
    // 422 with draw body is !ok — classified as business rejection
    await expect(
      client422.initiateHelocDraw({
        helocId: HELOC,
        amountCents: 1n,
        idempotencyKey: 'k2',
        correlationId: CORRELATION,
      }),
    ).rejects.toMatchObject({ kind: 'BUSINESS_REJECTION', statusCode: 422 });
  });

  it('treats POST timeout as AMBIGUOUS_RESULT and does not retry POST', async () => {
    let postCount = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      if (init?.method === 'POST') {
        postCount += 1;
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return new Response('{}', { status: 500 });
    };
    const client = new BankClient({
      baseUrl: 'http://bank.test',
      logger: logger(),
      fetchImpl,
      maxGetAttempts: 3,
    });
    await expect(
      client.initiateHelocDraw({
        helocId: HELOC,
        amountCents: 10_000n,
        idempotencyKey: 'amb-1',
        correlationId: CORRELATION,
      }),
    ).rejects.toMatchObject({
      kind: 'AMBIGUOUS_RESULT',
      idempotencyKey: 'amb-1',
    });
    expect(postCount).toBe(1);
  });

  it('treats 504 processed:true as AMBIGUOUS_RESULT', async () => {
    const client = new BankClient({
      baseUrl: 'http://bank.test',
      logger: logger(),
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: 'Gateway timeout', processed: true, drawId: 'x' }), {
          status: 504,
        }),
    });
    await expect(
      client.initiateHelocDraw({
        helocId: HELOC,
        amountCents: 10_000n,
        idempotencyKey: 'after-ok',
        correlationId: CORRELATION,
      }),
    ).rejects.toMatchObject({ kind: 'AMBIGUOUS_RESULT', idempotencyKey: 'after-ok' });
  });

  it('retries safe GETs on transient failure', async () => {
    let attempts = 0;
    const fetchImpl: typeof fetch = async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response('{}', { status: 503 });
      }
      return new Response(
        JSON.stringify({
          helocId: HELOC,
          availableCreditCents: '100',
          existingAvailableCreditCents: '100',
          newlyAvailableCreditCents: '0',
          creditLimitCents: '200',
          balanceOwedCents: '0',
          observedAt: '2026-01-01T00:00:00.000Z',
          stale: false,
        }),
        { status: 200 },
      );
    };
    const client = new BankClient({
      baseUrl: 'http://bank.test',
      logger: logger(),
      fetchImpl,
      getRetryBaseDelayMs: 1,
    });
    const avail = await client.getHelocAvailability(HELOC, CORRELATION);
    expect(avail.availableCreditCents).toBe(100n);
    expect(attempts).toBe(3);
  });

  it('resolves ambiguous draw via idempotency lookup without re-POST', async () => {
    let posts = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      if (init?.method === 'POST') {
        posts += 1;
        const err = new Error('RESPONSE_TIMEOUT');
        err.name = 'TimeoutError';
        throw err;
      }
      return new Response(JSON.stringify(drawBody({ idempotencyKey: 'resolve-me' })), {
        status: 200,
      });
    };
    const client = new BankClient({
      baseUrl: 'http://bank.test',
      logger: logger(),
      fetchImpl,
    });
    await expect(
      client.initiateHelocDraw({
        helocId: HELOC,
        amountCents: 10_000n,
        idempotencyKey: 'resolve-me',
        correlationId: CORRELATION,
      }),
    ).rejects.toBeInstanceOf(ProviderClientError);

    const resolved = await client.resolveAmbiguousHelocDraw({
      helocId: HELOC,
      idempotencyKey: 'resolve-me',
      correlationId: CORRELATION,
    });
    expect(resolved.idempotencyKey).toBe('resolve-me');
    expect(posts).toBe(1);
  });

  it('validates provider responses with Zod', async () => {
    const client = new BankClient({
      baseUrl: 'http://bank.test',
      logger: logger(),
      fetchImpl: async () => new Response(JSON.stringify({ broken: true }), { status: 200 }),
    });
    await expect(client.getHelocAvailability(HELOC, CORRELATION)).rejects.toMatchObject({
      kind: 'VALIDATION_FAILURE',
    });
  });
});

describe('FakeBankClient', () => {
  it('supports idempotent draws and conflict on payload mismatch', async () => {
    const fake = new FakeBankClient();
    const first = await fake.initiateHelocDraw({
      helocId: HELOC,
      amountCents: 100n,
      idempotencyKey: 'same',
      correlationId: CORRELATION,
    });
    const second = await fake.initiateHelocDraw({
      helocId: HELOC,
      amountCents: 100n,
      idempotencyKey: 'same',
      correlationId: CORRELATION,
    });
    expect(second.id).toBe(first.id);
    await expect(
      fake.initiateHelocDraw({
        helocId: HELOC,
        amountCents: 200n,
        idempotencyKey: 'same',
        correlationId: CORRELATION,
      }),
    ).rejects.toMatchObject({ kind: 'DUPLICATE_CONFLICT' });
  });

  it('resolveAmbiguousHelocDraw returns stored draw', async () => {
    const fake = new FakeBankClient();
    const seeded = await fake.initiateHelocDraw({
      helocId: HELOC,
      amountCents: 50n,
      idempotencyKey: 'k',
      correlationId: CORRELATION,
    });
    const resolved = await fake.resolveAmbiguousHelocDraw({
      helocId: HELOC,
      idempotencyKey: 'k',
      correlationId: CORRELATION,
    });
    expect(resolved.id).toBe(seeded.id);
  });
});

describe('redacted logs', () => {
  it('redacts sensitive fields in structured log payloads', async () => {
    const { redactObject } = await import('@csm/observability');
    const redacted = redactObject({
      password: 'secret',
      authorization: 'Bearer tok',
      amountCents: '10000',
      correlationId: CORRELATION,
    });
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted.amountCents).toBe('10000');
  });
});
