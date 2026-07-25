// deviceAuth.js — Phase A of the auth sequence: per-device rotating token
// pairs with refresh-reuse detection. Full spec: wiki/Auth-Device-Tokens.md.
//
// Each device enrolls once for a pair: a short-lived ACCESS token (presented
// like the legacy API_TOKEN) and a single-use rotating REFRESH token. A
// superseded refresh token presented again is the stolen-token signature —
// the device is revoked and a security alert fires (the one loud category
// the digest reshape allows).
//
// Storage: app_data.auth_devices carve-out (never the synced settings blob).
// Only SHA-256 hashes of secrets are stored; comparisons are timing-safe.
// Token format embeds the device id (`bda_<id>.<secret>` / `bdr_<id>.<secret>`)
// so verification is an O(1) lookup, not a registry scan.
//
// Like the rest of auth.js, this is meaningful only when the auth gate is on
// (AUTH_PASSWORD/-_HASH set) — with the gate off every route is open anyway.

import crypto from 'crypto'

const DEVICES_KEY = 'auth_devices'
export const ACCESS_TTL_MS = 60 * 60 * 1000 // 1 hour

let deps = { getData: () => null, setData: () => {} }
export function initDeviceAuth(d) { deps = { ...deps, ...d } }

// Injectable alert hook — server.js wires this to the push/email security
// senders so this module stays transport-free (and unit-testable).
let alertFn = null
export function onSecurityAlert(fn) { alertFn = fn }
function fireAlert(event, device) {
  try {
    if (alertFn) alertFn(event, device)
  } catch (e) {
    console.error('[deviceAuth] alert hook error:', e?.message)
  }
}

function loadDevices() {
  const d = deps.getData(DEVICES_KEY)
  return d && typeof d === 'object' ? d : {}
}
function saveDevices(d) { deps.setData(DEVICES_KEY, d) }

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex')
}

function safeEqualHex(aHex, bHex) {
  const a = Buffer.from(String(aHex))
  const b = Buffer.from(String(bHex))
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a)
    return false
  }
  return crypto.timingSafeEqual(a, b)
}

// Split `bda_<deviceId>.<secret>` → { kind, deviceId, secret } or null.
function parseToken(token) {
  const m = /^(bda|bdr)_([a-f0-9]{16})\.([A-Za-z0-9_-]{20,})$/.exec(String(token || ''))
  if (!m) return null
  return { kind: m[1], deviceId: m[2], secret: m[3] }
}

function mintPair(deviceId) {
  const access = `bda_${deviceId}.${crypto.randomBytes(32).toString('base64url')}`
  const refresh = `bdr_${deviceId}.${crypto.randomBytes(32).toString('base64url')}`
  return { access, refresh }
}

// Enroll a new device. Caller must already be authenticated (route-gated).
// Returns the ONLY plaintext copy of the pair that will ever exist.
export function enrollDevice({ name, platform } = {}) {
  const deviceId = crypto.randomBytes(8).toString('hex')
  const { access, refresh } = mintPair(deviceId)
  const now = new Date().toISOString()
  const devices = loadDevices()
  devices[deviceId] = {
    name: String(name || 'Unnamed device').slice(0, 80),
    platform: String(platform || 'unknown').slice(0, 40),
    created_at: now,
    last_seen: now,
    access_hash: sha256(access),
    access_expires: Date.now() + ACCESS_TTL_MS,
    refresh_hash: sha256(refresh),
    prev_refresh_hash: null,
    rotated_at: now,
    generation: 0,
    revoked_at: null,
    revoked_reason: null,
  }
  saveDevices(devices)
  console.log(`[deviceAuth] enrolled device ${deviceId} ("${devices[deviceId].name}", ${devices[deviceId].platform})`)
  return {
    device_id: deviceId,
    access_token: access,
    refresh_token: refresh,
    access_expires: devices[deviceId].access_expires,
  }
}

// Verify an access token. Touches last_seen at most once a minute (the
// registry lives in app_data — no need to persist on every request).
export function verifyDeviceAccessToken(token) {
  const parsed = parseToken(token)
  if (!parsed || parsed.kind !== 'bda') return false
  const devices = loadDevices()
  const device = devices[parsed.deviceId]
  if (!device || device.revoked_at) return false
  if (!device.access_expires || device.access_expires < Date.now()) return false
  if (!safeEqualHex(sha256(token), device.access_hash)) return false
  const now = Date.now()
  if (!device._seen_ms || now - device._seen_ms > 60 * 1000) {
    device._seen_ms = now
    device.last_seen = new Date(now).toISOString()
    saveDevices(devices)
  }
  return true
}

// Exchange a refresh token for a fresh pair (single-use rotation).
// Returns { ok, pair } | { ok: false, reuse: true } (revoked + alert fired)
// | { ok: false }. Callers must answer plain 401 either way — the attacker
// learns nothing from the response shape.
export function refreshDeviceTokens(token) {
  const parsed = parseToken(token)
  if (!parsed || parsed.kind !== 'bdr') return { ok: false }
  const devices = loadDevices()
  const device = devices[parsed.deviceId]
  if (!device) return { ok: false }
  const presentedHash = sha256(token)

  if (device.revoked_at) {
    // A dead device's tokens keep arriving? Someone still holds them.
    return { ok: false }
  }

  // The stolen-token signature: this refresh was already rotated past.
  if (device.prev_refresh_hash && safeEqualHex(presentedHash, device.prev_refresh_hash)) {
    device.revoked_at = new Date().toISOString()
    device.revoked_reason = 'refresh_reuse'
    saveDevices(devices)
    console.warn(`[deviceAuth] refresh REUSE detected for device ${parsed.deviceId} ("${device.name}") — device revoked`)
    fireAlert('refresh_reuse', { device_id: parsed.deviceId, name: device.name, platform: device.platform })
    return { ok: false, reuse: true }
  }

  if (!safeEqualHex(presentedHash, device.refresh_hash)) return { ok: false }

  const { access, refresh } = mintPair(parsed.deviceId)
  const now = new Date().toISOString()
  device.prev_refresh_hash = device.refresh_hash
  device.refresh_hash = sha256(refresh)
  device.access_hash = sha256(access)
  device.access_expires = Date.now() + ACCESS_TTL_MS
  device.rotated_at = now
  device.last_seen = now
  device.generation = (device.generation || 0) + 1
  saveDevices(devices)
  return {
    ok: true,
    pair: {
      device_id: parsed.deviceId,
      access_token: access,
      refresh_token: refresh,
      access_expires: device.access_expires,
    },
  }
}

export function revokeDevice(deviceId, reason = 'manual') {
  const devices = loadDevices()
  const device = devices[String(deviceId)]
  if (!device) return { ok: false, error: 'Device not found' }
  if (!device.revoked_at) {
    device.revoked_at = new Date().toISOString()
    device.revoked_reason = reason
    saveDevices(devices)
    console.log(`[deviceAuth] device ${deviceId} revoked (${reason})`)
  }
  return { ok: true }
}

// Registry view for the Settings UI — secrets (even hashed) never leave.
export function listDevices() {
  const devices = loadDevices()
  return Object.entries(devices).map(([id, d]) => ({
    device_id: id,
    name: d.name,
    platform: d.platform,
    created_at: d.created_at,
    last_seen: d.last_seen,
    generation: d.generation || 0,
    revoked_at: d.revoked_at || null,
    revoked_reason: d.revoked_reason || null,
  })).sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')))
}

// Fully remove a revoked device row (registry hygiene, Settings "Remove").
export function deleteDevice(deviceId) {
  const devices = loadDevices()
  if (!devices[String(deviceId)]) return { ok: false, error: 'Device not found' }
  delete devices[String(deviceId)]
  saveDevices(devices)
  return { ok: true }
}

// ---- Phase B scaffolding (App Attest) ----
// Real challenges so the native side can be developed against this today;
// verification is deliberately NOT implemented until it can be tested with
// a genuine attestation object (see wiki/Auth-Device-Tokens.md, Phase B).

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const challenges = new Map() // challenge -> expiry (in-memory is fine: 5-min TTL)

export function issueAttestChallenge() {
  const challenge = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  for (const [c, exp] of challenges) { if (exp < now) challenges.delete(c) }
  challenges.set(challenge, now + CHALLENGE_TTL_MS)
  return { challenge, expires_in_ms: CHALLENGE_TTL_MS }
}

export function consumeAttestChallenge(challenge) {
  const exp = challenges.get(String(challenge))
  if (!exp || exp < Date.now()) return false
  challenges.delete(String(challenge))
  return true
}
