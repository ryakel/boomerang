/**
 * The morning digest — the ONE scheduled notification of the day (2026-07-24
 * digest reshape). Everything informational competes for space inside it;
 * nothing ambient gets its own push anymore. Consumes the task model
 * (migration 046): committed tasks render as commitment sentences built from
 * implementation intentions + first steps.
 *
 * Principles (hard rules):
 *   - Forward-framed: opens with today, never with what didn't happen.
 *     Punishment-framing vocabulary (the four banned words) never appears.
 *   - Glanceable then expandable: push text = the three commitments;
 *     tapping opens the full digest (GET /api/digest/today renders it).
 *   - Boomeranged tasks are "back in the pool" — an aggregate, gentle line.
 *     Never itemized in the push; listed WITHOUT counts in the expanded view.
 *
 * Sections (each omitted when empty):
 *   1. Today's three — committed tasks as commitment sentences. Until the
 *      pick-three UI ships, falls back to the top due-today tasks (crisis
 *      first) so the digest stays useful; an invite line mentions the pool
 *      when fewer than three are committed. Never auto-commits.
 *   2. Ten-minutes nudge — one committed task with a first_step, rotating
 *      daily among candidates. (The spec keys this on timer history; no
 *      timer feature exists yet, so rotation stands in until it ships.)
 *   3. Back in the pool — aggregate gentle-return line.
 *   4. Coming back — shelve-snoozes landing today.
 *   5. Pool health — Mondays only: open/shelved counts + triage invite.
 *   6. Coming up (next 3 days), yesterday recap + streak, growth-area line,
 *      weather — the retained informational fold-ins, expanded view only.
 */

import { queryTasks, getAnalytics, filterNotifiableTasks, isCrisisTask, isNotifiable, getVacationWindow } from './db.js'
import { isAway } from './vacationWindow.js'
import { getWeatherCache, buildWeatherSummary } from './weatherSync.js'
import { getTodayGrowthAreaCached } from './growthAreas.js'
import { deriveTaskState, ymdInTz, DEFAULT_TIMEZONE } from './taskModel.js'

const PUSH_BODY_MAX = 150

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

function isInWindow(task, days) {
  if (!task.due_date) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(task.due_date + 'T00:00:00')
  const diffDays = Math.round((due - today) / 86400000)
  return diffDays > 0 && diffDays <= days
}

function isDueTodayOrEarlier(task) {
  if (!task.due_date) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(task.due_date + 'T00:00:00')
  return due.getTime() <= today.getTime()
}

function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0)
  return Math.floor((d - start) / 86400000)
}

// Commitment sentence from the task model's intention fields:
//   "After you pour coffee — file the expense report (start: open the receipts folder)"
// Falls back to the plain title (+ first step) when no intention is set.
function commitmentLine(task) {
  const lead = task.intention_when || task.intention_where || null
  const start = task.first_step ? ` (start: ${task.first_step})` : ''
  if (lead) {
    const cap = lead.charAt(0).toUpperCase() + lead.slice(1)
    return `${cap} — ${task.title}${start}`
  }
  return `${task.title}${start}`
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
 * Returns { hasContent, date, pushTitle, pushBody, subject, textBody,
 * htmlBody, sections } — pushTitle/pushBody are the notification shape
 * (~150 chars); textBody/htmlBody are the expanded view.
 */
export function buildDigest(settings, { now = new Date() } = {}) {
  const tz = settings.user_timezone || DEFAULT_TIMEZONE
  const todayYMD = ymdInTz(now, tz)

  const allTasks = queryTasks({}).filter(t => !t.gmail_pending)
  const activeTasks = filterNotifiableTasks(allTasks)
  const nonSnoozed = activeTasks.filter(t => !t.snoozed_until || new Date(t.snoozed_until) <= now)
  const nonMuted = nonSnoozed.filter(t => !t.notifications_muted)
  const crisis = t => isCrisisTask(t, settings)
  const stateOf = t => deriveTaskState(t, { todayYMD, nowMs: now.getTime() })

  // Supervised chores (assignee set) never headline the owner's digest, and
  // never count toward the owner's pool (`own` below). Full rationale sits on
  // the fallback-three block.
  const own = t => !t.assignee

  // --- 1. Today's three ---
  const committed = allTasks
    .filter(t => t.committed_on === todayYMD)
    .filter(t => {
      const s = stateOf(t)
      return s === 'committed' || (s === 'done' && ymdInTz(t.completed_at || 0, tz) === todayYMD)
    })
  const committedOpen = committed.filter(t => stateOf(t) === 'committed')
  // The pool is what the OWNER picks their three from — supervised chores are
  // not candidates, so they don't inflate "N in the pool" either.
  const openPool = allTasks.filter(t => own(t) && stateOf(t) === 'open')

  // Fallback while the pick-three UI is still landing: with nothing
  // committed, lead with today's due tasks (crisis first) so the digest
  // keeps its morning-brief value.
  // Supervised chores (assignee set) never HEADLINE the owner's digest. The
  // 2026-07-31 bug: a daily loop assigned to the owner's son spawned due-today
  // tasks every morning, and the fallback below selects due-today sorted by
  // impact — which assignee-carrying tasks reliably win, because the impact
  // rubric treats "for someone you're responsible to" as a strong 3. Net
  // effect: the kid's chores were the only thing the digest ever led with.
  // They fold into an aggregate line instead (below); an assigned task the
  // owner EXPLICITLY committed stays in Today's three, because that was a
  // human choice, and a crisis-tagged one still leads like any crisis.
  let threeMode = 'committed'
  let three = committed
  if (committed.length === 0) {
    three = nonMuted
      .filter(t => own(t) || crisis(t))
      .filter(t => isDueTodayOrEarlier(t) || crisis(t))
      .sort((a, b) => (crisis(b) ? 1 : 0) - (crisis(a) ? 1 : 0) || ((b.impact ?? 2) - (a.impact ?? 2)))
      .slice(0, 3)
    threeMode = three.length > 0 ? 'today' : 'empty'
  }
  // Crisis tasks always lead, committed or not — the one deliberately loud
  // thing in the app belongs at the top of its one notification.
  const crisisExtras = nonMuted.filter(t => crisis(t) && !three.some(x => x.id === t.id))
  if (threeMode === 'committed' && crisisExtras.length > 0) {
    three = [...crisisExtras, ...three]
  }

  const inviteLine = (() => {
    if (threeMode === 'committed' && committedOpen.length > 0 && committedOpen.length < 3 && openPool.length > 0) {
      const n = committedOpen.length
      const more = 3 - n
      return `You've got ${n} committed. ${openPool.length} in the pool if you want to pick ${more === 1 ? 'one more' : `${more} more`}.`
    }
    if (threeMode !== 'committed' && openPool.length > 0) {
      return `${openPool.length} in the pool when you're ready.`
    }
    return null
  })()

  // --- On deck for <assignee> (aggregate, expanded view + empty-day push) ---
  // The chores stay VISIBLE — the owner supervises them — they just read as
  // one line per person instead of occupying the owner's own top three.
  const assignedDue = nonMuted.filter(t => t.assignee && isDueTodayOrEarlier(t) && !crisis(t))
  const byAssignee = new Map()
  for (const t of assignedDue) {
    const k = t.assignee
    byAssignee.set(k, (byAssignee.get(k) || 0) + 1)
  }
  const assignedLines = [...byAssignee.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([who, n]) => `On deck for ${who}: ${n} task${n === 1 ? '' : 's'}.`)

  // --- 2. Ten-minutes nudge (rotate daily among committed-with-first-step) ---
  // `own` again: "Ten minutes on <the kid's handwriting>?" is addressed to the
  // wrong person.
  const nudgeCandidates = committedOpen.filter(t => own(t) && t.first_step)
  const tenMinutes = nudgeCandidates.length > 0
    ? nudgeCandidates[dayOfYear(now) % nudgeCandidates.length]
    : null

  // --- 3. Back in the pool (gentle-return aggregate) ---
  const returned = allTasks.filter(t =>
    stateOf(t) === 'open' && t.last_boomeranged_at && ymdInTz(t.last_boomeranged_at, tz) === todayYMD)

  // --- 4. Coming back (shelve-snoozes landing today) ---
  const returningToday = allTasks.filter(t =>
    !t.snooze_indefinite && t.snoozed_until && ymdInTz(t.snoozed_until, tz) === todayYMD
    && ['not_started', 'doing', 'waiting'].includes(t.status))

  // --- 5. Pool health (Mondays only) ---
  const isMonday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now) === 'Mon'
  const shelvedCount = allTasks.filter(t => stateOf(t) === 'shelved' && t.status !== 'project').length
  const poolHealth = isMonday && (openPool.length > 0 || shelvedCount > 0)
    ? `Pool: ${openPool.length} open · ${shelvedCount} shelved. Want a 5-minute triage?`
    : null

  // --- Retained informational fold-ins (expanded view only) ---
  const comingUp = nonMuted
    .filter(own)
    .filter(t => isInWindow(t, 3) && !three.some(x => x.id === t.id))
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
    .slice(0, 3)
  const yesterday = getYesterdayCompletions()
  let analytics
  try { analytics = getAnalytics(settings) } catch { analytics = null }
  const streak = analytics?.current_streak || analytics?.streak || 0
  const weatherSummary = buildWeatherSummary(getWeatherCache())
  const growthPick = getTodayGrowthAreaCached()
  const growthText = growthPick?.morning?.text || null

  // --- Push notification shape ---
  const hireSuffix = t => t.diy_verdict === 'hire' ? ' · hire it out' : ''
  const pushTitle = threeMode === 'committed' ? "Today's three"
    : threeMode === 'today' ? 'Today'
    : 'Pick your three'
  let pushBody
  if (three.length > 0) {
    pushBody = three.map(t => `${crisis(t) ? '🚨 ' : ''}${t.title}`).join(', ')
    if (pushBody.length > PUSH_BODY_MAX) pushBody = pushBody.slice(0, PUSH_BODY_MAX - 1) + '…'
  } else {
    // An "empty" day with supervised chores on deck isn't quite quiet — say
    // so in one clause rather than pretending nothing exists.
    pushBody = inviteLine
      || (assignedLines.length ? assignedLines.join(' ') : 'A quiet day — nothing scheduled.')
  }

  // --- Expanded text version (SMS gateway, Pushover, in-app fallback) ---
  // --- Away statement (leads the expanded view while suppressing) ---
  // The away window's failure mode is silence you can't see: a digest that just
  // got shorter is indistinguishable from a quiet week. So while it suppresses,
  // the digest SAYS so, with the count it is holding. `ignoreAway` shows what
  // WOULD have notified; the difference is what the window is hiding.
  const awayWindow = getVacationWindow()
  const awayNow = isAway(awayWindow, todayYMD)
  const awayHeld = awayNow
    ? allTasks.filter(t => isNotifiable(t, settings, { ignoreAway: true }) && !isNotifiable(t, settings)).length
    : 0
  const awayLine = awayNow
    ? `🏝️ Away${awayWindow.ends_at ? ` until ${awayWindow.ends_at}` : ''} — ${awayHeld === 0 ? 'nothing being held' : `holding ${awayHeld} task${awayHeld === 1 ? '' : 's'} until you're back`}. Critical still gets through.`
    : null

  const textParts = []
  if (awayLine) textParts.push(awayLine)
  const threeHeading = threeMode === 'committed' ? "Today's three" : 'Today'
  if (three.length > 0) {
    const lines = three.map(t => `• ${crisis(t) ? '🚨 ' : ''}${threeMode === 'committed' ? commitmentLine(t) : `${t.title} (${relDueLine(t) || 'no date'})`}${hireSuffix(t)}${stateOf(t) === 'done' ? ' ✓' : ''}`)
    textParts.push(`${threeHeading}:\n${lines.join('\n')}`)
  }
  if (inviteLine) textParts.push(inviteLine)
  if (tenMinutes) textParts.push(`Ten minutes on "${tenMinutes.title}"? That's all.`)
  if (returned.length > 0) {
    textParts.push(`${returned.length} task${returned.length > 1 ? 's' : ''} came back around — in the pool when you're ready.`)
  }
  if (returningToday.length > 0) {
    textParts.push(`Returning today: ${returningToday.map(t => t.title).join(', ')}`)
  }
  if (assignedLines.length) textParts.push(assignedLines.join('\n'))
  if (poolHealth) textParts.push(poolHealth)
  if (comingUp.length > 0) {
    textParts.push(`Coming up:\n${comingUp.map(t => `• ${t.title} (${relDueLine(t)})`).join('\n')}`)
  }
  if (yesterday.length > 0 || streak > 0) {
    const recap = []
    if (yesterday.length > 0) recap.push(`${yesterday.length} caught yesterday`)
    if (streak > 0) recap.push(`day ${streak} of your rally`)
    textParts.push(recap.join(' · '))
  }
  if (growthText) textParts.push(`☀️ Today: ${growthText}`)
  if (weatherSummary) textParts.push(`Weather: ${weatherSummary}`)
  const textBody = textParts.join('\n\n') || pushBody

  // --- Expanded HTML version (email) ---
  const base = getPublicAppUrl(settings)
  const htmlSection = (heading, items) => {
    if (items.length === 0) return ''
    return `<div style="margin-top:18px">
      <div style="font-weight:700;font-size:13px;color:#111;text-transform:uppercase;letter-spacing:0.6px">${escapeHtml(heading)}</div>
      <ul style="margin:8px 0 0 0;padding-left:20px;line-height:1.7">${items.join('')}</ul>
    </div>`
  }
  const taskItem = (task, text, isCrisis = false) => {
    const url = deepLink(base, task.id)
    const inner = url
      ? `<a href="${url}" style="color:#0F4FB3;text-decoration:none;font-weight:500">${escapeHtml(text)}</a>`
      : `<span style="color:#111;font-weight:500">${escapeHtml(text)}</span>`
    return `<li style="color:#111">${isCrisis ? '🚨 ' : ''}${inner}</li>`
  }
  const line = (html) => `<p style="font-size:14px;color:#111;margin:12px 0 0 0">${html}</p>`

  const htmlParts = []
  htmlParts.push(htmlSection(threeHeading, three.map(t =>
    taskItem(t, `${threeMode === 'committed' ? commitmentLine(t) : `${t.title} — ${relDueLine(t) || 'no date'}`}${hireSuffix(t)}${stateOf(t) === 'done' ? ' ✓' : ''}`, crisis(t)))))
  if (inviteLine) htmlParts.push(line(escapeHtml(inviteLine)))
  if (tenMinutes) htmlParts.push(line(`Ten minutes on <strong>${escapeHtml(tenMinutes.title)}</strong>? That's all.`))
  if (returned.length > 0) {
    htmlParts.push(line(`${returned.length} task${returned.length > 1 ? 's' : ''} came back around — in the pool when you're ready.`))
  }
  if (returningToday.length > 0) {
    htmlParts.push(htmlSection('Returning today', returningToday.map(t => taskItem(t, t.title))))
  }
  if (poolHealth) htmlParts.push(line(escapeHtml(poolHealth)))
  htmlParts.push(htmlSection('Coming up', comingUp.map(t => taskItem(t, `${t.title} — ${relDueLine(t)}`))))
  if (yesterday.length > 0 || streak > 0) {
    const bits = []
    if (yesterday.length > 0) bits.push(`<strong>${yesterday.length}</strong> caught yesterday`)
    if (streak > 0) bits.push(`day <strong>${streak}</strong> of your rally`)
    htmlParts.push(`<div style="margin-top:14px;color:#0E6B36;font-size:14px;font-weight:500">${bits.join(' · ')}</div>`)
  }
  if (growthText) {
    htmlParts.push(`<p style="font-size:14px;color:#0E6B36;margin:12px 0 0 0;font-weight:500">☀️ Today: ${escapeHtml(growthText)}</p>`)
  }
  if (weatherSummary) {
    htmlParts.push(`<div style="margin-top:18px;font-size:13px;color:#111"><strong style="color:#111">Weather:</strong> ${escapeHtml(weatherSummary)}</div>`)
  }
  if (base) {
    htmlParts.push(`<div style="margin-top:24px"><a href="${base}" style="color:#0F4FB3;font-weight:600;text-decoration:none">Open Boomerang &rarr;</a></div>`)
  }
  const htmlBody = `<div style="background:#ffffff;color:#111;padding:8px 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">${htmlParts.join('\n')}</div>`

  return {
    hasContent: true,
    date: todayYMD,
    pushTitle,
    pushBody,
    // Email subject mirrors the push title with a hint of content.
    subject: three.length > 0 ? `${pushTitle}: ${three.map(t => t.title).join(', ').slice(0, 80)}` : pushTitle,
    textBody,
    htmlBody,
    sections: {
      mode: threeMode,
      three: three.map(t => ({
        id: t.id,
        title: t.title,
        line: threeMode === 'committed' ? commitmentLine(t) : `${t.title}${relDueLine(t) ? ` — ${relDueLine(t)}` : ''}`,
        first_step: t.first_step || null,
        intention_when: t.intention_when || null,
        intention_where: t.intention_where || null,
        crisis: crisis(t),
        done: stateOf(t) === 'done',
      })),
      invite: inviteLine,
      ten_minutes: tenMinutes ? { id: tenMinutes.id, title: tenMinutes.title, first_step: tenMinutes.first_step } : null,
      // Gentle returns: count in the push-less line; titles WITHOUT any
      // per-task came-back counts in the expanded view (hard rule).
      back_in_pool: { count: returned.length, tasks: returned.map(t => ({ id: t.id, title: t.title })) },
      returning_today: returningToday.map(t => ({ id: t.id, title: t.title })),
      pool_health: poolHealth,
      coming_up: comingUp.map(t => ({ id: t.id, title: t.title, due: relDueLine(t) })),
      recap: { yesterday: yesterday.length, streak },
      growth: growthText,
      weather: weatherSummary || null,
    },
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
