import { describe, expect, it } from 'vitest';

import { FAILURE_MODE_CATALOGUE } from '@csm/test-support';

describe('e2e package smoke', () => {
  it('exposes the failure-mode catalogue for matrix coverage', () => {
    expect(FAILURE_MODE_CATALOGUE.length).toBeGreaterThan(40);
    expect(FAILURE_MODE_CATALOGUE).toContain('settlement.never');
    expect(FAILURE_MODE_CATALOGUE).toContain('recon.ledger_imbalance');
  });
});
