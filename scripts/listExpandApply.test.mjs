// Integration test for the half of expansion that listExpand.test.mjs cannot
// reach: the plumbing in trelloListSync.js that APPLIES a plan to the database.
//
// Worth its own file because the pure planner being correct says nothing about
// whether the applier writes what the planner decided. This test caught a real
// bug on its first run — a failed column-name lookup blanked an existing
// breadcrumb, which would have made the card/column labels flicker off on any
// transient Trello error and back on the next poll.
//
// Trello is stubbed at `fetch`, so this exercises the real db, the real
// migrations and the real sync module without touching the network.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'boom-expand-'))
let db, sync

// Mutable stand-in for the Trello side. Tests reshape these between rounds to
// model "she edited the board".
let CARD = { id: 'card1', name: '2026 Groceries', idList: 'col1' }
let COLUMN = { id: 'col1', name: 'Shopping' }
let CHECKLISTS = [{ id: 'cl1', name: 'Grocery', checkItems: [] }]
let failColumnFetch = false

before(async () => {
  global.fetch = async (url) => {
    const u = String(url)
    let body
    if (u.includes('/cards/card1/checklists')) body = CHECKLISTS
    else if (u.includes('/cards/card1')) body = CARD
    else if (u.includes('/lists/')) {
      if (failColumnFetch) return { ok: false, status: 500, text: async () => '{"message":"boom"}' }
      body = COLUMN
    } else body = {}
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  }

  db = await import('../server/db.js')
  sync = await import('../server/trelloListSync.js')
  await db.initDb(join(dir, 'test.db'))
  // allowWrites:false — expansion is local-only by design, so this also
  // asserts it never needed write permission to do its job.
  sync.initListSync({ key: 'k', token: 't', allowWrites: false })

  const now = new Date().toISOString()
  db.upsertListSource({
    id: 'src1', scope: 'card', trello_id: 'card1', name: 'Groceries',
    created_at: now, updated_at: now,
  })
})

after(() => {
  // Flush BEFORE removing the directory. db.js persists on a timer, so a bare
  // rmSync races it and the pending write lands in a directory that no longer
  // exists — surfacing as an uncaughtException from a hook rather than an
  // honest failure. Exactly the teardown race already fixed in
  // capture.test.mjs; the shape repeats whenever a test owns a db directory.
  try { db.flushNow() } catch { /* nothing pending */ }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
})

const mine = () => db.getListsBySource('src1')
const byChecklist = (id) => mine().find(l => l.trello_checklist_id === id)

test('first expand materializes a list per checklist, with breadcrumbs', async () => {
  const r = await sync.expandSource('src1')
  assert.equal(r.created, 1)
  const l = byChecklist('cl1')
  assert.equal(l.name, 'Grocery')
  assert.equal(l.trello_card_name, '2026 Groceries')
  assert.equal(l.trello_column_name, 'Shopping')
  assert.equal(l.source_id, 'src1')
})

test('a checklist added on Trello is discovered — the point of the feature', async () => {
  CHECKLISTS = [{ id: 'cl1', name: 'Grocery' }, { id: 'cl2', name: 'Costco' }]
  const r = await sync.expandSource('src1')
  assert.equal(r.created, 1)
  assert.equal(mine().length, 2)
})

test('a remote rename is taken, and does NOT re-fire next round', async () => {
  CHECKLISTS = [{ id: 'cl1', name: 'Groceries 2026' }, { id: 'cl2', name: 'Costco' }]
  const first = await sync.expandSource('src1')
  assert.equal(first.renamed, 1)
  assert.equal(byChecklist('cl1').name, 'Groceries 2026')

  // The baseline has to move with the rename, or every poll re-applies it.
  const second = await sync.expandSource('src1')
  assert.equal(second.renamed, 0)
})

test('a vanished checklist is tombstoned, not deleted, and leaves the sync set', async () => {
  CHECKLISTS = [{ id: 'cl1', name: 'Groceries 2026' }]
  const r = await sync.expandSource('src1')
  assert.equal(r.orphaned, 1)
  assert.ok(byChecklist('cl2').orphaned_at, 'row is kept, flagged')
  assert.equal(mine().length, 2, 'nothing was deleted')
  // An orphan still in the sync set would error against a dead checklist id
  // every minute.
  assert.ok(!db.getSyncableLists().some(l => l.trello_checklist_id === 'cl2'))
})

test('a returning checklist is revived, not duplicated', async () => {
  CHECKLISTS = [{ id: 'cl1', name: 'Groceries 2026' }, { id: 'cl2', name: 'Costco' }]
  const r = await sync.expandSource('src1')
  assert.equal(r.revived, 1)
  assert.equal(r.created, 0)
  assert.equal(mine().length, 2)
  assert.equal(byChecklist('cl2').orphaned_at, null)
})

test('a card moved to another column re-parents both its lists', async () => {
  CARD = { id: 'card1', name: '2026 Groceries', idList: 'col9' }
  COLUMN = { id: 'col9', name: 'Done' }
  await sync.expandSource('src1')
  assert.deepEqual(mine().map(l => l.trello_column_name), ['Done', 'Done'])
})

test('a failed column lookup leaves the breadcrumb alone rather than blanking it', async () => {
  // The regression this file was written for. The column fetch is best-effort
  // — it must degrade, not fail the sync, and must not wipe what we already
  // knew.
  failColumnFetch = true
  const r = await sync.expandSource('src1')
  failColumnFetch = false
  assert.ok(!r.error)
  assert.deepEqual(mine().map(l => l.trello_column_name), ['Done', 'Done'])
})

test('items survive every one of those rounds', async () => {
  // The whole point of tombstoning rather than deleting: user data outlives
  // the container churn above.
  const l = byChecklist('cl2')
  db.createListItem({ list_id: l.id, name: 'rotisserie chicken' })
  CHECKLISTS = [{ id: 'cl1', name: 'Groceries 2026' }]
  await sync.expandSource('src1')          // orphan it
  CHECKLISTS = [{ id: 'cl1', name: 'Groceries 2026' }, { id: 'cl2', name: 'Costco' }]
  await sync.expandSource('src1')          // bring it back
  assert.equal(db.getListItems(l.id).length, 1)
  assert.equal(db.getListItems(l.id)[0].name, 'rotisserie chicken')
})

test('the source records when it last expanded', async () => {
  const src = db.getListSource('src1')
  assert.ok(src.last_expanded_at)
  assert.equal(src.last_expand_error, null)
})
