import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { engine, db, fence, sandbox } from './helpers/quokkaSandbox.mjs'
import { previewLocalUndo, applyLocalUndo } from '../server/localRecovery.js'
after(() => fence.restore())
const events = '/calendar/v3/calendars/primary/events'
const event = { summary: 'Synthetic recovery', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }

async function stopped(t) {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'First applied' })
  await s.stage(id, 'gcal_create_event', event)
  await s.stage(id, 'update_task', { id: 'exam', notes: 'Remaining approved' })
  engine.enqueueMessage(id, { message: 'Held follow-up', history: [] })
  const gate = s.external.pause('POST', events)
  t.after(gate.release)
  const running = engine.commitPlan(id, s.deps)
  await gate.entered
  assert.equal(engine.stopExecution(id).state, 'stopping')
  gate.release()
  const record = await running
  assert.equal(record.state, 'stopped')
  assert.deepEqual(record.results.map(r => r.state), ['reported_applied','verified_applied','not_started'])
  assert.equal(db.getTask('exam').title, 'First applied', 'Stop never auto-reverses')
  assert.equal(db.getTask('exam').notes, 'Synthetic fixture')
  assert.equal(engine.getSession(id).queue.length, 1)
  return { s, id, record }
}

test('Stop blocks subsequent dispatch; Continue races dispatch remaining work exactly once', async t => {
  const { s, record } = await stopped(t)
  const outcomes = await Promise.all([
    engine.recoverExecution(record.executionId, record.sequence, 'continue', s.deps),
    engine.recoverExecution(record.executionId, record.sequence, 'continue', s.deps),
    engine.recoverExecution(record.executionId, record.sequence, 'modify', s.deps),
  ])
  assert.equal(outcomes.filter(r => r.ok).length, 1)
  assert.equal(s.external.calls.filter(c => c.method === 'POST').length, 1)
  assert.equal(db.getTask('exam').notes, 'Remaining approved')
})

test('stopped commands, owned versions, held queue and cursors survive database reopening', async t => {
  const { s, id, record } = await stopped(t)
  engine.clearSession(id)
  await s.reopen()
  const snapshot = engine.sessionSnapshot(id)
  assert.equal(snapshot.runnerState, 'stopped')
  assert.equal(snapshot.queue[0].message, 'Held follow-up')
  assert.equal((await engine.recoverExecution(record.executionId, record.sequence, 'continue', s.deps)).ok, true)
  assert.equal(db.getTask('exam').notes, 'Remaining approved')
  assert.equal(s.external.calls.filter(c => c.method === 'POST').length, 1)
})

test('Modify claims remaining work, preserves completed evidence, requires a new reviewed plan', async t => {
  const { s, record } = await stopped(t)
  const modified = await engine.recoverExecution(record.executionId, record.sequence, 'modify', {})
  assert.equal(modified.state, 'modified')
  const next = engine.getSession(modified.sessionId)
  assert.equal(next.plan.length, 0)
  assert.equal(next.modificationContext.remaining.length, 1)
  assert.equal(next.modificationContext.completed.length, 2)
  assert.equal((await engine.recoverExecution(record.executionId, record.sequence, 'continue', s.deps)).state, 'conflict')
  await s.stage(modified.sessionId, 'update_task', { id: 'exam', notes: 'Reviewed revision' })
  assert.equal(db.getTask('exam').notes, 'Synthetic fixture')
  assert.equal((await engine.commitPlan(modified.sessionId, s.deps)).ok, true)
  assert.equal(db.getTask('exam').notes, 'Reviewed revision')
  engine.clearSession(modified.sessionId)
})

test('Undo and Continue share the stopped execution state and cannot both apply', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Stopped local edit' })
  await s.stage(id, 'update_task', { id: 'exam', notes: 'Must not dispatch' })
  // Local steps yield to the event loop between dispatches.
  const committing = engine.commitPlan(id, s.deps)
  engine.stopExecution(id)
  const record = await committing
  assert.equal(record.state, 'stopped')
  const preview = previewLocalUndo(record.executionId)
  assert.equal(preview.available, true)
  assert.equal(applyLocalUndo(record.executionId, preview.revision).ok, true)
  assert.equal(db.getTask('exam').title, 'Prepare exam')
  assert.equal((await engine.recoverExecution(record.executionId, record.sequence, 'continue', s.deps)).state, 'conflict')
})

test('unknown in-flight result blocks Continue and Modify; Stop preserves known local changes', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Preserve on Stop' })
  await s.stage(id, 'gcal_create_event', event)
  await s.stage(id, 'update_task', { id: 'exam', notes: 'Blocked' })
  const gate = s.external.pause('POST', events)
  t.after(gate.release)
  // Both faults are consumed by this call: pause then response loss is
  // represented by a fence wrapper that throws after the fake side effect.
  const original = s.external.fetch.bind(s.external)
  fence.route(async (url, init) => {
    const response = await original(url, init)
    if (init?.method === 'POST') throw new TypeError('synthetic response loss')
    return response
  })
  const running = engine.commitPlan(id, s.deps)
  await gate.entered
  engine.stopExecution(id)
  gate.release()
  const record = await running
  assert.equal(record.state, 'needs_checking')
  assert.equal(record.results[1].state, 'unknown')
  assert.equal(db.getTask('exam').title, 'Preserve on Stop')
  for (const choice of ['continue','modify']) assert.equal((await engine.recoverExecution(record.executionId, record.sequence, choice, s.deps)).state, 'conflict')
})

test('monotonic cursor detects rollover and supplies authoritative snapshot without replaying prior turns', async t => {
  const s = await sandbox(t)
  const id = s.session()
  engine.appendEvent(id, { type: 'turn', data: { n: 1 } })
  engine.appendEvent(id, { type: 'message', data: { text: 'Authoritative answer' } })
  for (let n = 0; n < 510; n++) engine.appendEvent(id, { type: 'tool_call', data: { n } })
  engine.setRunnerState(id, 'stopped')
  const snapshot = engine.sessionSnapshot(id, 1)
  assert.equal(snapshot.gap, true)
  assert.ok(snapshot.snapshotEvents.some(e => e.data.text === 'Authoritative answer'))
  assert.equal(snapshot.runnerState, 'stopped')
  assert.deepEqual(engine.sessionSnapshot(id, snapshot.cursor).events, [])
  engine.clearSession(id)
  await s.reopen()
  assert.equal(engine.sessionSnapshot(id).cursor, snapshot.cursor)
})

test('fresh process continues only known unstarted local commands', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Applied before restart' })
  await s.stage(id, 'update_task', { id: 'exam', notes: 'Only remaining command' })
  const running = engine.commitPlan(id, s.deps)
  engine.stopExecution(id)
  const stopped = await running
  const child = spawnSync(process.execPath, [new URL('./helpers/executionResume.mjs', import.meta.url).pathname, s.dbPath, stopped.executionId], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000 })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(child.stdout.split('\n').find(s => s.startsWith('RESUMED=')).slice(8))
  assert.equal(result.outcome.ok, true)
  assert.equal(result.title, 'Applied before restart')
  assert.equal(result.notes, 'Only remaining command')
  assert.deepEqual(result.blocked, [])
  await s.reopen() // do not let the parent's older in-memory DB overwrite the child
})

test('settling Undo retires only its own stopped draft and preserves newer staged work', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Undo then capture' })
  await s.stage(id, 'update_task', { id: 'exam', notes: 'Never dispatch' })
  const running = engine.commitPlan(id, s.deps)
  engine.stopExecution(id)
  const record = await running
  const preview = previewLocalUndo(record.executionId)
  assert.equal(applyLocalUndo(record.executionId, preview.revision).ok, true)
  engine.settleUndoneSession(record.executionId)
  assert.equal(engine.getSession(id).runnerState, 'idle')
  assert.equal(engine.getSession(id).plan.length, 0)
  await s.stage(id, 'update_task', { id: 'exam', notes: 'New plan must survive old Undo settlement' })
  engine.settleUndoneSession(record.executionId)
  assert.equal(engine.getSession(id).plan.length, 1)
})
