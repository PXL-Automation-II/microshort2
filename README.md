# microshort 2

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="services/web/public/logo-wordmark-dark.svg">
  <img src="services/web/public/logo-wordmark.svg" alt="microshort" width="272" height="64">
</picture>

A URL shortener built as **three small services and one PostgreSQL database**.

> The application provides functionality and a configuration contract.
> The students provide the infrastructure.

| Service | Port | What it does |
|---|---|---|
| **api** | 3000 | System of record. Users, login (JWT), API keys, short URLs, click counts, admin API, Swagger at `/docs`. The only service that talks to PostgreSQL. |
| **redirect** | 8080 | The public hot path. Resolves a slug through api, caches it in memory, answers `302`, batches click events back to api. Stateless. |
| **web** | 3001 | Admin dashboard (React + shadcn/ui, built with Vite). Static files plus one runtime-generated `/config.js` that tells the browser where api is. |

```
  Visitor ──▶ redirect :8080 ──▶ api :3000 ──▶ PostgreSQL
                  │ click events ▲
                  └──────────────┘
  Admin ──▶ web :3001 ──(browser)──▶ api
```

Everything a deployer needs: [DEPLOYMENT-CONTRACT.md](./DEPLOYMENT-CONTRACT.md).

---

## Run it locally (reference stack)

Requires Docker with Compose v2. This compose file is for local development and CI only.

```bash
cp .env.example .env     # placeholders are fine locally
npm start                # docker compose up -d --build --wait
```

| URL | |
|---|---|
| http://localhost:3001 | Admin dashboard (log in with an admin API key, or through single sign-on when the deployment enables it, contract 4a) |
| http://localhost:3000/docs | api Swagger UI |
| http://localhost:8080/<slug> | Short links |

```bash
npm run logs             # follow logs
npm stop                 # docker compose down
npm run reset            # wipe the database and start fresh
```

## Your first short link

```bash
# 1. Register. The FIRST user becomes admin. Password >= 8 characters.
curl -s -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"super-secret-1"}'
# → {"token":"eyJ...","refreshToken":"...","userId":1,"role":"admin"}

# 2. Create an API key with the JWT. The msh_... key is shown ONCE.
curl -s -X POST http://localhost:3000/auth/api-keys \
  -H 'Authorization: Bearer eyJ...' -H 'Content-Type: application/json' \
  -d '{"name":"my first key"}'
# → {"apiKey":"msh_...","keyId":1,"name":"my first key"}

# 3. Shorten.
curl -s -X POST http://localhost:3000/urls \
  -H 'X-API-Key: msh_...' -H 'Content-Type: application/json' \
  -d '{"url":"https://en.wikipedia.org/wiki/URL_shortening","customSlug":"wiki"}'
# → {"slug":"wiki","shortUrl":"http://localhost:8080/wiki",...}

# 4. Follow it.
curl -I http://localhost:8080/wiki
# → HTTP/1.1 302 Found / Location: https://en.wikipedia.org/wiki/URL_shortening
```

Open the dashboard at http://localhost:3001 with the `msh_…` key to see users, URLs, clicks per day and service health.

## Tests

```bash
# unit tests inside a service
cd services/api && npm test
cd services/redirect && npm test

# black-box integration tests against the running stack
npm test
# the same suite as a post-deployment smoke test
API_URL=https://api.example.com REDIRECT_URL=https://sho.rt WEB_URL=https://admin.example.com npm test
```

## Developing a single service

api and redirect are Node.js ESM with no build step.

```bash
cd services/<api|redirect>
npm install
# set the required variables (see DEPLOYMENT-CONTRACT.md), then
npm run dev              # node --watch
```

api needs a PostgreSQL to point `DATABASE_URL` at; `docker compose up -d db` gives you one on localhost:5432.

web is a React + TypeScript app built with Vite:

```bash
cd services/web
npm install
npm run dev              # Vite dev server on http://localhost:5173, API at VITE_API_BASE_URL (default http://localhost:3000)
npm run build            # type-check and bundle to dist/
npm start                # serve dist/ with the Express server (needs API_BASE_URL)
```

## Repository layout

```
services/api        Express 5 + pg + node-pg-migrate   (src/migrations/*.sql)
services/redirect   Express 5 + lru-cache
services/web        React 19 + TypeScript + Vite + shadcn/ui dashboard; Express 5 server for dist/ and /config.js
tests/integration   vitest, HTTP only, base URLs from env
load/               k6 reference scripts for the load-testing assignment
compose.yml         local reference stack
```

## License

AGPL-3.0, see [LICENSE](./LICENSE).
