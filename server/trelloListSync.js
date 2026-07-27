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
  getListItems, upsertListItem, purgeListItem,
} from './db.js'
import { planMerge } from './listMerge.js'

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
    const wouldWrite = plan.pushCreate.length + plan.pushUpdate.length + plan.pushDelete.length
    if (wouldWrite) console.log(`[ListSync] read-only: ${wouldWrite} outbound change(s) held for "${list.name}"`)
    return
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
  // Pin to a specific checklist when we know one; otherwise adopt the first and
  // remember it, so a card that later grows a second checklist doesn't drift.
  let checklist = list.trello_checklist_id
    ? checklists.find(c => c.id === list.trello_checklist_id)
    : checklists[0]
  if (!checklist) throw new Error('The linked checklist no longer exists on that card')
  if (!list.trello_checklist_id) {
    updateListPartial(list.id, { trello_checklist_id: checklist.id })
    list.trello_checklist_id = checklist.id
  }

  const remoteItems = (checklist.checkItems || []).map(ci => ({
    id: ci.id, name: ci.name, state: ci.state, pos: ci.pos,
  }))
  const localItems = getListItems(list.id, { includeDeleted: true })

  const plan = planMerge(localItems, remoteItems)
  await applyPlan(list, plan)

  const changed = plan.pushCreate.length + plan.pushUpdate.length + plan.pushDelete.length
    + plan.localCreate.length + plan.localUpdate.length + plan.localPurge.length

  const warnings = []
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
  return { list_id: list.id, changed, conflicts: plan.conflicts.length, skippedDeletes: plan.skippedDeletes, warnings }
}

export async function syncAllLists() {
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
