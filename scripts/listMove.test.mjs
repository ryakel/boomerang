// Integration test for moveListItem() in trelloListSync.js — the applier half
// of an item drag, with Trello stubbed at `fetch`.
//
// listOrder.test.mjs pins the arithmetic; this pins what actually reaches the
// database and the network. Both matter, because this is the ONE path in the
// whole feature where a Boomerang gesture rewrites the order of a checklist
// someone else reads.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'boom-move-'))
let db, sync
const calls = []          // every Trello request this test provoked

before(async () => {
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body })
    return { ok: true, status: 200, text: async () => '{}' }
  }
  db = await import('../server/db.js')
  sync = await import('../server/trelloListSync.js')
  await db.initDb(join(dir, 'move.db'))
  sync.initListSync({ key: 'k', token: 't', allowWrites: true })
})

after(() => {
  try { db.flushNow() } catch { /* nothing pending */ }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
})

const now = () => new Date().toISOString()

function freshList(id, { linked = true } = {}) {
  db.upsertList({
    id, name: id, sync_enabled: true,
    trello_card_id: linked ? 'card1' : null,
    trello_checklist_id: linked ? 'cl1' : null,
    created_at: now(), updated_at: now(),
  })
  const mk = (iid, name, pos) => db.upsertListItem({
    id: iid, list_id: id, name, checked: false, position: pos,
    trello_check_item_id: linked ? 'r_' + iid : null,
    shadow_name: name, shadow_checked: false, deleted_at: null,
    created_at: now(), updated_at: now(),
  })
  mk(id + 'a', 'Milk', 65536)
  mk(id + 'b', 'Eggs', 131072)
  mk(id + 'c', 'Bread', 196608)
  return id
}

const order = (listId) => db.getListItems(listId).map(i => i.name)

test('moving an item reorders locally AND pushes exactly one Trello write', async () => {
  freshList('L1')
  calls.length = 0
  const r = await sync.moveListItem('L1', 'L1c', 'L1b')   // Bread before Eggs
  assert.equal(r.moved, true)
  assert.deepEqual(order('L1'), ['Milk', 'Bread', 'Eggs'])
  assert.equal(calls.length, 1, 'one drag is one write, not a renumber of the list')
  assert.equal(calls[0].method, 'PUT')
  assert.match(calls[0].url, /\/cards\/card1\/checkItem\/r_L1c/)
  assert.ok(JSON.parse(calls[0].body).pos > 0, 'a position is sent')
})

test('moving to the end works and stays at the end', async () => {
  freshList('L2')
  calls.length = 0
  await sync.moveListItem('L2', 'L2a', null)
  assert.deepEqual(order('L2'), ['Eggs', 'Bread', 'Milk'])
  assert.equal(calls.length, 1)
})

test('a no-op drag costs no Trello write at all', async () => {
  freshList('L3')
  calls.length = 0
  const r = await sync.moveListItem('L3', 'L3a', 'L3b')   // already there
  assert.equal(r.moved, false)
  assert.equal(calls.length, 0)
})

test('dropping an item on itself is a no-op', async () => {
  freshList('L4')
  calls.length = 0
  const r = await sync.moveListItem('L4', 'L4b', 'L4b')
  assert.equal(r.moved, false)
  assert.equal(calls.length, 0)
})

test('a list that was never linked reorders locally and writes nothing', async () => {
  freshList('L5', { linked: false })
  calls.length = 0
  const r = await sync.moveListItem('L5', 'L5c', 'L5a')
  assert.equal(r.moved, true)
  assert.deepEqual(order('L5'), ['Bread', 'Milk', 'Eggs'])
  assert.equal(calls.length, 0)
})

test('colliding positions renumber locally but still push only the moved item', async () => {
  // Everything at 0 is the normal state for a list built locally before it
  // ever synced. The renumber is free; it must not become N Trello writes.
  db.upsertList({ id: 'L6', name: 'L6', sync_enabled: true, trello_card_id: 'card1',
    trello_checklist_id: 'cl1', created_at: now(), updated_at: now() })
  for (const [iid, name] of [['L6a', 'Milk'], ['L6b', 'Eggs'], ['L6c', 'Bread']]) {
    db.upsertListItem({ id: iid, list_id: 'L6', name, checked: false, position: 0,
      trello_check_item_id: 'r_' + iid, shadow_name: name, shadow_checked: false,
      deleted_at: null, created_at: now(), updated_at: now() })
  }
  calls.length = 0
  await sync.moveListItem('L6', 'L6c', 'L6b')
  assert.deepEqual(order('L6'), ['Milk', 'Bread', 'Eggs'])
  assert.equal(calls.length, 1, 'the renumber stayed local')
  const ps = db.getListItems('L6').map(i => i.position)
  assert.ok(ps.every((p, i) => i === 0 || p > ps[i - 1]), 'positions strictly increase')
})

test('a held write surfaces on the list rather than passing silently', async () => {
  // A dev-shaped server merges inbound but never writes back. From inside the
  // app a held reorder is indistinguishable from a broken one, so it has to
  // say so — the failure this whole feature is built to avoid.
  sync.initListSync({ key: 'k', token: 't', allowWrites: false })
  freshList('L7')
  calls.length = 0
  const r = await sync.moveListItem('L7', 'L7c', 'L7a')
  assert.equal(r.heldWrites, 1)
  assert.equal(calls.length, 0, 'nothing reached Trello')
  assert.deepEqual(order('L7'), ['Bread', 'Milk', 'Eggs'], 'but the local move still happened')
  assert.match(db.getList('L7').last_sync_error, /DEV_LIST_SYNC_WRITES/)
  sync.initListSync({ key: 'k', token: 't', allowWrites: true })
})

test('checked items are still reorderable data, not skipped rows', async () => {
  // The UI only offers drag on the unchecked pile, but the engine must not
  // silently ignore an id just because it is ticked off.
  freshList('L8')
  db.updateListItemPartial('L8b', { checked: true })
  calls.length = 0
  const r = await sync.moveListItem('L8', 'L8b', 'L8a')
  assert.equal(r.moved, true)
  assert.deepEqual(order('L8'), ['Eggs', 'Milk', 'Bread'])
})

test('an unknown list is an error, not a silent no-op', async () => {
  await assert.rejects(() => sync.moveListItem('nope', 'x', null), /List not found/)
})
