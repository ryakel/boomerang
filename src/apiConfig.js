// apiConfig.js — connection config for the native (Capacitor) shell.
//
// On the WEB (same-origin) nothing is configured: the base is '' and there's no
// token, so requests use relative /api paths + the session cookie exactly as
// before — this module installs nothing and has zero effect. In the BUNDLED
// native app the WebView origin is capacitor://localhost, which is NOT the API
// origin, so once a base + token are configured we:
//   (a) prefix relative /api URLs with the configured server base, and
//   (b) attach the API token as a Bearer header (cross-origin can't ride the
//       session cookie), or as a ?api_token= query param for the SSE stream
//       (EventSource can't set headers).
//
// Config is read at runtime — NO secrets are baked into the app bundle:
//   localStorage.boom_api_base   e.g. "https://boomerang.tailnet.ts.net"
//   localStorage.boom_api_token  the server's API_TOKEN
// A later phase adds an in-app "Connection" settings screen to set these.

import { registerPlugin } from '@capacitor/core'

const BASE_KEY = 'boom_api_base'
const TOKEN_KEY = 'boom_api_token'
// Auth Phase A (wiki/Auth-Device-Tokens.md): per-device rotating token pair.
// Preferred over the legacy static token when present; the legacy token stays
// stored as the bootstrap/fallback credential.
const DEVICE_ID_KEY = 'boom_device_id'
const DEVICE_ACCESS_KEY = 'boom_device_access'
const DEVICE_REFRESH_KEY = 'boom_device_refresh'
const DEVICE_EXPIRES_KEY = 'boom_device_expires'

// Native bridge (Phase 0). registerPlugin returns a proxy on all platforms; we
// only ever call it inside the native shell, where the BoomerangNative Swift
// plugin mirrors the config into the App Group container so the Share Extension
// / App Intents / native push can read the same credentials. On web this is
// never invoked.
const BoomerangNative = registerPlugin('BoomerangNative')

export function getApiBase() {
  try { return (localStorage.getItem(BASE_KEY) || '').replace(/\/+$/, '') } catch { return '' }
}
export function getApiToken() {
  try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

export function getDeviceTokens() {
  try {
    return {
      deviceId: localStorage.getItem(DEVICE_ID_KEY) || '',
      access: localStorage.getItem(DEVICE_ACCESS_KEY) || '',
      refresh: localStorage.getItem(DEVICE_REFRESH_KEY) || '',
      expires: Number(localStorage.getItem(DEVICE_EXPIRES_KEY) || 0),
    }
  } catch { return { deviceId: '', access: '', refresh: '', expires: 0 } }
}

export function setDeviceTokens({ device_id, access_token, refresh_token, access_expires } = {}) {
  try {
    localStorage.setItem(DEVICE_ID_KEY, device_id || '')
    localStorage.setItem(DEVICE_ACCESS_KEY, access_token || '')
    localStorage.setItem(DEVICE_REFRESH_KEY, refresh_token || '')
    localStorage.setItem(DEVICE_EXPIRES_KEY, String(access_expires || 0))
  } catch { /* storage unavailable — ignore */ }
  mirrorDeviceTokensToNative()
}

export function clearDeviceTokens() {
  try {
    localStorage.removeItem(DEVICE_ID_KEY)
    localStorage.removeItem(DEVICE_ACCESS_KEY)
    localStorage.removeItem(DEVICE_REFRESH_KEY)
    localStorage.removeItem(DEVICE_EXPIRES_KEY)
  } catch { /* ignore */ }
  if (isNativeShell()) {
    try { BoomerangNative.clearDeviceTokens().catch(() => {}) } catch { /* ignore */ }
  }
}

// Mirror the device pair into the native shared Keychain (BoomerangKit) so
// the Share Extension / App Intents hold a live access token, and so the pair
// survives WebView storage eviction (restoreNativeCredentials below). Only a
// PRESENT pair is pushed — the native side ignores empty mirrors, and clears
// go through clearDeviceTokens explicitly.
export function mirrorDeviceTokensToNative() {
  if (!isNativeShell()) return
  const d = getDeviceTokens()
  if (!d.access || !d.refresh) return
  try {
    BoomerangNative.setDeviceTokens({
      device_id: d.deviceId,
      access_token: d.access,
      refresh_token: d.refresh,
      access_expires: d.expires,
    }).catch(() => { /* plugin absent — ignore */ })
  } catch { /* proxy threw synchronously — ignore */ }
}

// Recovery path for the capacitor:// origin's fragile storage: when the
// WebView's localStorage was evicted but the native Keychain / App Group still
// hold credentials (they always outlive the WebView), pull them back and
// report success so the caller can reload into a working app instead of
// dropping the user on the Connection screen.
export async function restoreNativeCredentials() {
  if (!isNativeShell()) return false
  if (getApiBase()) return false // nothing to restore — config is present
  try {
    const cfg = await BoomerangNative.getSharedConfig()
    if (!cfg?.base) return false
    setApiConfig({ base: cfg.base, token: cfg.token || '' })
    try {
      const pair = await BoomerangNative.getDeviceTokens()
      if (pair?.present && pair.access_token && pair.refresh_token) {
        setDeviceTokens(pair)
      }
    } catch { /* older native build without the method — legacy token carries it */ }
    console.log('[apiConfig] restored connection config from native storage')
    return true
  } catch { return false }
}

// The credential to attach right now: a live device access token wins;
// the legacy static token is the fallback. Read per call — device tokens
// rotate hourly, so nothing may capture this value at install time.
function currentAuthToken() {
  const d = getDeviceTokens()
  if (d.access && d.refresh) return d.access
  return getApiToken()
}

// Single-flight refresh: many parallel 401s must produce ONE /refresh call
// (a rotated refresh token is single-use — a second concurrent attempt with
// the same token would trip the server's reuse detection on ourselves).
let refreshInFlight = null
async function refreshDevicePair(origFetch) {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const d = getDeviceTokens()
    if (!d.refresh) return false
    try {
      const res = await origFetch(apiUrl('/api/auth/device/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: d.refresh }),
      })
      if (res.status === 401) {
        // Revoked (possibly by reuse detection) — drop the pair so the
        // legacy token takes over, or the Connection screen surfaces.
        console.warn('[apiConfig] device refresh rejected — clearing device tokens')
        clearDeviceTokens()
        return false
      }
      if (!res.ok) return false // transient — keep the pair, retry later
      const pair = await res.json()
      setDeviceTokens(pair)
      return true
    } catch { return false }
  })()
  try { return await refreshInFlight } finally { refreshInFlight = null }
}

// Proactive rotation: refresh when within 5 minutes of expiry so requests
// almost never eat the 401-retry path.
async function ensureFreshDeviceToken(origFetch) {
  const d = getDeviceTokens()
  if (!d.refresh || !d.access) return
  if (d.expires && d.expires - Date.now() > 5 * 60 * 1000) return
  await refreshDevicePair(origFetch)
}

// Enroll this device for a token pair, authenticating with whatever
// credential is currently configured (bootstrap = the legacy API token).
// Best-effort: callers treat failure as "stay on the legacy token".
export async function enrollThisDevice(name) {
  try {
    const platform = isNativeShell() ? 'ios-native' : 'web'
    const res = await fetch('/api/auth/device/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || defaultDeviceName(), platform }),
    })
    if (!res.ok) return false
    const pair = await res.json()
    if (!pair?.access_token) return false
    setDeviceTokens(pair)
    console.log(`[apiConfig] enrolled as device ${pair.device_id}`)
    return true
  } catch { return false }
}

function defaultDeviceName() {
  try {
    const ua = navigator.userAgent || ''
    if (isNativeShell()) return /iPad/.test(ua) ? 'iPad (Boomerang app)' : 'iPhone (Boomerang app)'
    if (/iPhone|iPad/.test(ua)) return 'iOS browser'
    if (/Mac/.test(ua)) return 'Mac browser'
    if (/Windows/.test(ua)) return 'Windows browser'
    return 'Browser'
  } catch { return 'Device' }
}
export function setApiConfig({ base, token } = {}) {
  try {
    try {
      if (base !== undefined) localStorage.setItem(BASE_KEY, (base || '').replace(/\/+$/, ''))
      if (token !== undefined) localStorage.setItem(TOKEN_KEY, token || '')
    } catch (e) { console.warn('[apiConfig] localStorage write failed:', e?.message) }
  } catch { /* storage unavailable — ignore */ }
  mirrorConfigToNative()
}

// Push the current base+token into the App Group container. No-op on web and a
// harmless no-op in the shell until the App Group capability is provisioned
// (the Swift side resolves `stored: false` rather than throwing).
export function mirrorConfigToNative() {
  if (!isNativeShell()) return
  try {
    BoomerangNative.setSharedConfig({ base: getApiBase(), token: getApiToken() })
      .catch(() => { /* plugin absent / group not provisioned — ignore */ })
  } catch { /* @capacitor/core proxy threw synchronously — ignore */ }
}

// True when running inside the Capacitor native shell (WebView origin is
// capacitor://localhost). The web/PWA build always returns false.
export function isNativeShell() {
  try { return window.location.protocol === 'capacitor:' } catch { return false }
}

// Reopen the Connection screen on next load (Settings → Data → Change server,
// or the login screen's escape hatch). sessionStorage so it can't stick.
const SHOW_CONNECT_KEY = 'boom_show_connect'
export function requestConnectionSetup() {
  try { sessionStorage.setItem(SHOW_CONNECT_KEY, '1') } catch { /* ignore */ }
  window.location.reload()
}
export function consumeConnectionSetupRequest() {
  try {
    if (sessionStorage.getItem(SHOW_CONNECT_KEY)) {
      sessionStorage.removeItem(SHOW_CONNECT_KEY)
      return true
    }
  } catch { /* ignore */ }
  return false
}

// Resolve a possibly-relative API path against the configured base.
export function apiUrl(path) {
  const base = getApiBase()
  if (!base || typeof path !== 'string') return path
  if (/^https?:\/\//i.test(path)) return path
  return base + (path.startsWith('/') ? path : `/${path}`)
}

// Install fetch + EventSource shims that rewrite relative /api URLs to the
// configured base and inject the token. INERT when nothing is configured (the
// web build) — it installs nothing, so there is zero overhead or risk for the
// same-origin PWA. Idempotent.
let installed = false
export function installApiInterceptor() {
  if (installed) return
  const base = getApiBase()
  const hasDevicePair = Boolean(getDeviceTokens().refresh)
  if (!base && !getApiToken() && !hasDevicePair) return // web / same-origin: do nothing at all
  installed = true

  // Re-mirror on boot so a config set before this build shipped (i.e. before the
  // native bridge existed) reaches the App Group the first time the new binary
  // runs. Cheap and idempotent. Same for a device pair enrolled before the
  // Keychain mirror existed — push it across once on boot.
  mirrorConfigToNative()
  mirrorDeviceTokensToNative()

  const origFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input?.url
      if (typeof url === 'string' && url.startsWith('/api')) {
        // Credentials are read PER CALL — device tokens rotate hourly, so
        // nothing may capture them at install time. Proactive refresh keeps
        // the 401-retry path rare; the refresh endpoint itself is exempt
        // (it authenticates with the refresh token, not the access token).
        const isRefreshCall = url.startsWith('/api/auth/device/refresh')
        if (!isRefreshCall) await ensureFreshDeviceToken(origFetch)

        const buildHeaders = () => {
          const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined))
          const token = currentAuthToken()
          if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
          return headers
        }

        let res = await origFetch(apiUrl(url), { ...init, headers: buildHeaders() })
        // One retry after a 401 when a device pair is in play: refresh, then
        // re-send with the new access token (or the legacy fallback if the
        // pair just got cleared by a rejected refresh).
        if (res.status === 401 && !isRefreshCall && getDeviceTokens().refresh) {
          const refreshed = await refreshDevicePair(origFetch)
          if (refreshed || getApiToken()) {
            res = await origFetch(apiUrl(url), { ...init, headers: buildHeaders() })
          }
        }
        return res
      }
    } catch { /* fall through to the unmodified call */ }
    return origFetch(input, init)
  }

  // EventSource (SSE sync) can't carry an Authorization header, so the token
  // rides as a query param; the server accepts ?api_token= on /api routes.
  // Read per construction — SSE reconnects pick up rotated tokens.
  if (base && typeof window.EventSource === 'function') {
    const OrigES = window.EventSource
    const Wrapped = function (url, opts) {
      let u = url
      if (typeof u === 'string' && u.startsWith('/api')) {
        u = apiUrl(u)
        const token = currentAuthToken()
        if (token) u += (u.includes('?') ? '&' : '?') + 'api_token=' + encodeURIComponent(token)
      }
      return new OrigES(u, opts)
    }
    Wrapped.prototype = OrigES.prototype
    Wrapped.CONNECTING = OrigES.CONNECTING
    Wrapped.OPEN = OrigES.OPEN
    Wrapped.CLOSED = OrigES.CLOSED
    window.EventSource = Wrapped
  }
}
