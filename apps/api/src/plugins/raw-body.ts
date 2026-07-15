import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Capture raw body for webhook signature verification.
 * Must run before JSON parsing for webhook routes.
 */
const rawBodyPlugin: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body as string);
    (request as { rawBody?: Buffer }).rawBody = buffer;
    try {
      // Empty bodies are valid for POSTs that send Content-Type: application/json
      // without a payload (e.g. onboarding "Connect brokerage").
      if (buffer.length === 0) {
        done(null, null);
        return;
      }
      const json = JSON.parse(buffer.toString('utf8')) as unknown;
      done(null, json);
    } catch (error) {
      done(error as Error, undefined);
    }
  });
};

export function verifyHmacSha256(
  rawBody: Buffer,
  secret: string,
  signatureHeader: string,
): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const provided = signatureHeader.trim();
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export default fp(rawBodyPlugin, { name: 'raw-body' });
