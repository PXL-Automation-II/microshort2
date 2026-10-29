import pg from 'pg';
import { env } from './env.js';
import { dbQueryDuration, dbPoolGauges } from './metrics.js';

const { Pool } = pg;

// Return BIGINT/BIGSERIAL as JS numbers (safe for teaching-scale IDs/counters).
pg.types.setTypeParser(20, value => Number(value));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_SIZE,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', err => {
  // Idle client errors (e.g. DB restarted). The pool discards the client.
  console.error('postgres pool error', err.message);
});

dbPoolGauges(() => ({
  total: pool.totalCount,
  idle: pool.idleCount,
  waiting: pool.waitingCount,
}));

// Every query goes through here so it is timed for /metrics.
export async function query(text, params = [], label = 'query') {
  const end = dbQueryDuration.startTimer({ op: label });
  try {
    return await pool.query(text, params);
  } finally {
    end();
  }
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function ping() {
  await pool.query('SELECT 1');
}

export const UNIQUE_VIOLATION = '23505';
