import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runner } from 'node-pg-migrate';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

// Applies pending migrations from src/migrations. node-pg-migrate takes a
// Postgres advisory lock, and advisoryLockMode 'wait' makes a second replica
// that starts at the same moment wait for the first instead of failing —
// so MIGRATE_ON_START=true is safe with several api instances.
export async function migrate({ databaseUrl, logger = console }) {
  return runner({
    databaseUrl,
    dir: migrationsDir,
    migrationsTable: 'schema_migrations',
    direction: 'up',
    checkOrder: true,
    advisoryLockMode: 'wait',
    logger: {
      debug: msg => logger.debug?.(msg),
      info:  msg => logger.info(msg),
      warn:  msg => logger.warn(msg),
      error: msg => logger.error(msg),
    },
  });
}

// `node src/migrate.js` — explicit migration step for pipelines that set
// MIGRATE_ON_START=false. Needs only DATABASE_URL.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  migrate({ databaseUrl })
    .then(applied => {
      console.log(`migrations applied: ${applied.length}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('migration failed:', err.message);
      process.exit(1);
    });
}
