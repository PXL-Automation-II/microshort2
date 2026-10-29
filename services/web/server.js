import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import promClient from 'prom-client';
import { cleanEnv, str, port } from 'envalid';

// Serves the built dashboard (dist/, produced by `npm run build`). The one
// dynamic piece is /config.js, which tells the BROWSER where api is. That
// value must be reachable from the user's machine, not from this container,
// so it is required and has no default: "/api" (same origin, path-routed)
// or "https://api.example.com" both work.
const env = cleanEnv(process.env, {
  API_BASE_URL: str({ desc: 'Base URL of api as seen by the browser, e.g. /api or https://api.example.com' }),
  PORT:         port({ default: 3001 }),
  LOG_LEVEL:    str({ default: 'info', choices: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] }),
});

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const indexPath = join(dist, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`dist/index.html not found at ${indexPath}. Run "npm run build" first (the Docker image does this).`);
  process.exit(1);
}

const logger = pino({ level: env.LOG_LEVEL });
const apiBase = env.API_BASE_URL.replace(/\/+$/, '');

const registry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: registry, prefix: 'microshort_web_' });
const httpRequests = new promClient.Counter({
  name: 'microshort_web_http_requests_total',
  help: 'HTTP requests handled',
  labelNames: ['method', 'status'],
  registers: [registry],
});

const QUIET = new Set(['/health', '/ready', '/metrics']);
const app = express();
app.disable('x-powered-by');
app.use(pinoHttp({ logger, autoLogging: { ignore: req => QUIET.has(req.url) } }));
app.use((req, res, next) => {
  res.on('finish', () => {
    if (!QUIET.has(req.path)) httpRequests.inc({ method: req.method, status: String(res.statusCode) });
  });
  next();
});

// CSP: scripts and styles only from here, XHR only to api. 'self' covers a
// path-routed api; an absolute API_BASE_URL is added explicitly. Inline
// styles are needed by the charting library.
app.use((_req, res, next) => {
  const connect = apiBase.startsWith('/') ? "'self'" : `'self' ${apiBase}`;
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; connect-src ${connect}; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'web' }));
app.get('/ready', (_req, res) => res.json({ status: 'ready' }));
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.MICROSHORT_CONFIG = ${JSON.stringify({ apiBaseUrl: apiBase })};`);
});

// Vite emits content-hashed files under /assets: cache them forever. The
// entry page is revalidated on every load so a deploy is picked up at once.
app.use(express.static(dist, {
  index: false,
  etag: true,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  },
}));
app.get(['/', '/{*splat}'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(indexPath);
});

const server = app.listen(env.PORT, () => logger.info({ port: env.PORT, apiBaseUrl: apiBase }, 'web listening'));

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
