import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planReminderSync, __testing } from '../server/reminderMerge.js'

const task = (o = {}) => ({
  id: 't1', title: 'Call the roofer', notes: '', remind_at: null,
  reminders_id: null, status: 'not_started', ...o,
})
const rem = (o = {}) => ({
  id: 'r1', title: 'Call the roofer', notes: '', remindAt: null, completed: false, ...o,
})
const shadow = (o = {}) => ({
  task_id: 't1', reminders_id: 'r1', title: 'Call the roofer', notes: '',
  remind_at: null, completed: 0, ...o,
})

// --- what goes out ---------------------------------------------------------

test('a task with a reminder time is pushed to Reminders', () => {
  const p = planReminderSync([task({ remind_at: '2026-08-05T15:00:00Z' })], [], [])
  assert.equal(p.toRemote.length, 1)
  assert.equal(p.toRemote[0].remindersId, null, 'a create, not an update')
  assert.equal(p.toRemote[0].taskId, 't1')
})

test('a task with NO reminder time is not pushed — the alarm list is not a backlog mirror', () => {
  const p = planReminderSync([task()], [], [])
  assert.equal(p.toRemote.length, 0)
})

test('an already-done task is not pushed out to ring at you', () => {
  const p = planReminderSync([task({ remind_at: '2026-08-05T15:00:00Z', status: 'done' })], [], [])
  assert.equal(p.toRemote.length, 0)
})

// --- the voice-capture inbox ----------------------------------------------

test('a reminder with no Boomerang task becomes one — this is the Siri path', () => {
  const p = planReminderSync([], [rem({ title: 'Buy milk' })], [])
  assert.equal(p.toCreateLocal.length, 1)
  assert.equal(p.toCreateLocal[0].title, 'Buy milk')
  assert.equal(p.toCreateLocal[0].remindersId, 'r1')
})

test('a reminder completed before Boomerang ever saw it is NOT imported', () => {
  const p = planReminderSync([], [rem({ completed: true })], [])
  assert.equal(p.toCreateLocal.length, 0)
  assert.equal(p.held[0].reason, 'remote_new_but_done')
})

test('an untitled reminder is skipped, and says so', () => {
  const p = planReminderSync([], [rem({ title: '   ' })], [])
  assert.equal(p.toCreateLocal.length, 0)
  assert.equal(p.held[0].reason, 'remote_untitled')
})

// --- 3-way: who moved ------------------------------------------------------

test('a local-only edit goes out, and does not come back', () => {
  const p = planReminderSync(
    [task({ reminders_id: 'r1', title: 'Call the roofer back' })],
    [rem()],
    [shadow()],
  )
  assert.equal(p.toRemote[0].title, 'Call the roofer back')
  assert.equal(p.toLocal.length, 0)
})

test('a remote-only edit comes in, and does not go back out', () => {
  const p = planReminderSync(
    [task({ reminders_id: 'r1' })],
    [rem({ title: 'Call the roofer about the gutter' })],
    [shadow()],
  )
  assert.equal(p.toLocal[0].fields.title, 'Call the roofer about the gutter')
  assert.equal(p.toRemote.length, 0)
})

test('when BOTH sides moved, Boomerang wins — and the discarded edit is reported', () => {
  const p = planReminderSync(
    [task({ reminders_id: 'r1', title: 'Boomerang version' })],
    [rem({ title: 'Reminders version' })],
    [shadow({ title: 'Original' })],
  )
  assert.equal(p.toRemote[0].title, 'Boomerang version')
  assert.equal(p.toLocal.length, 0)
  assert.ok(p.held.some(h => h.reason === 'conflict_local_wins'),
    'a discarded edit must never vanish silently')
})

test('with NO shadow, neither side can be proven to have moved — Boomerang wins, loudly', () => {
  const p = planReminderSync(
    [task({ reminders_id: 'r1', title: 'Boomerang version' })],
    [rem({ title: 'Reminders version' })],
    [],
  )
  assert.equal(p.toRemote[0].title, 'Boomerang version')
  assert.ok(p.held.some(h => h.reason === 'conflict_local_wins' && /no baseline/.test(h.detail)))
})

test('an untouched pair produces no writes at all', () => {
  const p = planReminderSync([task({ reminders_id: 'r1' })], [rem()], [shadow()])
  assert.equal(p.toRemote.length, 0)
  assert.equal(p.toLocal.length, 0)
})

// --- completion is the deliberate exception --------------------------------

test('completing in Boomerang completes in Reminders', () => {
  const p = planReminderSync(
    [task({ reminders_id: 'r1', status: 'done' })],
    [rem()],
    [shadow()],
  )
  assert.equal(p.toRemote[0].completed, true)
})

test('completing in Reminders completes in Boomerang, even though Boomerang is the record', () => {
  // Losing a completion re-rings an alarm for finished work, which is exactly
  // how a reminder system teaches you to ignore it.
  const p = planReminderSync(
    [task({ reminders_id: 'r1' })],
    [rem({ completed: true })],
    [shadow()],
    { nowISO: '2026-08-05T16:00:00Z' },
  )
  assert.equal(p.toLocal[0].fields.status, 'done')
  assert.equal(p.toLocal[0].fields.completed_at, '2026-08-05T16:00:00Z')
})

test('a completion already agreed on is not re-applied every sync', () => {
  const p = planReminderSync(
    [task({ reminders_id: 'r1', status: 'done' })],
    [rem({ completed: true })],
    [shadow({ completed: 1 })],
  )
  assert.equal(p.toRemote.length, 0)
  assert.equal(p.toLocal.length, 0)
})

// --- time comparison -------------------------------------------------------

test('the same instant in two formats is not a change — otherwise the sides write forever', () => {
  const p = planReminderSync(
    [task({ reminders_id: 'r1', remind_at: '2026-08-05T15:00:00Z' })],
    [rem({ remindAt: '2026-08-05T15:00:00.000Z' })],
    [shadow({ remind_at: '2026-08-05T15:00:00Z' })],
  )
  assert.equal(p.toRemote.length, 0, 'no write ping-pong')
  assert.equal(p.toLocal.length, 0)
})

test('seconds are noise; minutes are not', () => {
  assert.equal(__testing.sameTime('2026-08-05T15:00:00Z', '2026-08-05T15:00:30Z'), true)
  assert.equal(__testing.sameTime('2026-08-05T15:00:00Z', '2026-08-05T15:02:00Z'), false)
})

test('a cleared reminder time propagates rather than being read as "no change"', () => {
  const p = planReminderSync(
    [task({ reminders_id: 'r1', remind_at: null })],
    [rem({ remindAt: '2026-08-05T15:00:00Z' })],
    [shadow({ remind_at: '2026-08-05T15:00:00Z' })],
  )
  assert.equal(p.toRemote.length, 1)
  assert.equal(p.toRemote[0].remindAt, null)
})

// --- deletion safety -------------------------------------------------------

test('a reminder deleted in Apple\'s app drops the LINK, never the task', () => {
  // A swipe in Reminders must not be able to destroy work that lives here.
  const p = planReminderSync([task({ reminders_id: 'r1' })], [], [shadow()])
  assert.deepEqual(p.toUnlink, ['t1'])
  assert.ok(p.held.some(h => h.reason === 'remote_deleted'))
})

test('losing most of the list is a bad read, not a mass delete', () => {
  const tasks = Array.from({ length: 10 }, (_, i) =>
    task({ id: `t${i}`, reminders_id: `r${i}` }))
  const p = planReminderSync(tasks, [rem({ id: 'r0' })], [])
  assert.equal(p.toUnlink.length, 0, 'nothing unlinked on a suspicious read')
  assert.ok(p.held.some(h => h.reason === 'suspicious_disappearance'))
})

test('below the floor, a small list can legitimately empty out', () => {
  // Deleting 2 of 3 reminders is an ordinary afternoon.
  const tasks = [task({ id: 't0', reminders_id: 'r0' }), task({ id: 't1', reminders_id: 'r1' })]
  const p = planReminderSync(tasks, [], [])
  assert.equal(p.toUnlink.length, 2)
  assert.ok(!p.held.some(h => h.reason === 'suspicious_disappearance'))
})

// --- robustness ------------------------------------------------------------

test('junk on either side is skipped rather than throwing', () => {
  const p = planReminderSync(
    [null, {}, task({ reminders_id: 'r1' })],
    [null, {}, rem()],
    [null, shadow()],
  )
  assert.ok(Array.isArray(p.toRemote))
})

test('empty everything is a valid no-op plan', () => {
  const p = planReminderSync([], [], [])
  assert.deepEqual(p.toRemote, [])
  assert.deepEqual(p.toLocal, [])
  assert.deepEqual(p.toCreateLocal, [])
  assert.deepEqual(p.toUnlink, [])
})

test('the plan never mutates its inputs', () => {
  const t = task({ reminders_id: 'r1', title: 'Local' })
  const r = rem({ title: 'Remote' })
  const s = shadow({ title: 'Base' })
  const before = JSON.stringify([t, r, s])
  planReminderSync([t], [r], [s])
  assert.equal(JSON.stringify([t, r, s]), before)
})
