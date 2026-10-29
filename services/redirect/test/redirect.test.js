import { describe, it, expect, vi } from 'vitest';
import { hashIp, isPlausibleSlug, escapeHtml } from '../src/utils.js';
import { createSlugCache } from '../src/cache.js';
import { createClickBuffer } from '../src/clicks.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('utils', () => {
  it('hashes IPs per day and salt', () => {
    const d1 = new Date('2026-01-01T10:00:00Z');
    const d2 = new Date('2026-01-02T10:00:00Z');
    expect(hashIp('1.2.3.4', '', d1)).toBe(hashIp('1.2.3.4', '', d1));
    expect(hashIp('1.2.3.4', '', d1)).not.toBe(hashIp('1.2.3.4', '', d2));
    expect(hashIp('1.2.3.4', 'a', d1)).not.toBe(hashIp('1.2.3.4', 'b', d1));
    expect(hashIp('1.2.3.4')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('filters implausible slugs before calling api', () => {
    expect(isPlausibleSlug('abc123')).toBe(true);
    expect(isPlausibleSlug('../etc')).toBe(false);
    expect(isPlausibleSlug('a'.repeat(51))).toBe(false);
  });
  it('escapes html', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });
});

describe('slug cache', () => {
  it('stores hits and negative entries, honours disable', () => {
    const c = createSlugCache({ ttlSeconds: 60, negativeTtlSeconds: 10, maxEntries: 10 });
    expect(c.get('x')).toBeUndefined();
    c.set('x', 'https://example.com');
    expect(c.get('x')).toBe('https://example.com');
    c.setNotFound('nope');
    expect(c.get('nope')).toBeNull();
    c.delete('x');
    expect(c.get('x')).toBeUndefined();
    expect(c.getStale('nope')).toBeUndefined();    // a cached 404 is never served stale
  });
  it('serves expired entries through getStale only', async () => {
    const c = createSlugCache({ ttlSeconds: 0.01, negativeTtlSeconds: 10, maxEntries: 10 });
    c.set('x', 'https://example.com');
    await new Promise(r => setTimeout(r, 30));
    expect(c.get('x')).toBeUndefined();
    expect(c.getStale('x')).toBe('https://example.com');

    const off = createSlugCache({ ttlSeconds: 0, negativeTtlSeconds: 10, maxEntries: 10 });
    off.set('x', 'https://example.com');
    expect(off.enabled).toBe(false);
    expect(off.get('x')).toBeUndefined();
  });
  it('evicts beyond maxEntries', () => {
    const c = createSlugCache({ ttlSeconds: 60, negativeTtlSeconds: 10, maxEntries: 2 });
    c.set('a', '1'); c.set('b', '2'); c.set('c', '3');
    expect(c.size).toBe(2);
    expect(c.get('a')).toBeUndefined();
  });
});

describe('click buffer', () => {
  it('keeps the batch for retry when api is temporarily unavailable', async () => {
    const sendClicks = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, retryable: true })
      .mockResolvedValue({ ok: true, status: 202, retryable: false });
    const buf = createClickBuffer({ apiClient: { sendClicks }, flushIntervalMs: 100_000, batchSize: 10, maxBuffer: 10, logger: silent });
    buf.push({ slug: 'a' });
    buf.push({ slug: 'b' });
    await buf.flush();                  // first call fails
    expect(sendClicks).toHaveBeenCalledTimes(1);
    expect(buf.size).toBe(2);           // kept for retry
    await buf.flush();                  // second call succeeds
    expect(buf.size).toBe(0);
    expect(sendClicks.mock.calls[1][0].map(e => e.slug)).toEqual(['a', 'b']);
  });
  it('drops a batch api rejects permanently (4xx) instead of retrying it forever', async () => {
    const sendClicks = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 413, retryable: false })
      .mockResolvedValue({ ok: true, status: 202, retryable: false });
    const buf = createClickBuffer({ apiClient: { sendClicks }, flushIntervalMs: 100_000, batchSize: 2, maxBuffer: 10, logger: silent });
    for (const slug of ['a', 'b', 'c']) buf.push({ slug });
    await buf.flush();
    expect(buf.size).toBe(0);
    expect(sendClicks).toHaveBeenCalledTimes(2);                        // [a,b] rejected+dropped, [c] accepted
    expect(sendClicks.mock.calls[1][0].map(e => e.slug)).toEqual(['c']);
  });
  it('flushes automatically when the batch size is reached and splits big buffers', async () => {
    const sendClicks = vi.fn().mockResolvedValue({ ok: true, status: 202, retryable: false });
    const buf = createClickBuffer({ apiClient: { sendClicks }, flushIntervalMs: 100_000, batchSize: 2, maxBuffer: 10, logger: silent });
    buf.push({ slug: 'a' });
    expect(sendClicks).not.toHaveBeenCalled();
    buf.push({ slug: 'b' });            // reaches batchSize -> flush
    await new Promise(r => setTimeout(r, 0));
    expect(sendClicks).toHaveBeenCalledTimes(1);
    expect(buf.size).toBe(0);
  });
  it('drops the oldest events when the buffer is full', async () => {
    const sendClicks = vi.fn().mockResolvedValue({ ok: true, status: 202, retryable: false });
    const buf = createClickBuffer({ apiClient: { sendClicks }, flushIntervalMs: 100_000, batchSize: 10, maxBuffer: 3, logger: silent });
    for (const slug of ['a', 'b', 'c', 'd']) buf.push({ slug });
    expect(buf.size).toBe(3);           // 'a' was dropped
    await buf.flush();
    expect(sendClicks.mock.calls[0][0].map(e => e.slug)).toEqual(['b', 'c', 'd']);
  });
  it('flushes on stop and drops what cannot be delivered', async () => {
    const sendClicks = vi.fn().mockRejectedValue(new Error('down'));
    const buf = createClickBuffer({ apiClient: { sendClicks }, flushIntervalMs: 100_000, batchSize: 10, maxBuffer: 10, logger: silent });
    buf.push({ slug: 'a' });
    await buf.stop();
    expect(buf.size).toBe(0);
  });
});
