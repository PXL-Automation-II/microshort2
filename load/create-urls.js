// k6 script: URL creation load. Expect 429s once the per-replica
// URL_CREATE_RATE_LIMIT_MAX is exceeded — that is the point.
import http from 'k6/http';
import { check } from 'k6';

const API_URL = __ENV.API_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY;

export const options = {
  vus: 10,
  duration: '1m',
};

export default function () {
  const res = http.post(`${API_URL}/urls`, JSON.stringify({ url: `https://example.com/${__VU}/${__ITER}` }), {
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
  });
  check(res, { 'created or rate limited': r => r.status === 201 || r.status === 429 });
}
