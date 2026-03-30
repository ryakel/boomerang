import { useCallback, useEffect, useRef } from 'react'
import { loadSettings, loadTasks, saveTasks, createTask } from '../store'
import { trelloSyncCards } from '../api'

/**
 * Bidirectional Trello sync hook.
 *
 * - On app load (if Trello is configured + board/list selected), pulls cards from the configured list
 * - For each Trello card, checks if a matching task exists (by trello_card_id)
 * - New cards from Trello -> create tasks locally
 * - Tasks pushed to Trello get trello_card_id and trello_card_url set
 * - Sync runs on visibility change (when user switches back to app) and on manual trigger
 *
 * NOTE: This hook is NOT wired into App.jsx yet — integrate after review.
 */
export function useTrelloSync(tasks, setTasks) {
  const syncing = useRef(false)

  const isTrelloConfigured = useCallback(() => {
    const settings = loadSettings()
    return !!(
      (settings.trello_api_key && settings.trello_token && settings.trello_list_id) ||
      (settings.trello_list_id) // env-based credentials
    )
  }, [])

  const syncTrello = useCallback(async () => {
    if (syncing.current) return
    const settings = loadSettings()
    if (!settings.trello_list_id) return

    syncing.current = true
    try {
      const cards = await trelloSyncCards(settings.trello_list_id)
      if (!Array.isArray(cards)) return

      const currentTasks = tasks || loadTasks()
      const existingCardIds = new Set(
        currentTasks.filter(t => t.trello_card_id).map(t => t.trello_card_id)
      )

      const newTasks = []
      for (const card of cards) {
        if (card.closed) continue
        if (existingCardIds.has(card.id)) continue

        // Create a new local task for this Trello card
        const task = createTask(card.name, [], card.due || null, card.desc || '')
        task.trello_card_id = card.id
        task.trello_card_url = card.url || null
        newTasks.push(task)
      }

      if (newTasks.length > 0) {
        const updated = [...currentTasks, ...newTasks]
        saveTasks(updated)
        if (setTasks) setTasks(updated)
        console.log(`[TrelloSync] imported ${newTasks.length} new card(s) from Trello`)
      } else {
        console.log('[TrelloSync] no new cards to import')
      }
    } catch (err) {
      console.error('[TrelloSync] sync failed:', err.message)
    } finally {
      syncing.current = false
    }
  }, [tasks, setTasks])

  // Sync on mount if configured
  useEffect(() => {
    if (isTrelloConfigured()) {
      syncTrello()
    }
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

  return syncTrello
}
