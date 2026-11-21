import test from 'node:test'
import assert from 'node:assert/strict'
import { groupUpcoming, slippedChoices, WEEK_DAYS } from '../src/tasksModel.js'
import { buildTodayModel } from '../src/todayModel.js'

// The Tasks list's Upcoming tab on Kept 2.0 rules (BOOM-37). Scenarios come from
// the 2026-11-15 phone review: Tasks opened on seven red "Nd overdue" rows, which
// is exactly what the Today correction had removed.

const NOW = new Date(2026, 10, 15, 13, 20)          // Sun Nov 15, 1:20 PM local
const day = (n) => { const d = new Date(2026, 10, 15 + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
let seq = 0
const task = (over = {}) => ({ id: `t${++seq}`, title: `task ${seq}`, status: 'not_started', created_at: '2026-11-01T12:00:00Z', ...over })
const ids = (rows) => rows.map(r => r.task.id)
const all = (g) => Object.values(g).flat().map(r => r.task.id)

test('past-due tasks are slipped, not a red block at the top', () => {
  const late = task({ due_date: day(-8) })
  const later = task({ due_date: day(-1) })
  const g = groupUpcoming({ tasks: [later, late], now: NOW })
  assert.deepEqual(ids(g.slipped), [late.id, later.id], 'oldest first')
  assert.equal(g.slipped[0].daysAgo, 8)
  assert.equal(g.today.length + g.critical.length, 0)
})

test('every task lands in exactly one group', () => {
  const tasks = [
    task({ due_date: day(0) }), task({ due_date: day(3) }), task({ due_date: day(-2) }),
    task({ due_date: day(30) }), task({ status: 'doing' }), task(),
    task({ status: 'waiting' }), task({ status: 'in_progress' }),
  ]
  const placed = all(groupUpcoming({ tasks, now: NOW }))
  assert.equal(placed.length, tasks.length)
  assert.equal(new Set(placed).size, tasks.length)
})

test('date windows: today, this week (7 days), later', () => {
  const t0 = task({ due_date: day(0) })
  const t7 = task({ due_date: day(WEEK_DAYS) })
  const t8 = task({ due_date: day(WEEK_DAYS + 1) })
  const g = groupUpcoming({ tasks: [t0, t7, t8], now: NOW })
  assert.deepEqual(ids(g.today), [t0.id])
  assert.deepEqual(ids(g.week), [t7.id])
  assert.deepEqual(ids(g.later), [t8.id])
})

test('undated: started vs anytime; picked for today goes to Today', () => {
  const doing = task({ status: 'doing' })
  const idle = task()
  const picked = task({ committed_on: day(0) })
  const g = groupUpcoming({ tasks: [doing, idle, picked], now: NOW })
  assert.deepEqual(ids(g.started), [doing.id])
  assert.deepEqual(ids(g.anytime), [idle.id])
  assert.deepEqual(ids(g.today), [picked.id])
})

test('waiting is its own group whatever its date, and offers a check-in after a week', () => {
  const fresh = task({ status: 'waiting', waiting_at: new Date(2026, 10, 14, 9).toISOString(), due_date: day(-3) })
  const stale = task({ status: 'waiting', waiting_at: new Date(2026, 10, 3, 9).toISOString() })
  const g = groupUpcoming({ tasks: [fresh, stale], now: NOW })
  assert.deepEqual(ids(g.waiting), [stale.id, fresh.id], 'longest wait first')
  assert.equal(g.waiting[0].checkIn, true)
  assert.equal(g.waiting[1].checkIn, false)
  assert.equal(g.slipped.length, 0, 'a waiting task is never slipped')
})

test('a loop instance is the current cycle: Today, never slipped', () => {
  const routines = [{ id: 'r1', cadence: 'daily' }]
  const late = task({ routine_id: 'r1', due_date: day(-2) })
  const undated = task({ routine_id: 'r1' })
  const g = groupUpcoming({ tasks: [late, undated], routines, now: NOW })
  assert.equal(g.slipped.length, 0)
  assert.deepEqual(new Set(ids(g.today)), new Set([late.id, undated.id]))
})

test('stack members, snoozed, subtasks, pending suggestions and closed tasks stay out', () => {
  const routines = [{ id: 'stack', members: [{ id: 'm1', title: 'a' }, { id: 'm2', title: 'b' }] }]
  const tasks = [
    task({ routine_id: 'stack', due_date: day(0) }),
    task({ snoozed_until: new Date(2026, 10, 20).toISOString() }),
    task({ parent_id: 'p1' }),
    task({ gmail_pending: true }),
    task({ status: 'done' }), task({ status: 'backlog' }), task({ status: 'cancelled' }),
  ]
  assert.equal(all(groupUpcoming({ tasks, routines, now: NOW })).length, 0)
})

test('a snooze that already ended does not hide the task', () => {
  const back = task({ snoozed_until: new Date(2026, 10, 15, 9).toISOString() })
  assert.deepEqual(ids(groupUpcoming({ tasks: [back], now: NOW }).anytime), [back.id])
})

test('critical keeps its own group, ahead of everything', () => {
  const crit = task({ due_date: day(-5), tags: ['crit'] })
  const g = groupUpcoming({ tasks: [crit], now: NOW, isCrisis: t => (t.tags || []).includes('crit') })
  assert.deepEqual(ids(g.critical), [crit.id])
  assert.equal(g.slipped.length, 0)
})

test('the Worth doing next pick is shown once: left out of the groups', () => {
  const pick = task({ due_date: day(2), high_priority: true, size: 'XS' })
  const other = task({ due_date: day(6) })
  const g = groupUpcoming({ tasks: [pick, other], now: NOW, excludeIds: [pick.id] })
  assert.deepEqual(ids(g.week), [other.id])
})

test('Tasks and Today agree on the pick for the same data', () => {
  const tasks = [
    task({ title: 'cancel free trial', due_date: day(4), high_priority: true, size: 'XS' }),
    task({ title: 'buy present', due_date: day(2), size: 'S' }),
    task({ title: 'old', due_date: day(-6) }),
  ]
  const m = buildTodayModel({ tasks, routines: [], settings: {}, now: NOW, events: null, isCrisis: () => false })
  assert.ok(m.next, 'the scenario has a pick')
  const g = groupUpcoming({ tasks, now: NOW, excludeIds: [m.next.task.id] })
  assert.equal(all(g).includes(m.next.task.id), false)
  assert.equal(all(g).length, tasks.length - 1)
})

test('slipped choices are tomorrow and a week out', () => {
  assert.deepEqual(slippedChoices(NOW).map(c => c.ymd), [day(1), day(7)])
})

test('kept on Today: the Tasks list shows it under Today until its date; past its date it has slipped', () => {
  const future = task({ pinned_to_today: true, due_date: day(5) })
  const undated = task({ pinned_to_today: true })
  const late = task({ pinned_to_today: true, due_date: day(-2) })
  const g = groupUpcoming({ tasks: [future, undated, late], now: NOW })
  assert.deepEqual(ids(g.today).sort(), [future.id, undated.id].sort())
  assert.deepEqual(ids(g.slipped), [late.id])
  assert.equal(g.week.length, 0)
})
