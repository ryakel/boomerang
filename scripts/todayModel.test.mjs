// Kept 2.0 Today (src/todayModel.js).
//
// The first block is SCENARIOS: what the screen should do for a person at a
// given moment, written from the complaints that shaped it (2026-11-10, a
// 9:39 PM screen that opened on seven overdue chores). They check outcomes —
// what's first, what's absent, what appears once — not which rule fired.
// They do not prove the screen is intelligent; they prove it no longer does
// the specific unhelpful things it was caught doing. The rule tests follow.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTodayModel, normalizeEvents, recordNotNow, inQuietHours, dayPhase, eveningStart,
  NOT_NOW_MAX, ATTENTION_LIMIT,
} from '../src/todayModel.js'

// Tue Nov 10 2026, local time.
const at = (h, m = 0, d = 10) => new Date(2026, 10, d, h, m)
const iso = (h, m = 0, d = 10) => at(h, m, d).toISOString()
const TODAY = '2026-11-10'
const YESTERDAY = '2026-11-09'
const TOMORROW = '2026-11-11'
const daysAgo = (k) => `2026-11-${String(10 - k).padStart(2, '0')}`

let n = 0
const task = (o = {}) => ({ id: `t${++n}`, title: `Task ${n}`, status: 'not_started', created_at: iso(8, 0, 1), last_touched: iso(8, 0, 1), ...o })
const model = (o = {}) => buildTodayModel({ now: at(6, 50), settings: {}, ...o })
const ids = (arr) => arr.map(x => (x.task || x).id)

// Every place a task can be shown on Today, with how prominent it is.
function appearances(m, id) {
  const where = []
  if (m.attention.items.some(a => a.task.id === id)) where.push('attention')
  if (m.next?.task.id === id) where.push('next')
  if (m.later.items.some(i => i.task?.id === id)) where.push('later')
  if (m.tomorrow.items.some(i => i.task?.id === id)) where.push('tomorrow')
  if (m.lastNight.some(r => r.task.id === id)) where.push('lastNight')
  if (m.loopTasks.some(l => l.task.id === id)) where.push('loops')
  if (m.checklists.some(c => c.open.some(t => t.id === id))) where.push('checklist')
  if (m.needsReview.slipped.some(s => s.task.id === id) || m.needsReview.waiting.some(w => w.task.id === id)) where.push('review')
  return where
}
const bedtime = { id: 'r-bed', title: 'Bedtime', members: ['a', 'b', 'c', 'd', 'e'], trigger_time: '21:00', cadence: 'daily' }

// The dev screen that started this: ten days of admin, a Last night queue, a
// waiting task, and an undated "high impact" chore recommended at 9:39 PM.
function eveningWorld() {
  n = 0
  const overdue = [
    task({ title: 'deal with the insurance claim', due_date: daysAgo(6), high_priority: true, size: 'XL' }),
    task({ title: 'schedule annual physical', due_date: daysAgo(8) }),
    task({ title: 'call dentist about that weird bill', due_date: daysAgo(10) }),
    task({ title: 'renew registration', due_date: daysAgo(4) }),
    task({ title: 'cancel the gym trial', due_date: daysAgo(2) }),
    task({ title: 'return amazon package', due_date: YESTERDAY, size: 'S', created_at: iso(9, 0, 1) }),
  ]
  const plumber = task({ title: 'waiting for the plumber estimate', status: 'waiting', due_date: daysAgo(3), last_touched: iso(9, 0, 1) })
  const mom = task({ title: 'that thing mom asked me to do', impact: 3, impact_inferred: true, size: 'M' })
  const bed = ['Polish sink', 'Pour milk', 'Lock doors', 'Take out trash', 'Start dishwasher']
    .map(title => task({ title, routine_id: bedtime.id, due_date: TODAY, created_at: iso(0, 5) }))
  const caught = task({ routine_id: bedtime.id, status: 'done', due_date: YESTERDAY, completed_at: iso(22, 0, 9) })
  const party = task({ title: 'pack items for class party', due_date: TOMORROW, size: 'S' })
  const pharmacy = task({ title: 'call the pharmacy', remind_at: iso(9, 0, 11) })
  return { overdue, plumber, mom, party, pharmacy, tasks: [...overdue, plumber, mom, ...bed, caught, party, pharmacy] }
}

// ── Scenarios ────────────────────────────────────────────────────────────
test('9:39 PM: tonight and tomorrow lead; ten days of slipped admin is one quiet row', () => {
  const w = eveningWorld()
  const m = model({ tasks: w.tasks, routines: [bedtime], now: at(21, 39) })
  assert.equal(m.phase, 'evening')
  assert.equal(m.attention.items.length, 0, 'nothing here genuinely needs intervention tonight')
  assert.equal(m.checklists[0]?.routine.id, bedtime.id)
  assert.equal(m.checklists[0].tier, 'full')
  assert.ok(m.order.indexOf('checklists') < m.order.indexOf('tomorrow'))
  assert.ok(m.order.indexOf('tomorrow') < m.order.indexOf('quiet'))
  assert.deepEqual(ids(m.tomorrow.items).sort(), [w.party.id, w.pharmacy.id].sort())
  // The overdue list becomes a review, oldest first, with nothing marked late on the main path.
  assert.equal(m.needsReview.slipped.length, w.overdue.length)
  assert.equal(m.needsReview.slipped[0].task.title, 'call dentist about that weird bill')
})

test('9:39 PM: nothing is pushed at you; tomorrow\'s small task is listed under Tomorrow, not recommended', () => {
  const w = eveningWorld()
  const m = model({ tasks: w.tasks, routines: [bedtime], now: at(21, 39) })
  assert.equal(m.next, null)
  assert.equal(m.nextAbsent, 'evening')
  assert.deepEqual(appearances(m, w.party.id), ['tomorrow'])
})

test('2 PM: an undated "high impact" chore is not recommended; with no time evidence, nothing is', () => {
  const w = eveningWorld()
  const m = model({ tasks: w.tasks.filter(t => t.id !== w.party.id), routines: [bedtime], now: at(14, 0) })
  assert.equal(m.next, null)
  assert.equal(m.nextAbsent, 'none')
})

test('the evening still surfaces something genuinely urgent, first', () => {
  const w = eveningWorld()
  const crit = task({ title: 'pipe is leaking', tags: ['critical'] })
  const dueTonight = task({ title: 'submit the form', due_date: TODAY })
  const m = model({ tasks: [...w.tasks, crit, dueTonight], routines: [bedtime], now: at(21, 39),
    isCrisis: t => (t.tags || []).includes('critical') })
  assert.deepEqual(ids(m.attention.items), [crit.id, dueTonight.id])
  assert.equal(m.order[0], 'attention')
})

test('an obligation is shown once: Last night items leave Needs attention and the review', () => {
  n = 0
  const ret = task({ title: 'return amazon package', due_date: YESTERDAY, high_priority: true, created_at: iso(9, 0, 1) })
  const m = model({ tasks: [ret], now: at(8, 0) })
  assert.deepEqual(appearances(m, ret.id), ['lastNight'])
  // Once Last night is dismissed (or it's evening), it lives in exactly one other place.
  const hidden = model({ tasks: [ret], now: at(8, 0), lastNightHidden: true })
  assert.deepEqual(appearances(hidden, ret.id), ['attention'])
  const evening = model({ tasks: [ret], now: at(21, 39) })
  assert.equal(evening.lastNight.length, 0, 'Last night is bookkeeping about yesterday, not an evening interruption')
  assert.equal(appearances(evening, ret.id).length, 1)
})

test('no task appears in two places on the 9:39 PM screen', () => {
  const w = eveningWorld()
  const m = model({ tasks: w.tasks, routines: [bedtime], now: at(21, 39) })
  for (const t of w.tasks) assert.ok(appearances(m, t.id).length <= 1, `${t.title}: ${appearances(m, t.id)}`)
})

test('8:24 AM before a 10:00 commitment: one thing to handle, one thing that fits, what\'s next', () => {
  n = 0
  const events = normalizeEvents([{ id: 'e1', title: 'Team sync', start: { dateTime: iso(10, 0) }, end: { dateTime: iso(10, 30) } }])
  const confirm = task({ title: 'Confirm YipitData call', due_date: TODAY })
  const budget = task({ title: 'Update flight budget spreadsheet', due_date: TOMORROW, size: 'S' })
  const ifr = task({ title: 'IFR studying', due_date: '2026-11-12', size: 'L' })     // 2 hr: doesn't fit before 10
  const mom = task({ title: 'that thing mom asked me to do', impact: 3, size: 'M' })
  const old = [4, 6, 9, 12, 20].map(d => task({ due_date: `2026-${d > 9 ? '10' : '11'}-${String(d > 9 ? 31 - (d - 10) : 10 - d).padStart(2, '0')}` }))
  const m = model({ tasks: [confirm, budget, ifr, mom, ...old], events, now: at(8, 24) })
  assert.equal(m.phase, 'morning')
  assert.deepEqual(m.order.slice(0, 3), ['attention', 'next', 'later'])
  assert.deepEqual(ids(m.attention.items), [confirm.id])
  assert.equal(m.next.task.id, budget.id)
  assert.equal(m.next.fitsBefore.title, 'Team sync')
  assert.deepEqual(m.next.reasons, ['due tomorrow'])
  assert.equal(m.later.items[0].event.title, 'Team sync')
  assert.equal(m.needsReview.slipped.length, old.length)
})

test('waiting on someone never asks you to act; after a week it is offered as a check-in', () => {
  n = 0
  const fresh = task({ status: 'waiting', due_date: YESTERDAY, waiting_at: iso(9, 0, 8), high_priority: true, created_at: iso(9, 0, 1) })
  const long = task({ status: 'waiting', waiting_at: iso(9, 0, 1) })
  const m = model({ tasks: [fresh, long], now: at(9, 0) })
  assert.equal(m.attention.items.length, 0)
  assert.equal(m.next, null)
  assert.deepEqual(appearances(m, fresh.id), [])
  assert.deepEqual(m.needsReview.waiting.map(w => [w.task.id, w.days]), [[long.id, 9]])
})

test('a day with nothing due is all clear, even with old things to review', () => {
  n = 0
  const ts = [task({ due_date: daysAgo(5) }), task({ due_date: daysAgo(9) }), task({ impact: 3 })]
  const m = model({ tasks: ts, now: at(14, 0) })
  assert.equal(m.allClear, true)
  assert.equal(m.needsReview.count, 2)
})

// ── Time of day ──────────────────────────────────────────────────────────
test('evening starts by 8 PM; an earlier evening checklist or quiet hours bring it forward, never later', () => {
  // 2026-11-10: the dev seed's quiet hours start at 22:00, and treating that as
  // the start of the evening left 9:39 PM looking like the middle of the day.
  assert.equal(eveningStart([], {}), 20 * 60)
  assert.equal(eveningStart([bedtime], {}), 20 * 60)
  assert.equal(eveningStart([], { quiet_hours_enabled: true, quiet_hours_start: '22:00' }), 20 * 60)
  assert.equal(eveningStart([{ ...bedtime, trigger_time: '18:30' }], {}), 18 * 60 + 30)
  assert.equal(eveningStart([], { quiet_hours_enabled: true, quiet_hours_start: '19:00' }), 19 * 60)
  assert.equal(dayPhase([bedtime], {}, at(19, 30)), 'day')
  assert.equal(dayPhase([bedtime], { quiet_hours_enabled: true, quiet_hours_start: '22:00' }, at(21, 39)), 'evening')
  assert.equal(dayPhase([], {}, at(2, 0)), 'evening')
  assert.equal(dayPhase([], {}, at(9, 0)), 'morning')
})

// ── Needs attention rules ────────────────────────────────────────────────
test('attention: only explicit signals qualify', () => {
  const due = task({ due_date: TODAY })
  const picked = task({ committed_on: TODAY })
  const rem = task({ remind_at: iso(6, 0) })
  const back = task({ snoozed_until: iso(6, 30) })
  const recentMarked = task({ due_date: YESTERDAY, nag_allowed: true })
  const recentPlain = task({ due_date: YESTERDAY })            // slipped, not attention
  const old = task({ due_date: daysAgo(3), high_priority: true }) // slipped: past "recent"
  const oldReminder = task({ remind_at: iso(9, 0, 8) })          // went off two days ago: slipped
  const future = task({ due_date: '2026-11-13' })
  const later = task({ remind_at: iso(16, 0) })
  // Last night hidden, so yesterday's items are judged here rather than asked about there.
  const m = model({ tasks: [due, picked, rem, back, recentMarked, recentPlain, old, oldReminder, future, later], now: at(6, 50), lastNightHidden: true })
  assert.equal(m.attention.items.length + m.attention.overflow, 5)
  assert.equal(m.attention.items.length, ATTENTION_LIMIT)
  assert.deepEqual(ids(m.needsReview.slipped).sort(), [recentPlain.id, old.id, oldReminder.id].sort())
  for (const t of [future, later]) assert.deepEqual(appearances(m, t.id).filter(w => w === 'attention'), [])
})

test('attention: critical first, then a reminder that just went off, then due today', () => {
  const due = task({ due_date: TODAY, impact: 3 })
  const rem = task({ remind_at: iso(6, 30) })
  const crit = task({ tags: ['critical'] })
  const m = model({ tasks: [due, rem, crit], isCrisis: t => (t.tags || []).includes('critical') })
  assert.deepEqual(ids(m.attention.items), [crit.id, rem.id, due.id])
})

test('attention: capped, with an honest overflow count', () => {
  const ts = Array.from({ length: ATTENTION_LIMIT + 2 }, () => task({ due_date: TODAY }))
  const m = model({ tasks: ts })
  assert.equal(m.attention.items.length, ATTENTION_LIMIT)
  assert.equal(m.attention.overflow, 2)
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
  const g3 = task({ gmail_pending: true, gmail_message_id: 'm3', due_date: daysAgo(4) })
  const m = model({ tasks: [g, g2, g3], now: at(14, 0) })
  assert.equal(m.attention.items.length, 0)
  assert.equal(m.next, null)
  assert.equal(m.later.items.length, 0)
  assert.equal(m.tomorrow.items.length, 0)
  assert.equal(m.needsReview.count, 0)
  assert.equal(m.anytime.length, 0)
  assert.equal(m.review.count, 3)
  assert.equal(m.review.source, 'Gmail')
})

// ── Routines ─────────────────────────────────────────────────────────────
const morning = { id: 'r-morning', title: 'Morning', members: ['a', 'b', 'c', 'd'], trigger_time: '06:00', cadence: 'daily' }
// Spawned this morning, as the loop engine does; an instance carried over from
// yesterday is Last night's question (creditYesterday.js), not the checklist's.
const member = (r, o = {}) => task({ routine_id: r.id, due_date: TODAY, created_at: iso(0, 5), ...o })
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
  assert.equal(m.checklists[0].note, 'from this morning')
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
  const m = model({ tasks: [member(morning, { due_date: YESTERDAY, created_at: iso(0, 5, 9) }), caughtLately(morning)], routines: [morning], lastNightHidden: true })
  assert.equal(m.checklists[0].tier, 'line')
  assert.equal(m.checklists[0].note, 'from yesterday')
})

test('checklist: hidden before its trigger, and listed in Coming up instead', () => {
  const ts = [member(bedtime, { snoozed_until: iso(20, 0) }), member(bedtime, { snoozed_until: iso(20, 0) }), caughtLately(bedtime)]
  const m = model({ tasks: ts, routines: [bedtime], now: at(14, 0) })
  assert.equal(m.checklists.length, 0)
  const row = m.later.items.find(i => i.kind === 'checklist')
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
  const t = task({ routine_id: ifr.id, due_date: TODAY, impact: 3, created_at: iso(0, 5) })
  const m = model({ tasks: [t], routines: [ifr] })
  assert.deepEqual(ids(m.loopTasks), [t.id])
  assert.equal(m.attention.items.length, 0)
  assert.equal(m.next, null)
})

test('yesterday\'s leftovers shown in Last night are not listed again as a checklist', () => {
  const left = member(bedtime, { due_date: YESTERDAY, created_at: iso(19, 0, 9) })
  const ts = [left, caughtLately(bedtime)]
  const withList = model({ tasks: ts, routines: [bedtime], now: at(7, 0) })
  assert.ok(withList.lastNight.some(r => r.task.id === left.id))
  assert.equal(withList.checklists.length, 0)
  const hidden = model({ tasks: ts, routines: [bedtime], now: at(7, 0), lastNightHidden: true })
  assert.equal(hidden.checklists[0].note, 'from yesterday')
})

// ── Worth doing next ─────────────────────────────────────────────────────
test('next: needs a reason about time — due in the next few days, or picked for today', () => {
  const far = task({ due_date: '2026-11-25', impact: 3 })
  const important = task({ impact: 3, high_priority: true })      // important, undated: not a reason
  assert.equal(model({ tasks: [far, important] }).next, null)
  const soon = task({ due_date: '2026-11-12' })
  assert.equal(model({ tasks: [far, important, soon] }).next.task.id, soon.id)
  const picked = task({ committed_on: TODAY, due_date: '2026-11-20' })
  const m = model({ tasks: [soon, picked] })
  assert.equal(m.next.task.id, picked.id)
  assert.deepEqual(m.next.reasons, ['you picked it for today'])
})

test('next: sooner beats more important; impact only breaks ties', () => {
  const big = task({ due_date: '2026-11-13', impact: 3, high_priority: true })
  const soon = task({ due_date: TOMORROW, impact: 1 })
  assert.equal(model({ tasks: [big, soon] }).next.task.id, soon.id)
  const tieLow = task({ due_date: '2026-11-12', impact: 1 })
  const tieHigh = task({ due_date: '2026-11-12', impact: 3 })
  assert.equal(model({ tasks: [tieLow, tieHigh] }).next.task.id, tieHigh.id)
})

test('next: "high impact" is never given as the reason', () => {
  const t = task({ due_date: TOMORROW, impact: 3, high_priority: true })
  const r = model({ tasks: [t] }).next.reasons
  assert.ok(!r.includes('high impact'))
  assert.deepEqual(r, ['due tomorrow', 'marked high priority'])
})

test('next: overdue, waiting, loop and attention tasks are not candidates', () => {
  const ts = [
    task({ due_date: YESTERDAY, impact: 3 }),
    task({ status: 'waiting', due_date: TOMORROW }),
    task({ due_date: TODAY }),
  ]
  assert.equal(model({ tasks: ts }).next, null)
})

test('next: never in the evening, even for something small that is due tomorrow', () => {
  const small = task({ due_date: TOMORROW, size: 'XS' })
  assert.equal(model({ tasks: [small], now: at(21, 0) }).next, null)
  assert.equal(model({ tasks: [small], now: at(15, 0) }).next.task.id, small.id)
})

test('next: duration only from the task size', () => {
  const t = task({ due_date: TOMORROW, size: 'S' })
  assert.equal(model({ tasks: [t] }).next.minutes, 30)
  assert.equal(model({ tasks: [task({ due_date: TOMORROW })] }).next.minutes, null)
})

test('next: a sized task longer than the time before the next commitment is skipped', () => {
  const events = normalizeEvents([{ id: 'e1', title: 'Flight with Marty', start: { dateTime: iso(8, 30) }, end: { dateTime: iso(10, 30) } }])
  const big = task({ title: 'IFR studying', size: 'L', due_date: TOMORROW })
  const small = task({ title: 'Mop canisters', size: 'S', due_date: '2026-11-12' })
  const m = model({ tasks: [big, small], events, now: at(6, 50) })
  assert.equal(m.next.task.id, small.id)
  assert.equal(m.next.fitsBefore.title, 'Flight with Marty')
})

test('next: an unsized task makes no claim about fitting; free events never shorten the window', () => {
  const flight = normalizeEvents([{ id: 'e1', title: 'Flight', start: { dateTime: iso(8, 30) }, end: { dateTime: iso(10, 30) } }])
  const t = task({ due_date: TOMORROW })
  assert.equal(model({ tasks: [t], events: flight }).next.fitsBefore, null)
  const focus = normalizeEvents([{ id: 'e2', title: 'Focus', transparency: 'transparent', start: { dateTime: iso(7, 0) }, end: { dateTime: iso(8, 0) } }])
  const big = task({ size: 'L', due_date: TOMORROW })
  assert.equal(model({ tasks: [big], events: focus }).next.task.id, big.id)
})

test('next: absent in quiet hours', () => {
  const t = task({ due_date: TOMORROW, size: 'XS' })
  const settings = { quiet_hours_enabled: true, quiet_hours_start: '22:00', quiet_hours_end: '08:00' }
  // Quiet hours that start before the evening does (an early-morning window).
  const early = { quiet_hours_enabled: true, quiet_hours_start: '05:00', quiet_hours_end: '09:00' }
  const m = model({ tasks: [t], settings: early, now: at(7, 0) })
  assert.equal(m.next, null)
  assert.equal(m.nextAbsent, 'quiet')
  assert.equal(model({ tasks: [t], settings, now: at(10, 0) }).next.task.id, t.id)
})

test('next: deterministic for the same input', () => {
  const ts = [task({ due_date: TOMORROW }), task({ due_date: TOMORROW }), task({ due_date: TOMORROW })]
  assert.equal(model({ tasks: ts }).next.task.id, model({ tasks: [...ts].reverse() }).next.task.id)
})

test('not now: hides that pick for the day and offers the next one with evidence', () => {
  const a = task({ due_date: TOMORROW })
  const b = task({ due_date: '2026-11-12' })
  const first = model({ tasks: [a, b] }).next
  const nn = recordNotNow(null, TODAY, first.task.id, first.reasonKey)
  assert.equal(model({ tasks: [a, b], notNow: nn }).next.task.id, b.id)
})

test('not now: comes back when its evidence changes', () => {
  const a = task({ due_date: '2026-11-13' })
  const first = model({ tasks: [a] }).next
  const nn = recordNotNow(null, TODAY, a.id, first.reasonKey)
  assert.equal(model({ tasks: [a], notNow: nn }).next, null)
  assert.equal(model({ tasks: [{ ...a, due_date: TOMORROW }], notNow: nn }).next.task.id, a.id)
})

test('not now: after the daily limit the section rests until tomorrow', () => {
  const ts = Array.from({ length: 5 }, () => task({ due_date: '2026-11-12' }))
  let nn = null
  for (let i = 0; i < NOT_NOW_MAX; i++) {
    const p = model({ tasks: ts, notNow: nn }).next
    nn = recordNotNow(nn, TODAY, p.task.id, p.reasonKey)
  }
  const m = model({ tasks: ts, notNow: nn })
  assert.equal(m.next, null)
  assert.equal(m.nextAbsent, 'dismissed')
  assert.ok(model({ tasks: ts, notNow: nn, now: at(9, 0, 11) }).next)
})

// ── Later today, Tonight, Tomorrow ───────────────────────────────────────
test('later: events and reminders ahead today, in time order', () => {
  const events = normalizeEvents([
    { id: 'e1', title: 'Flight', start: { dateTime: iso(8, 30) }, end: { dateTime: iso(10, 30) }, location: "Hap's" },
    { id: 'e0', title: 'Already over', start: { dateTime: iso(5, 0) }, end: { dateTime: iso(6, 0) } },
    { id: 'e2', title: 'Holiday', start: { date: TODAY }, end: { date: TOMORROW } },
  ])
  const r = task({ title: 'TV off', remind_at: iso(19, 30) })
  const m = model({ tasks: [r], events })
  assert.equal(m.later.label, 'Coming up')
  assert.deepEqual(m.later.items.map(i => i.kind), ['event', 'reminder'])
  assert.equal(m.later.items[0].event.location, "Hap's")
  assert.equal(m.tomorrow.items.length, 0, 'in the day, tomorrow waits until today is done')
})

test('later: an event imported as a task is not listed twice', () => {
  const t = task({ gcal_event_id: 'e1', due_date: TODAY })
  const events = normalizeEvents([{ id: 'e1', title: 'Dentist', start: { dateTime: iso(15, 0) }, end: { dateTime: iso(16, 0) } }], [t])
  assert.equal(events.length, 0)
})

test('evening: Tonight and Tomorrow show together', () => {
  const tv = task({ title: 'TV off', remind_at: iso(22, 30) })
  const pick = task({ title: 'Pick up Camden', remind_at: iso(13, 30, 11) })
  const mop = task({ title: 'Mop canisters', due_date: TOMORROW, size: 'L' })
  const m = model({ tasks: [tv, pick, mop], now: at(21, 39) })
  assert.equal(m.later.label, 'Tonight')
  assert.deepEqual(ids(m.later.items), [tv.id])
  assert.deepEqual(ids(m.tomorrow.items), [pick.id, mop.id])
})

test('later: a snoozed task returning later today is listed, not hidden', () => {
  const t = task({ snoozed_until: iso(15, 0) })
  const m = model({ tasks: [t], now: at(9, 0) })
  assert.equal(m.later.items[0].kind, 'returns')
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
