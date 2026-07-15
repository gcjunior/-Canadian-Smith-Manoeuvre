import type { BankClient } from '@csm/bank-client';
import type { BrokerageClient } from '@csm/brokerage-client';
import {
  checkDatabaseHealth,
  createRepositories,
  type PrismaClient,
  type Repositories,
} from '@csm/database';
import type { Logger } from '@csm/observability';

import { createAuditActivities } from './audit/activities.js';
import { createBrokerageActivities } from './brokerage/activities.js';
import { createCycleActivities } from './cycle/activities.js';
import { createHelocActivities } from './heloc/activities.js';
import { createInterestActivities } from './interest/activities.js';
import { createMortgageActivities } from './mortgage/activities.js';
import { createPingActivities } from './ping.js';
import { noteActivityAttempt } from './shared/observability.js';
import { createTransferActivities } from './transfer/activities.js';

export interface ActivityDeps {
  logger: Logger;
  prisma: PrismaClient;
  repos?: Repositories;
  bankClient: BankClient;
  brokerageClient: BrokerageClient;
  platformMonthlyDrawCapCents: bigint;
}

/** Monthly conversion Activities + health probes. Workflow not included. */
export function createActivities(deps: ActivityDeps) {
  const repos = deps.repos ?? createRepositories(deps.prisma);
  const shared = { logger: deps.logger, repos };

  const ping = createPingActivities({ logger: deps.logger });
  const mortgage = createMortgageActivities({
    ...shared,
    bankClient: deps.bankClient,
  });
  const heloc = createHelocActivities({
    ...shared,
    prisma: deps.prisma,
    bankClient: deps.bankClient,
    platformMonthlyDrawCapCents: deps.platformMonthlyDrawCapCents,
  });
  const transfer = createTransferActivities({
    ...shared,
    bankClient: deps.bankClient,
    brokerageClient: deps.brokerageClient,
  });
  const brokerage = createBrokerageActivities({
    ...shared,
    brokerageClient: deps.brokerageClient,
  });
  const cycle = createCycleActivities({
    ...shared,
    prisma: deps.prisma,
  });
  const interest = createInterestActivities({
    ...shared,
    prisma: deps.prisma,
    bankClient: deps.bankClient,
  });
  const audit = createAuditActivities(shared);

  const combined = {
    ...ping,
    ...mortgage,
    ...heloc,
    ...transfer,
    ...brokerage,
    ...cycle,
    ...interest,
    ...audit,
    async checkDatabaseActivity(): Promise<void> {
      await checkDatabaseHealth(deps.prisma);
    },
    async checkBankSimulatorActivity(correlationId: string): Promise<void> {
      await deps.bankClient.health(correlationId);
    },
    async checkBrokerageSimulatorActivity(correlationId: string): Promise<void> {
      await deps.brokerageClient.health(correlationId);
    },
  };

  // Soft-wrap every activity so Temporal retries emit csm_activity_retries + alerts.
  for (const key of Object.keys(combined) as Array<keyof typeof combined>) {
    const original = combined[key];
    if (typeof original !== 'function') continue;
    const name = String(key);
    (combined as Record<string, unknown>)[name] = async (...args: unknown[]) => {
      const first = args[0] as { correlationId?: string } | string | undefined;
      const correlationId =
        typeof first === 'string'
          ? first
          : first && typeof first === 'object'
            ? first.correlationId
            : undefined;
      noteActivityAttempt(name, deps.logger, correlationId);
      return (original as (...a: unknown[]) => Promise<unknown>).apply(combined, args);
    };
  }

  return combined;
}

export type Activities = ReturnType<typeof createActivities>;
