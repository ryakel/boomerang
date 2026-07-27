import { useState, useCallback, useEffect } from 'react'
import {
  fetchLists, createListApi, updateListApi, deleteListApi,
  fetchListItems, addListItemsApi, updateListItemApi, deleteListItemApi, syncListApi,
  fetchListSources, createListSourceApi, expandListSourceApi, deleteListSourceApi,
} from '../api'

// Lists — sets of items kept in bidirectional sync with a Trello checklist.
// The server is the source of truth: it holds the 3-way merge baseline, so the
// client must never "win" an argument with it. Local state here is a cache of
// what the server last said, updated optimistically for the user's own actions
// and corrected on the next reload.
export function useLists() {
  const [lists, setLists] = useState([])
  // What was LINKED, as opposed to what it expanded into. Kept alongside the
  // lists because the index groups by them and the settings surface manages
  // them; a source with zero lists still has to be visible, or a link that
  // expanded to nothing looks like it silently failed.
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      // Settled, not all-or-nothing: sources failing must not blank the lists.
      const [l, s] = await Promise.allSettled([fetchLists(), fetchListSources()])
      if (l.status === 'fulfilled') setLists(l.value)
      else console.error('[Lists] Load failed:', l.reason)
      if (s.status === 'fulfilled') setSources(s.value)
      else console.error('[Lists] Sources load failed:', s.reason)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const addList = useCallback(async (fields) => {
    const list = await createListApi(fields)
    setLists(prev => [...prev, { ...list, item_count: 0, unchecked_count: 0 }])
    return list
  }, [])

  const editList = useCallback(async (id, updates) => {
    const list = await updateListApi(id, updates)
    setLists(prev => prev.map(l => (l.id === id ? { ...l, ...list } : l)))
    return list
  }, [])

  const removeList = useCallback(async (id) => {
    await deleteListApi(id)
    setLists(prev => prev.filter(l => l.id !== id))
  }, [])

  // Manual order, after a drag. `sort_order` is a BOOMERANG-ONLY column — the
  // sync engine never pushes list order anywhere, so reordering lists writes
  // nothing to Trello and cannot disturb a list someone else is relying on.
  // (Reordering ITEMS is the opposite: `position` is what Trello orders by.
  // That is a separate, riskier piece — see wiki/Claude-Notes-Integrations.md.)
  const reorderLists = useCallback(async (orderedIds) => {
    const index = new Map(orderedIds.map((id, i) => [id, i]))
    // Optimistic — a drag that visibly snaps back while the server thinks
    // about it feels broken even when it succeeds.
    setLists(prev => [...prev].sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0))
      .map(l => ({ ...l, sort_order: index.get(l.id) ?? l.sort_order })))
    try {
      // Only the rows that actually moved. N is small (one row per list), and
      // skipping unchanged ones keeps a nudge of one list from rewriting all.
      await Promise.all(orderedIds.map((id, i) => updateListApi(id, { sort_order: i })))
    } catch (err) {
      console.error('[Lists] Reorder failed:', err)
      await reload() // server is the source of truth; take its answer back
      throw err
    }
  }, [reload])

  // Linking expands server-side immediately, so the new lists are already
  // there by the time this resolves — reload rather than guess at them.
  const addSource = useCallback(async (fields) => {
    const data = await createListSourceApi(fields)
    await reload()
    return data
  }, [reload])

  const expandSource = useCallback(async (id) => {
    const result = await expandListSourceApi(id)
    await reload()
    return result
  }, [reload])

  // Unlinking keeps the lists (server clears source_id). Reload rather than
  // filtering locally, so the UI shows the surviving lists rather than
  // implying they went with the source.
  const removeSource = useCallback(async (id) => {
    await deleteListSourceApi(id)
    await reload()
  }, [reload])

  return {
    lists, sources, loading, reload,
    addList, editList, removeList, reorderLists,
    addSource, expandSource, removeSource,
  }
}

// Items for one open list. Separate hook so the index doesn't carry every
// item of every list around, and so opening a list is a single fetch.
export function useListItems(listId) {
  const [items, setItems] = useState([])
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    if (!listId) { setItems([]); setList(null); return }
    setLoading(true)
    try {
      const data = await fetchListItems(listId)
      setItems(data.items || [])
      setList(data.list || null)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [listId])

  useEffect(() => { reload() }, [reload])

  // "milk, eggs, bread" and a pasted multi-line shopping list are both one
  // action. Split here rather than in the component so every caller gets it.
  const addItems = useCallback(async (raw) => {
    const names = String(raw)
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(Boolean)
    if (!names.length) return []
    const created = await addListItemsApi(listId, names)
    setItems(prev => [...prev, ...created])
    return created
  }, [listId])

  const toggleItem = useCallback(async (itemId, checked) => {
    // Optimistic: ticking things off in a shop should feel instant, and the
    // server's answer is the same value we just sent.
    setItems(prev => prev.map(i => (i.id === itemId ? { ...i, checked } : i)))
    try {
      const item = await updateListItemApi(listId, itemId, { checked })
      setItems(prev => prev.map(i => (i.id === itemId ? item : i)))
    } catch (err) {
      setItems(prev => prev.map(i => (i.id === itemId ? { ...i, checked: !checked } : i)))
      throw err
    }
  }, [listId])

  const renameItem = useCallback(async (itemId, name) => {
    const item = await updateListItemApi(listId, itemId, { name })
    setItems(prev => prev.map(i => (i.id === itemId ? item : i)))
    return item
  }, [listId])

  const removeItem = useCallback(async (itemId) => {
    await deleteListItemApi(listId, itemId)
    setItems(prev => prev.filter(i => i.id !== itemId))
  }, [listId])

  // Forced sync. Reloads afterwards because the merge may have pulled in
  // whatever the other person changed since the last poll.
  const syncNow = useCallback(async () => {
    const result = await syncListApi(listId)
    await reload()
    return result
  }, [listId, reload])

  return { list, items, loading, error, reload, addItems, toggleItem, renameItem, removeItem, syncNow }
}
