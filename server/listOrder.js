// listOrder.js — where an item lands when you drag it. Pure: no db, no
// network, no clock. Tested in scripts/listOrder.test.mjs.
//
// The third pure module in this feature, for the same reason as the other two:
// the arithmetic has edge cases that are miserable to debug through a UI, and
// this one decides a value we PUSH to someone else's Trello checklist.
//
//   listMerge  — what the items inside one checklist should say
//   listExpand — which checklists should have a Boomerang list
//   listOrder  — where one item sits among its siblings
//
// `position` mirrors Trello's `pos`, which is a float precisely so a client can
// slot something between two neighbours without renumbering the rest. One drag
// should therefore be ONE write to her card, not N.

// Trello's own default spacing. Used when appending or when a list has to be
// renumbered from scratch.
const STEP = 65536

// Floats run out of room between two neighbours after ~50 halvings. Well
// before that the gap stops being representable and two items collide, so a
// gap this small means "renumber" rather than "keep halving".
const MIN_GAP = 1e-6

/**
 * Decide the new position for `movedId` placed immediately before `beforeId`
 * (or at the end when `beforeId` is null).
 *
 * @param items    live items in current order, each {id, position}
 * @param movedId  the item being dragged
 * @param beforeId the item it should land in front of, or null for the end
 * @returns {{ position: number, renumber: Array<{id, position}> } | null}
 *   `position` is the moved item's new value. `renumber` is non-empty only
 *   when the neighbours left no representable gap — in which case the caller
 *   must apply the whole spread. `null` means the move is a no-op.
 */
export function planMove(items, movedId, beforeId = null) {
  const list = (Array.isArray(items) ? items : []).filter(i => i && i.id)
  const from = list.findIndex(i => i.id === movedId)
  if (from < 0) return null
  if (beforeId === movedId) return null // dropped on itself

  const without = list.filter(i => i.id !== movedId)
  const to = beforeId == null ? without.length : without.findIndex(i => i.id === beforeId)
  if (beforeId != null && to < 0) return null // target vanished

  // Already there — don't burn a write to someone else's card on a no-op drag.
  const reordered = without.slice(0, to).concat([list[from]], without.slice(to))
  if (reordered.every((it, idx) => it.id === list[idx].id)) return null

  const prev = to > 0 ? without[to - 1] : null
  const next = to < without.length ? without[to] : null

  const prevPos = prev ? num(prev.position) : null
  const nextPos = next ? num(next.position) : null

  // Ends are cheap: step outside the neighbour rather than inventing a gap.
  if (prevPos == null && nextPos == null) return { position: STEP, renumber: [] }
  if (prevPos == null) return { position: nextPos - STEP, renumber: [] }
  if (nextPos == null) return { position: prevPos + STEP, renumber: [] }

  // The neighbours are out of order, or sit on top of each other — which is
  // the normal state for a list seeded with everything at 0. Halving into that
  // produces a position that does not order correctly, so spread the whole
  // list instead. Local renumbering is free; only the moved item is pushed.
  if (nextPos - prevPos <= MIN_GAP) {
    return {
      position: (to + 1) * STEP,
      renumber: reordered.map((it, i) => ({ id: it.id, position: (i + 1) * STEP })),
    }
  }

  return { position: prevPos + (nextPos - prevPos) / 2, renumber: [] }
}

function num(v) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
