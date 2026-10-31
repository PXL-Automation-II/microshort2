# Deployment contract

This is the complete list of what the three microshort 2 services need from their environment.

---

## 1. Artifacts

| Service | Container image | Run from source |
|---|---|---|
| api | `ghcr.io/<owner>/microshort2-api:<tag>` | `cd services/api && npm ci --omit=dev && node src/index.js` |
| redirect | `ghcr.io/<owner>/microshort2-redirect:<tag>` | `cd services/redirect && npm ci --omit=dev && node src/index.js` |
| web | `ghcr.io/<owner>/microshort2-web:<tag>` | `cd services/web && npm ci && npm run build && npm ci --omit=dev && node server.js` (the build produces `dist/`; a release tarball already contains it, then `npm ci --omit=dev && node server.js` suffices) |

Every tagged version also publishes a release tarball, `microshort2-<tag>.tar.gz`, on the repository's Releases page. It holds `services/api`, `services/redirect` and `services/web` with web already built and without `node_modules`: unpack it, run `npm ci --omit=dev` in each service directory, and start each service as the table says. That is the path for a VM without Docker and without a build toolchain.

Images run as the unprivileged `node` user and default to `NODE_ENV=production`. Running from source needs **Node.js 22 or newer** (26 is what the images use). Only `web` has a build step (TypeScript + Vite); its output is plain static files.

## 2. Database

One **PostgreSQL 14+** database, reachable from `api` only. Any flavour works: a package on a VM, a container, a StatefulSet, Amazon RDS. `api` needs a role that can create tables in that database.

Schema migrations live in `services/api/src/migrations/` and are applied by `api` itself:

- `MIGRATE_ON_START=true` (default): applied before the service starts listening. Safe with several replicas (advisory lock; late starters wait).
- `MIGRATE_ON_START=false`: run `node src/migrate.js` with `DATABASE_URL` set as a separate step (init container, pipeline job, Ansible task).

## 3. Environment variables

Every value is an environment variable. **Required** means the process exits at startup with a message naming the variable. There are no defaults for URLs or secrets.

### api

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://user:password@host:5432/dbname` (add `?sslmode=require` for managed databases) |
| `JWT_SECRET` | yes | ≥ 32 characters. Signs login tokens. |
| `SERVICE_TOKEN` | yes | ≥ 16 characters. Shared with `redirect`. |
| `PUBLIC_BASE_URL` | yes | Base of generated short URLs, e.g. `https://sho.rt`. The redirect service must answer there. |
| `ALLOWED_ORIGINS` | yes | Comma-separated CORS allow-list for the dashboard origin, or `*`. Not needed for correctness when web and api share an origin, but still required so the choice is explicit. |
| `PORT` | no | default `3000` |
| `BASE_PATH` | no | Mount prefix such as `/api` when a proxy routes by path **without** stripping the prefix (ALB cannot rewrite paths). Default: none. |
| `TRUST_PROXY` | no | Express `trust proxy`: `false` (default, directly exposed), `1` behind one proxy, `2` behind CloudFront → ALB, or a CIDR list. Affects rate-limit keys and logged client IPs. |
| `DB_POOL_SIZE` | no | default `10` |
| `MIGRATE_ON_START` | no | default `true` |
| `LOG_LEVEL` | no | `trace` … `fatal`, default `info` |
| `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN` | no | `1h`, `7d` |
| `LOGIN_RATE_LIMIT_WINDOW_MS`, `LOGIN_RATE_LIMIT_MAX` | no | `900000`, `10` — per replica, per client IP |
| `REGISTER_RATE_LIMIT_WINDOW_MS`, `REGISTER_RATE_LIMIT_MAX` | no | `900000`, `100` — per replica, per client IP |
| `URL_CREATE_RATE_LIMIT_WINDOW_MS`, `URL_CREATE_RATE_LIMIT_MAX` | no | `60000`, `60` — per replica |
| `HEALTH_TARGETS` | no | `name=url,name=url` probed by the dashboard's health page, e.g. `redirect=http://10.0.1.7:8080,web=http://10.0.1.8:3001`. Validated at startup. |
| `UPSTREAM_TIMEOUT_MS` | no | default `2000` |
| `AUTH_TRUSTED_PROXY` | no | `alb`: accept the identity an AWS Application Load Balancer forwards after authenticating the user (section 4a). Default: off. |
| `AUTH_TRUSTED_PROXY_SIGNER` | with `alb` | ARN of that load balancer (`arn:aws:elasticloadbalancing:<region>:<account>:loadbalancer/app/<name>/<id>`). Identities signed by any other load balancer are refused. |
| `AUTH_TRUSTED_PROXY_ADMINS` | with `alb` | Comma-separated e-mail addresses. A user who arrives through the proxy with one of these addresses is an admin; everyone else is a plain user. At least one address. |
| `NODE_ENV` | no | `production` refuses secrets containing `change-me` |

### redirect

| Variable | Required | Meaning |
|---|---|---|
| `API_URL` | yes | Base URL of api **as reachable from this service**, e.g. `http://10.0.1.5:3000` or `http://api:3000`. If api runs with `BASE_PATH`, include it. |
| `SERVICE_TOKEN` | yes | Same value as api's. |
| `PORT` | no | default `8080` |
| `TRUST_PROXY` | no | as above; affects the hashed visitor IP |
| `CACHE_TTL_SECONDS` | no | default `60`. `0` disables the in-process cache (every request goes to api). |
| `CACHE_NEGATIVE_TTL_SECONDS` | no | default `10` — how long an unknown slug is remembered |
| `CACHE_MAX_ENTRIES` | no | default `10000` |
| `CLICK_FLUSH_INTERVAL_MS`, `CLICK_BATCH_SIZE`, `CLICK_MAX_BUFFER` | no | `5000`, `200`, `10000` |
| `IP_HASH_SALT` | no | extra salt for visitor IP hashing (a daily salt is always applied) |
| `API_TIMEOUT_MS` | no | default `2000` |
| `LOG_LEVEL`, `NODE_ENV` | no | as above |

### web

| Variable | Required | Meaning |
|---|---|---|
| `API_BASE_URL` | yes | Base URL of api **as seen by the user's browser**: `/api` (same origin, path-routed) or `https://api.example.com`. |
| `PORT` | no | default `3001` |
| `LOG_LEVEL` | no | default `info` |

## 4. Ports and exposure

| Service | Port | Exposure |
|---|---|---|
| redirect | 8080 | **Public.** This is the short-link host. |
| web | 3001 | **Public** (admin users). |
| api | 3000 | **Public only if** the end-user API (`/auth/*`, `/urls`) is part of the exercise, or when path-routed behind the same proxy as web. Its `/internal/*` routes are protected by `SERVICE_TOKEN` and its `/metrics` route is unauthenticated: prefer keeping 3000 internal and routing `/api/*` through the proxy. |
| PostgreSQL | 5432 | **Never public.** Reachable from api only. |

All HTTP traffic between services is plain HTTP on the private network. TLS termination is the deployment's job (reverse proxy, load balancer, ingress).

### Reference topology (single origin)

```
https://sho.rt/           → web:3001
https://sho.rt/api/*      → api:3000   (api runs with BASE_PATH=/api, web with API_BASE_URL=/api)
https://sho.rt/<slug>     → redirect:8080
```

Alternative: separate hostnames per service and `ALLOWED_ORIGINS` set to the dashboard's origin.

Guarantees that make the single-origin routing safe: no static file served by web has a path starting with `/api`; slugs are exactly one path segment of `[A-Za-z0-9_-]{1,50}` and never contain a dot, so a rule like `^/[A-Za-z0-9_-]{1,50}$` identifies redirect traffic and leaves `/assets/...` and the entry files to web. The following words are reserved and can never be slugs: `health`, `ready`, `metrics`, `docs`, `openapi.json`, `api`, `admin`, `auth`, `urls`, `internal`, `oauth2` (the ALB's own sign-in callback lives under it), and the dashboard's own paths `login`, `users`, `config`, `status`, `assets`, `logo.svg`, `config.js`, `theme-boot.js`, `favicon.ico`.

A router that matches exact paths instead of patterns needs the list of what belongs to web: `/`, `/config.js`, `/theme-boot.js`, `/logo.svg`, `/logo-wordmark.svg`, `/logo-wordmark-dark.svg`, `/favicon.ico`, `/assets/*`, `/login`, `/users`, `/users/*`, `/urls`, `/config` and `/status`; `/api/*` is api; everything else is a slug. `/api/internal/*` must be blocked at the edge: only redirect needs it, and it must never be reachable from outside.

### 4a. Single sign-on through the edge (optional)

The dashboard normally signs in with an admin's API key. A deployment can instead put the dashboard behind an identity provider at the edge, with no change to the application: an AWS Application Load Balancer that has authenticated a request forwards the user's claims in a signed `x-amzn-oidc-data` header, and api turns that identity into its own session.

What the deployment provides:

- api runs with `AUTH_TRUSTED_PROXY=alb`, `AUTH_TRUSTED_PROXY_SIGNER=<the load balancer's ARN>` and `AUTH_TRUSTED_PROXY_ADMINS=<e-mail addresses of the admins>`.
- The identity header exists only on requests the load balancer authenticated itself. api reads it on `GET /auth/sso` and nowhere else. Which paths the load balancer authenticates is the deployment's design, within two constraints: the dashboard's paths (section 4) and `/api/auth/sso` need the identity; `/api/*` otherwise, the slugs and the ops endpoints must stay open, so the public redirect, the end-user API with API keys and the health checks keep working.
- The dashboard calls `/api/auth/sso` from JavaScript and expects a plain 401 when no session exists. A redirect to the identity provider on that path breaks the call.
- The identity provider must return an e-mail address. It is the account's key: a user is found or created by e-mail on first sign-in.

What api does on `GET /auth/sso`:

1. Verifies the header with AWS's `aws-jwt-verify` library: signature against the regional ELB public key named by the token's `kid`, `signer` equal to `AUTH_TRUSTED_PROXY_SIGNER`, expiry.
2. Finds or creates the user by e-mail. A user created this way has a random password and can only sign in through the proxy. An address in `AUTH_TRUSTED_PROXY_ADMINS` becomes (or stays) admin; the list never demotes.
3. Returns the same token pair as `POST /auth/login` (`token`, `refreshToken`, `userId`, `role`, `email`).

Without the mode, `GET /auth/sso` answers 404 and `GET /auth/providers` reports `sso: false`; the dashboard then shows only the API-key form. With the mode, the dashboard's login page signs the user in automatically, and the admin routes accept the bearer token next to the API key. Signing out of the dashboard ends the api session only; the session at the edge lasts as long as the deployment lets it, so "Sign in with single sign-on" on the login page needs no new password until then. A full sign-out is the identity provider's logout endpoint, which this application does not drive.

Anyone porting this to another edge (Envoy Gateway with Keycloak, oauth2-proxy) needs a second mode here: the header format and the key endpoint are ALB-specific.

## 5. Health, readiness, metrics

Every service exposes, on its own port:

| Path | Purpose | Notes |
|---|---|---|
| `GET /health` | liveness | cheap, no dependencies; use for container/instance health checks |
| `GET /ready` | readiness | api checks the database and returns 503 when it is unreachable. redirect is ready as soon as it listens and **stays ready while api is down** (it serves cached slugs, including expired ones, until api is back); its body reports `api: reachable|unhealthy|unreachable`. web is always ready. |
| `GET /metrics` | Prometheus | unauthenticated; keep it off the public internet |

With `BASE_PATH` set, api serves these at the root **and** under the prefix.

Logs are JSON lines on stdout (pino), one object per request, with `X-Request-ID` propagated from redirect to api and echoed in responses.

## 6. Startup, shutdown, restarts

**Startup order is not enforced by the application.** If `api` starts before PostgreSQL is reachable, its migration step fails and the process exits with code 1. A proper restart policy is advisable.

All services handle `SIGTERM`: stop accepting connections, finish in-flight requests, flush buffered click events (redirect), close the database pool (api), exit 0 within 15 seconds. Give them at least that long (`terminationGracePeriodSeconds` ≥ 15, `TimeoutStopSec` ≥ 15).

## 6a. Behaviour notes for anyone porting microshort 1 tooling

- Slugs are **case-sensitive**: `Abc` and `abc` are different links (v1's MySQL collation folded case).
- `DELETE` endpoints answer **204 No Content** (v1 answered 200 with a body).
- `/health` answers JSON `{ "status": "ok", "service": "<name>" }` (v1 answered text `OK`); use the `service` field to check which service a proxy routed you to.
- Rate-limit headers follow IETF draft 8: a single `RateLimit` header plus `RateLimit-Policy` (v1 sent `RateLimit-Limit/-Remaining/-Reset`).
- `GET /urls` is paginated (`{ urls, nextCursor }`, default 50, `?limit&cursor`).

## 7. Secrets

Three values are secrets: `DATABASE_URL` (contains the password), `JWT_SECRET`, `SERVICE_TOKEN`. The services read them from the environment and nowhere else, so every injection mechanism works: an `EnvironmentFile=` in a systemd unit, Ansible Vault, Docker/Kubernetes Secrets, AWS SSM Parameter Store or Secrets Manager fed into the task or instance environment.
