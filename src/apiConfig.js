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
export function setApiConfig({ base, token } = {}) {
  try {
    if (base !== undefined) localStorage.setItem(BASE_KEY, (base || '').replace(/\/+$/, ''))
    if (token !== undefined) localStorage.setItem(TOKEN_KEY, token || '')
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
  const token = getApiToken()
  if (!base && !token) return // web / same-origin: do nothing at all
  installed = true

  // Re-mirror on boot so a config set before this build shipped (i.e. before the
  // native bridge existed) reaches the App Group the first time the new binary
  // runs. Cheap and idempotent.
  mirrorConfigToNative()

  const origFetch = window.fetch.bind(window)
  window.fetch = (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input?.url
      if (typeof url === 'string' && url.startsWith('/api')) {
        const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined))
        if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
        return origFetch(apiUrl(url), { ...init, headers })
      }
    } catch { /* fall through to the unmodified call */ }
    return origFetch(input, init)
  }

  // EventSource (SSE sync) can't carry an Authorization header, so the token
  // rides as a query param; the server accepts ?api_token= on /api routes.
  if (base && typeof window.EventSource === 'function') {
    const OrigES = window.EventSource
    const Wrapped = function (url, opts) {
      let u = url
      if (typeof u === 'string' && u.startsWith('/api')) {
        u = apiUrl(u)
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
