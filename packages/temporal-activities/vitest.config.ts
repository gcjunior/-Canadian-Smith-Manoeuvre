import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'temporal-activities',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /** Shared Postgres wipe/provision — must not run files in parallel. */
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
