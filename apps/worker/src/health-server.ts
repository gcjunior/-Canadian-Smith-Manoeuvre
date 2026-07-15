import http from 'node:http';

import type { BuildInfo } from '@csm/observability';
import { healthPayload, snapshotMetrics } from '@csm/observability';

export type HealthServerDeps = {
  build: BuildInfo;
  workflowBundleVersion: string;
  checkReady: () => Promise<void>;
};

export function startHealthServer(port: number, deps: HealthServerDeps): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url?.split('?')[0] ?? '';
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url === '/health') {
      send(
        200,
        healthPayload(deps.build, 'ok', {
          workflowBundleVersion: deps.workflowBundleVersion,
        }),
      );
      return;
    }
    if (url === '/ready') {
      void deps
        .checkReady()
        .then(() =>
          send(
            200,
            healthPayload(deps.build, 'ok', {
              ready: true,
              workflowBundleVersion: deps.workflowBundleVersion,
            }),
          ),
        )
        .catch((error: unknown) =>
          send(
            503,
            healthPayload(deps.build, 'error', {
              ready: false,
              detail: error instanceof Error ? error.message : 'not ready',
              workflowBundleVersion: deps.workflowBundleVersion,
            }),
          ),
        );
      return;
    }
    if (url === '/metrics') {
      send(200, snapshotMetrics());
      return;
    }
    if (url === '/build') {
      send(200, {
        ...deps.build,
        workflowBundleVersion: deps.workflowBundleVersion,
      });
      return;
    }
    send(404, { status: 'error', message: 'not found' });
  });
  server.listen(port, '0.0.0.0');
  return server;
}
