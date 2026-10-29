import { upstreamDuration } from './metrics.js';

// The only way redirect talks to the rest of the system.
export function createApiClient({ baseUrl, serviceToken, timeoutMs, logger }) {
  const base = baseUrl.replace(/\/+$/, '');

  async function call(op, path, init = {}) {
    const end = upstreamDuration.startTimer({ op });
    let status = 'error';
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          'X-Service-Token': serviceToken,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = String(res.status);
      return res;
    } finally {
      end({ op, status });
    }
  }

  return {
    // Returns { longUrl } | null (unknown slug). Throws on upstream failure.
    async resolve(slug, requestId) {
      const res = await call('resolve', `/internal/urls/${encodeURIComponent(slug)}`, {
        headers: requestId ? { 'X-Request-ID': requestId } : {},
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`api responded ${res.status}`);
      const body = await res.json();
      return { longUrl: body.longUrl };
    },

    // Returns { ok, status, retryable }. A 4xx means this batch will never be
    // accepted (wrong token, too many events, bad payload): the caller must
    // drop it, not retry it. 5xx and network errors are retryable.
    async sendClicks(events) {
      let res;
      try {
        res = await call('flush', '/internal/clicks', {
          method: 'POST',
          body: JSON.stringify({ events }),
        });
      } catch (err) {
        logger.warn({ err: err.message, size: events.length }, 'click flush failed, will retry');
        return { ok: false, status: 0, retryable: true };
      }
      if (res.ok) return { ok: true, status: res.status, retryable: false };
      const retryable = res.status >= 500;
      const detail = await res.text().catch(() => '');
      logger[retryable ? 'warn' : 'error'](
        { status: res.status, size: events.length, detail: detail.slice(0, 200) },
        retryable ? 'api rejected click batch, will retry' : 'api rejected click batch permanently, dropping it',
      );
      return { ok: false, status: res.status, retryable };
    },

    async healthy() {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    },
  };
}
