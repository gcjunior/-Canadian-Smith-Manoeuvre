import type { Logger } from '@csm/observability';

export interface PingActivityDeps {
  logger: Logger;
}

export function createPingActivities(deps: PingActivityDeps) {
  return {
    async pingActivity(message: string): Promise<string> {
      deps.logger.info({ message }, 'ping activity');
      return `activity-pong:${message}`;
    },
  };
}

export type PingActivities = ReturnType<typeof createPingActivities>;
