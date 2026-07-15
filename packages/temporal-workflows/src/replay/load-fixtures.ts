import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { History } from '@temporalio/worker';

import { readHistoryFixture } from './history-codec.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../replay-fixtures');

export type ReplayFixtureMeta = {
  name: string;
  workflowType: string;
  description: string;
  capturedAt: string;
  workflowBundleVersion: string;
  historyFile: string;
};

export function listReplayFixtureMetas(): ReplayFixtureMeta[] {
  const manifestPath = join(FIXTURES_DIR, 'manifest.json');
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    fixtures: ReplayFixtureMeta[];
  };
  return raw.fixtures;
}

export function loadReplayHistory(historyFile: string): History {
  return readHistoryFixture(join(FIXTURES_DIR, historyFile));
}

export function assertFixturesPresent(): void {
  const metas = listReplayFixtureMetas();
  if (metas.length === 0) {
    throw new Error('replay-fixtures/manifest.json has no fixtures');
  }
  const files = new Set(readdirSync(FIXTURES_DIR));
  for (const meta of metas) {
    if (!files.has(meta.historyFile)) {
      throw new Error(`Missing replay fixture file: ${meta.historyFile}`);
    }
  }
}
