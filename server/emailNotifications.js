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
import { queryTasks, getData, getNotifThrottle, setNotifThrottle, logNotifEmail, filterNotifiableTasks, escalationNudgeOverride, isCrisisTask } from './db.js'
import { isInQuietHours } from './userTime.js'

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

// Avoidance-prone energy types (same as client)
const AVOIDANCE_ENERGY_TYPES = ['errand', 'confrontation']
const ACTIVE_STATUSES = ['not_started', 'doing', 'waiting']

let transporter = null
let loopTimer = null

// --- Transport setup ---

function getSmtpConfig() {
  const settings = getData('settings') || {}
  const host = smtpHost
  const port = parseInt(smtpPort || '587', 10)
  const user = smtpUser
  const pass = smtpPass
  // From-address resolution priority: UI setting > env var > SMTP user.
  // Setting it to a domain-controlled address (with SPF/DKIM/DMARC) is the
  // single biggest deliverability lever — generic-relay defaults hit spam.
  const fromAddr = settings.email_from_address || smtpFrom || user
  const fromName = settings.email_from_name || 'Boomerang Digest'
  const from = fromAddr ? `"${fromName}" <${fromAddr}>` : null
  const to = notificationEmail || settings.email_address
  return { host, port, user, pass, from, fromAddr, fromName, to }
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
  const { from, fromAddr, to } = getSmtpConfig()
  if (!to) return false

  // SMS gateways: text-only, truncated, minimal headers (no display name).
  const sms = isSmsGateway(to)
  const mailOpts = sms
    ? { from: fromAddr, to, subject, text: textBody.slice(0, 140) }
    : { from, to, subject, text: textBody, html: htmlBody }

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

function simpleEmailHtml(title, message) {
  return emailWrapper(title, `<div style="font-size:14px;color:#ccc;line-height:1.5">${message}</div>`)
}

// Light-theme wrapper for the morning digest. Avoids the dark card so Gmail /
// iOS Mail's auto color shifting doesn't wash out the body text.
function digestEmailHtml(title, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#ffffff;border-radius:12px;padding:24px;color:#111;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
    <div style="font-size:18px;font-weight:700;color:#111;margin-bottom:12px">${title}</div>
    ${bodyHtml}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5ea;font-size:12px;color:#555">
      Boomerang Task Manager
    </div>
  </div>
</div>
</body>
</html>`
}

// --- Notification logic (mirrors useNotifications.js) ---

function getFreqMs(settings, key, fallbackHours) {
  const val = settings[key]
  const hours = val != null ? val : fallbackHours
  return hours * 60 * 60 * 1000
}

// isInQuietHours / getUserTimeParts now imported from userTime.js

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

function markThrottle(key) {
  setNotifThrottle(key, new Date().toISOString())
}

// Habit-mode helpers (mirror pushNotifications.js + computeHabitStats in
// src/store.js — must stay in sync across all three or the user gets nudge /
// progress drift between channels and the card).
function genId() {
  return crypto.randomUUID()
}

// --- Main notification check loop ---
//
// 2026-07-24 digest reshape ("The Great Alert Deletion"): the ambient flood
// is deleted — see pushNotifications.js for the full rationale. What remains
// are the deliberate per-task opt-ins (Critical tag, escalation ladders,
// nag_allowed daily line). The digest itself is scheduled by the central
// pipeline in server.js, which calls sendDigestEmail() below.

async function runNotificationCheck() {
  try {
    if (!isConfigured()) return

    const settings = getData('settings') || {}
    if (!settings.email_notifications_enabled) return
    if (isInQuietHours(settings)) return

    const allTasks = queryTasks({})
    const activeTasks = filterNotifiableTasks(allTasks)
    if (activeTasks.length === 0) return

    const nonSnoozed = activeTasks.filter(t => !t.snoozed_until || new Date(t.snoozed_until) <= new Date())

    // Crisis tag ("prio") — per-task loop at notif_freq_crisis (default 2h),
    // before and exempt from the high-pri per-tick cap. Mirrors the push/
    // pushover engines; the engine-wide quiet-hours gate above keeps email
    // silent overnight. Crisis tasks are excluded from the hp/escalation
    // loops and stale/nudge/pile-up pools below (no double-nag).
    const crisisIds = new Set()
    {
      const crisisTasks = nonSnoozed.filter(t => isCrisisTask(t, settings))
      for (const task of crisisTasks) {
        crisisIds.add(task.id)
        const freq = applyAvoidanceBoost(getFreqMs(settings, 'notif_freq_crisis', 2), task)
        if (!checkThrottle(`email_crisis:${task.id}`, freq)) continue
        const body = buildCrisisBody(task)
        const sent = await sendEmail('🚨 CRITICAL', simpleEmailHtml('🚨 CRITICAL', body), body)
        if (sent) {
          markThrottle(`email_crisis:${task.id}`)
          logNotifEmail(genId(), 'crisis', task.id, '🚨 CRITICAL', body)
        }
      }
    }

    // Escalation ladder — same tactic-aware per-task nudge as push/pushover,
    // at the rung's own cadence. A deliberate per-task opt-in; survives the reshape.
    const escalationActiveIds = new Set()
    if (settings.email_notif_escalation !== false) {
      // Crisis takes precedence — no stacked escalation nudge on a crisis task.
      const escalationTasks = nonSnoozed.filter(t => t.escalation_current_rung != null && !crisisIds.has(t.id))
      for (const task of escalationTasks) {
        escalationActiveIds.add(task.id)
        const override = escalationNudgeOverride(task)
        if (!override) continue
        const freq = (override.cadenceDays || 1) * 24 * 60 * 60 * 1000
        if (!checkThrottle(`email_escalation:${task.id}`, freq)) continue
        const title = task.escalation_stuck ? 'Out of moves — brainstorm?'
          : task.escalation_awaiting_advance ? 'Ready to switch tactics?'
          : `Follow up: ${task.title}`
        const sent = await sendEmail(title, simpleEmailHtml(title, override.text), override.text)
        if (sent) {
          markThrottle(`email_escalation:${task.id}`)
          logNotifEmail(genId(), 'escalation', task.id, title, override.text)
        }
      }
    }

    // Per-task "remind me" (nag_allowed) — the explicit opt-in toggle on a
    // task. ONE gentle line per opted-in task per day, forward-framed.
    for (const task of nonSnoozed) {
      if (!task.nag_allowed || crisisIds.has(task.id) || escalationActiveIds.has(task.id)) continue
      if (!checkThrottle(`email_remind:${task.id}`, 24 * 60 * 60 * 1000)) continue
      const body = `"${task.title}" is on your list — when you're ready.`
      const sent = await sendEmail('A gentle reminder', simpleEmailHtml('A gentle reminder', body), body)
      if (sent) {
        markThrottle(`email_remind:${task.id}`)
        logNotifEmail(genId(), 'remind', task.id, 'A gentle reminder', body)
      }
    }
  } catch (err) {
    console.error('[Email] Notification check failed:', err.message)
  }
}

// Security alert (auth Phase A/B) — mirrors sendSecurityAlertPush: the one
// deliberately loud category, not silenceable by per-type toggles.
export async function sendSecurityAlertEmail({ title, body }) {
  if (!isConfigured()) return false
  const settings = getData('settings') || {}
  if (!settings.email_notifications_enabled) return false
  const sent = await sendEmail(title, simpleEmailHtml(title, body), body)
  if (sent) logNotifEmail(genId(), 'security', null, title, body)
  return sent
}

// --- Package notification (called from server.js when package status changes) ---

export async function sendPackageEmail(pkg, eventType) {
  if (!isConfigured()) return
  const settings = getData('settings') || {}
  if (!settings.email_notifications_enabled) return

  // Check per-type setting
  if (eventType === 'delivered' && settings.email_notif_package_delivered === false) return
  if (eventType === 'exception' && settings.email_notif_package_exception === false) return
  if (eventType === 'signature_required' && settings.email_notif_package_signature === false) return

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

// Send a pre-built digest payload (used by manual test endpoint).
// Reuses existing transporter and recipient config.
export async function sendDigestEmail(digest) {
  if (!isConfigured() || !digest?.hasContent) return false
  const html = digestEmailHtml('Morning Digest', digest.htmlBody)
  const sent = await sendEmail(digest.subject, html, digest.textBody)
  if (sent) {
    logNotifEmail(genId(), 'digest', null, digest.subject, digest.textBody)
  }
  return sent
}

export async function sendTestEmail() {
  if (!isConfigured()) return { success: false, error: 'SMTP not configured' }
  const textBody = 'Boomerang test - notifications working!'
  const transport = getTransporter()
  if (!transport) return { success: false, error: 'Could not create SMTP transport' }
  const { from, fromAddr, to } = getSmtpConfig()
  if (!to) return { success: false, error: 'No recipient email configured' }

  const sms = isSmsGateway(to)
  const mailOpts = sms
    ? { from: fromAddr, to, subject: 'Boomerang Test', text: textBody }
    : { from, to, subject: 'Boomerang Test', text: textBody, html: simpleEmailHtml('Test Email', textBody) }

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

// Live SMTP connection check — opens the connection + authenticates via
// nodemailer's verify(), but sends NO email (unlike sendTestEmail). Used by the
// integration health probe so "check my integrations" never spams the inbox.
export async function verifyEmail() {
  const status = getEmailStatus()
  if (!status.smtp_configured) return { configured: false, ok: false, detail: 'SMTP not configured (env vars)' }
  try {
    const tx = getTransporter()
    if (!tx) return { configured: true, ok: false, detail: 'Transporter unavailable' }
    await tx.verify()
    return { configured: true, ok: true, host: status.host, recipient: status.recipient, has_recipient: status.has_recipient, sms_mode: status.sms_mode }
  } catch (err) {
    return { configured: true, ok: false, detail: err.message }
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
