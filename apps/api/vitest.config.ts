import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Postgres-backed service tests share one DB; avoid parallel fixture races.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
