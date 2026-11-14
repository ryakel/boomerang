// P1 characterization: PASS means today's behavior was reproduced, NOT that
// known risks are fixed. See wiki/Quokka-P1-Risk-Register.md before interpreting.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { db, engine, fence, fixture, sandbox, restartWorker, deferred } from './helpers/quokkaSandbox.mjs'

after(() => fence.restore())
const EVENTS = '/calendar/v3/calendars/primary/events'
const eventInput = { summary: 'Synthetic new event', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }
const taskRow = (s, id = 'exam') => s.persisted().tasks.find(r => r.id === id)

function assertRestoredContent(s) {
  const normalized = value => ({ ...value, tasks: value.tasks.map(task => {
    if (task.id !== 'exam') return task
    const copy = { ...task }; delete copy.last_touched; delete copy.updated_at
    return copy
  }) })
  assert.deepEqual(normalized(s.persisted()), normalized(s.initial))
}

const newEvents = s => Object.keys(s.external.state.events).filter(id => id.startsWith('created-'))

test('isolation canaries: providers, HTTP/socket/TLS/UDP cannot escape', async () => {
  await fence.verify()
})

test('baseline: isolated persisted fixtures; no writes until Apply, exact task/calendar changes after', async t => {
  const s = await sandbox(t)
  const id = s.session()
  const read = await engine.handleToolCall(id, 'get_task', { id: 'exam' }, s.deps)
  assert.equal(read.data.id, 'exam')
  await s.stage(id, 'update_task', { id: 'exam', due_date: '2026-11-20' })
  await s.stage(id, 'gcal_update_event', { event_id: 'exam-event', start: { date: '2026-11-20' } })
  engine.setRunnerState(id, 'awaiting_confirm')
  await Promise.resolve() // fake plan-ready callback; no notification transport
  assert.deepEqual(s.persisted(), s.initial)
  assert.deepEqual(s.external.state, fixture.external)
  assert.deepEqual(s.notifications, [{ type: 'plan-ready', id }])
  const result = await engine.commitPlan(id, s.deps)
  assert.equal(result.ok, true)
  assert.equal(result.broadcastNeeded, true)
  assert.deepEqual(result.results.map(r => r.toolName), ['update_task', 'gcal_update_event'])
  assert.equal(taskRow(s).due_date, '2026-11-20')
  assert.equal(s.external.state.events['exam-event'].start.date, '2026-11-20')
  assert.equal(engine.getSession(id).plan.length, 0)
  assert.deepEqual(s.persisted().data, s.initial.data)
})

test('baseline: scripted no-action and rejected unknown tool leave all state unchanged', async t => {
  const s = await sandbox(t)
  const id = s.session()
  assert.match((await engine.handleToolCall(id, 'not_registered', {}, s.deps)).error, /Unknown tool/)
  const result = await engine.commitPlan(id, s.deps)
  assert.equal(result.ok, true)
  assert.deepEqual(result.results, [])
  assert.deepEqual(s.persisted(), s.initial)
  assert.deepEqual(s.external.state, fixture.external)
})

test('R1 FIXED: simultaneous Apply shares one execution and creates one external event', { timeout: 5000 }, async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_create_event', eventInput)
  const gate = s.external.pause('POST', EVENTS)
  t.after(gate.release)
  const first = engine.commitPlan(id, s.deps)
  const second = engine.commitPlan(id, s.deps)
  await gate.entered
  assert.equal(newEvents(s).length, 0)
  gate.release()
  const outcomes = await Promise.all([first, second])
  assert.deepEqual(outcomes.map(r => r.ok), [true, false])
  assert.equal(outcomes[1].state, 'running')
  assert.equal(outcomes[1].executionId, outcomes[0].executionId)
  assert.equal(newEvents(s).length, 1)
  assert.deepEqual(s.persisted(), s.initial)
})

test('R2 FIXED: lost successful response returns original receipt without another effect', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_create_event', eventInput)
  // Server finishes; transport discards response. Caller has UNKNOWN outcome.
  const lost = await engine.commitPlan(id, s.deps)
  assert.equal(lost.results.length, 1)
  const retry = await engine.commitPlan(id, s.deps)
  assert.equal(retry.ok, true)
  assert.deepEqual(retry.results, lost.results)
  assert.equal(newEvents(s).length, 1, 'sequential retry duplication hypothesis falsified')
  assert.equal(engine.getSession(id).events.filter(e => e.type === 'committed').length, 1)
  assert.deepEqual(s.persisted(), s.initial)
})

test('R3 FIXED: stale task patches preserve the newer edit and require review', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', due_date: '2026-11-20' })
  db.updateTaskPartial('exam', { due_date: '2026-11-22', notes: 'Concurrent edit kept on another field' })
  assert.equal(taskRow(s).due_date, '2026-11-22')
  const result = await engine.commitPlan(id, s.deps)
  assert.equal(result.ok, false)
  assert.equal(result.state, 'conflict')
  assert.equal(taskRow(s).due_date, '2026-11-22')
  assert.equal(taskRow(s).notes, 'Concurrent edit kept on another field')
  assert.deepEqual(s.external.state, fixture.external)
})

test('R2b FIXED: lost external create response remains unknown and cannot be retried blindly', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_create_event', eventInput)
  s.external.loseResponse('POST', EVENTS)
  const failed = await engine.commitPlan(id, s.deps)
  assert.equal(failed.ok, false)
  assert.equal(failed.state, 'needs_checking')
  assert.equal(newEvents(s).length, 1, 'external write happened despite failed acknowledgment')
  assert.equal((await engine.commitPlan(id, s.deps)).ok, false)
  assert.equal(newEvents(s).length, 1)
  assert.deepEqual(s.persisted(), s.initial)
})

test('R3b FIXED: field-scoped rollback preserves an intervening edit', { timeout: 5000 }, async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Will roll back' })
  await s.stage(id, 'gcal_create_event', eventInput)
  await s.stage(id, 'gcal_update_event', { event_id: 'missing-event', summary: 'Force later failure' })
  const gate = s.external.pause('POST', EVENTS)
  t.after(gate.release)
  const committing = engine.commitPlan(id, s.deps)
  await gate.entered
  db.updateTaskPartial('exam', { notes: 'Concurrent user edit during commit' })
  assert.equal(taskRow(s).notes, 'Concurrent user edit during commit')
  gate.release()
  assert.equal((await committing).ok, false)
  assert.equal(taskRow(s).notes, 'Concurrent user edit during commit')
  assert.equal(taskRow(s).title, 'Prepare exam')
  assert.deepEqual(s.external.state, fixture.external)
})

test('R4 FIXED: Stop during an awaited commit prevents later dispatch', { timeout: 5000 }, async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_create_event', eventInput)
  await s.stage(id, 'update_task', { id: 'exam', due_date: '2026-11-20' })
  const gate = s.external.pause('POST', EVENTS)
  t.after(gate.release)
  const committing = engine.commitPlan(id, s.deps)
  await gate.entered
  engine.stopExecution(id)
  gate.release()
  assert.equal((await committing).state, 'stopped')
  assert.equal(engine.getSession(id).runnerState, 'stopped')
  assert.equal(newEvents(s).length, 1)
  assert.equal(taskRow(s).due_date, fixture.tasks.find(t => t.id === 'exam').due_date, 'post-Stop step never dispatched')
})

test('baseline: failed external step compensates prior task changes in reverse order', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'First change' })
  await s.stage(id, 'update_task', { id: 'exam', title: 'Second change' })
  await s.stage(id, 'gcal_create_event', eventInput)
  s.external.fail('POST', EVENTS)
  const result = await engine.commitPlan(id, s.deps)
  assert.equal(result.ok, false)
  assert.deepEqual(result.results.map(r => r.ok), [false, false, false])
  assert.deepEqual(result.results.map(r => r.state), ['verified_undone', 'verified_undone', 'unknown'])
  assertRestoredContent(s)
  assert.deepEqual(s.external.state, fixture.external)
  assert.equal(engine.getSession(id).runnerState, 'errored')
})

test('R5 REPRO: a tool that fails after a remote partial write leaves that write behind', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Will roll back' })
  await s.stage(id, 'trello_add_checklist', { card_id: 'fixture-card', name: 'Packing', items: ['Milk'] })
  s.external.fail('POST', '/1/checklists/checklist-1/checkItems')
  const result = await engine.commitPlan(id, s.deps)
  assert.equal(result.ok, false)
  assertRestoredContent(s)
  assert.deepEqual(s.external.state.checklists, { 'checklist-1': { id: 'checklist-1', name: 'Packing', items: [] } })
  assert.deepEqual(s.external.state.events, fixture.external.events)
  assert.equal(s.external.calls.some(c => c.method === 'DELETE'), false, 'failing tool never returned compensation')
})

test('R6 REPRO: HTTP failure during compensation leaves external divergence without receipt detail', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Will roll back' })
  await s.stage(id, 'gcal_create_event', eventInput)
  await s.stage(id, 'gcal_update_event', { event_id: 'missing-event', summary: 'Force later failure' })
  s.external.fail('DELETE', `${EVENTS}/created-1`)
  const result = await engine.commitPlan(id, s.deps)
  assert.equal(result.ok, false)
  assert.equal(result.state, 'partial')
  assertRestoredContent(s)
  assert.equal(newEvents(s).length, 1)
  assert.equal('compensationErrors' in result, false, 'rollback HTTP status is not surfaced')
  assert.equal(s.external.calls.at(-1).method, 'DELETE')
})

test('R7 REPRO: external delete is irreversible when a subsequent step fails', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_delete_event', { event_id: 'exam-event' })
  await s.stage(id, 'gcal_update_event', { event_id: 'missing-event', summary: 'Force later failure' })
  const warnings = []
  t.mock.method(console, 'warn', message => warnings.push(message))
  assert.equal((await engine.commitPlan(id, s.deps)).ok, false)
  assert.equal(s.external.state.events['exam-event'], undefined)
  assert.equal(warnings.some(w => w.includes('cannot restore')), true)
  assert.deepEqual(s.persisted(), s.initial)
})

test('R8 FIXED: fresh process retains draft/queue without automatically dispatching it', async t => {
  const s = await sandbox(t)
  const applied = s.session()
  await s.stage(applied, 'update_task', { id: 'exam', notes: 'Applied before restart' })
  assert.equal((await engine.commitPlan(applied, s.deps)).ok, true)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Uncommitted' })
  engine.enqueueMessage(id, { message: 'Synthetic queued follow-up', history: [] })
  const chats = [{ id: 'synthetic-chat', sessionId: id, messages: [{ role: 'user', content: 'Synthetic only' }] }]
  db.setData('adviser_chats', chats)
  const beforeRestart = s.persisted()
  // Only explicit non-secret child environment; node executable is absolute.
  const child = spawnSync(process.execPath, [restartWorker, s.dbPath, id], {
    env: { PATH: process.env.PATH, TZ: 'UTC' }, encoding: 'utf8', timeout: 5000,
  })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
  const line = child.stdout.split('\n').find(x => x.startsWith('P1_RESULT='))
  assert.ok(line, child.stdout)
  const result = JSON.parse(line.slice('P1_RESULT='.length))
  assert.equal(result.hasSession, true)
  assert.equal(result.commit.ok, false)
  assert.match(result.commit.error, /plan changed/)
  assert.deepEqual(result.chats, chats)
  assert.equal(result.tasks.find(r => r.id === 'exam').notes, 'Applied before restart')
  assert.equal(result.tasks.find(r => r.id === 'exam').title, 'Prepare exam')
  assert.deepEqual(result.blocked, [])
  assert.deepEqual(s.persisted(), beforeRestart)
  assert.deepEqual(s.external.state, fixture.external)
})

function sink() {
  const chunks = []
  return { chunks, res: { write(chunk) { chunks.push(chunk) }, flush() {} } }
}

test('baseline: detached session replay plus live events changes neither DB nor external state', async t => {
  const s = await sandbox(t)
  const id = s.session()
  engine.appendEvent(id, { type: 'message', data: { text: 'Before disconnect' } })
  const first = sink()
  const sub = engine.subscribeSession(id, first.res)
  engine.unsubscribeSession(id, sub)
  engine.appendEvent(id, { type: 'message', data: { text: 'While disconnected' } })
  const second = sink()
  engine.subscribeSession(id, second.res)
  engine.appendEvent(id, { type: 'done', data: {} })
  assert.equal(second.chunks.length, 3)
  assert.ok(second.chunks[0].includes('Before disconnect'))
  assert.ok(second.chunks[1].includes('While disconnected'))
  assert.ok(second.chunks[2].includes('event: done'))
  assert.deepEqual(s.persisted(), s.initial)
  assert.deepEqual(s.external.state, fixture.external)
})

test('R9 FIXED: resubscription with a cursor does not repeat delivered events', async t => {
  const s = await sandbox(t)
  const id = s.session()
  engine.appendEvent(id, { type: 'message', data: { text: 'Already delivered' } })
  const first = sink()
  const sub = engine.subscribeSession(id, first.res)
  engine.unsubscribeSession(id, sub)
  const second = sink()
  engine.subscribeSession(id, second.res, engine.sessionSnapshot(id).cursor)
  assert.deepEqual(second.chunks, [])
  assert.equal(second.chunks.some(chunk => /^id:/m.test(chunk)), false)
  assert.deepEqual(s.persisted(), s.initial)
  assert.deepEqual(s.external.state, fixture.external)
})

// Evaluate the ACTUAL polling callback, without importing/mounting the React UI
// or modifying production code. Fail closed if source markers change. Mock only
// hook binding, clock/timer, fetch and UI state setters; no duplicated poll loop.
const hook = readFileSync(new URL('../src/hooks/useAdviser.js', import.meta.url), 'utf8')
const pollStart = hook.indexOf('  const pollSessionForResult = useCallback(')
const pollEnd = hook.indexOf('  const buildHistory = useCallback(', pollStart)
assert.ok(pollStart >= 0 && pollEnd > pollStart, 'update test source boundaries after hook changes')
const pollSource = hook.slice(pollStart, pollEnd)

async function poll(s, id, script, startIdx = 0) {
  const complete = deferred()
  const seen = []
  const errors = []
  let reads = 0
  const context = {
    useCallback: fn => fn,
    POLL_BUDGET_MS: 300000, POLL_INTERVAL_MS: 1500,
    Date, setTimeout: fn => queueMicrotask(fn),
    quokkaLog() {}, setStatus() {}, setLastError: error => errors.push(error),
    fetch: async url => {
      script(++reads)
      const session = engine.getSession(id)
      const last = !session || session.runnerState !== 'running'
      // json resolves before observer completion; setImmediate waits for processing.
      if (last) setImmediate(complete.resolve)
      if (!session) return { status: 404 }
      return { status: 200, ok: true, json: async () => structuredClone(engine.sessionSnapshot(id, Number(new URL(url, 'http://fixture').searchParams.get('cursor')) || 0)) }
    },
  }
  const callback = vm.runInNewContext(`${pollSource}\npollSessionForResult`, context)
  callback(id, (type, data) => seen.push({ type, data }), startIdx)
  await complete.promise
  assert.deepEqual(s.persisted(), s.initial)
  assert.deepEqual(s.external.state, fixture.external)
  return { seen, errors, reads }
}

test('baseline: actual poll callback delivers buffered completion after disconnect', { timeout: 5000 }, async t => {
  const s = await sandbox(t)
  const id = s.session()
  engine.appendEvent(id, { type: 'message', data: { text: 'Recovered answer' } })
  const result = await poll(s, id, () => {})
  assert.ok(result.seen.some(e => e.type === 'message' && e.data.text === 'Recovered answer'))
  assert.deepEqual(result.errors, [])
})

test('R10 FIXED: actual poll callback delivers completion across bounded-buffer rollover', { timeout: 5000 }, async t => {
  const s = await sandbox(t)
  const id = s.session()
  engine.setRunnerState(id, 'running')
  for (let n = 1; n <= 499; n++) engine.appendEvent(id, { type: 'message', data: { n } })
  assert.equal(engine.getSession(id).events.length, 500)
  const result = await poll(s, id, read => {
    if (read === 2) {
      engine.appendEvent(id, { type: 'message', data: { n: 500, text: 'New answer lost at rollover' } })
      engine.setRunnerState(id, 'idle')
    }
  })
  assert.equal(result.reads, 2)
  assert.equal(result.seen.some(e => e.data.n === 500), true)
  assert.equal(result.seen.some(e => e.type === 'runner_state' && e.data.state === 'idle'), true)
  assert.deepEqual(result.errors, [], 'completion remains visible')
})

test('R8: actual poll callback reports missing session instead of inventing completion', { timeout: 5000 }, async t => {
  const s = await sandbox(t)
  const result = await poll(s, 'nonexistent-session', () => {})
  assert.deepEqual(result.seen, [])
  assert.deepEqual(result.errors, ['Could not retrieve response'])
})
