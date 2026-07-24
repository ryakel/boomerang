// Unit tests for server/taskModel.js — the derived-state model, nightly
// rollover plan (including the run-it-three-times chaos drill), pick-three
// payload, and field validation. Run via `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveTaskState, rolloverPlan, todayPayload,
  validateFirstStep, validateLocation, ymdInTz,
  DONE_ARCHIVE_DAYS, FIRST_STEP_MAX,
} from '../server/taskModel.js'

const TZ = 'UTC'
const TODAY = '2026-07-18'
const NOW_MS = new Date('2026-07-18T12:00:00Z').getTime()
const NOW_ISO = new Date(NOW_MS).toISOString()
const ctx = { todayYMD: TODAY, nowMs: NOW_MS, tz: TZ }

const mk = (over = {}) => ({ id: 't1', title: 'A task', status: 'not_started', ...over })

// ---- deriveTaskState: every state reachable, one source of truth ----

test('open: plain active task', () => {
  assert.equal(deriveTaskState(mk(), ctx), 'open')
})

test('committed: active + committed_on today', () => {
  assert.equal(deriveTaskState(mk({ committed_on: TODAY }), ctx), 'committed')
})

test('boomeranged: active + committed_on before today (pre-rollover window)', () => {
  assert.equal(deriveTaskState(mk({ committed_on: '2026-07-17' }), ctx), 'boomeranged')
})

test('done: completed recently', () => {
  const t = mk({ status: 'done', completed_at: NOW_ISO })
  assert.equal(deriveTaskState(t, ctx), 'done')
})

test('archived: done older than the archive window', () => {
  const old = new Date(NOW_MS - (DONE_ARCHIVE_DAYS + 1) * 86400e3).toISOString()
  assert.equal(deriveTaskState(mk({ status: 'done', completed_at: old }), ctx), 'archived')
})

test('archived: released (cancelled)', () => {
  assert.equal(deriveTaskState(mk({ status: 'cancelled', released_at: NOW_ISO }), ctx), 'archived')
})

test('shelved: indefinite set-aside, future snooze, backlog, project', () => {
  assert.equal(deriveTaskState(mk({ snooze_indefinite: true }), ctx), 'shelved')
  const future = new Date(NOW_MS + 3600e3).toISOString()
  assert.equal(deriveTaskState(mk({ snoozed_until: future }), ctx), 'shelved')
  assert.equal(deriveTaskState(mk({ status: 'backlog' }), ctx), 'shelved')
  assert.equal(deriveTaskState(mk({ status: 'project' }), ctx), 'shelved')
})

test('open again: snooze already passed', () => {
  const past = new Date(NOW_MS - 3600e3).toISOString()
  assert.equal(deriveTaskState(mk({ snoozed_until: past }), ctx), 'open')
})

test('shelving outranks a stale commitment', () => {
  const t = mk({ committed_on: '2026-07-17', snooze_indefinite: true })
  assert.equal(deriveTaskState(t, ctx), 'shelved')
})

// ---- rolloverPlan ----

test('rollover: committed task left overnight comes back to the pool', () => {
  const t = mk({ committed_on: '2026-07-17', boomerang_count: 0 })
  const plan = rolloverPlan([t], { todayYMD: TODAY, nowIso: NOW_ISO })
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0].updates, {
    committed_on: null, boomerang_count: 1, last_boomeranged_at: NOW_ISO,
  })
  // After applying, the task derives as open — back in the pool.
  const after = { ...t, ...plan[0].updates }
  assert.equal(deriveTaskState(after, ctx), 'open')
})

test('rollover only touches ACTIVE committed-in-the-past tasks', () => {
  const tasks = [
    mk({ id: 'a', committed_on: TODAY }),
    mk({ id: 'b', status: 'done', completed_at: NOW_ISO, committed_on: '2026-07-17' }),
    mk({ id: 'c', status: 'backlog', committed_on: '2026-07-17' }),
    mk({ id: 'd' }),
    mk({ id: 'e', status: 'doing', committed_on: '2026-07-16', boomerang_count: 2 }),
  ]
  const plan = rolloverPlan(tasks, { todayYMD: TODAY, nowIso: NOW_ISO })
  assert.deepEqual(plan.map(p => p.id), ['e'])
  assert.equal(plan[0].updates.boomerang_count, 3)
})

test('chaos drill: running the rollover three times equals running it once', () => {
  let tasks = [
    mk({ id: 'a', status: 'doing', committed_on: '2026-07-17', boomerang_count: 0 }),
    mk({ id: 'b', committed_on: TODAY }),
    mk({ id: 'c' }),
  ]
  const apply = () => {
    const plan = rolloverPlan(tasks, { todayYMD: TODAY, nowIso: NOW_ISO })
    tasks = tasks.map(t => {
      const step = plan.find(p => p.id === t.id)
      return step ? { ...t, ...step.updates } : t
    })
    return plan.length
  }
  assert.equal(apply(), 1) // first run does the work
  const snapshot = JSON.stringify(tasks)
  assert.equal(apply(), 0) // second run: nothing to do
  assert.equal(apply(), 0) // third run: still nothing
  assert.equal(JSON.stringify(tasks), snapshot)
  const a = tasks.find(t => t.id === 'a')
  assert.equal(a.boomerang_count, 1)
  assert.equal(a.committed_on, null)
})

// ---- todayPayload ----

test('today payload: committed with intentions, gentle-return count, no shame math', () => {
  const tasks = [
    mk({ id: 'a', title: 'File expenses', committed_on: TODAY, first_step: 'open the receipts folder', intention_when: 'after I pour coffee' }),
    mk({ id: 'b', title: 'Call plumber', committed_on: TODAY, status: 'done', completed_at: NOW_ISO }),
    mk({ id: 'c', title: 'Came back', last_boomeranged_at: NOW_ISO }),
    mk({ id: 'd', title: 'Plain pool task' }),
    mk({ id: 'e', title: 'Parked', snooze_indefinite: true }),
  ]
  const p = todayPayload(tasks, ctx)
  assert.equal(p.date, TODAY)
  assert.equal(p.committed_count, 2)
  const a = p.committed.find(t => t.id === 'a')
  assert.equal(a.first_step, 'open the receipts folder')
  assert.equal(a.intention_when, 'after I pour coffee')
  assert.equal(a.done, false)
  assert.equal(p.committed.find(t => t.id === 'b').done, true)
  assert.equal(p.returned_count, 1)
  assert.equal(p.open_count, 2) // c + d; e is shelved
  assert.equal(p.timer, null)
})

// ---- validation ----

test(`first_step accepts up to ${FIRST_STEP_MAX} chars, rejects beyond with a friendly message`, () => {
  assert.equal(validateFirstStep('x'.repeat(FIRST_STEP_MAX)).ok, true)
  const r = validateFirstStep('x'.repeat(FIRST_STEP_MAX + 1))
  assert.equal(r.ok, false)
  assert.match(r.error, /shrink it further/)
  assert.equal(validateFirstStep(null).value, null)
})

test('location validation: defaults, bounds, trigger', () => {
  const ok = validateLocation({ lat: 41.8, lng: -87.6, label: 'Home' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.radius_m, 150)
  assert.equal(ok.value.trigger, 'arrive')
  assert.equal(validateLocation({ lat: 41.8, lng: -87.6, radius_m: 49 }).ok, false)
  assert.equal(validateLocation({ lat: 41.8, lng: -87.6, radius_m: 1001 }).ok, false)
  assert.equal(validateLocation({ lat: 41.8, lng: -87.6, radius_m: 50 }).ok, true)
  assert.equal(validateLocation({ lat: 41.8, lng: -87.6, radius_m: 1000 }).ok, true)
  assert.equal(validateLocation({ lat: 99, lng: 0 }).ok, false)
  assert.equal(validateLocation({ lat: 0, lng: 200 }).ok, false)
  assert.equal(validateLocation({ lat: 0, lng: 0, trigger: 'hover' }).ok, false)
  assert.equal(validateLocation({ lat: 0, lng: 0, trigger: 'leave' }).value.trigger, 'leave')
  assert.equal(validateLocation(null).value, null)
})

test('ymdInTz buckets correctly across a timezone boundary', () => {
  // 2026-07-18T03:00Z is still 2026-07-17 in Chicago (UTC-5).
  assert.equal(ymdInTz('2026-07-18T03:00:00Z', 'America/Chicago'), '2026-07-17')
  assert.equal(ymdInTz('2026-07-18T03:00:00Z', 'UTC'), '2026-07-18')
})
