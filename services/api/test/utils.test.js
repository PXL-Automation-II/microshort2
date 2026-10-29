import { describe, it, expect } from 'vitest';
import {
  generateApiKey, generateSlug, hashKey, isValidApiKeyFormat, isValidEmail, isValidPassword,
  isValidSlug, isValidHttpUrl, urlProblem, parseId, escapeLike, safeTokenEqual, parseLimit, parseCursor, API_KEY_LENGTH,
} from '../src/utils.js';

describe('api keys', () => {
  it('generates msh_-prefixed keys of fixed length', () => {
    const key = generateApiKey();
    expect(key.startsWith('msh_')).toBe(true);
    expect(key).toHaveLength(API_KEY_LENGTH);
    expect(isValidApiKeyFormat(key)).toBe(true);
  });
  it('rejects malformed keys', () => {
    expect(isValidApiKeyFormat('msh_short')).toBe(false);
    expect(isValidApiKeyFormat(undefined)).toBe(false);
    expect(isValidApiKeyFormat('x'.repeat(API_KEY_LENGTH))).toBe(false);
  });
  it('hashes deterministically to 64 hex chars', () => {
    expect(hashKey('a')).toBe(hashKey('a'));
    expect(hashKey('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('credentials', () => {
  it('validates email shape', () => {
    expect(isValidEmail('me@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });
  it('requires 8+ character passwords', () => {
    expect(isValidPassword('x')).toBe(false);
    expect(isValidPassword('super-secret-1')).toBe(true);
  });
});

describe('slugs', () => {
  it('accepts [a-zA-Z0-9_-] up to 50 chars', () => {
    expect(isValidSlug('my-launch_2026')).toBe(true);
    expect(isValidSlug('a'.repeat(51))).toBe(false);
    expect(isValidSlug('has space')).toBe(false);
    expect(isValidSlug('')).toBe(false);
  });
  it('rejects reserved words regardless of case', () => {
    expect(isValidSlug('health')).toBe(false);
    expect(isValidSlug('Metrics')).toBe(false);
    expect(isValidSlug('api')).toBe(false);
  });
  it("reserves the dashboard's own routes so a path router can tell them apart", () => {
    for (const s of ['login', 'users', 'config', 'status', 'assets', 'Users']) expect(isValidSlug(s), s).toBe(false);
    expect(isValidSlug('status2')).toBe(true);
  });
  it('generates 6-char valid slugs', () => {
    const s = generateSlug();
    expect(s).toHaveLength(6);
    expect(isValidSlug(s)).toBe(true);
  });
});

describe('urls', () => {
  it('accepts http and https only', () => {
    expect(isValidHttpUrl('https://example.com/x?y=1')).toBe(true);
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('nope')).toBe(false);
  });
  it('names the problem the way v1 did', () => {
    expect(urlProblem(undefined)).toBe('URL required');
    expect(urlProblem('')).toBe('URL required');
    expect(urlProblem('not a url')).toBe('Invalid URL format');
    expect(urlProblem('ftp://example.com')).toBe('Only http and https URLs are allowed');
    expect(urlProblem('https://example.com')).toBeNull();
  });
});

describe('ids and search', () => {
  it('accepts only plain positive integers as ids', () => {
    expect(parseId('42')).toBe(42);
    expect(parseId('12abc')).toBeNull();
    expect(parseId('-1')).toBeNull();
    expect(parseId(undefined)).toBeNull();
  });
  it('escapes LIKE metacharacters', () => {
    expect(escapeLike('my_launch 100%')).toBe('my\\_launch 100\\%');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });
});

describe('safeTokenEqual', () => {
  it('compares without throwing on length mismatch', () => {
    expect(safeTokenEqual('abc', 'abc')).toBe(true);
    expect(safeTokenEqual('abc', 'abcd')).toBe(false);
    expect(safeTokenEqual(undefined, 'abc')).toBe(false);
  });
});

describe('pagination', () => {
  it('clamps limit and parses cursor', () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('5000')).toBe(200);
    expect(parseLimit('-1')).toBe(50);
    expect(parseCursor('42')).toBe(42);
    expect(parseCursor('x')).toBeNull();
  });
});
