import test from 'node:test'
import assert from 'node:assert/strict'
import {
  loopMode, canAutopilot, withAutopilot, isResting, openInstanceForDay, openInstancesForDay, groupLoops,
  isCycleTask, doneInstancesOnDay, practiceCount, doneOnDay,
  cadenceWord, scheduleLabel, clockLabel, lastDoneWord, AUTOPILOT,
} from '../src/loopModes.js'
import { readFileSync } from 'node:fs'
import { loopGaps } from '../src/kept/cycles.js'
import { acceptsDeferral } from '../src/loopSpawnStatus.js'

// Loops on Kept 2.0 rules (BOOM-35). Owner decisions, 2026-11-15: modes are
// derived from what a loop already is; autopilot is completely silent; missed
// cycles get one quiet row; marking a day done on a loop's page closes that
// cycle's open task. Nothing here keeps score.

const NOW = new Date(2026, 10, 15, 13, 20)          // Sun Nov 15, 1:20 PM local
const day = (n) => { const d = new Date(2026, 10, 15 + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
let seq = 0
const loop = (over = {}) => ({ id: `r${++seq}`, title: `loop ${seq}`, cadence: 'weekly', spawn_mode: 'auto', completed_history: [], created_at: '2026-09-01T12:00:00Z', ...over })
const task = (over = {}) => ({ id: `t${++seq}`, title: `task ${seq}`, status: 'not_started', created_at: '2026-11-01T12:00:00Z', ...over })
const stack = (over = {}) => loop({ members: [{ id: 'm1', title: 'Lock doors' }, { id: 'm2', title: 'Pour milk' }], cadence: 'daily', ...over })

test('modes are derived from what a loop already is', () => {
  assert.equal(loopMode(loop()), 'reminder')
  assert.equal(loopMode(loop({ spawn_mode: undefined })), 'reminder')
  assert.equal(loopMode(stack()), 'checklist')
  assert.equal(loopMode(loop({ spawn_mode: 'habit', target_count: 3, target_period: 'week' })), 'practice')
  assert.equal(loopMode(loop({ spawn_mode: AUTOPILOT })), 'autopilot')
  assert.equal(loopMode(null), null)
})

test('only a reminder loop switches to and from autopilot', () => {
  const r = loop()
  const on = withAutopilot({ ...r, remind: true }, true)
  assert.equal(on.spawn_mode, 'autopilot')
  assert.equal(on.remind, false, 'autopilot turns the loop alarm off')
  assert.equal(withAutopilot(on, false).spawn_mode, 'auto')
  assert.equal(withAutopilot(r, false), r, 'unchanged returns the same object')
  assert.equal(withAutopilot(on, true), on)
  const s = stack()
  assert.equal(canAutopilot(s), false)
  assert.equal(withAutopilot(s, true), s, 'a checklist is changed in the editor')
  assert.equal(canAutopilot(loop({ spawn_mode: 'habit' })), false)
})

test('autopilot is silent: never due, no gaps, no deferral', () => {
  const r = loop({ spawn_mode: AUTOPILOT, cadence: 'daily', completed_history: [] })
  // store.js can't load under node (extensionless imports), so pin the spawn
  // guard in isRoutineDue by its source: autopilot returns false before the
  // cadence check, which is what keeps it off Today, notifications and alarms.
  const store = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8')
  const body = store.slice(store.indexOf('export function isRoutineDue'), store.indexOf('export function formatCadence'))
  assert.match(body, /spawn_mode === 'autopilot'\) return false/)
  assert.ok(body.indexOf("'autopilot'") < body.indexOf('getNextDueDate(routine)'))
  const gaps = loopGaps(r, [], 12, new Set())
  assert.equal(gaps.unrecorded.length + gaps.missed.length, 0)
  assert.equal(acceptsDeferral(r), false)
})

test('resting: paused or past its end date', () => {
  assert.equal(isResting(loop({ paused: true }), NOW), true)
  assert.equal(isResting(loop({ end_date: day(-1) }), NOW), true)
  assert.equal(isResting(loop({ end_date: day(0) }), NOW), false, 'ends at the end of its last day')
  assert.equal(isResting(loop(), NOW), false)
})

test('marking a day done closes the cycle that day belongs to', () => {
  const r = loop()
  const open = task({ routine_id: r.id, due_date: day(-2) })
  assert.equal(openInstanceForDay({ routine: r, tasks: [open], day: day(0), todayKey: day(0) }), open)
  assert.equal(openInstanceForDay({ routine: r, tasks: [open], day: day(-2), todayKey: day(0) }), open, 'its own due day')
  assert.equal(openInstanceForDay({ routine: r, tasks: [open], day: day(-5), todayKey: day(0) }), null, 'an older day back-fills history only')
  assert.equal(openInstanceForDay({ routine: r, tasks: [open], day: day(1), todayKey: day(0) }), null, 'never a future day')
  const undated = task({ routine_id: r.id })
  assert.equal(openInstanceForDay({ routine: r, tasks: [undated], day: day(-9), todayKey: day(0) }), undated)
})

test('marking a day leaves done, cancelled, subtasks, other loops and non-reminders alone', () => {
  const r = loop()
  const tasks = [
    task({ routine_id: r.id, status: 'done', due_date: day(0) }),
    task({ routine_id: r.id, status: 'cancelled', due_date: day(0) }),
    task({ routine_id: r.id, status: 'backlog', due_date: day(0) }),
    task({ routine_id: r.id, parent_id: 'p', due_date: day(0) }),
    task({ routine_id: 'other', due_date: day(0) }),
  ]
  assert.equal(openInstanceForDay({ routine: r, tasks, day: day(0), todayKey: day(0) }), null)
  const s = stack()
  const member = task({ routine_id: s.id, due_date: day(0) })
  assert.equal(openInstanceForDay({ routine: s, tasks: [member], day: day(0), todayKey: day(0) }), null, 'a checklist has several tasks per cycle')
})

const groups = (routines, tasks = [], extra = {}) => groupLoops({
  routines, tasks, now: NOW,
  nextDue: (r) => new Date(`${r._next || day(3)}T09:00:00`),
  habitStats: (r) => (r.target_count ? { completions: r._done || 0, target: r.target_count } : null),
  ...extra,
})
const titles = (rows) => rows.map(x => x.routine.title)

test('every loop lands in exactly one main group', () => {
  const routines = [
    loop({ title: 'a' }), stack({ title: 'b' }), loop({ title: 'c', spawn_mode: 'habit', target_count: 3, target_period: 'week' }),
    loop({ title: 'd', spawn_mode: AUTOPILOT }), loop({ title: 'e', paused: true }),
  ]
  const g = groups(routines)
  const placed = [g.dueToday, g.checklists, g.practice, g.comingUp, g.autopilot, g.resting].flat().map(x => x.routine.id)
  assert.equal(placed.length, routines.length)
  assert.equal(new Set(placed).size, routines.length)
  assert.deepEqual(titles(g.resting), ['e'])
  assert.deepEqual(titles(g.autopilot), ['d'])
})

test('a reminder with an open instance due today or earlier is due today', () => {
  const r = loop({ title: 'clean kitchen' })
  const late = task({ routine_id: r.id, due_date: day(-3) })
  const g = groups([r], [late])
  assert.deepEqual(titles(g.dueToday), ['clean kitchen'])
  assert.equal(g.dueToday[0].task, late)
})

test('done today stays on Due today, ticked; otherwise it is coming up', () => {
  const r = loop({ title: 'take meds', cadence: 'daily' })
  const done = task({ routine_id: r.id, status: 'done', due_date: day(0), completed_at: new Date(2026, 10, 15, 10).toISOString() })
  const g = groups([r], [done])
  assert.equal(g.dueToday[0].task, null)
  assert.equal(g.dueToday[0].doneTask, done)
  const later = groups([loop({ title: 'bank', _next: day(4) })])
  assert.deepEqual(later.comingUp.map(x => x.due), [day(4)])
})

test('coming up is soonest first; a future open instance gives the date', () => {
  const a = loop({ title: 'a', _next: day(6) })
  const b = loop({ title: 'b', _next: day(2) })
  const c = loop({ title: 'c' })
  const g = groups([a, b, c], [task({ routine_id: c.id, due_date: day(1) })])
  assert.deepEqual(titles(g.comingUp), ['c', 'b', 'a'])
})

test('checklists report today\'s progress and sort by time', () => {
  const late = stack({ title: 'bedtime', trigger_time: '21:00' })
  const early = stack({ title: 'morning', trigger_time: '07:30' })
  const tasks = [
    task({ routine_id: late.id, due_date: day(0), status: 'done' }),
    task({ routine_id: late.id, due_date: day(0) }),
  ]
  const g = groups([late, early], tasks)
  assert.deepEqual(titles(g.checklists), ['morning', 'bedtime'])
  assert.deepEqual(g.checklists[1], { routine: late, items: 2, doneToday: 1, spawnedToday: 2, dueToday: true, next: day(0) })
})

test('practice shows progress toward its target and whether today is logged', () => {
  const r = loop({ title: 'stretch', spawn_mode: 'habit', target_count: 3, target_period: 'week', _done: 1 })
  const g = groups([r], [task({ routine_id: r.id, status: 'done', completed_at: new Date(2026, 10, 15, 8).toISOString() })])
  assert.deepEqual(g.practice[0], { routine: r, done: 1, target: 3, loggedToday: true })
})

test('missed cycles are one quiet list, never on autopilot or resting loops', () => {
  const a = loop({ title: 'a' })
  const auto = loop({ title: 'auto', spawn_mode: AUTOPILOT })
  const rest = loop({ title: 'rest', paused: true })
  const g = groups([a, auto, rest], [], { missedCount: () => 2 })
  assert.deepEqual(g.slipped.map(x => [x.routine.title, x.count]), [['a', 2]])
})

test('labels', () => {
  assert.equal(cadenceWord(loop({ cadence: 'daily' })), 'daily')
  assert.equal(cadenceWord(loop({ cadence: 'custom', custom_days: 3 })), 'every 3 days')
  assert.equal(cadenceWord(loop({ cadence: 'custom', custom_days: 2, custom_unit: 'months' })), 'every 2 months')
  assert.equal(scheduleLabel(loop({ cadence: 'weekly' }), 'Sun'), 'Every week, Sun')
  assert.equal(scheduleLabel(loop({ cadence: 'custom', custom_days: 3 })), 'Every 3 days')
  assert.equal(clockLabel('21:00'), '9:00 PM')
  assert.equal(clockLabel('00:05'), '12:05 AM')
  assert.equal(clockLabel(''), null)
  assert.equal(lastDoneWord(loop({ completed_history: [new Date(2026, 10, 15, 9).toISOString()] }), NOW), 'today')
  assert.equal(lastDoneWord(loop({ completed_history: [new Date(2026, 10, 14, 9).toISOString(), new Date(2026, 10, 2, 9).toISOString()] }), NOW), 'yesterday')
  assert.equal(lastDoneWord(loop(), NOW), null)
})

test('a checklist that is not due today says when it comes back, not "tonight"', () => {
  const weekly = stack({ title: 'sunday reset', cadence: 'weekly', trigger_time: '21:00', _next: day(5) })
  const g = groups([weekly])
  assert.equal(g.checklists[0].dueToday, false)
  assert.equal(g.checklists[0].next, day(5))
})

test('follow-up steps are not the loop\'s cycle task', () => {
  const r = loop({ title: 'run dishwasher', follow_ups: [{ title: 'empty dishwasher' }] })
  const cycle = task({ routine_id: r.id, title: 'run dishwasher', due_date: day(0) })
  const step = task({ routine_id: r.id, title: 'empty dishwasher', due_date: day(-1) })
  assert.equal(isCycleTask(r, cycle), true)
  assert.equal(isCycleTask(r, step), false)
  assert.deepEqual(openInstancesForDay({ routine: r, tasks: [step, cycle], day: day(0), todayKey: day(0) }), [cycle])
  const plain = loop()
  assert.equal(isCycleTask(plain, task({ routine_id: plain.id, title: 'renamed' })), true, 'no follow-ups: every task is a cycle task')
})

test('marking a checklist day closes every open item of that cycle', () => {
  const s = stack()
  const a = task({ routine_id: s.id, title: 'Lock doors', due_date: day(0) })
  const b = task({ routine_id: s.id, title: 'Pour milk', due_date: day(0) })
  const old = task({ routine_id: s.id, title: 'Lock doors', due_date: day(-3) })
  const done = task({ routine_id: s.id, title: 'Pour milk', due_date: day(0), status: 'done' })
  assert.deepEqual(openInstancesForDay({ routine: s, tasks: [a, b, old, done], day: day(0), todayKey: day(0) }).map(t => t.id).sort(), [a.id, b.id].sort())
  assert.deepEqual(openInstancesForDay({ routine: s, tasks: [a, b, old], day: day(-3), todayKey: day(0) }), [old], 'an older day closes that cycle only')
})

test('an autopilot loop closes a task left over from before the switch; practice closes none', () => {
  const r = loop({ spawn_mode: AUTOPILOT })
  const left = task({ routine_id: r.id, due_date: day(-1) })
  assert.deepEqual(openInstancesForDay({ routine: r, tasks: [left], day: day(0), todayKey: day(0) }), [left])
  const p = loop({ spawn_mode: 'habit' })
  assert.deepEqual(openInstancesForDay({ routine: p, tasks: [task({ routine_id: p.id })], day: day(0), todayKey: day(0) }), [])
})

test('unmarking a day reopens the latest cycle\'s task closed that day, never an older one', () => {
  const r = loop()
  const at = (d) => new Date(2026, 10, 15 + d, 10).toISOString()
  const latest = task({ routine_id: r.id, due_date: day(0), status: 'done', completed_at: at(0) })
  assert.deepEqual(doneInstancesOnDay({ routine: r, tasks: [latest], day: day(0) }), [latest])
  const oldDone = task({ routine_id: r.id, due_date: day(-7), status: 'done', completed_at: at(-7) })
  const newer = task({ routine_id: r.id, due_date: day(0) })
  assert.deepEqual(doneInstancesOnDay({ routine: r, tasks: [oldDone, newer], day: day(-7) }), [], 'a newer cycle exists: leave the old task closed')
})

test('practice counts logs and calendar marks once per day each, whichever is larger', () => {
  const at = (d, h) => new Date(2026, 10, 15 + d, h).toISOString()
  const r = loop({ spawn_mode: 'habit', target_count: 3, target_period: 'week', completed_history: [at(-1, 12), at(-2, 12), at(-2, 13)] })
  const logs = [
    task({ routine_id: r.id, status: 'done', completed_at: at(-1, 9) }),   // logged and stamped Saturday
    task({ routine_id: r.id, status: 'done', completed_at: at(-4, 9) }),   // logged, never stamped
  ]
  const start = new Date(2026, 10, 9), end = new Date(2026, 10, 16)
  assert.equal(practiceCount(r, logs, start, end), 1 + 2 + 1, 'Sat 1, Fri 2 calendar marks, Wed 1 log')
  assert.equal(doneOnDay(r, logs, day(-2)), true)
  assert.equal(doneOnDay(r, logs, day(-3)), false)
})
