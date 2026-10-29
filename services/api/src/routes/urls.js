import { query, UNIQUE_VIOLATION } from '../db.js';
import { requireApiKey, urlCreateLimiter } from '../middleware.js';
import { generateSlug, urlProblem, isValidSlug, parseCursor, parseLimit, SLUG_MAX_LENGTH } from '../utils.js';
import { buildShortUrl } from '../config.js';
import { urlsCreatedTotal } from '../metrics.js';

const MAX_SLUG_ATTEMPTS = 3;

export function formatUrl(row) {
  return {
    id: row.id,
    slug: row.slug,
    shortUrl: buildShortUrl(row.slug),
    longUrl: row.long_url,
    clicks: row.click_count,
    userId: row.user_id,
    ...(row.email !== undefined ? { userEmail: row.email } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canTouch(req, row) {
  return row.user_id === req.user.id || req.user.role === 'admin';
}

export function registerUrlRoutes(router) {
  /**
   * @openapi
   * /urls:
   *   post:
   *     tags: [URLs]
   *     summary: Shorten a URL
   *     security: [{ apiKey: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [url]
   *             properties:
   *               url: { type: string, format: uri }
   *               customSlug: { type: string, maxLength: 50, pattern: '^[a-zA-Z0-9_-]+$' }
   *     responses:
   *       201: { description: Created }
   *       400: { description: Invalid url or slug }
   *       409: { description: Slug already taken }
   *   get:
   *     tags: [URLs]
   *     summary: List my URLs (keyset pagination with ?limit&cursor)
   *     security: [{ apiKey: [] }]
   */
  router.post('/urls', urlCreateLimiter, requireApiKey, async (req, res) => {
    const { url } = req.body ?? {};
    // null / "" mean "no custom slug", as in v1.
    const customSlug = req.body?.customSlug == null || req.body.customSlug === '' ? undefined : req.body.customSlug;
    const problem = urlProblem(url);
    if (problem) return res.status(400).json({ error: problem });
    if (customSlug !== undefined && !isValidSlug(customSlug)) {
      return res.status(400).json({
        error: `customSlug must be 1-${SLUG_MAX_LENGTH} characters of [a-zA-Z0-9_-] and not a reserved word`,
      });
    }
    for (let attempt = 1; ; attempt++) {
      const slug = customSlug ?? generateSlug();
      try {
        const { rows: [row] } = await query(
          'INSERT INTO urls (user_id, slug, long_url) VALUES ($1, $2, $3) RETURNING *',
          [req.user.id, slug, url], 'url_insert',
        );
        urlsCreatedTotal.inc({ type: customSlug ? 'custom' : 'auto' });
        return res.status(201).json(formatUrl(row));
      } catch (err) {
        if (err.code !== UNIQUE_VIOLATION) throw err;
        if (customSlug) return res.status(409).json({ error: 'Slug already in use' });
        if (attempt >= MAX_SLUG_ATTEMPTS) return res.status(503).json({ error: 'Could not allocate a slug, retry' });
      }
    }
  });

  router.get('/urls', requireApiKey, async (req, res) => {
    const limit = parseLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const { rows } = await query(
      `SELECT * FROM urls
        WHERE user_id = $1 AND ($2::bigint IS NULL OR id < $2)
        ORDER BY id DESC LIMIT $3`,
      [req.user.id, cursor, limit + 1], 'urls_by_user',
    );
    const page = rows.slice(0, limit);
    res.json({
      urls: page.map(formatUrl),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    });
  });

  /**
   * @openapi
   * /urls/{slug}:
   *   get:
   *     tags: [URLs]
   *     summary: One of my URLs
   *     security: [{ apiKey: [] }]
   *   put:
   *     tags: [URLs]
   *     summary: Change the destination
   *     security: [{ apiKey: [] }]
   *   delete:
   *     tags: [URLs]
   *     summary: Delete a short URL
   *     security: [{ apiKey: [] }]
   */
  // Slug existence is public anyway (the redirect answers 302 or 404), so
  // all three routes answer the same way: 404 unknown, 403 not yours.
  router.get('/urls/:slug', requireApiKey, async (req, res) => {
    const { rows } = await query('SELECT * FROM urls WHERE slug = $1', [req.params.slug], 'url_by_slug');
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (!canTouch(req, rows[0])) return res.status(403).json({ error: 'Forbidden' });
    res.json(formatUrl(rows[0]));
  });

  router.put('/urls/:slug', requireApiKey, async (req, res) => {
    const { url } = req.body ?? {};
    const problem = urlProblem(url);
    if (problem) return res.status(400).json({ error: problem });
    const { rows } = await query('SELECT * FROM urls WHERE slug = $1', [req.params.slug], 'url_by_slug');
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (!canTouch(req, rows[0])) return res.status(403).json({ error: 'Forbidden' });
    const { rows: [row] } = await query(
      'UPDATE urls SET long_url = $1 WHERE id = $2 RETURNING *', [url, rows[0].id], 'url_update',
    );
    res.json(formatUrl(row));
  });

  router.delete('/urls/:slug', requireApiKey, async (req, res) => {
    const { rows } = await query('SELECT * FROM urls WHERE slug = $1', [req.params.slug], 'url_by_slug');
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (!canTouch(req, rows[0])) return res.status(403).json({ error: 'Forbidden' });
    await query('DELETE FROM urls WHERE id = $1', [rows[0].id], 'url_delete');
    res.status(204).end();
  });
}
