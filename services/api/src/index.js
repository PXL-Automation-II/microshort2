import pino from 'pino';
import { env } from './env.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { createApp } from './app.js';

const logger = pino({ level: env.LOG_LEVEL });

if (env.MIGRATE_ON_START) {
  try {
    const applied = await migrate({ databaseUrl: env.DATABASE_URL, logger });
    logger.info({ applied: applied.length }, 'schema migrations checked');
  } catch (err) {
    logger.fatal({ err }, 'schema migration failed');
    process.exit(1);
  }
}

const app = createApp({ logger });
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, basePath: env.BASE_PATH || '/', publicBaseUrl: env.PUBLIC_BASE_URL }, 'api listening');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await pool.end().catch(() => {});
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
