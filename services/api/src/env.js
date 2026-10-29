import { cleanEnv, str, port, num, bool, url } from 'envalid';
import { trustedProxyProblems } from './env-checks.js';

// Configuration contract for api. Anything without a default is REQUIRED and
// the process exits with a message naming the variable when it is missing.
// There are deliberately no defaults for URLs or secrets: a half-wired
// deployment must fail loudly, not "work" on a compose-only assumption.
export const env = cleanEnv(process.env, {
  DATABASE_URL:     str({ desc: 'postgres://user:password@host:5432/database' }),
  JWT_SECRET:       str({ desc: 'Secret used to sign JWTs (>= 32 characters)' }),
  SERVICE_TOKEN:    str({ desc: 'Shared secret for X-Service-Token calls from redirect (>= 16 characters)' }),
  PUBLIC_BASE_URL:  url({ desc: 'Base of generated short URLs, e.g. https://sho.rt — the redirect service must answer there' }),
  ALLOWED_ORIGINS:  str({ desc: 'Comma-separated CORS allow-list for the dashboard origin, or "*"' }),

  PORT:             port({ default: 3000 }),
  BASE_PATH:        str({ default: '', desc: 'Optional mount prefix such as /api when behind a path-routing proxy' }),
  LOG_LEVEL:        str({ default: 'info', choices: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] }),
  TRUST_PROXY:      str({ default: 'false', desc: 'Express trust proxy: false, true, hop count, or CIDR list' }),

  DB_POOL_SIZE:     num({ default: 10 }),
  MIGRATE_ON_START: bool({ default: true, desc: 'Run pending schema migrations before listening' }),

  JWT_EXPIRES_IN:           str({ default: '1h' }),
  REFRESH_TOKEN_EXPIRES_IN: str({ default: '7d' }),
  BCRYPT_COST:              num({ default: 10 }),

  LOGIN_RATE_LIMIT_WINDOW_MS:      num({ default: 15 * 60 * 1000 }),
  LOGIN_RATE_LIMIT_MAX:            num({ default: 10 }),
  REGISTER_RATE_LIMIT_WINDOW_MS:   num({ default: 15 * 60 * 1000 }),
  REGISTER_RATE_LIMIT_MAX:         num({ default: 100 }),
  URL_CREATE_RATE_LIMIT_WINDOW_MS: num({ default: 60 * 1000 }),
  URL_CREATE_RATE_LIMIT_MAX:       num({ default: 60 }),

  HEALTH_TARGETS:      str({ default: '', desc: 'Optional comma-separated name=url pairs probed by GET /admin/health/services' }),
  UPSTREAM_TIMEOUT_MS: num({ default: 2000 }),

  // Single sign-on through a trusted proxy (contract section 4a). Off by default.
  AUTH_TRUSTED_PROXY:        str({ default: '', choices: ['', 'alb'], desc: '"alb": trust the signed x-amzn-oidc-data header of an AWS ALB on GET /auth/sso' }),
  AUTH_TRUSTED_PROXY_SIGNER: str({ default: '', desc: 'ARN of the load balancer whose signature is trusted (required in alb mode)' }),
  AUTH_TRUSTED_PROXY_ADMINS: str({ default: '', desc: 'Comma-separated e-mail addresses that become admin when they sign in through the proxy (required in alb mode)' }),
});

const problems = [];
if (env.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be at least 32 characters');
if (env.SERVICE_TOKEN.length < 16) problems.push('SERVICE_TOKEN must be at least 16 characters');
if (env.BASE_PATH && !env.BASE_PATH.startsWith('/')) problems.push('BASE_PATH must start with "/"');
if (env.BASE_PATH.endsWith('/')) problems.push('BASE_PATH must not end with "/"');
if (env.isProduction) {
  for (const name of ['JWT_SECRET', 'SERVICE_TOKEN', 'DATABASE_URL']) {
    if (env[name].includes('change-me')) problems.push(`${name} still contains a placeholder value`);
  }
}
for (const pair of env.HEALTH_TARGETS.split(',').map(s => s.trim()).filter(Boolean)) {
  const idx = pair.indexOf('=');
  if (idx < 1 || !/^https?:\/\//.test(pair.slice(idx + 1))) {
    problems.push(`HEALTH_TARGETS entry "${pair}" must be name=http(s)://host[:port]`);
  }
}
problems.push(...trustedProxyProblems(env));
if (problems.length > 0) {
  console.error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
  process.exit(1);
}

// Express accepts boolean, number or string for trust proxy.
export function parseTrustProxy(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

export function parseAllowedOrigins(value) {
  if (value.trim() === '*') return '*';
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

export function parseHealthTargets(value) {
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const idx = pair.indexOf('=');   // validated at startup above
      return { name: pair.slice(0, idx), url: pair.slice(idx + 1).replace(/\/+$/, '') };
    });
}
