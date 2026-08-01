import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planLocalReminders, IOS_PENDING_CAP } from '../src/reminderSchedule.js'

const NOW = Date.parse('2026-08-01T12:00:00Z')
const at = (iso) => new Date(iso).toISOString()

const task = (o = {}) => ({
  id: 't1', title: 'Call the vet', status: 'not_started',
  remind_at: at('2026-08-01T18:00:00Z'), ...o,
})
const loop = (o = {}) => ({
  id: 'r1', title: 'Shut the TV off', cadence: 'daily',
  trigger_time: '19:30', remind: true, ...o,
})

// --- loops become repeating triggers ---------------------------------------

test('a daily ringing loop costs ONE slot and repeats', () => {
  const { schedule, repeating } = planLocalReminders({ routines: [loop()], now: NOW })
  assert.equal(repeating, 1)
  assert.equal(schedule[0].kind, 'daily')
  assert.equal(schedule[0].hour, 19)
  assert.equal(schedule[0].minute, 30)
  assert.equal(schedule[0].id, 'loop:r1')
})

test('a weekly loop carries the weekday, converted to Apple\'s 1=Sunday', () => {
  // The app stores 0=Sunday; iOS wants 1=Sunday. Off by one here means the
  // alarm fires on the wrong day, every week, silently.
  const { schedule } = planLocalReminders({
    routines: [loop({ cadence: 'weekly', schedule_day_of_week: 2 })], now: NOW,
  })
  assert.equal(schedule[0].kind, 'weekly')
  assert.equal(schedule[0].weekday, 3, 'Tuesday: stored 2 → iOS 3')
})

test('a loop that did not opt in is never scheduled', () => {
  const { schedule } = planLocalReminders({ routines: [loop({ remind: false })], now: NOW })
  assert.equal(schedule.length, 0)
})

test('a ringing loop with no trigger time cannot invent one', () => {
  const { schedule } = planLocalReminders({ routines: [loop({ trigger_time: null })], now: NOW })
  assert.equal(schedule.length, 0)
})

test('a malformed trigger time is refused rather than firing at midnight', () => {
  for (const bad of ['25:00', '7:5', 'evening', '19:60', '']) {
    const { schedule } = planLocalReminders({ routines: [loop({ trigger_time: bad })], now: NOW })
    assert.equal(schedule.length, 0, `${bad} should not schedule`)
  }
})

test('a cadence iOS cannot express as a calendar rule is left to its spawned tasks', () => {
  const { schedule } = planLocalReminders({
    routines: [loop({ cadence: 'custom', custom_days: 3 })], now: NOW,
  })
  assert.equal(schedule.length, 0)
})

// --- one-off task reminders ------------------------------------------------

test('a future task reminder is scheduled once', () => {
  const { schedule, once } = planLocalReminders({ tasks: [task()], now: NOW })
  assert.equal(once, 1)
  assert.equal(schedule[0].kind, 'once')
  assert.equal(schedule[0].id, 'task:t1')
  assert.equal(schedule[0].taskId, 't1')
})

test('a moment already past is NOT scheduled — iOS would discard it silently', () => {
  const { schedule } = planLocalReminders({
    tasks: [task({ remind_at: at('2026-08-01T06:00:00Z') })], now: NOW,
  })
  assert.equal(schedule.length, 0)
})

test('a completed or cancelled task does not ring', () => {
  for (const status of ['done', 'completed', 'cancelled', 'backlog']) {
    const { schedule } = planLocalReminders({ tasks: [task({ status })], now: NOW })
    assert.equal(schedule.length, 0, `${status} should not ring`)
  }
})

test('a task with no reminder time is not scheduled', () => {
  const { schedule } = planLocalReminders({ tasks: [task({ remind_at: null })], now: NOW })
  assert.equal(schedule.length, 0)
})

test('an unparseable reminder time is skipped rather than throwing', () => {
  const { schedule } = planLocalReminders({ tasks: [task({ remind_at: 'soon' })], now: NOW })
  assert.equal(schedule.length, 0)
})

// --- the double-alarm trap -------------------------------------------------

test('a loop instance does NOT also get its own alarm', () => {
  // The loop already has a repeating trigger at 19:30. Its spawned task carries
  // remind_at for the same moment, so scheduling both would tell the user twice.
  const { schedule } = planLocalReminders({
    routines: [loop()],
    tasks: [task({ id: 't-spawn', routine_id: 'r1', remind_at: at('2026-08-01T19:30:00Z') })],
    now: NOW,
  })
  assert.equal(schedule.length, 1)
  assert.equal(schedule[0].id, 'loop:r1')
})

test('a task from a NON-ringing loop still gets its own alarm', () => {
  const { schedule } = planLocalReminders({
    routines: [loop({ remind: false })],
    tasks: [task({ id: 't-spawn', routine_id: 'r1' })],
    now: NOW,
  })
  assert.equal(schedule.length, 1)
  assert.equal(schedule[0].id, 'task:t-spawn')
})

// --- the 64 cap ------------------------------------------------------------

test('one-offs are kept nearest-first, and the overflow is REPORTED', () => {
  const tasks = Array.from({ length: 70 }, (_, i) => task({
    id: `t${i}`,
    // Descending, so the input order is the opposite of the desired order.
    remind_at: at(new Date(NOW + (70 - i) * 3600_000).toISOString()),
  }))
  const { schedule, dropped, once } = planLocalReminders({ tasks, now: NOW })
  assert.equal(schedule.length, IOS_PENDING_CAP)
  assert.equal(once, IOS_PENDING_CAP)
  assert.equal(dropped.length, 6, 'the overflow is handed back, not swallowed')
  // Nearest first: t69 is +1h, t68 is +2h...
  assert.equal(schedule[0].id, 'task:t69')
})

test('a recurring loop is never sacrificed to make room for a one-off', () => {
  // A nightly pill alarm losing its slot to a reminder next Tuesday is exactly
  // backwards — the loop costs one slot and matters every day.
  const routines = [loop()]
  const tasks = Array.from({ length: 100 }, (_, i) => task({
    id: `t${i}`, remind_at: at(new Date(NOW + (i + 1) * 3600_000).toISOString()),
  }))
  const { schedule, repeating, once } = planLocalReminders({ routines, tasks, now: NOW })
  assert.equal(schedule.length, IOS_PENDING_CAP)
  assert.equal(repeating, 1)
  assert.equal(once, IOS_PENDING_CAP - 1)
  assert.equal(schedule[0].id, 'loop:r1', 'the loop holds its slot')
})

test('more ringing loops than the cap still yields a schedule, not a crash', () => {
  const routines = Array.from({ length: 70 }, (_, i) => loop({ id: `r${i}` }))
  const { schedule, once } = planLocalReminders({ routines, tasks: [task()], now: NOW })
  assert.equal(once, 0, 'no room left for one-offs')
  assert.ok(schedule.length >= IOS_PENDING_CAP)
})

// --- idempotence and robustness --------------------------------------------

test('ids are stable, so re-planning replaces rather than stacking', () => {
  const args = { routines: [loop()], tasks: [task()], now: NOW }
  const a = planLocalReminders(args).schedule.map(e => e.id)
  const b = planLocalReminders(args).schedule.map(e => e.id)
  assert.deepEqual(a, b)
})

test('the internal sort key never leaks into what the device is handed', () => {
  const { schedule } = planLocalReminders({ tasks: [task()], now: NOW })
  assert.ok(!('_at' in schedule[0]))
})

test('junk in either list is skipped rather than throwing', () => {
  const { schedule } = planLocalReminders({
    tasks: [null, {}, task()], routines: [null, {}, loop()], now: NOW,
  })
  assert.equal(schedule.length, 2)
})

test('empty everything is a valid empty plan', () => {
  const { schedule, dropped, repeating, once } = planLocalReminders({ now: NOW })
  assert.deepEqual(schedule, [])
  assert.deepEqual(dropped, [])
  assert.equal(repeating, 0)
  assert.equal(once, 0)
})

test('called with no arguments at all it still returns a plan', () => {
  assert.deepEqual(planLocalReminders().schedule, [])
})
