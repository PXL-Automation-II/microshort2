import { defineConfig } from 'vitest/config';

// Integration tests run against a LIVE stack (compose by default). Base URLs
// come from the environment so the same suite doubles as a post-deployment
// smoke test — see tests/integration/helpers.js.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.js'],
    exclude: ['tests/integration/rate-limiting.test.js', '**/node_modules/**'],   // see vitest.rate.config.js
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
