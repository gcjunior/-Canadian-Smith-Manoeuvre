import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'bank-client',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
