import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import './App.css'
import { loadLabels, loadSettings, saveSettings, saveLabels, sortTasks, computeDailyStats, computeStreak } from './store'
import { inferSize, trelloUpdateCard } from './api'
import { useTasks } from './hooks/useTasks'
import { useRoutines, enhanceSpawnedTasks } from './hooks/useRoutines'
import TaskCard from './components/TaskCard'
import AddTaskModal from './components/AddTaskModal'
import SnoozeModal from './components/SnoozeModal'
import ReframeModal from './components/ReframeModal'
import WhatNow from './components/WhatNow'
import Settings from './components/Settings'
import Toast from './components/Toast'
import DoneList from './components/DoneList'
import Routines from './components/Routines'
import EditTaskModal from './components/EditTaskModal'
import ExtendModal from './components/ExtendModal'
import Logo from './components/Logo'
import Analytics from './components/Analytics'
import FindRelatedModal from './components/FindRelatedModal'
import ActivityLog from './components/ActivityLog'
import { MiniRings } from './components/Rings'
import { useNotifications } from './hooks/useNotifications'
import { useServerSync } from './hooks/useServerSync'
import { usePullToRefresh } from './hooks/usePullToRefresh'
import { useTrelloSync } from './hooks/useTrelloSync'

function App() {
  const {
    tasks, setTasks, openTasks, staleTasks, snoozedTasks, waitingTasks, doingTasks, upNextTasks,
    addTask, addSpawnedTasks, completeTask, snoozeTask, replaceTask,
    updateTask, uncompleteTask, changeStatus, deleteTask, clearCompleted, clearAll, hydrateTasks,
  } = useTasks()

  const {
    routines, addRoutine, deleteRoutine, togglePause,
    completeRoutine, updateRoutine, spawnDueTasks, hydrateRoutines,
  } = useRoutines()

  const [activeFilter, setActiveFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [snoozeTarget, setSnoozeTarget] = useState(null)
  const [reframeTarget, setReframeTarget] = useState(null)
  const [showWhatNow, setShowWhatNow] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [showRoutines, setShowRoutines] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [extendTarget, setExtendTarget] = useState(null)
  const [expandedTaskId, setExpandedTaskId] = useState(null)
  const [quickText, setQuickText] = useState('')
  const [toast, setToast] = useState(null)
  const [backlogOpen, setBacklogOpen] = useState(false)
  const [sortBy, setSortBy] = useState(() => loadSettings().sort_by || 'age')
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showActivityLog, setShowActivityLog] = useState(false)
  const [relatedTarget, setRelatedTarget] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const sortRef = useRef(null)
  const quickRef = useRef(null)

  const labels = loadLabels()
  useNotifications(tasks)
  const { syncTrello, pushStatusToTrello, syncing: trelloSyncing } = useTrelloSync(tasks, setTasks, changeStatus)

  const hydrateFromServer = useCallback((data) => {
    if (data.tasks) hydrateTasks(data.tasks)
    if (data.routines) hydrateRoutines(data.routines)
    // Also persist settings/labels so localStorage stays in sync with server
    if (data.settings) saveSettings(data.settings)
    if (data.labels) saveLabels(data.labels)
  }, [hydrateTasks, hydrateRoutines])

  const [updateVersion, setUpdateVersion] = useState(null)
  const { flush: flushSync, checkVersion, syncStatus } = useServerSync(tasks, routines, hydrateFromServer, (newVersion) => {
    setUpdateVersion(newVersion)
    // Unregister service worker so reload fetches fresh assets from server
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        for (const r of regs) r.unregister()
      })
    }
    setTimeout(() => window.location.reload(), 1000)
  })

  const { onTouchStart, onTouchEnd } = usePullToRefresh(useCallback(() => {
    setRefreshing(true)
    fetch('/api/data')
      .then(r => r.json())
      .then(data => { if (data && Object.keys(data).length > 0) hydrateFromServer(data) })
      .catch(() => {})
      .finally(() => setTimeout(() => setRefreshing(false), 500))
  }, [hydrateFromServer]))

  // Check app version on every view/modal navigation
  useEffect(() => {
    if (showSettings || showDone || showAnalytics || showRoutines || showActivityLog || editTarget || showAdd || showWhatNow) {
      checkVersion()
    }
  }, [showSettings, showDone, showAnalytics, showRoutines, showActivityLog, editTarget, showAdd, showWhatNow, checkVersion])

  // Spawn routine tasks on load and every minute
  useEffect(() => {
    const spawned = spawnDueTasks(tasks)
    if (spawned.length > 0) {
      addSpawnedTasks(spawned)
      // Try to enhance with AI dates (non-blocking)
      enhanceSpawnedTasks(spawned, routines).then(enhanced => {
        for (const t of enhanced) {
          if (t.due_date) updateTask(t.id, { due_date: t.due_date })
        }
      }).catch(() => {})
    }
  }, [routines]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!showSortDropdown) return
    const handleClick = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) {
        setShowSortDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showSortDropdown])

  const handleSortChange = (value) => {
    setSortBy(value)
    setShowSortDropdown(false)
    const current = loadSettings()
    saveSettings({ ...current, sort_by: value })
    flushSync()
  }

  const settings = loadSettings()

  const todayCount = useMemo(() => {
    const todayStr = new Date().toDateString()
    return tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).toDateString() === todayStr).length
  }, [tasks])

  const dailyStats = useMemo(() => computeDailyStats(tasks), [tasks])
  const streak = useMemo(() => computeStreak(tasks, settings), [tasks, settings])
  const miniRingsData = useMemo(() => [
    { progress: (settings.daily_task_goal || 3) > 0 ? dailyStats.tasksToday / (settings.daily_task_goal || 3) : 0, color: '#52C97F' },
    { progress: (settings.daily_points_goal || 15) > 0 ? dailyStats.pointsToday / (settings.daily_points_goal || 15) : 0, color: '#FFB347' },
    { progress: streak > 0 ? Math.min(streak / 7, 1) : 0, color: '#4A9EFF' },
  ], [dailyStats, streak, settings])

  const handleComplete = useCallback((id) => {
    const task = tasks.find(t => t.id === id)
    completeTask(id)
    setShowWhatNow(false)
    // If this task is from a routine, log completion on the routine
    if (task?.routine_id) {
      completeRoutine(task.routine_id)
    }
    // Push completion to Trello so the card moves to the done list
    if (task?.trello_card_id) {
      pushStatusToTrello(task, 'done')
    }
    if (task) {
      setToast({ ...task, completed_at: new Date().toISOString() })
    }
  }, [tasks, completeTask, completeRoutine, pushStatusToTrello])

  const handleUncomplete = useCallback((task) => {
    uncompleteTask(task.id)
    // Push reopened status back to Trello
    if (task?.trello_card_id) {
      pushStatusToTrello(task, 'not_started')
    }
    setToast({ task, variant: 'reopen' })
  }, [uncompleteTask, pushStatusToTrello])

  const handleDelete = useCallback((id) => {
    const task = tasks.find(t => t.id === id)
    // Archive the card on Trello so it doesn't get re-imported on next sync
    if (task?.trello_card_id) {
      trelloUpdateCard(task.trello_card_id, { closed: true }).catch(() => {})
    }
    deleteTask(id)
  }, [tasks, deleteTask])

  const handleConvertToRoutine = useCallback((taskId, { title, cadence, customDays, tags, notes }) => {
    addRoutine(title, cadence, customDays, tags, notes)
    // Remove the original one-off task since it's now a routine
    completeTask(taskId)
    setEditTarget(null)
  }, [addRoutine, completeTask])

  const filterTasks = (list) => {
    if (activeFilter === 'all') return list
    if (activeFilter === 'routines') return list.filter(t => t.routine_id)
    return list.filter(t => t.tags.includes(activeFilter))
  }

  const handleBacklog = useCallback((id, toBacklog) => {
    updateTask(id, { status: toBacklog ? 'backlog' : 'not_started', last_touched: new Date().toISOString() })
  }, [updateTask])

  const handleStatusChange = useCallback((id, newStatus) => {
    if (newStatus === 'done') {
      // handleComplete already pushes to Trello
      handleComplete(id)
      return
    }
    changeStatus(id, newStatus)
    // Push status to Trello if linked (fire-and-forget)
    const task = tasks.find(t => t.id === id)
    if (task?.trello_card_id) {
      pushStatusToTrello(task, newStatus)
    }
  }, [changeStatus, handleComplete, tasks, pushStatusToTrello])

  const handleSnooze = (task) => {
    const settings = loadSettings()
    if (task.snooze_count >= settings.reframe_threshold) {
      setReframeTarget(task)
    } else {
      setSnoozeTarget(task)
    }
  }

  const handleQuickAdd = () => {
    const text = quickText.trim()
    if (text) {
      const taskId = addTask(text)
      setQuickText('')
      quickRef.current?.blur()
      // Auto-infer size from title alone
      inferSize(text).then(inferred => {
        if (inferred) updateTask(taskId, { size: inferred })
      }).catch(() => {})
    } else {
      setShowAdd(true)
    }
  }

  const nonSnoozedCount = openTasks.filter(t => {
    if (t.snoozed_until && new Date(t.snoozed_until) > new Date()) return false
    return true
  }).length

  const backlogTasks = tasks.filter(t => t.status === 'backlog')
  const filteredStale = sortTasks(filterTasks(staleTasks), sortBy)
  const filteredDoing = sortTasks(filterTasks(doingTasks), sortBy)
  const filteredUpNext = sortTasks(filterTasks(upNextTasks), sortBy)
  const filteredWaiting = sortTasks(filterTasks(waitingTasks), sortBy)
  const filteredSnoozed = sortTasks(filterTasks(snoozedTasks), sortBy)
  const filteredBacklog = sortTasks(filterTasks(backlogTasks), sortBy)

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <div className="wordmark-lockup">
            <Logo size={24} />
            <span className="wordmark">BOOMERANG</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="analytics-icon" onClick={() => setShowAnalytics(true)}>📊</button>
            <button className="settings-btn" onClick={() => setShowSettings(true)}>⚙</button>
          </div>
        </div>
        <div className="header-stats">
          <MiniRings rings={miniRingsData} onClick={() => setShowAnalytics(true)} />
          <span className={`open-count ${settings.max_open_tasks && nonSnoozedCount > settings.max_open_tasks ? 'open-count-warn' : ''}`}>
            {nonSnoozedCount} open
          </span>
          <div className="sort-wrapper" ref={sortRef}>
            <button className="sort-btn" onClick={() => setShowSortDropdown(!showSortDropdown)}>↕</button>
            {showSortDropdown && (
              <div className="sort-dropdown">
                {[
                  { value: 'age', label: 'Age' },
                  { value: 'due_date', label: 'Due date' },
                  { value: 'size', label: 'Size' },
                  { value: 'name', label: 'Name' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    className={`sort-option ${sortBy === opt.value ? 'active' : ''}`}
                    onClick={() => handleSortChange(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {todayCount > 0 ? (
            <button className="today-count" onClick={() => setShowDone(true)}>
              {todayCount} done today
            </button>
          ) : tasks.some(t => t.status === 'done') ? (
            <button className="done-link" onClick={() => setShowDone(true)}>
              Done
            </button>
          ) : null}
        </div>
      </header>

      <div className="tag-bar">
        <button
          className={`tag-pill ${activeFilter === 'all' ? 'active' : ''}`}
          onClick={() => setActiveFilter('all')}
        >
          All
        </button>
        {labels.map(label => (
          <button
            key={label.id}
            className={`tag-pill ${activeFilter === label.id ? 'active' : ''}`}
            onClick={() => setActiveFilter(label.id)}
            style={activeFilter === label.id ? { background: label.color } : {}}
          >
            {label.name.charAt(0).toUpperCase() + label.name.slice(1)}
          </button>
        ))}
        <button
          className={`tag-pill ${activeFilter === 'routines' ? 'active' : ''}`}
          onClick={() => setShowRoutines(true)}
          style={{ borderLeft: '1px solid var(--surface-hover)', marginLeft: 4, paddingLeft: 14 }}
        >
          Routines{routines.length > 0 ? ` (${routines.length})` : ''}
        </button>
      </div>

      <div className="task-list" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {refreshing && <div className="refresh-indicator">Refreshing...</div>}
        {filteredStale.length === 0 && filteredDoing.length === 0 && filteredUpNext.length === 0 && filteredWaiting.length === 0 && filteredSnoozed.length === 0 && (
          <div className="empty-state">
            No tasks yet.<br />Add one below to get started.
          </div>
        )}

        {filteredDoing.length > 0 && (
          <>
            <div className="section-label">Doing</div>
            {filteredDoing.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} />
            ))}
          </>
        )}

        {filteredStale.length > 0 && (
          <>
            <div className="section-label">Stale</div>
            {filteredStale.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} />
            ))}
          </>
        )}

        {filteredUpNext.length > 0 && (
          <>
            <div className="section-label">Up Next</div>
            {filteredUpNext.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} />
            ))}
          </>
        )}

        {filteredWaiting.length > 0 && (
          <>
            <div className="section-label">Waiting</div>
            {filteredWaiting.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} />
            ))}
          </>
        )}

        {filteredSnoozed.length > 0 && (
          <>
            <div className="section-label">Snoozed</div>
            {filteredSnoozed.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} />
            ))}
          </>
        )}

        {filteredBacklog.length > 0 && (
          <>
            <button className="backlog-toggle" onClick={() => setBacklogOpen(!backlogOpen)}>
              <span className={`backlog-arrow ${backlogOpen ? 'open' : ''}`}>▶</span>
              Backlog ({filteredBacklog.length})
            </button>
            {backlogOpen && filteredBacklog.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} />
            ))}
          </>
        )}
      </div>

      <div className="bottom-bar">
        <button className="what-now-btn" onClick={() => setShowWhatNow(true)}>
          What can I do right now?
        </button>
        <div className="quick-add">
          <input
            ref={quickRef}
            className="quick-add-input"
            placeholder="Quick add..."
            value={quickText}
            onChange={e => setQuickText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleQuickAdd()
              }
            }}
          />
          <button className="quick-add-btn" onClick={handleQuickAdd}>+</button>
        </div>
      </div>

      {showAdd && (
        <AddTaskModal onAdd={(title, tags, dueDate, notes, notion, size, attachments) => {
          const taskId = addTask(title, tags, dueDate, notes, notion, size, attachments)
          // Auto-infer size if not manually set
          if (!size && title) {
            inferSize(title, notes).then(inferred => {
              if (inferred) updateTask(taskId, { size: inferred })
            }).catch(() => {})
          }
        }} onClose={() => setShowAdd(false)} />
      )}

      {snoozeTarget && (
        <SnoozeModal
          task={snoozeTarget}
          onSnooze={(id, date) => { snoozeTask(id, date); setSnoozeTarget(null) }}
          onClose={() => setSnoozeTarget(null)}
        />
      )}

      {reframeTarget && (
        <ReframeModal
          task={reframeTarget}
          onReframe={replaceTask}
          onClose={() => setReframeTarget(null)}
        />
      )}

      {showWhatNow && (
        <WhatNow tasks={tasks} onClose={() => setShowWhatNow(false)} onComplete={handleComplete} />
      )}

      {showSettings && (
        <Settings
          onClose={() => { setShowSettings(false); flushSync() }}
          onClearCompleted={() => { clearCompleted(); setShowSettings(false); flushSync() }}
          onClearAll={() => { clearAll(); saveSettings({}); setShowSettings(false); flushSync() }}
          onTrelloSync={syncTrello}
          trelloSyncing={trelloSyncing}
          onShowActivityLog={() => { setShowSettings(false); setShowActivityLog(true) }}
          syncStatus={syncStatus}
        />
      )}

      {showAnalytics && (
        <Analytics tasks={tasks} onClose={() => setShowAnalytics(false)} />
      )}

      {showDone && (
        <DoneList tasks={tasks} onClose={() => setShowDone(false)} onUncomplete={handleUncomplete} />
      )}

      {extendTarget && (
        <ExtendModal
          task={extendTarget}
          onExtend={(id, newDate) => { updateTask(id, { due_date: newDate }); setExtendTarget(null) }}
          onClose={() => setExtendTarget(null)}
        />
      )}

      {relatedTarget && (
        <FindRelatedModal
          task={relatedTarget}
          onLink={(taskId, page) => {
            updateTask(taskId, { notion_page_id: page.id, notion_url: page.url })
            setRelatedTarget(null)
          }}
          onClose={() => setRelatedTarget(null)}
        />
      )}

      {editTarget && (
        <EditTaskModal
          task={editTarget}
          onSave={updateTask}
          onConvertToRoutine={handleConvertToRoutine}
          onClose={() => setEditTarget(null)}
          onDelete={(id) => { handleDelete(id); setEditTarget(null) }}
          onBacklog={(id, toBacklog) => { handleBacklog(id, toBacklog); setEditTarget(null) }}
          onStatusChange={handleStatusChange}
        />
      )}

      {showRoutines && (
        <Routines
          routines={routines}
          onAdd={addRoutine}
          onDelete={deleteRoutine}
          onTogglePause={togglePause}
          onUpdate={updateRoutine}
          onClose={() => setShowRoutines(false)}
        />
      )}

      {showActivityLog && (
        <ActivityLog
          onRestore={(snapshot) => {
            setTasks(prev => [snapshot, ...prev])
            setShowActivityLog(false)
          }}
          onClose={() => setShowActivityLog(false)}
        />
      )}

      {toast && (
        <Toast
          task={toast.variant ? toast.task : toast}
          todayCount={todayCount}
          variant={toast.variant || 'complete'}
          onDone={() => setToast(null)}
          onUndo={() => {
            const taskToUndo = toast.variant ? toast.task : toast
            uncompleteTask(taskToUndo.id)
            setToast(null)
          }}
        />
      )}

      {updateVersion && (
        <div className="sheet-overlay" style={{ zIndex: 9999 }}>
          <div className="update-modal">
            <p>Update available: <strong>{updateVersion}</strong></p>
            <p className="update-modal-sub">Refreshing automatically...</p>
            <button className="update-modal-btn" onClick={() => {
              if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(regs => { for (const r of regs) r.unregister() })
              window.location.reload()
            }}>
              Reload now
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
