import { defineConfig } from 'vitest/config';

// Rate-limit suite only. Needs the stack started with compose.test.override.yml.
export default defineConfig({
  test: {
    include: ['tests/integration/rate-limiting.test.js'],
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
