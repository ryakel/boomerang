import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings, createTask } from '../store'
import { trelloSyncAllLists, trelloUpdateCard, trelloBoardLists, inferTrelloListMapping, aiDedupTrelloCards } from '../api'
import { deduplicateImports, remoteLog } from '../syncDedup'

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
          // Never revert 'done' or 'backlog' — these are terminal/local-only states
          const existingTask = currentTasks.find(t => t.trello_card_id === card.id)
          if (existingTask && existingTask.status !== status && existingTask.status !== 'backlog' && existingTask.status !== 'done') {
            statusUpdates.push({ taskId: existingTask.id, newStatus: status })
          }
        } else {
          newCards.push({ card, status })
          remoteLog(`[TrelloSync] unlinked card: "${card.name}" (id=${card.id.slice(0, 8)})`)
        }
      }
    }

    // Reconcile: push done/status changes from Boomerang → Trello for linked tasks
    // that are out of sync (e.g. completed before the push fix was deployed)
    const listMapping = loadSettings().trello_list_mapping
    const cardListLookup = {} // cardId → current listId on Trello
    for (const [listId, cards] of Object.entries(cardsByList)) {
      for (const card of cards) {
        if (!card.closed) cardListLookup[card.id] = listId
      }
    }
    const reconcilePromises = []
    for (const task of currentTasks) {
      if (!task.trello_card_id || task.status === 'backlog') continue
      const currentListId = cardListLookup[task.trello_card_id]
      if (!currentListId) continue // card not found in any fetched list
      const expectedStatus = STATUS_FOR_LIST[currentListId]
      if (expectedStatus === task.status) continue // already in sync

      if (task.status === 'done') {
        const doneListId = listMapping?.done
        if (doneListId && currentListId !== doneListId) {
          remoteLog(`[TrelloSync] reconcile: moving "${task.title}" to done list`)
          reconcilePromises.push(
            trelloUpdateCard(task.trello_card_id, { idList: doneListId }).catch(err =>
              remoteLog(`[TrelloSync] reconcile ERROR: ${err.message}`)
            )
          )
        } else if (!doneListId) {
          remoteLog(`[TrelloSync] reconcile: archiving "${task.title}" (no done list)`)
          reconcilePromises.push(
            trelloUpdateCard(task.trello_card_id, { closed: true }).catch(err =>
              remoteLog(`[TrelloSync] reconcile ERROR: ${err.message}`)
            )
          )
        }
      } else {
        // Non-done task whose Trello list doesn't match — push Boomerang status to Trello
        const targetListId = listMapping?.[task.status]
        if (targetListId && currentListId !== targetListId) {
          remoteLog(`[TrelloSync] reconcile: moving "${task.title}" to ${task.status} list`)
          reconcilePromises.push(
            trelloUpdateCard(task.trello_card_id, { idList: targetListId }).catch(err =>
              remoteLog(`[TrelloSync] reconcile ERROR: ${err.message}`)
            )
          )
        }
      }
    }
    if (reconcilePromises.length > 0) {
      await Promise.all(reconcilePromises)
      remoteLog(`[TrelloSync] reconciled ${reconcilePromises.length} card(s)`)
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

    // Dedup: exact title match, then AI (shared logic)
    const unlinkedTasks = currentTasks.filter(t => !t.trello_card_id && t.status !== 'done')
    remoteLog(`[TrelloSync] ${unlinkedTasks.length} unlinked local tasks for dedup`)
    const matchMap = await deduplicateImports({
      items: newCards.map(nc => nc.card),
      localTasks: unlinkedTasks,
      getTitle: card => card.name,
      getId: card => card.id,
      aiDedupFn: aiDedupTrelloCards,
      itemIdField: 'card_id',
      logPrefix: '[TrelloSync]',
    })
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
    if (!mapping) {
      remoteLog(`[TrelloSync] no list mapping configured — skipping push for "${task.title}"`)
      return
    }
    const targetListId = mapping[newStatus]
    if (!targetListId) {
      // For 'done' with no mapped list, archive the card so it doesn't re-import
      if (newStatus === 'done') {
        try {
          await trelloUpdateCard(task.trello_card_id, { closed: true })
          remoteLog(`[TrelloSync] archived card "${task.title}" (no done list mapped)`)
        } catch (err) {
          remoteLog(`[TrelloSync] ERROR: failed to archive card:`, err.message)
        }
      } else {
        remoteLog(`[TrelloSync] no list mapped for status "${newStatus}" — skipping push for "${task.title}"`)
      }
      return
    }

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
