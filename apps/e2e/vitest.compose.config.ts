import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'e2e-compose',
    environment: 'node',
    include: ['src/**/*.compose.test.ts'],
    testTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
