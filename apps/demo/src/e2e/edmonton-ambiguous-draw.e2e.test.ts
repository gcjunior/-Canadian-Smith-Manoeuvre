import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertConversionInvariants,
  createDemoHarness,
  DEMO,
  runEdmontonConversion,
  type DemoHarness,
} from './harness.js';

describe('Edmonton demo — ambiguous HELOC draw (TIMEOUT_AFTER_SUCCESS)', () => {
  let harness: DemoHarness;

  beforeAll(async () => {
    harness = await createDemoHarness('edmonton-ambiguous-draw');
  }, 180_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('discovers the existing draw by idempotency key and does not submit another', async () => {
    const { result, initiateDrawAttempts } = await runEdmontonConversion(harness, {
      proveGates: false,
    });

    expect(result.outcome).toBe('COMPLETED');
    expect(result.drawAmountCents).toBe(DEMO.expectedInvestmentCents.toString());

    // Ambiguous POST still counts as a single initiation attempt; resolve path must not re-POST.
    expect(initiateDrawAttempts).toBe(1);
    expect(harness.bankEngine.getStore().draws.size).toBe(1);

    const draws = await harness.prisma.moneyMovement.findMany({
      where: { tenantId: harness.seed.tenantId, type: 'HELOC_DRAW' },
    });
    expect(draws).toHaveLength(1);
    expect(draws[0]!.state).toBe('SETTLED');

    await assertConversionInvariants(harness.prisma, harness.seed);
  }, 300_000);
});
