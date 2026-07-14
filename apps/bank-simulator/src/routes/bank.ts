import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { positiveCadCentsSchema } from '@csm/contracts';

import type { BankSimulatorEngine } from '../engine.js';

const drawBodySchema = z
  .object({
    amountCents: positiveCadCentsSchema,
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

const transferBodySchema = z
  .object({
    sourceAccountId: z.string().uuid(),
    destinationAccountId: z.string().uuid(),
    amountCents: positiveCadCentsSchema,
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

function serializeTxn(txn: {
  id: string;
  accountId: string;
  amountCents: bigint;
  narrative: string;
  createdAt: string;
  relatedId: string | null;
}) {
  return {
    ...txn,
    amountCents: txn.amountCents.toString(),
  };
}

export async function registerBankRoutes(
  app: FastifyInstance,
  engine: BankSimulatorEngine,
): Promise<void> {
  app.get<{ Params: { accountId: string } }>(
    '/bank/accounts/:accountId',
    {
      schema: {
        tags: ['bank'],
        summary: 'Get provider account',
        params: {
          type: 'object',
          required: ['accountId'],
          properties: { accountId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request) => {
      const account = engine.getAccount(request.params.accountId);
      return {
        ...account,
        balanceCents: account.balanceCents.toString(),
      };
    },
  );

  app.get<{ Params: { accountId: string } }>(
    '/bank/accounts/:accountId/transactions',
    {
      schema: {
        tags: ['bank'],
        summary: 'List account transactions',
      },
    },
    async (request) => ({
      transactions: engine.listAccountTransactions(request.params.accountId).map(serializeTxn),
    }),
  );

  app.get<{ Params: { mortgageId: string } }>(
    '/bank/mortgages/:mortgageId/payments',
    {
      schema: {
        tags: ['bank'],
        summary: 'List mortgage payments',
      },
    },
    async (request) => ({
      payments: engine
        .listMortgagePayments(request.params.mortgageId)
        .map((p) => engine.paymentPayload(p)),
    }),
  );

  app.get<{ Params: { helocId: string } }>(
    '/bank/helocs/:helocId/availability',
    {
      schema: {
        tags: ['bank'],
        summary: 'Get HELOC availability (existing vs newly available credit)',
      },
    },
    async (request) => engine.getHelocAvailability(request.params.helocId),
  );

  app.get<{ Params: { helocId: string } }>(
    '/bank/helocs/:helocId/interest-charges',
    {
      schema: {
        tags: ['bank'],
        summary: 'List HELOC interest charges',
      },
    },
    async (request) => ({
      charges: engine.listInterestCharges(request.params.helocId).map((c) => ({
        ...c,
        amountCents: c.amountCents.toString(),
      })),
    }),
  );

  app.post<{ Params: { helocId: string } }>(
    '/bank/helocs/:helocId/draws',
    {
      schema: {
        tags: ['bank'],
        summary: 'Request a HELOC draw (idempotent)',
      },
    },
    async (request, reply) => {
      const input = drawBodySchema.parse(request.body);
      const result = engine.createHelocDraw(request.params.helocId, input);
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.get<{ Params: { helocId: string; drawId: string } }>(
    '/bank/helocs/:helocId/draws/:drawId',
    {
      schema: {
        tags: ['bank'],
        summary: 'Get HELOC draw by id',
      },
    },
    async (request) =>
      engine.drawPayload(engine.getDraw(request.params.helocId, request.params.drawId)),
  );

  app.get<{ Params: { helocId: string; key: string } }>(
    '/bank/helocs/:helocId/draws/by-idempotency-key/:key',
    {
      schema: {
        tags: ['bank'],
        summary: 'Lookup HELOC draw by idempotency key',
      },
    },
    async (request) =>
      engine.drawPayload(
        engine.getDrawByIdempotency(request.params.helocId, request.params.key),
      ),
  );

  app.post(
    '/bank/transfers',
    {
      schema: {
        tags: ['bank'],
        summary: 'Create a bank transfer (idempotent)',
      },
    },
    async (request, reply) => {
      const input = transferBodySchema.parse(request.body);
      const result = engine.createTransfer(input);
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.get<{ Params: { transferId: string } }>(
    '/bank/transfers/:transferId',
    {
      schema: {
        tags: ['bank'],
        summary: 'Get transfer by id',
      },
    },
    async (request) =>
      engine.transferPayload(engine.getTransfer(request.params.transferId)),
  );

  app.get<{ Params: { key: string } }>(
    '/bank/transfers/by-idempotency-key/:key',
    {
      schema: {
        tags: ['bank'],
        summary: 'Lookup transfer by idempotency key',
      },
    },
    async (request) =>
      engine.transferPayload(engine.getTransferByIdempotency(request.params.key)),
  );

  app.get<{ Params: { accountId: string; debitId: string } }>(
    '/bank/ordinary-accounts/:accountId/debits/:debitId',
    {
      schema: {
        tags: ['bank'],
        summary: 'Get ordinary-account debit (e.g. HELOC interest payment)',
      },
    },
    async (request) => {
      const debit = engine.getOrdinaryDebit(
        request.params.accountId,
        request.params.debitId,
      );
      return {
        ...debit,
        amountCents: debit.amountCents.toString(),
      };
    },
  );
}
