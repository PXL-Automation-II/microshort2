import { randomUUID } from 'node:crypto';
import express from 'express';
import pinoHttp from 'pino-http';
import { env, parseTrustProxy } from './env.js';
import { registry, metricsMiddleware, redirectsTotal, cacheHitsTotal, cacheMissesTotal, apiReachable } from './metrics.js';
import { isPlausibleSlug, hashIp, escapeHtml } from './utils.js';

const QUIET_PATHS = new Set(['/health', '/ready', '/metrics']);
// The HTML this service emits is static text: lock it down.
const CSP = "default-src 'none'; style-src 'unsafe-inline'";

export function createApp({ logger, apiClient, cache, clicks }) {
  const app = express();
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  app.disable('x-powered-by');

  app.use(pinoHttp({
    logger,
    redact: { paths: ['req.headers.cookie', 'req.headers.authorization'], censor: '[redacted]' },
    genReqId: (req, res) => {
      const id = req.headers['x-request-id'] || randomUUID();
      res.setHeader('X-Request-ID', id);
      return id;
    },
    autoLogging: { ignore: req => QUIET_PATHS.has(req.url) },
  }));
  app.use(metricsMiddleware);

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'redirect' }));
  // Ready as soon as we listen. Readiness deliberately does NOT depend on api:
  // during an api outage this service keeps serving cached slugs, and a load
  // balancer that pulled it would turn a degraded state into a dead one.
  // api reachability is exposed as a metric and in this body instead.
  app.get('/ready', async (_req, res) => {
    let api = 'unknown';
    try {
      api = (await apiClient.healthy()) ? 'reachable' : 'unhealthy';
    } catch {
      api = 'unreachable';
    }
    apiReachable.set(api === 'reachable' ? 1 : 0);
    res.json({ status: 'ready', api, cacheEntries: cache.size });
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  app.get('/', (_req, res) => {
    res.set('Content-Security-Policy', CSP).type('html').send(
      '<!doctype html><title>microshort</title><h1>microshort</h1>'
      + '<p>This host serves short links. Append a slug to the URL.</p>',
    );
  });

  app.get('/:slug', async (req, res) => {
    const { slug } = req.params;
    if (!isPlausibleSlug(slug)) return notFound(res, slug);

    let longUrl;
    const cached = cache.get(slug);
    if (cached !== undefined) {
      cacheHitsTotal.inc();
      redirectsTotal.inc({ result: cached === null ? 'not_found' : 'hit' });
      if (cached === null) return notFound(res, slug);
      longUrl = cached;
    } else {
      cacheMissesTotal.inc();
      let resolved;
      try {
        resolved = await apiClient.resolve(slug, req.id);
        apiReachable.set(1);
      } catch (err) {
        apiReachable.set(0);
        // Serve-stale: an expired entry beats an error page while api is down.
        const stale = cache.getStale(slug);
        if (stale !== undefined) {
          redirectsTotal.inc({ result: 'stale' });
          req.log.warn({ err: err.message, slug }, 'api unreachable, serving stale cache entry');
          longUrl = stale;
        } else {
          redirectsTotal.inc({ result: 'upstream_error' });
          req.log.error({ err: err.message, slug }, 'resolve failed');
          return res.status(503).set('Content-Security-Policy', CSP).type('html')
            .send('<!doctype html><title>Unavailable</title><h1>Temporarily unavailable</h1>');
        }
      }
      if (longUrl === undefined) {
        if (!resolved) {
          redirectsTotal.inc({ result: 'not_found' });
          cache.setNotFound(slug);
          return notFound(res, slug);
        }
        redirectsTotal.inc({ result: 'miss' });
        longUrl = resolved.longUrl;
        cache.set(slug, longUrl);
      }
    }

    clicks.push({
      slug,
      ts: new Date().toISOString(),
      referrer: req.get('referer') || null,
      userAgent: req.get('user-agent') || null,
      ipHash: hashIp(req.ip, env.IP_HASH_SALT),
    });

    // 302 + no-store: every visit reaches us and is counted. 301 would let
    // browsers cache the hop and silently stop the click stream.
    res.set('Cache-Control', 'no-store');
    res.redirect(302, longUrl);
  });

  app.use((req, res) => notFound(res, req.path));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    req.log?.error({ err }, 'unhandled error');
    res.status(500).set('Content-Security-Policy', CSP).type('html').send('<!doctype html><title>Error</title><h1>Internal error</h1>');
  });

  return app;
}

function notFound(res, slug) {
  res.status(404).set('Content-Security-Policy', CSP).type('html').send(
    `<!doctype html><title>Not found</title><h1>Short link not found</h1><p><code>${escapeHtml(slug)}</code> does not exist.</p>`,
  );
}
