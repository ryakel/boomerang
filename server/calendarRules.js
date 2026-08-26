// Calendar event rules — the PURE half.
//
// "When an event like this shows up, make me this task." The task is work the
// event implies rather than the event itself: the flight means the budget
// spreadsheet needs updating.
//
// No db, no network, no clock of its own — every function here takes what it
// needs and returns a value, which is what lets scripts/calendarRules.test.mjs
// pin the matching rules without standing a server up. Same posture as
// listMerge.js and reminderMerge.js. The impure half (fetching, firing,
// writing tasks) lives in calendarRuleEngine.js.
//
// Matching is deterministic and stays that way. A rule runs against every
// event in the window on every poll, so an AI condition would bill per event
// forever and, worse, would make "why did this fire?" unanswerable. Rules are
// meant to be read. AI writes them; it never evaluates them.

export const CONDITION_FIELDS = ['title', 'location', 'description', 'attendees', 'organizer', 'timing']
export const CONDITION_OPS = ['contains', 'not_contains', 'equals', 'matches', 'is']
export const TIMING_VALUES = ['all_day', 'timed']
export const TEMPLATE_SIZES = ['XS', 'S', 'M', 'L', 'XL']
// What a second firing does when this rule's last task is still open.
export const REPEAT_MODES = ['stack', 'update']

// A user-authored regex runs inside the poll loop, so a pathological pattern
// would hang the server rather than one request. Bounding both the pattern and
// the haystack keeps the worst case cheap; an invalid pattern is rejected at
// save time and, belt and braces, fails closed at match time.
const MAX_PATTERN_LENGTH = 200
const MAX_HAYSTACK_LENGTH = 2000

// --- reading an event ------------------------------------------------------

// The date the event starts, in the event's own timezone offset — the same
// reading the pull sync takes (`dateTime.split('T')[0]`), so a rule and an
// imported event never disagree about what day something is on.
export function eventDate(event) {
  if (event?.start?.date) return event.start.date
  const dt = event?.start?.dateTime
  if (typeof dt === 'string' && dt.includes('T')) return dt.split('T')[0]
  return null
}

export function eventTime(event) {
  const dt = event?.start?.dateTime
  if (typeof dt !== 'string' || !dt.includes('T')) return null
  return dt.split('T')[1].slice(0, 5)
}

export function isAllDay(event) {
  return !!event?.start?.date
}

// Plain calendar arithmetic on the Y-M-D parts. Deliberately not Date-based:
// constructing a Date from 'YYYY-MM-DD' lands on UTC midnight, and adding a
// day to that can come back as the previous day once anything renders it in a
// western timezone.
export function shiftDate(ymd, days) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const n = Number(days) || 0
  const [y, m, d] = ymd.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + n * 86400000
  const out = new Date(t)
  const pad = v => String(v).padStart(2, '0')
  return `${out.getUTCFullYear()}-${pad(out.getUTCMonth() + 1)}-${pad(out.getUTCDate())}`
}

// Has this event not started yet, as of `now`?
//
// Deliberately NOT part of matchEvent(). Matching is clock-free because the
// suppression query is built on it, and an event that stopped matching the
// moment it started would stop being suppressed then too — putting the flight a
// rule exists to REPLACE into the task list halfway through the flight. Only
// the paths that actually create or reserve a task ask this question.
//
// A timed event carries its own UTC offset in `start.dateTime`, so it compares
// exactly. An all-day event is a bare date with no instant to compare, so it is
// judged against the user's today: an all-day event covering today is happening
// now, not in the future.
export function eventIsUpcoming(event, { now, todayYmd }) {
  if (isAllDay(event)) {
    const date = eventDate(event)
    if (!date || !todayYmd) return true // can't tell — don't silently withhold
    return date > todayYmd
  }
  const dt = event?.start?.dateTime
  if (!dt) return true
  const start = new Date(dt)
  if (Number.isNaN(start.getTime())) return true
  return start.getTime() > new Date(now).getTime()
}

function fieldValue(event, field) {
  switch (field) {
    case 'title': return event?.summary || ''
    case 'location': return event?.location || ''
    case 'description': return event?.description || ''
    case 'attendees':
      return (event?.attendees || [])
        .map(a => `${a?.email || ''} ${a?.displayName || ''}`.trim())
        .join(' ')
    case 'organizer':
      return `${event?.organizer?.email || ''} ${event?.organizer?.displayName || ''}`.trim()
    case 'timing': return isAllDay(event) ? 'all_day' : 'timed'
    default: return ''
  }
}

// --- matching --------------------------------------------------------------

export function compilePattern(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > MAX_PATTERN_LENGTH) return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

// { matched, captures } — captures are the regex groups of every `matches`
// condition, in condition order, so {{match.1}} is the first group of the
// first regex condition.
export function matchEvent(rule, event) {
  const miss = { matched: false, captures: [] }
  if (!rule || rule.enabled === false) return miss
  if (!event) return miss
  // A cancelled instance of a recurring series is not an event that happened.
  if (event.status === 'cancelled') return miss
  // The engine already fetches per calendar; this only bites on a preview
  // where the events carry their own calendarId.
  if (rule.calendar_id && event.calendarId && rule.calendar_id !== event.calendarId) return miss

  const conditions = Array.isArray(rule.conditions) ? rule.conditions : []
  // No conditions means "every event on this calendar", which is a foot-gun
  // with no use case. normalizeRule rejects it; this is the second line.
  if (conditions.length === 0) return miss

  const captures = []
  for (const c of conditions) {
    const haystack = fieldValue(event, c?.field).slice(0, MAX_HAYSTACK_LENGTH)
    const needle = typeof c?.value === 'string' ? c.value : ''
    switch (c?.op) {
      case 'contains':
        if (!haystack.toLowerCase().includes(needle.toLowerCase())) return miss
        break
      case 'not_contains':
        if (haystack.toLowerCase().includes(needle.toLowerCase())) return miss
        break
      case 'equals':
      case 'is':
        if (haystack.trim().toLowerCase() !== needle.trim().toLowerCase()) return miss
        break
      case 'matches': {
        const re = compilePattern(needle)
        // An unparseable pattern fails closed. Firing on everything because a
        // regex didn't compile is the one outcome worse than not firing.
        if (!re) return miss
        const m = haystack.match(re)
        if (!m) return miss
        captures.push(...m.slice(1).map(g => g ?? ''))
        break
      }
      default:
        return miss
    }
  }
  return { matched: true, captures }
}

// --- templating ------------------------------------------------------------

export function renderTemplate(str, event, captures = []) {
  if (typeof str !== 'string' || !str) return ''
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    switch (key) {
      case 'event.title': return event?.summary || ''
      case 'event.date': return eventDate(event) || ''
      case 'event.time': return eventTime(event) || ''
      case 'event.location': return event?.location || ''
      case 'event.description': return event?.description || ''
      default: {
        const m = /^match\.(\d+)$/.exec(key)
        // An unknown placeholder renders empty rather than printing itself —
        // a task called "Log {{event.tail}} hours" is worse than "Log hours".
        if (!m) return ''
        return captures[Number(m[1]) - 1] ?? ''
      }
    }
  }).trim()
}

// The task a rule produces. NOTE what is not here: gcal_event_id. That column
// means "this task OWNS that event" — push sync deletes the event when the
// task completes and the dedupe path deletes it outright — so a budget-update
// task inheriting it would delete the actual flight off the calendar the
// moment it was ticked off. The link back to the source event lives in the
// fire ledger instead, where nothing acts on it.
export function buildTaskFromRule(rule, event, { id, now, captures = [] }) {
  const t = rule?.template || {}
  const rendered = renderTemplate(t.title, event, captures)
  // Every fallback below is for a template that rendered to nothing (a
  // {{match.1}} title against a regex with no groups). An untitled task is
  // unrecoverable noise; the event's own name is at least a lead.
  const title = rendered || renderTemplate(t.title, event, []) || event?.summary || 'Untitled'
  const due = t.due_offset_days == null ? null : shiftDate(eventDate(event), t.due_offset_days)
  return {
    id,
    title,
    status: 'not_started',
    notes: renderTemplate(t.notes, event, captures),
    due_date: due,
    tags: Array.isArray(t.tags) ? t.tags : [],
    size: t.size || null,
    high_priority: !!t.high_priority,
    nag_allowed: !!t.nag_allowed,
    capture_source: 'gcal_rule',
    created_at: now,
    last_touched: now,
  }
}

// --- validation ------------------------------------------------------------

// Throws with a message meant for the user, not a stack trace. Called on every
// write path so a malformed rule can never reach the poll loop.
export function normalizeRule(input) {
  const src = input || {}
  const name = String(src.name || '').trim()
  if (!name) throw new Error('Rule needs a name')

  const rawConditions = Array.isArray(src.conditions) ? src.conditions : []
  if (rawConditions.length === 0) throw new Error('Rule needs at least one condition — a rule with none matches every event on the calendar')

  const conditions = rawConditions.map((c, i) => {
    const field = String(c?.field || '').trim()
    const op = String(c?.op || '').trim()
    const value = String(c?.value ?? '').trim()
    if (!CONDITION_FIELDS.includes(field)) throw new Error(`Condition ${i + 1}: unknown field "${field}"`)
    if (!CONDITION_OPS.includes(op)) throw new Error(`Condition ${i + 1}: unknown operator "${op}"`)
    if (field === 'timing') {
      if (op !== 'is') throw new Error(`Condition ${i + 1}: timing only supports "is"`)
      if (!TIMING_VALUES.includes(value)) throw new Error(`Condition ${i + 1}: timing must be all_day or timed`)
    } else if (op === 'is') {
      throw new Error(`Condition ${i + 1}: "is" only applies to timing`)
    }
    if (!value) throw new Error(`Condition ${i + 1}: needs a value`)
    if (op === 'matches') {
      if (value.length > MAX_PATTERN_LENGTH) throw new Error(`Condition ${i + 1}: pattern is too long (max ${MAX_PATTERN_LENGTH})`)
      if (!compilePattern(value)) throw new Error(`Condition ${i + 1}: "${value}" is not a valid regular expression`)
    }
    return { field, op, value }
  })

  const t = src.template || {}
  const title = String(t.title || '').trim()
  if (!title) throw new Error('Rule needs a task title')

  let dueOffset = null
  if (t.due_offset_days != null && t.due_offset_days !== '') {
    dueOffset = Number(t.due_offset_days)
    if (!Number.isInteger(dueOffset) || dueOffset < -365 || dueOffset > 365) {
      throw new Error('Due offset must be a whole number of days between -365 and 365')
    }
  }

  const size = t.size && TEMPLATE_SIZES.includes(String(t.size).toUpperCase())
    ? String(t.size).toUpperCase()
    : null

  return {
    id: src.id ? String(src.id) : null,
    name,
    enabled: src.enabled !== false,
    calendar_id: src.calendar_id ? String(src.calendar_id) : null,
    conditions,
    template: {
      title,
      notes: String(t.notes || ''),
      due_offset_days: dueOffset,
      tags: Array.isArray(t.tags) ? t.tags.map(x => String(x).trim()).filter(Boolean) : [],
      size,
      high_priority: !!t.high_priority,
      nag_allowed: !!t.nag_allowed,
    },
    suppress_event_import: !!src.suppress_event_import,
    future_only: !!src.future_only,
    on_repeat: REPEAT_MODES.includes(src.on_repeat) ? src.on_repeat : 'stack',
  }
}

// The due date a task should carry once it covers one more event.
//
// Only ever EARLIER. Taking the newest event's date would walk the task to the
// far edge of the 30-day window every time a new flight appeared — so it would
// never come due, never surface, and the "collapse the repeats" option would
// quietly become "never see this task again". A silent deferral is something
// this codebase refuses to express anywhere else (resume_at is a floor, and a
// deferral is never written as a completion), and it isn't going to start here.
//
// So: the task is due for the SOONEST event it covers. An already-overdue task
// stays overdue — you still owe it.
export function soonestDueDate(existingDue, candidateDue) {
  if (!candidateDue) return existingDue || null
  if (!existingDue) return candidateDue
  return candidateDue < existingDue ? candidateDue : existingDue
}

// Every enabled rule that matches, in rule order. Used by the preview, the
// poll loop, and the suppression query so all three agree by construction.
export function rulesMatching(rules, event) {
  const out = []
  for (const rule of rules || []) {
    const m = matchEvent(rule, event)
    if (m.matched) out.push({ rule, captures: m.captures })
  }
  return out
}
