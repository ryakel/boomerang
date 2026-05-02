/**
 * Server-side Pushover notification engine.
 *
 * Mirrors pushNotifications.js but sends via the Pushover HTTP API. Solves
 * iOS web-push delivery unreliability — Pushover has a dedicated iOS app
 * with full APNs entitlements, so messages reliably reach the device, and
 * priority-2 (Emergency) bypasses Do Not Disturb and silent mode.
 *
 * Priority mapping:
 *   0 — nudge / stale / size / pileup / high-priority Stage 1 (before due)
 *   1 — generic overdue / high-priority Stage 2 (on due day)
 *   2 — high-priority Stage 3 (overdue) / overdue + avoidance + high-priority
 *
 * Quiet hours: priority 0 honors quiet hours; priority 1 and 2 bypass it.
 */

import crypto from 'crypto'
import {
  queryTasks, getData, getNotifThrottle, setNotifThrottle,
  logNotifPush, getTask, updateTaskPartial,
} from './db.js'

const PUSHOVER_API = 'https://api.pushover.net/1/messages.json'
const PUSHOVER_RECEIPT_API = 'https://api.pushover.net/1/receipts'

const AVOIDANCE_ENERGY_TYPES = ['errand']
const ACTIVE_STATUSES = ['not_started', 'doing', 'waiting']

let loopTimer = null

// --- Configuration ---

function getCredentials(settings) {
  const userKey = settings.pushover_user_key
  const appToken = settings.pushover_app_token || process.env.PUSHOVER_DEFAULT_APP_TOKEN
  return { userKey: userKey || null, appToken: appToken || null }
}

// Build a deep link URL for a notification. Used to make every Pushover
// message tappable — opens the task in the app. Returns null if the public
// URL isn't configured (notification still sends, just without a URL field).
function buildDeepLink(settings, taskId) {
  const base = (settings.public_app_url || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '')
  if (!base) return null
  return taskId ? `${base}/?task=${encodeURIComponent(taskId)}` : base
}

function isConfigured(settings) {
  const { userKey, appToken } = getCredentials(settings || getData('settings') || {})
  return !!(userKey && appToken)
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

export async function sendTestNotification() {
  const settings = getData('settings') || {}
  const { userKey, appToken } = getCredentials(settings)
  if (!userKey) return { success: false, error: 'Pushover User Key not configured' }
  if (!appToken) return { success: false, error: 'Pushover App Token not configured' }
  const result = await sendPushover({
    userKey, appToken,
    title: 'Boomerang test',
    message: 'Pushover is wired up correctly.',
    priority: 0,
  })
  if (!result.ok) return { success: false, error: result.errors?.[0] || result.error || 'Send failed' }
  return { success: true, request: result.request }
}

export async function sendTestEmergency() {
  const settings = getData('settings') || {}
  const { userKey, appToken } = getCredentials(settings)
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

function isInQuietHours(settings) {
  if (!settings.quiet_hours_enabled) return false
  const now = new Date()
  const currentMins = now.getHours() * 60 + now.getMinutes()
  const [startH, startM] = (settings.quiet_hours_start || '22:00').split(':').map(Number)
  const [endH, endM] = (settings.quiet_hours_end || '08:00').split(':').map(Number)
  const startMins = startH * 60 + startM
  const endMins = endH * 60 + endM
  if (startMins <= endMins) return currentMins >= startMins && currentMins < endMins
  return currentMins >= startMins || currentMins < endMins
}

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

function isAvoidance(task) {
  return !!(task.energy && AVOIDANCE_ENERGY_TYPES.includes(task.energy))
}

function applyAvoidanceBoost(freqMs, task) {
  if (!isAvoidance(task)) return freqMs
  let boost = 1.3
  if (task.energy_level === 3) boost *= 1.2
  return Math.round(freqMs / boost)
}

function getHighPriorityStage(task) {
  if (!task.due_date) return 1
  const now = new Date()
  const due = new Date(task.due_date + 'T00:00:00')
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays = Math.round((dueDay - today) / 86400000)
  if (diffDays > 0) return 1
  if (diffDays === 0) return 2
  return 3
}

function getHighPriorityFreqMs(task, settings) {
  const stage = getHighPriorityStage(task)
  if (stage === 1) return getFreqMs(settings, 'notif_freq_highpri_before', 24)
  if (stage === 2) return getFreqMs(settings, 'notif_freq_highpri_due', 1)
  return getFreqMs(settings, 'notif_freq_highpri_overdue', 0.5)
}

function isInHighPriNotifWindow(task) {
  const hour = new Date().getHours()
  if (!task.due_date) return hour >= 8 && hour < 22
  const stage = getHighPriorityStage(task)
  if (stage <= 2) return hour >= 8 && hour < 22
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

function genId() {
  return crypto.randomUUID()
}

function priorityToSound(priority) {
  if (priority === 2) return 'persistent'
  if (priority === 1) return 'pushover'
  return undefined
}

function buildHighPriBody(task) {
  if (!task.due_date) return `"${task.title}" is marked high priority`
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(task.due_date + 'T00:00:00')
  const diffDays = Math.round((due - today) / 86400000)
  if (diffDays < 0) return `"${task.title}" — due ${Math.abs(diffDays)} day${Math.abs(diffDays) > 1 ? 's' : ''} ago`
  if (diffDays === 0) return `"${task.title}" is due today`
  if (diffDays === 1) return `"${task.title}" is due tomorrow`
  return `"${task.title}" is due in ${diffDays} days`
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
    const activeTasks = allTasks.filter(t => ACTIVE_STATUSES.includes(t.status) && !t.gmail_pending)
    if (activeTasks.length === 0) return

    const nonSnoozed = activeTasks.filter(t => !t.snoozed_until || new Date(t.snoozed_until) <= new Date())
    const inQuiet = isInQuietHours(settings)

    // High-priority notifications (per-task)
    if (settings.pushover_notif_highpri !== false) {
      const highPriTasks = nonSnoozed.filter(t => t.high_priority)
      let hpCount = 0
      for (const task of highPriTasks) {
        if (hpCount >= 3) break
        if (!isInHighPriNotifWindow(task)) continue

        const stage = getHighPriorityStage(task)
        let priority = stage === 1 ? 0 : stage === 2 ? 1 : 2
        if (stage === 3 && isAvoidance(task)) priority = 2

        // Quiet hours: only priority 0 honors quiet hours
        if (inQuiet && priority === 0) continue

        const freq = applyAvoidanceBoost(getHighPriorityFreqMs(task, settings), task)
        const throttleKey = `pushover_hp:${task.id}`
        if (!checkThrottle(throttleKey, freq)) continue

        const body = buildHighPriBody(task)
        const url = buildDeepLink(settings, task.id)
        const result = await sendPushover({
          userKey, appToken,
          title: truncatedTitle('[BOOMERANG] ', task.title),
          message: body,
          priority,
          sound: priorityToSound(priority),
          url,
          urlTitle: url ? 'Open in Boomerang' : undefined,
        })
        if (result.ok) {
          markThrottle(throttleKey)
          logNotifPush(genId(), 'high_priority', task.id, '[BOOMERANG] ' + task.title, body, 'pushover')
          if (priority === 2 && result.receipt) {
            updateTaskPartial(task.id, { pushover_receipt: result.receipt })
          }
          hpCount++
        }
      }
    }

    // Generic overdue notification — priority 1
    if (settings.pushover_notif_overdue !== false) {
      const priority = 1
      if (!(inQuiet && priority === 0)) {
        const freq = getFreqMs(settings, 'notif_freq_overdue', 0.5)
        if (checkThrottle('pushover_overdue', freq)) {
          const overdueTasks = activeTasks.filter(isOverdue)
          if (overdueTasks.length > 0) {
            const body = `${overdueTasks.length} overdue: ${overdueTasks.slice(0, 3).map(t => t.title).join(', ')}`
            // For multi-task overdue, deep link to the most overdue task.
            const top = overdueTasks[0]
            const url = buildDeepLink(settings, top?.id)
            const result = await sendPushover({
              userKey, appToken,
              title: '[BOOMERANG] Overdue tasks',
              message: body,
              priority,
              sound: priorityToSound(priority),
              url, urlTitle: url ? 'Open in Boomerang' : undefined,
            })
            if (result.ok) {
              markThrottle('pushover_overdue')
              logNotifPush(genId(), 'overdue', top?.id || null, '[BOOMERANG] Overdue tasks', body, 'pushover')
            }
          }
        }
      }
    }

    // Below: priority 0 categories — all suppressed during quiet hours.
    if (inQuiet) return

    // Stale
    if (settings.pushover_notif_stale !== false) {
      const freq = getFreqMs(settings, 'notif_freq_stale', 0.5)
      if (checkThrottle('pushover_stale', freq)) {
        const staleTasks = activeTasks.filter(t => isStale(t, settings.staleness_days))
        if (staleTasks.length > 0) {
          const body = `${staleTasks.length} task${staleTasks.length > 1 ? 's' : ''} haven't been touched in a while`
          const result = await sendPushover({
            userKey, appToken,
            title: '[BOOMERANG] Stale tasks',
            message: body,
            priority: 0,
          })
          if (result.ok) {
            markThrottle('pushover_stale')
            logNotifPush(genId(), 'stale', null, '[BOOMERANG] Stale tasks', body, 'pushover')
          }
        }
      }
    }

    // Nudge
    if (settings.pushover_notif_nudge !== false) {
      const freq = getFreqMs(settings, 'notif_freq_nudge', 1)
      if (checkThrottle('pushover_nudge', freq) && activeTasks.length > 0) {
        const smallTasks = activeTasks.filter(t => t.size === 'XS' || t.size === 'S')
        let title, body
        if (smallTasks.length > 0) {
          const pick = smallTasks[Math.floor(Math.random() * smallTasks.length)]
          title = '[BOOMERANG] Quick win available'
          body = `Got 5 min? Try: "${pick.title}" (${pick.size})`
        } else {
          title = '[BOOMERANG] Pick one'
          body = `${activeTasks.length} open tasks. Pick the easiest one.`
        }
        const result = await sendPushover({ userKey, appToken, title, message: body, priority: 0 })
        if (result.ok) {
          markThrottle('pushover_nudge')
          logNotifPush(genId(), 'nudge', null, title, body, 'pushover')
        }
      }
    }

    // Size-based
    if (settings.pushover_notif_size !== false) {
      const freq = getFreqMs(settings, 'notif_freq_size', 1)
      if (checkThrottle('pushover_size', freq)) {
        const sizeLeadDays = { XL: 3, L: 2, M: 1 }
        const upcoming = activeTasks.filter(t => {
          if (!t.size || !t.due_date || !sizeLeadDays[t.size]) return false
          const dueDate = new Date(t.due_date)
          const daysUntil = Math.ceil((dueDate.getTime() - Date.now()) / 86400000)
          return daysUntil > 0 && daysUntil <= sizeLeadDays[t.size]
        })
        if (upcoming.length > 0) {
          const t = upcoming[0]
          const daysLeft = Math.ceil((new Date(t.due_date).getTime() - Date.now()) / 86400000)
          const title = truncatedTitle('[BOOMERANG] ', `${t.size} task due soon`)
          const body = `"${t.title}" due in ${daysLeft} day${daysLeft > 1 ? 's' : ''} — it's ${t.size}, start planning`
          const url = buildDeepLink(settings, t.id)
          const result = await sendPushover({
            userKey, appToken, title, message: body, priority: 0,
            url, urlTitle: url ? 'Open in Boomerang' : undefined,
          })
          if (result.ok) {
            markThrottle('pushover_size')
            logNotifPush(genId(), 'size', t.id, title, body, 'pushover')
          }
        }
      }
    }

    // Pile-up
    if (settings.pushover_notif_pileup !== false) {
      const freq = getFreqMs(settings, 'notif_freq_pileup', 2)
      if (checkThrottle('pushover_pileup', freq)) {
        let sent = false
        if (settings.max_open_tasks && nonSnoozed.length > settings.max_open_tasks) {
          const title = '[BOOMERANG] Too many open tasks'
          const body = `${nonSnoozed.length} open (limit: ${settings.max_open_tasks}). Knock one out?`
          const result = await sendPushover({ userKey, appToken, title, message: body, priority: 0 })
          if (result.ok) {
            sent = true
            logNotifPush(genId(), 'pileup', null, title, body, 'pushover')
          }
        }
        if (!sent && settings.stale_warn_pct > 0) {
          const oldTasks = activeTasks.filter(t => {
            const age = (Date.now() - new Date(t.created_at).getTime()) / 86400000
            return age > (settings.stale_warn_days || 7)
          })
          const pct = activeTasks.length > 0 ? Math.round(oldTasks.length / activeTasks.length * 100) : 0
          if (pct >= settings.stale_warn_pct) {
            const title = '[BOOMERANG] Tasks piling up'
            const body = `${pct}% of your tasks have been open ${settings.stale_warn_days || 7}+ days`
            const result = await sendPushover({ userKey, appToken, title, message: body, priority: 0 })
            if (result.ok) {
              sent = true
              logNotifPush(genId(), 'pileup', null, title, body, 'pushover')
            }
          }
        }
        if (sent) markThrottle('pushover_pileup')
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

// --- Daily digest ---

async function checkPushoverDigest() {
  const settings = getData('settings') || {}
  if (!settings.pushover_notifications_enabled) return
  if (!settings.pushover_digest_enabled) return
  const { userKey, appToken } = getCredentials(settings)
  if (!userKey || !appToken) return

  const digestTime = settings.digest_time || '07:00'
  const now = new Date()
  const [hh, mm] = digestTime.split(':').map(Number)
  if (now.getHours() !== hh || now.getMinutes() !== mm) return

  if (!checkThrottle('pushover_digest', 23 * 60 * 60 * 1000)) return

  const { buildDigest } = await import('./digestBuilder.js')
  const digest = buildDigest(settings)
  if (!digest.hasContent) return

  const url = buildDeepLink(settings, null)
  const result = await sendPushover({
    userKey, appToken,
    title: `[BOOMERANG] ${digest.subject}`,
    message: digest.textBody.slice(0, 1024),
    priority: 0,
    url,
    urlTitle: url ? 'Open in Boomerang' : undefined,
  })
  if (result.ok) {
    markThrottle('pushover_digest')
    logNotifPush(genId(), 'digest', null, digest.subject, digest.textBody.slice(0, 500), 'pushover')
  }
}

// Manual digest test — bypasses time-of-day and throttle checks. Dispatches
// via every enabled channel. Used by Settings UI's "Test daily digest" button.
export async function sendDigestNow() {
  const settings = getData('settings') || {}
  const { buildDigest } = await import('./digestBuilder.js')
  const digest = buildDigest(settings)
  if (!digest.hasContent) {
    return { success: false, error: 'Nothing to surface — no overdue/today/carrying/quick-wins tasks and no recent completions.' }
  }

  const fired = []
  const skipped = []

  // Pushover
  if (settings.pushover_digest_enabled) {
    const { userKey, appToken } = getCredentials(settings)
    if (userKey && appToken) {
      const url = buildDeepLink(settings, null)
      const result = await sendPushover({
        userKey, appToken,
        title: `[BOOMERANG] ${digest.subject}`,
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
  if (settings.email_digest_enabled) {
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

  if (settings.push_digest_enabled) {
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

  return { success: fired.length > 0, fired, skipped, subject: digest.subject }
}

// --- Lifecycle ---

export function startPushoverNotifications() {
  if (loopTimer) return
  loopTimer = setInterval(async () => {
    try { await checkPushoverDigest() } catch (err) { console.error('[Pushover] Digest check failed:', err.message) }
    runPushoverCheck()
  }, 60 * 1000)
  setTimeout(runPushoverCheck, 25000)
  console.log('Pushover notifications: lifecycle started (waiting for credentials)')
}

export function stopPushoverNotifications() {
  if (loopTimer) {
    clearInterval(loopTimer)
    loopTimer = null
  }
}
