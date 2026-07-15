import type { Attributes, Counter, Histogram, UpDownCounter } from '@opentelemetry/api';

import { createCounter, createHistogram, getMeter } from './telemetry.js';

/** In-process mirror for /metrics JSON scrape without requiring an OTLP collector. */
const localCounters = new Map<string, number>();
const localGauges = new Map<string, number>();
const localHistograms = new Map<string, number[]>();

function localKey(name: string, attrs?: Attributes): string {
  if (!attrs || Object.keys(attrs).length === 0) return name;
  const parts = Object.entries(attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`);
  return `${name}{${parts.join(',')}}`;
}

function bumpLocal(name: string, attrs: Attributes | undefined, delta: number): void {
  const key = localKey(name, attrs);
  localCounters.set(key, (localCounters.get(key) ?? 0) + delta);
}

function observeLocal(name: string, attrs: Attributes | undefined, value: number): void {
  const key = localKey(name, attrs);
  const series = localHistograms.get(key) ?? [];
  series.push(value);
  if (series.length > 500) series.shift();
  localHistograms.set(key, series);
}

type InstrumentedCounter = {
  add(value: number, attrs?: Attributes): void;
};

type InstrumentedHistogram = {
  record(value: number, attrs?: Attributes): void;
};

type InstrumentedGauge = {
  add(value: number, attrs?: Attributes): void;
  set(value: number, attrs?: Attributes): void;
};

function wrapCounter(name: string, description: string): InstrumentedCounter {
  let otel: Counter | undefined;
  try {
    otel = createCounter(name, description);
  } catch {
    otel = undefined;
  }
  return {
    add(value, attrs) {
      bumpLocal(name, attrs, value);
      otel?.add(value, attrs);
    },
  };
}

function wrapHistogram(name: string, description: string): InstrumentedHistogram {
  let otel: Histogram | undefined;
  try {
    otel = createHistogram(name, description);
  } catch {
    otel = undefined;
  }
  return {
    record(value, attrs) {
      observeLocal(name, attrs, value);
      otel?.record(value, attrs);
    },
  };
}

function wrapGauge(name: string, description: string): InstrumentedGauge {
  let otel: UpDownCounter | undefined;
  try {
    otel = getMeter().createUpDownCounter(name, { description });
  } catch {
    otel = undefined;
  }
  return {
    add(value, attrs) {
      const key = localKey(name, attrs);
      const next = (localGauges.get(key) ?? 0) + value;
      localGauges.set(key, next);
      otel?.add(value, attrs);
    },
    set(value, attrs) {
      const key = localKey(name, attrs);
      const prev = localGauges.get(key) ?? 0;
      const delta = value - prev;
      localGauges.set(key, value);
      if (delta !== 0) otel?.add(delta, attrs);
    },
  };
}

export const csmMetrics = {
  activeStrategies: wrapGauge('csm_active_strategies', 'Active automation strategies'),
  cyclesStarted: wrapCounter('csm_cycles_started', 'Monthly conversion cycles started'),
  cyclesCompleted: wrapCounter('csm_cycles_completed', 'Monthly conversion cycles completed'),
  cyclesPaused: wrapCounter('csm_cycles_paused', 'Cycles paused for operational/safety reasons'),
  settlementWaitMs: wrapHistogram(
    'csm_settlement_wait_duration_ms',
    'Time waiting for mortgage settlement',
  ),
  helocReadvanceWaitMs: wrapHistogram(
    'csm_heloc_readvance_wait_duration_ms',
    'Time waiting for HELOC readvance credit',
  ),
  transferDurationMs: wrapHistogram(
    'csm_transfer_duration_ms',
    'Brokerage transfer + deposit confirmation duration',
  ),
  orderFillDurationMs: wrapHistogram(
    'csm_order_fill_duration_ms',
    'Investment order fill confirmation duration',
  ),
  activityRetries: wrapCounter('csm_activity_retries', 'Activity attempts that required retry'),
  ambiguousProviderOutcomes: wrapCounter(
    'csm_ambiguous_provider_outcomes',
    'Provider calls that returned AMBIGUOUS_RESULT / UNKNOWN',
  ),
  webhookDuplicates: wrapCounter('csm_webhook_duplicates', 'Duplicate inbound provider webhooks'),
  reconciliationMismatches: wrapCounter(
    'csm_reconciliation_mismatches',
    'Failed financial reconciliations',
  ),
  interestPaymentFailures: wrapCounter(
    'csm_interest_payment_failures',
    'HELOC interest debit/payment failures',
  ),
  scheduleReconciliationFailures: wrapCounter(
    'csm_schedule_reconciliation_failures',
    'Strategy Temporal Schedule reconciliation failures',
  ),
  alertsFired: wrapCounter('csm_alerts_fired', 'Operational alerts emitted'),
  apiRequests: wrapCounter('csm_api_requests', 'API HTTP requests'),
  providerRequests: wrapCounter(
    'csm_provider_requests',
    'Outbound bank/brokerage simulator requests',
  ),
};

export function snapshotMetrics(): {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, { count: number; sum: number; avg: number }>;
} {
  const histograms: Record<string, { count: number; sum: number; avg: number }> = {};
  for (const [key, values] of localHistograms.entries()) {
    const sum = values.reduce((a, b) => a + b, 0);
    histograms[key] = {
      count: values.length,
      sum,
      avg: values.length === 0 ? 0 : sum / values.length,
    };
  }
  return {
    counters: Object.fromEntries(localCounters.entries()),
    gauges: Object.fromEntries(localGauges.entries()),
    histograms,
  };
}

/** Test helper */
export function resetMetricsForTests(): void {
  localCounters.clear();
  localGauges.clear();
  localHistograms.clear();
}
