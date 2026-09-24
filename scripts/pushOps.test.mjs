import test from 'node:test'
import assert from 'node:assert/strict'
import { runPushOps, holdBaseline, keyId } from '../src/pushOps.js'

// The BOOM-17 fix refused the second write of every multi-write batch: all
// ops fired in parallel carrying the same version claim, the first accepted
// one bumped the server, and the rest were "stale". The baseline then
// advanced as if they had landed and a rehydrate overwrote the local edit.
// Four COMPLETED entries for one task, on one client, no race needed.

const stale = (version) => Object.assign(new Error('update task failed: 409'), { status: 409, version })
const gone = () => Object.assign(new Error('update task failed: 404'), { status: 404 })
const offline = () => new TypeError('Failed to fetch')
const isTerminal = (e) => [400, 404, 409, 422].includes(e?.status)

// A fake server: `run` succeeds only when the op's claimed version equals the
// server's, bumps the server, and refuses otherwise with the current version
// in the 409 — exactly guardStaleWrite's contract.
function fakeServer(start = 2) {
  let server = start
  let client = start
  const versions = []
  const onVersion = (v) => { client = v; versions.push(v) }
  const op = (key) => ({
    key,
    desc: { type: 'updateTask', id: keyId(key) },
    run: async () => {
      if (client < server) throw stale(server)
      server += 1
      return { version: server }
    },
  })
  // Writes from ANOTHER client: the server moves, our claim does not — the
  // shape of an SSE broadcast we never received.
  const otherClientWrites = (n) => { server += n }
  return { op, onVersion, versions, otherClientWrites, get server() { return server }, get client() { return client } }
}

test('THE BUG: a batch of N ops from one client lands all N', async () => {
  const s = fakeServer(2)
  const ops = [s.op('task:wipe'), s.op('task:polish'), s.op('task:trash')]
  const out = await runPushOps(ops, { onVersion: s.onVersion, isTerminal })
  assert.deepEqual(out.applied, ['task:wipe', 'task:polish', 'task:trash'])
  assert.deepEqual(out.held, [])
  assert.equal(out.lastError, null)
  // Threaded: each response's version became the next op's claim.
  assert.deepEqual(s.versions, [3, 4, 5])
  assert.equal(s.client, s.server)
})

test('the same three ops fired the old way, in parallel with one shared claim, lose two', async () => {
  // Documents what the previous code did, so the test above is understood as
  // a fix rather than a tautology.
  const s = fakeServer(2)
  const ops = [s.op('task:wipe'), s.op('task:polish'), s.op('task:trash')]
  const results = await Promise.allSettled(ops.map(o => o.run()))
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected', 'rejected'])
  assert.equal(results[1].reason.status, 409)
})

test('behind the server (SSE dropped): 409, refresh from the body, retry once, lands', async () => {
  const s = fakeServer(10)
  // Another client wrote twice while we weren't listening.
  s.otherClientWrites(2)
  assert.equal(s.server, 12)
  const mine = s.op('task:wipe')
  // Our claim is still 10, because those writes never reached us.
  const out = await runPushOps([mine], { onVersion: s.onVersion, isTerminal })
  assert.deepEqual(out.applied, ['task:wipe'])
  assert.deepEqual(out.held, [])
  // The 409 carried 12; we took it and the retry landed at 13.
  assert.deepEqual(s.versions, [12, 13])
})

test('refused twice → HELD, not applied, not dropped, not queued', async () => {
  // A server that moves between the refusal and the retry every time.
  let calls = 0
  const op = {
    key: 'task:wipe', desc: { type: 'updateTask', id: 'wipe' },
    run: async () => { calls++; throw stale(100 + calls) },
  }
  const seen = []
  const out = await runPushOps([op], { onVersion: (v) => seen.push(v), isTerminal })
  assert.equal(calls, 2, 'exactly one retry')
  assert.deepEqual(out.held, ['task:wipe'])
  assert.deepEqual(out.applied, [])
  assert.deepEqual(out.dropped, [])
  assert.deepEqual(out.queued, [])
  assert.deepEqual(seen, [101], 'took the version from the first 409 before retrying')
  assert.equal(out.lastError.status, 409)
})

test('a held op does not stop the ops after it', async () => {
  const held = { key: 'task:a', desc: {}, run: async () => { throw stale(5) } }
  const s = fakeServer(5)
  const out = await runPushOps([held, s.op('task:b')], { onVersion: s.onVersion, isTerminal })
  assert.deepEqual(out.held, ['task:a'])
  assert.deepEqual(out.applied, ['task:b'])
})

test('terminal (404/422) → dropped; network → queued with its desc', async () => {
  const ops = [
    { key: 'task:gone', desc: { type: 'updateTask', id: 'gone' }, run: async () => { throw gone() } },
    { key: 'task:net', desc: { type: 'updateTask', id: 'net' }, run: async () => { throw offline() } },
  ]
  const out = await runPushOps(ops, { onVersion: () => {}, isTerminal })
  assert.deepEqual(out.dropped, ['task:gone'])
  assert.deepEqual(out.queued, [{ type: 'updateTask', id: 'net' }])
  assert.deepEqual(out.applied, [])
})

test('a 409 with no version in the body still retries, and is held if refused again', async () => {
  let calls = 0
  const op = { key: 'task:x', desc: {}, run: async () => { calls++; throw Object.assign(new Error('409'), { status: 409 }) } }
  const seen = []
  const out = await runPushOps([op], { onVersion: (v) => seen.push(v), isTerminal })
  assert.equal(calls, 2)
  assert.deepEqual(seen, [], 'no version to take')
  assert.deepEqual(out.held, ['task:x'])
})

test('a deduped create is reported so the caller can rehydrate', async () => {
  const op = { key: 'task:spawn', desc: {}, run: async () => ({ version: 9, deduped: true }) }
  const out = await runPushOps([op], { onVersion: () => {}, isTerminal })
  assert.equal(out.deduped, true)
  assert.deepEqual(out.applied, ['task:spawn'])
})

// --- the baseline ------------------------------------------------------

const prev = [{ id: 'a', status: 'open' }, { id: 'b', status: 'open' }, { id: 'd', status: 'open' }]
const curr = [{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }, { id: 'c', status: 'open' }]
// a: updated, b: updated, c: created, d: deleted

test('nothing held → the baseline is local state, same reference', () => {
  assert.equal(holdBaseline(prev, curr, new Set()), curr)
  assert.equal(holdBaseline(prev, curr, null), curr)
})

test('held update → baseline keeps the server copy, so the diff re-pushes it', () => {
  const b = holdBaseline(prev, curr, new Set(['a']))
  assert.deepEqual(b.find(r => r.id === 'a'), { id: 'a', status: 'open' })
  assert.deepEqual(b.find(r => r.id === 'b'), { id: 'b', status: 'done' })
})

test('held create → absent from the baseline, so the diff re-creates it', () => {
  const b = holdBaseline(prev, curr, new Set(['c']))
  assert.equal(b.find(r => r.id === 'c'), undefined)
  assert.equal(b.length, curr.length - 1)
})

test('held delete → the server copy is restored, so the diff re-deletes it', () => {
  const b = holdBaseline(prev, curr, new Set(['d']))
  assert.deepEqual(b.find(r => r.id === 'd'), { id: 'd', status: 'open' })
})

test('keyId strips the scope', () => {
  assert.equal(keyId('task:abc-123'), 'abc-123')
  assert.equal(keyId('routine:rt-1'), 'rt-1')
  assert.equal(keyId('bare'), 'bare')
})
