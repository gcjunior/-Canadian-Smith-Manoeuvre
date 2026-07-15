import { describe, expect, it } from 'vitest';

import { redactObject } from './redact.js';

describe('redact sensitive values', () => {
  it('removes tokens, secrets, and authorization from log payloads', () => {
    const redacted = redactObject({
      tenantId: 't1',
      accessToken: 'super-secret-token',
      authorization: 'Bearer abc',
      jwtSigningSecret: 'local-dev-jwt-signing-secret',
      nested: { webhookSigningSecret: 'hook-secret', amountCents: '100' },
    });
    expect(redacted.accessToken).toBe('[REDACTED]');
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted.jwtSigningSecret).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).webhookSigningSecret).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).amountCents).toBe('100');
    expect(redacted.tenantId).toBe('t1');
  });
});
