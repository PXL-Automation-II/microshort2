import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { query, withTransaction, UNIQUE_VIOLATION } from '../db.js';
import { signTokens, requireJwt, loginLimiter, registerLimiter } from '../middleware.js';
import { generateApiKey, hashKey, isValidEmail, isValidPassword, parseId, PASSWORD_MIN_LENGTH } from '../utils.js';
import { authFailuresTotal } from '../metrics.js';
import { createAlbVerifier, createSsoHandler, parseAdminList } from '../sso.js';

// Compared against when the e-mail is unknown, so a login attempt costs one
// bcrypt round whether or not the account exists (no timing-based enumeration).
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', env.BCRYPT_COST);

const ssoEnabled = env.AUTH_TRUSTED_PROXY === 'alb';

export function registerAuthRoutes(router) {
  /**
   * @openapi
   * /auth/providers:
   *   get:
   *     tags: [Auth]
   *     summary: Which sign-in methods this deployment offers (the dashboard asks before showing its login page)
   *     responses:
   *       200: { description: "{ apiKey: true, sso: boolean }" }
   */
  router.get('/auth/providers', (_req, res) => {
    res.json({ apiKey: true, sso: ssoEnabled });
  });

  /**
   * @openapi
   * /auth/sso:
   *   get:
   *     tags: [Auth]
   *     summary: Exchange the identity forwarded by a trusted proxy (AUTH_TRUSTED_PROXY=alb) for the api's own tokens
   *     responses:
   *       200: { description: token, refreshToken, userId, role, email }
   *       401: { description: No or invalid identity from the proxy }
   *       404: { description: Single sign-on is not enabled }
   */
  if (ssoEnabled) {
    router.get('/auth/sso', loginLimiter, createSsoHandler({
      verifier: createAlbVerifier({ albArn: env.AUTH_TRUSTED_PROXY_SIGNER }),
      admins: parseAdminList(env.AUTH_TRUSTED_PROXY_ADMINS),
      bcryptCost: env.BCRYPT_COST,
      query,
      signTokens,
      onFailure: () => authFailuresTotal.inc({ kind: 'sso' }),
    }));
  } else {
    router.get('/auth/sso', (_req, res) => res.status(404).json({ error: 'Single sign-on is not enabled on this api' }));
  }

  /**
   * @openapi
   * /auth/register:
   *   post:
   *     tags: [Auth]
   *     summary: Register. The first user becomes admin.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [email, password]
   *             properties:
   *               email: { type: string, format: email }
   *               password: { type: string, minLength: 8 }
   *     responses:
   *       201: { description: Created — returns token, refreshToken, userId, role }
   *       400: { description: Invalid email or password }
   *       409: { description: Email already registered }
   */
  router.post('/auth/register', registerLimiter, async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required' });
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` });
    }
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
    try {
      const user = await withTransaction(async client => {
        // Serialise registrations so exactly one user can observe "table is empty".
        await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
        const { rows: [{ count }] } = await client.query('SELECT count(*)::int AS count FROM users');
        const role = count === 0 ? 'admin' : 'user';
        const { rows: [row] } = await client.query(
          'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
          [email, passwordHash, role],
        );
        return row;
      });
      res.status(201).json({ ...signTokens(user), userId: user.id, role: user.role });
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) return res.status(409).json({ error: 'Email already registered' });
      throw err;
    }
  });

  /**
   * @openapi
   * /auth/login:
   *   post:
   *     tags: [Auth]
   *     summary: Log in with email and password
   *     responses:
   *       200: { description: token, refreshToken, userId, role }
   *       401: { description: Invalid credentials }
   */
  router.post('/auth/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const { rows } = await query(
      'SELECT id, email, role, password_hash FROM users WHERE lower(email) = lower($1)',
      [email], 'user_by_email',
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH) && Boolean(user);
    if (!ok) {
      authFailuresTotal.inc({ kind: 'login' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ ...signTokens(user), userId: user.id, role: user.role });
  });

  /**
   * @openapi
   * /auth/refresh:
   *   post:
   *     tags: [Auth]
   *     summary: Exchange a refresh token for new tokens (stateless, not revocable)
   */
  router.post('/auth/refresh', loginLimiter, async (req, res) => {
    const { refreshToken } = req.body ?? {};
    if (typeof refreshToken !== 'string' || !refreshToken) {
      return res.status(400).json({ error: 'refreshToken is required' });
    }
    try {
      const payload = jwt.verify(refreshToken, env.JWT_SECRET);
      if (payload.type !== 'refresh') return res.status(400).json({ error: 'Not a refresh token' });
      const { rows } = await query('SELECT id, role FROM users WHERE id = $1', [payload.userId], 'user_by_id');
      if (rows.length === 0) throw new Error('user gone');
      res.json({ ...signTokens(rows[0]), userId: rows[0].id, role: rows[0].role });
    } catch {
      authFailuresTotal.inc({ kind: 'jwt' });
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  });

  /**
   * @openapi
   * /auth/me:
   *   get:
   *     tags: [Auth]
   *     summary: Current user
   *     security: [{ bearerAuth: [] }]
   */
  router.get('/auth/me', requireJwt, async (req, res) => {
    const { rows } = await query(
      'SELECT id, email, role, created_at FROM users WHERE id = $1', [req.user.id], 'user_by_id',
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    res.json({ id: u.id, email: u.email, role: u.role, createdAt: u.created_at });
  });

  /**
   * @openapi
   * /auth/api-keys:
   *   post:
   *     tags: [Auth]
   *     summary: Create an API key (shown once)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: apiKey, keyId, name }
   *   get:
   *     tags: [Auth]
   *     summary: List my active API keys (never the key itself); ?includeRevoked=true adds revoked ones
   *     security: [{ bearerAuth: [] }]
   */
  router.post('/auth/api-keys', requireJwt, async (req, res) => {
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 255) : 'default';
    const apiKey = generateApiKey();
    const { rows: [row] } = await query(
      `INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
       VALUES ($1, $2, $3, $4) RETURNING id, name, created_at`,
      [req.user.id, name, hashKey(apiKey), apiKey.slice(0, 8)], 'api_key_insert',
    );
    res.status(201).json({ apiKey, keyId: row.id, name: row.name, createdAt: row.created_at });
  });

  router.get('/auth/api-keys', requireJwt, async (req, res) => {
    const includeRevoked = req.query.includeRevoked === 'true';
    const { rows } = await query(
      `SELECT id, name, key_prefix, created_at, last_used_at, revoked_at
         FROM api_keys
        WHERE user_id = $1 AND ($2 OR revoked_at IS NULL)
        ORDER BY id DESC`,
      [req.user.id, includeRevoked], 'api_keys_by_user',
    );
    res.json({ keys: rows.map(formatKey) });
  });

  /**
   * @openapi
   * /auth/api-keys/{keyId}:
   *   delete:
   *     tags: [Auth]
   *     summary: Revoke an API key
   *     security: [{ bearerAuth: [] }]
   */
  router.delete('/auth/api-keys/:keyId', requireJwt, async (req, res) => {
    const keyId = parseId(req.params.keyId);
    if (keyId === null) return res.status(400).json({ error: 'Invalid key id' });
    const { rowCount } = await query(
      'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [keyId, req.user.id], 'api_key_revoke',
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Key not found or already revoked' });
    res.status(204).end();
  });
}

export function formatKey(k) {
  return {
    id: k.id,
    name: k.name,
    keyPrefix: k.key_prefix,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    revokedAt: k.revoked_at,
  };
}
