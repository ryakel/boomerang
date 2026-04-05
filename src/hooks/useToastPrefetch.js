import { useCallback, useRef } from 'react'
import { generateToastMessages } from '../api'

// Debounce per-task, regenerate toast messages when title/energy change
export function useToastPrefetch(updateTask) {
  const timers = useRef({})
  const snapshots = useRef({}) // track what we last generated for

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
