import { randomUUID } from 'node:crypto';

import { AppError, type TenantContext } from '@csm/contracts';
import type { Repositories } from '@csm/database';

import { requireRoles } from '../auth/guards.js';

class SimAdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SimAdminError';
  }
}

async function simJson<T>(
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
    const detail =
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      typeof (parsed as { error: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : text.slice(0, 200);
    throw new SimAdminError(
      res.status,
      `Simulator ${method} ${path} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
    );
  }
  return parsed as T;
}

export interface ConnectionSimulatorConfig {
  bankBaseUrl: string;
  brokerageBaseUrl: string;
}

/**
 * Dual-writes simulated provider accounts and Postgres FinancialAccount rows so
 * `providerAccountId` matches live simulator UUIDs (required for BankClient /
 * BrokerageClient money paths). Does not reset shared simulators.
 */
export class ConnectionAppService {
  constructor(
    private readonly repos: Repositories,
    private readonly sims: ConnectionSimulatorConfig,
  ) {}

  async createSimulatedBank(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['CUSTOMER'], correlationId);
    const suffix = randomUUID().slice(0, 8);

    let simUser: { id: string };
    let mortgageCreated: {
      account: { id: string };
      mortgage: { id: string } | null;
      heloc: { id: string } | null;
    };
    let helocCreated: {
      account: { id: string };
      mortgage: { id: string } | null;
      heloc: { id: string } | null;
    };
    let ordinaryCreated: {
      account: { id: string };
      mortgage: { id: string } | null;
      heloc: { id: string } | null;
    };
    try {
      simUser = await simJson(this.sims.bankBaseUrl, 'POST', '/sim/admin/users', {
        externalUserId: `api-${auth.userId.slice(0, 8)}-${suffix}`,
        displayName: `Sim user ${suffix}`,
      });
      mortgageCreated = await this.createBankAccountOnSim(simUser.id, {
        kind: 'MORTGAGE',
        displayAlias: 'Simulated Mortgage',
        providerAccountId: `api-mortgage-${suffix}`,
        mortgage: {
          outstandingPrincipalCents: '45000000',
          expectedPaymentDay: 1,
        },
      });
      helocCreated = await this.createBankAccountOnSim(simUser.id, {
        kind: 'HELOC',
        displayAlias: 'Simulated HELOC',
        providerAccountId: `api-heloc-${suffix}`,
        heloc: {
          creditLimitCents: '20000000',
          balanceOwedCents: '0',
          existingAvailableCreditCents: '1000000',
        },
      });
      ordinaryCreated = await this.createBankAccountOnSim(simUser.id, {
        kind: 'ORDINARY',
        displayAlias: 'Simulated Chequing',
        providerAccountId: `api-ordinary-${suffix}`,
        balanceCents: '2500000',
      });
    } catch (error) {
      throw new AppError({
        code: 'INTERNAL_ERROR',
        message:
          error instanceof Error
            ? `Bank simulator provisioning failed: ${error.message}`
            : 'Bank simulator provisioning failed',
        correlationId,
      });
    }

    const connection = await this.repos.accounts.createConnection(auth.tenantId, {
      userId: auth.userId,
      providerType: 'BANK',
      providerConnectionId: `sim-bank-${suffix}`,
      displayAlias: 'Simulated Bank',
    });

    const mortgageAccount = await this.repos.accounts.createAccount(auth.tenantId, {
      userId: auth.userId,
      connectionId: connection.id,
      kind: 'MORTGAGE',
      displayAlias: 'Simulated Mortgage',
      providerAccountId: mortgageCreated.account.id,
    });
    await this.repos.accounts.createMortgage(auth.tenantId, {
      accountId: mortgageAccount.id,
      outstandingPrincipalCents: 450_000_00n,
      contractualPaymentCents: 2_500_00n,
      expectedPaymentDay: 1,
    });

    const helocAccount = await this.repos.accounts.createAccount(auth.tenantId, {
      userId: auth.userId,
      connectionId: connection.id,
      kind: 'HELOC',
      displayAlias: 'Simulated HELOC',
      providerAccountId: helocCreated.account.id,
    });
    await this.repos.accounts.createHeloc(auth.tenantId, {
      accountId: helocAccount.id,
      creditLimitCents: 200_000_00n,
      balanceOwedCents: 0n,
      availableCreditCents: 10_000_00n,
    });

    const bankAccount = await this.repos.accounts.createAccount(auth.tenantId, {
      userId: auth.userId,
      connectionId: connection.id,
      kind: 'BANK_OPERATING',
      displayAlias: 'Simulated Chequing',
      providerAccountId: ordinaryCreated.account.id,
    });
    await this.repos.accounts.createOrdinaryBankAccount(auth.tenantId, bankAccount.id);

    return {
      connection,
      accounts: {
        mortgageAccountId: mortgageAccount.id,
        helocAccountId: helocAccount.id,
        bankAccountId: bankAccount.id,
      },
      simulatorUserId: simUser.id,
    };
  }

  async createSimulatedBrokerage(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['CUSTOMER'], correlationId);
    const suffix = randomUUID().slice(0, 8);
    const brokerageId = randomUUID();

    let brokerageCreated: { id: string };
    try {
      brokerageCreated = await this.createBrokerageAccountOnSim({
        id: brokerageId,
        externalAccountId: `api-broker-${suffix}`,
        displayName: 'Simulated Non-Registered',
        settledCashCents: '0',
      });
      await simJson(this.sims.brokerageBaseUrl, 'POST', '/sim/admin/brokerage/quotes', {
        symbol: 'XEQT.TO',
        mid: '30.00',
        spread: '0.01',
      });
    } catch (error) {
      throw new AppError({
        code: 'INTERNAL_ERROR',
        message:
          error instanceof Error
            ? `Brokerage simulator provisioning failed: ${error.message}`
            : 'Brokerage simulator provisioning failed',
        correlationId,
      });
    }

    // Optional bank-side brokerage funding rail when a bank connection already exists.
    const connections = await this.repos.accounts.listConnectionsForUser(
      auth.tenantId,
      auth.userId,
    );
    const bankConn = connections.find((c) => c.providerType === 'BANK');
    if (bankConn) {
      try {
        // Resolve a bank sim user via creating link under a disposable user when needed —
        // prefer attaching BROKERAGE_LINK with the same UUID as brokerage cash.
        const bankAccounts = await this.repos.accounts.listAccountsForUser(
          auth.tenantId,
          auth.userId,
        );
        const ordinary = bankAccounts.find((a) => a.kind === 'BANK_OPERATING');
        if (ordinary) {
          // Create BROKERAGE_LINK on bank sim keyed to brokerage account UUID so transfers work.
          // Requires a bank user — look up via ordinary provider account ownership is not exposed;
          // createAccount needs userId. Provision a lightweight bank user for the link only.
          const linkUser = await simJson<{ id: string }>(
            this.sims.bankBaseUrl,
            'POST',
            '/sim/admin/users',
            {
              externalUserId: `api-link-${suffix}`,
              displayName: `Brokerage link ${suffix}`,
            },
          );
          await simJson(this.sims.bankBaseUrl, 'POST', '/sim/admin/accounts', {
            userId: linkUser.id,
            kind: 'BROKERAGE_LINK',
            displayAlias: 'Brokerage funding rail',
            providerAccountId: `api-brokerage-link-${suffix}`,
            id: brokerageCreated.id,
          });
        }
      } catch {
        // Funding rail is best-effort; draw→chequing still works; transfer needs matching link.
      }
    }

    const connection = await this.repos.accounts.createConnection(auth.tenantId, {
      userId: auth.userId,
      providerType: 'BROKERAGE',
      providerConnectionId: `sim-brokerage-${suffix}`,
      displayAlias: 'Simulated Brokerage',
    });
    const brokerageAccount = await this.repos.accounts.createAccount(auth.tenantId, {
      userId: auth.userId,
      connectionId: connection.id,
      kind: 'BROKERAGE_CASH',
      displayAlias: 'Simulated Non-Registered',
      providerAccountId: brokerageCreated.id,
    });
    await this.repos.accounts.createBrokerageAccount(auth.tenantId, brokerageAccount.id);
    return {
      connection,
      accounts: { brokerageAccountId: brokerageAccount.id },
    };
  }

  async listConnections(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['CUSTOMER'], correlationId);
    return this.repos.accounts.listConnectionsForUser(auth.tenantId, auth.userId);
  }

  async listAccounts(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['CUSTOMER'], correlationId);
    return this.repos.accounts.listAccountsForUser(auth.tenantId, auth.userId);
  }

  async requireOwnedAccount(auth: TenantContext, accountId: string, correlationId: string) {
    const account = await this.repos.accounts.findAccountById(auth.tenantId, accountId);
    if (!account || account.userId !== auth.userId) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Account not found', correlationId });
    }
    return account;
  }

  private async createBankAccountOnSim(
    userId: string,
    body: Record<string, unknown>,
  ): Promise<{
    account: { id: string };
    mortgage: { id: string } | null;
    heloc: { id: string } | null;
  }> {
    try {
      return await simJson(this.sims.bankBaseUrl, 'POST', '/sim/admin/accounts', {
        userId,
        ...body,
      });
    } catch (error) {
      if (!(error instanceof SimAdminError) || !/No scenario loaded/i.test(error.message)) {
        throw error;
      }
      await simJson(this.sims.bankBaseUrl, 'POST', '/sim/admin/scenarios', {
        fixtureId: 'happy-path',
      });
      return await simJson(this.sims.bankBaseUrl, 'POST', '/sim/admin/accounts', {
        userId,
        ...body,
      });
    }
  }

  private async createBrokerageAccountOnSim(body: {
    id: string;
    externalAccountId: string;
    displayName: string;
    settledCashCents: string;
  }): Promise<{ id: string }> {
    try {
      return await simJson(this.sims.brokerageBaseUrl, 'POST', '/sim/admin/brokerage/accounts', body);
    } catch (error) {
      if (!(error instanceof SimAdminError) || !/No scenario loaded/i.test(error.message)) {
        throw error;
      }
      await simJson(this.sims.brokerageBaseUrl, 'POST', '/sim/admin/brokerage/scenarios', {
        fixtureId: 'happy-path',
      });
      return await simJson(this.sims.brokerageBaseUrl, 'POST', '/sim/admin/brokerage/accounts', body);
    }
  }
}
