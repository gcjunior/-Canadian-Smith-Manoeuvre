import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@temporalio/client';

import { BankClient } from '@csm/bank-client';
import { BrokerageClient } from '@csm/brokerage-client';
import { parseApiEnv } from '@csm/contracts';
import { CORRELATION_ID_HEADER, createLogger } from '@csm/observability';

import { buildApiApp } from './app.js';

describe('API health', () => {
  it('returns health payload with correlation id', async () => {
    const env = parseApiEnv({
      DATABASE_URL: 'postgresql://smith:smith@localhost:5432/smith_manoeuvre',
      SERVICE_NAME: 'api',
    });
    const logger = createLogger({ service: 'api', level: 'fatal', pretty: false });
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const temporal = {
      workflowService: {
        getSystemInfo: vi.fn().mockResolvedValue({}),
      },
      connection: { close: vi.fn() },
    } as unknown as Client;

    const app = await buildApiApp({
      env,
      logger,
      prisma: prisma as never,
      temporal,
      bankClient: new BankClient({ baseUrl: 'http://localhost:3002', logger }),
      brokerageClient: new BrokerageClient({ baseUrl: 'http://localhost:3003', logger }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { [CORRELATION_ID_HEADER]: '550e8400-e29b-41d4-a716-446655440000' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'api',
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
    });
    await app.close();
  });
});
