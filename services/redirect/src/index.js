import pino from 'pino';
import { env } from './env.js';
import { createApp } from './app.js';
import { createApiClient } from './api-client.js';
import { createSlugCache } from './cache.js';
import { createClickBuffer } from './clicks.js';

const logger = pino({ level: env.LOG_LEVEL });

const apiClient = createApiClient({
  baseUrl: env.API_URL,
  serviceToken: env.SERVICE_TOKEN,
  timeoutMs: env.API_TIMEOUT_MS,
  logger,
});

const cache = createSlugCache({
  ttlSeconds: env.CACHE_TTL_SECONDS,
  negativeTtlSeconds: env.CACHE_NEGATIVE_TTL_SECONDS,
  maxEntries: env.CACHE_MAX_ENTRIES,
});

const clicks = createClickBuffer({
  apiClient,
  flushIntervalMs: env.CLICK_FLUSH_INTERVAL_MS,
  batchSize: env.CLICK_BATCH_SIZE,
  maxBuffer: env.CLICK_MAX_BUFFER,
  logger,
});
clicks.start();

const app = createApp({ logger, apiClient, cache, clicks });
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, apiUrl: env.API_URL, cacheTtlSeconds: env.CACHE_TTL_SECONDS, cacheEnabled: cache.enabled }, 'redirect listening');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await clicks.stop();
    logger.info('closed cleanly');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('shutdown timed out, forcing exit');
    process.exit(1);
  }, 15_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
