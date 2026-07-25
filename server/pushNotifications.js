/**
 * Server-side Web Push notification engine.
 *
 * Mirrors the email notification logic but sends via Web Push API.
 * VAPID keys are auto-generated on first startup and stored in the database.
 * Can be overridden with VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars.
 */

import webpush from 'web-push'
import { readFileSync, existsSync } from 'fs'
import crypto from 'crypto'
import { queryTasks, getData, setData, getAllPushSubscriptions, deletePushSubscription, getNotifThrottle, setNotifThrottle, logNotifPush, filterNotifiableTasks, escalationNudgeOverride, isCrisisTask } from './db.js'
import { isInQuietHours } from './userTime.js'
import { isApnsConfigured, sendApnsToAll, hasApnsTargets } from './apnsNotifications.js'

// --- Environment (optional overrides) ---
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
let vapidEmail = process.env.VAPID_EMAIL

if (existsSync('.env')) {
  const envFile = readFileSync('.env', 'utf-8')
  vapidPublicKey = vapidPublicKey || envFile.match(/VAPID_PUBLIC_KEY="?([^"\n]+)"?/)?.[1]
  vapidPrivateKey = vapidPrivateKey || envFile.match(/VAPID_PRIVATE_KEY="?([^"\n]+)"?/)?.[1]
  vapidEmail = vapidEmail || envFile.match(/VAPID_EMAIL="?([^"\n]+)"?/)?.[1]
}

// Auto-generate and persist VAPID keys if not provided via env
function ensureVapidKeys() {
  if (vapidPublicKey && vapidPrivateKey) return

  // Check database for previously generated keys
  const stored = getData('vapid_keys')
  if (stored?.publicKey && stored?.privateKey) {
    vapidPublicKey = stored.publicKey
    vapidPrivateKey = stored.privateKey
    return
  }

  // Generate new keys and persist
  const keys = webpush.generateVAPIDKeys()
  vapidPublicKey = keys.publicKey
  vapidPrivateKey = keys.privateKey
  setData('vapid_keys', { publicKey: keys.publicKey, privateKey: keys.privateKey })
  console.log('[Push] Auto-generated VAPID keys and stored in database')
}

const AVOIDANCE_ENERGY_TYPES = ['errand', 'confrontation']
// ACTIVE_STATUSES retained for any legacy refs; new code uses isNotifiable()
// from db.js which folds in project / snooze_indefinite / gmail_pending rules.
const ACTIVE_STATUSES = ['not_started', 'doing', 'waiting']

let loopTimer = null

// --- Configuration ---

export function isConfigured() {
  return !!(vapidPublicKey && vapidPrivateKey)
}

export function getVapidPublicKey() {
  return vapidPublicKey || null
}

function setupVapid() {
  if (!isConfigured()) return
  // Use configured email, or fall back to SMTP user / NOTIFICATION_EMAIL
  const fallbackEmail = process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER || process.env.VAPID_EMAIL
  const email = vapidEmail || fallbackEmail || 'push@example.com'
  const mailto = email.startsWith('mailto:') ? email : `mailto:${email}`
  webpush.setVapidDetails(mailto, vapidPublicKey, vapidPrivateKey)
}

// --- Push sending ---

// Phase 4b: the Push channel has two delivery legs — web push (browser
// subscriptions) and native APNs (the iOS app's registered devices). One
// engine computes every notification; this function fans out to both legs.
// Arbitration: when the native leg lands on ≥1 device, Apple web-push
// endpoints (Safari / Home-Screen PWA) are skipped, so a phone carrying both
// the PWA and the native app never gets the same banner twice. Non-Apple
// endpoints (desktop Chrome / Firefox) always still receive. Escape hatch:
// settings.push_web_alongside_native === true keeps Apple endpoints firing.
// If the native leg sends 0 (unconfigured, no devices, expired key), the
// web leg runs in full — native can only ever reduce duplication, never
// silently drop a notification.
async function sendPush(payload) {
  let nativeSent = 0
  try {
    if (isApnsConfigured()) {
      const url = payload.url
        || (payload.data?.taskId ? `/?task=${payload.data.taskId}` : null)
      const result = await sendApnsToAll({
        title: payload.title,
        message: payload.body,
        url,
        threadId: payload.tag || 'boomerang',
        collapseId: payload.tag || null,
      })
      nativeSent = result.sent || 0
    }
  } catch (err) {
    console.error('[Push] APNs leg failed, falling through to web push:', err.message)
  }

  let subscriptions = getAllPushSubscriptions()
  if (nativeSent > 0) {
    const settings = getData('settings') || {}
    if (settings.push_web_alongside_native !== true) {
      const before = subscriptions.length
      subscriptions = subscriptions.filter(s => !s.endpoint.includes('push.apple.com'))
      if (subscriptions.length < before) {
        console.log(`[Push] Delivered natively to ${nativeSent} device(s); skipped ${before - subscriptions.length} Apple web-push endpoint(s)`)
      }
    }
  }
  if (subscriptions.length === 0) return nativeSent > 0

  const payloadStr = JSON.stringify(payload)
  let sent = false

  for (const sub of subscriptions) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    }
    try {
      await webpush.sendNotification(pushSub, payloadStr)
      sent = true
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
        // Subscription expired, invalid, or VAPID mismatch — clean up
        console.log(`[Push] Removing invalid subscription (${err.statusCode}): ...${sub.endpoint.slice(-30)}`)
        deletePushSubscription(sub.endpoint)
      } else {
        console.error(`[Push] Send failed (${err.statusCode || 'unknown'}):`, err.message)
        if (err.body) console.error(`[Push] Response body:`, err.body)
      }
    }
  }
  return sent || nativeSent > 0
}

// --- Notification helpers (same as emailNotifications.js) ---

function getFreqMs(settings, key, fallbackHours) {
  const val = settings[key]
  const hours = val != null ? val : fallbackHours
  return hours * 60 * 60 * 1000
}

// isInQuietHours imported from userTime.js

function applyAvoidanceBoost(freqMs, task) {
  if (!task.energy || !AVOIDANCE_ENERGY_TYPES.includes(task.energy)) return freqMs
  let boost = 1.3
  if (task.energy_level === 3) boost *= 1.2
  return Math.round(freqMs / boost)
}

// Crisis nag body: age-in-crisis + due info + the first open checklist step
// (the AI triage's "first move" — the highest-leverage line for actually
// getting started instead of just being yelled at). Shared shape across the
// push/email/pushover engines (duplicated per-file like the other helpers).
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

function markThrottle(key) {
  setNotifThrottle(key, new Date().toISOString())
}

function genId() {
  return crypto.randomUUID()
}

// --- Main notification check loop ---
//
// 2026-07-24 digest reshape ("The Great Alert Deletion"): the ambient flood
// — high-priority escalation, generic due-status alerts, stale, nudges,
// size-based, pile-up, habit pace, suggestion pings — is DELETED, not
// disabled. Everything informational folds into the one morning digest
// (see digestBuilder.js + the digest pipeline in server.js). What remains
// here are the deliberate per-task opt-ins, the intentionally rare, loud
// exceptions: the Critical tag, escalation ladders, and the per-task
// "remind me" (nag_allowed) gentle daily line. Event-driven pings
// (packages, Quokka plan-ready) live below as their own opt-in senders.

async function runPushCheck() {
  try {
    if (!isConfigured()) return

    const settings = getData('settings') || {}
    if (!settings.push_notifications_enabled) return
    if (isInQuietHours(settings)) return

    // Same native-aware bail as the digest check: a native-only phone (zero
    // web subscriptions) must still get the full engine pass.
    const subscriptions = getAllPushSubscriptions()
    if (subscriptions.length === 0 && !hasApnsTargets()) return

    const allTasks = queryTasks({})
    const activeTasks = filterNotifiableTasks(allTasks)
    if (activeTasks.length === 0) return

    const nonSnoozed = activeTasks.filter(t => !t.snoozed_until || new Date(t.snoozed_until) <= new Date())

    // Crisis tag — the most aggressive per-task loop in the app, at its own
    // notif_freq_crisis cadence (default 2h) regardless of due date. A
    // deliberate per-task opt-in (the user explicitly declares an emergency),
    // so it survives the digest reshape as the loudest of the rare pings.
    // Rides the channel master only (the old highpri toggle died with the
    // high-pri escalation ladder). Web push stays silent during quiet hours
    // via the engine-wide gate above.
    const crisisIds = new Set()
    {
      const crisisTasks = nonSnoozed.filter(t => isCrisisTask(t, settings))
      for (const task of crisisTasks) {
        crisisIds.add(task.id)
        const freq = applyAvoidanceBoost(getFreqMs(settings, 'notif_freq_crisis', 2), task)
        if (checkThrottle(`push_crisis:${task.id}`, freq)) {
          const body = buildCrisisBody(task)
          const sent = await sendPush({ title: '🚨 CRITICAL', body, tag: `crisis:${task.id}`, data: { taskId: task.id } })
          if (sent) {
            markThrottle(`push_crisis:${task.id}`)
            logNotifPush(genId(), 'crisis', task.id, '🚨 CRITICAL', body)
          }
        }

        // "Still critical?" staleness check-in (D2): after crisis_stale_days
        // (default 7, 0 = never) marked critical, ONE gentle ping per window
        // asking the user to keep or demote. Never auto-demotes — the in-app
        // banner in EditTaskModal carries the Keep/Demote actions.
        const staleDays = settings.crisis_stale_days ?? 7
        if (staleDays > 0 && task.crisis_since) {
          const ageMs = Date.now() - new Date(task.crisis_since).getTime()
          const staleMs = staleDays * 86400000
          if (ageMs > staleMs && checkThrottle(`push_crisis_stale:${task.id}`, staleMs)) {
            const days = Math.floor(ageMs / 86400000)
            const body = `"${task.title}" has been marked critical for ${days} days. Still critical? Open it to keep or demote.`
            const sent = await sendPush({ title: 'Still critical?', body, tag: `crisis-stale:${task.id}`, data: { taskId: task.id } })
            if (sent) {
              markThrottle(`push_crisis_stale:${task.id}`)
              logNotifPush(genId(), 'crisis_stale', task.id, 'Still critical?', body)
            }
          }
        }
      }
    }

    // Escalation ladder — tasks with an active contact-attempt ladder get
    // their own tactic-aware nudge (current rung's suggestion/script, or the
    // prompted-advance copy) at the RUNG's own cadence. A deliberate
    // per-task opt-in; survives the digest reshape.
    const escalationActiveIds = new Set()
    if (settings.push_notif_escalation !== false) {
      // Crisis takes precedence — a crisis task with an active ladder already
      // nags at the crisis cadence; don't stack the escalation nudge on top.
      const escalationTasks = nonSnoozed.filter(t => t.escalation_current_rung != null && !crisisIds.has(t.id))
      for (const task of escalationTasks) {
        escalationActiveIds.add(task.id)
        const override = escalationNudgeOverride(task)
        if (!override) continue
        const freq = (override.cadenceDays || 1) * 24 * 60 * 60 * 1000
        if (!checkThrottle(`push_escalation:${task.id}`, freq)) continue
        const title = task.escalation_stuck ? 'Out of moves — brainstorm?'
          : task.escalation_awaiting_advance ? 'Ready to switch tactics?'
          : `Follow up: ${task.title}`
        const sent = await sendPush({ title, body: override.text, tag: `escalation:${task.id}`, data: { taskId: task.id } })
        if (sent) {
          markThrottle(`push_escalation:${task.id}`)
          logNotifPush(genId(), 'escalation', task.id, title, override.text)
        }
      }
    }

    // Per-task "remind me" (nag_allowed) — the explicit opt-in toggle on a
    // task ("Remind me about this without a due date" / project nag policy).
    // ONE gentle line per opted-in task per day, forward-framed, priority
    // normal. This replaces the deleted stale/nudge pools for exactly the
    // tasks the user asked to be reminded about — nothing ambient.
    for (const task of nonSnoozed) {
      if (!task.nag_allowed || crisisIds.has(task.id) || escalationActiveIds.has(task.id)) continue
      if (!checkThrottle(`push_remind:${task.id}`, 24 * 60 * 60 * 1000)) continue
      const body = `"${task.title}" is on your list — when you're ready.`
      const sent = await sendPush({ title: 'A gentle reminder', body, tag: `remind:${task.id}`, data: { taskId: task.id } })
      if (sent) {
        markThrottle(`push_remind:${task.id}`)
        logNotifPush(genId(), 'remind', task.id, 'A gentle reminder', body)
      }
    }
  } catch (err) {
    console.error('[Push] Notification check failed:', err.message)
  }
}

// --- Package push (called from server.js) ---

// Quokka plan-ready push. Fired by the adviser background runner when
// a plan transitions to awaiting_confirm with no live subscribers
// (i.e. the user backgrounded the app). Tapping the notification
// deep-links via `data.url` (read by the service worker) to /?adviser=…
// so the user lands directly in the Quokka modal with their plan visible.
export async function sendQuokkaPlanReadyPush({ title, body, url } = {}) {
  if (!isConfigured()) return false
  const settings = getData('settings') || {}
  if (!settings.push_notifications_enabled) return false
  // New per-type toggle, default ON. Master toggle still gates.
  if (settings.push_notif_quokka_plan_ready === false) return false
  const sent = await sendPush({
    title: title || 'Quokka has a plan ready',
    body: body || 'Open the adviser to review.',
    tag: 'quokka:plan',
    // url goes inside `data` so the service worker's notification
    // handler can read it (notification.data) and openWindow(data.url).
    // Also flag `no_actions` so the snooze/done action buttons (which
    // are taskId-gated) don't appear on this notification.
    data: { url: url || null, no_actions: true },
  })
  if (sent) logNotifPush(genId(), 'quokka_plan_ready', null, title, body)
  return sent
}

// Security alert (auth Phase A/B: refresh-reuse, attest failures) — the one
// category the digest reshape explicitly allows to be loud. Ignores the
// per-type toggle matrix on purpose: a possible credential theft must not be
// silenceable by a mis-set toggle. Channel master still gates (an unconfigured
// channel can't send anyway).
export async function sendSecurityAlertPush({ title, body }) {
  if (!isConfigured()) return false
  const settings = getData('settings') || {}
  if (!settings.push_notifications_enabled) return false
  const sent = await sendPush({ title, body, tag: 'security', data: { no_actions: true } })
  if (sent) logNotifPush(genId(), 'security', null, title, body)
  return sent
}

export async function sendPackagePush(pkg, eventType) {
  if (!isConfigured()) return
  const settings = getData('settings') || {}
  if (!settings.push_notifications_enabled) return

  if (eventType === 'delivered' && settings.push_notif_package_delivered === false) return
  if (eventType === 'exception' && settings.push_notif_package_exception === false) return
  if (eventType === 'signature_required' && settings.push_notif_package_signature === false) return

  const key = `push_pkg:${pkg.id}:${eventType}`
  if (!checkThrottle(key, 30 * 60 * 1000)) return

  const labels = {
    delivered: 'Package Delivered',
    exception: 'Package Exception',
    out_for_delivery: 'Out for Delivery',
    signature_required: 'Signature Required',
  }

  const title = labels[eventType] || 'Package Update'
  const label = pkg.label || pkg.tracking_number
  const body = `${title}: ${label}`

  const sent = await sendPush({ title, body, tag: `pkg:${pkg.id}` })
  if (sent) {
    markThrottle(key)
    logNotifPush(genId(), `package_${eventType}`, null, title, body)
  }
}

// --- Test push ---

// Send a pre-built digest via push. Collapse key 'daily-digest' (web push
// notification tag + APNs thread) means a re-send REPLACES the existing
// banner — the pipeline can safely re-trigger without stacking.
export async function sendDigestPush(digest) {
  if (!isConfigured() || !digest?.hasContent) return false
  const sent = await sendPush({
    title: digest.pushTitle || digest.subject,
    body: digest.pushBody || digest.textBody.slice(0, 150),
    tag: 'daily-digest',
    data: { url: '/', no_actions: true },
  })
  if (sent) {
    logNotifPush(genId(), 'digest', null, digest.pushTitle || digest.subject, digest.pushBody || '')
  }
  return sent
}

export async function sendTestPush() {
  if (!isConfigured()) return { success: false, error: 'VAPID keys not configured' }
  const subscriptions = getAllPushSubscriptions()
  // A native-only setup (APNs devices, zero web subscriptions) is valid —
  // the test rides the same dual-leg sendPush as real notifications.
  const nativeReady = isApnsConfigured()
  if (subscriptions.length === 0 && !nativeReady) {
    return { success: false, error: 'No push subscriptions registered. Enable push notifications in your browser first.' }
  }

  console.log(`[Push] Sending test to ${subscriptions.length} web subscription(s)${nativeReady ? ' + native devices' : ''}`)
  const sent = await sendPush({
    title: 'Boomerang Test',
    body: 'Push notifications are working!',
    tag: 'test',
  })
  console.log(`[Push] Test result: ${sent ? 'delivered' : 'failed'}`)

  return sent ? { success: true } : { success: false, error: 'Could not deliver push notification' }
}

// --- Status ---

export function getPushStatus() {
  const subscriptions = getAllPushSubscriptions()
  return {
    configured: isConfigured(),
    vapid_public_key: vapidPublicKey || null,
    subscription_count: subscriptions.length,
  }
}

// --- Lifecycle ---

export function startPushNotifications() {
  if (loopTimer) return
  ensureVapidKeys()
  if (!isConfigured()) {
    console.log('Push notifications: not configured (VAPID key generation failed)')
    return
  }
  setupVapid()
  loopTimer = setInterval(runPushCheck, 60 * 1000)
  setTimeout(runPushCheck, 20000) // First check after 20s
  console.log(`Push notifications: configured (${getAllPushSubscriptions().length} web subscription(s)${hasApnsTargets() ? ', native APNs active' : ''})`)
}
