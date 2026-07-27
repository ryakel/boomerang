// Unit tests for server/listOrder.js — where an item lands when you drag it.
//
// The value this computes is PUSHED to a checklist on someone else's Trello
// card, so the edge cases matter more than the happy path: a position that
// does not order correctly silently scrambles her list, and a no-op that
// still returns a value burns a write on every accidental tap. Run via
// `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planMove } from '../server/listOrder.js'

// A well-spaced list, as Trello actually hands them over.
const spread = () => [
  { id: 'a', position: 65536 },
  { id: 'b', position: 131072 },
  { id: 'c', position: 196608 },
]

test('dragging into the middle takes the midpoint — one write, no renumber', () => {
  const r = planMove(spread(), 'c', 'b')
  assert.equal(r.position, (65536 + 131072) / 2)
  assert.deepEqual(r.renumber, [])
})

test('dragging to the top steps below the first item', () => {
  const r = planMove(spread(), 'c', 'a')
  assert.ok(r.position < 65536)
  assert.deepEqual(r.renumber, [])
})

test('dragging to the end steps above the last item', () => {
  const r = planMove(spread(), 'a', null)
  assert.ok(r.position > 196608)
  assert.deepEqual(r.renumber, [])
})

test('the computed position actually orders where intended', () => {
  // The property that matters. A midpoint that does not sort between its
  // neighbours is worse than no move at all.
  const items = spread()
  const r = planMove(items, 'c', 'b')
  const after = items
    .map(i => (i.id === 'c' ? { ...i, position: r.position } : i))
    .sort((x, y) => x.position - y.position)
    .map(i => i.id)
  assert.deepEqual(after, ['a', 'c', 'b'])
})

// ---- no-ops must not cost a write ----

test('dropping an item on itself is a no-op', () => {
  assert.equal(planMove(spread(), 'b', 'b'), null)
})

test('dropping an item where it already sits is a no-op', () => {
  // 'a' is already immediately before 'b'.
  assert.equal(planMove(spread(), 'a', 'b'), null)
})

test('moving the last item to the end is a no-op', () => {
  assert.equal(planMove(spread(), 'c', null), null)
})

// ---- degenerate positions: the seeded-at-zero case ----

test('identical neighbour positions renumber instead of halving into a tie', () => {
  // Every item at 0 is the normal state for a list built locally before it
  // ever synced. Halving 0 and 0 gives 0, which orders nowhere.
  const items = [
    { id: 'a', position: 0 },
    { id: 'b', position: 0 },
    { id: 'c', position: 0 },
  ]
  const r = planMove(items, 'c', 'b')
  assert.ok(r.renumber.length === 3, 'whole list is spread')
  assert.deepEqual(r.renumber.map(x => x.id), ['a', 'c', 'b'])
  // Strictly increasing, and the moved item's own value agrees with the spread.
  const ps = r.renumber.map(x => x.position)
  assert.ok(ps.every((p, i) => i === 0 || p > ps[i - 1]))
  assert.equal(r.position, r.renumber.find(x => x.id === 'c').position)
})

test('neighbours in the wrong order also renumber', () => {
  const items = [
    { id: 'a', position: 900 },
    { id: 'b', position: 100 },
    { id: 'c', position: 500 },
  ]
  const r = planMove(items, 'c', 'b')
  assert.ok(r.renumber.length === 3)
})

test('a gap too small to halve renumbers rather than colliding', () => {
  const items = [
    { id: 'a', position: 1 },
    { id: 'b', position: 1 + 1e-9 },
    { id: 'c', position: 5 },
  ]
  const r = planMove(items, 'c', 'b')
  assert.ok(r.renumber.length === 3, 'spread rather than produce a duplicate')
})

// ---- malformed input is inert, never destructive ----

test('an unknown moved item does nothing', () => {
  assert.equal(planMove(spread(), 'nope', 'a'), null)
})

test('a target that vanished does nothing', () => {
  assert.equal(planMove(spread(), 'a', 'gone'), null)
})

test('empty and malformed lists do not throw', () => {
  assert.equal(planMove([], 'a', null), null)
  assert.equal(planMove(null, 'a', null), null)
  assert.equal(planMove(undefined, 'a', null), null)
  assert.equal(planMove([null, { id: 'a', position: 0 }], 'a', null), null)
})

test('a single-item list cannot be reordered', () => {
  assert.equal(planMove([{ id: 'a', position: 0 }], 'a', null), null)
})

test('non-numeric positions are treated as 0 rather than NaN-poisoning the sort', () => {
  const items = [
    { id: 'a', position: null },
    { id: 'b', position: 'x' },
    { id: 'c', position: 100 },
  ]
  const r = planMove(items, 'c', 'b')
  assert.ok(r && Number.isFinite(r.position))
  for (const x of r.renumber) assert.ok(Number.isFinite(x.position))
})
