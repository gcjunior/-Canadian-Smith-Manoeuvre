import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { positiveCadCentsSchema } from '@csm/contracts';

import type { BrokerageSimulatorEngine } from '../engine.js';
import { SimulatorHttpError } from '../engine.js';

const depositBodySchema = z
  .object({
    accountId: z.string().uuid(),
    amountCents: positiveCadCentsSchema,
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

const orderBodySchema = z
  .object({
    accountId: z.string().uuid(),
    symbol: z.string().min(1).max(32),
    side: z.literal('BUY'),
    notionalCents: positiveCadCentsSchema,
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export async function registerBrokerageRoutes(
  app: FastifyInstance,
  engine: BrokerageSimulatorEngine,
): Promise<void> {
  app.get<{ Params: { accountId: string } }>(
    '/brokerage/accounts/:accountId',
    {
      schema: { tags: ['brokerage'], summary: 'Get brokerage account' },
    },
    async (request) => engine.accountPayload(engine.getAccount(request.params.accountId)),
  );

  app.get<{ Params: { accountId: string } }>(
    '/brokerage/accounts/:accountId/cash',
    {
      schema: { tags: ['brokerage'], summary: 'Get settled/pending cash' },
    },
    async (request) => engine.getCash(request.params.accountId),
  );

  app.get<{ Params: { accountId: string } }>(
    '/brokerage/accounts/:accountId/positions',
    {
      schema: { tags: ['brokerage'], summary: 'List positions' },
    },
    async (request) => ({
      positions: engine.listPositions(request.params.accountId),
    }),
  );

  app.post(
    '/brokerage/deposits',
    {
      schema: {
        tags: ['brokerage'],
        summary: 'Request a brokerage deposit (idempotent)',
      },
    },
    async (request, reply) => {
      const input = depositBodySchema.parse(request.body);
      const result = engine.createDeposit(input);
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.get<{ Params: { depositId: string } }>(
    '/brokerage/deposits/:depositId',
    {
      schema: { tags: ['brokerage'], summary: 'Get deposit by id' },
    },
    async (request) => engine.depositPayload(engine.getDeposit(request.params.depositId)),
  );

  app.get<{ Querystring: { key?: string } }>(
    '/brokerage/deposits/by-idempotency-key',
    {
      schema: { tags: ['brokerage'], summary: 'Lookup deposit by idempotency key' },
    },
    async (request) => {
      const key = request.query.key;
      if (!key) {
        throw new SimulatorHttpError(400, 'Missing key query parameter');
      }
      return engine.depositPayload(engine.getDepositByIdempotency(key));
    },
  );

  app.post(
    '/brokerage/orders',
    {
      schema: {
        tags: ['brokerage'],
        summary: 'Submit a notional market BUY order (idempotent)',
      },
    },
    async (request, reply) => {
      const input = orderBodySchema.parse(request.body);
      const result = engine.createOrder(input);
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.get<{ Params: { orderId: string } }>(
    '/brokerage/orders/:orderId',
    {
      schema: { tags: ['brokerage'], summary: 'Get order by id' },
    },
    async (request) => engine.orderPayload(engine.getOrder(request.params.orderId)),
  );

  app.get<{ Querystring: { key?: string } }>(
    '/brokerage/orders/by-idempotency-key',
    {
      schema: { tags: ['brokerage'], summary: 'Lookup order by idempotency key' },
    },
    async (request) => {
      const key = request.query.key;
      if (!key) {
        throw new SimulatorHttpError(400, 'Missing key query parameter');
      }
      return engine.orderPayload(engine.getOrderByIdempotency(key));
    },
  );
}
