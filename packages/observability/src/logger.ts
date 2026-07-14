import { pino, stdTimeFunctions, type Logger, type LoggerOptions } from 'pino';

import { createCorrelationId } from './correlation.js';
import { redactObject } from './redact.js';

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  version?: string;
  correlationId?: string;
  pretty?: boolean;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const correlationId = options.correlationId ?? createCorrelationId();
  const base: LoggerOptions = {
    level: options.level ?? 'info',
    base: {
      service: options.service,
      version: options.version ?? '0.0.0',
      correlationId,
    },
    timestamp: stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
      log(object) {
        return redactObject(object);
      },
    },
    messageKey: 'message',
  };

  if (options.pretty === true) {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, singleLine: true },
      },
    });
  }

  // Always emit JSON to stdout in containers / default mode.
  return pino(base);
}

export type { Logger };
