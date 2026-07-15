/**
 * Example payloads for OpenAPI documentation generation.
 * Money is serialized as integer cent strings on the wire.
 */

export const openApiExamples = {
  tenantContext: {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    roles: ['CUSTOMER'],
  },
  strategySetupRequest: {
    name: 'Primary residence Smith Manoeuvre',
    timezone: 'America/Toronto',
    expectedPaymentDay: 1,
    mortgageAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    helocAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    bankAccountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    brokerageAccountId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    investmentPolicy: {
      symbol: 'VCN.TO',
      exchange: 'TSX',
      userMonthlyCapCents: '500000',
      allowFractionalShares: true,
    },
  },
  strategyActivationRequest: {
    acknowledgeRiskDisclosures: true,
  },
  strategyPauseRequest: {
    reason: 'Reconciliation mismatch on HELOC draw',
  },
  strategyResumeRequest: {
    clearanceNote: 'Operator verified ledger trail and cleared safety pause',
  },
  helocDrawRequest: {
    helocAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    amountCents: '125000',
    idempotencyKey: '99999999-9999-4999-8999-999999999999',
  },
  bankTransferRequest: {
    sourceAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    destinationAccountId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    amountCents: '125000',
    idempotencyKey: '88888888-8888-4888-8888-888888888888',
  },
  brokerageDepositRequest: {
    brokerageAccountId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    amountCents: '125000',
    idempotencyKey: '77777777-7777-4777-8777-777777777777',
  },
  notionalMarketOrderRequest: {
    brokerageAccountId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    symbol: 'VCN.TO',
    side: 'BUY',
    notionalCents: '125000',
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
  },
  providerWebhook: {
    provider: 'bank-sim',
    providerEventId: 'evt_mortgage_2026_07_01',
    eventType: 'mortgage.payment.settled',
    occurredAt: '2026-07-01T14:05:00.000Z',
    externalAccountId: 'sim-mortgage-t1',
    payload: {
      paymentPeriod: '2026-07',
      principalAmountCents: '125000',
      status: 'SETTLED',
    },
    signature: 'sha256=demo-signature',
  },
  apiErrorEnvelope: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Amount must be positive cents',
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
      details: { field: 'amountCents' },
      retryable: false,
    },
  },
  simulatorScenarioConfig: {
    scenarioId: 'happy-path-july-2026',
    mode: 'deterministic',
    paymentPeriod: '2026-07',
    mortgagePrincipalCents: '125000',
    helocAvailableCreditCents: '200000',
    settleAfterHours: 6,
    helocCreditLagHours: 6,
    etfSymbol: 'VCN.TO',
    fillPrice: '42.1500000000',
    failureMode: 'NONE',
  },
  monthlyCycleStatus: {
    id: '12121212-1212-4121-8121-121212121212',
    tenantId: '11111111-1111-4111-8111-111111111111',
    strategyId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    paymentPeriod: '2026-07',
    state: 'WAITING_FOR_MORTGAGE',
    mortgagePaymentId: null,
    principalRepaidCents: null,
    newlyAvailableCreditCents: null,
    drawAmountCents: null,
    correlationId: '550e8400-e29b-41d4-a716-446655440000',
    failureCode: null,
    failureMessage: null,
    startedAt: '2026-07-01T12:00:00.000Z',
    completedAt: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    version: 1,
  },
} as const;
