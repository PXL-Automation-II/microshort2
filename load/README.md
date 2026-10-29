# Load tests (reference scripts)

These [k6](https://k6.io) scripts are references for the load-testing and
monitoring assignment. They are not part of the application and students are
expected to deploy their own Prometheus/Grafana and adapt the scripts.

```bash
# against the local compose stack
k6 run -e REDIRECT_URL=http://localhost:8080 -e API_URL=http://localhost:3000 -e API_KEY=msh_... load/redirect-hot.js
```

| Script | What it exercises |
|---|---|
| `redirect-hot.js` | N virtual users hitting a small set of slugs — cache hit path, click batching, api write load |
| `create-urls.js` | URL creation through the API — rate limiting, DB inserts |

Dials to turn while watching `/metrics`: redirect replica
count, `CACHE_TTL_SECONDS`, `DB_POOL_SIZE`, `CLICK_BATCH_SIZE`.
