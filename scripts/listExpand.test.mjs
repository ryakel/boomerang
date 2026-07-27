// Unit tests for server/listExpand.js — which Boomerang lists should exist for
// a linked Trello container.
//
// The twin of lists.test.mjs. That file pins what happens to the ITEMS inside
// a checklist; this one pins what happens to the CHECKLISTS themselves. Both
// guard the same thing from different heights: this is someone else's board,
// and a wrong answer here orphans or duplicates whole lists rather than single
// items. Run via `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planExpansion, groupsFromCard, groupsFromColumn } from '../server/listExpand.js'

const source = { id: 'src1', scope: 'card' }

// A `lists` row as materialized by a previous expansion.
const list = (over = {}) => ({
  id: 'L1', name: 'Grocery', source_id: 'src1',
  trello_checklist_id: 'cl1', trello_card_id: 'card1', trello_card_name: '2026 Groceries',
  trello_column_id: 'col1', trello_column_name: 'Shopping',
  shadow_name: 'Grocery', orphaned_at: null, ...over,
})

const group = (over = {}) => ({
  cardId: 'card1', cardName: '2026 Groceries',
  columnId: 'col1', columnName: 'Shopping',
  checklists: [{ id: 'cl1', name: 'Grocery' }], ...over,
})

// ---- discovery, the reason the feature exists ----

test('a checklist with no list yet is created', () => {
  const plan = planExpansion(source, [group()], [])
  assert.equal(plan.create.length, 1)
  assert.equal(plan.create[0].trello_checklist_id, 'cl1')
  assert.equal(plan.create[0].name, 'Grocery')
  assert.equal(plan.create[0].trello_column_name, 'Shopping')
})

test('a SECOND checklist added on the card is discovered', () => {
  const g = group({ checklists: [{ id: 'cl1', name: 'Grocery' }, { id: 'cl2', name: 'Checklist 2' }] })
  const plan = planExpansion(source, [g], [list()])
  assert.equal(plan.create.length, 1)
  assert.equal(plan.create[0].trello_checklist_id, 'cl2')
  assert.equal(plan.orphan.length, 0)
})

test('column scope discovers a whole new card', () => {
  const groups = groupsFromColumn(
    { id: 'col1', name: 'Shopping' },
    [
      { id: 'card1', name: '2026 Groceries', checklists: [{ id: 'cl1', name: 'Grocery' }] },
      { id: 'card2', name: 'Costco', checklists: [{ id: 'cl9', name: 'Costco' }] },
    ],
  )
  const plan = planExpansion({ id: 'src1', scope: 'column' }, groups, [list()])
  assert.equal(plan.create.length, 1)
  assert.equal(plan.create[0].trello_card_name, 'Costco')
  assert.equal(plan.create[0].trello_column_name, 'Shopping')
})

test('nothing to do when everything already matches', () => {
  const plan = planExpansion(source, [group()], [list()])
  assert.deepEqual(
    [plan.create.length, plan.rename.length, plan.orphan.length, plan.recontext.length],
    [0, 0, 0, 0],
  )
})

// ---- names: the 3-way rules, one level up from items ----

test('she renamed the checklist — we take her name', () => {
  const g = group({ checklists: [{ id: 'cl1', name: 'Groceries' }] })
  const plan = planExpansion(source, [g], [list({ name: 'Grocery', shadow_name: 'Grocery' })])
  assert.equal(plan.rename.length, 1)
  assert.equal(plan.rename[0].name, 'Groceries')
  assert.equal(plan.conflicts.length, 0)
})

test('we renamed it locally — never auto-pushed to her card, flagged instead', () => {
  const plan = planExpansion(source, [group()], [list({ name: 'My Groceries', shadow_name: 'Grocery' })])
  assert.equal(plan.rename.length, 0)
  assert.equal(plan.conflicts.length, 1)
  assert.equal(plan.conflicts[0].local, 'My Groceries')
})

test('both sides renamed it — conflict, not a silent pick', () => {
  const g = group({ checklists: [{ id: 'cl1', name: 'Her Name' }] })
  const plan = planExpansion(source, [g], [list({ name: 'My Name', shadow_name: 'Grocery' })])
  assert.equal(plan.conflicts.length, 1)
  assert.equal(plan.rename.length, 0)
})

test('null shadow — the OTHER side wins, because we cannot prove who moved', () => {
  // Same rule as the item merge. Pushing an unproven local name would rewrite
  // the title of a checklist on someone else's card.
  const g = group({ checklists: [{ id: 'cl1', name: 'Hers' }] })
  const plan = planExpansion(source, [g], [list({ name: 'Ours', shadow_name: null })])
  assert.equal(plan.rename.length, 1)
  assert.equal(plan.rename[0].name, 'Hers')
  assert.equal(plan.conflicts.length, 0)
})

// ---- disappearance: tombstone, never delete ----

test('a vanished checklist is orphaned, never dropped', () => {
  const g = group({ checklists: [] })
  const plan = planExpansion(source, [g], [list()])
  assert.equal(plan.orphan.length, 1)
  assert.equal(plan.orphan[0].list.id, 'L1')
})

test('an orphaned checklist that reappears is revived, not duplicated', () => {
  const plan = planExpansion(source, [group()], [list({ orphaned_at: '2026-07-27T00:00:00Z' })])
  assert.equal(plan.revive.length, 1)
  assert.equal(plan.create.length, 0)
})

test('losing MOST lists at once is a bad response, not a mass delete', () => {
  const existing = [
    list({ id: 'L1', trello_checklist_id: 'cl1' }),
    list({ id: 'L2', trello_checklist_id: 'cl2' }),
    list({ id: 'L3', trello_checklist_id: 'cl3' }),
    list({ id: 'L4', trello_checklist_id: 'cl4' }),
  ]
  const plan = planExpansion(source, [group({ checklists: [{ id: 'cl1', name: 'Grocery' }] })], existing)
  assert.equal(plan.orphan.length, 0)
  assert.equal(plan.skippedOrphans, 3)
})

test('losing ONE of four is a real removal and is tombstoned', () => {
  const existing = [
    list({ id: 'L1', trello_checklist_id: 'cl1' }),
    list({ id: 'L2', trello_checklist_id: 'cl2' }),
    list({ id: 'L3', trello_checklist_id: 'cl3' }),
    list({ id: 'L4', trello_checklist_id: 'cl4' }),
  ]
  const g = group({
    checklists: [
      { id: 'cl1', name: 'Grocery' }, { id: 'cl2', name: 'Grocery' }, { id: 'cl3', name: 'Grocery' },
    ],
  })
  const plan = planExpansion(source, [g], existing)
  assert.equal(plan.orphan.length, 1)
  assert.equal(plan.orphan[0].list.id, 'L4')
  assert.equal(plan.skippedOrphans, 0)
})

test('an empty response below the guard minimum still orphans', () => {
  // Two lists is under LOSS_GUARD_MIN, so the ratio guard does not apply —
  // otherwise a small board could never register a genuine removal.
  const existing = [list({ id: 'L1', trello_checklist_id: 'cl1' }), list({ id: 'L2', trello_checklist_id: 'cl2' })]
  const plan = planExpansion(source, [group({ checklists: [{ id: 'cl1', name: 'Grocery' }] })], existing)
  assert.equal(plan.orphan.length, 1)
})

// ---- isolation: a source only touches what it made ----

test('a hand-linked list is untouched — it is never passed in as this source’s', () => {
  // `existing` is scoped to the source by the caller. Expansion given an empty
  // set must not invent orphans out of lists it cannot see.
  const plan = planExpansion(source, [group({ checklists: [] })], [])
  assert.equal(plan.orphan.length, 0)
  assert.equal(plan.create.length, 0)
})

// ---- context: cards get renamed and moved ----

test('a renamed card updates the breadcrumb, not the items', () => {
  const g = group({ cardName: 'Groceries 2027' })
  const plan = planExpansion(source, [g], [list()])
  assert.equal(plan.recontext.length, 1)
  assert.equal(plan.recontext[0].patch.trello_card_name, 'Groceries 2027')
  assert.equal(plan.rename.length, 0)
})

test('a card moved to another column re-parents the list', () => {
  const g = group({ columnId: 'col9', columnName: 'Done' })
  const plan = planExpansion(source, [g], [list()])
  assert.equal(plan.recontext[0].patch.trello_column_id, 'col9')
  assert.equal(plan.recontext[0].patch.trello_column_name, 'Done')
})

test('a failed name lookup does NOT blank an existing breadcrumb', () => {
  // The column-name fetch is best-effort — losing a breadcrumb must never fail
  // a sync — so '' here means "didn't learn it", not "it is blank now".
  // Treating '' as authoritative made the breadcrumb flicker off on any
  // transient error and back on the next poll. Ids stay authoritative.
  const g = group({ columnName: '', cardName: '' })
  const plan = planExpansion(source, [g], [list()])
  assert.equal(plan.recontext.length, 0)
})

test('a real name still overwrites a stale one', () => {
  const g = group({ columnName: 'Groceries Done' })
  const plan = planExpansion(source, [g], [list()])
  assert.equal(plan.recontext[0].patch.trello_column_name, 'Groceries Done')
})

test('a checklist moved to a different card follows it', () => {
  const g = group({ cardId: 'card2', cardName: 'Costco' })
  const plan = planExpansion(source, [g], [list()])
  assert.equal(plan.recontext[0].patch.trello_card_id, 'card2')
  assert.equal(plan.orphan.length, 0) // moved, not gone
})

// ---- shapes ----

test('groupsFromCard falls back to the card’s own idList for the column', () => {
  const [g] = groupsFromCard({ id: 'card1', name: 'C', idList: 'colX' }, [{ id: 'cl1', name: 'x' }])
  assert.equal(g.columnId, 'colX')
})

test('malformed input is inert rather than destructive', () => {
  assert.equal(planExpansion(source, null, [list()]).skippedOrphans, 0)
  assert.equal(planExpansion(source, undefined, []).create.length, 0)
  // A checklist with no id cannot be matched or created — skipped, not crashed.
  const plan = planExpansion(source, [group({ checklists: [{ name: 'no id' }] })], [])
  assert.equal(plan.create.length, 0)
})
