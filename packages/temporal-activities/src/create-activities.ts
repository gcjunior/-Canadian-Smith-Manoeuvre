import type { BankClient } from '@csm/bank-client';
import type { BrokerageClient } from '@csm/brokerage-client';
import { checkDatabaseHealth, type PrismaClient } from '@csm/database';
import type { Logger } from '@csm/observability';

import { createPingActivities } from './ping.js';

export interface ActivityDeps {
  logger: Logger;
  prisma: PrismaClient;
  bankClient: BankClient;
  brokerageClient: BrokerageClient;
}

/** Scaffold activities only — no financial side effects yet. */
export function createActivities(deps: ActivityDeps) {
  const ping = createPingActivities({ logger: deps.logger });

  return {
    ...ping,
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
}

export type Activities = ReturnType<typeof createActivities>;
