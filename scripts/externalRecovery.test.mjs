import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { engine, sandbox, fence, fixture } from './helpers/quokkaSandbox.mjs'
import { getExecution } from '../server/executionJournal.js'
import { reconcileExternal, previewExternalUndo, applyExternalUndo } from '../server/externalRecovery.js'
after(() => fence.restore())
const events = '/calendar/v3/calendars/primary/events'
const input = { summary: 'Synthetic event', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }
const mutations = s => s.external.calls.filter(c => ['POST','PATCH','DELETE'].includes(c.method))
async function create(t) {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_create_event', input)
  const record = await engine.commitPlan(id, s.deps)
  assert.equal(record.ok, true)
  return { s, id, record, step: record.results[0] }
}

test('lost Calendar create acknowledgement reconciles stable identity after reopen without granting unsafe Undo', async t => {
  const s = await sandbox(t)
  const id = s.session()
  const staged = await s.stage(id, 'gcal_create_event', input)
  assert.match(staged.id, /^b[0-9a-f]{40}$/)
  s.external.loseResponse('POST', events)
  const record = await engine.commitPlan(id, s.deps)
  const step = record.results[0]
  assert.equal(step.state, 'unknown')
  assert.equal(s.external.state.events[staged.id].summary, input.summary)
  await s.reopen()
  assert.equal((await engine.commitPlan(id, s.deps, record.revision)).replayed, true)
  const checked = await reconcileExternal(record.executionId, step.stepId, s.deps)
  assert.equal(checked.state, 'completed')
  assert.equal(checked.results[0].state, 'verified_applied')
  const preview = await previewExternalUndo(record.executionId, step.stepId, s.deps)
  assert.equal(preview.available, false, 'no initial ETag proof; a later edit may precede readback')
  assert.deepEqual(mutations(s).map(c => c.method), ['POST'])
  const receipts = JSON.stringify(getExecution(record.executionId))
  assert.equal(receipts.includes('synthetic-not-a-token'), false)
  assert.equal(receipts.includes(input.summary), false)
})

test('absent create readback cannot establish that an unacknowledged request will never land', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_create_event', input)
  s.external.fail('POST', events)
  const record = await engine.commitPlan(id, s.deps)
  const checked = await reconcileExternal(record.executionId, record.results[0].stepId, s.deps)
  assert.equal(checked.state, 'needs_checking')
  assert.equal(checked.results[0].state, 'unknown')
  assert.equal(mutations(s).length, 1)
})

test('same title/date without ownership marker is never proof of our create', async t => {
  const s = await sandbox(t)
  const id = s.session()
  const staged = await s.stage(id, 'gcal_create_event', input)
  s.external.loseResponse('POST', events)
  const record = await engine.commitPlan(id, s.deps)
  delete s.external.state.events[staged.id].extendedProperties
  assert.equal((await reconcileExternal(record.executionId, record.results[0].stepId, s.deps)).results[0].state, 'unknown')
})

test('Calendar stale stage revision and edit-away/back require review before PATCH', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_update_event', { event_id: 'exam-event', summary: 'Approved title' })
  Object.assign(s.external.state.events['exam-event'], { etag: 'later-even-if-title-returned', summary: 'Exam' })
  const record = await engine.commitPlan(id, s.deps)
  assert.equal(record.state, 'conflict')
  assert.equal(record.results[0].state, 'verified_no_effect')
  assert.equal(mutations(s).length, 0)
})

test('If-Match rejects a concurrent edit between update read and dispatch', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_update_event', { event_id: 'exam-event', summary: 'Approved title' })
  const gate = s.external.pause('PATCH', `${events}/exam-event`)
  t.after(gate.release)
  const running = engine.commitPlan(id, s.deps)
  await gate.entered
  Object.assign(s.external.state.events['exam-event'], { etag: 'concurrent', description: 'Preserved later edit' })
  gate.release()
  const record = await running
  assert.equal(record.results[0].state, 'verified_no_effect')
  assert.equal(s.external.state.events['exam-event'].summary, 'Exam')
  assert.equal(s.external.state.events['exam-event'].description, 'Preserved later edit')
})

test('Calendar update inverse changes only owned fields; lost Undo response is verified by marker readback', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_update_event', { event_id: 'exam-event', summary: 'Revised' })
  const record = await engine.commitPlan(id, s.deps)
  const step = record.results[0]
  const preview = await previewExternalUndo(record.executionId, step.stepId, s.deps)
  assert.deepEqual(preview.fields.map(f => f.field), ['summary'])
  s.external.loseResponse('PATCH', `${events}/exam-event`)
  const undone = await applyExternalUndo(record.executionId, step.stepId, preview.revision, s.deps)
  assert.equal(undone.ok, true)
  assert.equal(s.external.state.events['exam-event'].summary, 'Exam')
  assert.equal(s.external.state.events['exam-event'].description, fixture.external.events['exam-event'].description)
  assert.equal((await applyExternalUndo(record.executionId, step.stepId, preview.revision, s.deps)).replayed, true)
  assert.equal(mutations(s).length, 2)
})

test('later unrelated Calendar edit disables Undo rather than overwriting it', async t => {
  const { s, record, step } = await create(t)
  const target = s.external.state.events[step.result.event_id]
  target.description = 'Later edit'; target.etag = 'newer'
  const preview = await previewExternalUndo(record.executionId, step.stepId, s.deps)
  assert.equal(preview.available, false)
  assert.equal((await applyExternalUndo(record.executionId, step.stepId, preview.revision, s.deps)).state, 'conflict')
  assert.equal(target.description, 'Later edit')
  assert.equal(mutations(s).length, 1)
})

test('racing Calendar Undo confirmations dispatch one conditional inverse', async t => {
  const { s, record, step } = await create(t)
  const preview = await previewExternalUndo(record.executionId, step.stepId, s.deps)
  const outcomes = await Promise.all([1,2].map(() => applyExternalUndo(record.executionId, step.stepId, preview.revision, s.deps)))
  assert.equal(outcomes.filter(r => r.ok).length, 1)
  assert.equal(mutations(s).filter(c => c.method === 'DELETE').length, 1)
})

test('rejected Calendar compensation exposes residual identity; no unverified success and no blind retry', async t => {
  const { s, record, step } = await create(t)
  const preview = await previewExternalUndo(record.executionId, step.stepId, s.deps)
  s.external.fail('DELETE', `${events}/${step.result.event_id}`)
  const undone = await applyExternalUndo(record.executionId, step.stepId, preview.revision, s.deps)
  assert.equal(undone.state, 'needs_checking')
  assert.ok(s.external.state.events[step.result.event_id])
  assert.equal((await applyExternalUndo(record.executionId, step.stepId, preview.revision, s.deps)).replayed, true)
  await s.reopen()
  assert.equal((await reconcileExternal(record.executionId, step.stepId, s.deps)).state, 'needs_checking')
  assert.equal(mutations(s).filter(c => c.method === 'DELETE').length, 1)
  // An independent user action resolves the effect; checking closes both receipts.
  delete s.external.state.events[step.result.event_id]
  assert.equal((await reconcileExternal(record.executionId, step.stepId, s.deps)).state, 'undone')
  assert.equal(getExecution(undone.executionId).state, 'completed')
})

test('Trello partial checklist with rejected cleanup retains exact residuals and never replays', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'trello_add_checklist', { card_id: 'fixture-card', name: 'Packing', items: ['Milk'] })
  s.external.fail('POST', '/1/checklists/checklist-1/checkItems')
  s.external.fail('DELETE', '/1/checklists/checklist-1')
  const record = await engine.commitPlan(id, s.deps)
  assert.equal(record.results[0].evidence.cleanup, 'delete_rejected')
  assert.equal(record.results[0].evidence.checklistId, 'checklist-1')
  assert.ok(s.external.state.checklists['checklist-1'])
  const count = mutations(s).length
  await s.reopen()
  await reconcileExternal(record.executionId, record.results[0].stepId, s.deps)
  await engine.commitPlan(id, s.deps, record.revision)
  assert.equal(mutations(s).length, count)
})

test('unacknowledged Trello item is retained when cleanup cannot prove its identity', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'trello_add_checklist', { card_id: 'fixture-card', name: 'Packing', items: ['Milk'] })
  s.external.loseResponse('POST', '/1/checklists/checklist-1/checkItems')
  const record = await engine.commitPlan(id, s.deps)
  assert.equal(record.results[0].evidence.cleanup, 'conflict')
  assert.equal(s.external.state.checklists['checklist-1'].items.length, 1)
  assert.equal(s.external.calls.some(c => c.method === 'DELETE'), false)
})

test('Stop between checklist subrequests holds remaining items and avoids automatic cleanup', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'trello_add_checklist', { card_id: 'fixture-card', name: 'Packing', items: ['Milk','Bread'] })
  const gate = s.external.pause('POST', '/1/checklists/checklist-1/checkItems')
  t.after(gate.release)
  const running = engine.commitPlan(id, s.deps)
  await gate.entered
  engine.stopExecution(id)
  gate.release()
  const record = await running
  assert.equal(record.state, 'needs_checking')
  assert.equal(s.external.state.checklists['checklist-1'].items.length, 1)
  assert.equal(record.results[0].evidence.phase, 'stopped')
  assert.equal(s.external.calls.some(c => c.method === 'DELETE'), false)
})

test('Undo conflict at conditional DELETE preserves later edit and reports no inverse effect', async t => {
  const { s, record, step } = await create(t)
  const preview = await previewExternalUndo(record.executionId, step.stepId, s.deps)
  const gate = s.external.pause('DELETE', `${events}/${step.result.event_id}`)
  t.after(gate.release)
  const undo = applyExternalUndo(record.executionId, step.stepId, preview.revision, s.deps)
  await gate.entered
  Object.assign(s.external.state.events[step.result.event_id], { etag: 'edited-during-undo', summary: 'Preserve me' })
  gate.release()
  const outcome = await undo
  assert.equal(outcome.state, 'conflict')
  assert.equal(outcome.results[0].state, 'verified_no_effect')
  assert.equal(s.external.state.events[step.result.event_id].summary, 'Preserve me')
})

test('Calendar readback after lost update acknowledgement proves changed fields with its operation marker', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_update_event', { event_id: 'exam-event', description: 'Unacknowledged change' })
  s.external.loseResponse('PATCH', `${events}/exam-event`)
  const record = await engine.commitPlan(id, s.deps)
  assert.equal(record.results[0].state, 'unknown')
  const checked = await reconcileExternal(record.executionId, record.results[0].stepId, s.deps)
  assert.equal(checked.state, 'completed')
  assert.equal(checked.results[0].state, 'verified_applied')
  assert.equal(mutations(s).length, 1)
})

test('Trello successful HTTP cleanup without absent readback is not verified Undo', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'trello_add_checklist', { card_id: 'fixture-card', name: 'Packing', items: ['Milk'] })
  s.external.fail('POST', '/1/checklists/checklist-1/checkItems')
  const original = s.external.fetch.bind(s.external)
  fence.route((url, init) => init?.method === 'DELETE' ? Promise.resolve(Response.json({})) : original(url, init))
  const record = await engine.commitPlan(id, s.deps)
  assert.equal(record.results[0].state, 'unknown')
  assert.equal(record.results[0].evidence.cleanup, 'residual_present')
  assert.ok(s.external.state.checklists['checklist-1'])
})

test('checkpoint failure after external inverse recovers both receipts by readback after restart', async t => {
  const { s, record, step } = await create(t)
  const preview = await previewExternalUndo(record.executionId, step.stepId, s.deps)
  const { configureExecutionJournal } = await import('../server/executionJournal.js')
  configureExecutionJournal(s.connection, () => {
    if (s.external.calls.some(c => c.method === 'DELETE')) throw new Error('synthetic checkpoint loss after external inverse')
    s.persisted()
  })
  await assert.rejects(applyExternalUndo(record.executionId, step.stepId, preview.revision, s.deps))
  assert.equal(s.external.state.events[step.result.event_id], undefined)
  await s.reopen()
  assert.equal(getExecution(record.executionId).state, 'needs_checking')
  const checked = await reconcileExternal(record.executionId, step.stepId, s.deps)
  assert.equal(checked.state, 'undone')
  assert.equal(getExecution(checked.externalUndoId).state, 'completed')
  assert.equal(mutations(s).filter(c => c.method === 'DELETE').length, 1)
})

test('acknowledged Calendar create supports durable deduplicated Undo after reopen', async t => {
  const { s, record, step } = await create(t)
  await s.reopen()
  const preview = await previewExternalUndo(record.executionId, step.stepId, s.deps)
  assert.equal(preview.available, true)
  assert.equal((await applyExternalUndo(record.executionId, step.stepId, preview.revision, s.deps)).ok, true)
  await s.reopen()
  assert.equal((await applyExternalUndo(record.executionId, step.stepId, preview.revision, s.deps)).replayed, true)
  assert.deepEqual(mutations(s).map(c => c.method), ['POST','DELETE'])
})
