import { useState, useCallback, useEffect } from 'react'
import { loadTasks, saveTasks, createTask, isStale, isSnoozed } from '../store'

export function useTasks() {
  const [tasks, setTasks] = useState(loadTasks)

  useEffect(() => {
    saveTasks(tasks)
  }, [tasks])

  // Re-evaluate staleness/snooze every minute
  useEffect(() => {
    const interval = setInterval(() => setTasks(t => [...t]), 60000)
    return () => clearInterval(interval)
  }, [])

  const addTask = useCallback((title, tags = [], dueDate = null, notes = '', notion = null, size = null, attachments = []) => {
    const task = createTask(title, tags, dueDate, notes)
    if (notion) {
      task.notion_page_id = notion.id
      task.notion_url = notion.url
    }
    if (size) task.size = size
    if (attachments.length > 0) task.attachments = attachments
    setTasks(prev => [task, ...prev])
    return task.id
  }, [])

  const addSpawnedTasks = useCallback((spawnedTasks) => {
    if (spawnedTasks.length === 0) return
    setTasks(prev => [...spawnedTasks, ...prev])
  }, [])

  const completeTask = useCallback((id) => {
    let completed = null
    setTasks(prev => {
      const next = prev.map(t => {
        if (t.id === id) {
          completed = { ...t, status: 'done', completed_at: new Date().toISOString() }
          return completed
        }
        return t
      })
      console.log(`[TASKS] completeTask id=${id.slice(0, 8)} → done count: ${next.filter(t => t.status === 'done').length}/${next.length}`)
      return next
    })
    return completed
  }, [])

  const snoozeTask = useCallback((id, until) => {
    setTasks(prev => prev.map(t =>
      t.id === id ? {
        ...t,
        snoozed_until: until.toISOString(),
        snooze_count: t.snooze_count + 1,
        last_touched: new Date().toISOString(),
      } : t
    ))
  }, [])

  const replaceTask = useCallback((id, newTitles, tags = []) => {
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === id)
      if (idx === -1) return prev
      const original = prev[idx]
      const newTasks = newTitles.map(title => createTask(title, tags.length ? tags : original.tags))
      return [...prev.slice(0, idx), ...newTasks, ...prev.slice(idx + 1)]
    })
  }, [])

  const updateTask = useCallback((id, updates) => {
    console.log(`[TASKS] updateTask id=${id.slice(0, 8)} keys=[${Object.keys(updates)}]`)
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, ...updates, last_touched: new Date().toISOString() } : t
    ))
  }, [])

  const uncompleteTask = useCallback((id) => {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, status: 'open', completed_at: null, last_touched: new Date().toISOString() } : t
    ))
  }, [])

  const clearCompleted = useCallback(() => {
    setTasks(prev => prev.filter(t => t.status !== 'done'))
  }, [])

  const clearAll = useCallback(() => {
    setTasks([])
  }, [])

  const hydrateTasks = useCallback((data) => {
    if (Array.isArray(data)) {
      const doneCount = data.filter(t => t.status === 'done').length
      console.log(`[TASKS] hydrateTasks ← ${data.length} tasks (${doneCount} done)`)
      setTasks(data)
    }
  }, [])

  const openTasks = tasks.filter(t => t.status === 'open')
  const staleTasks = openTasks.filter(t => isStale(t))
  const snoozedTasks = openTasks.filter(t => isSnoozed(t))
  const upNextTasks = openTasks.filter(t => !isStale(t) && !isSnoozed(t))

  return {
    tasks,
    openTasks,
    staleTasks,
    snoozedTasks,
    upNextTasks,
    addTask,
    addSpawnedTasks,
    completeTask,
    snoozeTask,
    replaceTask,
    updateTask,
    uncompleteTask,
    clearCompleted,
    clearAll,
    hydrateTasks,
  }
}
