import { describe, expect, it, beforeEach } from 'vitest';

import { ALERT_CODES, emitAlert } from './alerts.js';
import { createLogger } from './logger.js';
import { csmMetrics, resetMetricsForTests, snapshotMetrics } from './metrics.js';
import {
  correlationMemo,
  extractCorrelationFromMemo,
  resolveCorrelationId,
} from './propagation.js';
import { redactObject } from './redact.js';
import { createCorrelationId, isValidCorrelationId } from './correlation.js';

describe('redaction', () => {
  it('redacts tokens, JWTs, secrets, full account numbers, and tax ids', () => {
    const redacted = redactObject({
      tenantId: 't1',
      accessToken: 'secret-token',
      authorization: 'Bearer abc',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature',
      webhookSigningSecret: 'hook-secret',
      accountNumber: '123456789012',
      sinNumber: '123456789',
      taxId: '987654321',
      amountCents: '100',
    });
    expect(redacted.accessToken).toBe('[REDACTED]');
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted.jwt).toBe('[REDACTED]');
    expect(redacted.webhookSigningSecret).toBe('[REDACTED]');
    expect(redacted.accountNumber).toBe('[REDACTED]');
    expect(redacted.sinNumber).toBe('[REDACTED]');
    expect(redacted.taxId).toBe('[REDACTED]');
    expect(redacted.amountCents).toBe('100');
    expect(redacted.tenantId).toBe('t1');
  });
});

describe('correlation propagation helpers', () => {
  it('preserves valid ids through memo and resolve', () => {
    const id = createCorrelationId();
    expect(isValidCorrelationId(id)).toBe(true);
    expect(extractCorrelationFromMemo(correlationMemo(id))).toBe(id);
    expect(resolveCorrelationId([undefined, 'nope', id])).toBe(id);
  });
});

describe('metrics and alerts', () => {
  beforeEach(() => {
    resetMetricsForTests();
  });

  it('records cycle and alert counters', () => {
    csmMetrics.cyclesStarted.add(1);
    csmMetrics.cyclesCompleted.add(1);
    csmMetrics.cyclesPaused.add(1, { code: 'TEST' });
    csmMetrics.webhookDuplicates.add(2);
    csmMetrics.reconciliationMismatches.add(1);
    csmMetrics.settlementWaitMs.record(1500);

    const logger = createLogger({ service: 'test', level: 'silent', pretty: false });
    emitAlert(logger, ALERT_CODES.FINANCIAL_UNKNOWN_STATE, {
      correlationId: createCorrelationId(),
      accessToken: 'should-not-matter',
    });

    const snap = snapshotMetrics();
    expect(snap.counters['csm_cycles_started']).toBe(1);
    expect(snap.counters['csm_cycles_completed']).toBe(1);
    expect(snap.counters['csm_webhook_duplicates']).toBe(2);
    expect(snap.counters[`csm_alerts_fired{code=${ALERT_CODES.FINANCIAL_UNKNOWN_STATE}}`]).toBe(1);
    expect(snap.histograms['csm_settlement_wait_duration_ms']?.count).toBe(1);
  });
});
