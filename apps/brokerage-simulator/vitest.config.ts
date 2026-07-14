import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'brokerage-simulator', environment: 'node', include: ['src/**/*.test.ts'] },
});
