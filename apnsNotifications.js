// apnsNotifications.js — native iOS push via Apple's APNs (Phase 4 of the
// native app). Sends real, Boomerang-branded iOS notifications to the native
// app; tapping the banner itself opens the app (unlike web push → PWA/Safari
// and Pushover → the Pushover app).
//
// Zero new dependencies: APNs speaks HTTP/2 (Node `http2`) with token-based
// auth (ES256 JWT, Node `crypto`).
//
// CONFIG — env only, secrets never in SQLite (same posture as SMTP):
//   APNS_KEY_P8   the .p8 AuthKey contents (literal, \n or base64 both fine)
//   APNS_KEY_ID   10-char Key ID from the developer portal
//   APNS_TEAM_ID  Apple Team ID (e.g. L7JZ99D6K5)
//   APNS_TOPIC    bundle id (default: ryakel.boomerang.app)
//   APNS_ENV      'sandbox' (Xcode debug builds — the default) | 'production'
// Unconfigured → complete no-op, endpoints report configured:false. Nothing
// else in the app changes (the standard graceful-degradation posture).
//
// DEVICE TOKENS live in the `apns_devices` app_data key (a carve-out, NOT the
// synced settings blob — same reasoning as pushover_link_mode): map of
// token → { added_at, last_seen }. Registered via POST /api/apns/register
// (called by the native app after the user enables native push in Settings).
// Tokens that APNs reports gone (410 / BadDeviceToken) are pruned on send.

import http2 from 'http2'
import crypto from 'crypto'
import { getData, setData } from './db.js'

const DEVICES_KEY = 'apns_devices'
const JWT_TTL_MS = 45 * 60 * 1000 // Apple allows 20-60 min; refresh at 45

function config() {
  let p8 = process.env.APNS_KEY_P8 || ''
  if (p8 && !p8.includes('BEGIN')) {
    // Allow base64-encoded key material for env-var friendliness
    try { p8 = Buffer.from(p8, 'base64').toString('utf8') } catch { /* keep as-is */ }
  }
  p8 = p8.replace(/\\n/g, '\n')
  return {
    p8,
    keyId: process.env.APNS_KEY_ID || '',
    teamId: process.env.APNS_TEAM_ID || '',
    topic: process.env.APNS_TOPIC || 'ryakel.boomerang.app',
    host: (process.env.APNS_ENV || 'sandbox') === 'production'
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com',
    env: process.env.APNS_ENV || 'sandbox',
  }
}

export function isApnsConfigured() {
  const c = config()
  return Boolean(c.p8 && c.keyId && c.teamId)
}

// --- ES256 JWT, cached ---
let cachedJwt = null
let cachedJwtAt = 0
function getJwt() {
  const now = Date.now()
  if (cachedJwt && now - cachedJwtAt < JWT_TTL_MS) return cachedJwt
  const c = config()
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64url({ alg: 'ES256', kid: c.keyId })}.${b64url({ iss: c.teamId, iat: Math.floor(now / 1000) })}`
  const key = crypto.createPrivateKey(c.p8)
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' })
  cachedJwt = `${unsigned}.${signature.toString('base64url')}`
  cachedJwtAt = now
  return cachedJwt
}

// --- device registry (app_data carve-out) ---
function loadDevices() {
  const d = getData(DEVICES_KEY)
  return d && typeof d === 'object' ? d : {}
}

export function registerApnsDevice(token) {
  const clean = String(token || '').trim().toLowerCase()
  if (!/^[0-9a-f]{32,200}$/.test(clean)) return { ok: false, error: 'invalid token' }
  const devices = loadDevices()
  const now = new Date().toISOString()
  devices[clean] = { added_at: devices[clean]?.added_at || now, last_seen: now }
  setData(DEVICES_KEY, devices)
  console.log(`[APNs] device registered (${Object.keys(devices).length} total)`)
  return { ok: true, devices: Object.keys(devices).length }
}

export function unregisterApnsDevice(token) {
  const clean = String(token || '').trim().toLowerCase()
  const devices = loadDevices()
  if (devices[clean]) {
    delete devices[clean]
    setData(DEVICES_KEY, devices)
    console.log(`[APNs] device unregistered (${Object.keys(devices).length} left)`)
  }
  return { ok: true, devices: Object.keys(devices).length }
}

export function getApnsStatus(deviceToken = null) {
  const c = config()
  const devices = loadDevices()
  return {
    configured: isApnsConfigured(),
    missing: [
      !c.p8 && 'APNS_KEY_P8',
      !c.keyId && 'APNS_KEY_ID',
      !c.teamId && 'APNS_TEAM_ID',
    ].filter(Boolean),
    env: c.env,
    topic: c.topic,
    devices: Object.keys(devices).length,
    // When the caller identifies itself (?token=), say whether THAT device
    // is in the registry — lets the Settings UI show "already enabled"
    // instead of a stateless Enable button.
    ...(deviceToken ? { this_device: !!devices[String(deviceToken).trim().toLowerCase()] } : {}),
  }
}

// --- send ---
// One HTTP/2 request per device token. A fresh session per send batch keeps
// this dead simple (single user, 1-3 devices); connection pooling is a
// later optimization if it ever matters.
function sendToToken(session, token, payload, headers) {
  return new Promise((resolve) => {
    const req = session.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      ...headers,
    })
    let body = ''
    let status = 0
    req.on('response', (h) => { status = h[':status'] })
    req.on('data', (c) => { body += c })
    req.on('end', () => resolve({ token, status, body }))
    req.on('error', (err) => resolve({ token, status: 0, body: String(err?.message || err) }))
    req.setTimeout(10000, () => { req.close(); resolve({ token, status: 0, body: 'timeout' }) })
    req.end(JSON.stringify(payload))
  })
}

// Send an alert push to every registered device. opts:
//   { title, body, url?, threadId?, sound? }
// url rides in the payload's custom data; the client's tap handler feeds it to
// applyDeepLink() (same shape as web push/Pushover: '/?task=<id>').
export async function sendApnsToAll({ title, message, url = null, threadId = 'boomerang', sound = 'default' }) {
  if (!isApnsConfigured()) return { ok: false, error: 'APNs not configured', sent: 0 }
  const devices = Object.keys(loadDevices())
  if (devices.length === 0) return { ok: false, error: 'no devices registered', sent: 0 }

  const c = config()
  let jwt
  try {
    jwt = getJwt()
  } catch (err) {
    console.error('[APNs] JWT signing failed (bad APNS_KEY_P8?):', err.message)
    return { ok: false, error: `JWT signing failed: ${err.message}`, sent: 0 }
  }

  const payload = {
    aps: {
      alert: { title, body: message },
      sound,
      'thread-id': threadId,
    },
    ...(url ? { url } : {}),
  }
  const headers = {
    authorization: `bearer ${jwt}`,
    'apns-topic': c.topic,
    'apns-push-type': 'alert',
    'apns-priority': '10',
  }

  const session = http2.connect(c.host)
  const sessionError = new Promise((resolve) => session.on('error', (e) => resolve(e)))
  const results = await Promise.race([
    Promise.all(devices.map((t) => sendToToken(session, t, payload, headers))),
    sessionError.then((e) => ({ connectError: String(e?.message || e) })),
  ])
  session.close()

  if (results.connectError) {
    console.error('[APNs] connection failed:', results.connectError)
    return { ok: false, error: `APNs connection failed: ${results.connectError}`, sent: 0 }
  }

  let sent = 0
  const stale = []
  for (const r of results) {
    if (r.status === 200) { sent += 1; continue }
    let reason = ''
    try { reason = JSON.parse(r.body || '{}').reason || '' } catch { reason = r.body }
    console.warn(`[APNs] send failed status=${r.status} reason=${reason || 'unknown'}`)
    if (r.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') stale.push(r.token)
  }
  if (stale.length > 0) {
    const devicesMap = loadDevices()
    for (const t of stale) delete devicesMap[t]
    setData(DEVICES_KEY, devicesMap)
    console.log(`[APNs] pruned ${stale.length} stale device token(s)`)
  }
  console.log(`[APNs] sent ${sent}/${devices.length}: ${title}`)
  return { ok: sent > 0, sent, failed: devices.length - sent }
}

export async function sendApnsTest() {
  const status = getApnsStatus()
  if (!status.configured) {
    return { success: false, error: `APNs not configured — missing env: ${status.missing.join(', ')}` }
  }
  if (status.devices === 0) {
    return { success: false, error: 'No devices registered — enable native push in the app first (Settings → Notifications).' }
  }
  const result = await sendApnsToAll({
    title: 'Boomerang native test',
    message: 'Native APNs is wired up. Tapping this opens the app.',
    url: '/',
  })
  return result.ok ? { success: true, sent: result.sent } : { success: false, error: result.error || `0 of ${status.devices} devices reachable` }
}
