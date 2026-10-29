import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env, parseAllowedOrigins, parseTrustProxy } from './env.js';
import { ping } from './db.js';
import { registry, metricsMiddleware } from './metrics.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerUrlRoutes } from './routes/urls.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerInternalRoutes } from './routes/internal.js';
import { buildOpenApiSpec } from './swagger.js';

const QUIET_PATHS = new Set(['/health', '/ready', '/metrics']);

export function createApp({ logger }) {
  const app = express();
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  app.disable('x-powered-by');

  app.use(pinoHttp({
    logger,
    // Credentials never reach the log: found in journald on the first AWS
    // deployment, where every request line carried the caller's API key.
    redact: {
      paths: [
        'req.headers["x-api-key"]', 'req.headers.authorization', 'req.headers["x-service-token"]', 'req.headers.cookie',
        // Identity claims and the IdP access token an authenticating ALB forwards (contract 4a).
        'req.headers["x-amzn-oidc-data"]', 'req.headers["x-amzn-oidc-accesstoken"]', 'req.headers["x-amzn-oidc-identity"]',
      ],
      censor: '[redacted]',
    },
    genReqId: (req, res) => {
      const id = req.headers['x-request-id'] || randomUUID();
      res.setHeader('X-Request-ID', id);
      return id;
    },
    autoLogging: { ignore: req => QUIET_PATHS.has(req.url) },
  }));
  app.use(metricsMiddleware);
  app.use(express.json({ limit: '1mb' }));

  const origins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  app.use(cors({
    origin: origins,   // '*' is sent literally; a list is matched exactly
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'RateLimit', 'RateLimit-Policy'],
  }));

  // ---- Ops endpoints: at the root (container probes) AND under BASE_PATH ----
  const ops = express.Router();
  /**
   * @openapi
   * /health:
   *   get:
   *     tags: [Ops]
   *     summary: Liveness — cheap, no dependencies
   * /ready:
   *   get:
   *     tags: [Ops]
   *     summary: Readiness — checks the database
   * /metrics:
   *   get:
   *     tags: [Ops]
   *     summary: Prometheus metrics (unauthenticated; keep internal)
   */
  ops.get('/health', (_req, res) => res.json({ status: 'ok', service: 'api' }));
  ops.get('/ready', async (_req, res) => {
    try {
      await ping();
      res.json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'not ready', error: err.message });
    }
  });
  ops.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });
  app.use(ops);

  // ---- Application routes, mounted under BASE_PATH ('' = root) --------------
  const api = express.Router();
  registerAuthRoutes(api);
  registerUrlRoutes(api);
  registerAdminRoutes(api);
  registerInternalRoutes(api);

  const spec = buildOpenApiSpec({ basePath: env.BASE_PATH });
  api.get('/openapi.json', (_req, res) => res.json(spec));
  api.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));

  if (env.BASE_PATH) {
    app.use(env.BASE_PATH, ops);
    app.use(env.BASE_PATH, api);
  } else {
    app.use(api);
  }

  app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.originalUrl }));

  // Express 5 forwards rejected promises here automatically.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Body too large' });
    req.log?.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'Internal error', requestId: req.id });
  });

  return app;
}
