import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'bank-simulator', environment: 'node', include: ['src/**/*.test.ts'] },
});
