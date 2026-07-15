import { hostname } from 'node:os';

export type BuildInfo = {
  service: string;
  version: string;
  identity: string;
  nodeVersion: string;
  hostname: string;
  temporalNamespace?: string;
  temporalTaskQueue?: string;
  temporalAddress?: string;
  startedAt: string;
};

export function createBuildInfo(input: {
  service: string;
  version: string;
  temporalNamespace?: string;
  temporalTaskQueue?: string;
  temporalAddress?: string;
  identityOverride?: string;
}): BuildInfo {
  const host = hostname();
  const identity = input.identityOverride ?? `${input.service}@${host}:${input.version}`;
  return {
    service: input.service,
    version: input.version,
    identity,
    nodeVersion: process.version,
    hostname: host,
    ...(input.temporalNamespace !== undefined
      ? { temporalNamespace: input.temporalNamespace }
      : {}),
    ...(input.temporalTaskQueue !== undefined
      ? { temporalTaskQueue: input.temporalTaskQueue }
      : {}),
    ...(input.temporalAddress !== undefined ? { temporalAddress: input.temporalAddress } : {}),
    startedAt: new Date().toISOString(),
  };
}

export function healthPayload(
  build: BuildInfo,
  status: 'ok' | 'degraded' | 'error',
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status,
    service: build.service,
    version: build.version,
    identity: build.identity,
    build,
    ...extras,
  };
}
