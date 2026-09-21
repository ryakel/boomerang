import test from 'node:test'
import assert from 'node:assert/strict'
import {
  QUEUE_TTL_MS,
  opRecordKey, compactQueue, expireOps,
  failureStatus, isTerminalFailure, prepareQueue,
} from '../src/mutationQueue.js'

// The offline mutation queue held 124 ops on the user's desktop, the oldest a
// week old, and could never drain: it contained a delete and four later updates
// of the SAME row, so replay always took a 404 partway through and kept
// everything — re-running the eight creates ahead of the 404 on every SSE
// reconnect, which is what kept resurrecting completed loop tasks.

const NOW = 1_758_000_000_000
const fresh = (op) => ({ ...op, queued_at: NOW })

const createTask = (id, data = {}) => fresh({ type: 'createTask', data: { id, ...data } })
const updateTask = (id, data = {}) => fresh({ type: 'updateTask', id, data: { id, ...data } })
const deleteTask = (id) => fresh({ type: 'deleteTask', id })

test('a record key comes from the payload for creates and the top level otherwise', () => {
  assert.equal(opRecordKey(createTask('a')), 'task:a')
  assert.equal(opRecordKey(updateTask('a')), 'task:a')
  assert.equal(opRecordKey(deleteTask('a')), 'task:a')
  assert.equal(opRecordKey({ type: 'updateRoutine', id: 'r1' }), 'routine:r1')
  // A task and a routine sharing an id are still two records.
  assert.notEqual(opRecordKey({ type: 'updateTask', id: 'x' }), opRecordKey({ type: 'updateRoutine', id: 'x' }))
})

test('an unknown op type or a missing id passes through untouched', () => {
  const odd = [fresh({ type: 'somethingElse', id: 'a' }), fresh({ type: 'updateTask' })]
  assert.equal(opRecordKey(odd[0]), null)
  assert.equal(opRecordKey(odd[1]), null)
  assert.deepEqual(compactQueue(odd), odd)
})

test('THE BUG: delete-then-update folds to the delete, not the update', () => {
  // The exact shape of the stuck queue: deleteTask at 25, updateTask at 36, 54,
  // 70, 86. Last-write-wins would keep an update — which is both a guaranteed
  // 404 (the row is gone) and, for a create, the resurrection the user was
  // complaining about.
  const compacted = compactQueue([
    updateTask('94b39e0b', { title: 'before' }),
    deleteTask('94b39e0b'),
    updateTask('94b39e0b', { title: 'after' }),
    updateTask('94b39e0b', { title: 'after again' }),
  ])
  assert.deepEqual(compacted, [deleteTask('94b39e0b')])
})

test('a queued create can never be replayed past its own delete', () => {
  assert.deepEqual(
    compactQueue([createTask('mop'), updateTask('mop'), deleteTask('mop')]),
    [deleteTask('mop')],
  )
  // And the delete still wins when the create comes back afterwards.
  assert.deepEqual(
    compactQueue([deleteTask('mop'), createTask('mop')]),
    [deleteTask('mop')],
  )
})

test('a create stays a create and carries the newest snapshot', () => {
  // It must not become a PATCH: the row may not exist server-side, and a PATCH
  // for a missing row is exactly the 404 that pinned the queue.
  const compacted = compactQueue([
    createTask('a', { title: 'first' }),
    updateTask('a', { title: 'second' }),
    updateTask('a', { title: 'third' }),
  ])
  assert.equal(compacted.length, 1)
  assert.equal(compacted[0].type, 'createTask')
  assert.equal(compacted[0].data.title, 'third')
})

test('repeated updates fold to the last one — the whole record is in every op', () => {
  const compacted = compactQueue([
    updateTask('a', { title: 'one' }),
    updateTask('a', { title: 'two' }),
  ])
  assert.deepEqual(compacted, [updateTask('a', { title: 'two' })])
})

test('compaction dissolves the six-times-repeated batch', () => {
  // pushChanges queued the entire batch on any single rejection, so the same
  // ops arrived over and over. Six rounds over three records is three ops.
  const round = [updateTask('a'), updateTask('b'), deleteTask('c')]
  const queue = [...round, ...round, ...round, ...round, ...round, ...round]
  assert.equal(queue.length, 18)
  assert.deepEqual(compactQueue(queue), [updateTask('a'), updateTask('b'), deleteTask('c')])
})

test('distinct records all survive, in order', () => {
  const queue = [createTask('a'), updateTask('b'), deleteTask('c'), updateTask('d')]
  assert.deepEqual(compactQueue(queue), queue)
})

test('ops expire on age, and an undated op is treated as expired', () => {
  const { kept, expired } = expireOps([
    { type: 'updateTask', id: 'young', queued_at: NOW - 60_000 },
    { type: 'updateTask', id: 'old', queued_at: NOW - QUEUE_TTL_MS - 1 },
    { type: 'updateTask', id: 'undated' },
  ], { now: NOW })
  assert.deepEqual(kept.map(o => o.id), ['young'])
  assert.deepEqual(expired.map(o => o.id), ['old', 'undated'])
})

test('the whole legacy queue expires — every op in it predates queued_at', () => {
  const legacy = [
    { type: 'createTask', data: { id: 'mop', title: 'Put away mop canisters' } },
    { type: 'updateTask', id: '94b39e0b', data: {} },
  ]
  const { ops, expired } = prepareQueue(legacy, { now: NOW })
  assert.deepEqual(ops, [])
  assert.equal(expired, 2)
})

test('terminal statuses are the ones that fail identically forever', () => {
  for (const status of [400, 404, 409, 410, 422]) {
    assert.equal(isTerminalFailure(Object.assign(new Error('x'), { status })), true, String(status))
  }
  for (const status of [429, 500, 502, 503]) {
    assert.equal(isTerminalFailure(Object.assign(new Error('x'), { status })), false, String(status))
  }
})

test('auth failures are retryable — device tokens rotate hourly', () => {
  assert.equal(isTerminalFailure(Object.assign(new Error('nope'), { status: 401 })), false)
  assert.equal(isTerminalFailure(Object.assign(new Error('nope'), { status: 403 })), false)
})

test('a network error carries no status and is always retryable', () => {
  assert.equal(failureStatus(new TypeError('Failed to fetch')), null)
  assert.equal(isTerminalFailure(new TypeError('Failed to fetch')), false)
  assert.equal(isTerminalFailure(null), false)
})

test('the status is parsed out of the message when nothing attached one', () => {
  // The shape api.js threw before it started attaching `err.status`, and what
  // any already-queued op will still look like.
  assert.equal(failureStatus(new Error('update task failed: 404')), 404)
  assert.equal(isTerminalFailure(new Error('update task failed: 404')), true)
  assert.equal(isTerminalFailure(new Error('create task failed: 500')), false)
  // A uuid full of digits must not read as a status code.
  assert.equal(failureStatus(new Error('delete 94b39e0b-91d5-4e53-9ce4-432fc23a6792 failed')), null)
})

test('prepareQueue expires, then compacts, and reports what it dropped', () => {
  const { ops, expired, folded } = prepareQueue([
    { type: 'updateTask', id: 'stale', data: {}, queued_at: NOW - QUEUE_TTL_MS - 1 },
    updateTask('a', { title: 'one' }),
    updateTask('a', { title: 'two' }),
    deleteTask('b'),
  ], { now: NOW })
  assert.equal(expired, 1)
  assert.equal(folded, 1)
  assert.deepEqual(ops, [updateTask('a', { title: 'two' }), deleteTask('b')])
})

test('the cap bites only after folding, and drops the oldest', () => {
  const many = Array.from({ length: 6 }, (_, i) => updateTask(`t${i}`))
  const { ops, overflowed } = prepareQueue(many, { now: NOW, max: 4 })
  assert.equal(overflowed, 2)
  assert.deepEqual(ops.map(o => o.id), ['t2', 't3', 't4', 't5'])
})

test('an empty or malformed queue is handled without throwing', () => {
  assert.deepEqual(compactQueue(null), [])
  assert.deepEqual(compactQueue(undefined), [])
  assert.deepEqual(prepareQueue(null, { now: NOW }).ops, [])
})
