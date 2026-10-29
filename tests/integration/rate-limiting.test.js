import { describe, it, expect } from 'vitest';
import { API_URL, registerUser, createApiKey } from './helpers.js';

// Runs ONLY against a stack started with compose.test.override.yml, which sets
// tiny limits and short windows:  npm run test:e2e:rate
// Limits are per api replica and per client IP (see TRUST_PROXY).
const LOGIN_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX || 3);
const URL_MAX = Number(process.env.URL_CREATE_RATE_LIMIT_MAX || 5);
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 5000);

const post = (url, body, headers = {}) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

describe('rate limiting (test profile)', () => {
  it('limits login attempts, sends draft-8 headers, recovers after the window', async () => {
    const u = await registerUser('rl-login');
    let last;
    for (let i = 0; i < LOGIN_MAX; i++) {
      last = await post(`${API_URL}/auth/login`, { email: u.email, password: 'wrong-password-1' });
      expect(last.status).toBe(401);
    }
    expect(last.headers.get('ratelimit')).toBeTruthy();
    expect(last.headers.get('ratelimit-policy')).toContain(`q=${LOGIN_MAX}`);
    const blocked = await post(`${API_URL}/auth/login`, { email: u.email, password: u.password });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/login attempts/i);
    await new Promise(r => setTimeout(r, WINDOW_MS + 500));
    expect((await post(`${API_URL}/auth/login`, { email: u.email, password: u.password })).status).toBe(200);
  });

  it('limits URL creation per key holder and recovers', async () => {
    const u = await registerUser('rl-urls');
    const key = await createApiKey(u.token);
    const hdr = { 'X-API-Key': key };
    for (let i = 0; i < URL_MAX; i++) {
      expect((await post(`${API_URL}/urls`, { url: `https://example.com/rl/${i}` }, hdr)).status).toBe(201);
    }
    const blocked = await post(`${API_URL}/urls`, { url: 'https://example.com/rl/over' }, hdr);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/URLs created/i);
    await new Promise(r => setTimeout(r, WINDOW_MS + 500));
    expect((await post(`${API_URL}/urls`, { url: 'https://example.com/rl/after' }, hdr)).status).toBe(201);
  });
});
