import { useState, useCallback, useEffect } from 'react'
import { loadTasks, saveTasks, createTask, isStale, isSnoozed, isActiveTask, logActivity } from '../store'

// Activity-log noise filter. updateTask is called from many paths
// (user form saves, AI auto-sizing, sync writebacks, GCal id assignment,
// weather_hidden toggles, etc.). Only the keys below count as user-visible
// edits worth logging. Priority flips get their own action label.
const MEANINGFUL_EDIT_KEYS = new Set([
  'title', 'notes', 'tags', 'due_date',
  'size', 'energy', 'energy_level', 'energyLevel',
  'checklist_json', 'attachments',
])
const PRIORITY_KEYS = new Set(['high_priority', 'low_priority'])

function remoteLog(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  // Fire-and-forget log relay to server
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: [`[TASKS] ${line}`] }),
  }).catch(() => {})
}

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

  const addTask = useCallback(({ title, tags = [], dueDate = null, notes = '', notion = null, size = null, size_inferred = false, attachments = [], highPriority = false, lowPriority = false, energy = null, energyLevel = null } = {}) => {
    remoteLog('addTask:', title)
    const task = createTask(title, tags, dueDate, notes)
    if (notion) {
      task.notion_page_id = notion.id
      task.notion_url = notion.url
    }
    if (size) {
      task.size = size
      // Any explicitly-provided size means the caller settled it (user picked
      // or AI inferred). Mark as inferred so the background auto-sizer hook
      // won't override. Callers that want re-inference should omit size.
      task.size_inferred = true
    }
    if (size_inferred) task.size_inferred = true
    if (energy) task.energy = energy
    if (energyLevel) task.energyLevel = energyLevel
    if (attachments.length > 0) task.attachments = attachments
    if (highPriority) task.high_priority = true
    if (lowPriority) task.low_priority = true
    logActivity('created', task)
    setTasks(prev => [task, ...prev])
    return task.id
  }, [])

  const addSpawnedTasks = useCallback((spawnedTasks) => {
    if (spawnedTasks.length === 0) return
    remoteLog('addSpawnedTasks:', spawnedTasks.length, 'tasks')
    for (const t of spawnedTasks) logActivity('created', t)
    setTasks(prev => [...spawnedTasks, ...prev])
  }, [])

  const completeTask = useCallback((id) => {
    let completed = null
    setTasks(prev => {
      const task = prev.find(t => t.id === id)
      const next = prev.map(t => {
        if (t.id === id) {
          completed = { ...t, status: 'done', completed_at: new Date().toISOString() }
          return completed
        }
        return t
      })
      if (task) logActivity('completed', task)
      remoteLog('completeTask:', task?.title, `id=${id.slice(0, 8)}`, `→ ${next.filter(t => t.status === 'done').length}/${next.length} done`)
      return next
    })
    return completed
  }, [])

  const snoozeTask = useCallback((id, until) => {
    remoteLog('snoozeTask:', `id=${id.slice(0, 8)}`, 'until=', until.toISOString())
    setTasks(prev => {
      const task = prev.find(t => t.id === id)
      if (task) logActivity('snoozed', task)
      return prev.map(t =>
        t.id === id ? {
          ...t,
          snoozed_until: until.toISOString(),
          snooze_count: t.snooze_count + 1,
          last_touched: new Date().toISOString(),
        } : t
      )
    })
  }, [])

  const replaceTask = useCallback((id, newTitles, tags = []) => {
    remoteLog('replaceTask:', `id=${id.slice(0, 8)}`, '→', newTitles)
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === id)
      if (idx === -1) return prev
      const original = prev[idx]
      const newTasks = newTitles.map(title => createTask(title, tags.length ? tags : original.tags))
      return [...prev.slice(0, idx), ...newTasks, ...prev.slice(idx + 1)]
    })
  }, [])

  const updateTask = useCallback((id, updates) => {
    remoteLog('updateTask:', `id=${id.slice(0, 8)}`, 'keys=', Object.keys(updates).join(','), 'values=', Object.entries(updates).map(([k, v]) => {
      if (k === 'notes' || k === 'attachments') return `${k}=(${String(v).length} chars)`
      return `${k}=${v}`
    }).join(', '))
    setTasks(prev => {
      const task = prev.find(t => t.id === id)
      if (task) {
        const keys = Object.keys(updates)
        const hasPriorityChange = keys.some(k => PRIORITY_KEYS.has(k))
        const hasMeaningfulEdit = keys.some(k => MEANINGFUL_EDIT_KEYS.has(k))
        if (hasPriorityChange) logActivity('priority_changed', task)
        else if (hasMeaningfulEdit) logActivity('edited', task)
      }
      return prev.map(t =>
        t.id === id ? { ...t, ...updates, last_touched: new Date().toISOString() } : t
      )
    })
  }, [])

  const uncompleteTask = useCallback((id) => {
    remoteLog('uncompleteTask:', `id=${id.slice(0, 8)}`)
    setTasks(prev => {
      const task = prev.find(t => t.id === id)
      if (task) logActivity('reopened', task)
      return prev.map(t =>
        t.id === id ? { ...t, status: 'not_started', completed_at: null, last_touched: new Date().toISOString() } : t
      )
    })
  }, [])

  const clearCompleted = useCallback(() => {
    remoteLog('clearCompleted')
    setTasks(prev => prev.filter(t => t.status !== 'done'))
  }, [])

  const clearAll = useCallback(() => {
    remoteLog('clearAll')
    setTasks([])
  }, [])

  const deleteTask = useCallback((id) => {
    remoteLog('deleteTask:', `id=${id.slice(0, 8)}`)
    setTasks(prev => {
      const task = prev.find(t => t.id === id)
      if (task) logActivity('deleted', task)
      return prev.filter(t => t.id !== id)
    })
  }, [])

  const changeStatus = useCallback((id, newStatus) => {
    remoteLog('changeStatus:', `id=${id.slice(0, 8)}`, '→', newStatus)
    setTasks(prev => {
      const task = prev.find(t => t.id === id)
      if (task && task.status !== newStatus) {
        // 'done' transition gets the full completed label; other status flips
        // (project, backlog, waiting, doing) share status_changed.
        if (newStatus === 'done') logActivity('completed', task)
        else if (task.status === 'done') logActivity('reopened', task)
        else logActivity('status_changed', task)
      }
      return prev.map(t => {
        if (t.id !== id) return t
        const updates = { status: newStatus, last_touched: new Date().toISOString() }
        if (newStatus === 'done') updates.completed_at = new Date().toISOString()
        if (t.status === 'done' && newStatus !== 'done') updates.completed_at = null
        return { ...t, ...updates }
      })
    })
  }, [])

  const hydrateTasks = useCallback((data) => {
    if (Array.isArray(data)) {
      const done = data.filter(t => t.status === 'done').length
      const open = data.filter(t => t.status === 'open').length
      remoteLog('hydrateTasks:', data.length, `tasks (${open} open, ${done} done)`)
      setTasks(data)
    }
  }, [])

  const openTasks = tasks.filter(t => isActiveTask(t))
  const staleTasks = openTasks.filter(t => isStale(t))
  const snoozedTasks = openTasks.filter(t => isSnoozed(t))
  const waitingTasks = openTasks.filter(t => (t.status === 'waiting') && !isStale(t) && !isSnoozed(t))
  const doingTasks = openTasks.filter(t => t.status === 'doing' && !isStale(t) && !isSnoozed(t))
  const upNextTasks = openTasks.filter(t => t.status !== 'waiting' && t.status !== 'doing' && !isStale(t) && !isSnoozed(t))

  return {
    tasks,
    setTasks,
    openTasks,
    staleTasks,
    snoozedTasks,
    waitingTasks,
    doingTasks,
    upNextTasks,
    addTask,
    addSpawnedTasks,
    completeTask,
    snoozeTask,
    replaceTask,
    updateTask,
    uncompleteTask,
    changeStatus,
    clearCompleted,
    deleteTask,
    clearAll,
    hydrateTasks,
  }
}
