// Unit tests for server/vacationRepair.js — the bulk due-date repair plan.
//
// The danger here is the inverse of the window's: this MOVES the user's data.
// So the tests care most about the tasks that must NOT move — done tasks,
// dues outside the window, dues at or past the target, excluded (crisis)
// tasks — and about idempotence, since the owner will tap the button twice.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairPlan } from '../server/vacationRepair.js'

const WIN = { active: true, started_at: '2026-07-27', ends_at: '2026-07-31' }
const OPTS = { todayYMD: '2026-08-01' }

const task = (id, due, status = 'not_started', extra = {}) =>
  ({ id, title: id, status, due_date: due, ...extra })

// ---- what moves ----

test('an active task due mid-window moves to today', () => {
  const plan = repairPlan([task('a', '2026-07-28')], WIN, OPTS)
  assert.deepEqual(plan, [{ id: 'a', from: '2026-07-28', to: '2026-08-01' }])
})

test('both window boundary days qualify', () => {
  const plan = repairPlan([task('a', '2026-07-27'), task('b', '2026-07-31')], WIN, OPTS)
  assert.deepEqual(plan.map(p => p.id).sort(), ['a', 'b'])
})

test('an explicit target lands everything on that date', () => {
  const plan = repairPlan([task('a', '2026-07-28')], WIN, { ...OPTS, targetYMD: '2026-08-03' })
  assert.equal(plan[0].to, '2026-08-03')
})

test('every active status qualifies', () => {
  for (const st of ['not_started', 'doing', 'waiting', 'in_progress']) {
    assert.equal(repairPlan([task('a', '2026-07-28', st)], WIN, OPTS).length, 1, st)
  }
})

test('a stray timestamp on due_date still matches its day', () => {
  const plan = repairPlan([task('a', '2026-07-28T09:30:00.000Z')], WIN, OPTS)
  assert.equal(plan.length, 1)
  assert.equal(plan[0].from, '2026-07-28')
})

// ---- what must NOT move ----

test('done and archived tasks are left alone', () => {
  for (const st of ['done', 'completed', 'archived', 'project']) {
    assert.equal(repairPlan([task('a', '2026-07-28', st)], WIN, OPTS).length, 0, st)
  }
})

test('a due date outside the window is not touched', () => {
  const plan = repairPlan([task('a', '2026-07-26'), task('b', '2026-08-01')], WIN, OPTS)
  assert.equal(plan.length, 0)
})

test('undated tasks are skipped', () => {
  assert.equal(repairPlan([task('a', null), task('b', undefined)], WIN, OPTS).length, 0)
})

test('a due ON the target is a no-op, not a move', () => {
  // Window still covering today (turned off early): a task due today must not
  // be "repaired" onto the same date.
  const win = { active: true, started_at: '2026-07-27', ends_at: '2026-08-02' }
  assert.equal(repairPlan([task('a', '2026-08-01')], win, OPTS).length, 0)
})

test('a due AFTER the target is never pulled earlier', () => {
  // The stored window reaches past today; a task due tomorrow has not gone
  // overdue and must not move backwards.
  const win = { active: true, started_at: '2026-07-27', ends_at: '2026-08-05' }
  assert.equal(repairPlan([task('a', '2026-08-02')], win, OPTS).length, 0)
})

test('the exclusion predicate is honored (the crisis path)', () => {
  const plan = repairPlan(
    [task('a', '2026-07-28', 'not_started', { crisis: true }), task('b', '2026-07-28')],
    WIN, { ...OPTS, isExcluded: t => !!t.crisis })
  assert.deepEqual(plan.map(p => p.id), ['b'])
})

// ---- idempotence: the button will be tapped twice ----

test('running the plan over already-repaired tasks produces nothing', () => {
  const first = repairPlan([task('a', '2026-07-28')], WIN, OPTS)
  const after = [task('a', first[0].to)]  // as the apply step leaves it
  assert.equal(repairPlan(after, WIN, OPTS).length, 0)
})

test('a manual edit between preview and apply drops the task from the plan', () => {
  // The user moved it themselves; the repair must not fight them.
  assert.equal(repairPlan([task('a', '2026-08-04')], WIN, OPTS).length, 0)
})

// ---- open-ended windows ----

test('an open-ended window covers through today', () => {
  const win = { active: true, started_at: '2026-07-27', ends_at: null }
  // Due yesterday, inside the open window: moves. Due today: no-op.
  const plan = repairPlan([task('a', '2026-07-31'), task('b', '2026-08-01')], win, OPTS)
  assert.deepEqual(plan.map(p => p.id), ['a'])
})

// ---- malformed input is inert ----

test('no window days means no plan', () => {
  assert.equal(repairPlan([task('a', '2026-07-28')], { active: true }, OPTS).length, 0)
  assert.equal(repairPlan([task('a', '2026-07-28')], null, OPTS).length, 0)
})

test('a bad today or target refuses to plan rather than guessing', () => {
  assert.equal(repairPlan([task('a', '2026-07-28')], WIN, { todayYMD: 'nope' }).length, 0)
  assert.equal(repairPlan([task('a', '2026-07-28')], WIN, { ...OPTS, targetYMD: 'soon' }).length, 0)
})

test('garbage rows are skipped, not crashed on', () => {
  const plan = repairPlan([null, {}, { id: 'x' }, task('a', '2026-07-28')], WIN, OPTS)
  assert.deepEqual(plan.map(p => p.id), ['a'])
})
