import promClient from 'prom-client';

export const registry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: registry, prefix: 'microshort_api_' });

export const httpRequestsTotal = new promClient.Counter({
  name: 'microshort_api_http_requests_total',
  help: 'HTTP requests handled',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

export const httpRequestDuration = new promClient.Histogram({
  name: 'microshort_api_http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const dbQueryDuration = new promClient.Histogram({
  name: 'microshort_api_db_query_duration_seconds',
  help: 'PostgreSQL query latency',
  labelNames: ['op'],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const urlsCreatedTotal = new promClient.Counter({
  name: 'microshort_api_urls_created_total',
  help: 'Short URLs created',
  labelNames: ['type'], // auto | custom
  registers: [registry],
});

export const clicksIngestedTotal = new promClient.Counter({
  name: 'microshort_api_clicks_ingested_total',
  help: 'Click events accepted from redirect',
  labelNames: ['result'], // stored | unknown_slug
  registers: [registry],
});

export const authFailuresTotal = new promClient.Counter({
  name: 'microshort_api_auth_failures_total',
  help: 'Rejected authentication attempts',
  labelNames: ['kind'], // jwt | api_key | service_token | login
  registers: [registry],
});

// Pool gauges read live values from pg at scrape time.
export function dbPoolGauges(read) {
  new promClient.Gauge({
    name: 'microshort_api_db_pool_total',
    help: 'Clients in the pool',
    registers: [registry],
    collect() { this.set(read().total); },
  });
  new promClient.Gauge({
    name: 'microshort_api_db_pool_idle',
    help: 'Idle clients in the pool',
    registers: [registry],
    collect() { this.set(read().idle); },
  });
  new promClient.Gauge({
    name: 'microshort_api_db_pool_in_use',
    help: 'Clients currently checked out of the pool',
    registers: [registry],
    collect() { const r = read(); this.set(r.total - r.idle); },
  });
  new promClient.Gauge({
    name: 'microshort_api_db_pool_waiting',
    help: 'Requests waiting for a client',
    registers: [registry],
    collect() { this.set(read().waiting); },
  });
}

const UNMETERED = new Set(['/health', '/ready', '/metrics']);

export function metricsMiddleware(req, res, next) {
  if (UNMETERED.has(req.path)) return next();
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
}
