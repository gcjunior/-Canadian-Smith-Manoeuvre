import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { nonNegativeCadCentsSchema, decimalStringSchema } from '@csm/contracts';

import type { BrokerageSimulatorEngine } from '../engine.js';
import { SimulatorHttpError } from '../engine.js';
import { SCENARIO_FIXTURES } from '../scenario/fixtures.js';
import { brokerageScenarioConfigSchema } from '../scenario/schema.js';

const createAccountSchema = z
  .object({
    externalAccountId: z.string().min(1),
    displayName: z.string().min(1),
    settledCashCents: nonNegativeCadCentsSchema.optional(),
  })
  .strict();

const upsertQuoteSchema = z
  .object({
    symbol: z.string().min(1).max(32),
    mid: decimalStringSchema,
    spread: decimalStringSchema.optional(),
  })
  .strict();

const runEventsSchema = z
  .object({
    advanceMs: z.number().int().nonnegative().default(0),
  })
  .strict();

export async function registerAdminRoutes(
  app: FastifyInstance,
  engine: BrokerageSimulatorEngine,
): Promise<void> {
  app.post(
    '/sim/admin/brokerage/scenarios',
    {
      schema: {
        tags: ['sim-admin'],
        summary: 'Load a brokerage scenario config or named fixture',
      },
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const fixtureId = typeof body.fixtureId === 'string' ? body.fixtureId : undefined;
      let config;
      if (fixtureId) {
        const fixture = SCENARIO_FIXTURES[fixtureId as keyof typeof SCENARIO_FIXTURES];
        if (!fixture) {
          throw new SimulatorHttpError(404, `Unknown fixture: ${fixtureId}`);
        }
        config = brokerageScenarioConfigSchema.parse(fixture);
      } else {
        config = brokerageScenarioConfigSchema.parse(body);
      }
      const loaded = engine.loadScenario(config);
      return reply.code(201).send({
        scenarioId: loaded.scenarioId,
        mode: loaded.mode,
        etfSymbol: loaded.etfSymbol,
        quotePrice: loaded.quotePrice,
        clock: engine.getClock().now().toISOString(),
      });
    },
  );

  app.post(
    '/sim/admin/brokerage/accounts',
    {
      schema: {
        tags: ['sim-admin'],
        summary: 'Create a CAD non-registered brokerage account',
      },
    },
    async (request, reply) => {
      const input = createAccountSchema.parse(request.body);
      const account = engine.createAccount({
        externalAccountId: input.externalAccountId,
        displayName: input.displayName,
        ...(input.settledCashCents !== undefined
          ? { settledCashCents: input.settledCashCents }
          : {}),
      });
      return reply.code(201).send(engine.accountPayload(account));
    },
  );

  app.post(
    '/sim/admin/brokerage/quotes',
    {
      schema: {
        tags: ['sim-admin'],
        summary: 'Upsert a simulated ETF quote',
      },
    },
    async (request, reply) => {
      const input = upsertQuoteSchema.parse(request.body);
      const quote = engine.upsertQuote({
        symbol: input.symbol,
        mid: input.mid,
        ...(input.spread !== undefined ? { spread: input.spread } : {}),
      });
      return reply.code(201).send(quote);
    },
  );

  app.post(
    '/sim/admin/brokerage/run-events',
    {
      schema: {
        tags: ['sim-admin'],
        summary: 'Advance the deterministic clock and process due jobs',
      },
    },
    async (request) => {
      const input = runEventsSchema.parse(request.body ?? {});
      return engine.runEvents(input.advanceMs);
    },
  );

  app.post(
    '/sim/admin/brokerage/reset',
    {
      schema: { tags: ['sim-admin'], summary: 'Reset in-memory provider state' },
    },
    async () => {
      engine.reset();
      return { status: 'reset', clock: engine.getClock().now().toISOString() };
    },
  );
}
