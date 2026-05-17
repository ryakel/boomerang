import { useState, useCallback, useEffect } from 'react'
import { loadTasks, saveTasks, createTask, isStale, isSnoozed, isActiveTask, logActivity } from '../store'
import { logProjectSession as apiLogProjectSession } from '../api'
import { computeProjectSessionPoints, PROJECT_SESSION_CAP } from '../scoring'

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

  const unsnoozeTask = useCallback((id) => {
    remoteLog('unsnoozeTask:', `id=${id.slice(0, 8)}`)
    setTasks(prev => prev.map(t =>
      t.id === id ? {
        ...t,
        snoozed_until: null,
        snooze_indefinite: false,
        last_touched: new Date().toISOString(),
      } : t
    ))
  }, [])

  // Sentinel: any snooze date past 2099-01-01 is treated as "until I come
  // back" — the task gets the snooze_indefinite flag so notifications skip
  // it AND it can be filtered/labeled separately from time-bound snoozes.
  const snoozeTask = useCallback((id, until, opts = {}) => {
    const indefinite = !!opts.indefinite || (until && until.getFullYear() >= 2099)
    remoteLog('snoozeTask:', `id=${id.slice(0, 8)}`, indefinite ? 'indefinite' : `until=${until.toISOString()}`)
    setTasks(prev => {
      const task = prev.find(t => t.id === id)
      if (task) logActivity('snoozed', task)
      return prev.map(t =>
        t.id === id ? {
          ...t,
          snoozed_until: until.toISOString(),
          snooze_indefinite: indefinite,
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

  // --- Projects (pinning, sessions, parent/child links) ---

  // Quick + optimistic pin toggle. The pinned-projects section on the main
  // list reacts immediately; server sync flushes via setTasks → saveTasks.
  const setProjectPinned = useCallback((id, pinned) => {
    remoteLog('setProjectPinned:', `id=${id.slice(0, 8)}`, pinned)
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, pinned_to_today: !!pinned, last_touched: new Date().toISOString() } : t
    ))
  }, [])

  const setProjectNagAllowed = useCallback((id, allowed) => {
    remoteLog('setProjectNagAllowed:', `id=${id.slice(0, 8)}`, allowed)
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, nag_allowed: !!allowed, last_touched: new Date().toISOString() } : t
    ))
  }, [])

  const setTaskParent = useCallback((id, parentId) => {
    remoteLog('setTaskParent:', `id=${id.slice(0, 8)}`, '→', parentId ? parentId.slice(0, 8) : 'none')
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, parent_id: parentId || null, last_touched: new Date().toISOString() } : t
    ))
  }, [])

  const setChildVisibility = useCallback((id, visibility) => {
    if (!['active', 'backstage'].includes(visibility)) return
    remoteLog('setChildVisibility:', `id=${id.slice(0, 8)}`, visibility)
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, child_visibility: visibility, last_touched: new Date().toISOString() } : t
    ))
  }, [])

  // Log a "worked on this" project session. Hits the server (which is the
  // points authority) and applies the result optimistically. Returns the
  // session result so callers can pop a toast with the points awarded;
  // throws with code='SESSION_CAP_REACHED' when the cap is exhausted.
  // Reads `tasks` via closure rather than functional setState so the
  // server call has the latest snapshot for offline-fallback points math.
  const logProjectSession = useCallback(async (projectId) => {
    const project = tasks.find(t => t.id === projectId)
    if (!project) throw new Error('Project not found')
    const expectedPoints = computeProjectSessionPoints(project, tasks)
    try {
      const result = await apiLogProjectSession(projectId)
      // Server is canonical — overwrite the project with the returned record
      // (session_count, last_session_at, session_log all updated).
      setTasks(prev => prev.map(t => t.id === projectId ? { ...t, ...result.task } : t))
      logActivity('session_logged', { ...project, _session_points: result.points })
      return { points: result.points, sessionCount: result.session_count, sessionCap: result.session_cap }
    } catch (err) {
      if (err.code === 'SESSION_CAP_REACHED') {
        throw err
      }
      // Network or server error — fall back to optimistic local-only update
      // so the user's tap isn't lost. Next /api/data sync will reconcile.
      const now = new Date().toISOString()
      setTasks(prev => prev.map(t => {
        if (t.id !== projectId) return t
        const log = Array.isArray(t.session_log) ? [...t.session_log] : []
        if ((t.session_count || 0) >= PROJECT_SESSION_CAP) return t
        log.push({ timestamp: now, points: expectedPoints })
        return {
          ...t,
          session_count: (t.session_count || 0) + 1,
          last_session_at: now,
          session_log: log,
          last_touched: now,
        }
      }))
      logActivity('session_logged', { ...project, _session_points: expectedPoints })
      return { points: expectedPoints, sessionCount: (project.session_count || 0) + 1, sessionCap: PROJECT_SESSION_CAP, offline: true }
    }
  }, [tasks])

  // Active children of pinned projects surface in the main list with a
  // parent-project badge. Pinning a project doesn't auto-promote its
  // children — each child has its own `child_visibility` setting.
  const pinnedProjects = tasks.filter(t => t.status === 'project' && t.pinned_to_today)
  const pinnedProjectIds = new Set(pinnedProjects.map(p => p.id))
  const activeChildrenOfPinned = tasks.filter(t =>
    t.parent_id && pinnedProjectIds.has(t.parent_id) &&
    t.child_visibility === 'active' &&
    isActiveTask(t)
  )

  // Filter regular task sections so pinned-project children don't double up.
  const isPinnedChild = (t) => t.parent_id && pinnedProjectIds.has(t.parent_id) && t.child_visibility === 'active'

  const openTasks = tasks.filter(t => isActiveTask(t) && !isPinnedChild(t))
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
    pinnedProjects,
    activeChildrenOfPinned,
    addTask,
    addSpawnedTasks,
    completeTask,
    snoozeTask,
    unsnoozeTask,
    replaceTask,
    updateTask,
    uncompleteTask,
    changeStatus,
    clearCompleted,
    deleteTask,
    clearAll,
    hydrateTasks,
    setProjectPinned,
    setProjectNagAllowed,
    setTaskParent,
    setChildVisibility,
    logProjectSession,
  }
}
