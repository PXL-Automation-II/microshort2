import { LRUCache } from 'lru-cache';
import { cacheSize } from './metrics.js';

// In-process slug cache. Each replica has its own copy — a PUT or DELETE on
// api is not visible here until the entry expires. That is the deliberate
// "stateless scale-out vs. cache coherence" lesson; a shared cache is an
// exercise, not a feature.
export function createSlugCache({ ttlSeconds, negativeTtlSeconds, maxEntries }) {
  const enabled = ttlSeconds > 0;
  const cache = new LRUCache({
    max: Math.max(1, maxEntries),
    ttl: enabled ? ttlSeconds * 1000 : 1,
    ttlAutopurge: false,
    allowStale: false,
    noDeleteOnStaleGet: true,   // keep expired entries around for getStale()
  });
  const NOT_FOUND = Symbol('not-found');

  return {
    enabled,
    get(slug) {
      if (!enabled) return undefined;
      const v = cache.get(slug);
      if (v === undefined) return undefined;
      return v === NOT_FOUND ? null : v;        // null = cached 404
    },
    // Serve-stale: when api is unreachable an expired entry is better than a
    // 503. Returns the long URL or undefined; never a cached 404.
    getStale(slug) {
      if (!enabled) return undefined;
      const v = cache.get(slug, { allowStale: true });
      return v === undefined || v === NOT_FOUND ? undefined : v;
    },
    set(slug, longUrl) {
      if (!enabled) return;
      cache.set(slug, longUrl);
      cacheSize.set(cache.size);
    },
    setNotFound(slug) {
      if (!enabled || negativeTtlSeconds <= 0) return;
      cache.set(slug, NOT_FOUND, { ttl: negativeTtlSeconds * 1000 });
      cacheSize.set(cache.size);
    },
    delete(slug) {
      cache.delete(slug);
      cacheSize.set(cache.size);
    },
    clear() {
      cache.clear();
      cacheSize.set(0);
    },
    get size() {
      return cache.size;
    },
  };
}
