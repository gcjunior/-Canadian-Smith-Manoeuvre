import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPrismaClient,
  createRepositories,
  disconnectPrisma,
  type PrismaClient,
  type Repositories,
} from '@csm/database';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';

describe('cross-tenant provider ID reuse', () => {
  let prisma: PrismaClient;
  let repos: Repositories;

  beforeAll(() => {
    prisma = createPrismaClient(DATABASE_URL);
    repos = createRepositories(prisma);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('SELECT pg_advisory_lock(88224402)');
    try {
      await prisma.providerWebhookEvent.deleteMany();
    } finally {
      await prisma.$executeRawUnsafe('SELECT pg_advisory_unlock(88224402)');
    }
  });

  it('allows same providerEventId in different tenants and keeps them isolated', async () => {
    const a = await repos.tenants.create({ slug: `a-${randomUUID().slice(0, 8)}`, name: 'A' });
    const b = await repos.tenants.create({ slug: `b-${randomUUID().slice(0, 8)}`, name: 'B' });
    const sharedProviderEventId = `provider-shared-${randomUUID()}`;

    await repos.webhooks.create(a.id, {
      provider: 'BANK',
      providerEventId: sharedProviderEventId,
      eventType: 'mortgage.payment.updated',
      payloadRedacted: { ok: true },
    });
    await repos.webhooks.create(b.id, {
      provider: 'BANK',
      providerEventId: sharedProviderEventId,
      eventType: 'mortgage.payment.updated',
      payloadRedacted: { ok: true },
    });

    const foundA = await repos.webhooks.findByProviderEvent(a.id, 'BANK', sharedProviderEventId);
    const foundB = await repos.webhooks.findByProviderEvent(b.id, 'BANK', sharedProviderEventId);
    expect(foundA?.tenantId).toBe(a.id);
    expect(foundB?.tenantId).toBe(b.id);
    expect(foundA?.id).not.toBe(foundB?.id);
  });

  it('rejects duplicate providerEventId within the same tenant', async () => {
    const tenant = await repos.tenants.create({
      slug: `dup-${randomUUID().slice(0, 8)}`,
      name: 'Dup',
    });
    const providerEventId = `same-event-${randomUUID()}`;
    await repos.webhooks.create(tenant.id, {
      provider: 'BANK',
      providerEventId,
      eventType: 'mortgage.payment.updated',
      payloadRedacted: { ok: true },
    });
    await expect(
      repos.webhooks.create(tenant.id, {
        provider: 'BANK',
        providerEventId,
        eventType: 'mortgage.payment.updated',
        payloadRedacted: { ok: true },
      }),
    ).rejects.toThrow();
  });
});
