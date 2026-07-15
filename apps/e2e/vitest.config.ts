import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'e2e',
    environment: 'node',
    // Exclude `.compose.test.ts` from the default suite — those are gated via test:compose.
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.compose.test.ts'],
    testTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
