import { cleanEnv, str, port, num, url } from 'envalid';

// Configuration contract for redirect. No defaults for the api URL or the
// service token: a misconfigured deployment must fail at startup.
export const env = cleanEnv(process.env, {
  API_URL:       url({ desc: 'Base URL of the api service as reachable from THIS service, e.g. http://10.0.1.5:3000 or http://api:3000' }),
  SERVICE_TOKEN: str({ desc: 'Shared secret sent as X-Service-Token to api (>= 16 characters)' }),

  PORT:          port({ default: 8080 }),
  LOG_LEVEL:     str({ default: 'info', choices: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] }),
  TRUST_PROXY:   str({ default: 'false', desc: 'Express trust proxy: false, true, hop count, or CIDR list' }),

  // Cache: the per-replica scaling lesson. 0 disables caching entirely.
  CACHE_TTL_SECONDS:          num({ default: 60 }),
  CACHE_NEGATIVE_TTL_SECONDS: num({ default: 10, desc: 'How long an unknown slug is remembered as 404' }),
  CACHE_MAX_ENTRIES:          num({ default: 10_000 }),

  // Click events: buffered, batched, at-most-once.
  CLICK_FLUSH_INTERVAL_MS: num({ default: 5_000 }),
  CLICK_BATCH_SIZE:        num({ default: 200 }),
  CLICK_MAX_BUFFER:        num({ default: 10_000, desc: 'Oldest events are dropped beyond this' }),
  IP_HASH_SALT:            str({ default: '', desc: 'Extra salt for hashing visitor IPs; a daily salt is always applied' }),

  API_TIMEOUT_MS: num({ default: 2_000 }),
});

const problems = [];
if (env.SERVICE_TOKEN.length < 16) problems.push('SERVICE_TOKEN must be at least 16 characters');
if (env.CACHE_TTL_SECONDS < 0) problems.push('CACHE_TTL_SECONDS must be >= 0');
if (env.isProduction && env.SERVICE_TOKEN.includes('change-me')) problems.push('SERVICE_TOKEN still contains a placeholder value');
if (problems.length > 0) {
  console.error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
  process.exit(1);
}

export function parseTrustProxy(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
