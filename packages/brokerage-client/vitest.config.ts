import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'brokerage-client',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
