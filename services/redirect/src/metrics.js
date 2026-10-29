import promClient from 'prom-client';

export const registry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: registry, prefix: 'microshort_redirect_' });

export const httpRequestsTotal = new promClient.Counter({
  name: 'microshort_redirect_http_requests_total',
  help: 'HTTP requests handled',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

export const httpRequestDuration = new promClient.Histogram({
  name: 'microshort_redirect_http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const redirectsTotal = new promClient.Counter({
  name: 'microshort_redirect_redirects_total',
  help: 'Slug lookups by outcome',
  labelNames: ['result'], // hit | miss | not_found | stale | upstream_error
  registers: [registry],
});

export const cacheHitsTotal = new promClient.Counter({
  name: 'microshort_redirect_cache_hits_total',
  help: 'Slug lookups answered from the in-process cache',
  registers: [registry],
});

export const cacheMissesTotal = new promClient.Counter({
  name: 'microshort_redirect_cache_misses_total',
  help: 'Slug lookups that had to ask api',
  registers: [registry],
});

export const apiReachable = new promClient.Gauge({
  name: 'microshort_redirect_api_reachable',
  help: '1 when the last call to api succeeded, 0 otherwise',
  registers: [registry],
});

export const cacheSize = new promClient.Gauge({
  name: 'microshort_redirect_cache_entries',
  help: 'Entries in the in-process slug cache',
  registers: [registry],
});

export const upstreamDuration = new promClient.Histogram({
  name: 'microshort_redirect_upstream_duration_seconds',
  help: 'Latency of calls to api',
  labelNames: ['op', 'status'], // resolve | flush
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const clicksBuffered = new promClient.Gauge({
  name: 'microshort_redirect_click_buffer_size',
  help: 'Click events waiting to be flushed',
  registers: [registry],
});

export const clicksFlushedTotal = new promClient.Counter({
  name: 'microshort_redirect_clicks_flushed_total',
  help: 'Click events delivered to api',
  registers: [registry],
});

export const clicksDroppedTotal = new promClient.Counter({
  name: 'microshort_redirect_clicks_dropped_total',
  help: 'Click events dropped (buffer full or shutdown)',
  labelNames: ['reason'], // buffer_full | rejected | shutdown
  registers: [registry],
});

const UNMETERED = new Set(['/health', '/ready', '/metrics']);

export function metricsMiddleware(req, res, next) {
  if (UNMETERED.has(req.path)) return next();
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.route.path : 'unmatched';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
}
