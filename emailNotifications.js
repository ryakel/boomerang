/**
 * Server-side email notification engine.
 *
 * Mirrors the client-side useNotifications.js logic but runs on the server
 * and sends emails via Nodemailer instead of browser Notification API.
 *
 * Gracefully tolerant: if SMTP is not configured, the engine is a no-op.
 */

import nodemailer from 'nodemailer'
import { readFileSync, existsSync } from 'fs'
import crypto from 'crypto'
import { queryTasks, getData, getNotifThrottle, setNotifThrottle, logNotifEmail } from './db.js'
import { getWeatherCache, buildWeatherSummary } from './weatherSync.js'

// --- Environment ---
let smtpHost = process.env.SMTP_HOST
let smtpPort = process.env.SMTP_PORT
let smtpUser = process.env.SMTP_USER
let smtpPass = process.env.SMTP_PASS
let smtpFrom = process.env.SMTP_FROM
let notificationEmail = process.env.NOTIFICATION_EMAIL

if (existsSync('.env')) {
  const envFile = readFileSync('.env', 'utf-8')
  smtpHost = smtpHost || envFile.match(/SMTP_HOST="?([^"\n]+)"?/)?.[1]
  smtpPort = smtpPort || envFile.match(/SMTP_PORT="?([^"\n]+)"?/)?.[1]
  smtpUser = smtpUser || envFile.match(/SMTP_USER="?([^"\n]+)"?/)?.[1]
  smtpPass = smtpPass || envFile.match(/SMTP_PASS="?([^"\n]+)"?/)?.[1]
  smtpFrom = smtpFrom || envFile.match(/SMTP_FROM="?([^"\n]+)"?/)?.[1]
  notificationEmail = notificationEmail || envFile.match(/NOTIFICATION_EMAIL="?([^"\n]+)"?/)?.[1]
}

// AI nudge generation (server-side)
let anthropicKey = process.env.ANTHROPIC_API_KEY
if (!anthropicKey && existsSync('.env')) {
  const envFile = readFileSync('.env', 'utf-8')
  anthropicKey = anthropicKey || envFile.match(/(?:VITE_)?ANTHROPIC_API_KEY="?([^"\n]+)"?/)?.[1]
}

async function generateAINudge(task) {
  const key = anthropicKey || getData('settings')?.anthropic_api_key
  if (!key) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 100,
        system: 'Generate a short, encouraging one-liner nudge (under 80 chars) for someone with ADHD about this task. Be warm, specific, and motivating. No quotes.',
        messages: [{ role: 'user', content: `Task: "${task.title}"${task.energy ? ` (${task.energy})` : ''}` }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.content?.[0]?.text?.trim() || null
  } catch { return null }
}

// Avoidance-prone energy types (same as client)
const AVOIDANCE_ENERGY_TYPES = ['errand']
const ACTIVE_STATUSES = ['not_started', 'doing', 'waiting']

let transporter = null
let loopTimer = null

// --- Transport setup ---

function getSmtpConfig() {
  // Env var takes priority for recipient; UI setting is fallback
  const settings = getData('settings') || {}
  const host = smtpHost
  const port = parseInt(smtpPort || '587', 10)
  const user = smtpUser
  const pass = smtpPass
  const from = smtpFrom || user
  const to = notificationEmail || settings.email_address
  return { host, port, user, pass, from, to }
}

function isConfigured() {
  const { host, user, pass, to } = getSmtpConfig()
  return !!(host && user && pass && to)
}

function createTransporter() {
  const { host, port, user, pass } = getSmtpConfig()
  if (!host || !user || !pass) return null
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  })
}

function getTransporter() {
  if (!transporter) transporter = createTransporter()
  return transporter
}

// Invalidate transporter when settings change (called from server.js)
export function resetTransporter() {
  transporter = null
}

// --- SMS gateway detection ---

const SMS_GATEWAY_DOMAINS = [
  'tmomail.net', 'vtext.com', 'txt.att.net', 'messaging.sprintpcs.com',
  'pm.sprint.com', 'vmobl.com', 'mmst5.tracfone.com', 'mymetropcs.com',
  'sms.cricketwireless.net', 'msg.fi.google.com', 'message.ting.com',
  'text.republicwireless.com', 'cingularme.com', 'mms.uscc.net',
  'email.uscc.net', 'sms.myboostmobile.com', 'mailmymobile.net',
]

function isSmsGateway(email) {
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase()
  return domain ? SMS_GATEWAY_DOMAINS.includes(domain) : false
}

// --- Email sending ---

async function sendEmail(subject, htmlBody, textBody) {
  const transport = getTransporter()
  if (!transport) return false
  const { from, to } = getSmtpConfig()
  if (!to) return false

  // SMS gateways: text-only, truncated, minimal headers
  const sms = isSmsGateway(to)
  const mailOpts = sms
    ? { from, to, subject, text: textBody.slice(0, 140) }
    : { from: `"Boomerang" <${from}>`, to, subject, text: textBody, html: htmlBody }

  try {
    await transport.sendMail(mailOpts)
    return true
  } catch (err) {
    console.error('[Email] Send failed:', err.message)
    return false
  }
}

// --- Email templates ---

function emailWrapper(title, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1a1a2e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:500px;margin:0 auto;padding:24px">
  <div style="background:#16213e;border-radius:12px;padding:24px;color:#e0e0e0">
    <div style="font-size:18px;font-weight:600;color:#fff;margin-bottom:16px">${title}</div>
    ${bodyHtml}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #2a2a4a;font-size:12px;color:#666">
      Boomerang Task Manager
    </div>
  </div>
</div>
</body>
</html>`
}

function taskEmailHtml(tasks, intro) {
  const items = tasks.map(t => {
    const energyIcon = t.energy === 'desk' ? '&#x1F4BB;' : t.energy === 'people' ? '&#x1F465;' : t.energy === 'errand' ? '&#x1F3C3;' : t.energy === 'creative' ? '&#x1F3A8;' : t.energy === 'physical' ? '&#x1F4AA;' : ''
    const bolts = t.energy_level ? '&#x26A1;'.repeat(t.energy_level) : ''
    const size = t.size ? `<span style="color:#4A9EFF;font-size:12px">[${t.size}]</span>` : ''
    const due = t.due_date ? `<span style="color:#FFB347;font-size:12px">due ${t.due_date}</span>` : ''
    return `<div style="padding:8px 0;border-bottom:1px solid #2a2a4a">
      <div style="font-size:14px;color:#fff">${energyIcon} ${t.title} ${size}</div>
      <div style="font-size:12px;color:#888;margin-top:2px">${bolts} ${due}</div>
    </div>`
  }).join('')
  return emailWrapper('Boomerang', `<div style="font-size:14px;color:#ccc;margin-bottom:12px">${intro}</div>${items}`)
}

function simpleEmailHtml(title, message) {
  return emailWrapper(title, `<div style="font-size:14px;color:#ccc;line-height:1.5">${message}</div>`)
}

// --- Notification logic (mirrors useNotifications.js) ---

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
  return hour >= 6 && hour < 22 // overdue: earlier window
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

// --- Morning digest check ---

async function checkDigest() {
  if (!isConfigured()) return
  const settings = getData('settings') || {}
  if (!settings.email_notifications_enabled) return
  if (!settings.email_digest_enabled) return

  const digestTime = settings.digest_time || '07:00'
  const now = new Date()
  const [hh, mm] = digestTime.split(':').map(Number)
  // Only fire within the digest minute window
  if (now.getHours() !== hh || now.getMinutes() !== mm) return

  // Throttle: once per day
  if (!checkThrottle('email_digest', 23 * 60 * 60 * 1000)) return

  const allTasks = queryTasks({})
  const activeTasks = allTasks.filter(t => ACTIVE_STATUSES.includes(t.status) && !t.gmail_pending)
  if (activeTasks.length === 0) return

  const overdueTasks = activeTasks.filter(isOverdue)
  const staleDays = settings.staleness_days || 2
  const staleTasks = activeTasks.filter(t => isStale(t, staleDays))
  const todayStr = now.toISOString().split('T')[0]
  const dueTodayTasks = activeTasks.filter(t => t.due_date === todayStr)

  const subject = `Morning Digest: ${activeTasks.length} open tasks`
  const lines = [
    `You have <strong>${activeTasks.length}</strong> open tasks.`,
  ]
  if (dueTodayTasks.length > 0) lines.push(`<strong>${dueTodayTasks.length}</strong> due today`)
  if (overdueTasks.length > 0) lines.push(`<strong>${overdueTasks.length}</strong> overdue`)
  if (staleTasks.length > 0) lines.push(`<strong>${staleTasks.length}</strong> stale`)

  // Weather line (if configured)
  let body = lines.join(' · ')
  const weatherCache = getWeatherCache()
  const weatherSummary = buildWeatherSummary(weatherCache)
  if (weatherSummary) {
    body += `<br><br><strong>Weather:</strong> ${weatherSummary}`
  }
  const sent = await sendEmail(subject, simpleEmailHtml('Morning Digest', body), body.replace(/<[^>]+>/g, ''))
  if (sent) {
    markThrottle('email_digest')
    logNotifEmail(genId(), 'digest', null, subject, body)
  }
}

// --- Main notification check loop ---

async function runNotificationCheck() {
  // Check digest before main notification loop
  try { await checkDigest() } catch (err) { console.error('[Email] Digest check failed:', err.message) }

  try {
    if (!isConfigured()) return

    const settings = getData('settings') || {}
    if (!settings.email_notifications_enabled) return
    if (isInQuietHours(settings)) return

    const batchMode = !!settings.email_batch_mode
    const batchItems = [] // collect items when batching

    const allTasks = queryTasks({})
    const activeTasks = allTasks.filter(t => ACTIVE_STATUSES.includes(t.status) && !t.gmail_pending)
    if (activeTasks.length === 0) return

    const nonSnoozed = activeTasks.filter(t => !t.snoozed_until || new Date(t.snoozed_until) <= new Date())

    // High-priority notifications
    if (settings.email_notif_highpri !== false) {
      const highPriTasks = nonSnoozed.filter(t => t.high_priority)
      let hpCount = 0
      for (const task of highPriTasks) {
        if (hpCount >= 3) break
        if (!isInHighPriNotifWindow(task)) continue

        const freq = applyAvoidanceBoost(getHighPriorityFreqMs(task, settings), task)
        if (!checkThrottle(`email_hp:${task.id}`, freq)) continue

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

        const sent = await sendEmail('HIGH PRIORITY', simpleEmailHtml('HIGH PRIORITY', body), body)
        if (sent) {
          markThrottle(`email_hp:${task.id}`)
          logNotifEmail(genId(), 'high_priority', task.id, 'HIGH PRIORITY', body)
          hpCount++
        }
      }
    }

    // Overdue tasks
    if (settings.email_notif_overdue !== false) {
      const freq = getFreqMs(settings, 'notif_freq_overdue', 0.5)
      if (checkThrottle('email_overdue', freq)) {
        const overdueTasks = activeTasks.filter(isOverdue)
        if (overdueTasks.length > 0) {
          const intro = `You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}`
          const text = overdueTasks.map(t => `- ${t.title} (due ${t.due_date})`).join('\n')
          const sent = await sendEmail('Overdue Tasks', taskEmailHtml(overdueTasks.slice(0, 5), intro), `${intro}\n\n${text}`)
          if (sent) {
            markThrottle('email_overdue')
            logNotifEmail(genId(), 'overdue', null, 'Overdue Tasks', intro)
          }
        }
      }
    }

    // Stale tasks
    if (settings.email_notif_stale !== false) {
      const freq = getFreqMs(settings, 'notif_freq_stale', 0.5)
      if (checkThrottle('email_stale', freq)) {
        const staleTasks = activeTasks.filter(t => isStale(t, settings.staleness_days))
        if (staleTasks.length > 0) {
          const intro = `${staleTasks.length} task${staleTasks.length > 1 ? 's' : ''} haven't been touched in a while`
          const text = staleTasks.map(t => `- ${t.title}`).join('\n')
          const sent = await sendEmail('Stale Tasks', taskEmailHtml(staleTasks.slice(0, 5), intro), `${intro}\n\n${text}`)
          if (sent) {
            markThrottle('email_stale')
            logNotifEmail(genId(), 'stale', null, 'Stale Tasks', intro)
          }
        }
      }
    }

    // General nudge (with AI when available)
    if (settings.email_notif_nudge !== false) {
      const freq = getFreqMs(settings, 'notif_freq_nudge', 1)
      if (checkThrottle('email_nudge', freq) && activeTasks.length > 0) {
        const smallTasks = activeTasks.filter(t => t.size === 'XS' || t.size === 'S')
        const pick = smallTasks.length > 0
          ? smallTasks[Math.floor(Math.random() * smallTasks.length)]
          : activeTasks[Math.floor(Math.random() * activeTasks.length)]

        let subject, body
        // Try AI nudge first
        const aiNudge = await generateAINudge(pick)
        if (aiNudge) {
          subject = 'Boomerang'
          body = aiNudge
        } else if (smallTasks.length > 0) {
          subject = 'Quick win available'
          body = `Got 5 min? Try: "${pick.title}" (${pick.size})`
        } else {
          subject = 'Boomerang'
          body = `You have ${activeTasks.length} open tasks. Pick the easiest one and knock it out.`
        }
        const sent = await sendEmail(subject, simpleEmailHtml(subject, body), body)
        if (sent) {
          markThrottle('email_nudge')
          logNotifEmail(genId(), 'nudge', null, subject, body)
        }
      }
    }

    // Size-based reminders
    if (settings.email_notif_size !== false) {
      const freq = getFreqMs(settings, 'notif_freq_size', 1)
      if (checkThrottle('email_size', freq)) {
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
          const subject = `${t.size} task due soon`
          const body = `"${t.title}" is due in ${daysLeft} day${daysLeft > 1 ? 's' : ''} — it's a ${t.size}, start planning`
          const sent = await sendEmail(subject, simpleEmailHtml(subject, body), body)
          if (sent) {
            markThrottle('email_size')
            logNotifEmail(genId(), 'size', t.id, subject, body)
          }
        }
      }
    }

    // Pile-up warning
    if (settings.email_notif_pileup !== false) {
      const freq = getFreqMs(settings, 'notif_freq_pileup', 2)
      if (checkThrottle('email_pileup', freq)) {
        let sent = false
        if (settings.max_open_tasks && nonSnoozed.length > settings.max_open_tasks) {
          const subject = 'Too many open tasks'
          const body = `You have ${nonSnoozed.length} open tasks (limit: ${settings.max_open_tasks}). Can you knock one out?`
          sent = await sendEmail(subject, simpleEmailHtml(subject, body), body)
          if (sent) logNotifEmail(genId(), 'pileup', null, subject, body)
        }
        if (!sent && settings.stale_warn_pct > 0) {
          const oldTasks = activeTasks.filter(t => {
            const age = (Date.now() - new Date(t.created_at).getTime()) / 86400000
            return age > (settings.stale_warn_days || 7)
          })
          const pct = activeTasks.length > 0 ? Math.round(oldTasks.length / activeTasks.length * 100) : 0
          if (pct >= settings.stale_warn_pct) {
            const subject = 'Tasks piling up'
            const body = `${pct}% of your tasks have been open for ${settings.stale_warn_days || 7}+ days`
            sent = await sendEmail(subject, simpleEmailHtml(subject, body), body)
            if (sent) logNotifEmail(genId(), 'pileup', null, subject, body)
          }
        }
        if (sent) markThrottle('email_pileup')
      }
    }
    // Batch mode: send all collected items as one email
    if (batchMode && batchItems.length > 0) {
      const subject = `Boomerang: ${batchItems.length} notification${batchItems.length > 1 ? 's' : ''}`
      const htmlParts = batchItems.map(item => `<div style="margin-bottom:12px"><strong>${item.subject}</strong><br>${item.body}</div>`)
      const htmlBody = simpleEmailHtml(subject, htmlParts.join('<hr style="border:none;border-top:1px solid #333;margin:12px 0">'))
      const textBody = batchItems.map(item => `${item.subject}: ${item.body}`).join('\n\n')
      const sent = await sendEmail(subject, htmlBody, textBody)
      if (sent) {
        for (const item of batchItems) {
          markThrottle(item.throttleKey)
          logNotifEmail(genId(), item.type, item.taskId || null, item.subject, item.body)
        }
      }
    }
  } catch (err) {
    console.error('[Email] Notification check failed:', err.message)
  }
}

// --- Package notification (called from server.js when package status changes) ---

export async function sendPackageEmail(pkg, eventType) {
  if (!isConfigured()) return
  const settings = getData('settings') || {}
  if (!settings.email_notifications_enabled) return

  // Check per-type setting
  if (eventType === 'delivered' && settings.email_notif_package_delivered === false) return
  if (eventType === 'exception' && settings.email_notif_package_exception === false) return

  // Throttle: 30 min per package per event type
  const key = `email_pkg:${pkg.id}:${eventType}`
  if (!checkThrottle(key, 30 * 60 * 1000)) return

  const labels = {
    delivered: 'Package Delivered',
    exception: 'Package Exception',
    out_for_delivery: 'Out for Delivery',
    signature_required: 'Signature Required',
  }

  const subject = labels[eventType] || 'Package Update'
  const label = pkg.label || pkg.tracking_number
  const body = `${subject}: ${label}`

  const sent = await sendEmail(subject, simpleEmailHtml(subject, `<strong>${label}</strong><br><br>${pkg.status_detail || eventType}`), body)
  if (sent) {
    markThrottle(key)
    logNotifEmail(genId(), `package_${eventType}`, null, subject, body)
  }
}

// --- Test email ---

export async function sendTestEmail() {
  if (!isConfigured()) return { success: false, error: 'SMTP not configured' }
  const textBody = 'Boomerang test - notifications working!'
  const transport = getTransporter()
  if (!transport) return { success: false, error: 'Could not create SMTP transport' }
  const { from, to } = getSmtpConfig()
  if (!to) return { success: false, error: 'No recipient email configured' }

  const sms = isSmsGateway(to)
  const mailOpts = sms
    ? { from, to, subject: 'Boomerang Test', text: textBody }
    : { from: `"Boomerang" <${from}>`, to, subject: 'Boomerang Test', text: textBody, html: simpleEmailHtml('Test Email', textBody) }

  try {
    console.log(`[Email] Sending test to ${to} via ${getSmtpConfig().host}:${getSmtpConfig().port}${sms ? ' (SMS mode)' : ''}`)
    const info = await transport.sendMail(mailOpts)
    console.log(`[Email] Test sent OK — messageId: ${info.messageId}, response: ${info.response}`)
    return { success: true, messageId: info.messageId, sms_mode: sms }
  } catch (err) {
    console.error('[Email] Test send failed:', err.message)
    return { success: false, error: err.message }
  }
}

// --- Status check ---

export function getEmailStatus() {
  const { host, port, user, to } = getSmtpConfig()
  const smtpReady = !!(host && user && smtpPass)
  return {
    configured: isConfigured(),
    smtp_configured: smtpReady,
    has_recipient: !!to,
    host: host || null,
    port: port || null,
    user: user ? '***' : null,
    recipient: to || null,
    recipient_source: notificationEmail ? 'env' : 'ui',
    sms_mode: isSmsGateway(to),
  }
}

// --- Lifecycle ---

export function startEmailNotifications() {
  if (loopTimer) return
  // Run every 60 seconds, same as client-side
  loopTimer = setInterval(runNotificationCheck, 60 * 1000)
  // First check after 15 seconds (let DB settle)
  setTimeout(runNotificationCheck, 15000)
  const { host, user, to } = getSmtpConfig()
  if (isConfigured()) {
    console.log(`Email notifications: configured (${host}, recipient: ${to})`)
  } else {
    const missing = []
    if (!host) missing.push('SMTP_HOST')
    if (!user) missing.push('SMTP_USER')
    if (!smtpPass) missing.push('SMTP_PASS')
    if (!to) missing.push('NOTIFICATION_EMAIL or email_address setting')
    console.log(`Email notifications: not configured (missing: ${missing.join(', ')})`)
  }
}

export function stopEmailNotifications() {
  if (loopTimer) {
    clearInterval(loopTimer)
    loopTimer = null
  }
}
