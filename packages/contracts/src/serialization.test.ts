import { describe, expect, it } from 'vitest';

import { helocAccountSchema, mortgageAccountSchema } from './accounts.js';
import { apiErrorEnvelopeSchema, toApiErrorEnvelope, AppError } from './errors.js';
import { serializeCadCents } from './money.js';
import { openApiExamples } from './openapi-examples.js';
import { strategySetupRequestSchema } from './strategy.js';
import { tenantContextSchema } from './tenant.js';
import { monthlyCycleStatusSchema } from './cycle.js';
import { simulatorScenarioConfigSchema } from './simulator.js';
import {
  BROKERAGE_CAPABILITIES,
  HELOC_CAPABILITIES,
  MORTGAGE_CAPABILITIES,
} from './capabilities.js';

describe('contract serialization', () => {
  it('parses OpenAPI examples for setup, tenant, cycle, simulator, errors', () => {
    expect(tenantContextSchema.parse(openApiExamples.tenantContext).tenantId).toBeDefined();
    expect(strategySetupRequestSchema.parse(openApiExamples.strategySetupRequest).name).toContain(
      'Smith',
    );
    expect(monthlyCycleStatusSchema.parse(openApiExamples.monthlyCycleStatus).state).toBe(
      'WAITING_FOR_MORTGAGE',
    );
    expect(simulatorScenarioConfigSchema.parse(openApiExamples.simulatorScenarioConfig).mode).toBe(
      'deterministic',
    );
    expect(apiErrorEnvelopeSchema.parse(openApiExamples.apiErrorEnvelope).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('round-trips money as integer cent strings for HTTP', () => {
    const request = strategySetupRequestSchema.parse(openApiExamples.strategySetupRequest);
    expect(request.investmentPolicy.userMonthlyCapCents).toBe(500000n);
    expect(serializeCadCents(request.investmentPolicy.userMonthlyCapCents)).toBe('500000');
  });

  it('builds a stable API error envelope with correlationId', () => {
    const envelope = toApiErrorEnvelope(
      new AppError({ code: 'NOT_FOUND', message: 'Strategy not found' }),
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(apiErrorEnvelopeSchema.parse(envelope)).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Strategy not found',
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
        retryable: false,
      },
    });
  });

  it('rejects unknown properties on strict HTTP strategy setup', () => {
    expect(() =>
      strategySetupRequestSchema.parse({
        ...openApiExamples.strategySetupRequest,
        prismaModel: { id: 'leak' },
      }),
    ).toThrow();
  });

  it('validates account capability embeddings', () => {
    const ts = '2026-07-01T12:00:00.000Z';
    expect(
      mortgageAccountSchema.parse({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenantId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        connectionId: '33333333-3333-4333-8333-333333333333',
        displayAlias: 'Mortgage',
        providerAccountId: 'sim-m',
        currencyCode: 'CAD',
        createdAt: ts,
        updatedAt: ts,
        version: 1,
        kind: 'MORTGAGE',
        outstandingPrincipalCents: '10000000',
        contractualPaymentCents: '240000',
        expectedPaymentDay: 1,
        capabilities: MORTGAGE_CAPABILITIES,
      }).kind,
    ).toBe('MORTGAGE');

    expect(
      helocAccountSchema.parse({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        tenantId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        connectionId: '33333333-3333-4333-8333-333333333333',
        displayAlias: 'HELOC',
        providerAccountId: 'sim-h',
        currencyCode: 'CAD',
        createdAt: ts,
        updatedAt: ts,
        version: 1,
        kind: 'HELOC',
        creditLimitCents: '20000000',
        balanceOwedCents: '0',
        availableCreditCents: '20000000',
        capabilities: HELOC_CAPABILITIES,
      }).capabilities.canDraw,
    ).toBe(true);

    expect(BROKERAGE_CAPABILITIES.supportsFractionalUnits).toBe(true);
  });
});
