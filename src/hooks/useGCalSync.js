import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings, createTask } from '../store'
import { gcalListEvents, aiDedupGCalEvents } from '../api'
import { deduplicateImports, remoteLog } from '../syncDedup'

export function useGCalSync(tasks, setTasks) {
  const syncingRef = useRef(false)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(() => loadSettings().gcal_last_sync || null)
  const [syncError, setSyncError] = useState(null)

  const isGCalSyncConfigured = useCallback(() => {
    const s = loadSettings()
    return !!s.gcal_pull_enabled
  }, [])

  const pullFromGCal = useCallback(async () => {
    const s = loadSettings()
    const calendarId = s.gcal_calendar_id || 'primary'

    // Fetch events for the next 30 days
    const now = new Date()
    const timeMin = now.toISOString()
    const future = new Date(now)
    future.setDate(future.getDate() + 30)
    const timeMax = future.toISOString()

    remoteLog('[GCalSync] starting pull from calendar:', calendarId)

    const events = await gcalListEvents(timeMin, timeMax, calendarId)
    remoteLog(`[GCalSync] found ${events.length} events`)

    const currentTasks = tasksRef.current
    const linkedEventIds = new Set(currentTasks.filter(t => t.gcal_event_id).map(t => t.gcal_event_id))

    // Filter out already-linked events and events pushed by Boomerang
    const titleFilter = (s.gcal_pull_filter || '').trim().toLowerCase()
    remoteLog(`[GCalSync] title filter: "${titleFilter || '(none)'}"`)
    let filteredByBoomerang = 0, filteredByTitle = 0
    const unlinkedEvents = events.filter(e => {
      if (linkedEventIds.has(e.id)) return false
      if (e.description && e.description.includes('Managed by Boomerang')) { filteredByBoomerang++; return false }
      if (titleFilter && !(e.summary || '').toLowerCase().includes(titleFilter)) { filteredByTitle++; return false }
      return true
    })
    remoteLog(`[GCalSync] ${linkedEventIds.size} already linked, ${filteredByBoomerang} Boomerang-managed, ${filteredByTitle} filtered by title, ${unlinkedEvents.length} to import`)

    if (unlinkedEvents.length === 0) {
      remoteLog('[GCalSync] no new events to import')
      return
    }

    // Dedup: exact title match, then AI
    const unlinkedTasks = currentTasks.filter(t => !t.gcal_event_id && t.status !== 'done')
    const matchMap = await deduplicateImports({
      items: unlinkedEvents,
      localTasks: unlinkedTasks,
      getTitle: e => e.summary,
      getId: e => e.id,
      aiDedupFn: aiDedupGCalEvents,
      itemIdField: 'event_id',
      logPrefix: '[GCalSync]',
    })

    // Link matched events to existing tasks
    const linkUpdates = []
    for (const [eventId, taskId] of matchMap) {
      linkUpdates.push({ taskId, eventId })
    }

    if (linkUpdates.length > 0) {
      setTasks(prev => prev.map(t => {
        const link = linkUpdates.find(l => l.taskId === t.id)
        if (!link) return t
        return { ...t, gcal_event_id: link.eventId }
      }))
      remoteLog(`[GCalSync] linked ${linkUpdates.length} existing tasks to GCal events`)
    }

    // Create new tasks for unmatched events
    const newEvents = unlinkedEvents.filter(e => !matchMap.has(e.id))
    remoteLog(`[GCalSync] ${newEvents.length} new events to import`)

    const newTasks = []
    for (const event of newEvents) {
      // Extract date from event start
      const dueDate = event.start?.date || (event.start?.dateTime ? event.start.dateTime.split('T')[0] : null)

      const task = createTask(
        event.summary || 'Untitled event',
        [],
        dueDate,
        event.description || ''
      )
      task.gcal_event_id = event.id
      newTasks.push(task)
    }

    if (newTasks.length > 0) {
      setTasks(prev => [...newTasks, ...prev])
      remoteLog(`[GCalSync] created ${newTasks.length} new tasks from calendar events`)
    }
  }, [setTasks])

  const syncGCal = useCallback(async () => {
    if (syncingRef.current) return
    if (!isGCalSyncConfigured()) return

    syncingRef.current = true
    setSyncing(true)
    setSyncError(null)

    try {
      await pullFromGCal()
      const now = new Date().toISOString()
      setLastSync(now)
      const s = loadSettings()
      saveSettings({ ...s, gcal_last_sync: now })
      remoteLog('[GCalSync] sync complete')
    } catch (err) {
      remoteLog('[GCalSync] sync error:', err.message)
      setSyncError(err.message)
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [isGCalSyncConfigured, pullFromGCal])

  // Sync on mount and when returning to the app
  useEffect(() => {
    if (!isGCalSyncConfigured()) return

    syncGCal()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncGCal()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [isGCalSyncConfigured, syncGCal])

  return { syncing, lastSync, syncError, syncGCal, isGCalSyncConfigured }
}
