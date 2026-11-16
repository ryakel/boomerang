import test from 'node:test'
import assert from 'node:assert/strict'
import { computeDailyStats, computeRecords } from '../src/scoring.js'

// Points and rally left the product on 2026-11-15 (BOOM-33). What survives is
// the COUNT of things that got done, which Analytics and the daily task goal
// still read. These pin what counts, and that no score comes back.

const now = new Date()
const today = now.toISOString()
const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const lastWeek = new Date(now.getTime() - 7 * 86400000).toISOString()

test('a day counts done tasks, waiting moves, project sessions, escalation attempts and the egg', () => {
  const tasks = [
    { id: 'a', status: 'done', completed_at: today, size: 'XL', energyLevel: 3 },
    { id: 'b', status: 'done', completed_at: lastWeek },
    { id: 'c', status: 'waiting', waiting_at: today },
    { id: 'p', status: 'project', session_log: [{ timestamp: today }, { timestamp: lastWeek }] },
    { id: 'e', status: 'not_started', escalation_attempt_log: [{ at: today }] },
  ]
  const settings = { easter_egg_wins: { [ymd]: true } }
  assert.deepEqual(computeDailyStats(tasks, settings), { tasksToday: 5, finishedToday: 1 })
})

test('a task size or legacy point field never changes the count', () => {
  const small = [{ id: 'a', status: 'done', completed_at: today, size: 'XS' }]
  const big = [{ id: 'a', status: 'done', completed_at: today, size: 'XL', energyLevel: 3, stack_bonus: 40 }]
  assert.equal(computeDailyStats(small).tasksToday, computeDailyStats(big).tasksToday)
  // Legacy session/escalation entries still carrying `points` count once each.
  const legacy = [
    { id: 'p', status: 'project', session_log: [{ timestamp: today, points: 7 }] },
    { id: 'e', status: 'waiting', escalation_attempt_log: [{ at: today, points: 1 }] },
  ]
  assert.equal(computeDailyStats(legacy).tasksToday, 2)
})

test('no score is returned any more', () => {
  const stats = computeDailyStats([{ id: 'a', status: 'done', completed_at: today }])
  assert.equal('pointsToday' in stats, false)
  const records = computeRecords([{ id: 'a', status: 'done', completed_at: today }])
  assert.deepEqual(Object.keys(records), ['bestTasks'])
})

test('best day is the most tasks completed on one calendar day', () => {
  const day = (d, h) => new Date(2026, 9, d, h).toISOString()
  const tasks = [
    { status: 'done', completed_at: day(1, 9) },
    { status: 'done', completed_at: day(1, 15) },
    { status: 'done', completed_at: day(1, 20) },
    { status: 'done', completed_at: day(2, 9) },
    { status: 'not_started', completed_at: null },
  ]
  assert.equal(computeRecords(tasks).bestTasks, 3)
  assert.equal(computeRecords([]).bestTasks, 0)
})
