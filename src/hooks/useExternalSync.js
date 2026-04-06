import { useEffect, useRef, useCallback } from 'react'
import { loadSettings } from '../store'
import {
  trelloUpdateCard,
  trelloCreateChecklist,
  trelloAddCheckItem,
  trelloUpdateCheckItem,
  trelloDeleteChecklist,
  trelloGetChecklists,
  notionUpdatePage,
  gcalCreateEvent,
  gcalUpdateEvent,
  gcalDeleteEvent,
  inferEventTime,
} from '../api'

const DEBOUNCE_MS = 5000
const QUEUE_KEY = 'boom_external_sync_queue'

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') }
  catch { return [] }
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

function enqueue(ops) {
  const queue = loadQueue()
  queue.push(...ops)
  if (queue.length > 200) queue.splice(0, queue.length - 200)
  saveQueue(queue)
}

function log(...args) {
  console.log('[ExternalSync]', ...args)
}

function buildEventDescription(task) {
  const parts = []
  if (task.notes) parts.push(task.notes)
  if (task.size) parts.push(`Size: ${task.size}`)
  if (task.energy) parts.push(`Energy: ${task.energy}`)
  if (task.tags?.length) parts.push(`Tags: ${task.tags.join(', ')}`)
  parts.push('\n---\nManaged by Boomerang')
  return parts.join('\n')
}

// Extract only user-facing fields for diffing (ignore trello_*_id fields)
function userFacingSnapshot(task) {
  return {
    title: task.title,
    status: task.status,
    notes: task.notes,
    due_date: task.due_date,
    gcal_duration: task.gcal_duration,
    checklists: (task.checklists || []).map(cl => ({
      name: cl.name,
      items: (cl.items || []).map(item => ({
        text: item.text,
        completed: item.completed,
      })),
    })),
  }
}

export function useExternalSync(tasks, onUpdateTask) {
  const prevTasks = useRef(null)
  const debounceTimers = useRef({}) // per-task timers
  const hydratedIds = useRef(new Set()) // track tasks we've already hydrated
  const onUpdateTaskRef = useRef(onUpdateTask)
  onUpdateTaskRef.current = onUpdateTask

  // Initialize prevTasks on first render
  useEffect(() => {
    if (prevTasks.current === null && Array.isArray(tasks)) {
      prevTasks.current = new Map(tasks.map(t => [t.id, t]))
    }
  }, [tasks])

  // Hydrate Trello IDs for pre-existing linked tasks that lack them
  const hydrateChecklistIds = useCallback(async (task) => {
    const cardId = task.trello_card_id
    if (!cardId || hydratedIds.current.has(task.id)) return task

    const checklists = task.checklists || []
    const needsHydration = checklists.length > 0 && checklists.every(cl => !cl.trello_checklist_id)
    if (!needsHydration) {
      hydratedIds.current.add(task.id)
      return task
    }

    try {
      const trelloChecklists = await trelloGetChecklists(cardId)
      const updatedChecklists = [...checklists]

      for (let ci = 0; ci < updatedChecklists.length; ci++) {
        const cl = updatedChecklists[ci]
        // Match by name (case-insensitive)
        const match = trelloChecklists.find(tc =>
          tc.name.toLowerCase() === (cl.name || 'Checklist').toLowerCase()
        )
        if (!match) continue

        const updatedItems = [...(cl.items || [])]
        for (let ii = 0; ii < updatedItems.length; ii++) {
          const item = updatedItems[ii]
          // Match by text (case-insensitive)
          const itemMatch = match.checkItems?.find(ci =>
            ci.name.toLowerCase() === item.text.toLowerCase()
          )
          if (itemMatch) {
            updatedItems[ii] = { ...item, trello_check_item_id: itemMatch.id }
          }
        }
        updatedChecklists[ci] = { ...cl, trello_checklist_id: match.id, items: updatedItems }
      }

      onUpdateTaskRef.current(task.id, { checklists: updatedChecklists })
      log(`hydrated Trello IDs for "${task.title}"`)
      hydratedIds.current.add(task.id)
      return { ...task, checklists: updatedChecklists }
    } catch (err) {
      log(`ERROR hydrating Trello IDs:`, err.message)
      hydratedIds.current.add(task.id) // don't retry endlessly
      return task
    }
  }, [])

  const syncTaskToTrello = useCallback(async (task, prevTask) => {
    const cardId = task.trello_card_id
    if (!cardId) return

    // Hydrate IDs if needed before syncing
    task = await hydrateChecklistIds(task)

    // Sync basic fields
    const fieldUpdates = {}
    if (task.title !== prevTask.title) fieldUpdates.name = task.title
    if (task.notes !== prevTask.notes) fieldUpdates.desc = task.notes || ''
    if (task.due_date !== prevTask.due_date) {
      fieldUpdates.due = task.due_date ? `${task.due_date}T00:00:00.000Z` : null
    }

    if (Object.keys(fieldUpdates).length > 0) {
      try {
        await trelloUpdateCard(cardId, fieldUpdates)
        log(`updated card fields for "${task.title}":`, Object.keys(fieldUpdates))
      } catch (err) {
        log(`ERROR updating card fields:`, err.message)
        enqueue([{ type: 'updateCard', cardId, updates: fieldUpdates }])
      }
    }

    // Sync checklists
    const prevChecklists = prevTask.checklists || []
    const currChecklists = task.checklists || []

    const prevClMap = new Map()
    for (const cl of prevChecklists) {
      if (cl.trello_checklist_id) prevClMap.set(cl.trello_checklist_id, cl)
    }

    const idsToWriteBack = [] // { checklistIndex, trelloChecklistId, items: [{ itemIndex, trelloCheckItemId }] }

    for (let ci = 0; ci < currChecklists.length; ci++) {
      const cl = currChecklists[ci]

      if (!cl.trello_checklist_id) {
        // New checklist — create on Trello
        if (!cl.items || cl.items.length === 0) continue
        try {
          const trelloCl = await trelloCreateChecklist(cardId, cl.name || 'Checklist')
          const itemIds = []
          for (let ii = 0; ii < cl.items.length; ii++) {
            const item = cl.items[ii]
            const trelloItem = await trelloAddCheckItem(trelloCl.id, item.text, item.completed)
            itemIds.push({ itemIndex: ii, trelloCheckItemId: trelloItem.id })
          }
          idsToWriteBack.push({ checklistIndex: ci, trelloChecklistId: trelloCl.id, items: itemIds })
          log(`created checklist "${cl.name}" with ${cl.items.length} items`)
        } catch (err) {
          log(`ERROR creating checklist:`, err.message)
          enqueue([{ type: 'createChecklist', cardId, checklist: cl, checklistIndex: ci }])
        }
      } else {
        // Existing checklist — diff items
        const prevCl = prevClMap.get(cl.trello_checklist_id)
        prevClMap.delete(cl.trello_checklist_id) // mark as seen

        if (!prevCl) continue

        const prevItemMap = new Map()
        for (const item of (prevCl.items || [])) {
          if (item.trello_check_item_id) prevItemMap.set(item.trello_check_item_id, item)
        }

        const newItemIds = []
        for (let ii = 0; ii < (cl.items || []).length; ii++) {
          const item = cl.items[ii]

          if (item.trello_check_item_id) {
            // Existing item — check for changes
            const prevItem = prevItemMap.get(item.trello_check_item_id)
            if (prevItem && (prevItem.text !== item.text || prevItem.completed !== item.completed)) {
              try {
                await trelloUpdateCheckItem(cardId, item.trello_check_item_id, {
                  name: item.text,
                  state: item.completed ? 'complete' : 'incomplete',
                })
                log(`updated check item "${item.text}"`)
              } catch (err) {
                log(`ERROR updating check item:`, err.message)
                enqueue([{ type: 'updateCheckItem', cardId, checkItemId: item.trello_check_item_id, name: item.text, state: item.completed ? 'complete' : 'incomplete' }])
              }
            }
          } else {
            // New item on existing checklist
            try {
              const trelloItem = await trelloAddCheckItem(cl.trello_checklist_id, item.text, item.completed)
              newItemIds.push({ itemIndex: ii, trelloCheckItemId: trelloItem.id })
              log(`added check item "${item.text}" to checklist "${cl.name}"`)
            } catch (err) {
              log(`ERROR adding check item:`, err.message)
              enqueue([{ type: 'addCheckItem', checklistId: cl.trello_checklist_id, name: item.text, checked: item.completed }])
            }
          }
        }

        if (newItemIds.length > 0) {
          idsToWriteBack.push({ checklistIndex: ci, trelloChecklistId: cl.trello_checklist_id, items: newItemIds })
        }
      }
    }

    // Delete checklists that were removed
    for (const [trelloClId] of prevClMap) {
      try {
        await trelloDeleteChecklist(trelloClId)
        log(`deleted checklist ${trelloClId}`)
      } catch (err) {
        log(`ERROR deleting checklist:`, err.message)
        enqueue([{ type: 'deleteChecklist', checklistId: trelloClId }])
      }
    }

    // Write back Trello IDs without triggering re-sync
    if (idsToWriteBack.length > 0) {
      const updatedChecklists = [...currChecklists]
      for (const wb of idsToWriteBack) {
        const cl = { ...updatedChecklists[wb.checklistIndex] }
        cl.trello_checklist_id = wb.trelloChecklistId
        const items = [...(cl.items || [])]
        for (const itemWb of wb.items) {
          items[itemWb.itemIndex] = { ...items[itemWb.itemIndex], trello_check_item_id: itemWb.trelloCheckItemId }
        }
        cl.items = items
        updatedChecklists[wb.checklistIndex] = cl
      }
      onUpdateTaskRef.current(task.id, { checklists: updatedChecklists })
      log(`wrote back Trello IDs for "${task.title}"`)
    }
  }, [hydrateChecklistIds])

  const syncTaskToNotion = useCallback(async (task, prevTask) => {
    const pageId = task.notion_page_id
    if (!pageId) return

    const updates = {}

    // Sync title
    if (task.title !== prevTask.title) {
      updates.title = task.title
    }

    // Sync notes + checklists as content
    const notesChanged = task.notes !== prevTask.notes
    const checklistsChanged = JSON.stringify((task.checklists || []).map(cl => ({
      name: cl.name, items: (cl.items || []).map(i => ({ text: i.text, completed: i.completed })),
    }))) !== JSON.stringify((prevTask.checklists || []).map(cl => ({
      name: cl.name, items: (cl.items || []).map(i => ({ text: i.text, completed: i.completed })),
    })))

    if (notesChanged || checklistsChanged) {
      let content = (task.notes || '').trim()
      const cls = task.checklists || []
      if (cls.length > 0) {
        const clText = cls.map(cl => {
          const header = `## ${cl.name || 'Checklist'}`
          const items = (cl.items || []).map(i => `- [${i.completed ? 'x' : ' '}] ${i.text}`).join('\n')
          return `${header}\n${items}`
        }).join('\n\n')
        content = content ? `${content}\n\n${clText}` : clText
      }
      updates.content = content
    }

    if (Object.keys(updates).length === 0) return

    try {
      await notionUpdatePage(pageId, updates)
      log(`updated Notion page for "${task.title}":`, Object.keys(updates))
    } catch (err) {
      log(`ERROR updating Notion page:`, err.message)
      enqueue([{ type: 'updateNotionPage', pageId, updates }])
    }
  }, [])

  // Build timed event start/end with optional buffer
  const buildTimedEvent = useCallback(async (task, settings) => {
    const buffer = settings.gcal_event_buffer ? 15 : 0
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

    // Resolve duration: per-task override → AI inference → size fallback → global default
    let time, duration
    if (task.gcal_duration) {
      // User set a specific duration — still need a time from AI
      duration = task.gcal_duration
      try {
        const inferred = await inferEventTime(task.title, task.notes, task.size, task.energy)
        time = inferred.time
      } catch {
        time = settings.gcal_default_time || '09:00'
      }
    } else {
      try {
        const inferred = await inferEventTime(task.title, task.notes, task.size, task.energy)
        time = inferred.time
        duration = inferred.duration
      } catch {
        time = settings.gcal_default_time || '09:00'
        duration = settings.gcal_event_duration || 60
      }
    }

    // Apply buffer: shift start earlier and end later
    const startDate = new Date(`${task.due_date}T${time}:00`)
    if (buffer) startDate.setMinutes(startDate.getMinutes() - buffer)
    const endDate = new Date(`${task.due_date}T${time}:00`)
    endDate.setMinutes(endDate.getMinutes() + duration + buffer)

    return {
      start: { dateTime: startDate.toISOString(), timeZone: tz },
      end: { dateTime: endDate.toISOString(), timeZone: tz },
    }
  }, [])

  const syncTaskToGCal = useCallback(async (task, prevTask) => {
    const settings = loadSettings()
    const calendarId = settings.gcal_calendar_id || 'primary'
    const syncStatuses = settings.gcal_sync_statuses || ['not_started', 'doing', 'waiting', 'open']

    if (task.gcal_event_id) {
      // Task already linked to a calendar event
      const shouldRemove = (
        (task.status === 'done' && settings.gcal_remove_on_complete) ||
        !task.due_date
      )

      if (shouldRemove) {
        try {
          await gcalDeleteEvent(task.gcal_event_id, calendarId)
          onUpdateTaskRef.current(task.id, { gcal_event_id: null })
          log(`deleted GCal event for "${task.title}"`)
        } catch (err) {
          log(`ERROR deleting GCal event:`, err.message)
          enqueue([{ type: 'gcalDelete', eventId: task.gcal_event_id, calendarId }])
        }
        return
      }

      // Update if relevant fields changed
      const titleChanged = task.title !== prevTask.title
      const dateChanged = task.due_date !== prevTask.due_date
      const notesChanged = task.notes !== prevTask.notes
      const durationChanged = task.gcal_duration !== prevTask.gcal_duration
      if (titleChanged || dateChanged || notesChanged || durationChanged) {
        const event = { summary: task.title }
        if (notesChanged || titleChanged) {
          event.description = buildEventDescription(task)
        }
        if ((dateChanged || durationChanged) && task.due_date) {
          if (settings.gcal_use_timed_events) {
            try {
              const timing = await buildTimedEvent(task, settings)
              Object.assign(event, timing)
            } catch {
              event.start = { date: task.due_date }
              event.end = { date: task.due_date }
            }
          } else {
            event.start = { date: task.due_date }
            event.end = { date: task.due_date }
          }
        }
        try {
          await gcalUpdateEvent(task.gcal_event_id, calendarId, event)
          log(`updated GCal event for "${task.title}"`)
        } catch (err) {
          log(`ERROR updating GCal event:`, err.message)
          enqueue([{ type: 'gcalUpdate', eventId: task.gcal_event_id, calendarId, event }])
        }
      }
    } else if (task.due_date && syncStatuses.includes(task.status)) {
      // Create new calendar event
      let event
      if (settings.gcal_use_timed_events) {
        try {
          const timing = await buildTimedEvent(task, settings)
          event = {
            summary: task.title,
            description: buildEventDescription(task),
            ...timing,
          }
        } catch {
          event = {
            summary: task.title,
            description: buildEventDescription(task),
            start: { date: task.due_date },
            end: { date: task.due_date },
          }
        }
      } else {
        event = {
          summary: task.title,
          description: buildEventDescription(task),
          start: { date: task.due_date },
          end: { date: task.due_date },
        }
      }

      try {
        const result = await gcalCreateEvent(calendarId, event)
        onUpdateTaskRef.current(task.id, { gcal_event_id: result.eventId })
        log(`created GCal event for "${task.title}"`)
      } catch (err) {
        log(`ERROR creating GCal event:`, err.message)
        enqueue([{ type: 'gcalCreate', calendarId, event, taskId: task.id }])
      }
    }
  }, [buildTimedEvent])

  // Watch for task changes and sync to Trello/Notion/GCal
  useEffect(() => {
    if (!prevTasks.current || !Array.isArray(tasks)) return

    const settings = loadSettings()
    const hasTrello = !!settings.trello_board_id
    const hasNotion = !!settings.notion_sync_parent_id
    const hasGCal = !!settings.gcal_sync_enabled

    if (!hasTrello && !hasNotion && !hasGCal) return

    const currMap = new Map(tasks.map(t => [t.id, t]))

    for (const [id, task] of currMap) {
      const hasTrelloLink = task.trello_card_id && task.trello_sync_enabled !== false
      const hasNotionLink = !!task.notion_page_id
      const hasGCalLink = !!task.gcal_event_id
      // GCal sync applies to tasks with due_date or already linked events
      const gcalApplies = hasGCal && (hasGCalLink || task.due_date)

      if (!hasTrelloLink && !hasNotionLink && !gcalApplies) continue

      const prev = prevTasks.current.get(id)
      if (!prev) {
        // New task — trigger GCal create if it has a due date
        if (gcalApplies && !hasGCalLink && task.due_date) {
          if (debounceTimers.current[id]) clearTimeout(debounceTimers.current[id])
          debounceTimers.current[id] = setTimeout(() => {
            delete debounceTimers.current[id]
            syncTaskToGCal(task, { ...task, due_date: null })
          }, DEBOUNCE_MS)
        }
        continue
      }

      // Compare only user-facing fields
      const prevSnap = JSON.stringify(userFacingSnapshot(prev))
      const currSnap = JSON.stringify(userFacingSnapshot(task))
      if (prevSnap === currSnap) continue

      log(`change detected for "${task.title}", scheduling sync in ${DEBOUNCE_MS}ms`)

      // Debounce per-task
      if (debounceTimers.current[id]) clearTimeout(debounceTimers.current[id])
      debounceTimers.current[id] = setTimeout(() => {
        delete debounceTimers.current[id]
        if (hasTrello && hasTrelloLink) syncTaskToTrello(task, prev)
        if (hasNotion && hasNotionLink) syncTaskToNotion(task, prev)
        if (gcalApplies) syncTaskToGCal(task, prev)
      }, DEBOUNCE_MS)
    }

    // Update prev snapshot
    prevTasks.current = currMap
  }, [tasks, syncTaskToTrello, syncTaskToNotion, syncTaskToGCal])

  // Initial GCal push: sync existing tasks that have due_date but no gcal_event_id
  const initialGCalDone = useRef(false)
  useEffect(() => {
    if (initialGCalDone.current || !Array.isArray(tasks)) return
    const settings = loadSettings()
    if (!settings.gcal_sync_enabled) return

    const syncStatuses = settings.gcal_sync_statuses || ['not_started', 'doing', 'waiting', 'open']
    const today = new Date().toISOString().split('T')[0]
    const unsyncedTasks = tasks.filter(t =>
      t.due_date && !t.gcal_event_id && syncStatuses.includes(t.status) && t.due_date >= today
    )
    if (unsyncedTasks.length === 0) {
      initialGCalDone.current = true
      return
    }

    initialGCalDone.current = true
    log(`initial GCal push: ${unsyncedTasks.length} task(s) with due dates not yet synced`)

    // Stagger creation to avoid rate limits
    unsyncedTasks.forEach((task, i) => {
      setTimeout(() => {
        syncTaskToGCal(task, { ...task, due_date: null })
      }, i * 1000)
    })
  }, [tasks, syncTaskToGCal])

  // Replay queue on online event
  const replayQueue = useCallback(async () => {
    const queue = loadQueue()
    if (queue.length === 0) return

    log(`replaying ${queue.length} queued operation(s)`)
    const failed = []

    for (const op of queue) {
      try {
        switch (op.type) {
          case 'updateCard':
            await trelloUpdateCard(op.cardId, op.updates)
            break
          case 'createChecklist':
            await trelloCreateChecklist(op.cardId, op.checklist?.name || 'Checklist')
            break
          case 'updateCheckItem':
            await trelloUpdateCheckItem(op.cardId, op.checkItemId, { name: op.name, state: op.state })
            break
          case 'addCheckItem':
            await trelloAddCheckItem(op.checklistId, op.name, op.checked)
            break
          case 'deleteChecklist':
            await trelloDeleteChecklist(op.checklistId)
            break
          case 'updateNotionPage':
            await notionUpdatePage(op.pageId, op.updates)
            break
          case 'gcalCreate':
            await gcalCreateEvent(op.calendarId, op.event)
            break
          case 'gcalUpdate':
            await gcalUpdateEvent(op.eventId, op.calendarId, op.event)
            break
          case 'gcalDelete':
            await gcalDeleteEvent(op.eventId, op.calendarId)
            break
        }
      } catch (err) {
        log(`replay ERROR for ${op.type}:`, err.message)
        failed.push(op)
      }
    }

    saveQueue(failed)
    log(`replay complete: ${queue.length - failed.length} succeeded, ${failed.length} failed`)
  }, [])

  useEffect(() => {
    const handleOnline = () => replayQueue()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [replayQueue])

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = debounceTimers.current
    return () => {
      for (const timer of Object.values(timers)) {
        clearTimeout(timer)
      }
    }
  }, [])
}
