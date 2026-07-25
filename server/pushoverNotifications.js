/**
 * Server-side Pushover notification engine.
 *
 * Mirrors pushNotifications.js but sends via the Pushover HTTP API. Solves
 * iOS web-push delivery unreliability — Pushover has a dedicated iOS app
 * with full APNs entitlements, so messages reliably reach the device, and
 * priority-2 (Emergency) bypasses Do Not Disturb and silent mode.
 *
 * Priority mapping (post-2026-07-24 digest reshape — only the deliberate
 * per-task opt-ins remain):
 *   0 — escalation-ladder nudges / nag_allowed gentle daily line / digest
 *   1 — Critical tag (fresh)
 *   2 — Critical tag Emergency (past due or >24h in crisis)
 *
 * Quiet hours: priority 0 honors quiet hours; Critical fires only for
 * tasks carrying the wake-me bypass label.
 */

import crypto from 'crypto'
import {
  queryTasks, getData, getNotifThrottle, setNotifThrottle,
  logNotifPush, getTask, updateTaskPartial, filterNotifiableTasks,
  escalationNudgeOverride, isCrisisTask,
} from './db.js'
import { isInQuietHours } from './userTime.js'

const PUSHOVER_API = 'https://api.pushover.net/1/messages.json'
const PUSHOVER_RECEIPT_API = 'https://api.pushover.net/1/receipts'

const AVOIDANCE_ENERGY_TYPES = ['errand', 'confrontation']
const ACTIVE_STATUSES = ['not_started', 'doing', 'waiting']

let loopTimer = null

// --- Configuration ---

function getCredentials(settings) {
  const userKey = settings.pushover_user_key
  const appToken = settings.pushover_app_token || process.env.PUSHOVER_DEFAULT_APP_TOKEN
  return { userKey: userKey || null, appToken: appToken || null }
}

// Build a deep link URL for a notification. Used to make every Pushover
// message tappable — opens the task in the app. Returns null if nothing is
// configured (notification still sends, just without a URL field).
//
// When `pushover_open_native` is on, the URL is the native app's custom scheme
// (`boomerang://?task=<id>`) so tapping opens the installed iOS app instead of
// the web app in Safari — the app registers the scheme (Info.plist
// CFBundleURLTypes) and routes it via @capacitor/app appUrlOpen. Off by default
// so existing web-only setups are unchanged. The scheme is fixed (`boomerang`)
// and matches the value registered natively.
// The native URL scheme is environment-split so a dev server's links open the
// side-by-side "Boomerang Dev" app (bundle ryakel.boomerang.app.dev, scheme
// boomerang-dev) instead of the prod app. Same dev detection as isDevEnv in
// server.js: Docker dev builds set APP_VERSION to 'dev' or 'dev-<sha>'.
const NATIVE_SCHEME = /^dev(-|$)/.test(process.env.APP_VERSION || '') ? 'boomerang-dev' : 'boomerang'

function buildDeepLink(settings, taskId) {
  // Link mode lives in its own app_data key (see /api/pushover/link-mode in
  // server.js) so the clobber-prone bulk settings blob can't erase it. The
  // settings-blob key is only a legacy fallback.
  const mode = getData('pushover_link_mode')
  const openNative = mode ? !!mode.open_native : !!settings.pushover_open_native
  if (openNative) {
    return taskId ? `${NATIVE_SCHEME}://?task=${encodeURIComponent(taskId)}` : `${NATIVE_SCHEME}://`
  }
  const base = (settings.public_app_url || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '')
  if (!base) return null
  return taskId ? `${base}/?task=${encodeURIComponent(taskId)}` : base
}


// --- Sending ---

/**
 * Send a Pushover message.
 * Returns { ok: boolean, status, request, receipt }. `receipt` only present for priority 2.
 * Network errors are swallowed and logged — never throws.
 */
export async function sendPushover({ userKey, appToken, title, message, priority = 0, sound, url, urlTitle }) {
  if (!userKey || !appToken) {
    console.error('[Pushover] sendPushover called without userKey/appToken')
    return { ok: false, error: 'Missing credentials' }
  }

  const params = new URLSearchParams()
  params.set('token', appToken)
  params.set('user', userKey)
  params.set('title', (title || 'Boomerang').slice(0, 250))
  params.set('message', (message || '').slice(0, 1024))
  params.set('priority', String(priority))
  if (sound) params.set('sound', sound)
  if (url) params.set('url', url)
  if (urlTitle) params.set('url_title', urlTitle.slice(0, 100))

  if (priority === 2) {
    params.set('retry', '30')      // retry every 30s
    params.set('expire', '3600')   // give up after 1 hour
  }

  try {
    const res = await fetch(PUSHOVER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.status !== 1) {
      console.error(`[Pushover] Send failed (${res.status}):`, data.errors || data || 'unknown error')
      return { ok: false, status: data.status, errors: data.errors, request: data.request }
    }
    return { ok: true, status: data.status, request: data.request, receipt: data.receipt || null }
  } catch (err) {
    console.error('[Pushover] Send network error:', err.message)
    return { ok: false, error: err.message }
  }
}

/**
 * Cancel an outstanding Emergency-priority retry loop.
 * Used when a task is resolved while the alarm is still ringing.
 */
export async function cancelEmergencyReceipt(appToken, receipt) {
  if (!appToken || !receipt) return { ok: false, error: 'Missing args' }
  try {
    const params = new URLSearchParams()
    params.set('token', appToken)
    const res = await fetch(`${PUSHOVER_RECEIPT_API}/${encodeURIComponent(receipt)}/cancel.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.status !== 1) {
      console.error(`[Pushover] Cancel failed (${res.status}):`, data.errors || data)
      return { ok: false, status: data.status, errors: data.errors }
    }
    console.log(`[Pushover] Cancelled emergency receipt ${receipt}`)
    return { ok: true }
  } catch (err) {
    console.error('[Pushover] Cancel network error:', err.message)
    return { ok: false, error: err.message }
  }
}

/**
 * Cancel by task id — looks up the saved receipt, cancels it, clears the column.
 * Fire-and-forget; safe to call when no receipt exists.
 */
export async function cancelEmergencyForTask(taskId) {
  try {
    const task = getTask(taskId)
    if (!task || !task.pushover_receipt) return
    const settings = getData('settings') || {}
    const { appToken } = getCredentials(settings)
    if (!appToken) return
    await cancelEmergencyReceipt(appToken, task.pushover_receipt)
    updateTaskPartial(taskId, { pushover_receipt: null })
  } catch (err) {
    console.error('[Pushover] cancelEmergencyForTask failed:', err.message)
  }
}

// --- Test sends ---

export async function sendTestNotification(overrides = {}) {
  const settings = getData('settings') || {}
  const fromSettings = getCredentials(settings)
  const userKey = overrides.userKey || fromSettings.userKey
  const appToken = overrides.appToken || fromSettings.appToken
  if (!userKey) return { success: false, error: 'Pushover User Key not configured' }
  if (!appToken) return { success: false, error: 'Pushover App Token not configured' }
  // Include a deep link so the test is tappable — this is how you verify the
  // native-app deep link works: with pushover_open_native on it's boomerang://
  // (opens the iOS app), else the https public URL.
  const url = buildDeepLink(settings, null)
  const result = await sendPushover({
    userKey, appToken,
    title: 'Boomerang test',
    message: url ? 'Pushover is wired up. Tap to open Boomerang.' : 'Pushover is wired up correctly.',
    priority: 0,
    url,
    urlTitle: url ? 'Open in Boomerang' : undefined,
  })
  if (!result.ok) return { success: false, error: result.errors?.[0] || result.error || 'Send failed' }
  return { success: true, request: result.request }
}

export async function sendTestEmergency(overrides = {}) {
  const settings = getData('settings') || {}
  const fromSettings = getCredentials(settings)
  const userKey = overrides.userKey || fromSettings.userKey
  const appToken = overrides.appToken || fromSettings.appToken
  if (!userKey) return { success: false, error: 'Pushover User Key not configured' }
  if (!appToken) return { success: false, error: 'Pushover App Token not configured' }
  const result = await sendPushover({
    userKey, appToken,
    title: 'Boomerang Emergency test',
    message: 'This is a priority-2 Emergency test. It will auto-cancel in ~90 seconds.',
    priority: 2,
    sound: 'persistent',
  })
  if (!result.ok) return { success: false, error: result.errors?.[0] || result.error || 'Send failed' }
  if (result.receipt) {
    setTimeout(() => {
      cancelEmergencyReceipt(appToken, result.receipt).catch(() => {})
    }, 90 * 1000)
  }
  return { success: true, request: result.request, receipt: result.receipt }
}

// --- Status ---

export function getPushoverStatus() {
  const settings = getData('settings') || {}
  const { userKey, appToken } = getCredentials(settings)
  return {
    configured: !!(userKey && appToken),
    has_user_key: !!userKey,
    has_app_token: !!appToken,
    app_token_from_env: !settings.pushover_app_token && !!process.env.PUSHOVER_DEFAULT_APP_TOKEN,
  }
}

// --- Notification helpers (mirror pushNotifications.js) ---

function getFreqMs(settings, key, fallbackHours) {
  const val = settings[key]
  const hours = val != null ? val : fallbackHours
  return hours * 60 * 60 * 1000
}

// isInQuietHours / getUserTimeParts now live in userTime.js (shared, timezone-aware)

function isOverdue(task) {
  if (!task.due_date) return false
  const [y, m, d] = task.due_date.split('-').map(Number)
  const due = new Date(y, m - 1, d, 23, 59, 59, 999)
  return Date.now() > due.getTime()
}

function taskHasBypassLabel(task, settings) {
  const target = (settings.quiet_hours_bypass_label || 'wake-me').toLowerCase()
  if (!target) return false
  if (!Array.isArray(task.tags)) return false
  return task.tags.some(t => {
    const v = typeof t === 'string' ? t : (t?.id || t?.name || '')
    return String(v).toLowerCase() === target
  })
}

function applyAvoidanceBoost(freqMs, task) {
  if (!task.energy || !AVOIDANCE_ENERGY_TYPES.includes(task.energy)) return freqMs
  let boost = 1.3
  if (task.energy_level === 3) boost *= 1.2
  return Math.round(freqMs / boost)
}

// Crisis nag body — mirrors pushNotifications.js (duplicated per-file like
// the other engine helpers): age-in-crisis + due info + first open checklist
// step as the "first move" so the nag helps start, not just yells.
function buildCrisisBody(task) {
  const bits = []
  if (task.crisis_since) {
    const days = Math.floor((Date.now() - new Date(task.crisis_since).getTime()) / 86400000)
    if (days >= 1) bits.push(`critical for ${days}d`)
  }
  if (task.due_date) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const due = new Date(task.due_date + 'T00:00:00')
    const diffDays = Math.round((due - today) / 86400000)
    if (diffDays < 0) bits.push(`due ${Math.abs(diffDays)}d ago`)
    else if (diffDays === 0) bits.push('due today')
  }
  // A hire-out Reality-check verdict overrides the first move — the nag
  // should push the call, not the repair.
  let firstMove = null
  if (task.diy_verdict === 'hire') {
    bits.push('hire it out')
    if (task.diy_first_move) firstMove = task.diy_first_move
  }
  if (!firstMove) {
    for (const cl of (Array.isArray(task.checklists) ? task.checklists : [])) {
      const open = (cl.items || []).find(it => !it.completed && it.text)
      if (open) { firstMove = open.text; break }
    }
  }
  let body = `"${task.title}"${bits.length ? ` — ${bits.join(', ')}` : ''}`
  if (firstMove) body += `. First move: ${firstMove}`
  return body
}

function checkThrottle(key, freqMs) {
  const last = getNotifThrottle(key)
  if (!last) return true
  return Date.now() - new Date(last).getTime() >= freqMs
}

// Apply the adaptive-throttle multiplier (consults notification_log).
// A (channel, type) that's been ignored 10 times in a row backs off
// progressively, capped at 8x. Tap or complete resets to 1x.
function markThrottle(key) {
  setNotifThrottle(key, new Date().toISOString())
}

function genId() {
  return crypto.randomUUID()
}

function priorityToSound(priority) {
  if (priority === 2) return 'persistent'
  if (priority === 1) return 'pushover'
  return undefined
}

function truncatedTitle(prefix, title) {
  const max = 100
  const room = max - prefix.length
  const t = (title || '').slice(0, Math.max(10, room))
  return `${prefix}${t}`
}

// --- Dispatcher loop ---

async function runPushoverCheck() {
  try {
    const settings = getData('settings') || {}
    if (!settings.pushover_notifications_enabled) return
    const { userKey, appToken } = getCredentials(settings)
    if (!userKey || !appToken) return

    const allTasks = queryTasks({})
    const activeTasks = filterNotifiableTasks(allTasks)
    if (activeTasks.length === 0) return

    const nonSnoozed = activeTasks.filter(t => !t.snoozed_until || new Date(t.snoozed_until) <= new Date())
    const inQuiet = isInQuietHours(settings)

    // Crisis tag ("prio") — per-task loop at notif_freq_crisis (default 2h),
    // BEFORE and exempt from the high-pri loop's per-tick cap. Priority 1
    // immediately; escalates to priority 2 Emergency (30s retry / 1h expire /
    // act-to-cancel receipt) once the task is overdue OR has sat in crisis
    // untouched for >24h (decision D4). Deliberately NOT adaptiveFreq'd —
    // ignoring a crisis must never teach the app to back off. Quiet hours:
    // same per-task wake-me bypass gate as the high-pri loop (D1 — crisis
    // does not auto-bypass; the edit modal offers "also wake me").
    const crisisIds = new Set()
    {
      const crisisTasks = nonSnoozed.filter(t => isCrisisTask(t, settings))
      for (const task of crisisTasks) {
        crisisIds.add(task.id)

        const ageMs = task.crisis_since ? Date.now() - new Date(task.crisis_since).getTime() : 0
        const priority = (isOverdue(task) || ageMs > 24 * 60 * 60 * 1000) ? 2 : 1
        if (inQuiet && !taskHasBypassLabel(task, settings)) continue

        const freq = applyAvoidanceBoost(getFreqMs(settings, 'notif_freq_crisis', 2), task)
        const throttleKey = `pushover_crisis:${task.id}`
        if (!checkThrottle(throttleKey, freq)) continue

        const body = buildCrisisBody(task)
        const url = buildDeepLink(settings, task.id)
        const result = await sendPushover({
          userKey, appToken,
          title: truncatedTitle('[BOOMERANG] 🚨 ', task.title),
          message: body,
          priority,
          sound: priorityToSound(priority),
          url, urlTitle: url ? 'Open in Boomerang' : undefined,
        })
        if (result.ok) {
          markThrottle(throttleKey)
          logNotifPush(genId(), 'crisis', task.id, '[BOOMERANG] 🚨 ' + task.title, body, 'pushover')
          if (priority === 2 && result.receipt) {
            updateTaskPartial(task.id, { pushover_receipt: result.receipt })
          }
        }
      }
    }

    // Below: priority 0 categories — all suppressed during quiet hours.
    if (inQuiet) return

    // Escalation ladder — same tactic-aware per-task nudge as push/email, at
    // the rung's own cadence. Excluded from the aggregate stale/nudge pools.
    const escalationActiveIds = new Set()
    if (settings.pushover_notif_escalation !== false) {
      // Crisis takes precedence — no stacked escalation nudge on a crisis task.
      const escalationTasks = nonSnoozed.filter(t => t.escalation_current_rung != null && !crisisIds.has(t.id))
      for (const task of escalationTasks) {
        escalationActiveIds.add(task.id)
        const override = escalationNudgeOverride(task)
        if (!override) continue
        const freq = (override.cadenceDays || 1) * 24 * 60 * 60 * 1000
        const throttleKey = `pushover_escalation:${task.id}`
        if (!checkThrottle(throttleKey, freq)) continue
        const title = task.escalation_stuck ? '[BOOMERANG] Out of moves — brainstorm?'
          : task.escalation_awaiting_advance ? '[BOOMERANG] Ready to switch tactics?'
          : truncatedTitle('[BOOMERANG] Follow up: ', task.title)
        const url = buildDeepLink(settings, task.id)
        const result = await sendPushover({
          userKey, appToken, title, message: override.text, priority: 0,
          url, urlTitle: url ? 'Open in Boomerang' : undefined,
        })
        if (result.ok) {
          markThrottle(throttleKey)
          logNotifPush(genId(), 'escalation', task.id, title, override.text, 'pushover')
        }
      }
    }

    // Per-task "remind me" (nag_allowed) — ONE gentle line per opted-in
    // task per day, priority 0, forward-framed.
    for (const task of nonSnoozed) {
      if (!task.nag_allowed || crisisIds.has(task.id) || escalationActiveIds.has(task.id)) continue
      if (!checkThrottle(`pushover_remind:${task.id}`, 24 * 60 * 60 * 1000)) continue
      const body = `"${task.title}" is on your list — when you're ready.`
      const url = buildDeepLink(settings, task.id)
      const result = await sendPushover({
        userKey, appToken,
        title: truncatedTitle('[BOOMERANG] ', task.title),
        message: body, priority: 0,
        url, urlTitle: url ? 'Open in Boomerang' : undefined,
      })
      if (result.ok) {
        markThrottle(`pushover_remind:${task.id}`)
        logNotifPush(genId(), 'remind', task.id, '[BOOMERANG] ' + task.title, body, 'pushover')
      }
    }
  } catch (err) {
    console.error('[Pushover] Notification check failed:', err.message)
  }
}

// --- Package push (called from server.js) ---

export async function sendPackagePushover(pkg, eventType) {
  const settings = getData('settings') || {}
  if (!settings.pushover_notifications_enabled) return
  const { userKey, appToken } = getCredentials(settings)
  if (!userKey || !appToken) return

  if (eventType === 'delivered' && settings.pushover_notif_package_delivered === false) return
  if (eventType === 'exception' && settings.pushover_notif_package_exception === false) return
  if (eventType === 'signature_required' && settings.pushover_notif_package_signature === false) return

  const key = `pushover_pkg:${pkg.id}:${eventType}`
  if (!checkThrottle(key, 30 * 60 * 1000)) return

  const labels = {
    delivered: 'Package Delivered',
    exception: 'Package Exception',
    out_for_delivery: 'Out for Delivery',
    signature_required: 'Signature Required',
  }
  const title = `[BOOMERANG] ${labels[eventType] || 'Package Update'}`
  const label = pkg.label || pkg.tracking_number
  const body = `${labels[eventType] || 'Update'}: ${label}`
  const priority = eventType === 'exception' || eventType === 'signature_required' ? 1 : 0

  const result = await sendPushover({
    userKey, appToken, title, message: body, priority,
    sound: priorityToSound(priority),
  })
  if (result.ok) {
    markThrottle(key)
    logNotifPush(genId(), `package_${eventType}`, null, title, body, 'pushover')
  }
}

// Multi-channel digest dispatch — THE one scheduled send of the day. Called
// by the digest pipeline in server.js (scheduled path passes the assembled
// digest; the Settings "Send test digest" button re-triggers it manually —
// collapse keys mean a re-send replaces the banner rather than stacking).
export async function sendDigestNow(prebuilt = null) {
  const settings = getData('settings') || {}
  let digest = prebuilt
  if (!digest) {
    const { buildDigest } = await import('./digestBuilder.js')
    digest = buildDigest(settings)
  }

  const fired = []
  const skipped = []

  // The test path must obey the SAME gates as the scheduled path (channel
  // master AND digest opt-in) — it used to check only the digest flags, so
  // with all masters off it still fired every opted-in channel: a "test"
  // that behaves differently from the real thing (2026-07-15 report:
  // digest toggles all displayed off, test still double-sent).
  const masterOn = {
    pushover: settings.pushover_notifications_enabled === true,
    email: settings.email_notifications_enabled === true,
    push: settings.push_notifications_enabled === true,
  }

  // Pushover
  if (!masterOn.pushover) {
    skipped.push({ channel: 'pushover', reason: 'channel master off' })
  } else if (settings.pushover_digest_enabled) {
    const { userKey, appToken } = getCredentials(settings)
    if (userKey && appToken) {
      const url = buildDeepLink(settings, null)
      const result = await sendPushover({
        userKey, appToken,
        title: `[BOOMERANG] ${digest.pushTitle || digest.subject}`,
        message: digest.textBody.slice(0, 1024),
        priority: 0,
        url, urlTitle: url ? 'Open in Boomerang' : undefined,
      })
      if (result.ok) {
        fired.push('pushover')
        logNotifPush(genId(), 'digest', null, digest.subject, digest.textBody.slice(0, 500), 'pushover')
      } else {
        skipped.push({ channel: 'pushover', reason: result.errors?.[0] || result.error || 'send failed' })
      }
    } else {
      skipped.push({ channel: 'pushover', reason: 'credentials missing' })
    }
  } else {
    skipped.push({ channel: 'pushover', reason: 'disabled' })
  }

  // Email + Web Push delegated to their modules so they reuse the same
  // transporter / VAPID setup. Lazy-imported to avoid circular deps.
  if (!masterOn.email) {
    skipped.push({ channel: 'email', reason: 'channel master off' })
  } else if (settings.email_digest_enabled) {
    try {
      const { sendDigestEmail } = await import('./emailNotifications.js')
      const ok = await sendDigestEmail(digest)
      if (ok) fired.push('email')
      else skipped.push({ channel: 'email', reason: 'send failed' })
    } catch (err) {
      skipped.push({ channel: 'email', reason: err.message })
    }
  } else {
    skipped.push({ channel: 'email', reason: 'disabled' })
  }

  if (!masterOn.push) {
    skipped.push({ channel: 'push', reason: 'channel master off' })
  } else if (settings.push_digest_enabled !== false) {
    try {
      const { sendDigestPush } = await import('./pushNotifications.js')
      const ok = await sendDigestPush(digest)
      if (ok) fired.push('push')
      else skipped.push({ channel: 'push', reason: 'send failed' })
    } catch (err) {
      skipped.push({ channel: 'push', reason: err.message })
    }
  } else {
    skipped.push({ channel: 'push', reason: 'disabled' })
  }

  if (fired.length === 0) {
    const reasons = skipped.map(s => `${s.channel}: ${s.reason}`).join('; ')
    return {
      success: false,
      fired,
      skipped,
      error: `No digest channel delivered. Enable a notification channel and its digest in Settings → Notifications. (${reasons})`,
    }
  }
  return { success: true, fired, skipped, subject: digest.pushTitle || digest.subject }
}

// --- Lifecycle ---

export function startPushoverNotifications() {
  if (loopTimer) return
  loopTimer = setInterval(runPushoverCheck, 60 * 1000)
  setTimeout(runPushoverCheck, 25000)
  console.log('Pushover notifications: lifecycle started (waiting for credentials)')
}

export function stopPushoverNotifications() {
  if (loopTimer) {
    clearInterval(loopTimer)
    loopTimer = null
  }
}
