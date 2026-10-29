import { env, parseHealthTargets } from '../env.js';
import { query, ping } from '../db.js';
import { requireAdmin } from '../middleware.js';
import { urlProblem, parseCursor, parseLimit, parseId, escapeLike } from '../utils.js';
import { getPublicBaseUrl, setPublicBaseUrl, publicBaseUrlSource } from '../config.js';
import { formatUrl } from './urls.js';
import { formatKey } from './auth.js';

const healthTargets = parseHealthTargets(env.HEALTH_TARGETS);

function formatUser(u) {
  return { id: u.id, email: u.email, role: u.role, createdAt: u.created_at, ...(u.url_count !== undefined ? { urlCount: u.url_count } : {}) };
}

async function searchUrls({ q, limit, cursor }) {
  // % and _ in the query are literals, not wildcards.
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const { rows } = await query(
    `SELECT u.*, us.email
       FROM urls u JOIN users us ON us.id = u.user_id
      WHERE ($1::text IS NULL OR u.slug ILIKE $1 ESCAPE '\\' OR u.long_url ILIKE $1 ESCAPE '\\')
        AND ($2::bigint IS NULL OR u.id < $2)
      ORDER BY u.id DESC LIMIT $3`,
    [pattern, cursor, limit + 1], 'admin_urls',
  );
  const page = rows.slice(0, limit);
  return { urls: page.map(formatUrl), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

// All routes here require an API key belonging to an admin user. This is the
// whole surface the dashboard uses.
export function registerAdminRoutes(router) {
  /**
   * @openapi
   * /admin/dashboard:
   *   get:
   *     tags: [Admin]
   *     summary: Totals, top URLs and clicks per day for the last 7 days
   *     security: [{ apiKey: [] }]
   */
  // All day boundaries are computed in UTC inside PostgreSQL and returned as
  // text, so the result does not depend on the api host's timezone.
  async function loadStats() {
    const [users, keys, urls, top, daily, today] = await Promise.all([
      query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE role = 'admin')::int AS admins,
                count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS recent
           FROM users`, [], 'dash_users',
      ),
      query(`SELECT count(*)::int AS active FROM api_keys WHERE revoked_at IS NULL`, [], 'dash_keys'),
      query(
        `SELECT count(*)::int AS total,
                coalesce(sum(click_count), 0)::bigint AS total_clicks,
                count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS recent
           FROM urls`, [], 'dash_urls',
      ),
      query(`SELECT u.*, us.email FROM urls u JOIN users us ON us.id = u.user_id ORDER BY click_count DESC, id DESC LIMIT 10`, [], 'dash_top'),
      query(
        `WITH days AS (
           SELECT generate_series(date_trunc('day', now() AT TIME ZONE 'UTC') - interval '6 days',
                                  date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day') AS d
         )
         SELECT to_char(d, 'YYYY-MM-DD') AS day,
                (SELECT count(*) FROM clicks
                  WHERE ts >= d AT TIME ZONE 'UTC' AND ts < (d + interval '1 day') AT TIME ZONE 'UTC')::int AS clicks
           FROM days ORDER BY d`, [], 'dash_daily',
      ),
      query(`SELECT count(*)::int AS n FROM clicks WHERE ts >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [], 'dash_today'),
    ]);
    return {
      users: { total: users.rows[0].total, admins: users.rows[0].admins, recentSignups: users.rows[0].recent, totalApiKeys: keys.rows[0].active },
      urls: { total: urls.rows[0].total, totalClicks: urls.rows[0].total_clicks, recentUrls: urls.rows[0].recent, top: top.rows.map(formatUrl) },
      clicks: { today: today.rows[0].n, last7Days: daily.rows.map(r => ({ day: r.day, clicks: r.clicks })) },
      publicBaseUrl: getPublicBaseUrl(),
    };
  }

  router.get('/admin/dashboard', requireAdmin, async (_req, res) => {
    res.json(await loadStats());
  });

  /**
   * @openapi
   * /admin/stats:
   *   get:
   *     tags: [Admin]
   *     summary: Flat counters (v1-compatible shape) — totalUsers, recentSignups, totalApiKeys, totalUrls, totalClicks, recentUrls, topUrls
   *     security: [{ apiKey: [] }]
   */
  router.get('/admin/stats', requireAdmin, async (_req, res) => {
    const s = await loadStats();
    res.json({
      totalUsers: s.users.total,
      recentSignups: s.users.recentSignups,
      totalApiKeys: s.users.totalApiKeys,
      totalUrls: s.urls.total,
      totalClicks: s.urls.totalClicks,
      recentUrls: s.urls.recentUrls,
      topUrls: s.urls.top.map(u => ({ slug: u.slug, longUrl: u.longUrl, clicks: u.clicks })),
    });
  });

  /**
   * @openapi
   * /admin/users:
   *   get:
   *     tags: [Admin]
   *     summary: List users with their URL counts (?limit&cursor)
   *     security: [{ apiKey: [] }]
   */
  router.get('/admin/users', requireAdmin, async (req, res) => {
    const limit = parseLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const { rows } = await query(
      `SELECT u.id, u.email, u.role, u.created_at,
              (SELECT count(*)::int FROM urls WHERE user_id = u.id) AS url_count
         FROM users u
        WHERE ($1::bigint IS NULL OR u.id < $1)
        ORDER BY u.id DESC LIMIT $2`,
      [cursor, limit + 1], 'admin_users',
    );
    const page = rows.slice(0, limit);
    res.json({ users: page.map(formatUser), nextCursor: rows.length > limit ? page[page.length - 1].id : null });
  });

  /**
   * @openapi
   * /admin/users/{id}:
   *   get:
   *     tags: [Admin]
   *     summary: One user with their API keys (metadata only) and URLs
   *     security: [{ apiKey: [] }]
   */
  router.get('/admin/users/:id', requireAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid user id' });
    const user = await query('SELECT id, email, role, created_at FROM users WHERE id = $1', [id], 'user_by_id');
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const [keys, urls] = await Promise.all([
      query('SELECT id, name, key_prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = $1 ORDER BY id DESC', [id], 'api_keys_by_user'),
      query('SELECT * FROM urls WHERE user_id = $1 ORDER BY id DESC LIMIT 200', [id], 'urls_by_user'),
    ]);
    res.json({
      user: formatUser(user.rows[0]),
      apiKeys: keys.rows.map(formatKey),
      urls: urls.rows.map(formatUrl),
    });
  });

  /**
   * @openapi
   * /admin/urls:
   *   get:
   *     tags: [Admin]
   *     summary: All URLs, optionally filtered with ?q= (slug or destination), paginated
   *     security: [{ apiKey: [] }]
   */
  router.get('/admin/urls', requireAdmin, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
    res.json(await searchUrls({ q, limit: parseLimit(req.query.limit), cursor: parseCursor(req.query.cursor) }));
  });

  /**
   * @openapi
   * /admin/search/urls:
   *   get:
   *     tags: [Admin]
   *     summary: Search URLs by slug or destination (?q= required)
   *     security: [{ apiKey: [] }]
   */
  router.get('/admin/search/urls', requireAdmin, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
    if (!q) return res.status(400).json({ error: 'q is required' });
    res.json(await searchUrls({ q, limit: parseLimit(req.query.limit, { def: 100 }), cursor: null }));
  });

  /**
   * @openapi
   * /admin/urls/{slug}:
   *   put:
   *     tags: [Admin]
   *     summary: Change any URL's destination
   *     security: [{ apiKey: [] }]
   *   delete:
   *     tags: [Admin]
   *     summary: Delete any URL
   *     security: [{ apiKey: [] }]
   */
  router.put('/admin/urls/:slug', requireAdmin, async (req, res) => {
    const { url } = req.body ?? {};
    const problem = urlProblem(url);
    if (problem) return res.status(400).json({ error: problem });
    const { rows } = await query('UPDATE urls SET long_url = $1 WHERE slug = $2 RETURNING *', [url, req.params.slug], 'url_update');
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(formatUrl(rows[0]));
  });

  router.delete('/admin/urls/:slug', requireAdmin, async (req, res) => {
    const { rowCount } = await query('DELETE FROM urls WHERE slug = $1', [req.params.slug], 'url_delete');
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  });

  /**
   * @openapi
   * /admin/config:
   *   get:
   *     tags: [Admin]
   *     summary: Current public base URL and where it comes from
   *     security: [{ apiKey: [] }]
   *   put:
   *     tags: [Admin]
   *     summary: Override the public base URL in memory (lost on restart, per replica)
   *     security: [{ apiKey: [] }]
   */
  router.get('/admin/config', requireAdmin, (_req, res) => {
    res.json({ publicBaseUrl: getPublicBaseUrl(), source: publicBaseUrlSource(), envValue: env.PUBLIC_BASE_URL });
  });

  router.put('/admin/config', requireAdmin, (req, res) => {
    // v1 clients sent { domain }; accept both.
    const publicBaseUrl = req.body?.publicBaseUrl ?? req.body?.domain;
    const problem = urlProblem(publicBaseUrl);
    if (problem) return res.status(400).json({ error: `publicBaseUrl: ${problem}` });
    // Overrides must be https in production; the value the operator configured
    // in PUBLIC_BASE_URL is always accepted, so an override can be undone.
    if (env.isProduction && !publicBaseUrl.startsWith('https://') && publicBaseUrl !== env.PUBLIC_BASE_URL) {
      return res.status(400).json({ error: 'publicBaseUrl must use https:// in production' });
    }
    setPublicBaseUrl(publicBaseUrl);
    res.json({
      publicBaseUrl: getPublicBaseUrl(),
      source: publicBaseUrlSource(),
      note: 'In-memory override on this replica only; set PUBLIC_BASE_URL in the environment to persist.',
    });
  });

  /**
   * @openapi
   * /admin/health/services:
   *   get:
   *     tags: [Admin]
   *     summary: Health of api, its database and every HEALTH_TARGETS entry
   *     security: [{ apiKey: [] }]
   */
  router.get('/admin/health/services', requireAdmin, async (_req, res) => {
    const probe = async (name, fn) => {
      const started = performance.now();
      try {
        await fn();
        return { name, status: 'healthy', responseTimeMs: Math.round(performance.now() - started) };
      } catch (err) {
        return { name, status: err.unreachable ? 'unreachable' : 'unhealthy', responseTimeMs: Math.round(performance.now() - started), error: err.message };
      }
    };
    const services = await Promise.all([
      probe('api', async () => {}),
      probe('database', ping),
      ...healthTargets.map(t => probe(t.name, async () => {
        let r;
        try {
          r = await fetch(`${t.url}/health`, { signal: AbortSignal.timeout(env.UPSTREAM_TIMEOUT_MS) });
        } catch (err) {
          throw Object.assign(new Error(err.message), { unreachable: true });
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      })),
    ]);
    res.json({ services, checkedAt: new Date().toISOString() });
  });
}
