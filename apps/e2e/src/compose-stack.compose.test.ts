import { describe, expect, it } from 'vitest';

const BANK_URL = process.env.E2E_BANK_URL ?? 'http://127.0.0.1:3002';
const BROKER_URL = process.env.E2E_BROKER_URL ?? 'http://127.0.0.1:3003';
const TEMPORAL_ADDRESS = process.env.E2E_TEMPORAL_ADDRESS ?? '127.0.0.1:7234';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://smith:smith@127.0.0.1:5433/smith_manoeuvre_test?schema=public';

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

describe('compose failure e2e (gated)', () => {
  it('exercises bank draw rejection against a live simulator when available', async () => {
    const up = await probe(`${BANK_URL}/health`);
    if (!up) {
      // Intentionally skip — compose stack not running. Covered by bank-simulator failure-pack unit tests.
      expect(up).toBe(false);
      return;
    }

    const scenarioRes = await fetch(`${BANK_URL}/sim/admin/scenarios`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarioId: 'e2e-draw-reject',
        mode: 'deterministic',
        deterministicFailureSteps: ['DRAW_REJECTED'],
        initialBalances: {
          mortgagePrincipalCents: '45000000',
          helocCreditLimitCents: '20000000',
          helocBalanceOwedCents: '0',
          helocExistingAvailableCreditCents: '10000000',
          ordinaryBankBalanceCents: '500000',
        },
      }),
    });
    expect(scenarioRes.ok).toBe(true);

    const userRes = await fetch(`${BANK_URL}/sim/admin/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ externalUserId: `e2e-${Date.now()}`, displayName: 'E2E' }),
    });
    expect(userRes.ok).toBe(true);
    const user = (await userRes.json()) as { id: string };

    const helocRes = await fetch(`${BANK_URL}/sim/admin/accounts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: user.id,
        kind: 'HELOC',
        displayAlias: 'heloc',
        providerAccountId: `heloc-${Date.now()}`,
      }),
    });
    expect(helocRes.ok).toBe(true);
    const heloc = (await helocRes.json()) as { heloc: { id: string } };

    const drawRes = await fetch(`${BANK_URL}/v1/helocs/${heloc.heloc.id}/draws`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amountCents: '100000', idempotencyKey: `e2e-${Date.now()}` }),
    });
    expect(drawRes.status).toBe(422);
  });

  it('records compose endpoint configuration for deferred full-stack runs', () => {
    expect(DATABASE_URL).toContain('5433');
    expect(TEMPORAL_ADDRESS).toContain('7234');
    expect(BROKER_URL).toContain('3003');
  });
});
