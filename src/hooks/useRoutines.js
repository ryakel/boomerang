import { useState, useCallback, useEffect } from 'react'
import { loadRoutines, saveRoutines, createRoutine, isRoutineDue, getNextDueDate, createTask } from '../store'
import { suggestRoutineDueDate } from '../api'

export function useRoutines() {
  const [routines, setRoutines] = useState(loadRoutines)

  useEffect(() => {
    saveRoutines(routines)
  }, [routines])

  const addRoutine = useCallback((title, cadence, customDays, tags, notes, highPriority = false, endDate = null) => {
    const routine = createRoutine(title, cadence, customDays, tags, notes)
    if (highPriority) routine.high_priority = true
    if (endDate) routine.end_date = endDate
    setRoutines(prev => [routine, ...prev])
    return routine
  }, [])

  const deleteRoutine = useCallback((id) => {
    setRoutines(prev => prev.filter(r => r.id !== id))
  }, [])

  const togglePause = useCallback((id) => {
    setRoutines(prev => prev.map(r =>
      r.id === id ? { ...r, paused: !r.paused } : r
    ))
  }, [])

  const completeRoutine = useCallback((id) => {
    setRoutines(prev => prev.map(r =>
      r.id === id ? {
        ...r,
        completed_history: [...r.completed_history, new Date().toISOString()],
      } : r
    ))
  }, [])

  const updateRoutine = useCallback((id, updates) => {
    setRoutines(prev => prev.map(r =>
      r.id === id ? { ...r, ...updates } : r
    ))
  }, [])

  const updateRoutineNotion = useCallback((id, notionPageId, notionUrl) => {
    setRoutines(prev => prev.map(r =>
      r.id === id ? { ...r, notion_page_id: notionPageId, notion_url: notionUrl } : r
    ))
  }, [])

  // Spawn tasks for due routines — returns IDs of spawned tasks
  const spawnDueTasks = useCallback((existingTasks) => {
    const spawned = []
    routines.forEach(routine => {
      if (!isRoutineDue(routine)) return
      // Don't spawn if there's already an open task for this routine
      const hasOpen = existingTasks.some(t => t.routine_id === routine.id && t.status === 'open')
      if (hasOpen) return

      const nextDue = getNextDueDate(routine)
      const task = createTask(routine.title, routine.tags, nextDue.toISOString().split('T')[0], routine.notes)
      task.routine_id = routine.id
      task.notion_page_id = routine.notion_page_id
      task.notion_url = routine.notion_url
      if (routine.high_priority) task.high_priority = true
      spawned.push(task)
    })
    return spawned
  }, [routines])

  const hydrateRoutines = useCallback((data) => {
    if (Array.isArray(data)) {
      setRoutines(data)
    }
  }, [])

  return {
    routines,
    addRoutine,
    deleteRoutine,
    togglePause,
    completeRoutine,
    updateRoutine,
    updateRoutineNotion,
    spawnDueTasks,
    hydrateRoutines,
  }
}

export async function enhanceSpawnedTasks(spawnedTasks, routines) {
  for (const task of spawnedTasks) {
    if (!task.routine_id) continue
    const routine = routines.find(r => r.id === task.routine_id)
    if (!routine || !routine.notes) continue

    try {
      const lastCompleted = routine.completed_history.length > 0
        ? routine.completed_history[routine.completed_history.length - 1]
        : null
      const result = await suggestRoutineDueDate(routine.title, routine.notes, routine.cadence, lastCompleted)
      if (result?.date) task.due_date = result.date
    } catch { /* use default date */ }
  }
  return spawnedTasks
}
