import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TERMINAL_STATUSES, DEFERRED_STATUSES,
  blocksSpawn, hasLiveInstance, isDeferral, acceptsDeferral, deferFloorBase,
} from '../src/loopSpawnStatus.js'

// The spawn guard decides whether a loop is allowed to mint this cycle's task.
// It used to block on `status !== 'done'`, which made every non-done status a
// PERMANENT block — and three of them (backlog, cancelled, project) are both
// user-reachable and invisible on Today. One swipe to Backlog and the loop was
// dead: its card kept reading "due, not done" forever with no task behind it.

const task = (status, routineId = 'r1') => ({ id: 't', status, routine_id: routineId })

test('a live instance holds the cycle open', () => {
  for (const s of ['not_started', 'doing', 'waiting', 'in_progress']) {
    assert.equal(blocksSpawn(task(s), 'r1'), true, s)
  }
})

test('THE BUG: backlog / cancelled / project release the cycle instead of killing the loop', () => {
  // Each of these is reachable from the row swipe or the status menu, and each
  // one is filtered out of Today — so while they blocked, the loop had no task
  // and no way to ever get one.
  for (const s of ['backlog', 'cancelled', 'project']) {
    assert.equal(blocksSpawn(task(s), 'r1'), false, s)
  }
})

test('done and completed release the cycle', () => {
  assert.equal(blocksSpawn(task('done'), 'r1'), false)
  assert.equal(blocksSpawn(task('completed'), 'r1'), false)
})

test('another loop\'s task never blocks this one', () => {
  assert.equal(blocksSpawn(task('doing', 'other'), 'r1'), false)
  assert.equal(blocksSpawn(null, 'r1'), false)
})

test('hasLiveInstance scans a list and ignores terminal rows', () => {
  const list = [task('backlog'), task('done'), task('cancelled')]
  assert.equal(hasLiveInstance(list, 'r1'), false)
  assert.equal(hasLiveInstance([...list, task('doing')], 'r1'), true)
  assert.equal(hasLiveInstance([], 'r1'), false)
  assert.equal(hasLiveInstance(undefined, 'r1'), false)
})

test('the deferral set is exactly the terminal set minus the done-ish ones', () => {
  const done = ['done', 'completed']
  assert.deepEqual(
    [...TERMINAL_STATUSES].filter(s => !done.includes(s)).sort(),
    [...DEFERRED_STATUSES].sort(),
  )
})

test('a deferral is not a completion — done never defers the schedule', () => {
  // Completing already moves the cadence clock (and clears resume_at). Treating
  // it as a deferral would push the NEXT cycle out an extra interval on top.
  assert.equal(isDeferral('done'), false)
  assert.equal(isDeferral('completed'), false)
  assert.equal(isDeferral('not_started'), false)
  for (const s of ['backlog', 'cancelled', 'project']) assert.equal(isDeferral(s), true, s)
})

test('an ordinary loop accepts a task-side deferral', () => {
  assert.equal(acceptsDeferral({ id: 'r1', cadence: 'weekly' }), true)
  assert.equal(acceptsDeferral({ id: 'r1', cadence: 'weekly', members: [] }), true)
})

test('a stack does NOT — one backlogged member must not push the whole cycle out', () => {
  // A stack's guard is keyed per (routine_id, due_date); moving the floor for
  // one member would yank the next cycle out from under its siblings.
  assert.equal(acceptsDeferral({ id: 'r1', members: [{ id: 'm1', title: 'Dishes' }] }), false)
})

test('a habit loop does NOT — it has no cadence to move', () => {
  assert.equal(acceptsDeferral({ id: 'r1', spawn_mode: 'habit' }), false)
  assert.equal(acceptsDeferral(null), false)
})

// --- deferFloorBase ----------------------------------------------------
//
// The floor a task-side deferral steps off. The trap it exists for: the cadence
// grid pins an uncompleted cycle at the slot after the last COMPLETION, so a
// loop weeks behind has a due date weeks in the past — and applyResumeFloor
// ignores a past floor, making the deferral a silent no-op.

const day = (y, m, d) => new Date(y, m - 1, d)
const TODAY = day(2026, 9, 12)

test('a future due slot is the base — an on-schedule loop steps off its own grid', () => {
  const next = day(2026, 9, 19)
  assert.equal(deferFloorBase(next, TODAY).getTime(), next.getTime())
})

test('THE TRAP: a due slot in the past steps off TODAY instead', () => {
  // Otherwise one interval off a six-week-stale slot is still five weeks ago,
  // applyResumeFloor drops it, and the backlogged task respawns immediately.
  const stale = day(2026, 8, 1)
  assert.equal(deferFloorBase(stale, TODAY).getTime(), TODAY.getTime())
})

test('a due slot of exactly today steps off today, not backwards', () => {
  assert.equal(deferFloorBase(day(2026, 9, 12), TODAY).getTime(), TODAY.getTime())
})

test('no due date at all falls back to today', () => {
  assert.equal(deferFloorBase(null, TODAY).getTime(), TODAY.getTime())
})
