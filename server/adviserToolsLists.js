// adviserToolsLists.js — Quokka tools for shared lists (migration 047).
//
// These are shaped for SPEECH, which is a different pressure than the REST
// API underneath them:
//   - Everything resolves by NAME. Nobody says a UUID out loud. "the grocery
//     list" and "milk" have to be enough.
//   - Every mutating tool takes a LIST of names, because "add milk, eggs and
//     bread" is one utterance and should be one tool call, not three.
//   - An ambiguous match asks rather than guesses. Picking the wrong item off
//     a shared list is a silent wrong answer, and the whole point of this
//     feature is that nobody is watching Trello to catch it.
//
// Anything that mutates kicks a sync so the other person sees it in seconds.

import { registerTool } from './adviserTools.js'
import {
  getAllLists, getList, getListItems, getListItem,
  createListItem, updateListItemPartial, deleteListItem, upsertListItem,
} from './db.js'
import { syncList } from './trelloListSync.js'

function ensure(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Fire-and-forget: the local write already succeeded, and a Trello hiccup
// must not turn a successful "added milk" into an error in the conversation.
function kick(listId) {
  const list = getList(listId)
  if (!list?.trello_card_id || !list.sync_enabled) return
  syncList(listId).catch(err => console.log(`[ListTools] sync kick failed: ${err.message}`))
}

// Resolve a spoken list name. Exact match wins, then unique substring; an
// ambiguous or unknown name comes back as an error naming the real options,
// which Quokka can read out instead of guessing.
function resolveList(nameOrId) {
  const lists = getAllLists()
  ensure(lists.length, 'No lists exist yet. Create one first.')
  if (!nameOrId) {
    ensure(lists.length === 1, `Which list? ${lists.map(l => `"${l.name}"`).join(', ')}`)
    return lists[0]
  }
  const needle = String(nameOrId).trim().toLowerCase()
  const byId = lists.find(l => l.id === nameOrId)
  if (byId) return byId
  const exact = lists.filter(l => l.name.toLowerCase() === needle)
  if (exact.length === 1) return exact[0]
  const partial = lists.filter(l => l.name.toLowerCase().includes(needle))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) throw new Error(`"${nameOrId}" matches several lists: ${partial.map(l => `"${l.name}"`).join(', ')}`)
  throw new Error(`No list called "${nameOrId}". Available: ${lists.map(l => `"${l.name}"`).join(', ')}`)
}

// Same rules for an item within a list.
function resolveItem(listId, name) {
  const items = getListItems(listId)
  const needle = String(name).trim().toLowerCase()
  const exact = items.filter(i => i.name.toLowerCase() === needle)
  if (exact.length === 1) return exact[0]
  const partial = items.filter(i => i.name.toLowerCase().includes(needle))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) throw new Error(`"${name}" matches several items: ${partial.map(i => `"${i.name}"`).join(', ')}`)
  throw new Error(`Nothing called "${name}" on that list.`)
}

export function registerListTools() {
  registerTool({
    name: 'lists_index',
    description: 'List the user\'s shared lists (name, item counts, whether linked to Trello). Use this when the user names a list you do not recognise, or asks what lists exist.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async () => {
      const lists = getAllLists().map(l => {
        const items = getListItems(l.id)
        return {
          id: l.id, name: l.name, kind: l.kind,
          total: items.length,
          remaining: items.filter(i => !i.checked).length,
          synced: !!l.trello_card_id,
          last_synced_at: l.last_synced_at,
          sync_error: l.last_sync_error,
        }
      })
      return { result: { lists } }
    },
  })

  registerTool({
    name: 'list_read',
    description: 'Read the items on a list. Returns what is still needed and what is already ticked off. Omit `list` when the user has only one list.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: {
        list: { type: 'string', description: 'List name (or id). Optional when only one list exists.' },
        include_checked: { type: 'boolean', description: 'Include already-ticked items. Default false — spoken back, the remaining items are what matter.' },
      },
    },
    execute: async (args) => {
      const list = resolveList(args.list)
      const items = getListItems(list.id)
      const remaining = items.filter(i => !i.checked)
      return {
        result: {
          list: list.name,
          remaining: remaining.map(i => i.name),
          remaining_count: remaining.length,
          checked: args.include_checked ? items.filter(i => i.checked).map(i => i.name) : undefined,
          // Surfaced so Quokka can say "heads up, this hasn't synced since
          // Tuesday" rather than confidently reading out a stale list.
          sync_error: list.last_sync_error || undefined,
          last_synced_at: list.last_synced_at || undefined,
        },
      }
    },
  })

  registerTool({
    name: 'list_add_items',
    description: 'Add one or more items to a list. Pass every item from a single utterance in one call — "milk, eggs and bread" is one call with three names, not three calls.',
    schema: {
      type: 'object',
      properties: {
        list: { type: 'string', description: 'List name (or id). Optional when only one list exists.' },
        names: { type: 'array', items: { type: 'string' }, description: 'Item names to add.' },
      },
      required: ['names'],
    },
    preview: (a) => `Add ${a.names?.length === 1 ? `"${a.names[0]}"` : `${a.names?.length} items`} to ${a.list ? `"${a.list}"` : 'the list'}`,
    execute: async (args) => {
      const list = resolveList(args.list)
      const names = (args.names || []).map(n => String(n).trim()).filter(Boolean)
      ensure(names.length, 'No item names given')

      // Adding something already on the list is a duplicate on a shared
      // grocery list, not a second thing to buy. Report it rather than
      // silently doing nothing, so Quokka can say "milk was already on there".
      const existing = getListItems(list.id)
      const dupes = []
      const toAdd = []
      for (const name of names) {
        const hit = existing.find(i => i.name.toLowerCase() === name.toLowerCase())
        if (hit) dupes.push(hit.name)
        else toAdd.push(name)
      }

      const created = toAdd.map(name => createListItem({ list_id: list.id, name }))
      if (created.length) kick(list.id)
      return {
        result: { list: list.name, added: created.map(i => i.name), already_there: dupes },
        compensation: async () => {
          for (const item of created) deleteListItem(item.id)
          if (created.length) kick(list.id)
        },
      }
    },
  })

  registerTool({
    name: 'list_check_items',
    description: 'Tick items off a list (or untick them). Use when the user says they bought/got/have something.',
    schema: {
      type: 'object',
      properties: {
        list: { type: 'string', description: 'List name (or id). Optional when only one list exists.' },
        names: { type: 'array', items: { type: 'string' }, description: 'Item names to tick off.' },
        checked: { type: 'boolean', description: 'true to tick off (default), false to put back on the list.' },
      },
      required: ['names'],
    },
    preview: (a) => `${a.checked === false ? 'Un-tick' : 'Tick off'} ${a.names?.length === 1 ? `"${a.names[0]}"` : `${a.names?.length} items`}`,
    execute: async (args) => {
      const list = resolveList(args.list)
      const checked = args.checked !== false
      const items = (args.names || []).map(n => resolveItem(list.id, n))
      const before = items.map(i => ({ id: i.id, checked: i.checked }))
      for (const item of items) updateListItemPartial(item.id, { checked })
      kick(list.id)
      return {
        result: { list: list.name, [checked ? 'ticked_off' : 'put_back']: items.map(i => i.name) },
        compensation: async () => {
          for (const b of before) updateListItemPartial(b.id, { checked: b.checked })
          kick(list.id)
        },
      }
    },
  })

  registerTool({
    name: 'list_remove_items',
    description: 'Remove items from a list entirely — for something added by mistake or no longer wanted. To mark something as bought, use list_check_items instead.',
    schema: {
      type: 'object',
      properties: {
        list: { type: 'string', description: 'List name (or id). Optional when only one list exists.' },
        names: { type: 'array', items: { type: 'string' }, description: 'Item names to remove.' },
      },
      required: ['names'],
    },
    // Spelled out in the preview because this is the one list action that
    // reaches through and deletes from someone else's Trello card.
    preview: (a) => `Delete ${a.names?.map(n => `"${n}"`).join(', ')} from ${a.list ? `"${a.list}"` : 'the list'} (also removes it from Trello)`,
    execute: async (args) => {
      const list = resolveList(args.list)
      const items = (args.names || []).map(n => resolveItem(list.id, n))
      const snapshots = items.map(i => ({ ...i }))
      for (const item of items) deleteListItem(item.id)
      kick(list.id)
      return {
        result: { list: list.name, removed: items.map(i => i.name) },
        compensation: async () => {
          // Undo the tombstone rather than creating a fresh row: the original
          // still carries its trello_check_item_id and shadow baseline, so
          // clearing deleted_at restores it in place. Re-creating would push a
          // duplicate onto Trello instead of cancelling the delete.
          for (const snap of snapshots) {
            if (getListItem(snap.id)) upsertListItem({ ...snap, deleted_at: null })
            else createListItem({ list_id: list.id, name: snap.name, checked: snap.checked })
          }
          kick(list.id)
        },
      }
    },
  })

  registerTool({
    name: 'list_clear_checked',
    description: 'Remove everything already ticked off a list — the tidy-up after a shop. Leaves un-ticked items alone.',
    schema: {
      type: 'object',
      properties: {
        list: { type: 'string', description: 'List name (or id). Optional when only one list exists.' },
      },
    },
    preview: (a) => `Clear the ticked-off items from ${a.list ? `"${a.list}"` : 'the list'} (also removes them from Trello)`,
    execute: async (args) => {
      const list = resolveList(args.list)
      const done = getListItems(list.id).filter(i => i.checked)
      ensure(done.length, 'Nothing is ticked off on that list.')
      const snapshots = done.map(i => ({ ...i }))
      for (const item of done) deleteListItem(item.id)
      kick(list.id)
      return {
        result: { list: list.name, cleared: done.map(i => i.name), cleared_count: done.length },
        compensation: async () => {
          for (const snap of snapshots) {
            if (getListItem(snap.id)) upsertListItem({ ...snap, deleted_at: null })
            else createListItem({ list_id: list.id, name: snap.name, checked: snap.checked })
          }
          kick(list.id)
        },
      }
    },
  })
}
