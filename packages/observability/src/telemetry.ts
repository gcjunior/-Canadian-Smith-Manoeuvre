import {
  metrics,
  trace,
  type Counter,
  type Histogram,
  type Meter,
  type Tracer,
} from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export type TelemetryInitOptions = {
  serviceName: string;
  serviceVersion?: string;
  /** When set, exports OTLP HTTP traces/metrics. When omitted, local metrics still record in-process. */
  otlpEndpoint?: string;
  enabled?: boolean;
};

let meterProvider: MeterProvider | undefined;
let tracerProvider: NodeTracerProvider | undefined;
let initialized = false;

export async function initTelemetry(options: TelemetryInitOptions): Promise<void> {
  if (initialized || options.enabled === false) {
    return;
  }
  initialized = true;

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: options.serviceName,
    [ATTR_SERVICE_VERSION]: options.serviceVersion ?? '0.0.0',
  });

  const endpoint = options.otlpEndpoint?.replace(/\/$/, '');
  meterProvider = new MeterProvider({
    resource,
    ...(endpoint
      ? {
          readers: [
            new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter({
                url: `${endpoint}/v1/metrics`,
                temporalityPreference: AggregationTemporality.CUMULATIVE,
              }),
              exportIntervalMillis: 15_000,
            }),
          ],
        }
      : {}),
  });
  metrics.setGlobalMeterProvider(meterProvider);

  if (endpoint) {
    tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: `${endpoint}/v1/traces`,
          }),
        ),
      ],
    });
    tracerProvider.register();
  }
}

export async function shutdownTelemetry(): Promise<void> {
  await Promise.allSettled([meterProvider?.shutdown(), tracerProvider?.shutdown()]);
  meterProvider = undefined;
  tracerProvider = undefined;
  initialized = false;
}

export function getMeter(name = 'csm'): Meter {
  return metrics.getMeter(name);
}

export function getTracer(name = 'csm'): Tracer {
  return trace.getTracer(name);
}

export function createCounter(name: string, description: string): Counter {
  return getMeter().createCounter(name, { description });
}

export function createHistogram(name: string, description: string): Histogram {
  return getMeter().createHistogram(name, { description, unit: 'ms' });
}
