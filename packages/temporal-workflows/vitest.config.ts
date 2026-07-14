import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'temporal-workflows', environment: 'node', include: ['src/**/*.test.ts'] },
});
