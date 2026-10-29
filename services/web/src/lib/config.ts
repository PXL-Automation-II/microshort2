// Runtime configuration. The web server (or the Vite dev plugin) serves
// /config.js, which sets window.MICROSHORT_CONFIG before the app loads. The
// API base URL is therefore a deployment setting, never a build-time one.
declare global {
  interface Window {
    MICROSHORT_CONFIG?: { apiBaseUrl?: string }
  }
}

export const apiBaseUrl = (window.MICROSHORT_CONFIG?.apiBaseUrl ?? '').replace(/\/+$/, '')

export const apiBaseUrlLabel = apiBaseUrl || `${window.location.origin} (same origin)`
