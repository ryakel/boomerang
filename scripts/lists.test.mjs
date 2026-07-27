// Unit tests for server/listMerge.js — the 3-way merge between a Boomerang
// list and a Trello checklist. This is the only place in the feature where
// someone else's data can be destroyed, so every rule about who wins, and
// every guard against a bad poll response, is pinned here. Run via `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planMerge } from '../server/listMerge.js'

// A local row as it comes out of list_items. shadow_* is the agreed baseline;
// leaving it undefined models "never synced".
const local = (over = {}) => ({
  id: 'l1', list_id: 'list1', name: 'Milk', checked: false, position: 0,
  trello_check_item_id: 'r1', shadow_name: 'Milk', shadow_checked: false,
  deleted_at: null, ...over,
})

// A Trello checkItem.
const remote = (over = {}) => ({ id: 'r1', name: 'Milk', state: 'incomplete', pos: 100, ...over })

const names = arr => arr.map(x => (x.item ? x.item.name : x.name))

// ---- the simple directions ----

test('local-only add is pushed to Trello', () => {
  const plan = planMerge([local({ trello_check_item_id: null, shadow_name: null, shadow_checked: null })], [])
  assert.deepEqual(names(plan.pushCreate), ['Milk'])
  assert.equal(plan.localCreate.length, 0)
})

test('remote-only add is pulled into Boomerang', () => {
  const plan = planMerge([], [remote({ id: 'r9', name: 'Eggs' })])
  assert.deepEqual(names(plan.localCreate), ['Eggs'])
  assert.equal(plan.pushCreate.length, 0)
})

test('local check with untouched remote pushes', () => {
  const plan = planMerge([local({ checked: true })], [remote()])
  assert.equal(plan.pushUpdate.length, 1)
  assert.equal(plan.pushUpdate[0].checked, true)
  assert.equal(plan.localUpdate.length, 0)
  assert.equal(plan.conflicts.length, 0)
})

test('remote check with untouched local pulls', () => {
  const plan = planMerge([local()], [remote({ state: 'complete' })])
  assert.equal(plan.localUpdate.length, 1)
  assert.equal(plan.localUpdate[0].checked, true)
  assert.equal(plan.pushUpdate.length, 0)
  assert.equal(plan.conflicts.length, 0)
})

test('nothing moved anywhere produces no operations', () => {
  const plan = planMerge([local()], [remote()])
  const total = plan.pushCreate.length + plan.pushUpdate.length + plan.pushDelete.length
    + plan.localCreate.length + plan.localUpdate.length + plan.localPurge.length
  assert.equal(total, 0)
  assert.equal(plan.conflicts.length, 0)
})

// ---- concurrent edits ----

test('both sides made the SAME change: converged, not a conflict', () => {
  const plan = planMerge([local({ checked: true })], [remote({ state: 'complete' })])
  assert.equal(plan.conflicts.length, 0)
  assert.equal(plan.pushUpdate.length, 0)
  assert.equal(plan.localUpdate.length, 0)
  assert.equal(plan.shadowOnly.length, 1) // baseline still needs advancing
})

test('both sides changed the same field differently: conflict, local wins, remote overwritten', () => {
  // I checked it off; she renamed nothing but unchecked it back.
  const plan = planMerge(
    [local({ checked: true, shadow_checked: false })],
    [remote({ state: 'incomplete' })],
  )
  // shadow says false, local says true, remote says false -> only local moved.
  assert.equal(plan.conflicts.length, 0)
  assert.equal(plan.pushUpdate.length, 1)
})

test('genuine two-sided collision on checked: local wins and is reported', () => {
  // Baseline checked=true. I unchecked it, she renamed AND left it checked...
  // construct a real collision: baseline false, local true, remote true is
  // agreement — so use name to collide instead.
  const plan = planMerge(
    [local({ name: 'Whole milk' })],
    [remote({ name: '2% milk' })],
  )
  assert.equal(plan.conflicts.length, 1)
  assert.equal(plan.pushUpdate.length, 1)
  assert.equal(plan.pushUpdate[0].name, 'Whole milk', 'local name survives')
  const c = plan.conflicts[0]
  assert.equal(c.local.name, 'Whole milk')
  assert.equal(c.remote.name, '2% milk')
})

test('independent fields are not a conflict: she renames while I check off', () => {
  const plan = planMerge(
    [local({ checked: true })],                       // I checked it
    [remote({ name: 'Oat milk' })],                   // she renamed it
  )
  assert.equal(plan.conflicts.length, 0, 'different fields is cooperation')
  // Both edits survive: her name locally, my checked state remotely.
  assert.equal(plan.localUpdate.length, 1)
  assert.equal(plan.localUpdate[0].name, 'Oat milk')
  assert.equal(plan.localUpdate[0].checked, true)
  assert.equal(plan.pushUpdate.length, 1)
  assert.equal(plan.pushUpdate[0].checked, true)
  assert.equal(plan.pushUpdate[0].name, 'Oat milk')
})

test('a null shadow adopts the remote as baseline instead of inventing a conflict', () => {
  // Has a remote id but no recorded agreement — the first sync after linking.
  const plan = planMerge(
    [local({ name: 'Milk', shadow_name: null, shadow_checked: null })],
    [remote({ name: 'Milk', state: 'complete' })],
  )
  assert.equal(plan.conflicts.length, 0)
  assert.equal(plan.localUpdate.length, 1, 'remote state is taken as truth')
  assert.equal(plan.localUpdate[0].checked, true)
})

// ---- deletion, in both directions ----

test('explicit local delete pushes the removal to Trello', () => {
  const plan = planMerge([local({ deleted_at: '2026-07-27T10:00:00Z' })], [remote()])
  assert.equal(plan.pushDelete.length, 1)
  assert.equal(plan.localPurge.length, 0)
})

test('deleted on both sides just drops the row', () => {
  const plan = planMerge([local({ deleted_at: '2026-07-27T10:00:00Z' })], [])
  assert.equal(plan.localPurge.length, 1)
  assert.equal(plan.pushDelete.length, 0)
})

test('an item that never reached Trello and was deleted is dropped, never pushed', () => {
  const plan = planMerge(
    [local({ trello_check_item_id: null, shadow_name: null, shadow_checked: null, deleted_at: '2026-07-27T10:00:00Z' })],
    [],
  )
  assert.equal(plan.localPurge.length, 1)
  assert.equal(plan.pushCreate.length, 0, 'a deleted item must not be resurrected onto Trello')
})

test('she deleted it on Trello: we accept the removal', () => {
  const plan = planMerge(
    [local({ id: 'l1', trello_check_item_id: 'r1' }), local({ id: 'l2', trello_check_item_id: 'r2', name: 'Eggs' })],
    [remote({ id: 'r2', name: 'Eggs' })],
  )
  assert.deepEqual(names(plan.localPurge), ['Milk'])
  assert.equal(plan.skippedDeletes, 0)
})

// ---- the wipe guard ----

test('a poll that loses most of the list is treated as a bad response, not a mass delete', () => {
  const locals = Array.from({ length: 10 }, (_, i) =>
    local({ id: `l${i}`, trello_check_item_id: `r${i}`, name: `Item ${i}` }))
  const plan = planMerge(locals, [remote({ id: 'r0', name: 'Item 0' })]) // 9 of 10 vanished
  assert.equal(plan.localPurge.length, 0, 'nothing may be deleted on a suspicious response')
  assert.equal(plan.skippedDeletes, 9)
})

test('the guard does not fire on a small list where a real delete is ordinary', () => {
  const locals = [
    local({ id: 'l1', trello_check_item_id: 'r1', name: 'Milk' }),
    local({ id: 'l2', trello_check_item_id: 'r2', name: 'Eggs' }),
  ]
  const plan = planMerge(locals, [remote({ id: 'r2', name: 'Eggs' })]) // 1 of 2 gone
  assert.equal(plan.skippedDeletes, 0)
  assert.deepEqual(names(plan.localPurge), ['Milk'], 'a normal delete still works')
})

test('the guard still lets unrelated merges through in the same round', () => {
  const locals = Array.from({ length: 10 }, (_, i) =>
    local({ id: `l${i}`, trello_check_item_id: `r${i}`, name: `Item ${i}` }))
  locals[0].checked = true // an edit of mine, on the one item that survived
  const plan = planMerge(locals, [remote({ id: 'r0', name: 'Item 0' })])
  assert.equal(plan.localPurge.length, 0)
  assert.equal(plan.pushUpdate.length, 1, 'a suspicious response must not block real work')
  assert.equal(plan.pushUpdate[0].checked, true)
})

test('an empty remote checklist never wipes a populated list', () => {
  const locals = Array.from({ length: 6 }, (_, i) =>
    local({ id: `l${i}`, trello_check_item_id: `r${i}`, name: `Item ${i}` }))
  const plan = planMerge(locals, [])
  assert.equal(plan.localPurge.length, 0)
  assert.equal(plan.skippedDeletes, 6)
})

// ---- mixed round ----

test('a realistic round: she adds two, I check one, one is renamed remotely', () => {
  const locals = [
    local({ id: 'l1', trello_check_item_id: 'r1', name: 'Milk', checked: true }), // I checked it
    local({ id: 'l2', trello_check_item_id: 'r2', name: 'Bread', shadow_name: 'Bread' }),
    local({ id: 'l3', trello_check_item_id: null, shadow_name: null, shadow_checked: null, name: 'Coffee' }), // I added
  ]
  const remotes = [
    remote({ id: 'r1', name: 'Milk' }),
    remote({ id: 'r2', name: 'Sourdough' }),          // she renamed
    remote({ id: 'r7', name: 'Bananas' }),            // she added
    remote({ id: 'r8', name: 'Apples' }),             // she added
  ]
  const plan = planMerge(locals, remotes)
  assert.deepEqual(names(plan.pushCreate), ['Coffee'])
  assert.deepEqual(names(plan.localCreate).sort(), ['Apples', 'Bananas'])
  assert.deepEqual(names(plan.pushUpdate), ['Milk'])
  assert.deepEqual(names(plan.localUpdate), ['Bread'])
  assert.equal(plan.localUpdate[0].name, 'Sourdough')
  assert.equal(plan.conflicts.length, 0)
  assert.equal(plan.localPurge.length, 0)
})
