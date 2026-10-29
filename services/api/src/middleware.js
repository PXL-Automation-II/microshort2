import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { env } from './env.js';
import { query } from './db.js';
import { hashKey, isValidApiKeyFormat, safeTokenEqual } from './utils.js';
import { authFailuresTotal } from './metrics.js';

// ---- JWT (end users) -------------------------------------------------------

export function signTokens(user) {
  const payload = { userId: user.id, role: user.role };
  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
  const refreshToken = jwt.sign({ ...payload, type: 'refresh' }, env.JWT_SECRET, { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN });
  return { token, refreshToken };
}

export function requireJwt(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (payload.type === 'refresh') throw new Error('refresh token used as access token');
    req.user = { id: payload.userId, role: payload.role };
    next();
  } catch {
    authFailuresTotal.inc({ kind: 'jwt' });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ---- API keys (scripts, tools, dashboard) ----------------------------------

export async function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!isValidApiKeyFormat(key)) {
    authFailuresTotal.inc({ kind: 'api_key' });
    return res.status(401).json({ error: 'Missing or malformed X-API-Key' });
  }
  const { rows } = await query(
    `SELECT k.id AS key_id, u.id, u.email, u.role
       FROM api_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [hashKey(key)],
    'api_key_lookup',
  );
  if (rows.length === 0) {
    authFailuresTotal.inc({ kind: 'api_key' });
    return res.status(401).json({ error: 'Invalid or revoked API key' });
  }
  const row = rows[0];
  req.user = { id: row.id, email: row.email, role: row.role, keyId: row.key_id };
  // Off the hot path: nobody waits for last_used_at.
  query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.key_id], 'api_key_touch')
    .catch(err => req.log?.warn({ err }, 'last_used_at update failed'));
  next();
}

// Admin routes take either credential: an admin's API key (scripts, the
// dashboard's key login) or an admin's bearer token (the dashboard after a
// single sign-on, contract section 4a). A bearer token wins when both are sent.
export function requireAdmin(req, res, next) {
  const authenticate = req.headers.authorization ? requireJwt : requireApiKey;
  // Return the promise so Express 5 forwards a rejected DB query to the error handler.
  return authenticate(req, res, err => {
    if (err) return next(err);
    if (req.user.role !== 'admin') {
      authFailuresTotal.inc({ kind: req.headers.authorization ? 'jwt' : 'api_key' });
      return res.status(403).json({ error: 'Admin role required' });
    }
    next();
  });
}

// ---- Service token (redirect -> api) ---------------------------------------

export function requireServiceToken(req, res, next) {
  const token = req.headers['x-service-token'];
  if (!safeTokenEqual(token || '', env.SERVICE_TOKEN)) {
    authFailuresTotal.inc({ kind: 'service_token' });
    return res.status(401).json({ error: 'Invalid service token' });
  }
  next();
}

// ---- Rate limits (in-process, per replica — a documented scaling lesson) ---

const limiterDefaults = {
  standardHeaders: 'draft-8',   // RateLimit + RateLimit-Policy headers (IETF draft 8)
  legacyHeaders: false,
};

export const loginLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  message: { error: 'Too many login attempts, please try again later' },
});

// Registration gets its own, looser budget: sharing the login limiter made
// repeated test runs from one machine fail with 429.
export const registerLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: env.REGISTER_RATE_LIMIT_WINDOW_MS,
  limit: env.REGISTER_RATE_LIMIT_MAX,
  message: { error: 'Too many registrations, please try again later' },
});

export const urlCreateLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: env.URL_CREATE_RATE_LIMIT_WINDOW_MS,
  limit: env.URL_CREATE_RATE_LIMIT_MAX,
  message: { error: 'Too many URLs created, please slow down' },
});
