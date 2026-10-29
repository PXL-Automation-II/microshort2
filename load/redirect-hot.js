// k6 script: hammer the redirect hot path with a small set of slugs.
// Setup creates the slugs through the API with the given API key.
import http from 'k6/http';
import { check, sleep } from 'k6';

const REDIRECT_URL = __ENV.REDIRECT_URL || 'http://localhost:8080';
const API_URL = __ENV.API_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY;
const SLUG_COUNT = Number(__ENV.SLUG_COUNT || 20);

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<250'],
  },
};

export function setup() {
  if (!API_KEY) throw new Error('API_KEY is required');
  const slugs = [];
  for (let i = 0; i < SLUG_COUNT; i++) {
    const res = http.post(`${API_URL}/urls`, JSON.stringify({ url: `https://example.com/load/${i}` }), {
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    });
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.body}`);
    slugs.push(res.json('slug'));
  }
  return { slugs };
}

export default function ({ slugs }) {
  const slug = slugs[Math.floor(Math.random() * slugs.length)];
  const res = http.get(`${REDIRECT_URL}/${slug}`, { redirects: 0 });
  check(res, { 'is 302': r => r.status === 302 });
  sleep(0.1);
}
