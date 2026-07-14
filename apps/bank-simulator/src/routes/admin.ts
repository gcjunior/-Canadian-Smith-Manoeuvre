import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { nonNegativeCadCentsSchema, positiveCadCentsSchema } from '@csm/contracts';

import type { BankSimulatorEngine } from '../engine.js';
import { SimulatorHttpError } from '../engine.js';
import { SCENARIO_FIXTURES } from '../scenario/fixtures.js';
import { bankScenarioConfigSchema } from '../scenario/schema.js';

const createUserSchema = z
  .object({
    externalUserId: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

const createAccountSchema = z
  .object({
    userId: z.string().uuid(),
    kind: z.enum(['MORTGAGE', 'HELOC', 'ORDINARY', 'BROKERAGE_LINK']),
    displayAlias: z.string().min(1),
    providerAccountId: z.string().min(1),
    balanceCents: nonNegativeCadCentsSchema.optional(),
    mortgage: z
      .object({
        outstandingPrincipalCents: nonNegativeCadCentsSchema,
        expectedPaymentDay: z.number().int().min(1).max(28),
      })
      .strict()
      .optional(),
    heloc: z
      .object({
        creditLimitCents: positiveCadCentsSchema,
        balanceOwedCents: nonNegativeCadCentsSchema,
        existingAvailableCreditCents: nonNegativeCadCentsSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const runEventsSchema = z
  .object({
    advanceMs: z.number().int().nonnegative().default(0),
  })
  .strict();

const schedulePaymentSchema = z
  .object({
    mortgageId: z.string().uuid(),
    paymentPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    totalAmountCents: positiveCadCentsSchema,
    principalAmountCents: nonNegativeCadCentsSchema,
    interestAmountCents: nonNegativeCadCentsSchema,
  })
  .strict();

const interestChargeSchema = z
  .object({
    helocId: z.string().uuid(),
    ordinaryAccountId: z.string().uuid(),
    interestPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    amountCents: positiveCadCentsSchema,
  })
  .strict();

export async function registerAdminRoutes(
  app: FastifyInstance,
  engine: BankSimulatorEngine,
): Promise<void> {
  app.post(
    '/sim/admin/scenarios',
    {
      schema: {
        tags: ['sim-admin'],
        summary: 'Load a scenario config or named fixture',
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
        config = bankScenarioConfigSchema.parse(fixture);
      } else {
        config = bankScenarioConfigSchema.parse(body);
      }
      const loaded = engine.loadScenario(config);
      return reply.code(201).send({
        scenarioId: loaded.scenarioId,
        mode: loaded.mode,
        clock: engine.getClock().now().toISOString(),
      });
    },
  );

  app.post(
    '/sim/admin/users',
    {
      schema: { tags: ['sim-admin'], summary: 'Create a simulator user' },
    },
    async (request, reply) => {
      const input = createUserSchema.parse(request.body);
      const user = engine.createUser(input);
      return reply.code(201).send(user);
    },
  );

  app.post(
    '/sim/admin/accounts',
    {
      schema: {
        tags: ['sim-admin'],
        summary: 'Create a provider account (mortgage / HELOC / ordinary)',
      },
    },
    async (request, reply) => {
      const input = createAccountSchema.parse(request.body);
      const created = engine.createAccount({
        userId: input.userId,
        kind: input.kind,
        displayAlias: input.displayAlias,
        providerAccountId: input.providerAccountId,
        ...(input.balanceCents !== undefined ? { balanceCents: input.balanceCents } : {}),
        ...(input.mortgage !== undefined ? { mortgage: input.mortgage } : {}),
        ...(input.heloc !== undefined ? { heloc: input.heloc } : {}),
      });
      return reply.code(201).send({
        account: {
          ...created.account,
          balanceCents: created.account.balanceCents.toString(),
        },
        mortgage: created.mortgage
          ? {
              ...created.mortgage,
              outstandingPrincipalCents: created.mortgage.outstandingPrincipalCents.toString(),
            }
          : null,
        heloc: created.heloc
          ? {
              id: created.heloc.id,
              accountId: created.heloc.accountId,
              creditLimitCents: created.heloc.creditLimitCents.toString(),
              balanceOwedCents: created.heloc.balanceOwedCents.toString(),
              existingAvailableCreditCents: created.heloc.existingAvailableCreditCents.toString(),
              newlyAvailableCreditCents: created.heloc.newlyAvailableCreditCents.toString(),
            }
          : null,
      });
    },
  );

  app.post(
    '/sim/admin/run-events',
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
    '/sim/admin/reset',
    {
      schema: { tags: ['sim-admin'], summary: 'Reset in-memory provider state' },
    },
    async () => {
      engine.reset();
      return { status: 'reset', clock: engine.getClock().now().toISOString() };
    },
  );

  /** Setup helper: schedule a mortgage payment lifecycle. */
  app.post(
    '/sim/admin/mortgage-payments',
    {
      schema: {
        tags: ['sim-admin'],
        summary: 'Schedule a mortgage payment (SCHEDULED → POSTED → SETTLED)',
      },
    },
    async (request, reply) => {
      const input = schedulePaymentSchema.parse(request.body);
      const payment = engine.scheduleMortgagePayment(input);
      return reply.code(201).send(engine.paymentPayload(payment));
    },
  );

  /** Setup helper: post HELOC interest and auto-debit ordinary account. */
  app.post(
    '/sim/admin/interest-charges',
    {
      schema: {
        tags: ['sim-admin'],
        summary: 'Post HELOC interest charge and schedule ordinary-account debit',
      },
    },
    async (request, reply) => {
      const input = interestChargeSchema.parse(request.body);
      const result = engine.postInterestCharge(input);
      return reply.code(201).send({
        charge: {
          ...result.charge,
          amountCents: result.charge.amountCents.toString(),
        },
        paymentId: result.paymentId,
      });
    },
  );
}
