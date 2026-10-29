import { describe, it, expect, beforeAll } from 'vitest';
import {
  API_URL, REDIRECT_URL, WEB_URL, registerUser, createApiKey, createShortUrl, adminGet, eventually, json,
} from './helpers.js';

// Black-box tests against a LIVE stack. Base URLs come from the environment.
//
// Admin tests need an admin API key. On a fresh database the first registered
// user is admin, so the bootstrap below yields one; on a shared/reused
// database pass ADMIN_API_KEY=msh_... instead. Without either, the admin
// block is skipped loudly rather than silently passing.
const bootstrap = await registerUser('bootstrap');
const adminKey = bootstrap.role === 'admin'
  ? await createApiKey(bootstrap.token, 'bootstrap-admin')
  : (process.env.ADMIN_API_KEY || null);
if (!adminKey) {
  console.warn('[integration] no admin key available (database not fresh and ADMIN_API_KEY unset): admin tests skipped');
}

const post = (url, body, headers = {}) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

describe('ops endpoints', () => {
  // it.for (not it.each) so the test context with skip() is available.
  it.for([
    ['api', API_URL],
    ['redirect', REDIRECT_URL],
    ['web', WEB_URL],
  ])('%s exposes /health, /ready and /metrics', async ([name, base], { skip }) => {
    // In the single-origin topology web and redirect share a host and the
    // proxy sends /health, /ready and /metrics to redirect (they look like
    // slugs). web's ops endpoints are then only reachable inside the network.
    if (name === 'web' && WEB_URL === REDIRECT_URL) skip('web shares its origin with redirect; its ops endpoints are not routable from outside');
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    // Behind a single-origin proxy /health may be routed elsewhere; the body
    // says which service actually answered, so assert it.
    expect((await health.json()).service).toBe(name);
    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(200);
    const metrics = await fetch(`${base}/metrics`);
    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain(`microshort_${name}_`);
  });

  it('api serves OpenAPI docs', async () => {
    const res = await fetch(`${API_URL}/openapi.json`);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.paths['/urls']).toBeDefined();
    expect(spec.paths['/admin/stats']).toBeDefined();
    const ui = await fetch(`${API_URL}/docs/`);
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain('swagger-ui');
  });

  it('web serves runtime config and a self-contained bundle, no CDN', async ({ skip }) => {
    // Behind an edge that authenticates the dashboard (contract 4a) every
    // dashboard path answers with a redirect to the identity provider; the
    // static files can then only be checked with a browser session.
    const edge = await fetch(`${WEB_URL}/config.js`, { redirect: 'manual' });
    if (edge.status === 302 && /\/oauth2\/authorize/.test(edge.headers.get('location') ?? '')) {
      skip('the dashboard sits behind single sign-on at the edge; its static files need a browser session');
    }
    const cfg = await fetch(`${WEB_URL}/config.js`);
    expect(cfg.status).toBe(200);
    expect(cfg.headers.get('cache-control')).toBe('no-store');
    expect(await cfg.text()).toContain('MICROSHORT_CONFIG');

    const indexRes = await fetch(`${WEB_URL}/`);
    expect(indexRes.headers.get('cache-control')).toBe('no-cache');
    const index = await indexRes.text();
    expect(index).toContain('src="/config.js"');
    expect(index).not.toMatch(/https?:\/\/(cdn\.|unpkg|jsdelivr)/i);

    // Every asset the entry page references must be served from here, hashed and immutable.
    const assets = [...index.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
    expect(assets.length).toBeGreaterThan(0);
    for (const file of assets) {
      const res = await fetch(`${WEB_URL}${file}`);
      expect(res.status, file).toBe(200);
      expect(res.headers.get('cache-control'), file).toContain('immutable');
    }
    // SPA deep links are served by the entry page.
    expect((await fetch(`${WEB_URL}/users/1`)).status).toBe(200);
  });

  it('echoes or generates X-Request-ID', async () => {
    const echoed = await fetch(`${API_URL}/health`, { headers: { 'X-Request-ID': 'test-req-123' } });
    expect(echoed.headers.get('x-request-id')).toBe('test-req-123');
    const generated = await fetch(`${API_URL}/health`);
    expect(generated.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const viaRedirect = await fetch(`${REDIRECT_URL}/health`);
    expect(viaRedirect.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('auth', () => {
  it('validates registration input', async () => {
    expect((await post(`${API_URL}/auth/register`, { email: 'not-an-email', password: 'long-enough-1' })).status).toBe(400);
    expect((await post(`${API_URL}/auth/register`, { email: 'x@example.test', password: 'short' })).status).toBe(400);
    expect((await post(`${API_URL}/auth/register`, { password: 'long-enough-1' })).status).toBe(400);
  });

  it('refuses duplicate e-mails case-insensitively', async () => {
    const u = await registerUser('dup');
    const again = await post(`${API_URL}/auth/register`, { email: u.email.toUpperCase(), password: 'another-pass-1' });
    expect(again.status).toBe(409);
  });

  it('logs in, rejects bad credentials with 401 and bad requests with 400', async () => {
    const u = await registerUser('login');
    const ok = await post(`${API_URL}/auth/login`, { email: u.email, password: u.password });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect((await post(`${API_URL}/auth/login`, { email: u.email, password: 'wrong-password-1' })).status).toBe(401);
    expect((await post(`${API_URL}/auth/login`, { email: 'nobody@example.test', password: 'wrong-password-1' })).status).toBe(401);
    expect((await post(`${API_URL}/auth/login`, { email: u.email })).status).toBe(400);
  });

  it('refreshes tokens; 400 for a missing or wrong-type token', async () => {
    const u = await registerUser('refresh');
    const ok = await post(`${API_URL}/auth/refresh`, { refreshToken: u.refreshToken });
    expect(ok.status).toBe(200);
    expect((await ok.json()).token).toBeTruthy();
    expect((await post(`${API_URL}/auth/refresh`, {})).status).toBe(400);
    expect((await post(`${API_URL}/auth/refresh`, { refreshToken: u.token })).status).toBe(400);
    expect((await post(`${API_URL}/auth/refresh`, { refreshToken: 'garbage' })).status).toBe(401);
  });

  it('GET /auth/me needs a bearer token', async () => {
    const u = await registerUser('me');
    const ok = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${u.token}` } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).email).toBe(u.email);
    expect((await fetch(`${API_URL}/auth/me`)).status).toBe(401);
  });

  it('API keys: shown once, listed without the secret, revocable, hidden once revoked', async () => {
    const u = await registerUser('keys');
    const auth = { Authorization: `Bearer ${u.token}` };
    const created = await post(`${API_URL}/auth/api-keys`, { name: 'tool' }, auth);
    expect(created.status).toBe(201);
    const { apiKey, keyId } = await created.json();
    expect(apiKey).toMatch(/^msh_/);

    const list = await (await fetch(`${API_URL}/auth/api-keys`, { headers: auth })).json();
    expect(list.keys).toHaveLength(1);
    expect(list.keys[0]).not.toHaveProperty('apiKey');
    expect(list.keys[0]).not.toHaveProperty('key');
    expect(list.keys[0].keyPrefix).toBe(apiKey.slice(0, 8));

    expect((await fetch(`${API_URL}/urls`, { headers: { 'X-API-Key': apiKey } })).status).toBe(200);

    const revoke = await fetch(`${API_URL}/auth/api-keys/${keyId}`, { method: 'DELETE', headers: auth });
    expect(revoke.status).toBe(204);
    expect((await fetch(`${API_URL}/urls`, { headers: { 'X-API-Key': apiKey } })).status).toBe(401);
    expect((await fetch(`${API_URL}/auth/api-keys/${keyId}`, { method: 'DELETE', headers: auth })).status).toBe(404);

    const after = await (await fetch(`${API_URL}/auth/api-keys`, { headers: auth })).json();
    expect(after.keys).toHaveLength(0);
    const withRevoked = await (await fetch(`${API_URL}/auth/api-keys?includeRevoked=true`, { headers: auth })).json();
    expect(withRevoked.keys).toHaveLength(1);
    expect(withRevoked.keys[0].revokedAt).toBeTruthy();
  });
});

describe('short URLs', () => {
  let apiKey;
  beforeAll(async () => {
    const user = await registerUser('urls');
    apiKey = await createApiKey(user.token);
  });

  it('shortens, redirects with 302 + no-store, and counts the click', async () => {
    const target = `https://example.com/smoke/${Date.now()}`;
    const { status, body } = await createShortUrl(apiKey, target);
    expect(status).toBe(201);
    expect(body.slug).toMatch(/^[A-Za-z0-9_-]{6}$/);
    expect(body.shortUrl.endsWith(`/${body.slug}`)).toBe(true);
    expect(body).toMatchObject({ longUrl: target, clicks: 0 });
    expect(body).toHaveProperty('createdAt');
    expect(body).not.toHaveProperty('long_url');

    const hop = await fetch(`${REDIRECT_URL}/${body.slug}`, { redirect: 'manual' });
    expect(hop.status).toBe(302);
    expect(hop.headers.get('location')).toBe(target);
    expect(hop.headers.get('cache-control')).toBe('no-store');

    const counted = await eventually(async () => {
      const res = await fetch(`${API_URL}/urls/${body.slug}`, { headers: { 'X-API-Key': apiKey } });
      const data = await json(res);
      return data.clicks >= 1 ? data : null;
    });
    expect(counted.clicks).toBeGreaterThanOrEqual(1);

    const mine = await (await fetch(`${API_URL}/urls`, { headers: { 'X-API-Key': apiKey } })).json();
    expect(mine.urls.map(u => u.slug)).toContain(body.slug);
  });

  it('validates destinations with v1 messages', async () => {
    expect((await createShortUrl(apiKey, undefined)).body.error).toBe('URL required');
    expect((await createShortUrl(apiKey, 'not a url')).body.error).toBe('Invalid URL format');
    expect((await createShortUrl(apiKey, 'ftp://example.com/x')).body.error).toBe('Only http and https URLs are allowed');
    expect((await createShortUrl(apiKey, 'https://example.com/x', 'bad slug!')).status).toBe(400);
    expect((await fetch(`${API_URL}/urls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
  });

  it('honours custom slugs through the redirect, refuses duplicates and reserved words', async () => {
    const slug = `smoke-${Date.now().toString(36)}`;
    expect((await createShortUrl(apiKey, 'https://example.com/a', slug)).status).toBe(201);
    const hop = await fetch(`${REDIRECT_URL}/${slug}`, { redirect: 'manual' });
    expect(hop.status).toBe(302);
    expect(hop.headers.get('location')).toBe('https://example.com/a');
    const dup = await createShortUrl(apiKey, 'https://example.com/b', slug);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already in use/i);
    expect((await createShortUrl(apiKey, 'https://example.com/c', 'health')).status).toBe(400);
    // null / empty customSlug means "generate one"
    expect((await createShortUrl(apiKey, 'https://example.com/d', '')).status).toBe(201);
  });

  it('returns 404 for unknown slugs on both services', async () => {
    const nope = `definitely-not-a-slug-${Date.now()}`;
    expect((await fetch(`${REDIRECT_URL}/${nope}`, { redirect: 'manual' })).status).toBe(404);
    expect((await fetch(`${API_URL}/urls/${nope}`, { headers: { 'X-API-Key': apiKey } })).status).toBe(404);
  });

  it('update and delete: 401 without key, 403 for another user, 404 unknown, admin may override', async () => {
    const other = await registerUser('other');
    const otherKey = await createApiKey(other.token);
    const { body } = await createShortUrl(apiKey, 'https://example.com/before');
    const hdr = k => ({ 'Content-Type': 'application/json', 'X-API-Key': k });

    expect((await fetch(`${API_URL}/urls/${body.slug}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"url":"https://example.com/x"}' })).status).toBe(401);
    const foreign = await fetch(`${API_URL}/urls/${body.slug}`, { method: 'PUT', headers: hdr(otherKey), body: '{"url":"https://example.com/x"}' });
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).error).toMatch(/forbidden/i);
    expect((await fetch(`${API_URL}/urls/${body.slug}`, { method: 'DELETE', headers: hdr(otherKey) })).status).toBe(403);
    expect((await fetch(`${API_URL}/urls/${body.slug}`, { headers: hdr(otherKey) })).status).toBe(403);
    expect((await fetch(`${API_URL}/urls/nope-${Date.now()}`, { method: 'DELETE', headers: hdr(apiKey) })).status).toBe(404);

    const upd = await fetch(`${API_URL}/urls/${body.slug}`, { method: 'PUT', headers: hdr(apiKey), body: '{"url":"https://example.com/after"}' });
    expect(upd.status).toBe(200);
    expect((await upd.json()).longUrl).toBe('https://example.com/after');
    expect((await fetch(`${API_URL}/urls/${body.slug}`, { method: 'PUT', headers: hdr(apiKey), body: '{"url":"ftp://x"}' })).status).toBe(400);

    // The redirect may still serve the cached destination until the TTL
    // expires (per-replica cache, see DESIGN.md §7); it must never error.
    const hop = await fetch(`${REDIRECT_URL}/${body.slug}`, { redirect: 'manual' });
    expect(hop.status).toBe(302);
    expect(['https://example.com/before', 'https://example.com/after']).toContain(hop.headers.get('location'));

    if (adminKey) {
      expect((await fetch(`${API_URL}/urls/${body.slug}`, { method: 'DELETE', headers: hdr(adminKey) })).status).toBe(204);
    } else {
      expect((await fetch(`${API_URL}/urls/${body.slug}`, { method: 'DELETE', headers: hdr(apiKey) })).status).toBe(204);
    }
    expect((await fetch(`${API_URL}/urls/${body.slug}`, { headers: hdr(apiKey) })).status).toBe(404);
  });
});

describe('internal endpoints (service token)', () => {
  const token = process.env.SERVICE_TOKEN || 'change-me-local-only-service-token';

  // A deployment may block /internal/* at its edge (a 403 from the proxy) on
  // top of the token check; both answers mean "not for you".
  it('reject a missing or wrong token', async () => {
    expect([401, 403]).toContain((await fetch(`${API_URL}/internal/urls/anything`)).status);
    expect([401, 403]).toContain((await fetch(`${API_URL}/internal/urls/anything`, { headers: { 'X-Service-Token': 'wrong' } })).status);
    expect([401, 403]).toContain((await post(`${API_URL}/internal/clicks`, { events: [] })).status);
  });

  it('resolve slugs and accept click batches, reporting unknown slugs', async ({ skip }) => {
    const probe = await fetch(`${API_URL}/internal/urls/probe`, { headers: { 'X-Service-Token': token } });
    if (probe.status === 403) skip('internal endpoints are blocked at the edge of this deployment');
    if (probe.status === 401) skip('SERVICE_TOKEN of this deployment is not known to the test (set SERVICE_TOKEN)');
    const user = await registerUser('internal');
    const key = await createApiKey(user.token);
    const { body } = await createShortUrl(key, 'https://example.com/internal');
    const resolved = await fetch(`${API_URL}/internal/urls/${body.slug}`, { headers: { 'X-Service-Token': token } });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({ slug: body.slug, longUrl: 'https://example.com/internal' });
    expect((await fetch(`${API_URL}/internal/urls/nope-${Date.now()}`, { headers: { 'X-Service-Token': token } })).status).toBe(404);

    const batch = await post(`${API_URL}/internal/clicks`, {
      events: [
        { slug: body.slug, ts: new Date().toISOString(), referrer: null, userAgent: 'vitest', ipHash: null },
        { slug: body.slug, ts: new Date().toISOString() },
        { slug: 'no-such-slug-xyz', ts: new Date().toISOString() },
      ],
    }, { 'X-Service-Token': token });
    expect(batch.status).toBe(202);
    expect(await batch.json()).toEqual({ accepted: 2, unknownSlugs: ['no-such-slug-xyz'] });
    const after = await (await fetch(`${API_URL}/urls/${body.slug}`, { headers: { 'X-API-Key': key } })).json();
    expect(after.clicks).toBe(2);
  });
});

describe.skipIf(!adminKey)('admin API', () => {
  it('non-admin keys are refused on every admin route', async () => {
    const u = await registerUser('nonadmin');
    const k = await createApiKey(u.token);
    for (const path of ['/admin/dashboard', '/admin/stats', '/admin/users', '/admin/urls', '/admin/config', '/admin/health/services']) {
      expect((await adminGet(k, path)).status, path).toBe(403);
    }
    expect((await adminGet('msh_000000000000000000000000000000000', '/admin/dashboard')).status).toBe(401);
    expect((await fetch(`${API_URL}/admin/dashboard`)).status).toBe(401);
  });

  it('dashboard and stats have the documented shape', async () => {
    const dash = await adminGet(adminKey, '/admin/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.users).toMatchObject({ total: expect.any(Number), admins: expect.any(Number), recentSignups: expect.any(Number), totalApiKeys: expect.any(Number) });
    expect(dash.body.urls).toMatchObject({ total: expect.any(Number), totalClicks: expect.any(Number), recentUrls: expect.any(Number) });
    expect(dash.body.clicks.last7Days).toHaveLength(7);
    expect(dash.body.clicks.last7Days[6].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dash.body.publicBaseUrl).toMatch(/^https?:\/\//);

    const stats = await adminGet(adminKey, '/admin/stats');
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ totalUsers: expect.any(Number), totalUrls: expect.any(Number), topUrls: expect.any(Array) });
    if (stats.body.topUrls.length > 0) expect(stats.body.topUrls[0]).toHaveProperty('longUrl');
  });

  it('users list, user detail, URL list and search use camelCase', async () => {
    const u = await registerUser('detail');
    const k = await createApiKey(u.token, 'detail-key');
    const marker = `findme-${Date.now().toString(36)}`;
    await createShortUrl(k, `https://example.com/${marker}`);

    const users = await adminGet(adminKey, '/admin/users?limit=5');
    expect(users.status).toBe(200);
    expect(users.body.users[0]).toMatchObject({ id: expect.any(Number), email: expect.any(String), role: expect.any(String), createdAt: expect.any(String), urlCount: expect.any(Number) });

    const detail = await adminGet(adminKey, `/admin/users/${u.userId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.user.email).toBe(u.email);
    expect(detail.body.apiKeys).toHaveLength(1);
    expect(detail.body.apiKeys[0]).not.toHaveProperty('apiKey');
    expect(detail.body.urls).toHaveLength(1);
    expect((await adminGet(adminKey, '/admin/users/12abc')).status).toBe(400);
    expect((await adminGet(adminKey, '/admin/users/999999999')).status).toBe(404);

    const list = await adminGet(adminKey, `/admin/urls?q=${marker}`);
    expect(list.status).toBe(200);
    expect(list.body.urls).toHaveLength(1);
    expect(list.body.urls[0]).toMatchObject({ longUrl: `https://example.com/${marker}`, userEmail: u.email });
    expect(list.body.urls[0]).not.toHaveProperty('long_url');

    const search = await adminGet(adminKey, `/admin/search/urls?q=${marker}`);
    expect(search.status).toBe(200);
    expect(search.body.urls).toHaveLength(1);
    expect((await adminGet(adminKey, '/admin/search/urls')).status).toBe(400);
    // % is a literal, not a wildcard
    expect((await adminGet(adminKey, '/admin/urls?q=%25')).body.urls).toHaveLength(0);
  });

  it('config: read, override in memory, reject bad values, accept the v1 "domain" alias', async () => {
    const before = await adminGet(adminKey, '/admin/config');
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ publicBaseUrl: expect.any(String), source: expect.any(String), envValue: expect.any(String) });
    const put = (body, key = adminKey) => fetch(`${API_URL}/admin/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-API-Key': key }, body: JSON.stringify(body),
    });
    expect((await put({ publicBaseUrl: 'not a url' })).status).toBe(400);
    expect((await fetch(`${API_URL}/admin/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
    // https: a production deployment refuses http overrides.
    const changed = await put({ domain: 'https://override.example.test' });
    expect(changed.status).toBe(200);
    const changedBody = await changed.json();
    expect(changedBody.publicBaseUrl).toBe('https://override.example.test');
    expect(changedBody.source).toBe('runtime-override');
    expect(changedBody.note).toMatch(/in-memory/i);
    // restore
    expect((await put({ publicBaseUrl: before.body.envValue })).status).toBe(200);
  });

  it('health/services reports api and database and any configured targets', async () => {
    const res = await adminGet(adminKey, '/admin/health/services');
    expect(res.status).toBe(200);
    expect(res.body.checkedAt).toBeTruthy();
    const byName = Object.fromEntries(res.body.services.map(s => [s.name, s]));
    expect(byName.api.status).toBe('healthy');
    expect(byName.database.status).toBe('healthy');
    expect(byName.database.responseTimeMs).toEqual(expect.any(Number));
  });

  it('admin routes also accept an admin bearer token, and refuse a plain user\'s', async () => {
    if (bootstrap.role !== 'admin') return; // shared database: no admin token to hand
    const mine = await fetch(`${API_URL}/admin/dashboard`, { headers: { Authorization: `Bearer ${bootstrap.token}` } });
    expect(mine.status).toBe(200);
    const plain = await registerUser('plain');
    const theirs = await fetch(`${API_URL}/admin/dashboard`, { headers: { Authorization: `Bearer ${plain.token}` } });
    expect(theirs.status).toBe(403);
  });
});

describe('single sign-on (contract 4a)', () => {
  it('advertises the sign-in methods and answers 404 on /auth/sso while the mode is off', async () => {
    const providers = await (await fetch(`${API_URL}/auth/providers`)).json();
    expect(providers).toMatchObject({ apiKey: true, sso: expect.any(Boolean) });
    const sso = await fetch(`${API_URL}/auth/sso`);
    // Off: 404. On (behind a real proxy): 401 for a request without the proxy's identity.
    expect(sso.status).toBe(providers.sso ? 401 : 404);
  });
});
