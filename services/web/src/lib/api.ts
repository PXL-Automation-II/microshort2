import { apiBaseUrl, apiBaseUrlLabel } from './config'
import type { ConfigInfo, Dashboard, HealthReport, Page, Providers, ShortUrl, SsoLogin, User, UserDetail } from './types'

// The dashboard signs in with one of two credentials (contract section 4a):
// an admin's API key, pasted on the login page, or the api's own bearer
// token, obtained from GET /auth/sso after a trusted proxy authenticated
// the user. Every admin request carries whichever one is current.
export type Credential = { kind: 'apiKey' | 'token'; value: string }

export const STORAGE_KEY = 'microshort.adminCredential'
const LEGACY_STORAGE_KEY = 'microshort.adminApiKey'
/** Set on sign-out so the login page does not sign the user straight back in through single sign-on. */
export const SSO_SKIP_KEY = 'microshort.ssoSkip'
/** Fired when the api rejects the current credential mid-session. */
export const UNAUTHORIZED_EVENT = 'microshort:unauthorized'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
  /** 0 = the request never reached the API (network, CORS, wrong base URL). */
  get unreachable() {
    return this.status === 0
  }
}

export function readStoredCredential(): Credential | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Credential>
      if ((parsed.kind === 'apiKey' || parsed.kind === 'token') && typeof parsed.value === 'string' && parsed.value) {
        return { kind: parsed.kind, value: parsed.value }
      }
    }
    // Keys stored by earlier versions of the dashboard.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      const cred: Credential = { kind: 'apiKey', value: legacy }
      storeCredential(cred)
      return cred
    }
  } catch {
    /* private mode */
  }
  return null
}

export function storeCredential(cred: Credential | null) {
  try {
    if (cred) localStorage.setItem(STORAGE_KEY, JSON.stringify(cred))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode */
  }
}

let current: Credential | null = readStoredCredential()
export function setCurrentCredential(cred: Credential | null) {
  current = cred
}

function authHeaders(cred: Credential): Record<string, string> {
  return cred.kind === 'token' ? { Authorization: `Bearer ${cred.value}` } : { 'X-API-Key': cred.value }
}

async function send<T>(path: string, init: RequestInit, headers: Record<string, string>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError(`Cannot reach the API at ${apiBaseUrlLabel}`, 0)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status)
  return data as T
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!current) throw new ApiError('Not logged in', 401)
  const cred = current
  try {
    return await send<T>(path, init, authHeaders(cred))
  } catch (err) {
    // A bearer token expires (the api's JWT_EXPIRES_IN); tell the auth
    // provider so the login page can fetch a fresh one through single sign-on.
    if (err instanceof ApiError && err.status === 401 && cred.kind === 'token' && current === cred) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw err
  }
}

const q = (params: Record<string, string | number | null | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const str = s.toString()
  return str ? `?${str}` : ''
}

export const api = {
  // Unauthenticated: which sign-in methods this deployment offers.
  providers: () => send<Providers>('/auth/providers', {}, {}),
  // Same-origin, so the trusted proxy's session cookie travels with it.
  ssoLogin: () => send<SsoLogin>('/auth/sso', { credentials: 'same-origin' }, {}),

  dashboard: () => request<Dashboard>('/admin/dashboard'),
  users: (cursor?: number | null) => request<Page<User>>(`/admin/users${q({ limit: 50, cursor })}`),
  user: (id: number) => request<UserDetail>(`/admin/users/${id}`),
  urls: (search: string, cursor?: number | null) => request<Page<ShortUrl>>(`/admin/urls${q({ limit: 50, q: search, cursor })}`),
  updateUrl: (slug: string, url: string) =>
    request<ShortUrl>(`/admin/urls/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify({ url }) }),
  deleteUrl: (slug: string) => request<void>(`/admin/urls/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
  config: () => request<ConfigInfo>('/admin/config'),
  setConfig: (publicBaseUrl: string) =>
    request<ConfigInfo>('/admin/config', { method: 'PUT', body: JSON.stringify({ publicBaseUrl }) }),
  health: () => request<HealthReport>('/admin/health/services'),
}
