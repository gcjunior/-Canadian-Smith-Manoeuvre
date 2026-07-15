import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'demo',
    environment: 'node',
    include: ['src/**/*.e2e.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    testTimeout: 300_000,
    hookTimeout: 180_000,
  },
});
