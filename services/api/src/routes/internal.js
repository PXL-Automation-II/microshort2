import { query, withTransaction } from '../db.js';
import { requireServiceToken } from '../middleware.js';
import { clicksIngestedTotal } from '../metrics.js';

const MAX_EVENTS_PER_BATCH = 1000;

// Endpoints only the redirect service calls. Never expose these publicly.
export function registerInternalRoutes(router) {
  /**
   * @openapi
   * /internal/urls/{slug}:
   *   get:
   *     tags: [Internal]
   *     summary: Resolve a slug (redirect service only)
   *     security: [{ serviceToken: [] }]
   *     responses:
   *       200: { description: slug, longUrl }
   *       404: { description: Unknown slug }
   */
  router.get('/internal/urls/:slug', requireServiceToken, async (req, res) => {
    const { rows } = await query('SELECT slug, long_url FROM urls WHERE slug = $1', [req.params.slug], 'url_resolve');
    if (rows.length === 0) return res.status(404).json({ error: 'Unknown slug' });
    res.json({ slug: rows[0].slug, longUrl: rows[0].long_url });
  });

  /**
   * @openapi
   * /internal/clicks:
   *   post:
   *     tags: [Internal]
   *     summary: Ingest a batch of click events (redirect service only)
   *     security: [{ serviceToken: [] }]
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               events:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required: [slug, ts]
   *                   properties:
   *                     slug: { type: string }
   *                     ts: { type: string, format: date-time }
   *                     referrer: { type: string, nullable: true }
   *                     userAgent: { type: string, nullable: true }
   *                     ipHash: { type: string, nullable: true }
   *     responses:
   *       202: { description: accepted count and unknown slugs }
   */
  router.post('/internal/clicks', requireServiceToken, async (req, res) => {
    const events = Array.isArray(req.body?.events) ? req.body.events : null;
    if (!events) return res.status(400).json({ error: 'events[] is required' });
    if (events.length > MAX_EVENTS_PER_BATCH) {
      return res.status(413).json({ error: `At most ${MAX_EVENTS_PER_BATCH} events per batch` });
    }
    const clean = events
      .filter(e => e && typeof e.slug === 'string' && e.slug.length <= 50)
      .map(e => ({
        slug: e.slug,
        ts: Number.isFinite(Date.parse(e.ts)) ? new Date(e.ts) : new Date(),
        referrer: typeof e.referrer === 'string' ? e.referrer.slice(0, 2048) : null,
        userAgent: typeof e.userAgent === 'string' ? e.userAgent.slice(0, 512) : null,
        ipHash: typeof e.ipHash === 'string' && e.ipHash.length === 64 ? e.ipHash : null,
      }));
    if (clean.length === 0) return res.status(202).json({ accepted: 0, unknownSlugs: [] });

    const { accepted, matchedSlugs } = await withTransaction(async client => {
      // One round trip: unnest the batch, join to urls, insert what matches,
      // and return per-URL counts plus the slug so unknown ones can be derived.
      const { rows: inserted } = await client.query(
        `WITH batch AS (
           SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::text[], $4::text[], $5::text[])
                  AS b(slug, ts, referrer, user_agent, ip_hash)
         ), ins AS (
           INSERT INTO clicks (url_id, ts, referrer, user_agent, ip_hash)
           SELECT u.id, b.ts, b.referrer, b.user_agent, b.ip_hash
             FROM batch b JOIN urls u ON u.slug = b.slug
           RETURNING url_id
         )
         SELECT i.url_id, u.slug, count(*)::int AS n
           FROM ins i JOIN urls u ON u.id = i.url_id
          GROUP BY i.url_id, u.slug`,
        [
          clean.map(e => e.slug),
          clean.map(e => e.ts),
          clean.map(e => e.referrer),
          clean.map(e => e.userAgent),
          clean.map(e => e.ipHash),
        ],
      );
      if (inserted.length > 0) {
        await client.query(
          `UPDATE urls u SET click_count = u.click_count + d.n
             FROM unnest($1::bigint[], $2::int[]) AS d(url_id, n)
            WHERE u.id = d.url_id`,
          [inserted.map(r => r.url_id), inserted.map(r => r.n)],
        );
      }
      return {
        accepted: inserted.reduce((sum, r) => sum + r.n, 0),
        matchedSlugs: new Set(inserted.map(r => r.slug)),
      };
    });

    const unknownSlugs = [...new Set(clean.map(e => e.slug).filter(s => !matchedSlugs.has(s)))];
    clicksIngestedTotal.inc({ result: 'stored' }, accepted);
    clicksIngestedTotal.inc({ result: 'unknown_slug' }, clean.length - accepted);
    res.status(202).json({ accepted, unknownSlugs });
  });
}
