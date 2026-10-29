// Shapes returned by the api service (see services/api/src/routes/*.js).

export type Role = 'user' | 'admin'

export interface User {
  id: number
  email: string
  role: Role
  createdAt: string
  urlCount?: number
}

export interface ApiKeyMeta {
  id: number
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface ShortUrl {
  id: number
  slug: string
  shortUrl: string
  longUrl: string
  clicks: number
  userId: number
  userEmail?: string
  createdAt: string
  updatedAt: string
}

export interface Page<T> {
  nextCursor: number | null
  urls?: T[]
  users?: T[]
}

export interface Dashboard {
  users: { total: number; admins: number; recentSignups: number; totalApiKeys: number }
  urls: { total: number; totalClicks: number; recentUrls: number; top: ShortUrl[] }
  clicks: { today: number; last7Days: { day: string; clicks: number }[] }
  publicBaseUrl: string
}

export interface UserDetail {
  user: User
  apiKeys: ApiKeyMeta[]
  urls: ShortUrl[]
}

export interface ConfigInfo {
  publicBaseUrl: string
  source: 'env' | 'runtime-override'
  envValue: string
  note?: string
}

export type ServiceStatus = 'healthy' | 'unhealthy' | 'unreachable'

export interface ServiceHealth {
  name: string
  status: ServiceStatus
  responseTimeMs: number
  error?: string
}

export interface HealthReport {
  services: ServiceHealth[]
  checkedAt: string
}

/** GET /auth/providers: the sign-in methods this deployment offers. */
export interface Providers {
  apiKey: boolean
  sso: boolean
}

/** GET /auth/sso: the api's own tokens for the identity a trusted proxy forwarded. */
export interface SsoLogin {
  token: string
  refreshToken: string
  userId: number
  role: Role
  email: string
}
