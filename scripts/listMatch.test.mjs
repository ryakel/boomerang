// Unit tests for server/listMatch.js — resolving a spoken list name.
//
// This decides where a voice-captured item LANDS, on lists another person
// reads, so the tests care most about the cases where it must REFUSE to
// choose. Run via `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchList, normalize } from '../server/listMatch.js'

// Modelled on the real board: one card with several checklists, plus sibling
// store cards.
const LISTS = [
  { id: 'a', name: 'Grocery', trello_card_name: '2026 Groceries' },
  { id: 'b', name: 'Target', trello_card_name: '2026 Groceries' },
  { id: 'c', name: 'HyVee', trello_card_name: '2026 Groceries' },
  { id: 'd', name: 'Costco', trello_card_name: 'Costco' },
  { id: 'e', name: "Trader Joe's", trello_card_name: "Trader Joe's" },
]

const id = (r) => r.match?.id

// ---- speech normalization ----

test('filler words and articles are stripped from both sides', () => {
  assert.equal(normalize('the grocery list'), 'grocery')
  assert.equal(normalize('my Costco list'), 'costco')
  assert.equal(normalize('  Trader  Joe’s  '), "trader joe's")
})

test('"the grocery list" resolves to Grocery', () => {
  const r = matchList('the grocery list', LISTS)
  assert.equal(id(r), 'a')
  assert.equal(r.reason, 'exact')
})

test('a curly apostrophe from speech still matches', () => {
  assert.equal(id(matchList('trader joe’s', LISTS)), 'e')
})

// ---- the refusals, which are the point ----

test('a prefix shared by two lists is ASKED about, never guessed', () => {
  const lists = [
    { id: 'x', name: 'Grocery' },
    { id: 'y', name: 'Grocery overflow' },
  ]
  const r = matchList('grocery', lists)
  // 'Grocery' is an EXACT hit and 'Grocery overflow' is only a prefix hit, so
  // the stronger tier resolves cleanly.
  assert.equal(id(r), 'x')

  // But two equally-exact names must not be silently split.
  const dupes = [{ id: 'x', name: 'Grocery' }, { id: 'y', name: 'grocery' }]
  const amb = matchList('grocery', dupes)
  assert.equal(amb.match, null)
  assert.equal(amb.reason, 'ambiguous')
  assert.deepEqual(amb.candidates.map(l => l.id), ['x', 'y'])
})

test('a weaker tier never rescues an ambiguous stronger one', () => {
  // Both start with "co" — falling through to substring could only widen it.
  const lists = [{ id: 'p', name: 'Costco' }, { id: 'q', name: 'Corner shop' }]
  const r = matchList('co', lists)
  assert.equal(r.match, null)
  assert.equal(r.reason, 'ambiguous')
  assert.equal(r.candidates.length, 2)
})

test('a name nobody has returns none, with the full list to choose from', () => {
  const r = matchList('hardware store', LISTS)
  assert.equal(r.match, null)
  assert.equal(r.reason, 'none')
  assert.equal(r.candidates.length, 5)
})

// ---- naming the card instead of the checklist ----

test('naming the CARD resolves when only one of its checklists could be meant', () => {
  const lists = [
    { id: 'd', name: 'Costco', trello_card_name: 'Costco' },
    { id: 'z', name: 'Hardware', trello_card_name: 'DIY' },
  ]
  assert.equal(id(matchList('costco', lists)), 'd')
})

test('naming a card that holds several checklists is ambiguous', () => {
  const r = matchList('2026 groceries', LISTS)
  assert.equal(r.match, null)
  assert.equal(r.reason, 'ambiguous')
  assert.deepEqual(r.candidates.map(l => l.id).sort(), ['a', 'b', 'c'])
})

// ---- the default list ----

test('saying nothing uses the default list', () => {
  const r = matchList('', LISTS, { defaultListId: 'd' })
  assert.equal(id(r), 'd')
  assert.equal(r.reason, 'default')
})

test('a default that no longer exists falls back to asking', () => {
  const r = matchList('', LISTS, { defaultListId: 'gone' })
  assert.equal(r.match, null)
  assert.equal(r.reason, 'ambiguous')
})

test('with exactly one list, saying nothing is unambiguous', () => {
  const r = matchList('', [{ id: 'a', name: 'Grocery' }])
  assert.equal(id(r), 'a')
  assert.equal(r.reason, 'only-one')
})

test('saying nothing with several lists and no default asks', () => {
  const r = matchList('', LISTS)
  assert.equal(r.match, null)
  assert.equal(r.reason, 'ambiguous')
})

// ---- orphans must never be a target ----

test('an orphaned list is never matched, even by exact name', () => {
  const lists = [{ id: 'o', name: 'Old Store', orphaned_at: '2026-07-27T00:00:00Z' }]
  const r = matchList('old store', lists)
  assert.equal(r.match, null)
  assert.equal(r.reason, 'no-lists')
})

test('an orphan is excluded from candidates too', () => {
  const lists = [
    { id: 'a', name: 'Grocery' },
    { id: 'o', name: 'Grocery', orphaned_at: '2026-07-27T00:00:00Z' },
  ]
  // Without the orphan filter these two would look ambiguous.
  assert.equal(id(matchList('grocery', lists)), 'a')
})

test('an orphaned default list falls back to asking rather than writing to it', () => {
  const lists = [
    { id: 'a', name: 'Grocery' },
    { id: 'o', name: 'Old', orphaned_at: '2026-07-27T00:00:00Z' },
  ]
  const r = matchList('', lists, { defaultListId: 'o' })
  assert.equal(id(r), 'a')  // only one live list remains
  assert.equal(r.reason, 'only-one')
})

// ---- malformed input is inert ----

test('no lists at all is reported, not crashed', () => {
  for (const v of [[], null, undefined]) {
    const r = matchList('grocery', v)
    assert.equal(r.match, null)
    assert.equal(r.reason, 'no-lists')
  }
})

test('rows without an id are skipped rather than returned as a match', () => {
  const r = matchList('grocery', [{ name: 'Grocery' }])
  assert.equal(r.reason, 'no-lists')
})
