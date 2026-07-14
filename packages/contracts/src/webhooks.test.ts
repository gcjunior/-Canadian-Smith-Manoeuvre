import { describe, expect, it } from 'vitest';

import { openApiExamples } from './openapi-examples.js';
import { providerWebhookSchema } from './webhooks.js';

describe('providerWebhookSchema', () => {
  it('accepts a well-formed webhook example', () => {
    expect(providerWebhookSchema.parse(openApiExamples.providerWebhook)).toMatchObject({
      provider: 'bank-sim',
      eventType: 'mortgage.payment.settled',
    });
  });

  it('rejects malformed webhooks and unknown properties', () => {
    expect(() =>
      providerWebhookSchema.parse({
        ...openApiExamples.providerWebhook,
        tenantId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toThrow();

    expect(() =>
      providerWebhookSchema.parse({
        provider: 'bank-sim',
        providerEventId: 'x',
        eventType: 'mortgage.payment.settled',
        occurredAt: 'not-a-date',
        externalAccountId: 'sim',
        payload: {},
        signature: 'sig',
      }),
    ).toThrow();

    expect(() =>
      providerWebhookSchema.parse({
        provider: 'unknown-bank',
        providerEventId: 'x',
        eventType: 'x',
        occurredAt: '2026-07-01T14:05:00.000Z',
        externalAccountId: 'sim',
        payload: {},
        signature: 'sig',
      }),
    ).toThrow();
  });
});
