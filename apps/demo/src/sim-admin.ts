/** Thin HTTP helpers for bank + brokerage simulator admin surfaces. */

export class SimHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'SimHttpError';
  }
}

async function requestJson<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, init);
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    throw new SimHttpError(res.status, `HTTP ${res.status} ${method} ${path}`, parsed);
  }
  return parsed as T;
}

export function createBankAdmin(baseUrl: string) {
  return {
    reset: () => requestJson(baseUrl, 'POST', '/sim/admin/reset'),
    loadScenario: (fixtureId: string) =>
      requestJson(baseUrl, 'POST', '/sim/admin/scenarios', { fixtureId }),
    createUser: (input: { externalUserId: string; displayName: string }) =>
      requestJson<{ id: string }>(baseUrl, 'POST', '/sim/admin/users', input),
    createAccount: (input: Record<string, unknown>) =>
      requestJson<{
        account: { id: string; kind: string };
        mortgage: { id: string } | null;
        heloc: { id: string } | null;
      }>(baseUrl, 'POST', '/sim/admin/accounts', input),
    scheduleMortgagePayment: (input: {
      mortgageId: string;
      paymentPeriod: string;
      totalAmountCents: string;
      principalAmountCents: string;
      interestAmountCents: string;
    }) => requestJson(baseUrl, 'POST', '/sim/admin/mortgage-payments', input),
    postInterestCharge: (input: {
      helocId: string;
      ordinaryAccountId: string;
      interestPeriod: string;
      amountCents: string;
    }) => requestJson(baseUrl, 'POST', '/sim/admin/interest-charges', input),
    runEvents: (advanceMs: number) =>
      requestJson<{ advancedMs: number; jobsProcessed: number; now: string }>(
        baseUrl,
        'POST',
        '/sim/admin/run-events',
        { advanceMs },
      ),
  };
}

export function createBrokerageAdmin(baseUrl: string) {
  return {
    reset: () => requestJson(baseUrl, 'POST', '/sim/admin/brokerage/reset'),
    loadScenario: (fixtureId: string) =>
      requestJson(baseUrl, 'POST', '/sim/admin/brokerage/scenarios', { fixtureId }),
    createAccount: (input: {
      externalAccountId: string;
      displayName: string;
      id?: string;
      settledCashCents?: string;
    }) => requestJson<{ id: string }>(baseUrl, 'POST', '/sim/admin/brokerage/accounts', input),
    upsertQuote: (input: { symbol: string; mid: string; spread?: string }) =>
      requestJson(baseUrl, 'POST', '/sim/admin/brokerage/quotes', input),
    runEvents: (advanceMs: number) =>
      requestJson<{ advancedMs: number; jobsProcessed: number; now: string }>(
        baseUrl,
        'POST',
        '/sim/admin/brokerage/run-events',
        { advanceMs },
      ),
  };
}
