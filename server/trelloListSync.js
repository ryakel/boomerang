// trelloListSync.js — bidirectional sync between a Boomerang list and a
// checklist on a Trello card (migration 047).
//
// WHY POLLING AND NOT WEBHOOKS: the server is tailnet-private and cannot
// receive inbound callbacks — the same constraint recorded in
// shippoTracking.js. Trello webhooks are therefore unavailable, so we poll.
//
// The merge itself lives in listMerge.js — pure, dependency-free, and tested
// in scripts/lists.test.mjs. This module is only plumbing: fetch, apply, poll.
//
// SAFETY POSTURE (this is someone else's data):
//   - We never delete on Trello as a side effect of a merge. A remote delete
//     happens only when the user explicitly deleted the item in Boomerang,
//     which arrives here as a tombstone.
//   - A poll that appears to have lost most of the list is treated as a bad
//     response, not as a mass delete — same reasoning as the /api/data wipe
//     guard. Deletions are skipped for that round and the error is recorded.
//   - A dev-shaped server never writes to Trello at all, so a staging box
//     cannot fight the production one over a real family grocery list.

import {
  getSyncableLists, getList, updateListPartial,
  getListItems, upsertListItem, purgeListItem, updateListItemPartial,
  getAllListSources, updateListSourcePartial, getListsBySource, upsertList,
} from './db.js'
import { planMerge } from './listMerge.js'
import { planExpansion, groupsFromCard, groupsFromColumn } from './listExpand.js'
import { planMove } from './listOrder.js'

const TRELLO_BASE = 'https://api.trello.com/1'

let pollTimer = null
let creds = { key: null, token: null }
let writesAllowed = true
let onChange = null

export function initListSync({ key, token, allowWrites = true, onChanged = null } = {}) {
  creds = { key: key || null, token: token || null }
  writesAllowed = allowWrites
  onChange = onChanged
}

function qs() {
  return `key=${encodeURIComponent(creds.key)}&token=${encodeURIComponent(creds.token)}`
}

async function trello(path, init = {}, label = 'Trello') {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${TRELLO_BASE}${path}${sep}${qs()}`, init)
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`${label} ${res.status}: ${data.message || data.error || text.slice(0, 200)}`)
  return data
}

// ============================================================
// Applying a plan
// ============================================================

async function applyPlan(list, plan) {
  const checklistId = list.trello_checklist_id
  const now = () => new Date().toISOString()

  // Pull first. Remote-origin changes are cheap, local, and cannot fail
  // halfway in a way that leaves Trello inconsistent.
  for (const remote of plan.localCreate) {
    upsertListItem({
      id: crypto.randomUUID(),
      list_id: list.id,
      name: remote.name,
      checked: remote.state === 'complete',
      position: typeof remote.pos === 'number' ? remote.pos : 0,
      trello_check_item_id: remote.id,
      shadow_name: remote.name,
      shadow_checked: remote.state === 'complete',
      deleted_at: null,
      created_at: now(), updated_at: now(),
    })
  }

  for (const { item, name, checked } of plan.localUpdate) {
    upsertListItem({ ...item, name, checked, shadow_name: name, shadow_checked: checked, updated_at: now() })
  }

  for (const item of plan.localPurge) purgeListItem(item.id)
  for (const { item, name, checked } of plan.shadowOnly) {
    upsertListItem({ ...item, shadow_name: name, shadow_checked: checked })
  }

  if (!writesAllowed) {
    // Read-only mode still merges inbound changes; it just never talks back.
    // Returned rather than only logged: a held push is indistinguishable from a
    // broken one from inside the app, and reading a server log to discover why
    // your groceries never reached Trello is not an acceptable answer.
    const wouldWrite = plan.pushCreate.length + plan.pushUpdate.length + plan.pushDelete.length
    if (wouldWrite) console.log(`[ListSync] read-only: ${wouldWrite} outbound change(s) held for "${list.name}"`)
    return { heldWrites: wouldWrite }
  }

  for (const item of plan.pushCreate) {
    const created = await trello(`/checklists/${checklistId}/checkItems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: item.name, checked: !!item.checked, pos: 'bottom' }),
    }, 'Trello add item')
    upsertListItem({
      ...item,
      trello_check_item_id: created.id,
      shadow_name: item.name,
      shadow_checked: !!item.checked,
      updated_at: now(),
    })
  }

  for (const { item, name, checked } of plan.pushUpdate) {
    await trello(`/cards/${list.trello_card_id}/checkItem/${item.trello_check_item_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, state: checked ? 'complete' : 'incomplete' }),
    }, 'Trello update item')
    upsertListItem({ ...item, name, checked, shadow_name: name, shadow_checked: checked, updated_at: now() })
  }

  for (const item of plan.pushDelete) {
    await trello(`/checklists/${checklistId}/checkItems/${item.trello_check_item_id}`,
      { method: 'DELETE' }, 'Trello delete item')
    purgeListItem(item.id) // confirmed gone on both sides
  }

  return { heldWrites: 0 }
}

// ============================================================
// Moving one item — the only ordering write we make
// ============================================================
//
// Item order is the ONE place a Boomerang view choice can rewrite the shape of
// someone else's checklist, so it is deliberately the narrowest possible path:
//
//   - Only an explicit drag ever calls this. Sorting by name or recency is
//     local view state and never touches `position` (see ListsModal.jsx).
//   - Order is never reconciled by the merge. `planMerge` does not look at
//     position and is not being taught to: a background poll that "fixes" the
//     order would be indistinguishable from her reordering it herself, and
//     we would fight her every minute.
//   - One drag is one write. `planMove` slots between neighbours rather than
//     renumbering, and returns null for a no-op so an accidental tap costs
//     nothing.
//
// Held writes surface exactly like every other push: a reorder that silently
// did nothing is the failure mode this whole feature is built to avoid.
export async function moveListItem(listId, itemId, beforeId = null) {
  const list = getList(listId)
  if (!list) throw new Error('List not found')

  const items = getListItems(listId)
  const plan = planMove(items, itemId, beforeId)
  if (!plan) return { moved: false, heldWrites: 0 }

  // Local first, always. A renumber is free and never leaves Trello because
  // relative order is what both sides actually agree on — only the dragged
  // item's new slot is worth a request.
  for (const r of plan.renumber) {
    if (r.id !== itemId) updateListItemPartial(r.id, { position: r.position })
  }
  const moved = updateListItemPartial(itemId, { position: plan.position })

  // Nothing to push for a list that was never linked, or an item Trello has
  // not seen yet — its position rides along when it is first created.
  if (!list.trello_card_id || !moved?.trello_check_item_id) {
    return { moved: true, heldWrites: 0 }
  }

  if (!writesAllowed) {
    const msg = '1 reorder waiting — this server does not write to Trello (dev). Set DEV_LIST_SYNC_WRITES=1 to enable.'
    console.log(`[ListSync] read-only: reorder held for "${list.name}"`)
    updateListPartial(listId, { last_sync_error: msg })
    return { moved: true, heldWrites: 1 }
  }

  await trello(`/cards/${list.trello_card_id}/checkItem/${moved.trello_check_item_id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pos: plan.position }),
  }, 'Trello move item')

  return { moved: true, heldWrites: 0 }
}

// ============================================================
// Expansion — which lists should exist
// ============================================================
//
// Runs BEFORE the merge each round. The decision of which checklists deserve a
// Boomerang list is kept entirely out of listMerge.js: that module is the one
// place someone else's items can be destroyed, it is pinned by 19 tests, and
// link scope was added without editing a line of it. The planning half here is
// likewise pure and lives in listExpand.js; this function is only plumbing.

async function fetchGroups(source) {
  if (source.scope === 'card') {
    const [card, checklists] = await Promise.all([
      trello(`/cards/${source.trello_id}?fields=name,idList`, {}, 'Trello card'),
      trello(`/cards/${source.trello_id}/checklists`, {}, 'Trello checklists'),
    ])
    // The column's own name needs one more hop; failing to get it costs a
    // breadcrumb, never a sync, so it degrades rather than throws.
    let column = {}
    if (card.idList) {
      try { column = await trello(`/lists/${card.idList}?fields=name`, {}, 'Trello column') } catch { /* breadcrumb only */ }
    }
    return groupsFromCard(card, checklists, { id: card.idList, name: column.name || '' })
  }

  if (source.scope === 'column') {
    const [column, cards] = await Promise.all([
      trello(`/lists/${source.trello_id}?fields=name`, {}, 'Trello column'),
      // `checklists=all` returns each card's checklists inline — one request
      // for the whole column instead of one per card.
      trello(`/lists/${source.trello_id}/cards?fields=name&checklists=all&checkItems=all`, {}, 'Trello column cards'),
    ])
    return groupsFromColumn({ id: source.trello_id, name: column.name || '' }, cards)
  }

  throw new Error(`Unknown link scope "${source.scope}"`)
}

export async function expandSource(sourceId) {
  const source = typeof sourceId === 'string' ? getAllListSources().find(s => s.id === sourceId) : sourceId
  if (!source) throw new Error('Source not found')
  if (!creds.key || !creds.token) throw new Error('Trello not configured')

  const groups = await fetchGroups(source)
  const existing = getListsBySource(source.id)
  const plan = planExpansion(source, groups, existing)
  const now = () => new Date().toISOString()

  // Expansion only ever writes LOCALLY. It creates, renames and tombstones
  // Boomerang rows; it never creates or renames anything on Trello. Adding a
  // checklist to someone's card is a structural change to their board and is
  // not something a background poll should do on its own.
  for (const c of plan.create) {
    upsertList({
      id: crypto.randomUUID(),
      name: c.name || 'Untitled',
      kind: 'shopping',
      source_id: source.id,
      trello_card_id: c.trello_card_id,
      trello_checklist_id: c.trello_checklist_id,
      trello_card_name: c.trello_card_name,
      trello_column_id: c.trello_column_id,
      trello_column_name: c.trello_column_name,
      shadow_name: c.name || '',
      sync_enabled: true,
      sort_order: 0,
      created_at: now(), updated_at: now(),
    })
  }

  // A rename we accepted becomes the new agreed baseline; without moving the
  // shadow the same rename would re-fire every poll.
  for (const { list, name } of plan.rename) {
    updateListPartial(list.id, { name, shadow_name: name })
  }
  for (const { list, patch } of plan.recontext) updateListPartial(list.id, patch)
  for (const { list } of plan.revive) updateListPartial(list.id, { orphaned_at: null })
  for (const { list } of plan.orphan) updateListPartial(list.id, { orphaned_at: now() })

  const warnings = []
  if (plan.skippedOrphans) {
    warnings.push(`${plan.skippedOrphans} list(s) missing from Trello — looked like a bad response, kept`)
  }
  for (const c of plan.conflicts) {
    warnings.push(`"${c.local}" was renamed here and is "${c.remote}" on Trello — kept yours`)
  }

  updateListSourcePartial(source.id, {
    last_expanded_at: now(),
    last_expand_error: warnings.length ? warnings.join('; ') : null,
  })

  return {
    source_id: source.id,
    created: plan.create.length,
    renamed: plan.rename.length,
    orphaned: plan.orphan.length,
    revived: plan.revive.length,
    conflicts: plan.conflicts.length,
    skippedOrphans: plan.skippedOrphans,
    warnings,
  }
}

export async function expandAllSources() {
  const results = []
  for (const source of getAllListSources()) {
    if (!source.sync_enabled) continue
    try {
      results.push(await expandSource(source))
    } catch (err) {
      console.log(`[ListSync] expand "${source.name || source.trello_id}" failed: ${err.message}`)
      updateListSourcePartial(source.id, { last_expand_error: err.message })
      results.push({ source_id: source.id, error: err.message })
    }
  }
  return results
}

// ============================================================
// One list, one round
// ============================================================

export async function syncList(listId) {
  const list = getList(listId)
  if (!list) throw new Error('List not found')
  if (!list.trello_card_id) throw new Error('List is not linked to a Trello card')
  if (!creds.key || !creds.token) throw new Error('Trello not configured')

  const checklists = await trello(`/cards/${list.trello_card_id}/checklists`, {}, 'Trello checklists')
  if (!Array.isArray(checklists) || !checklists.length) {
    throw new Error('That Trello card has no checklists')
  }
  // Pin to the checklist we were told to use. Auto-adopting checklists[0] when
  // none is pinned USED to happen here, on the assumption that multi-checklist
  // cards were exceptional. The live board disproved that — "2026 Groceries"
  // carries several — so adopting the first of many silently synced whichever
  // one Trello happened to return first and ignored the rest. An unpinned list
  // now adopts only when the card genuinely has exactly one candidate;
  // otherwise it says so and the user (or a card-scope source) decides.
  let checklist = list.trello_checklist_id
    ? checklists.find(c => c.id === list.trello_checklist_id)
    : (checklists.length === 1 ? checklists[0] : null)
  if (!checklist) {
    throw new Error(list.trello_checklist_id
      ? 'The linked checklist no longer exists on that card'
      : `That card has ${checklists.length} checklists — pick one, or link the whole card`)
  }
  if (!list.trello_checklist_id) {
    updateListPartial(list.id, { trello_checklist_id: checklist.id, shadow_name: checklist.name || '' })
    list.trello_checklist_id = checklist.id
  }

  const remoteItems = (checklist.checkItems || []).map(ci => ({
    id: ci.id, name: ci.name, state: ci.state, pos: ci.pos,
  }))
  const localItems = getListItems(list.id, { includeDeleted: true })

  const plan = planMerge(localItems, remoteItems)
  const { heldWrites } = await applyPlan(list, plan)

  const changed = plan.pushCreate.length + plan.pushUpdate.length + plan.pushDelete.length
    + plan.localCreate.length + plan.localUpdate.length + plan.localPurge.length

  const warnings = []
  if (heldWrites) {
    warnings.push(`${heldWrites} change(s) waiting — this server does not write to Trello (dev). Set DEV_LIST_SYNC_WRITES=1 to enable.`)
  }
  if (plan.skippedDeletes) {
    warnings.push(`${plan.skippedDeletes} item(s) missing from Trello — looked like a bad response, deletions skipped`)
  }
  if (plan.conflicts.length) {
    warnings.push(`${plan.conflicts.length} item(s) edited on both sides; Boomerang's version kept`)
    for (const c of plan.conflicts) {
      console.log(`[ListSync] conflict on "${c.item.name}": local ${JSON.stringify(c.local)} vs trello ${JSON.stringify(c.remote)} — local kept`)
    }
  }

  updateListPartial(list.id, {
    last_synced_at: new Date().toISOString(),
    last_sync_error: warnings.length ? warnings.join('; ') : null,
  })

  if (changed && onChange) { try { onChange(list.id) } catch { /* notifying is best-effort */ } }
  return { list_id: list.id, changed, conflicts: plan.conflicts.length, skippedDeletes: plan.skippedDeletes, heldWrites, warnings }
}

export async function syncAllLists() {
  // Expand first: a checklist or card added on the Trello side becomes a
  // Boomerang list in the same round it is discovered, rather than waiting for
  // the next one. This ordering is the whole reason link scope exists — before
  // it, new containers were never seen at all.
  //
  // Expansion failures are logged onto their own source and never abort the
  // merge; a broken source must not stop the lists that already work.
  try { await expandAllSources() } catch (err) { console.log(`[ListSync] expand pass: ${err.message}`) }

  const lists = getSyncableLists()
  const results = []
  for (const list of lists) {
    try {
      results.push(await syncList(list.id))
    } catch (err) {
      console.log(`[ListSync] "${list.name}" failed: ${err.message}`)
      updateListPartial(list.id, { last_sync_error: err.message })
      results.push({ list_id: list.id, error: err.message })
    }
  }
  return results
}

export function startListSyncPolling(intervalMs = 60 * 1000) {
  if (pollTimer) return
  if (!creds.key || !creds.token) {
    console.log('[ListSync] no Trello credentials — polling not started')
    return
  }
  console.log(`[ListSync] polling every ${Math.round(intervalMs / 1000)}s${writesAllowed ? '' : ' (read-only)'}`)
  pollTimer = setInterval(() => { syncAllLists().catch(err => console.log(`[ListSync] ${err.message}`)) }, intervalMs)
  setTimeout(() => { syncAllLists().catch(err => console.log(`[ListSync] ${err.message}`)) }, 3000)
}

export function stopListSyncPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}
