import { createHash, timingSafeEqual } from 'node:crypto';
import { customAlphabet } from 'nanoid';

export const PASSWORD_MIN_LENGTH = 8;
// Pragmatic shape check (something@something.tld); full RFC 5322 is out of scope.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const API_KEY_PREFIX = 'msh_';
export const API_KEY_LENGTH = 36; // 'msh_' + 32 random characters

export const SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const SLUG_MAX_LENGTH = 50;
export const AUTO_SLUG_LENGTH = 6;
// Paths the redirect service serves itself; a slug must never shadow them.
// Paths the services serve themselves, plus the dashboard's top-level routes
// and static entry points: on a single origin a slug must never shadow them,
// and a path-pattern router (ALB) relies on this list to tell them apart.
export const RESERVED_SLUGS = new Set([
  'health', 'ready', 'metrics', 'docs', 'openapi.json', 'api', 'admin', 'auth', 'urls', 'internal',
  'login', 'users', 'config', 'status', 'assets', 'logo.svg', 'config.js', 'theme-boot.js', 'favicon.ico', 'oauth2',
]);
// Slugs are case-sensitive on purpose (like most shorteners): "Abc" and "abc"
// are different links. v1's MySQL collation folded case; v2 does not.

const keyAlphabet = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', API_KEY_LENGTH - API_KEY_PREFIX.length);
const slugAlphabet = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', AUTO_SLUG_LENGTH);

export function generateApiKey() {
  return API_KEY_PREFIX + keyAlphabet();
}

export function generateSlug() {
  return slugAlphabet();
}

export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

export function isValidApiKeyFormat(key) {
  return typeof key === 'string' && key.startsWith(API_KEY_PREFIX) && key.length === API_KEY_LENGTH;
}

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function isValidPassword(password) {
  return typeof password === 'string' && password.length >= PASSWORD_MIN_LENGTH && password.length <= 1024;
}

export function isValidSlug(slug) {
  return (
    typeof slug === 'string' &&
    slug.length > 0 &&
    slug.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(slug) &&
    !RESERVED_SLUGS.has(slug.toLowerCase())
  );
}

// Returns null when the value is an acceptable destination, otherwise the
// message to send back (the three cases v1 distinguished).
export function urlProblem(value) {
  if (value === undefined || value === null || value === '') return 'URL required';
  if (typeof value !== 'string' || value.length > 2048) return 'Invalid URL format';
  let u;
  try {
    u = new URL(value);
  } catch {
    return 'Invalid URL format';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https URLs are allowed';
  return null;
}

export function isValidHttpUrl(value) {
  return urlProblem(value) === null;
}

// Positive integer ids only: parseInt would accept "12abc" as 12.
export function parseId(value) {
  return /^\d{1,18}$/.test(value ?? '') ? Number(value) : null;
}

// Escape LIKE/ILIKE metacharacters so user input matches literally.
export function escapeLike(value) {
  return value.replace(/[\\%_]/g, c => `\\${c}`);
}

// Constant-time comparison that does not leak length differences: both sides
// are hashed first so the buffers always have equal size.
export function safeTokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Keyset pagination helpers: ?limit=50&cursor=<last id seen>
export function parseLimit(value, { def = 50, max = 200 } = {}) {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

export function parseCursor(value) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
