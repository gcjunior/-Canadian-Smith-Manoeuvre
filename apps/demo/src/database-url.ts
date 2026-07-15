import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Matches docker-compose.yml / .env.example local Postgres. */
export const COMPOSE_DATABASE_URL =
  'postgresql://smith:smith@localhost:5432/smith_manoeuvre?schema=public';

function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

function readDatabaseUrlFromEnvFile(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = /^DATABASE_URL=(.*)$/.exec(trimmed);
    if (match) {
      const raw = match[1]!.trim();
      return raw.replace(/^['"]|['"]$/g, '');
    }
  }
  return undefined;
}

/**
 * Demo/CLI database URL resolution.
 *
 * Order:
 * 1. CSM_DATABASE_URL — explicit override
 * 2. DATABASE_URL from repo `.env` (if present)
 * 3. Compose local default
 *
 * We intentionally do NOT fall through to process.env.DATABASE_URL: many dev
 * shells export unrelated Postgres URLs (e.g. user `csm`) that break seeding.
 */
export function resolveDemoDatabaseUrl(): string {
  const explicit = process.env.CSM_DATABASE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const repoRoot =
    findRepoRoot(process.cwd()) ??
    findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  if (repoRoot) {
    const fromFile = readDatabaseUrlFromEnvFile(join(repoRoot, '.env'));
    if (fromFile) {
      return fromFile;
    }
  }

  return COMPOSE_DATABASE_URL;
}
