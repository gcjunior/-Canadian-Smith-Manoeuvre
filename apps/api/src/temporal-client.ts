import { Connection, Client } from '@temporalio/client';
import type { Logger } from '@csm/observability';

export interface TemporalClientConfig {
  address: string;
  namespace: string;
  logger: Logger;
}

export async function createTemporalClient(config: TemporalClientConfig): Promise<Client> {
  config.logger.info({ address: config.address }, 'connecting temporal client');
  const connection = await Connection.connect({ address: config.address });
  return new Client({ connection, namespace: config.namespace });
}

export async function checkTemporalClient(client: Client): Promise<void> {
  // Lightweight connectivity check against the workflow service.
  await client.workflowService.getSystemInfo({});
}
