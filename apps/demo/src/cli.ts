#!/usr/bin/env node
import { DEMO, type DemoScenarioKind } from './constants.js';
import { AcceleratedSimulatorClock } from './clock.js';
import { seedEdmontonDemo } from './seed.js';
import { driveEdmontonScenario, postAndSettleHelocInterest } from './run-scenario.js';
import {
  assertConversionInvariants,
  assertInterestFromOrdinary,
  assertNoInvestmentYet,
} from './assert.js';
import { createPrismaClient } from '@csm/database';

import { resolveDemoDatabaseUrl } from './database-url.js';

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true';
      out[key] = val;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const bankBaseUrl = env('BANK_SIMULATOR_BASE_URL', 'http://localhost:3002');
  const brokerageBaseUrl = env('BROKERAGE_SIMULATOR_BASE_URL', 'http://localhost:3003');
  const scenarioKind = (args.scenario ?? 'edmonton-demo') as DemoScenarioKind;

  if (cmd === 'seed') {
    const seed = await seedEdmontonDemo({
      bankBaseUrl,
      brokerageBaseUrl,
      scenarioKind,
      wipeDb: args['no-wipe'] !== 'true',
    });
    console.log(JSON.stringify({ ok: true, command: 'seed', seed }, null, 2));
    return;
  }

  if (cmd === 'clock-advance') {
    const ms = Number(args.ms ?? String(DEMO.delays.mortgagePostingMs));
    const clock = new AcceleratedSimulatorClock(bankBaseUrl, brokerageBaseUrl);
    const result = await clock.advance(ms);
    console.log(JSON.stringify({ ok: true, command: 'clock-advance', ms, result }, null, 2));
    return;
  }

  if (cmd === 'scenario') {
    const prisma = createPrismaClient(resolveDemoDatabaseUrl());
    try {
      const seed = await seedEdmontonDemo({
        bankBaseUrl,
        brokerageBaseUrl,
        scenarioKind,
        wipeDb: true,
        prisma,
      });

      let stop: (() => void) | null = null;
      const { stopSettlementDriver } = await driveEdmontonScenario({
        bankBaseUrl,
        brokerageBaseUrl,
        seed,
        onPhase: async (phase) => {
          console.log(`phase=${phase}`);
          if (
            phase === 'seeded' ||
            phase === 'payment_scheduled' ||
            phase === 'mortgage_posted' ||
            phase === 'mortgage_settled'
          ) {
            await assertNoInvestmentYet(prisma, seed, phase);
          }
        },
      });
      stop = stopSettlementDriver;

      console.log(
        JSON.stringify(
          {
            ok: true,
            command: 'scenario',
            note: 'Simulators advanced through HELOC readvance. Start Temporal Worker + monthlyConversionWorkflow for conversion; settlement driver is running.',
            seed,
            timezone: DEMO.timezone,
          },
          null,
          2,
        ),
      );

      if (args.interest === 'true') {
        await postAndSettleHelocInterest({
          bankBaseUrl,
          brokerageBaseUrl,
          seed,
          onPhase: async (phase) => console.log(`phase=${phase}`),
        });
        try {
          await assertInterestFromOrdinary(prisma, seed);
        } catch (err) {
          console.warn('Interest DB assertion skipped until interest Workflow runs:', err);
        }
      }

      if (args.assert === 'true') {
        const invariants = await assertConversionInvariants(prisma, seed);
        console.log(JSON.stringify({ invariants }, null, 2));
      }

      if (args.keepAlive !== 'true') {
        stop?.();
      } else {
        console.log('Settlement driver kept alive (--keepAlive). Ctrl+C to stop.');
        await new Promise(() => {
          /* hang intentionally */
        });
      }
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  console.error(`Usage:
  pnpm --filter @csm/demo seed [-- --scenario edmonton-demo|edmonton-ambiguous-draw]
  pnpm --filter @csm/demo scenario [-- --scenario edmonton-demo] [-- --interest] [-- --assert]
  pnpm --filter @csm/demo clock:advance [-- --ms 43200000]
`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
