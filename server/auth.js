// auth.js — single-user authentication for Boomerang.
//
// OPT-IN: the gate is completely inert unless AUTH_PASSWORD (or
// AUTH_PASSWORD_HASH) is set in the environment. This preserves the legacy
// "single-user, trusted machine" deployment — nothing changes until you
// provide credentials, which is exactly what you do when you move the app onto
// a public host.
//
// Two credential types share one gate:
//   1. Humans   -> POST /api/auth/login with the password -> httpOnly session
//      cookie (boom_session). Cookies ride every same-origin /api fetch AND the
//      SSE EventSource automatically, so the React app needs no per-call change.
//   2. Machines (the iOS Shortcut, a future native app) -> a static API_TOKEN
//      sent as `Authorization: Bearer <token>` or `x-api-token: <token>`.
//
// Sessions persist in app_data.auth_sessions so a server restart / redeploy
// doesn't log you out. This (like SQLite + the in-memory Quokka runner) assumes
// a single always-on instance — NOT a serverless / multi-instance host.

import crypto from 'crypto'

const SESSION_COOKIE = 'boom_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, rolling on login
const SESSIONS_KEY = 'auth_sessions'

let deps = { getData: () => null, setData: () => {} }
export function initAuth(d) { deps = { ...deps, ...d } }

export function isAuthEnabled() {
  return Boolean(process.env.AUTH_PASSWORD || process.env.AUTH_PASSWORD_HASH)
}

function apiToken() {
  return process.env.API_TOKEN || ''
}

// Timing-safe compare that won't throw on length mismatch.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab) // burn a compare to keep timing flatter
    return false
  }
  return crypto.timingSafeEqual(ab, bb)
}

// AUTH_PASSWORD_HASH format: `scrypt$<saltHex>$<hashHex>` (see scripts/auth-setup.js).
// Falls back to a plaintext AUTH_PASSWORD compare if only that is set.
function checkPassword(password) {
  const hash = process.env.AUTH_PASSWORD_HASH
  if (hash) {
    const parts = String(hash).split('$')
    if (parts.length === 3 && parts[0] === 'scrypt') {
      const [, saltHex, hashHex] = parts
      try {
        const derived = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32)
        return safeEqual(derived.toString('hex'), hashHex)
      } catch {
        return false
      }
    }
    return false
  }
  return safeEqual(password, process.env.AUTH_PASSWORD || '')
}

function loadSessions() {
  const s = deps.getData(SESSIONS_KEY)
  return (s && typeof s === 'object') ? s : {}
}
function saveSessions(s) { deps.setData(SESSIONS_KEY, s) }

function sweep(sessions) {
  const now = Date.now()
  let changed = false
  for (const [tok, exp] of Object.entries(sessions)) {
    if (!exp || exp < now) { delete sessions[tok]; changed = true }
  }
  return changed
}

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex')
  const sessions = loadSessions()
  sweep(sessions)
  sessions[token] = Date.now() + SESSION_TTL_MS
  saveSessions(sessions)
  return token
}

export function verifySession(token) {
  if (!token) return false
  const sessions = loadSessions()
  const exp = sessions[token]
  if (!exp || exp < Date.now()) {
    if (sweep(sessions)) saveSessions(sessions)
    return false
  }
  return true
}

export function destroySession(token) {
  if (!token) return
  const sessions = loadSessions()
  if (sessions[token]) { delete sessions[token]; saveSessions(sessions) }
}

export function login(password) {
  if (!checkPassword(password)) return null
  return createSession()
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function sessionTokenFromReq(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || null
}

function bearerFromReq(req) {
  const h = req.headers['authorization'] || ''
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim()
  if (req.headers['x-api-token']) return req.headers['x-api-token']
  // Query param: the SSE stream (EventSource) can't set headers, so the native
  // app passes the token as ?api_token= on /api/events. Header is preferred.
  return (req.query && req.query.api_token) || null
}

export function verifyApiToken(token) {
  const t = apiToken()
  return Boolean(t) && Boolean(token) && safeEqual(token, t)
}

// Authenticated by EITHER a valid session cookie OR the static API token.
export function isAuthenticated(req) {
  if (verifySession(sessionTokenFromReq(req))) return true
  if (verifyApiToken(bearerFromReq(req))) return true
  return false
}

function cookieSecure(req) {
  if (process.env.COOKIE_SECURE === '1') return true
  if (process.env.COOKIE_SECURE === '0') return false
  return Boolean(req.secure) // honored when `trust proxy` is set + X-Forwarded-Proto=https
}

export function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(req),
    maxAge: SESSION_TTL_MS,
    path: '/',
  })
}

export function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: cookieSecure(req),
  })
}

// Paths reachable WITHOUT auth even when the gate is on. Everything else under
// /api/ requires a session cookie or the API token. Static assets + the SPA are
// not under /api, so the login page itself always loads.
const OPEN_PATHS = new Set([
  '/api/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/logout',
])

export function authGate(req, res, next) {
  if (!isAuthEnabled()) return next()                 // inert until configured
  if (!req.path.startsWith('/api/')) return next()    // static / SPA served freely
  if (OPEN_PATHS.has(req.path)) return next()
  if (isAuthenticated(req)) return next()
  return res.status(401).json({ error: 'Authentication required' })
}
