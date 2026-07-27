// listExpand.js — decides WHICH Boomerang lists should exist for a linked
// Trello container. Pure: no db, no network, no clock. Tested in
// scripts/listExpand.test.mjs.
//
// This is the deliberate twin of listMerge.js, and the split matters:
//
//   listMerge  — what the ITEMS inside one checklist should say
//   listExpand — which CHECKLISTS should have a Boomerang list at all
//
// Keeping them apart is what let link scope be added without touching a single
// line of the merge, which is the one place someone else's data can be
// destroyed and which is pinned by its own 19 tests.
//
// SAFETY POSTURE (unchanged from the merge — this is still someone else's
// data, one level up):
//   - Expansion NEVER deletes anything, locally or on Trello. A checklist that
//     stops appearing is TOMBSTONED (orphaned), never dropped, because "gone
//     from this response" and "gone for good" are indistinguishable.
//   - A response that appears to have lost most of the containers is treated
//     as a bad response, not a mass delete — the same guard the merge applies
//     to items, applied to the level above.
//   - A source only ever touches lists IT created. A hand-linked list is
//     invisible to expansion, so linking a card can never swallow a list the
//     user pinned deliberately.

// A response missing more than this share of previously-materialized lists is
// treated as bad rather than as intent. Matches the merge's item-level guard
// so the two levels fail the same way.
const LOSS_GUARD_RATIO = 0.5
const LOSS_GUARD_MIN = 3

// Normalize the shapes we accept so callers can hand us Trello payloads
// directly. A `card` scope yields one group; a `column` scope yields one per
// card. Each group is { cardId, cardName, columnId, columnName, checklists }.
export function groupsFromCard(card, checklists, column = {}) {
  return [{
    cardId: card.id,
    cardName: card.name || '',
    columnId: column.id || card.idList || null,
    columnName: column.name || '',
    checklists: Array.isArray(checklists) ? checklists : [],
  }]
}

export function groupsFromColumn(column, cards) {
  return (Array.isArray(cards) ? cards : []).map(c => ({
    cardId: c.id,
    cardName: c.name || '',
    columnId: column.id,
    columnName: column.name || '',
    checklists: Array.isArray(c.checklists) ? c.checklists : [],
  }))
}

/**
 * Plan the expansion of one source.
 *
 * @param source  { id, scope }
 * @param groups  the container tree as fetched — see groupsFrom* above
 * @param existing  every `lists` row currently attributed to this source
 *                  (INCLUDING already-orphaned ones, so a returning checklist
 *                  is revived rather than duplicated)
 * @returns {{
 *   create:  Array<{ trello_checklist_id, name, ... }>,
 *   rename:  Array<{ list, name }>,      // remote renamed, we agreed before
 *   recontext: Array<{ list, patch }>,   // card/column moved or was renamed
 *   revive:  Array<{ list }>,            // orphaned, then reappeared
 *   orphan:  Array<{ list }>,            // vanished — tombstone, never delete
 *   conflicts: Array<{ list, local, remote }>,  // both sides renamed it
 *   skippedOrphans: number,              // suppressed by the loss guard
 * }}
 */
export function planExpansion(source, groups, existing) {
  const plan = {
    create: [], rename: [], recontext: [], revive: [], orphan: [],
    conflicts: [], skippedOrphans: 0,
  }

  const byChecklist = new Map()
  for (const l of existing) {
    if (l.trello_checklist_id) byChecklist.set(l.trello_checklist_id, l)
  }

  const seen = new Set()

  for (const g of Array.isArray(groups) ? groups : []) {
    for (const cl of g.checklists) {
      if (!cl?.id) continue
      seen.add(cl.id)
      const remoteName = cl.name || ''
      const found = byChecklist.get(cl.id)

      if (!found) {
        plan.create.push({
          trello_checklist_id: cl.id,
          trello_card_id: g.cardId,
          trello_card_name: g.cardName,
          trello_column_id: g.columnId,
          trello_column_name: g.columnName,
          name: remoteName,
          checkItems: cl.checkItems || [],
        })
        continue
      }

      if (found.orphaned_at) plan.revive.push({ list: found })

      // Name reconciliation, 3-way. `shadow_name` is what the two sides last
      // agreed this checklist was called. Without it, "I renamed the list" and
      // "she renamed the checklist" look identical and one of them gets eaten.
      const shadow = found.shadow_name
      const localName = found.name || ''
      if (remoteName !== localName) {
        if (shadow == null) {
          // Never agreed a name. We cannot prove who moved, and pushing an
          // unproven local name would rewrite HER checklist title — so the
          // other side wins, exactly as the merge does for a null shadow.
          plan.rename.push({ list: found, name: remoteName })
        } else if (localName === shadow) {
          plan.rename.push({ list: found, name: remoteName }) // only she moved
        } else if (remoteName === shadow) {
          // Only we moved. Renaming a checklist on her card is a write we do
          // not make from expansion — recorded so the caller can decide, and
          // deliberately NOT auto-pushed.
          plan.conflicts.push({ list: found, local: localName, remote: remoteName })
        } else {
          plan.conflicts.push({ list: found, local: localName, remote: remoteName })
        }
      }

      // A card renamed, or a checklist moved to another card/column. Pure
      // context — it changes the breadcrumb, never the items.
      //
      // An EMPTY name means "we didn't learn one", not "it is now blank".
      // Trello cards and columns always have names, so the only way to see ''
      // here is a fetch that degraded (the column-name lookup is deliberately
      // best-effort — losing a breadcrumb must not fail a sync). Treating ''
      // as authoritative would let one failed lookup wipe a good breadcrumb,
      // and the next successful poll would write it back: a name that flickers
      // on every transient error. Ids are authoritative; names are not.
      const patch = {}
      if (found.trello_card_id !== g.cardId) patch.trello_card_id = g.cardId
      if (g.cardName && (found.trello_card_name || '') !== g.cardName) patch.trello_card_name = g.cardName
      if (g.columnId && (found.trello_column_id || null) !== g.columnId) patch.trello_column_id = g.columnId
      if (g.columnName && (found.trello_column_name || '') !== g.columnName) patch.trello_column_name = g.columnName
      if (Object.keys(patch).length) plan.recontext.push({ list: found, patch })
    }
  }

  // Anything this source made that the response no longer mentions.
  const missing = existing.filter(l => l.trello_checklist_id && !seen.has(l.trello_checklist_id) && !l.orphaned_at)

  // The loss guard, one level up from the merge's. Losing most of the lists at
  // once is far more likely to be a partial response, a permissions blip or a
  // moved card than a deliberate mass delete — and orphaning them all would
  // flag every list in the app at once.
  const priorLive = existing.filter(l => !l.orphaned_at).length
  const lostTooMuch = priorLive >= LOSS_GUARD_MIN && missing.length > priorLive * LOSS_GUARD_RATIO
  if (lostTooMuch) {
    plan.skippedOrphans = missing.length
  } else {
    for (const l of missing) plan.orphan.push({ list: l })
  }

  return plan
}
