// listMerge.js — the 3-way merge that decides who wins between Boomerang and
// a Trello checklist. Deliberately dependency-free: no database, no network,
// no credentials. Every rule about whose edit survives is exercised by
// scripts/lists.test.mjs without any of that being present.
//
// WHY A 3-WAY MERGE: the list is edited by two people on two devices, and
// neither side reports a per-item modification time (Trello checkItems carry
// no dateLastActivity). A two-way diff between "what I have" and "what Trello
// has" cannot distinguish "I changed this" from "she changed this", so it
// degrades into last-writer-wins and silently eats one person's edit whenever
// both touch the list between polls. The shadow_* columns hold what the two
// sides last AGREED on; comparing each side against that baseline separately
// is what makes the difference legible.

// A poll that has lost more than this fraction of the previously-synced items
// is assumed to be a bad response rather than a real mass deletion.
export const WIPE_GUARD_FRACTION = 0.5
// ...but only once the list is big enough for the fraction to mean anything.
// Deleting 2 of 3 items is an ordinary afternoon; losing 20 of 30 is not.
export const WIPE_GUARD_MIN_MISSING = 3

/**
 * @param localItems  rows from list_items, INCLUDING tombstones
 * @param remoteItems Trello checkItems: { id, name, state: 'complete'|'incomplete', pos }
 * @returns a plan of operations plus any conflicts, applying nothing itself
 */
export function planMerge(localItems, remoteItems) {
  const plan = {
    pushCreate: [],  // local item with no remote counterpart yet
    pushUpdate: [],  // { item, name, checked } — local edit wins
    pushDelete: [],  // explicit local delete, confirmed by a tombstone
    localCreate: [], // remote item we have never seen
    localUpdate: [], // { item, name, checked } — remote edit wins
    localPurge: [],  // remote is gone; drop our row
    shadowOnly: [],  // already converged, just refresh the baseline
    conflicts: [],   // both sides moved and disagree; local won, say so
    skippedDeletes: 0,
  }

  const remoteById = new Map(remoteItems.map(r => [r.id, r]))
  const claimedRemote = new Set()

  // How much of what we had previously agreed on has vanished from the remote?
  // Computed before we act on any of it, so the guard sees the whole picture.
  const previouslySynced = localItems.filter(i => i.trello_check_item_id && !i.deleted_at)
  const missing = previouslySynced.filter(i => !remoteById.has(i.trello_check_item_id))
  const suspiciousWipe = previouslySynced.length > 0
    && missing.length >= WIPE_GUARD_MIN_MISSING
    && (missing.length / previouslySynced.length) > WIPE_GUARD_FRACTION

  for (const item of localItems) {
    // Never pushed anywhere yet.
    if (!item.trello_check_item_id) {
      if (item.deleted_at) plan.localPurge.push(item) // born and died locally
      else plan.pushCreate.push(item)
      continue
    }

    const remote = remoteById.get(item.trello_check_item_id)
    if (remote) claimedRemote.add(remote.id)

    if (!remote) {
      // Gone from Trello. If we also deleted it, both sides agree — drop it.
      if (item.deleted_at) { plan.localPurge.push(item); continue }
      // Otherwise she deleted it there. Accept that, unless the whole response
      // looks wrong, in which case do nothing and let the next poll decide.
      if (suspiciousWipe) plan.skippedDeletes++
      else plan.localPurge.push(item)
      continue
    }

    // Explicit local delete of an item that still exists remotely. This is the
    // ONLY path that removes anything from Trello.
    if (item.deleted_at) { plan.pushDelete.push(item); continue }

    const remoteChecked = remote.state === 'complete'
    // A null shadow means we hold a remote id but never recorded what the two
    // sides agreed on. Fall back to the LOCAL value as the baseline, which
    // makes any difference read as a remote change and pull it in. The
    // alternative — treating the remote as the baseline — makes every
    // difference look like a local edit and pushes unproven local state over
    // hers, which is the one direction that can destroy someone else's data.
    // When we cannot prove who moved, the other side wins.
    const shadowName = item.shadow_name ?? item.name
    const shadowChecked = item.shadow_checked ?? !!item.checked

    const localNameMoved = item.name !== shadowName
    const remoteNameMoved = remote.name !== shadowName
    const localCheckMoved = !!item.checked !== !!shadowChecked
    const remoteCheckMoved = remoteChecked !== !!shadowChecked

    if (!localNameMoved && !remoteNameMoved && !localCheckMoved && !remoteCheckMoved) {
      continue // nothing moved anywhere
    }

    // Resolve each field independently: someone renaming an item while the
    // other checks it off is cooperation, not a conflict.
    let name = item.name
    let checked = !!item.checked
    let conflicted = false

    if (localNameMoved && remoteNameMoved && item.name !== remote.name) {
      conflicted = true; name = item.name        // local wins, see below
    } else if (remoteNameMoved && !localNameMoved) {
      name = remote.name
    }

    if (localCheckMoved && remoteCheckMoved && !!item.checked !== remoteChecked) {
      conflicted = true; checked = !!item.checked
    } else if (remoteCheckMoved && !localCheckMoved) {
      checked = remoteChecked
    }

    if (conflicted) {
      // Local wins on a genuine collision. Not because it is more correct, but
      // because Trello gives us no per-item timestamp, so "most recent" is not
      // knowable — and losing your own just-made edit is the more confusing
      // failure. Surfaced rather than swallowed.
      plan.conflicts.push({ item, local: { name: item.name, checked: !!item.checked },
                            remote: { name: remote.name, checked: remoteChecked } })
    }

    const needsPush = name !== remote.name || checked !== remoteChecked
    const needsLocal = name !== item.name || checked !== !!item.checked

    if (needsPush) plan.pushUpdate.push({ item, name, checked })
    if (needsLocal) plan.localUpdate.push({ item, name, checked })
    if (!needsPush && !needsLocal) plan.shadowOnly.push({ item, name, checked })
  }

  // Anything on Trello we have never seen: she added it.
  for (const remote of remoteItems) {
    if (!claimedRemote.has(remote.id)) plan.localCreate.push(remote)
  }

  return plan
}
