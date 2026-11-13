import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { sandbox, fence, engine, db } from './helpers/quokkaSandbox.mjs'
import { registerMiscTools } from '../server/adviserToolsMisc.js'
import { applyLocalUndo, previewLocalUndo } from '../server/localRecovery.js'
import { getExecution } from '../server/executionJournal.js'
import { configureExecutionJournal } from '../server/executionJournal.js'
import { spawnSync } from 'node:child_process'

registerMiscTools()
after(() => fence.restore())
async function execute(s, steps) {
  const session = s.session()
  for (const [name, input] of steps) await s.stage(session, name, input)
  const result = await engine.commitPlan(session, s.deps)
  assert.equal(result.ok, true, JSON.stringify(result))
  return result
}
const patch = title => ['update_task', { id: 'exam', title }]

test('preview does not mutate; Undo after reopen restores only owned fields and replays one receipt', async t => {
  const s = await sandbox(t)
  const result = await execute(s, [patch('New title')])
  db.updateTaskPartial('exam', { notes: 'Later unrelated note' })
  const beforePreview = s.persisted()
  engine.clearSession(result.sessionId)
  await s.reopen()
  const preview = previewLocalUndo(result.executionId)
  assert.equal(preview.available, true)
  assert.deepEqual(preview.actions[0].fields, [{ field: 'title', from: 'New title', to: 'Prepare exam' }])
  assert.deepEqual(s.persisted(), beforePreview)
  const undone = applyLocalUndo(result.executionId, preview.revision)
  assert.equal(undone.ok, true)
  assert.equal(db.getTask('exam').title, 'Prepare exam')
  assert.equal(db.getTask('exam').notes, 'Later unrelated note')
  assert.equal(getExecution(result.executionId).state, 'undone')
  const duplicate = applyLocalUndo(result.executionId, preview.revision)
  assert.equal(duplicate.replayed, true)
  assert.equal(duplicate.executionId, undone.executionId)
  assert.equal(previewLocalUndo(result.executionId).available, false)
})

test('same-field later edit, including editing away and back, invalidates Undo', async t => {
  const s = await sandbox(t)
  const result = await execute(s, [patch('New title')])
  db.updateTaskPartial('exam', { title: 'Later title' })
  db.updateTaskPartial('exam', { title: 'New title' })
  const preview = previewLocalUndo(result.executionId)
  assert.equal(preview.available, false)
  assert.match(preview.actions[0].reason, /edited/)
  assert.equal(applyLocalUndo(result.executionId, preview.revision).ok, false)
  assert.equal(db.getTask('exam').title, 'New title')
})

test('edit after preview is refused without overwriting the user edit', async t => {
  const s = await sandbox(t)
  const result = await execute(s, [patch('New title')])
  const preview = previewLocalUndo(result.executionId)
  db.updateTaskPartial('exam', { title: 'After preview' })
  assert.equal(applyLocalUndo(result.executionId, preview.revision).state, 'conflict')
  assert.equal(db.getTask('exam').title, 'After preview')
})

test('two updates of one field form one reversible chain', async t => {
  const s = await sandbox(t)
  const result = await execute(s, [patch('First'), patch('Second')])
  const preview = previewLocalUndo(result.executionId)
  assert.equal(preview.available, true)
  assert.equal(applyLocalUndo(result.executionId, preview.revision).ok, true)
  assert.equal(db.getTask('exam').title, 'Prepare exam')
})

test('create then update task can be undone together', async t => {
  const s = await sandbox(t)
  const session = s.session()
  const created = await s.stage(session, 'create_task', { title: 'New task' })
  await s.stage(session, 'update_task', { id: created.id, title: 'Updated own task' })
  const result = await engine.commitPlan(session, s.deps)
  assert.equal(result.ok, true)
  const preview = previewLocalUndo(result.executionId)
  assert.equal(preview.available, true, JSON.stringify(preview))
  assert.equal(applyLocalUndo(result.executionId, preview.revision).ok, true)
  assert.equal(db.getTask(created.id), null)
})

for (const modification of ['edit', 'child', 'blocker', 'connection']) {
  test(`created task Undo refuses later ${modification}`, async t => {
    const s = await sandbox(t)
    const result = await execute(s, [['create_task', { title: 'New task' }]])
    const id = result.results[0].result.id
    if (modification === 'edit') db.updateTaskPartial(id, { notes: 'User added this' })
    if (modification === 'child') db.upsertTask({ id: 'child', title: 'Dependent child', parent_id: id })
    if (modification === 'blocker') db.upsertTask({ id: 'blocked', title: 'Blocked', blocked_by: [id] })
    if (modification === 'connection') db.updateTaskPartial(id, { trello_card_id: 'new-link' })
    const preview = previewLocalUndo(result.executionId)
    assert.equal(preview.available, false)
    assert.equal(applyLocalUndo(result.executionId, preview.revision).ok, false)
    assert.ok(db.getTask(id))
  })
}

test('note create/update Undo survives reopening', async t => {
  const s = await sandbox(t)
  const session = s.session()
  const created = await s.stage(session, 'create_note', { body: 'Original note', pinned: false })
  await s.stage(session, 'update_note', { id: created.id, body: 'Updated note' })
  const result = await engine.commitPlan(session, s.deps)
  assert.equal(result.ok, true)
  await s.reopen()
  const preview = previewLocalUndo(result.executionId)
  assert.equal(preview.available, true)
  assert.equal(applyLocalUndo(result.executionId, preview.revision).ok, true)
  assert.equal(db.getNote(created.id), null)
})

test('raw database writes invalidate a staged patch before any external action', async t => {
  const s = await sandbox(t)
  const session = s.session()
  await s.stage(session, 'gcal_create_event', { summary: 'Must not create', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } })
  await s.stage(session, ...patch('Stale title'))
  s.connection.run("UPDATE tasks SET title='Another writer' WHERE id='exam'")
  const result = await engine.commitPlan(session, s.deps)
  assert.equal(result.state, 'conflict')
  assert.equal(s.external.calls.length, 0)
  assert.equal(db.getTask('exam').title, 'Another writer')
})

test('partial local Undo explicitly leaves unsupported external action unchanged', async t => {
  const s = await sandbox(t)
  const result = await execute(s, [patch('New title'), ['gcal_create_event', { summary: 'Keep external', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }]])
  const externalBefore = structuredClone(s.external.state)
  const preview = previewLocalUndo(result.executionId)
  assert.equal(preview.available, true)
  assert.deepEqual(preview.unsupported, ['gcal_create_event'])
  assert.equal(applyLocalUndo(result.executionId, preview.revision).ok, true)
  assert.equal(db.getTask('exam').title, 'Prepare exam')
  assert.deepEqual(s.external.state, externalBefore)
  assert.equal(getExecution(result.executionId).state, 'partial')
})

test('unsupported task completion does not advertise Undo', async t => {
  const s = await sandbox(t)
  const result = await execute(s, [['complete_task', { id: 'exam' }]])
  const preview = previewLocalUndo(result.executionId)
  assert.equal(preview.available, false)
  assert.deepEqual(preview.actions, [])
  assert.deepEqual(preview.unsupported, ['complete_task'])
})

test('created record in a mixed external plan cannot be deleted by local Undo', async t => {
  const s = await sandbox(t)
  const result = await execute(s, [['create_task', { title: 'Potentially referenced' }], ['gcal_create_event', { summary: 'Related external event', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }]])
  const preview = previewLocalUndo(result.executionId)
  assert.equal(preview.available, false)
  assert.match(preview.actions[0].reason, /may refer/)
  assert.ok(db.getTask(result.results[0].result.id))
})

test('failure compensation refuses to erase a later same-field edit', async t => {
  const s = await sandbox(t)
  const session = s.session()
  await s.stage(session, ...patch('Initial change'))
  await s.stage(session, 'gcal_create_event', { summary: 'Pause here', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } })
  await s.stage(session, 'gcal_update_event', { event_id: 'missing-event', summary: 'Fail after pause' })
  const gate = s.external.pause('POST', '/calendar/v3/calendars/primary/events')
  t.after(gate.release)
  const committing = engine.commitPlan(session, s.deps)
  await gate.entered
  db.updateTaskPartial('exam', { title: 'Later user title' })
  gate.release()
  const result = await committing
  assert.equal(result.ok, false)
  assert.equal(db.getTask('exam').title, 'Later user title')
  assert.equal(result.results[0].state, 'compensation_unverified')
})

test('unsupported project/child create-update chains preserve existing execution behavior', async t => {
  const s = await sandbox(t)
  const session = s.session()
  const project = await s.stage(session, 'create_task', { title: 'Project', status: 'project' })
  const child = await s.stage(session, 'create_task', { title: 'Child', parent_id: project.id })
  await s.stage(session, 'update_task', { id: child.id, title: 'Edited child' })
  const result = await engine.commitPlan(session, s.deps)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(db.getTask(child.id).title, 'Edited child')
  assert.equal(previewLocalUndo(result.executionId).available, false)
})

test('a fresh process can Undo using persisted inverse data without model sessions or closures', async t => {
  const s = await sandbox(t)
  const result = await execute(s, [patch('Persisted forward change')])
  const preview = previewLocalUndo(result.executionId)
  const child = spawnSync(process.execPath, [new URL('./helpers/localUndoRestart.mjs', import.meta.url).pathname, s.dbPath, result.executionId, preview.revision], {
    env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000,
  })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
  const reply = JSON.parse(child.stdout.split('\n').find(line => line.startsWith('UNDO_RESULT=')).slice('UNDO_RESULT='.length))
  assert.equal(reply.ok, true)
  await s.reopen()
  assert.equal(db.getTask('exam').title, 'Prepare exam')
  assert.equal(applyLocalUndo(result.executionId, preview.revision).replayed, true)
})

test('Undo checkpoint failure keeps persisted forward state and an unknown receipt, never auto-replays', async t => {
  const s = await sandbox(t)
  const result = await execute(s, [patch('Keep persisted until verified')])
  const preview = previewLocalUndo(result.executionId)
  let saves = 0
  configureExecutionJournal(s.connection, () => {
    if (++saves === 2) throw new Error('injected Undo export failure')
    db.flushNow()
  })
  const undone = applyLocalUndo(result.executionId, preview.revision)
  assert.equal(undone.ok, false)
  assert.equal(undone.state, 'needs_checking')
  // Reopen directly, without exporting the failed in-memory mutation.
  await s.reopen()
  assert.equal(db.getTask('exam').title, 'Keep persisted until verified')
  const replay = applyLocalUndo(result.executionId, preview.revision)
  assert.equal(replay.replayed, true)
  assert.equal(replay.ok, false)
  assert.equal(db.getTask('exam').title, 'Keep persisted until verified')
})

test('Undo follows the shared case-insensitive critical-tag policy and permits ordinary tags', async t => {
  const s = await sandbox(t)
  db.updateTaskPartial('exam', { tags: [{ id: 'CRITICAL' }] })
  const critical = await execute(s, [patch('Critical task change')])
  assert.equal(previewLocalUndo(critical.executionId).available, false)
  const ordinary = await execute(s, [['create_task', { title: 'Ordinary tagged task', tags: ['home'] }]])
  const preview = previewLocalUndo(ordinary.executionId)
  assert.equal(preview.available, true)
  assert.equal(applyLocalUndo(ordinary.executionId, preview.revision).ok, true)
})

test('failure compensation keeps a created record when an uncertain external effect may refer to it', async t => {
  const s = await sandbox(t)
  const session = s.session()
  const created = await s.stage(session, 'create_task', { title: 'Keep until reconciled' })
  await s.stage(session, 'gcal_create_event', { summary: 'Uncertain external reference', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } })
  s.external.loseResponse('POST', '/calendar/v3/calendars/primary/events')
  const result = await engine.commitPlan(session, s.deps)
  assert.equal(result.ok, false)
  assert.ok(db.getTask(created.id))
  assert.equal(result.results[0].state, 'compensation_unverified')
  assert.equal(previewLocalUndo(result.executionId).available, false)
})

test('dated task creation does not offer deletion Undo before notification recovery is covered', async t => {
  const s = await sandbox(t)
  const result = await execute(s, [['create_task', { title: 'Dated obligation', due_date: '2026-11-20' }]])
  assert.equal(previewLocalUndo(result.executionId).available, false)
  assert.ok(db.getTask(result.results[0].result.id))
})
