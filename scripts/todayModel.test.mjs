// Rules for the Kept 2.0 Today screen (src/todayModel.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTodayModel, normalizeEvents, recordNotNow, inQuietHours, NOT_NOW_MAX, ATTENTION_LIMIT,
} from '../src/todayModel.js'

// Tue Nov 10 2026, local time.
const at = (h, m = 0, d = 10) => new Date(2026, 10, d, h, m)
const iso = (h, m = 0, d = 10) => at(h, m, d).toISOString()
const TODAY = '2026-11-10'
const YESTERDAY = '2026-11-09'
const TOMORROW = '2026-11-11'

let n = 0
const task = (o = {}) => ({ id: `t${++n}`, title: `Task ${n}`, status: 'not_started', created_at: iso(8, 0, 1), ...o })
const model = (o = {}) => buildTodayModel({ now: at(6, 50), settings: {}, ...o })
const ids = (arr) => arr.map(x => (x.task || x).id)

// ── Needs attention ──────────────────────────────────────────────────────
test('attention: overdue, due today, reminder passed and back today each carry their reason', () => {
  const t1 = task({ due_date: TODAY })
  const t2 = task({ due_date: '2026-11-07' })
  const t3 = task({ remind_at: iso(6, 0) })
  const t4 = task({ snoozed_until: iso(6, 30) })
  const t5 = task({ due_date: '2026-11-13' })            // future: not attention
  const t6 = task({ remind_at: iso(16, 0) })             // later today: Coming up, not attention
  const m = model({ tasks: [t1, t2, t3, t4, t5, t6] })
  const byId = Object.fromEntries(m.attention.items.map(a => [a.task.id, a.reason.key]))
  assert.deepEqual(byId, { [t1.id]: 'due', [t2.id]: 'overdue', [t3.id]: 'reminder', [t4.id]: 'back' })
  assert.equal(m.attention.items.find(a => a.task.id === t2.id).reason.days, 3)
})

test('attention: critical first, then overdue, then due today', () => {
  const due = task({ due_date: TODAY, impact: 3 })
  const over = task({ due_date: YESTERDAY, impact: 1 })
  const crit = task({ tags: ['critical'] })
  const m = model({ tasks: [due, over, crit], isCrisis: t => (t.tags || []).includes('critical') })
  assert.deepEqual(ids(m.attention.items), [crit.id, over.id, due.id])
})

test('attention: capped, with an overflow count', () => {
  const ts = Array.from({ length: ATTENTION_LIMIT + 3 }, () => task({ due_date: TODAY }))
  const m = model({ tasks: ts })
  assert.equal(m.attention.items.length, ATTENTION_LIMIT)
  assert.equal(m.attention.overflow, 3)
})

test('attention: snoozed, done, child and project tasks never appear', () => {
  const ts = [
    task({ due_date: TODAY, snoozed_until: iso(12, 0) }),
    task({ due_date: TODAY, status: 'done' }),
    task({ due_date: TODAY, parent_id: 'p1' }),
    task({ due_date: TODAY, status: 'project' }),
  ]
  assert.equal(model({ tasks: ts }).attention.items.length, 0)
})

// ── Pending suggestions ──────────────────────────────────────────────────
test('pending Gmail suggestions appear only in the review count', () => {
  const g = task({ gmail_pending: true, gmail_message_id: 'm1', due_date: TODAY, impact: 3, remind_at: iso(15, 0) })
  const g2 = task({ gmail_pending: true, gmail_message_id: 'm2', due_date: TOMORROW })
  const m = model({ tasks: [g, g2], now: at(14, 0) })
  assert.equal(m.attention.items.length, 0)
  assert.equal(m.next, null)
  assert.equal(m.coming.items.length, 0)
  assert.equal(m.anytime.length, 0)
  assert.equal(m.review.count, 2)
  assert.equal(m.review.source, 'Gmail')
  assert.equal(m.allClear, false)
})

// ── Routines ─────────────────────────────────────────────────────────────
const morning = { id: 'r-morning', title: 'Morning', members: ['a', 'b', 'c', 'd'], trigger_time: '06:00', cadence: 'daily' }
const bedtime = { id: 'r-bed', title: 'Bedtime', members: ['a', 'b', 'c', 'd', 'e'], trigger_time: '20:00', cadence: 'daily' }
const member = (r, o = {}) => task({ routine_id: r.id, due_date: TODAY, ...o })
const caughtLately = (r) => member(r, { status: 'done', due_date: YESTERDAY, completed_at: iso(7, 0, 9) })

test('checklist: full inside its window with open members', () => {
  const ts = [member(morning, { status: 'done', completed_at: iso(6, 20) }), member(morning), member(morning), caughtLately(morning)]
  const m = model({ tasks: ts, routines: [morning] })
  assert.equal(m.checklists.length, 1)
  assert.equal(m.checklists[0].tier, 'full')
  assert.equal(m.checklists[0].open.length, 2)
  assert.equal(m.checklists[0].done, 1)
})

test('checklist: one line once its window has passed', () => {
  const ts = [member(morning), caughtLately(morning)]
  const m = model({ tasks: ts, routines: [morning], now: at(14, 17) })
  assert.equal(m.checklists[0].tier, 'line')
  assert.equal(m.checklists[0].note, 'left from this morning')
})

test('checklist: window ends at the next checklist trigger if that comes sooner', () => {
  const early = { ...bedtime, id: 'r-mid', title: 'Midmorning', trigger_time: '09:00' }
  const ts = [member(morning), caughtLately(morning)]
  assert.equal(model({ tasks: ts, routines: [morning, early], now: at(8, 30) }).checklists[0].tier, 'full')
  assert.equal(model({ tasks: ts, routines: [morning, early], now: at(9, 30) }).checklists[0].tier, 'line')
})

test('checklist: one line when a commitment starts within 20 minutes', () => {
  const ts = [member(morning), caughtLately(morning)]
  const events = normalizeEvents([{ id: 'e1', title: 'Flight with Marty', start: { dateTime: iso(7, 0) }, end: { dateTime: iso(9, 0) } }])
  const m = model({ tasks: ts, routines: [morning], events, now: at(6, 45) })
  assert.equal(m.checklists[0].tier, 'line')
})

test('checklist: dormant (nothing caught in 14 days) is one line, not hidden', () => {
  const m = model({ tasks: [member(morning)], routines: [morning] })
  assert.equal(m.checklists.length, 1)
  assert.equal(m.checklists[0].tier, 'line')
})

test('checklist: a cycle left from yesterday is one line', () => {
  const m = model({ tasks: [member(morning, { due_date: YESTERDAY }), caughtLately(morning)], routines: [morning] })
  assert.equal(m.checklists[0].tier, 'line')
  assert.equal(m.checklists[0].note, 'left from yesterday')
})

test('checklist: hidden before its trigger, and listed in Coming up instead', () => {
  const ts = [member(bedtime, { snoozed_until: iso(20, 0) }), member(bedtime, { snoozed_until: iso(20, 0) }), caughtLately(bedtime)]
  const m = model({ tasks: ts, routines: [bedtime], now: at(14, 0) })
  assert.equal(m.checklists.length, 0)
  const row = m.coming.items.find(i => i.kind === 'checklist')
  assert.equal(row.routine.id, bedtime.id)
  assert.equal(row.count, 2)
})

test('checklist: hidden when cleared, paused, ended, skipped today, resting or away', () => {
  const cleared = [member(morning, { status: 'done', completed_at: iso(6, 30) })]
  assert.equal(model({ tasks: cleared, routines: [morning] }).checklists.length, 0)
  const open = [member(morning), caughtLately(morning)]
  for (const r of [
    { ...morning, paused: true },
    { ...morning, end_date: '2026-11-01' },
    { ...morning, skipped_days: [TODAY] },
    { ...morning, resume_at: '2026-11-20' },
  ]) assert.equal(model({ tasks: open, routines: [r] }).checklists.length, 0, JSON.stringify(r))
  assert.equal(model({ tasks: open, routines: [morning], settings: { away_days: [TODAY] } }).checklists.length, 0)
})

test('loop tasks due today show under routines, never in Needs attention or Worth doing next', () => {
  const ifr = { id: 'r-ifr', title: 'IFR Studying', cadence: 'daily', trigger_time: '06:00' }
  const t = task({ routine_id: ifr.id, due_date: TODAY, impact: 3 })
  const m = model({ tasks: [t], routines: [ifr] })
  assert.deepEqual(ids(m.loopTasks), [t.id])
  assert.equal(m.attention.items.length, 0)
  assert.equal(m.next, null)
})

// ── Worth doing next ─────────────────────────────────────────────────────
test('next: only tasks that clear the bar (due within a week, high impact or high priority)', () => {
  const far = task({ due_date: '2026-11-25', impact: 2 })
  const plain = task({ impact: 2 })
  assert.equal(model({ tasks: [far, plain] }).next, null)
  const soon = task({ due_date: '2026-11-12' })
  assert.equal(model({ tasks: [far, plain, soon] }).next.task.id, soon.id)
  const hi = task({ impact: 3 })
  assert.ok(['due Thursday', 'high impact'].some(r => model({ tasks: [hi] }).next.reasons.includes(r)))
})

test('next: never duplicates Needs attention; waiting and loop tasks are not candidates', () => {
  const dueToday = task({ due_date: TODAY, impact: 3 })
  const waiting = task({ status: 'waiting', impact: 3 })
  const m = model({ tasks: [dueToday, waiting] })
  assert.equal(m.next, null)
})

test('next: reasons come from the ranking factors and the duration only from the task size', () => {
  const t = task({ due_date: TOMORROW, size: 'S' })
  const m = model({ tasks: [t] })
  assert.deepEqual(m.next.reasons, ['due tomorrow'])
  assert.equal(m.next.minutes, 30)
  const unsized = task({ due_date: TOMORROW })
  assert.equal(model({ tasks: [unsized] }).next.minutes, null)
})

test('next: a sized task longer than the time before the next commitment is skipped', () => {
  const events = normalizeEvents([{ id: 'e1', title: 'Flight with Marty', start: { dateTime: iso(8, 30) }, end: { dateTime: iso(10, 30) } }])
  const big = task({ title: 'IFR studying', impact: 3, size: 'L', due_date: TOMORROW })   // 120 min, ranks higher
  const small = task({ title: 'Mop canisters', size: 'S', due_date: TOMORROW })           // 30 min
  const m = model({ tasks: [big, small], events, now: at(6, 50) })                       // 100 min free
  assert.equal(m.next.task.id, small.id)
  assert.equal(m.next.fitsBefore.title, 'Flight with Marty')
})

test('next: an unsized task is offered but makes no claim about fitting', () => {
  const events = normalizeEvents([{ id: 'e1', title: 'Flight', start: { dateTime: iso(8, 30) }, end: { dateTime: iso(10, 30) } }])
  const t = task({ due_date: TOMORROW })
  const m = model({ tasks: [t], events })
  assert.equal(m.next.task.id, t.id)
  assert.equal(m.next.fitsBefore, null)
})

test('next: with no commitment ahead nothing is filtered by time', () => {
  const big = task({ size: 'XL', impact: 3 })
  assert.equal(model({ tasks: [big] }).next.task.id, big.id)
})

test('next: free calendar events never shorten the window', () => {
  const events = normalizeEvents([{ id: 'e1', title: 'Focus block', transparency: 'transparent', start: { dateTime: iso(7, 0) }, end: { dateTime: iso(8, 0) } }])
  const big = task({ size: 'L', impact: 3 })
  assert.equal(model({ tasks: [big], events }).next.task.id, big.id)
})

test('next: absent in quiet hours', () => {
  const t = task({ impact: 3 })
  const settings = { quiet_hours_enabled: true, quiet_hours_start: '22:00', quiet_hours_end: '08:00' }
  const m = model({ tasks: [t], settings, now: at(22, 41) })
  assert.equal(m.next, null)
  assert.equal(m.nextAbsent, 'quiet')
  assert.equal(model({ tasks: [t], settings, now: at(14, 0) }).next.task.id, t.id)
})

test('next: deterministic for the same input', () => {
  const ts = [task({ impact: 3 }), task({ impact: 3 }), task({ impact: 3 })]
  assert.equal(model({ tasks: ts }).next.task.id, model({ tasks: [...ts].reverse() }).next.task.id)
})

test('not now: hides that pick for the day, offers the next one that clears the bar', () => {
  const a = task({ impact: 3, due_date: TOMORROW })
  const b = task({ impact: 3 })
  const first = model({ tasks: [a, b] }).next
  const nn = recordNotNow(null, TODAY, first.task.id, first.reasonKey)
  const second = model({ tasks: [a, b], notNow: nn }).next
  assert.notEqual(second.task.id, first.task.id)
})

test('not now: comes back when its evidence changes', () => {
  const a = task({ impact: 3, due_date: '2026-11-13' })
  const first = model({ tasks: [a] }).next
  const nn = recordNotNow(null, TODAY, a.id, first.reasonKey)
  assert.equal(model({ tasks: [a], notNow: nn }).next, null)
  const changed = { ...a, due_date: TOMORROW }
  assert.equal(model({ tasks: [changed], notNow: nn }).next.task.id, a.id)
})

test('not now: after the daily limit the section rests until tomorrow', () => {
  const ts = Array.from({ length: 5 }, () => task({ impact: 3 }))
  let nn = null
  for (let i = 0; i < NOT_NOW_MAX; i++) {
    const p = model({ tasks: ts, notNow: nn }).next
    nn = recordNotNow(nn, TODAY, p.task.id, p.reasonKey)
  }
  const m = model({ tasks: ts, notNow: nn })
  assert.equal(m.next, null)
  assert.equal(m.nextAbsent, 'dismissed')
  // A new day starts fresh.
  assert.ok(model({ tasks: ts, notNow: nn, now: at(9, 0, 11) }).next)
})

// ── Coming up ────────────────────────────────────────────────────────────
test('coming up: events and reminders ahead today, in time order', () => {
  const events = normalizeEvents([
    { id: 'e1', title: 'Flight', start: { dateTime: iso(8, 30) }, end: { dateTime: iso(10, 30) }, location: "Hap's" },
    { id: 'e0', title: 'Already over', start: { dateTime: iso(5, 0) }, end: { dateTime: iso(6, 0) } },
    { id: 'e2', title: 'Holiday', start: { date: TODAY }, end: { date: TOMORROW } },
  ])
  const r = task({ title: 'TV off', remind_at: iso(19, 30) })
  const m = model({ tasks: [r], events })
  assert.equal(m.coming.label, 'Coming up')
  assert.deepEqual(m.coming.items.map(i => i.kind), ['event', 'reminder'])
  assert.equal(m.coming.items[0].event.location, "Hap's")
})

test('coming up: an event imported as a task is not listed twice', () => {
  const t = task({ gcal_event_id: 'e1', due_date: TODAY })
  const events = normalizeEvents([{ id: 'e1', title: 'Dentist', start: { dateTime: iso(15, 0) }, end: { dateTime: iso(16, 0) } }], [t])
  assert.equal(events.length, 0)
})

test('coming up: becomes Tomorrow once nothing is ahead today', () => {
  const r = task({ title: 'Pick up Camden', remind_at: iso(13, 30, 11) })
  const d = task({ title: 'Mop canisters', due_date: TOMORROW })
  const quiet = { quiet_hours_enabled: true, quiet_hours_start: '22:00', quiet_hours_end: '08:00' }
  const m = model({ tasks: [r, d], now: at(22, 41), settings: quiet })
  assert.equal(m.coming.label, 'Tomorrow')
  assert.deepEqual(ids(m.coming.items), [r.id, d.id])
  // Without quiet hours the due-tomorrow task is the recommendation, so it is not listed twice.
  const loud = model({ tasks: [r, d], now: at(22, 41) })
  assert.equal(loud.next.task.id, d.id)
  assert.deepEqual(ids(loud.coming.items), [r.id])
})

test('coming up: a snoozed task returning later today is listed, not hidden', () => {
  const t = task({ snoozed_until: iso(15, 0) })
  const m = model({ tasks: [t], now: at(9, 0) })
  assert.equal(m.coming.items[0].kind, 'returns')
})

// ── All clear ────────────────────────────────────────────────────────────
test('all clear: only when nothing needs you; fixed items still show', () => {
  const r = task({ remind_at: iso(19, 30) })
  const m = model({ tasks: [r], now: at(10, 12) })
  assert.equal(m.allClear, true)
  assert.equal(m.coming.items.length, 1)
  assert.equal(model({ tasks: [r, task({ due_date: TODAY })], now: at(10, 12) }).allClear, false)
})

// ── Purity ───────────────────────────────────────────────────────────────
test('the model never changes its inputs', () => {
  const ts = [task({ due_date: TODAY }), task({ impact: 3, size: 'S' }), member(morning), caughtLately(morning)]
  const before = JSON.stringify(ts)
  model({ tasks: ts, routines: [morning] })
  assert.equal(JSON.stringify(ts), before)
})

test('quiet hours wrap past midnight', () => {
  const s = { quiet_hours_enabled: true, quiet_hours_start: '22:00', quiet_hours_end: '08:00' }
  assert.equal(inQuietHours(s, at(23, 0)), true)
  assert.equal(inQuietHours(s, at(7, 59)), true)
  assert.equal(inQuietHours(s, at(8, 0)), false)
  assert.equal(inQuietHours({ ...s, quiet_hours_enabled: false }, at(23, 0)), false)
})
