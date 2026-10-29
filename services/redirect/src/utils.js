import { createHash } from 'node:crypto';

export const SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

export function isPlausibleSlug(slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

// Visitor IPs never leave this service in the clear: SHA-256 of ip + a salt
// that changes every UTC day (+ an optional operator salt), so the hash
// cannot be joined across days.
export function hashIp(ip, extraSalt = '', now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return createHash('sha256').update(`${ip || '0.0.0.0'}|${day}|${extraSalt}`).digest('hex');
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
