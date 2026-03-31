import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings, createTask } from '../store'
import { trelloSyncAllLists, trelloUpdateCard, trelloBoardLists, inferTrelloListMapping, aiDedupTrelloCards } from '../api'

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
      console.log('[TrelloSync] AI inferred list mapping:', mapping)
      return mapping
    } catch (err) {
      console.error('[TrelloSync] failed to infer list mapping:', err.message)
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

    // Build set of all known trello card IDs
    const currentTasks = tasks
    const linkedCardIds = new Set(currentTasks.filter(t => t.trello_card_id).map(t => t.trello_card_id))

    const newCards = []
    const statusUpdates = []

    for (const [listId, cards] of Object.entries(cardsByList)) {
      const status = STATUS_FOR_LIST[listId]
      if (!status) continue

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
        }
      }
    }

    // Apply status updates from Trello
    for (const { taskId, newStatus } of statusUpdates) {
      changeStatus(taskId, newStatus)
    }

    if (newCards.length === 0) {
      console.log('[TrelloSync] no new cards to import')
      return
    }

    // AI dedup: match new cards against unlinked tasks
    const unlinkedTasks = currentTasks.filter(t => !t.trello_card_id && t.status !== 'done')
    let matches = []

    if (unlinkedTasks.length > 0) {
      try {
        const dedupResult = await aiDedupTrelloCards(
          newCards.map(nc => nc.card),
          unlinkedTasks
        )
        matches = dedupResult.matches || []
      } catch (err) {
        console.error('[TrelloSync] AI dedup failed, creating all as new:', err.message)
      }
    }

    const matchMap = new Map(matches.filter(m => m.task_id && m.confidence >= 0.85).map(m => [m.card_id, m.task_id]))
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
        console.log(`[TrelloSync] auto-linked card "${card.name}" to task ${matchedTaskId.slice(0, 8)}`)
      } else {
        // Create new task
        const dueDate = card.due ? card.due.slice(0, 10) : null // Trello sends ISO timestamp, we need YYYY-MM-DD
        const task = createTask(card.name, [], dueDate, card.desc || '')
        task.trello_card_id = card.id
        task.trello_card_url = card.url || null
        task.status = status
        tasksToAdd.push(task)
        console.log(`[TrelloSync] created task for card "${card.name}" (${status})`)
      }
    }

    // Apply changes
    if (tasksToAdd.length > 0 || tasksToUpdate.length > 0) {
      setTasks(prev => {
        let next = [...prev]
        // Apply updates (auto-links)
        for (const { id, updates } of tasksToUpdate) {
          next = next.map(t => t.id === id ? { ...t, ...updates, last_touched: new Date().toISOString() } : t)
        }
        // Add new tasks
        return [...tasksToAdd, ...next]
      })
      console.log(`[TrelloSync] imported ${tasksToAdd.length} new, linked ${tasksToUpdate.length} existing`)
    }
  }, [tasks, setTasks, changeStatus, ensureMapping])

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
      console.log(`[TrelloSync] moved card "${task.title}" to ${newStatus} list`)
    } catch (err) {
      console.error(`[TrelloSync] failed to move card:`, err.message)
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
      console.error('[TrelloSync] sync failed:', err.message)
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
