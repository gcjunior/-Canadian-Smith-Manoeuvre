import { z } from 'zod';

export const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export const logLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
  .default('info');

export const commonEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  SERVICE_NAME: z.string().min(1),
  SERVICE_VERSION: z.string().min(1).default('0.0.0'),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export const temporalEnvSchema = z.object({
  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('smith-manoeuvre'),
});

export const apiEnvSchema = commonEnvSchema
  .merge(databaseEnvSchema)
  .merge(temporalEnvSchema)
  .extend({
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3001),
    BANK_SIMULATOR_BASE_URL: z.string().url().default('http://localhost:3002'),
    BROKERAGE_SIMULATOR_BASE_URL: z.string().url().default('http://localhost:3003'),
    DEFAULT_TIMEZONE: z.string().min(1).default('America/Toronto'),
    PLATFORM_MONTHLY_DRAW_CAP_CENTS: z.coerce.bigint().positive().default(500_000n),
    STARTUP_DEPENDENCY_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  });

export const workerEnvSchema = commonEnvSchema
  .merge(databaseEnvSchema)
  .merge(temporalEnvSchema)
  .extend({
    BANK_SIMULATOR_BASE_URL: z.string().url().default('http://localhost:3002'),
    BROKERAGE_SIMULATOR_BASE_URL: z.string().url().default('http://localhost:3003'),
    STARTUP_DEPENDENCY_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  });

export const simulatorEnvSchema = commonEnvSchema.extend({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive(),
  WEBHOOK_SIGNING_SECRET: z.string().min(8).default('local-dev-webhook-secret'),
  WEBHOOK_TARGET_URL: z.string().url().optional(),
  WEBHOOKS_ENABLED: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(true),
});

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3001'),
  NEXT_PUBLIC_SHOW_RISK_DISCLOSURES: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(true),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type SimulatorEnv = z.infer<typeof simulatorEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  return apiEnvSchema.parse({ ...env, SERVICE_NAME: env.SERVICE_NAME ?? 'api' });
}

export function parseWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return workerEnvSchema.parse({ ...env, SERVICE_NAME: env.SERVICE_NAME ?? 'worker' });
}

export function parseSimulatorEnv(
  env: NodeJS.ProcessEnv,
  defaults: { serviceName: string; port: number },
): SimulatorEnv {
  return simulatorEnvSchema.parse({
    ...env,
    SERVICE_NAME: env.SERVICE_NAME ?? defaults.serviceName,
    PORT: env.PORT ?? String(defaults.port),
  });
}
