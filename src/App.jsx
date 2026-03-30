import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import './App.css'
import { loadLabels, loadSettings, saveSettings } from './store'
import { inferSize } from './api'
import { useTasks } from './hooks/useTasks'
import { useRoutines } from './hooks/useRoutines'
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
import { useNotifications } from './hooks/useNotifications'
import { useSync } from './hooks/useSync'

function App() {
  const {
    tasks, openTasks, staleTasks, snoozedTasks, upNextTasks,
    addTask, addSpawnedTasks, completeTask, snoozeTask, replaceTask,
    updateTask, uncompleteTask, clearCompleted, clearAll, hydrateTasks,
  } = useTasks()

  const {
    routines, addRoutine, deleteRoutine, togglePause,
    completeRoutine, spawnDueTasks, hydrateRoutines,
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
  const [quickText, setQuickText] = useState('')
  const [toast, setToast] = useState(null)
  const [backlogOpen, setBacklogOpen] = useState(false)
  const quickRef = useRef(null)

  const labels = loadLabels()
  useNotifications(tasks)
  useSync(tasks, routines, useCallback((data) => {
    if (data.tasks) hydrateTasks(data.tasks)
    if (data.routines) hydrateRoutines(data.routines)
  }, [hydrateTasks, hydrateRoutines]))

  // Spawn routine tasks on load and every minute
  useEffect(() => {
    const spawned = spawnDueTasks(tasks)
    if (spawned.length > 0) addSpawnedTasks(spawned)
  }, [routines]) // eslint-disable-line react-hooks/exhaustive-deps

  const todayCount = useMemo(() => {
    const todayStr = new Date().toDateString()
    return tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).toDateString() === todayStr).length
  }, [tasks])

  const handleComplete = useCallback((id) => {
    const task = tasks.find(t => t.id === id)
    completeTask(id)
    setShowWhatNow(false)
    // If this task is from a routine, log completion on the routine
    if (task?.routine_id) {
      completeRoutine(task.routine_id)
    }
    if (task) {
      setToast({ ...task, completed_at: new Date().toISOString() })
    }
  }, [tasks, completeTask, completeRoutine])

  const handleUncomplete = useCallback((task) => {
    uncompleteTask(task.id)
    setToast({ task, variant: 'reopen' })
  }, [uncompleteTask])

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
    updateTask(id, { status: toBacklog ? 'backlog' : 'open', last_touched: new Date().toISOString() })
  }, [updateTask])

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
      addTask(text)
      setQuickText('')
      quickRef.current?.blur()
    } else {
      setShowAdd(true)
    }
  }

  const settings = loadSettings()

  const nonSnoozedCount = openTasks.filter(t => {
    if (t.snoozed_until && new Date(t.snoozed_until) > new Date()) return false
    return true
  }).length

  const backlogTasks = tasks.filter(t => t.status === 'backlog')
  const filteredStale = filterTasks(staleTasks)
  const filteredUpNext = filterTasks(upNextTasks)
  const filteredSnoozed = filterTasks(snoozedTasks)
  const filteredBacklog = filterTasks(backlogTasks)

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <div className="wordmark-lockup">
            <Logo size={24} />
            <span className="wordmark">BOOMERANG</span>
          </div>
          <button className="settings-btn" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
        <div className="header-stats">
          <span className={`open-count ${settings.max_open_tasks && nonSnoozedCount > settings.max_open_tasks ? 'open-count-warn' : ''}`}>
            {nonSnoozedCount} open
          </span>
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

      <div className="task-list">
        {filteredStale.length === 0 && filteredUpNext.length === 0 && filteredSnoozed.length === 0 && (
          <div className="empty-state">
            No tasks yet.<br />Add one below to get started.
          </div>
        )}

        {filteredStale.length > 0 && (
          <>
            <div className="section-label">Stale</div>
            {filteredStale.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} />
            ))}
          </>
        )}

        {filteredUpNext.length > 0 && (
          <>
            <div className="section-label">Up Next</div>
            {filteredUpNext.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} />
            ))}
          </>
        )}

        {filteredSnoozed.length > 0 && (
          <>
            <div className="section-label">Snoozed</div>
            {filteredSnoozed.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} />
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
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} />
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
        <AddTaskModal onAdd={(title, tags, dueDate, notes, notion, size) => {
          const taskId = addTask(title, tags, dueDate, notes, notion, size)
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
          onClose={() => setShowSettings(false)}
          onClearCompleted={() => { clearCompleted(); setShowSettings(false) }}
          onClearAll={() => { clearAll(); saveSettings({}); setShowSettings(false) }}
        />
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

      {editTarget && (
        <EditTaskModal
          task={editTarget}
          onSave={updateTask}
          onConvertToRoutine={handleConvertToRoutine}
          onClose={() => setEditTarget(null)}
        />
      )}

      {showRoutines && (
        <Routines
          routines={routines}
          onAdd={addRoutine}
          onDelete={deleteRoutine}
          onTogglePause={togglePause}
          onClose={() => setShowRoutines(false)}
        />
      )}

      {toast && (
        <Toast
          task={toast.variant ? toast.task : toast}
          todayCount={todayCount}
          variant={toast.variant || 'complete'}
          onDone={() => setToast(null)}
        />
      )}
    </div>
  )
}

export default App
