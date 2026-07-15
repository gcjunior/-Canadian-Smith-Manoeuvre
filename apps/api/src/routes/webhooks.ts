import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '@csm/contracts';

import type { WebhookAppService } from '../services/webhook-app-service.js';

function signatureFromRequest(
  request: { headers: Record<string, string | string[] | undefined> },
  provider: 'bank' | 'brokerage',
): string | undefined {
  const key = provider === 'bank' ? 'x-bank-sim-signature' : 'x-brokerage-sim-signature';
  const value = request.headers[key] ?? request.headers['x-webhook-signature'];
  return Array.isArray(value) ? value[0] : value;
}

export const webhookRoutes: FastifyPluginAsync<{ webhooks: WebhookAppService }> = async (
  app,
  deps,
) => {
  app.post('/webhooks/bank', async (request, reply) => {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new AppError({
        code: 'MALFORMED_WEBHOOK',
        message: 'Missing raw body for signature verification',
        correlationId: request.correlationId,
      });
    }
    const external =
      request.headers['x-csm-external-account-id'] ?? request.headers['x-external-account-id'];
    const result = await deps.webhooks.ingest({
      provider: 'bank-sim',
      rawBody,
      signatureHeader: signatureFromRequest(request, 'bank'),
      externalAccountIdHeader: Array.isArray(external) ? external[0] : external,
      correlationId: request.correlationId,
    });
    return reply.code(202).send(result);
  });

  app.post('/webhooks/brokerage', async (request, reply) => {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new AppError({
        code: 'MALFORMED_WEBHOOK',
        message: 'Missing raw body for signature verification',
        correlationId: request.correlationId,
      });
    }
    const external =
      request.headers['x-csm-external-account-id'] ?? request.headers['x-external-account-id'];
    const result = await deps.webhooks.ingest({
      provider: 'brokerage-sim',
      rawBody,
      signatureHeader: signatureFromRequest(request, 'brokerage'),
      externalAccountIdHeader: Array.isArray(external) ? external[0] : external,
      correlationId: request.correlationId,
    });
    return reply.code(202).send(result);
  });
};
