import { env } from './env.js';

// Runtime override of PUBLIC_BASE_URL through PUT /admin/config. Deliberately
// in-memory only (lost on restart, not shared between replicas) — exactly like
// config-service in microshort 1. The persistent value is the env var.
let override = null;

export function getPublicBaseUrl() {
  return (override ?? env.PUBLIC_BASE_URL).replace(/\/+$/, '');
}

export function setPublicBaseUrl(value) {
  override = value;
}

export function publicBaseUrlSource() {
  return override ? 'runtime-override' : 'env';
}

export function buildShortUrl(slug) {
  return `${getPublicBaseUrl()}/${slug}`;
}
