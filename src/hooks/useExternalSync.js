import { useEffect, useRef, useCallback } from 'react'
import { loadSettings } from '../store'
import {
  trelloUpdateCard,
  trelloCreateChecklist,
  trelloAddCheckItem,
  trelloUpdateCheckItem,
  trelloDeleteChecklist,
  trelloGetChecklists,
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

// Extract only user-facing fields for diffing (ignore trello_*_id fields)
function userFacingSnapshot(task) {
  return {
    title: task.title,
    notes: task.notes,
    due_date: task.due_date,
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

  // Watch for task changes and sync to Trello
  useEffect(() => {
    if (!prevTasks.current || !Array.isArray(tasks)) return

    const settings = loadSettings()
    // Need at least a board configured (keys can come from env vars)
    if (!settings.trello_board_id) return

    const currMap = new Map(tasks.map(t => [t.id, t]))

    for (const [id, task] of currMap) {
      // Only sync tasks linked to Trello with sync enabled
      if (!task.trello_card_id) continue
      if (task.trello_sync_enabled === false) continue

      const prev = prevTasks.current.get(id)
      if (!prev) continue // new task, skip (will be handled by create flow)

      // Compare only user-facing fields
      const prevSnap = JSON.stringify(userFacingSnapshot(prev))
      const currSnap = JSON.stringify(userFacingSnapshot(task))
      if (prevSnap === currSnap) continue

      log(`change detected for "${task.title}", scheduling sync in ${DEBOUNCE_MS}ms`)

      // Debounce per-task
      if (debounceTimers.current[id]) clearTimeout(debounceTimers.current[id])
      debounceTimers.current[id] = setTimeout(() => {
        delete debounceTimers.current[id]
        syncTaskToTrello(task, prev)
      }, DEBOUNCE_MS)
    }

    // Update prev snapshot
    prevTasks.current = currMap
  }, [tasks, syncTaskToTrello])

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
