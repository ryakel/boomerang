import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import express from 'express'
import { db, engine, fence, sandbox } from './helpers/quokkaSandbox.mjs'
import { configureExecutionJournal, getExecution, listExecutions } from '../server/executionJournal.js'
import { registerExecutionRoutes } from '../server/adviserExecutionRoutes.js'
import { authGate } from '../server/auth.js'
import { EventEmitter } from 'node:events'

after(() => fence.restore())

test('approved revision is immutable; fresh approval required after staging changes', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'First plan' })
  const approval = engine.getPlanApproval(id)
  await s.stage(id, 'update_task', { id: 'exam', notes: 'Additional change' })
  assert.match((await engine.commitPlan(id, s.deps, approval.revision)).error, /plan changed/)
  assert.deepEqual(s.persisted(), s.initial)
  assert.deepEqual(listExecutions({ sessionId: id }), [])
})

test('receipt remains available after session clear and reopening database', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', notes: 'Private synthetic content' })
  const approval = engine.getPlanApproval(id)
  const first = await engine.commitPlan(id, s.deps, approval.revision)
  engine.clearSession(id)
  await s.reopen()
  const retried = await engine.commitPlan(id, {}, approval.revision)
  assert.equal(retried.replayed, true)
  assert.deepEqual(retried.results, first.results)
  assert.equal(getExecution(approval.executionId).state, 'completed')
  assert.equal(db.getTask('exam').notes, 'Private synthetic content')
  assert.equal(JSON.stringify(listExecutions()).includes('Private synthetic content'), false)
})

test('journal persistence failure before dispatch causes zero writes and blocks further execution', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Must not apply' })
  configureExecutionJournal(s.connection, () => { throw new Error('injected disk failure') })
  const result = await engine.commitPlan(id, s.deps)
  assert.equal(result.state, 'needs_checking')
  assert.equal(result.ok, false)
  assert.equal(db.getTask('exam').title, 'Prepare exam')
  assert.equal((await engine.commitPlan(id, s.deps)).state, 'needs_checking')
  assert.equal(s.external.calls.length, 0)
  assert.deepEqual(s.persisted(), s.initial)
})

test('failure after a tool effect remains unknown and cannot repeat it', async t => {
  const s = await sandbox(t)
  const id = s.session()
  await s.stage(id, 'gcal_create_event', { summary: 'Synthetic', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } })
  let saves = 0
  configureExecutionJournal(s.connection, () => {
    if (++saves && s.external.calls.some(c => c.method === 'POST')) throw new Error('injected result write failure')
    db.flushNow()
  })
  const result = await engine.commitPlan(id, s.deps)
  assert.equal(result.ok, false)
  assert.equal(result.state, 'needs_checking')
  assert.equal((await engine.commitPlan(id, s.deps)).ok, false)
  assert.equal(s.external.calls.filter(c => c.method === 'POST').length, 1)
  assert.equal(listExecutions({ sessionId: id })[0].state, 'needs_checking')
})

test('SIGKILL after dispatch intent preserves receipt as unknown, never resumes', async t => {
  const s = await sandbox(t)
  const directory = dirname(s.dbPath)
  const effect = join(directory, 'effect.txt')
  const approvalFile = join(directory, 'approval.json')
  const child = spawnSync(process.execPath, [new URL('./helpers/executionCrash.mjs', import.meta.url).pathname,
    s.dbPath, effect, approvalFile], { env: { PATH: process.env.PATH }, timeout: 5000, encoding: 'utf8' })
  assert.ifError(child.error)
  assert.equal(child.signal, 'SIGKILL', child.stderr)
  assert.equal(existsSync(effect), true)
  const approval = JSON.parse(readFileSync(approvalFile, 'utf8'))
  await s.reopen()
  const receipt = getExecution(approval.executionId)
  assert.equal(receipt.state, 'needs_checking')
  assert.equal(receipt.results[0].state, 'unknown')
  assert.equal((await engine.commitPlan(approval.sessionId, {}, approval.revision)).replayed, true)
  assert.equal(readFileSync(effect, 'utf8'), 'effect happened')
  assert.deepEqual(s.persisted(), s.initial)
})

// In-process Express dispatch exercises the real route/auth stack without
// opening sockets or starting the application server/background integrations.
function request(app, url, { method = 'GET', body, token } = {}) {
  return new Promise((resolve, reject) => {
    const req = Object.assign(new EventEmitter(), { url, method, socket: { remoteAddress: '127.0.0.1' }, headers: token ? { authorization: `Bearer ${token}` } : {}, body })
    const res = new EventEmitter()
    res.setHeader = () => {}
    res.getHeader = () => undefined
    res.removeHeader = () => {}
    res.end = data => resolve({ status: res.statusCode || 200, data: data ? JSON.parse(String(data)) : null })
    app.handle(req, res, reject)
  })
}

test('authenticated commit/status routes require revision and replay without resolving integration tokens', async t => {
  const s = await sandbox(t)
  const oldPassword = process.env.AUTH_PASSWORD
  const oldToken = process.env.API_TOKEN
  process.env.AUTH_PASSWORD = 'synthetic-only'
  process.env.API_TOKEN = 'synthetic-api-token'
  t.after(() => {
    if (oldPassword === undefined) delete process.env.AUTH_PASSWORD
    else process.env.AUTH_PASSWORD = oldPassword
    if (oldToken === undefined) delete process.env.API_TOKEN
    else process.env.API_TOKEN = oldToken
  })
  const app = express()
  app.use(authGate)
  let dependencies = 0
  let broadcasts = 0
  registerExecutionRoutes(app, { dependencies: () => { dependencies++; return s.deps }, afterCommit: () => { broadcasts++ } })
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Route applied' })
  const approval = engine.getPlanApproval(id)
  assert.equal((await request(app, '/api/adviser/executions?chatId=synthetic-chat')).status, 401)
  assert.equal((await request(app, '/api/adviser/abort', { method: 'POST', body: { sessionId: id } })).status, 401)
  assert.equal((await request(app, `/api/adviser/executions/${approval.executionId}/recover`, { method: 'POST', body: { sequence: 1, choice: 'continue' } })).status, 401)
  const options = { method: 'POST', token: 'synthetic-api-token', body: { sessionId: id } }
  assert.equal((await request(app, '/api/adviser/commit', options)).status, 409)
  const empty = s.session()
  assert.equal((await request(app, '/api/adviser/commit', {
    ...options, body: { sessionId: empty, revision: approval.revision },
  })).status, 409)
  assert.equal(dependencies, 0, 'unrecognized approval must not resolve integration tokens')
  assert.equal((await engine.commitPlan(empty, {}, approval.revision)).ok, false)
  options.body.revision = approval.revision
  const applied = await request(app, '/api/adviser/commit', options)
  assert.equal(applied.data.ok, true)
  engine.clearSession(id)
  const retry = await request(app, '/api/adviser/commit', options)
  assert.deepEqual(retry.data.results, applied.data.results)
  assert.equal(retry.data.replayed, true)
  assert.equal(dependencies, 1)
  assert.equal(broadcasts, 1)
  const receipt = await request(app, `/api/adviser/executions/${approval.executionId}`, { token: 'synthetic-api-token' })
  assert.equal(receipt.data.state, 'completed')
  const history = await request(app, '/api/adviser/executions?chatId=synthetic-chat', { token: 'synthetic-api-token' })
  assert.equal(history.data.executions.length, 1)
  const preview = await request(app, `/api/adviser/executions/${approval.executionId}/undo`, { token: 'synthetic-api-token' })
  assert.equal(preview.data.available, true)
  assert.equal((await request(app, `/api/adviser/executions/${approval.executionId}/undo`, { method: 'POST', body: { revision: preview.data.revision } })).status, 401)
  const undoOptions = { method: 'POST', token: 'synthetic-api-token', body: { revision: preview.data.revision } }
  const undone = await request(app, `/api/adviser/executions/${approval.executionId}/undo`, undoOptions)
  assert.equal(undone.data.ok, true)
  assert.equal(db.getTask('exam').title, 'Prepare exam')
  const replayedUndo = await request(app, `/api/adviser/executions/${approval.executionId}/undo`, undoOptions)
  assert.equal(replayedUndo.data.replayed, true)
  assert.equal(broadcasts, 2, 'Undo broadcasts once and its retry does not broadcast')
})
