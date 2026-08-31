// Server-side activity log (migration 058), against a real database.
//
// The log used to live only in localStorage, where it was QUOTA_EVICT_KEYS[0]
// — the first key discarded when any other write hit the quota. In a
// 1500-task database that is constantly, so the recovery record you open when
// sync appears to have eaten a change rendered empty. These properties are the
// ones that decide whether the server copy is actually durable.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'boom-activity-'))
let db

before(async () => {
  db = await import('../server/db.js')
  await db.initDb(join(dir, 'activity.db'))
})

after(() => {
  try { db.flushNow() } catch { /* nothing pending */ }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
})

let seq = 0
function entry(overrides = {}) {
  seq++
  return {
    id: `entry-${seq}`,
    action: 'completed',
    task_id: `task-${seq}`,
    task_title: `Task ${seq}`,
    task_snapshot: { id: `task-${seq}`, title: `Task ${seq}`, status: 'done' },
    // Ascending so "newest" is unambiguous.
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    ...overrides,
  }
}

test('a batch is appended and read back newest-first', () => {
  const a = entry()
  const b = entry()
  assert.equal(db.appendActivity([a, b]), 2)
  const log = db.listActivity({})
  assert.equal(log[0].id, b.id, 'newest entry comes first')
  assert.equal(log[1].id, a.id)
})

test('the snapshot survives the round trip as an object', () => {
  const e = entry({ task_snapshot: { id: 'x', title: 'Restore me', notes: 'keep' } })
  db.appendActivity([e])
  const found = db.listActivity({}).find(r => r.id === e.id)
  assert.deepEqual(found.task_snapshot, { id: 'x', title: 'Restore me', notes: 'keep' })
})

test('re-sending the same batch does not duplicate it', () => {
  // The client ships best-effort and retries on failure; a retry must be a
  // no-op, not a second copy of every entry.
  const e = entry()
  db.appendActivity([e])
  const before = db.listActivity({}).length
  db.appendActivity([e])
  db.appendActivity([e])
  assert.equal(db.listActivity({}).length, before)
})

test('an entry with no snapshot is still recorded', () => {
  // logSystemError writes one of these when detail is absent.
  const e = entry({ action: 'error', task_id: null, task_snapshot: null, task_title: 'Render error' })
  db.appendActivity([e])
  const found = db.listActivity({}).find(r => r.id === e.id)
  assert.equal(found.action, 'error')
  assert.equal(found.task_snapshot, null)
  assert.equal(found.task_id, null)
})

test('malformed entries are skipped, not fatal to the batch', () => {
  const good = entry()
  const written = db.appendActivity([{ id: null, action: 'created' }, { action: 'no-id' }, good])
  assert.equal(written, 1)
  assert.ok(db.listActivity({}).some(r => r.id === good.id))
})

test('limit is honored and clamped', () => {
  assert.equal(db.listActivity({ limit: 2 }).length, 2)
  assert.ok(db.listActivity({ limit: 999999 }).length <= 5000)
  // A junk limit falls back to the default rather than returning nothing.
  assert.ok(db.listActivity({ limit: 'nonsense' }).length > 0)
})

test('the table is pruned to the ceiling, keeping the newest', () => {
  db.clearActivity()
  // 5010 entries with ascending timestamps; the 10 oldest must fall off.
  const batch = []
  for (let i = 0; i < 5010; i++) {
    batch.push({
      id: `bulk-${i}`,
      action: 'created',
      task_id: `t-${i}`,
      task_title: `Bulk ${i}`,
      task_snapshot: null,
      timestamp: new Date(Date.UTC(2026, 1, 1) + i * 1000).toISOString(),
    })
  }
  db.appendActivity(batch)
  const log = db.listActivity({ limit: 5000 })
  assert.equal(log.length, 5000)
  assert.equal(log[0].id, 'bulk-5009', 'newest survives')
  assert.ok(!log.some(r => r.id === 'bulk-0'), 'oldest is pruned')
})

test('clear empties the log', () => {
  db.appendActivity([entry()])
  db.clearActivity()
  assert.equal(db.listActivity({}).length, 0)
})

test('an empty batch is a no-op', () => {
  assert.equal(db.appendActivity([]), 0)
  assert.equal(db.appendActivity(null), 0)
})
