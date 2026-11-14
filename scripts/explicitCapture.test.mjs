import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { engine, db, fence, sandbox } from './helpers/quokkaSandbox.mjs'
import { registerMiscTools } from '../server/adviserToolsMisc.js'
import { explicitCapture, captureExplicit } from '../server/explicitCapture.js'
import { previewLocalUndo, applyLocalUndo } from '../server/localRecovery.js'
import { normalizeCapture } from '../server/capture.js'
import { getExecution } from '../server/executionJournal.js'
registerMiscTools()
after(() => fence.restore())
const request = (message, requestId = 'synthetic-request-0001') => ({ message, requestId, chatId: 'synthetic-chat' })

for (const message of ['add task: buy milk', 'Add this task buy milk and bread', 'please create a task: wash the car', 'save note: A useful observation', 'save this note: first line\nsecond line']) {
  test(`explicit literal authority: ${message}`, () => assert.ok(explicitCapture(message)))
}
for (const message of [
  'buy milk', 'What should I do?', 'Can you help me plan?', 'Do not add task: milk',
  'add task: milk, but don’t save anything', 'add task: milk only if the shop is open',
  'add task: milk and then schedule pickup', 'add task: milk. Also email Bob',
  'save note: test, send it to Bob', 'save note and a task: milk',
  'add task: call Bob tomorrow', 'add task: call Bob at 9am', 'add task: call Bob on 2026-12-01',
  'add task: tax paperwork, mark urgent', 'save note on Today: pin this',
  'add task: call Bob on December 5', 'add task: call Bob in 2 hours',
  'save a note to Notion: recipe', 'save note to Obsidian: recipe',
  'create task in my Trello: milk', 'add task: milk; delete the old task',
  '“add task: milk” is an example', 'add task:', 'save note: draft only, no changes',
]) test(`review/no immediate authority: ${message}`, () => assert.equal(explicitCapture(message), null))

test('task capture preserves overflow; existing voice normalization remains unchanged', () => {
  const raw = 'a'.repeat(800)
  const parsed = explicitCapture('add task: ' + raw)
  assert.equal(parsed.input.title.length, 500)
  assert.equal(parsed.input.notes, raw)
  assert.deepEqual(parsed.input, (({ title, notes }) => ({ title, notes }))(normalizeCapture({ text: raw, source: 'siri' })))
  assert.equal(explicitCapture('save note: ' + 'x'.repeat(2001)), null)
})

test('explicit task captures without model/dependencies; duplicate requests and restart return original receipt', async t => {
  const s = await sandbox(t)
  const payload = request('add task: buy milk')
  const outcomes = await Promise.all([captureExplicit(payload), captureExplicit(payload)])
  assert.equal(outcomes[0].outcome.ok, true)
  assert.equal(outcomes[1].outcome.replayed, true)
  assert.equal(outcomes[0].outcome.authority, 'explicit_capture')
  assert.equal(outcomes[1].outcome.executionId, outcomes[0].outcome.executionId)
  assert.equal(db.getAllTasks().filter(t => t.title === 'buy milk').length, 1)
  assert.equal(s.external.calls.length, 0)
  const created = db.getAllTasks().find(t => t.title === 'buy milk')
  assert.equal(created.due_date, null)
  assert.deepEqual(created.tags, [])
  engine.clearSession(outcomes[0].sessionId)
  await s.reopen()
  const replay = await captureExplicit(payload)
  assert.equal(replay.outcome.replayed, true)
  assert.equal(db.getAllTasks().filter(t => t.title === 'buy milk').length, 1)
  const preview = previewLocalUndo(replay.outcome.executionId)
  assert.equal(preview.available, true)
  assert.equal(applyLocalUndo(replay.outcome.executionId, preview.revision).ok, true)
  assert.equal(db.getTask(created.id), null)
  assert.equal((await captureExplicit(payload)).outcome.state, 'undone')
})

test('note capture writes exactly a note; it never falls back to task or pins/schedules implicitly', async t => {
  const s = await sandbox(t)
  const result = await captureExplicit(request('save note: Keep this exact observation', 'synthetic-note-request-01'))
  assert.equal(result.kind, 'note')
  assert.equal(result.outcome.ok, true)
  assert.equal(db.getAllNotes().length, 1)
  assert.equal(db.getAllNotes()[0].body, 'Keep this exact observation')
  assert.equal(db.getAllNotes()[0].pinned, false)
  assert.deepEqual(s.persisted().tasks, s.initial.tasks)
  const preview = previewLocalUndo(result.outcome.executionId)
  assert.equal(applyLocalUndo(result.outcome.executionId, preview.revision).ok, true)
  assert.equal(db.getAllNotes().length, 0)
})

test('no-action, scheduled, mixed and external requests cause no direct effects', async t => {
  const s = await sandbox(t)
  for (const text of ['do not add task: milk','add task: milk and schedule pickup','save note to Trello: quote','add task: exam tomorrow']) assert.deepEqual(await captureExplicit(request(text)), { handled: false })
  assert.deepEqual(s.persisted(), s.initial)
  assert.equal(s.external.calls.length, 0)
})

test('request identity rejects different concurrent content, then preserves the original capture', async t => {
  await sandbox(t)
  const first = captureExplicit(request('add task: Original'))
  await assert.rejects(captureExplicit(request('add task: Different')), /different content/)
  const result = await first
  assert.equal(result.outcome.ok, true)
  await assert.rejects(captureExplicit(request('save note: Different')), /different content/)
})

test('a busy/stopped session or uncertain execution cannot bypass recovery by using explicit capture', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Waiting review' })
  engine.setRunnerState(id, 'awaiting_confirm')
  assert.deepEqual(await captureExplicit({ ...request('add task: milk'), sessionId: id }), { handled: false })
  engine.stopExecution(id)
  assert.deepEqual(await captureExplicit({ ...request('add task: milk'), sessionId: id }), { handled: false })
  assert.deepEqual(s.persisted(), s.initial)
})

test('fresh process replays explicit capture receipt with no second task', async t => {
  const s = await sandbox(t)
  const payload = request('add task: Restart proof', 'synthetic-restart-request')
  const original = await captureExplicit(payload)
  const child = spawnSync(process.execPath, [new URL('./helpers/captureResume.mjs', import.meta.url).pathname, s.dbPath, JSON.stringify(payload)], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000 })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(child.stdout.split('\n').find(s => s.startsWith('CAPTURE=')).slice(8))
  assert.equal(result.outcome.replayed, true)
  assert.equal(result.outcome.executionId, original.outcome.executionId)
  await s.reopen()
  assert.equal(db.getAllTasks().filter(t => t.title === 'Restart proof').length, 1)
  assert.equal(getExecution(original.outcome.executionId).authority, 'explicit_capture')
})

test('unavailable capture storage never dispatches local or external work', async t => {
  const s = await sandbox(t)
  const { configureExecutionJournal } = await import('../server/executionJournal.js')
  configureExecutionJournal(s.connection, () => { throw new Error('synthetic capture disk failure') })
  await assert.rejects(captureExplicit(request('add task: Must not appear', 'synthetic-failure-request')))
  assert.equal(db.getAllTasks().some(t => t.title === 'Must not appear'), false)
  assert.equal(s.external.calls.length, 0)
  assert.deepEqual(s.persisted(), s.initial)
})
