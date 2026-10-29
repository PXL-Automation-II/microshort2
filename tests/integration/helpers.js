// Black-box helpers. Every base URL is overridable so this suite doubles as a
// post-deployment smoke test:
//   API_URL=https://api.example.com REDIRECT_URL=https://sho.rt WEB_URL=https://admin.example.com npm test
export const API_URL = (process.env.API_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const REDIRECT_URL = (process.env.REDIRECT_URL || 'http://localhost:8080').replace(/\/+$/, '');
export const WEB_URL = (process.env.WEB_URL || 'http://localhost:3001').replace(/\/+$/, '');

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

export async function registerUser(prefix = 'it') {
  const email = `${prefix}-${unique()}@example.test`;
  const password = 'integration-pass-1';
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await json(res);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(body)}`);
  return { email, password, ...body };
}

export async function createApiKey(token, name = 'integration') {
  const res = await fetch(`${API_URL}/auth/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  const body = await json(res);
  if (res.status !== 201) throw new Error(`api key failed: ${res.status} ${JSON.stringify(body)}`);
  return body.apiKey;
}

export async function createShortUrl(apiKey, url, customSlug) {
  const res = await fetch(`${API_URL}/urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ url, ...(customSlug ? { customSlug } : {}) }),
  });
  return { status: res.status, body: await json(res) };
}

export async function adminGet(apiKey, path) {
  const res = await fetch(`${API_URL}${path}`, { headers: { 'X-API-Key': apiKey } });
  return { status: res.status, body: await json(res) };
}

// Poll until fn() resolves truthy or the deadline passes (click batching is async).
export async function eventually(fn, { timeoutMs = 15_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`condition not met within ${timeoutMs}ms (last: ${JSON.stringify(last)})`);
}
