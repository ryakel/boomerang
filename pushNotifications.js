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
import { queryTasks, getAllRoutines, getData, setData, getAllPushSubscriptions, deletePushSubscription, getNotifThrottle, setNotifThrottle, logNotifPush, countPendingSuggestions } from './db.js'
import { getWeatherCache, buildWeatherSummary } from './weatherSync.js'
import { rewriteNotifBody, canRewriteThisTick } from './notifAi.js'
import { isInQuietHours, getUserTimeParts } from './userTime.js'

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

const AVOIDANCE_ENERGY_TYPES = ['errand']
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

async function sendPush(payload) {
  const subscriptions = getAllPushSubscriptions()
  if (subscriptions.length === 0) return false

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
  return sent
}

// --- Notification helpers (same as emailNotifications.js) ---

function getFreqMs(settings, key, fallbackHours) {
  const val = settings[key]
  const hours = val != null ? val : fallbackHours
  return hours * 60 * 60 * 1000
}

// isInQuietHours / getUserTimeParts now imported from userTime.js

function isOverdue(task) {
  if (!task.due_date) return false
  const [y, m, d] = task.due_date.split('-').map(Number)
  const due = new Date(y, m - 1, d, 23, 59, 59, 999)
  return Date.now() > due.getTime()
}

function isStale(task, staleDays) {
  if (task.snoozed_until && new Date(task.snoozed_until) > new Date()) return false
  const elapsed = Date.now() - new Date(task.last_touched).getTime()
  return elapsed > (task.staleness_days || staleDays || 2) * 86400000
}

function applyAvoidanceBoost(freqMs, task) {
  if (!task.energy || !AVOIDANCE_ENERGY_TYPES.includes(task.energy)) return freqMs
  let boost = 1.3
  if (task.energy_level === 3) boost *= 1.2
  return Math.round(freqMs / boost)
}

function getHighPriorityFreqMs(task, settings) {
  const now = new Date()
  if (!task.due_date) return getFreqMs(settings, 'notif_freq_highpri_before', 24)
  const due = new Date(task.due_date + 'T00:00:00')
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays = Math.round((dueDay - today) / 86400000)
  if (diffDays > 0) return getFreqMs(settings, 'notif_freq_highpri_before', 24)
  if (diffDays === 0) return getFreqMs(settings, 'notif_freq_highpri_due', 1)
  return getFreqMs(settings, 'notif_freq_highpri_overdue', 0.5)
}

function isInHighPriNotifWindow(task) {
  const hour = new Date().getHours()
  if (!task.due_date) return hour >= 8 && hour < 22
  const now = new Date()
  const due = new Date(task.due_date + 'T00:00:00')
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays = Math.round((dueDay - today) / 86400000)
  if (diffDays >= 0) return hour >= 8 && hour < 22
  return hour >= 6 && hour < 22
}

function checkThrottle(key, freqMs) {
  const last = getNotifThrottle(key)
  if (!last) return true
  return Date.now() - new Date(last).getTime() >= freqMs
}

function markThrottle(key) {
  setNotifThrottle(key, new Date().toISOString())
}

// Habit-mode helpers. Mirror computeHabitStats in src/store.js but server-side
// and inlined to avoid cross-importing a frontend module. Both must agree on
// period bounds and behind-pace semantics or the user gets nudge / progress
// drift between the card and the push.
function habitPeriodBounds(period, weekStartsOn = 1, now = new Date()) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (period === 'week') {
    const dow = start.getDay()
    const diff = (dow - weekStartsOn + 7) % 7
    start.setDate(start.getDate() - diff)
    const end = new Date(start); end.setDate(end.getDate() + 7)
    return { start, end, lengthDays: 7 }
  }
  start.setDate(1)
  const end = new Date(start); end.setMonth(end.getMonth() + 1)
  const lengthDays = Math.round((end.getTime() - start.getTime()) / 86400000)
  return { start, end, lengthDays }
}

function countHabitCompletions(routineId, tasks, start, end) {
  return tasks.filter(t => {
    if (t.routine_id !== routineId) return false
    if (!t.completed_at) return false
    const c = new Date(t.completed_at).getTime()
    return c >= start.getTime() && c < end.getTime()
  }).length
}

function isHabitBehindPace(routine, tasks, weekStartsOn) {
  const { start, lengthDays } = habitPeriodBounds(routine.target_period, weekStartsOn)
  const completions = countHabitCompletions(routine.id, tasks, start, new Date())
  const elapsedRatio = Math.min(1, (Date.now() - start.getTime()) / (lengthDays * 86400000))
  const expected = elapsedRatio * routine.target_count
  return {
    completions,
    target: routine.target_count,
    elapsedRatio,
    behind: completions < expected && elapsedRatio >= 0.3 && completions < routine.target_count,
  }
}

function periodLabel(period) {
  return period === 'week' ? 'this week' : 'this month'
}

function genId() {
  return crypto.randomUUID()
}

// --- Morning digest check ---

async function checkPushDigest() {
  if (!isConfigured()) return
  const settings = getData('settings') || {}
  if (!settings.push_notifications_enabled) return
  if (!settings.push_digest_enabled) return

  const digestTime = settings.digest_time || '07:00'
  const [hh, mm] = digestTime.split(':').map(Number)
  const userNow = getUserTimeParts(settings)
  if (userNow.hours !== hh || userNow.minutes !== mm) return

  if (!checkThrottle('push_digest', 23 * 60 * 60 * 1000)) return

  const subscriptions = getAllPushSubscriptions()
  if (subscriptions.length === 0) return

  const { buildDigest } = await import('./digestBuilder.js')
  const digest = buildDigest(settings)
  if (!digest.hasContent) return

  const sent = await sendPush({
    title: digest.subject,
    body: digest.textBody.slice(0, 500),
    tag: 'digest',
  })
  if (sent) {
    markThrottle('push_digest')
    logNotifPush(genId(), 'digest', null, digest.subject, digest.textBody.slice(0, 500))
  }
}

// --- Main notification check loop ---

async function runPushCheck() {
  // Check digest before main notification loop
  try { await checkPushDigest() } catch (err) { console.error('[Push] Digest check failed:', err.message) }

  try {
    if (!isConfigured()) return

    const settings = getData('settings') || {}
    if (!settings.push_notifications_enabled) return
    if (isInQuietHours(settings)) return

    const subscriptions = getAllPushSubscriptions()
    if (subscriptions.length === 0) return

    const allTasks = queryTasks({})
    const activeTasks = allTasks.filter(t => ACTIVE_STATUSES.includes(t.status) && !t.gmail_pending)
    if (activeTasks.length === 0) return

    const nonSnoozed = activeTasks.filter(t => !t.snoozed_until || new Date(t.snoozed_until) <= new Date())

    // High-priority notifications
    if (settings.push_notif_highpri !== false) {
      const highPriTasks = nonSnoozed.filter(t => t.high_priority)
      let hpCount = 0
      for (const task of highPriTasks) {
        if (hpCount >= 3) break
        if (!isInHighPriNotifWindow(task)) continue

        const freq = applyAvoidanceBoost(getHighPriorityFreqMs(task, settings), task)
        if (!checkThrottle(`push_hp:${task.id}`, freq)) continue

        const dueDate = task.due_date ? new Date(task.due_date + 'T00:00:00') : null
        const today = new Date(); today.setHours(0, 0, 0, 0)
        let body
        if (dueDate) {
          const diffDays = Math.round((dueDate - today) / 86400000)
          if (diffDays < 0) body = `"${task.title}" is ${Math.abs(diffDays)} day${Math.abs(diffDays) > 1 ? 's' : ''} overdue`
          else if (diffDays === 0) body = `"${task.title}" is due today`
          else if (diffDays === 1) body = `"${task.title}" is due tomorrow`
          else body = `"${task.title}" is due in ${diffDays} days`
        } else {
          body = `"${task.title}" is marked high priority`
        }

        // Tone-aware rewrite — at most one per tick
        if (canRewriteThisTick('push')) {
          body = await rewriteNotifBody(task, body)
        }

        const sent = await sendPush({ title: 'HIGH PRIORITY', body, tag: `hp:${task.id}`, data: { taskId: task.id } })
        if (sent) {
          markThrottle(`push_hp:${task.id}`)
          logNotifPush(genId(), 'high_priority', task.id, 'HIGH PRIORITY', body)
          hpCount++
        }
      }
    }

    // Overdue tasks
    if (settings.push_notif_overdue !== false) {
      const freq = getFreqMs(settings, 'notif_freq_overdue', 0.5)
      if (checkThrottle('push_overdue', freq)) {
        const overdueTasks = nonSnoozed.filter(isOverdue)
        if (overdueTasks.length > 0) {
          const body = `You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}: ${overdueTasks.slice(0, 3).map(t => t.title).join(', ')}`
          const sent = await sendPush({ title: 'Overdue Tasks', body, tag: 'overdue' })
          if (sent) {
            markThrottle('push_overdue')
            logNotifPush(genId(), 'overdue', null, 'Overdue Tasks', body)
          }
        }
      }
    }

    // Stale tasks
    if (settings.push_notif_stale !== false) {
      const freq = getFreqMs(settings, 'notif_freq_stale', 0.5)
      if (checkThrottle('push_stale', freq)) {
        const staleTasks = nonSnoozed.filter(t => isStale(t, settings.staleness_days))
        if (staleTasks.length > 0) {
          const body = `${staleTasks.length} task${staleTasks.length > 1 ? 's' : ''} haven't been touched in a while`
          const sent = await sendPush({ title: 'Stale Tasks', body, tag: 'stale' })
          if (sent) {
            markThrottle('push_stale')
            logNotifPush(genId(), 'stale', null, 'Stale Tasks', body)
          }
        }
      }
    }

    // General nudge
    if (settings.push_notif_nudge !== false) {
      const freq = getFreqMs(settings, 'notif_freq_nudge', 1)
      if (checkThrottle('push_nudge', freq) && nonSnoozed.length > 0) {
        const smallTasks = nonSnoozed.filter(t => t.size === 'XS' || t.size === 'S')
        let title, body
        if (smallTasks.length > 0) {
          const pick = smallTasks[Math.floor(Math.random() * smallTasks.length)]
          title = 'Quick win available'
          body = `Got 5 min? Try: "${pick.title}" (${pick.size})`
        } else {
          title = 'Boomerang'
          body = `You have ${nonSnoozed.length} open tasks. Pick the easiest one and knock it out.`
        }
        const sent = await sendPush({ title, body, tag: 'nudge' })
        if (sent) {
          markThrottle('push_nudge')
          logNotifPush(genId(), 'nudge', null, title, body)
        }
      }
    }

    // Habit-mode behind-pace nudge. One push per habit per 24h max, only when
    // we're past the 30% mark of the period AND the user is below the linear
    // pace. Push priority-0 only (per spec — habits are encouragement, not
    // alarms). Inline actions Log it / Not today let the user resolve without
    // opening the app.
    if (settings.push_notif_habit_nudge !== false) {
      const weekStartsOn = settings.week_starts_on ?? 1
      const habitRoutines = getAllRoutines().filter(
        r => !r.paused && r.spawn_mode === 'habit' && r.target_count && r.target_period
      )
      for (const routine of habitRoutines) {
        const throttleKey = `push_habit:${routine.id}`
        if (!checkThrottle(throttleKey, 24 * 60 * 60 * 1000)) continue
        const { completions, target, behind } = isHabitBehindPace(routine, allTasks, weekStartsOn)
        if (!behind) continue
        const title = routine.title
        const body = `${completions}/${target} ${periodLabel(routine.target_period)} — want to log one today?`
        const sent = await sendPush({
          title,
          body,
          tag: `habit:${routine.id}`,
          data: { routineId: routine.id, habitAction: true },
        })
        if (sent) {
          markThrottle(throttleKey)
          logNotifPush(genId(), 'habit_nudge', null, title, body)
        }
      }
    }

    // Size-based reminders
    if (settings.push_notif_size !== false) {
      const freq = getFreqMs(settings, 'notif_freq_size', 1)
      if (checkThrottle('push_size', freq)) {
        const sizeLeadDays = { XL: 3, L: 2, M: 1 }
        const upcoming = nonSnoozed.filter(t => {
          if (!t.size || !t.due_date || !sizeLeadDays[t.size]) return false
          const dueDate = new Date(t.due_date)
          const daysUntil = Math.ceil((dueDate.getTime() - Date.now()) / 86400000)
          return daysUntil > 0 && daysUntil <= sizeLeadDays[t.size]
        })
        if (upcoming.length > 0) {
          const t = upcoming[0]
          const daysLeft = Math.ceil((new Date(t.due_date).getTime() - Date.now()) / 86400000)
          const title = `${t.size} task due soon`
          const body = `"${t.title}" is due in ${daysLeft} day${daysLeft > 1 ? 's' : ''} — it's a ${t.size}, start planning`
          const sent = await sendPush({ title, body, tag: `size:${t.id}`, data: { taskId: t.id } })
          if (sent) {
            markThrottle('push_size')
            logNotifPush(genId(), 'size', t.id, title, body)
          }
        }
      }
    }

    // Pile-up warning
    if (settings.push_notif_pileup !== false) {
      const freq = getFreqMs(settings, 'notif_freq_pileup', 2)
      if (checkThrottle('push_pileup', freq)) {
        let sent = false
        if (settings.max_open_tasks && nonSnoozed.length > settings.max_open_tasks) {
          const title = 'Too many open tasks'
          const body = `You have ${nonSnoozed.length} open tasks (limit: ${settings.max_open_tasks}). Can you knock one out?`
          sent = await sendPush({ title, body, tag: 'pileup' })
          if (sent) logNotifPush(genId(), 'pileup', null, title, body)
        }
        if (!sent && settings.stale_warn_pct > 0) {
          const oldTasks = nonSnoozed.filter(t => {
            const age = (Date.now() - new Date(t.created_at).getTime()) / 86400000
            return age > (settings.stale_warn_days || 7)
          })
          const pct = nonSnoozed.length > 0 ? Math.round(oldTasks.length / nonSnoozed.length * 100) : 0
          if (pct >= settings.stale_warn_pct) {
            const title = 'Tasks piling up'
            const body = `${pct}% of your tasks have been open for ${settings.stale_warn_days || 7}+ days`
            sent = await sendPush({ title, body, tag: 'pileup' })
            if (sent) logNotifPush(genId(), 'pileup', null, title, body)
          }
        }
        if (sent) markThrottle('push_pileup')
      }
    }

    // Routine suggestions (Activity Prompts PR 3). One ping per week max
    // when pending suggestions are waiting in the inbox. The actual scan
    // runs Sunday 3am local; this notification rides alongside on the
    // next dispatcher tick so the user sees the result of the scan.
    if (settings.push_notif_routine_suggestion !== false) {
      const freq = 7 * 24 * 60 * 60 * 1000 // weekly
      if (checkThrottle('push_routine_suggestion', freq)) {
        const pending = countPendingSuggestions()
        if (pending > 0) {
          const title = pending === 1 ? '1 routine suggestion waiting' : `${pending} routine suggestions waiting`
          const body = 'Boomerang noticed patterns in your completed history. Tap to review.'
          const sent = await sendPush({
            title,
            body,
            tag: 'routine_suggestion',
            data: { suggestionsView: true },
          })
          if (sent) {
            markThrottle('push_routine_suggestion')
            logNotifPush(genId(), 'routine_suggestion', null, title, body)
          }
        }
      }
    }
  } catch (err) {
    console.error('[Push] Notification check failed:', err.message)
  }
}

// --- Package push (called from server.js) ---

export async function sendPackagePush(pkg, eventType) {
  if (!isConfigured()) return
  const settings = getData('settings') || {}
  if (!settings.push_notifications_enabled) return

  if (eventType === 'delivered' && settings.push_notif_package_delivered === false) return
  if (eventType === 'exception' && settings.push_notif_package_exception === false) return

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

// Send a pre-built digest via web push (used by manual test endpoint).
export async function sendDigestPush(digest) {
  if (!isConfigured() || !digest?.hasContent) return false
  const sent = await sendPush({
    title: digest.subject,
    body: digest.textBody.slice(0, 500),
    tag: 'digest',
  })
  if (sent) {
    logNotifPush(genId(), 'digest', null, digest.subject, digest.textBody.slice(0, 500))
  }
  return sent
}

export async function sendTestPush() {
  if (!isConfigured()) return { success: false, error: 'VAPID keys not configured' }
  const subscriptions = getAllPushSubscriptions()
  if (subscriptions.length === 0) return { success: false, error: 'No push subscriptions registered. Enable push notifications in your browser first.' }

  console.log(`[Push] Sending test to ${subscriptions.length} subscription(s)`)
  const sent = await sendPush({
    title: 'Boomerang Test',
    body: 'Push notifications are working!',
    tag: 'test',
  })
  console.log(`[Push] Test result: ${sent ? 'delivered' : 'failed'}`)

  return sent ? { success: true } : { success: false, error: 'Failed to deliver push notification' }
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
  console.log(`Push notifications: configured (${getAllPushSubscriptions().length} subscription(s))`)
}
