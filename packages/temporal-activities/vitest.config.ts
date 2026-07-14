import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'temporal-activities', environment: 'node', include: ['src/**/*.test.ts'] },
});
