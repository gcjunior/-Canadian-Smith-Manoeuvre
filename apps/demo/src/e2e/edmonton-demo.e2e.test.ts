import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertConversionInvariants,
  countByType,
  createDemoHarness,
  DEMO,
  runEdmontonConversion,
  runEdmontonInterest,
  type DemoHarness,
} from './harness.js';
import { toCustomerCycleStatus } from '@csm/contracts';

describe('Edmonton deterministic demo (happy path)', () => {
  let harness: DemoHarness;

  beforeAll(async () => {
    harness = await createDemoHarness('edmonton-demo');
  }, 180_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('proves gated settlement, single draw/transfer/order, balanced ledger, Completed, interest from ordinary', async () => {
    const { result, initiateDrawAttempts } = await runEdmontonConversion(harness, {
      proveGates: true,
    });

    expect(result.outcome).toBe('COMPLETED');
    expect(result.drawAmountCents).toBe(DEMO.expectedInvestmentCents.toString());
    expect(initiateDrawAttempts).toBe(1);

    const invariants = await assertConversionInvariants(harness.prisma, harness.seed);
    expect(invariants.customerStatus).toBe('Completed');
    expect(invariants.drawAmountCents).toBe(DEMO.expectedInvestmentCents);
    expect(invariants.remainingCashCents).toBe(0n);

    // Retries must not duplicate money movements / orders
    expect(await countByType(harness.prisma, harness.seed.tenantId, 'HELOC_DRAW')).toBe(1);
    expect(
      await countByType(harness.prisma, harness.seed.tenantId, 'HELOC_TO_BROKERAGE_TRANSFER'),
    ).toBe(1);
    expect(await countByType(harness.prisma, harness.seed.tenantId, 'BROKERAGE_DEPOSIT')).toBe(1);
    expect(
      await harness.prisma.investmentOrder.count({ where: { tenantId: harness.seed.tenantId } }),
    ).toBe(1);

    // Provider evidence: exactly one draw
    expect(harness.bankEngine.getStore().draws.size).toBe(1);
    expect(harness.brokerageEngine.getStore().orders.size).toBe(1);

    const cycle = await harness.prisma.monthlyConversionCycle.findFirst({
      where: { tenantId: harness.seed.tenantId, strategyId: harness.seed.strategyId },
    });
    expect(cycle?.state).toBe('COMPLETED');
    expect(toCustomerCycleStatus(cycle!.state)).toBe('Completed');

    await runEdmontonInterest(harness);
  }, 300_000);
});
