import { useCallback, useEffect, useRef } from 'react'
import { generateToastMessages } from '../api'

// Debounce per-task, regenerate toast messages when title/energy change
export function useToastPrefetch(tasks, updateTask) {
  const timers = useRef({})
  const snapshots = useRef({}) // track what we last generated for
  const backfilled = useRef(false)

  // One-time backfill for tasks missing toast_messages
  useEffect(() => {
    if (backfilled.current || !Array.isArray(tasks) || tasks.length === 0) return
    backfilled.current = true

    const needsBackfill = tasks.filter(t =>
      t.status !== 'done' && t.title && !t.toast_messages
    )
    if (needsBackfill.length === 0) return

    console.log(`[ToastPrefetch] backfilling ${needsBackfill.length} tasks`)

    // Stagger 1s apart to avoid hammering the API
    needsBackfill.forEach((task, i) => {
      setTimeout(() => {
        generateToastMessages(task.title, {
          energy: task.energy,
          energyLevel: task.energyLevel,
        }).then(messages => {
          updateTask(task.id, { toast_messages: messages })
        }).catch(() => {})
      }, i * 1000)
    })
  }, [tasks, updateTask])

  const prefetch = useCallback((taskId, title, energy, energyLevel) => {
    if (!title) return

    // Check if anything relevant changed
    const key = `${title}|${energy}|${energyLevel}`
    if (snapshots.current[taskId] === key) return
    snapshots.current[taskId] = key

    // Debounce 3s so rapid edits don't spam API
    if (timers.current[taskId]) clearTimeout(timers.current[taskId])
    timers.current[taskId] = setTimeout(() => {
      delete timers.current[taskId]
      generateToastMessages(title, { energy, energyLevel })
        .then(messages => {
          updateTask(taskId, { toast_messages: messages })
        })
        .catch(() => {}) // static fallback if AI fails
    }, 3000)
  }, [updateTask])

  return prefetch
}
