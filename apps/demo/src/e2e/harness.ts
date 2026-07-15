import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

import { BankClient } from '@csm/bank-client';
import { buildSimulatorApp as buildBankApp } from '@csm/bank-simulator';
import type { BankSimulatorEngine } from '@csm/bank-simulator/engine';
import { SimulatorClock as BankClock } from '@csm/bank-simulator/clock';
import { BrokerageClient } from '@csm/brokerage-client';
import { buildSimulatorApp as buildBrokerageApp } from '@csm/brokerage-simulator';
import type { BrokerageSimulatorEngine } from '@csm/brokerage-simulator/engine';
import { SimulatorClock as BrokerageClock } from '@csm/brokerage-simulator/clock';
import type { SimulatorEnv } from '@csm/contracts';
import { createPrismaClient, createRepositories, type PrismaClient } from '@csm/database';
import { createLogger } from '@csm/observability';
import { createActivities } from '@csm/temporal-activities';
import {
  helocInterestPaymentWorkflow,
  monthlyConversionWorkflow,
  type MonthlyConversionWorkflowInput,
} from '@csm/temporal-workflows';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';

import {
  assertConversionInvariants,
  assertInterestFromOrdinary,
  assertNoInvestmentYet,
  countByType,
} from '../assert.js';
import { AcceleratedSimulatorClock } from '../clock.js';
import { DEMO, HOUR_MS, type DemoScenarioKind } from '../constants.js';
import { createBankAdmin } from '../sim-admin.js';
import { seedEdmontonDemo, type SeedResult } from '../seed.js';
import { postAndSettleHelocInterest } from '../run-scenario.js';

const monthlyWorkflowsPath = fileURLToPath(
  new URL(
    '../../../../packages/temporal-workflows/src/monthly-conversion/workflow.ts',
    import.meta.url,
  ),
);
const interestWorkflowsPath = fileURLToPath(
  new URL(
    '../../../../packages/temporal-workflows/src/heloc-interest/workflow.ts',
    import.meta.url,
  ),
);

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Unable to allocate port'));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function simEnv(port: number, service: string): SimulatorEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    SERVICE_NAME: service,
    SERVICE_VERSION: '0.0.0',
    OTEL_ENABLED: false,
    HOST: '127.0.0.1',
    PORT: port,
    WEBHOOK_SIGNING_SECRET: 'demo-webhook-secret',
    WEBHOOKS_ENABLED: false,
  };
}

export interface DemoHarness {
  prisma: PrismaClient;
  bankBaseUrl: string;
  brokerageBaseUrl: string;
  bankApp: Awaited<ReturnType<typeof buildBankApp>>;
  brokerageApp: Awaited<ReturnType<typeof buildBrokerageApp>>;
  bankEngine: BankSimulatorEngine;
  brokerageEngine: BrokerageSimulatorEngine;
  testEnv: TestWorkflowEnvironment;
  seed: SeedResult;
  close: () => Promise<void>;
}

export async function createDemoHarness(
  scenarioKind: DemoScenarioKind = 'edmonton-demo',
): Promise<DemoHarness> {
  const logger = createLogger({ service: 'demo-e2e', level: 'silent', pretty: false });
  const bankPort = await freePort();
  const brokeragePort = await freePort();

  const bankApp = await buildBankApp({
    env: simEnv(bankPort, 'bank-simulator'),
    logger,
    clock: new BankClock(new Date(DEMO.clockStartIso)),
  });
  const brokerageApp = await buildBrokerageApp({
    env: simEnv(brokeragePort, 'brokerage-simulator'),
    logger,
    clock: new BrokerageClock(new Date(DEMO.clockStartIso)),
  });

  await bankApp.listen({ host: '127.0.0.1', port: bankPort });
  await brokerageApp.listen({ host: '127.0.0.1', port: brokeragePort });

  const bankBaseUrl = `http://127.0.0.1:${bankPort}`;
  const brokerageBaseUrl = `http://127.0.0.1:${brokeragePort}`;

  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';

  const prisma = createPrismaClient();
  const seed = await seedEdmontonDemo({
    bankBaseUrl,
    brokerageBaseUrl,
    scenarioKind,
    wipeDb: true,
    prisma,
  });

  const testEnv = await TestWorkflowEnvironment.createTimeSkipping();

  return {
    prisma,
    bankBaseUrl,
    brokerageBaseUrl,
    bankApp,
    brokerageApp,
    bankEngine: (bankApp as unknown as { engine: BankSimulatorEngine }).engine,
    brokerageEngine: (brokerageApp as unknown as { engine: BrokerageSimulatorEngine }).engine,
    testEnv,
    seed,
    close: async () => {
      await testEnv.teardown();
      await bankApp.close();
      await brokerageApp.close();
      await prisma.$disconnect();
    },
  };
}

export async function runEdmontonConversion(
  harness: DemoHarness,
  options?: { proveGates?: boolean },
): Promise<{
  result: Awaited<ReturnType<typeof monthlyConversionWorkflow>>;
  initiateDrawAttempts: number;
}> {
  const logger = createLogger({ service: 'demo-worker', level: 'silent', pretty: false });
  const bankClient = new BankClient({ baseUrl: harness.bankBaseUrl, logger });
  const brokerageClient = new BrokerageClient({
    baseUrl: harness.brokerageBaseUrl,
    logger,
  });
  const activities = createActivities({
    logger,
    prisma: harness.prisma,
    repos: createRepositories(harness.prisma),
    bankClient,
    brokerageClient,
    platformMonthlyDrawCapCents: DEMO.platformMonthlyCapCents,
  });

  let initiateDrawAttempts = 0;
  const wrapped = {
    ...activities,
    initiateHelocDraw: async (...args: Parameters<typeof activities.initiateHelocDraw>) => {
      initiateDrawAttempts += 1;
      return activities.initiateHelocDraw(...args);
    },
  };

  const taskQueue = `demo-${randomUUID()}`;
  const worker = await Worker.create({
    connection: harness.testEnv.nativeConnection,
    taskQueue,
    workflowsPath: monthlyWorkflowsPath,
    activities: wrapped,
  });

  const input: MonthlyConversionWorkflowInput = {
    tenantId: harness.seed.tenantId,
    strategyId: harness.seed.strategyId,
    paymentPeriod: DEMO.paymentPeriod,
    expectedPaymentDate: DEMO.expectedPaymentDate,
    timezone: DEMO.timezone,
    correlationId: randomUUID(),
    simulatorScenarioId: harness.seed.scenarioKind,
  };

  const bank = createBankAdmin(harness.bankBaseUrl);
  const clock = new AcceleratedSimulatorClock(harness.bankBaseUrl, harness.brokerageBaseUrl);

  return await worker.runUntil(async () => {
    const handle = await harness.testEnv.client.workflow.start(monthlyConversionWorkflow, {
      taskQueue,
      workflowId: `monthly-conversion/${input.tenantId}/${input.strategyId}/${input.paymentPeriod}-${randomUUID()}`,
      args: [input],
      memo: { correlationId: input.correlationId },
    });

    await assertNoInvestmentYet(harness.prisma, harness.seed, 'workflow_started');

    await bank.scheduleMortgagePayment({
      mortgageId: harness.seed.mortgageFacilityId,
      paymentPeriod: DEMO.paymentPeriod,
      totalAmountCents: DEMO.mortgagePayment.totalAmountCents.toString(),
      principalAmountCents: DEMO.mortgagePayment.principalAmountCents.toString(),
      interestAmountCents: DEMO.mortgagePayment.interestAmountCents.toString(),
    });

    if (options?.proveGates !== false) {
      await clock.toMortgagePosted();
      await harness.testEnv.sleep('6 hours');
      await assertNoInvestmentYet(harness.prisma, harness.seed, 'after_mortgage_posted');

      await clock.toMortgageSettled();
      await harness.testEnv.sleep('6 hours');
      await assertNoInvestmentYet(
        harness.prisma,
        harness.seed,
        'after_mortgage_settled_before_readvance',
      );

      await clock.toHelocReadvanced();
    } else {
      await clock.advance(
        DEMO.delays.mortgagePostingMs +
          DEMO.delays.mortgageSettlementMs +
          DEMO.delays.helocReadvanceMs,
      );
    }

    // Temporal TestWorkflowEnvironment time-skips Activity retry/backoff without
    // advancing simulator clocks — pump sim time between Temporal yields.
    const resultPromise = handle.result();
    let result: Awaited<typeof resultPromise> | undefined;
    for (let i = 0; i < 500; i += 1) {
      const raced = await Promise.race([
        resultPromise.then((r) => ({ kind: 'done' as const, r })),
        harness.testEnv.sleep('1 second').then(() => ({ kind: 'tick' as const })),
      ]);
      if (raced.kind === 'done') {
        result = raced.r;
        break;
      }
      await clock.advance(HOUR_MS);
    }
    if (!result) {
      result = await resultPromise;
    }
    return { result, initiateDrawAttempts };
  });
}

export async function runEdmontonInterest(harness: DemoHarness): Promise<void> {
  const logger = createLogger({ service: 'demo-interest-worker', level: 'silent', pretty: false });
  const bankClient = new BankClient({ baseUrl: harness.bankBaseUrl, logger });
  const brokerageClient = new BrokerageClient({
    baseUrl: harness.brokerageBaseUrl,
    logger,
  });
  const activities = createActivities({
    logger,
    prisma: harness.prisma,
    repos: createRepositories(harness.prisma),
    bankClient,
    brokerageClient,
    platformMonthlyDrawCapCents: DEMO.platformMonthlyCapCents,
  });

  await postAndSettleHelocInterest({
    bankBaseUrl: harness.bankBaseUrl,
    brokerageBaseUrl: harness.brokerageBaseUrl,
    seed: harness.seed,
  });

  const taskQueue = `demo-interest-${randomUUID()}`;
  const worker = await Worker.create({
    connection: harness.testEnv.nativeConnection,
    taskQueue,
    workflowsPath: interestWorkflowsPath,
    activities,
  });

  await worker.runUntil(async () => {
    const handle = await harness.testEnv.client.workflow.start(helocInterestPaymentWorkflow, {
      taskQueue,
      workflowId: `heloc-interest/${harness.seed.tenantId}/${harness.seed.strategyId}/${DEMO.interestPeriod}-${randomUUID()}`,
      args: [
        {
          tenantId: harness.seed.tenantId,
          strategyId: harness.seed.strategyId,
          interestPeriod: DEMO.interestPeriod,
          expectedInterestChargeDate: DEMO.expectedInterestChargeDate,
          timezone: DEMO.timezone,
          correlationId: randomUUID(),
        },
      ],
    });
    const clock = new AcceleratedSimulatorClock(harness.bankBaseUrl, harness.brokerageBaseUrl);
    const resultPromise = handle.result();
    for (let i = 0; i < 200; i += 1) {
      const raced = await Promise.race([
        resultPromise.then((r) => ({ kind: 'done' as const, r })),
        harness.testEnv.sleep('1 second').then(() => ({ kind: 'tick' as const })),
      ]);
      if (raced.kind === 'done') {
        break;
      }
      await clock.advance(HOUR_MS);
    }
    await resultPromise;
  });

  await assertInterestFromOrdinary(harness.prisma, harness.seed);
}

export { assertConversionInvariants, assertNoInvestmentYet, countByType, DEMO };
