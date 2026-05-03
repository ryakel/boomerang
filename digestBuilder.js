/**
 * Shared daily-digest builder used by all three notification transports.
 *
 * The North Star is "pull the user back into the app to act." A counts-only
 * digest ("5 open · 2 due today · 3 overdue") informs but doesn't pull —
 * counts are debt, not invitation. This builder produces a curated, friendly
 * digest with positive reinforcement (yesterday recap, streak), tappable
 * task links, and gentle framing on overdue tasks ("due 2 days ago", not
 * "OVERDUE!").
 *
 * Sections (in order):
 *   1. Lead-in — friendly opener (rotating static line, AI later via Phase 5)
 *   2. Yesterday recap — completion count + streak (only if there's something positive)
 *   3. Today — tasks due today (overdue rolled in here, gentle phrasing)
 *   4. Coming up — tasks due in next 3 days
 *   5. Carrying — stale tasks, framed as "carrying for N days"
 *   6. Quick wins — XS/S size active tasks
 *   7. Weather — existing buildWeatherSummary() output if configured
 */

import { queryTasks, getData, getAnalytics } from './db.js'
import { getWeatherCache, buildWeatherSummary } from './weatherSync.js'

const ACTIVE_STATUSES = ['not_started', 'doing', 'waiting']

const LEAD_INS = [
  "Quick recap before today's list.",
  "Here's what's on your plate today.",
  "Morning. Light pull-up of what's open.",
  "Coffee's brewing — here's the day.",
  "Friendly nudge, not a pile-on.",
]

function pickLeadIn() {
  return LEAD_INS[Math.floor(Math.random() * LEAD_INS.length)]
}

function getPublicAppUrl(settings) {
  const base = (settings.public_app_url || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '')
  return base || null
}

function deepLink(base, taskId) {
  if (!base) return null
  return taskId ? `${base}/?task=${encodeURIComponent(taskId)}` : base
}

function relDueLine(task) {
  if (!task.due_date) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(task.due_date + 'T00:00:00')
  const diffDays = Math.round((due - today) / 86400000)
  if (diffDays < 0) return `due ${Math.abs(diffDays)} day${Math.abs(diffDays) > 1 ? 's' : ''} ago`
  if (diffDays === 0) return 'due today'
  if (diffDays === 1) return 'due tomorrow'
  return `due in ${diffDays} days`
}

function carryingDays(task) {
  const ms = Date.now() - new Date(task.last_touched).getTime()
  return Math.max(1, Math.floor(ms / 86400000))
}

function isInWindow(task, days) {
  if (!task.due_date) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(task.due_date + 'T00:00:00')
  const diffDays = Math.round((due - today) / 86400000)
  return diffDays > 0 && diffDays <= days
}

function isDueTodayOrOverdue(task) {
  if (!task.due_date) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(task.due_date + 'T00:00:00')
  return due.getTime() <= today.getTime()
}

// Counts yesterday's completions from the tasks table directly (cheap query).
function getYesterdayCompletions() {
  const start = new Date(); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setHours(23, 59, 59, 999)
  const all = queryTasks({})
  return all.filter(t =>
    t.status === 'done' && t.completed_at &&
    new Date(t.completed_at) >= start &&
    new Date(t.completed_at) <= end
  )
}

/**
 * Build the digest payload.
 * Returns { hasContent, subject, textBody, htmlBody } — `hasContent: false`
 * when there's nothing to surface (transports skip the send entirely).
 */
export function buildDigest(settings) {
  const allTasks = queryTasks({})
  const activeTasks = allTasks.filter(t => ACTIVE_STATUSES.includes(t.status) && !t.gmail_pending)
  const nonSnoozed = activeTasks.filter(t => !t.snoozed_until || new Date(t.snoozed_until) <= new Date())
  const nonMuted = nonSnoozed.filter(t => !t.notifications_muted)

  // Counts-style fallback (preserve legacy behavior when user opts in)
  if (settings.digest_style === 'counts') {
    return buildCountsDigest(settings, allTasks, activeTasks)
  }

  const base = getPublicAppUrl(settings)
  const today = nonMuted.filter(isDueTodayOrOverdue).slice(0, 5)
  const comingUp = nonMuted
    .filter(t => isInWindow(t, 3))
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
    .slice(0, 3)
  const staleDays = settings.staleness_days || 2
  const carrying = nonMuted
    .filter(t => carryingDays(t) > staleDays && !isDueTodayOrOverdue(t))
    .sort((a, b) => carryingDays(b) - carryingDays(a))
    .slice(0, 3)
  const quickWins = nonMuted
    .filter(t => (t.size === 'XS' || t.size === 'S') && !t.high_priority && !isDueTodayOrOverdue(t))
    .slice(0, 3)

  // Yesterday recap + streak — positive reinforcement
  const yesterday = getYesterdayCompletions()
  let analytics = null
  try { analytics = getAnalytics(settings) } catch { analytics = null }
  const streak = analytics?.current_streak || analytics?.streak || 0

  // Skip if every section is empty AND there's no positive recap
  const totalItems = today.length + comingUp.length + carrying.length + quickWins.length
  if (totalItems === 0 && yesterday.length === 0 && streak === 0) {
    return { hasContent: false }
  }

  const weatherSummary = buildWeatherSummary(getWeatherCache())

  // --- Build text version (for SMS gateway, push body, Pushover) ---
  const textParts = []
  textParts.push(pickLeadIn())
  if (yesterday.length > 0 || streak > 0) {
    const recap = []
    if (yesterday.length > 0) recap.push(`Completed ${yesterday.length} yesterday`)
    if (streak > 0) recap.push(`Day ${streak} streak`)
    textParts.push(recap.join(' · '))
  }
  const textSection = (heading, items) => {
    if (items.length === 0) return null
    return `${heading}:\n${items.map(line => `• ${line}`).join('\n')}`
  }
  const todaySection = textSection('Today', today.map(t => `${t.title} (${relDueLine(t) || 'no date'})`))
  if (todaySection) textParts.push(todaySection)
  const comingUpSection = textSection('Coming up', comingUp.map(t => `${t.title} (${relDueLine(t)})`))
  if (comingUpSection) textParts.push(comingUpSection)
  const carryingSection = textSection('Carrying', carrying.map(t => `${t.title} (${carryingDays(t)}d)`))
  if (carryingSection) textParts.push(carryingSection)
  const quickWinsSection = textSection('Quick wins', quickWins.map(t => `${t.title} (${t.size})`))
  if (quickWinsSection) textParts.push(quickWinsSection)
  if (weatherSummary) textParts.push(`Weather: ${weatherSummary}`)
  const textBody = textParts.join('\n\n')

  // --- Build HTML version (for email) ---
  // High-contrast, self-contained card. Email clients sometimes invert colors
  // or apply pale backgrounds (Gmail dark mode, iOS Mail), so use dark text
  // with bold weights and avoid light grays — works on white, pale, or dark.
  const htmlSection = (heading, items) => {
    if (items.length === 0) return ''
    return `<div style="margin-top:18px">
      <div style="font-weight:700;font-size:13px;color:#111;text-transform:uppercase;letter-spacing:0.6px">${heading}</div>
      <ul style="margin:8px 0 0 0;padding-left:20px;line-height:1.7">${items.join('')}</ul>
    </div>`
  }
  const taskItem = (task, suffix) => {
    const url = deepLink(base, task.id)
    const titleHtml = url
      ? `<a href="${url}" style="color:#0F4FB3;text-decoration:none;font-weight:500">${escapeHtml(task.title)}</a>`
      : `<span style="color:#111;font-weight:500">${escapeHtml(task.title)}</span>`
    const suffixHtml = suffix ? ` <span style="color:#444;font-size:13px">— ${escapeHtml(suffix)}</span>` : ''
    return `<li style="color:#111">${titleHtml}${suffixHtml}</li>`
  }

  const htmlParts = []
  htmlParts.push(`<p style="font-size:15px;color:#111;margin:0 0 8px 0">${escapeHtml(pickLeadIn())}</p>`)
  if (yesterday.length > 0 || streak > 0) {
    const bits = []
    if (yesterday.length > 0) bits.push(`<strong>${yesterday.length}</strong> completed yesterday`)
    if (streak > 0) bits.push(`day <strong>${streak}</strong> of your streak`)
    htmlParts.push(`<div style="margin-top:4px;color:#0E6B36;font-size:14px;font-weight:500">${bits.join(' · ')}</div>`)
  }
  htmlParts.push(htmlSection('Today', today.map(t => taskItem(t, relDueLine(t) || 'no date'))))
  htmlParts.push(htmlSection('Coming up', comingUp.map(t => taskItem(t, relDueLine(t)))))
  htmlParts.push(htmlSection('Carrying', carrying.map(t => taskItem(t, `${carryingDays(t)} days`))))
  htmlParts.push(htmlSection('Quick wins', quickWins.map(t => taskItem(t, t.size))))
  if (weatherSummary) {
    htmlParts.push(`<div style="margin-top:18px;font-size:13px;color:#111"><strong style="color:#111">Weather:</strong> ${escapeHtml(weatherSummary)}</div>`)
  }
  if (base) {
    htmlParts.push(`<div style="margin-top:24px"><a href="${base}" style="color:#0F4FB3;font-weight:600;text-decoration:none">Open Boomerang &rarr;</a></div>`)
  }
  // Wrap in self-contained light card so the email client wrapper doesn't bleed through
  const htmlBody = `<div style="background:#ffffff;color:#111;padding:8px 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">${htmlParts.join('\n')}</div>`

  // Subject line — summarize without alarmism
  const subjectBits = []
  if (today.length > 0) subjectBits.push(`${today.length} for today`)
  if (yesterday.length > 0) subjectBits.push(`${yesterday.length} done yesterday`)
  const subject = `Morning: ${subjectBits.length > 0 ? subjectBits.join(', ') : 'a quiet day'}`

  return { hasContent: true, subject, textBody, htmlBody, today, comingUp, carrying, quickWins }
}

// Legacy counts-only digest, preserved for users who set digest_style='counts'
function buildCountsDigest(settings, allTasks, activeTasks) {
  if (activeTasks.length === 0) return { hasContent: false }
  const overdueTasks = activeTasks.filter(t => {
    if (!t.due_date) return false
    const due = new Date(t.due_date + 'T23:59:59.999')
    return Date.now() > due.getTime()
  })
  const todayStr = new Date().toISOString().split('T')[0]
  const dueTodayTasks = activeTasks.filter(t => t.due_date === todayStr)
  const staleDays = settings.staleness_days || 2
  const staleTasks = activeTasks.filter(t => {
    const elapsed = Date.now() - new Date(t.last_touched).getTime()
    return elapsed > staleDays * 86400000
  })

  const parts = [`${activeTasks.length} open`]
  if (dueTodayTasks.length > 0) parts.push(`${dueTodayTasks.length} due today`)
  if (overdueTasks.length > 0) parts.push(`${overdueTasks.length} overdue`)
  if (staleTasks.length > 0) parts.push(`${staleTasks.length} stale`)

  let textBody = parts.join(' · ')
  let htmlBody = `<p>You have <strong>${activeTasks.length}</strong> open tasks.</p>`
  if (dueTodayTasks.length > 0) htmlBody += `<p><strong>${dueTodayTasks.length}</strong> due today</p>`
  if (overdueTasks.length > 0) htmlBody += `<p><strong>${overdueTasks.length}</strong> overdue</p>`
  if (staleTasks.length > 0) htmlBody += `<p><strong>${staleTasks.length}</strong> stale</p>`

  const weatherSummary = buildWeatherSummary(getWeatherCache())
  if (weatherSummary) {
    textBody += `\n\nWeather: ${weatherSummary}`
    htmlBody += `<p><strong>Weather:</strong> ${escapeHtml(weatherSummary)}</p>`
  }

  return {
    hasContent: true,
    subject: `Morning Digest: ${activeTasks.length} open tasks`,
    textBody,
    htmlBody,
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
