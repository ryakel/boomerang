// Calendar blocks (BOOM-57): "one block = one priority that needs focus time".
// A task asks for ONE Google Calendar event at a time you choose. Pure: events,
// `now` and the task in; slots, the event resource and labels out. The device's
// own timezone is the clock, the same one Today reads events in.
//
// The event is the task's own (block_event_id), never `gcal_event_id`: that
// column means "imported from / owns" and drives import identity, the dedupe
// sweep and Today HIDING the event. A block has to stay visible on Today.

export const BLOCK_LENGTHS = [30, 60, 90]
// Sent after a block is added, moved or removed, so Today re-reads the calendar.
export const CALENDAR_CHANGED = 'boom-calendar-changed'
const STEP_MIN = 15
// The hours a suggestion may fall in. A chosen time can be anything.
const DAY_FROM_HOUR = 8
const DAY_TO_HOUR = 20
const TOMORROW_FROM_HOUR = 9

const MIN = 60000
const pad = (n) => String(n).padStart(2, '0')
export const dayKeyOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const atHour = (dayMs, h) => { const d = new Date(dayMs); d.setHours(h, 0, 0, 0); return d.getTime() }
const ceilStep = (ms) => Math.ceil(ms / (STEP_MIN * MIN)) * STEP_MIN * MIN

// A sensible first length from the task's size. The user can pick another.
export function defaultBlockMinutes(task) {
  const size = task?.size
  if (size === 'L' || size === 'XL') return 90
  if (size === 'M') return 60
  return 30
}

// Free starting times for a block of `minutes`, from normalized events (the
// shape todayModel.normalizeEvents returns: busy, startMs, endMs). Today from
// now (rounded up to the quarter hour) until 8 PM; if today has fewer than
// two, tomorrow from 9 AM. Free ("transparent") events don't claim time. A
// block of this same task is ignored, so moving a block can reuse its slot.
export function suggestSlots({ events = [], now, minutes, ignoreEventId = null, max = 3 }) {
  const len = minutes * MIN
  const busy = (events || []).filter(e => e && e.busy && e.startMs != null && e.endMs != null && e.id !== ignoreEventId)
    .map(e => [e.startMs, e.endMs]).sort((a, b) => a[0] - b[0])
  const scan = (from, to) => {
    const out = []
    let t = ceilStep(from)
    while (t + len <= to && out.length < max) {
      const clash = busy.find(([s, e]) => s < t + len && e > t)
      if (clash) { t = ceilStep(clash[1]); continue }
      out.push({ startMs: t, endMs: t + len })
      t += len
    }
    return out
  }
  const today = scan(Math.max(now, atHour(now, DAY_FROM_HOUR)), atHour(now, DAY_TO_HOUR))
  if (today.length >= 2) return today.slice(0, max)
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1)
  const t2 = scan(atHour(tomorrow.getTime(), TOMORROW_FROM_HOUR), atHour(tomorrow.getTime(), DAY_TO_HOUR))
  return [...today, ...t2].slice(0, max)
}

// The Google Calendar event for a block. The description carries "Managed by
// Boomerang": pull sync skips anything with it (a block must never come back
// as a task) and Settings' bulk clean-up can find it.
export function blockEvent(task, { startMs, minutes, timeZone }) {
  const notes = (task.notes || '').trim()
  return {
    summary: task.title,
    description: `${notes ? notes + '\n\n' : ''}Focus block for a Boomerang task.\n---\nManaged by Boomerang`,
    start: { dateTime: new Date(startMs).toISOString(), timeZone },
    end: { dateTime: new Date(startMs + minutes * MIN).toISOString(), timeZone },
    transparency: 'opaque',
    extendedProperties: { private: { boomerangBlock: task.id } },
  }
}

// The task fields a block sets, and the ones removing it clears.
export const blockFields = ({ eventId, calendarId, startMs, minutes }) => ({
  block_event_id: eventId, block_calendar_id: calendarId,
  block_start: new Date(startMs).toISOString(), block_minutes: minutes,
})
export const NO_BLOCK = { block_event_id: null, block_calendar_id: null, block_start: null, block_minutes: null }

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
// "Today 2:00–3:00 PM", "Tomorrow 9:00–9:30 AM", "Thu Nov 27 2:00–3:30 PM".
export function slotLabel(startMs, minutes, now) {
  const endMs = startMs + minutes * MIN
  const day = dayKeyOf(startMs)
  const t = new Date(now); const today = dayKeyOf(now)
  t.setDate(t.getDate() + 1)
  const when = day === today ? 'Today' : day === dayKeyOf(t.getTime()) ? 'Tomorrow'
    : new Date(startMs).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const a = clock(startMs), b = clock(endMs)
  // "2:00–3:00 PM" rather than "2:00 PM–3:00 PM" when both share AM/PM.
  const sa = a.slice(-2), sb = b.slice(-2)
  return `${when} ${sa === sb && /[AP]M$/.test(a) ? a.slice(0, -3) : a}–${b}`
}

// What a task's block reads as on its chip, or null. A block that has ended
// still reads as when it was, so the record stays visible.
export function blockLabel(task, now) {
  if (!task?.block_event_id || !task.block_start) return null
  const start = Date.parse(task.block_start)
  if (!Number.isFinite(start)) return null
  return slotLabel(start, task.block_minutes || 30, now)
}
