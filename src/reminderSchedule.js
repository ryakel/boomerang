// reminderSchedule.js — what the DEVICE should have scheduled as local
// notifications. Pure: no native calls, no network, clock injected.
//
// WHY LOCAL AND NOT PUSH: a local notification is handed to iOS ahead of time
// and fired by the device — no network, no VPN, no server, works in airplane
// mode. The server owns the schedule; the device caches it and rings from the
// cache. Staleness is bounded by the last successful sync, which is honest:
// what it got is correct, it just might not know about something added since.
// That is the property that makes a 7:30pm reminder survive a fortnight abroad
// with a laptop-shaped server sitting at home behind a VPN.
//
// WHY THE PLAN IS PURE: iOS caps PENDING local notifications at 64 per app, so
// something has to decide what makes the cut, what repeats, and what is
// dropped. That decision is the whole feature, and it is far easier to get
// wrong than to write. It lives here so it can be tested without a phone.

// Apple's hard ceiling on pending notification requests per app.
export const IOS_PENDING_CAP = 64

const ACTIVE = new Set(['not_started', 'doing', 'waiting'])

// A cadence that iOS can express as ONE repeating calendar trigger. Those cost
// a single slot and fire forever, which is what makes the offline horizon
// effectively unbounded — 30 nights of a daily loop is 1 slot, not 30.
// Anything else has to be enumerated as individual occurrences.
function repeatShape(routine) {
  const c = String(routine?.cadence || '').toLowerCase()
  if (c === 'daily') return { kind: 'daily' }
  if (c === 'weekly') {
    const dow = routine.schedule_day_of_week
    // iOS weekday is 1=Sunday..7=Saturday; the app stores 0=Sunday..6=Saturday.
    if (dow != null && dow >= 0 && dow <= 6) return { kind: 'weekly', weekday: dow + 1 }
  }
  return null
}

function parseClock(triggerTime) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(triggerTime || ''))
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

/**
 * planLocalReminders({ tasks, routines, now })
 *
 * Returns { schedule, dropped, repeating, once } where `schedule` is what the
 * device should hold, already capped and ordered.
 *
 * Each entry:
 *   { id, title, body, taskId?, routineId?,
 *     kind: 'once' | 'daily' | 'weekly',
 *     fireAt?  (ISO, 'once' only),
 *     hour, minute, weekday? }
 *
 * `id` is STABLE and derived from what it represents, so re-planning and
 * re-scheduling is idempotent: the device replaces by id rather than stacking
 * a second copy of the same alarm every time the app opens.
 */
export function planLocalReminders({ tasks = [], routines = [], now = Date.now() } = {}) {
  const repeating = []
  const once = []

  // --- Loops that ring -----------------------------------------------------
  // These come FIRST and are never dropped by the cap: a recurring alarm is
  // the thing most likely to matter (pills, a nightly chore) and it costs one
  // slot no matter how far out it runs. Sacrificing it to make room for a
  // one-off next Tuesday would be exactly backwards.
  const ringingRoutineIds = new Set()
  for (const r of routines) {
    if (!r?.id || !r.remind) continue
    const clock = parseClock(r.trigger_time)
    if (!clock) continue
    const shape = repeatShape(r)
    if (!shape) continue // enumerated below via its spawned tasks instead
    ringingRoutineIds.add(String(r.id))
    repeating.push({
      id: `loop:${r.id}`,
      routineId: String(r.id),
      title: String(r.title || 'Reminder'),
      body: 'Time for this one.',
      kind: shape.kind,
      hour: clock.hour,
      minute: clock.minute,
      ...(shape.weekday ? { weekday: shape.weekday } : {}),
    })
  }

  // --- One-off task reminders ---------------------------------------------
  for (const t of tasks) {
    if (!t?.id || !t.remind_at) continue
    if (!ACTIVE.has(t.status)) continue
    // A task spawned by a loop that already has a repeating trigger would be a
    // SECOND alarm for the same moment — the user would be told twice.
    if (t.routine_id && ringingRoutineIds.has(String(t.routine_id))) continue
    const at = Date.parse(t.remind_at)
    if (Number.isNaN(at)) continue
    // A moment that has already passed cannot be scheduled — iOS silently
    // discards a past trigger, and pretending otherwise would report a count
    // that does not match what the device holds.
    if (at <= now) continue
    const d = new Date(at)
    once.push({
      id: `task:${t.id}`,
      taskId: String(t.id),
      title: String(t.title || 'Reminder'),
      body: 'Time for this one.',
      kind: 'once',
      fireAt: new Date(at).toISOString(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      _at: at,
    })
  }

  once.sort((a, b) => a._at - b._at)

  // --- The cap -------------------------------------------------------------
  const room = Math.max(0, IOS_PENDING_CAP - repeating.length)
  // `_at` is a sort key, not part of the contract — strip it before anything
  // downstream sees it, so the shape handed to the device is exactly the shape
  // the tests assert.
  const strip = (e) => { const out = { ...e }; delete out._at; return out }
  const keptOnce = once.slice(0, room)
  const dropped = once.slice(room).map(strip)

  const schedule = [...repeating, ...keptOnce].map(strip)

  return {
    schedule,
    dropped,          // reported, never silent — see localReminders.js
    repeating: repeating.length,
    once: keptOnce.length,
  }
}
