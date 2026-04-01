import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings, createTask } from '../store'
import { trelloSyncAllLists, trelloUpdateCard, trelloBoardLists, inferTrelloListMapping, aiDedupTrelloCards } from '../api'

function remoteLog(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  console.log(line)
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: [line] }),
  }).catch(() => {})
}

// Status ↔ Trello list mapping
const STATUS_FOR_LIST = {} // populated at runtime from settings
const LIST_FOR_STATUS = {} // reverse lookup

function buildReverseLookup(mapping) {
  for (const key of Object.keys(LIST_FOR_STATUS)) delete LIST_FOR_STATUS[key]
  for (const key of Object.keys(STATUS_FOR_LIST)) delete STATUS_FOR_LIST[key]
  if (!mapping) return
  for (const [status, listId] of Object.entries(mapping)) {
    LIST_FOR_STATUS[status] = listId
    STATUS_FOR_LIST[listId] = status
  }
}

export function useTrelloSync(tasks, setTasks, changeStatus) {
  const syncingRef = useRef(false)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(() => loadSettings().trello_last_sync || null)
  const [syncError, setSyncError] = useState(null)

  const isTrelloConfigured = useCallback(() => {
    const s = loadSettings()
    return !!s.trello_board_id
  }, [])

  // Ensure list mapping exists — infer via AI if needed
  const ensureMapping = useCallback(async () => {
    const s = loadSettings()
    if (s.trello_list_mapping) {
      buildReverseLookup(s.trello_list_mapping)
      return s.trello_list_mapping
    }
    if (!s.trello_board_id) return null

    try {
      const lists = await trelloBoardLists(s.trello_board_id)
      const mapping = await inferTrelloListMapping(lists)
      const next = { ...loadSettings(), trello_list_mapping: mapping }
      saveSettings(next)
      buildReverseLookup(mapping)
      remoteLog('[TrelloSync] AI inferred list mapping:', mapping)
      return mapping
    } catch (err) {
      remoteLog('[TrelloSync] ERROR: failed to infer list mapping:', err.message)
      return null
    }
  }, [])

  // Pull: Trello → Boomerang
  const pullFromTrello = useCallback(async () => {
    const mapping = await ensureMapping()
    if (!mapping) return

    const listIds = Object.values(mapping)
    if (listIds.length === 0) return

    const cardsByList = await trelloSyncAllLists(listIds)

    // Build set of all known trello card IDs (use ref for fresh snapshot)
    const currentTasks = tasksRef.current
    const linkedCardIds = new Set(currentTasks.filter(t => t.trello_card_id).map(t => t.trello_card_id))

    remoteLog(`[TrelloSync] pull: ${currentTasks.length} total tasks, ${linkedCardIds.size} already linked to Trello`)
    // Log all linked card IDs for debugging
    const linkedList = currentTasks.filter(t => t.trello_card_id).map(t => `${t.title.slice(0, 30)}=${t.trello_card_id.slice(0, 8)}`)
    remoteLog(`[TrelloSync] linked tasks:`, linkedList)

    const newCards = []
    const statusUpdates = []

    for (const [listId, cards] of Object.entries(cardsByList)) {
      const status = STATUS_FOR_LIST[listId]
      if (!status) { remoteLog(`[TrelloSync] skipping list ${listId} — no status mapping`); continue }

      remoteLog(`[TrelloSync] list ${listId} (${status}): ${cards.length} cards`)

      for (const card of cards) {
        if (card.closed) continue

        if (linkedCardIds.has(card.id)) {
          // Existing linked task — check if status needs updating
          const existingTask = currentTasks.find(t => t.trello_card_id === card.id)
          if (existingTask && existingTask.status !== status && existingTask.status !== 'backlog') {
            statusUpdates.push({ taskId: existingTask.id, newStatus: status })
          }
        } else {
          newCards.push({ card, status })
          remoteLog(`[TrelloSync] unlinked card: "${card.name}" (id=${card.id.slice(0, 8)})`)
        }
      }
    }

    // Apply status updates from Trello
    for (const { taskId, newStatus } of statusUpdates) {
      changeStatus(taskId, newStatus)
    }

    if (newCards.length === 0) {
      remoteLog('[TrelloSync] no new cards to import')
      return
    }

    remoteLog(`[TrelloSync] ${newCards.length} unlinked cards to process:`, newCards.map(nc => nc.card.name))

    // Dedup: first try exact title match, then fall back to AI
    const unlinkedTasks = currentTasks.filter(t => !t.trello_card_id && t.status !== 'done')
    remoteLog(`[TrelloSync] ${unlinkedTasks.length} unlinked local tasks for dedup:`, unlinkedTasks.map(t => t.title))
    const matchMap = new Map()

    // Pass 1: exact title match (case-insensitive)
    const titleIndex = new Map()
    for (const t of unlinkedTasks) {
      const key = t.title.toLowerCase().trim()
      if (!titleIndex.has(key)) titleIndex.set(key, t.id)
    }
    const remainingCards = []
    for (const nc of newCards) {
      const key = nc.card.name.toLowerCase().trim()
      const matchedId = titleIndex.get(key)
      if (matchedId) {
        matchMap.set(nc.card.id, matchedId)
        titleIndex.delete(key) // don't double-match
        remoteLog(`[TrelloSync] exact title match: "${nc.card.name}" → ${matchedId.slice(0, 8)}`)
      } else {
        remainingCards.push(nc)
      }
    }

    // Pass 2: AI dedup for remaining unmatched cards
    if (remainingCards.length > 0 && unlinkedTasks.length > 0) {
      try {
        const dedupResult = await aiDedupTrelloCards(
          remainingCards.map(nc => nc.card),
          unlinkedTasks
        )
        const matches = dedupResult.matches || []
        for (const m of matches) {
          if (m.task_id && m.confidence >= 0.85 && !matchMap.has(m.card_id)) {
            matchMap.set(m.card_id, m.task_id)
          }
        }
      } catch (err) {
        remoteLog('[TrelloSync] ERROR: AI dedup failed, creating all as new:', err.message)
      }
    }
    const tasksToAdd = []
    const tasksToUpdate = []

    for (const { card, status } of newCards) {
      const matchedTaskId = matchMap.get(card.id)
      if (matchedTaskId) {
        // Auto-link existing task
        tasksToUpdate.push({
          id: matchedTaskId,
          updates: {
            trello_card_id: card.id,
            trello_card_url: card.url || null,
            status,
          }
        })
        remoteLog(`[TrelloSync] auto-linked card "${card.name}" to task ${matchedTaskId.slice(0, 8)}`)
      } else {
        // Create new task
        const dueDate = card.due ? card.due.slice(0, 10) : null // Trello sends ISO timestamp, we need YYYY-MM-DD
        const task = createTask(card.name, [], dueDate, card.desc || '')
        task.trello_card_id = card.id
        task.trello_card_url = card.url || null
        task.status = status
        tasksToAdd.push(task)
        remoteLog(`[TrelloSync] created task for card "${card.name}" (${status})`)
      }
    }

    // Apply changes
    if (tasksToAdd.length > 0 || tasksToUpdate.length > 0) {
      setTasks(prev => {
        remoteLog(`[TrelloSync] setTasks updater: prev has ${prev.length} tasks, ${prev.filter(t => t.trello_card_id).length} linked`)
        let next = [...prev]
        // Apply updates (auto-links)
        for (const { id, updates } of tasksToUpdate) {
          next = next.map(t => t.id === id ? { ...t, ...updates, last_touched: new Date().toISOString() } : t)
        }
        // Add new tasks
        const result = [...tasksToAdd, ...next]
        remoteLog(`[TrelloSync] setTasks result: ${result.length} tasks, ${result.filter(t => t.trello_card_id).length} linked`)
        return result
      })
      remoteLog(`[TrelloSync] imported ${tasksToAdd.length} new, linked ${tasksToUpdate.length} existing`)
    }
  }, [setTasks, changeStatus, ensureMapping])

  // Push: move Trello card when Boomerang status changes
  const pushStatusToTrello = useCallback(async (task, newStatus) => {
    if (!task.trello_card_id) return
    if (newStatus === 'backlog') return // backlog is Boomerang-only
    const mapping = loadSettings().trello_list_mapping
    if (!mapping) return
    const targetListId = mapping[newStatus]
    if (!targetListId) return

    try {
      await trelloUpdateCard(task.trello_card_id, { idList: targetListId })
      remoteLog(`[TrelloSync] moved card "${task.title}" to ${newStatus} list`)
    } catch (err) {
      remoteLog(`[TrelloSync] ERROR: failed to move card:`, err.message)
    }
  }, [])

  // Full sync orchestration
  const syncTrello = useCallback(async () => {
    if (syncingRef.current || !isTrelloConfigured()) return
    syncingRef.current = true
    setSyncing(true)
    setSyncError(null)

    try {
      await pullFromTrello()
      const now = new Date().toISOString()
      setLastSync(now)
      const s = loadSettings()
      saveSettings({ ...s, trello_last_sync: now })
    } catch (err) {
      remoteLog('[TrelloSync] ERROR: sync failed:', err.message)
      setSyncError(err.message)
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [pullFromTrello, isTrelloConfigured])

  // Sync on mount
  useEffect(() => {
    if (isTrelloConfigured()) syncTrello()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync on visibility change
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isTrelloConfigured()) {
        syncTrello()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [syncTrello, isTrelloConfigured])

  return { syncTrello, pushStatusToTrello, syncing, lastSync, syncError }
}
