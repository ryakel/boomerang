import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { Settings as SettingsIcon, Search, ArrowUpDown, ChevronRight, X, Cloud, CloudOff, Package, FolderKanban } from 'lucide-react'
import { polyfill } from 'mobile-drag-drop'
import { scrollBehaviourDragImageTranslateOverride } from 'mobile-drag-drop/scroll-behaviour'
import 'mobile-drag-drop/default.css'
import './App.css'
import './components/Modal.css'
import { loadLabels, loadSettings, saveSettings, saveLabels, sortTasks, computeDailyStats, computeStreak } from './store'
import { inferSize, trelloUpdateCard, gmailApprove, gmailDismiss } from './api'
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
import KanbanBoard from './components/KanbanBoard'
import { useIsDesktop } from './hooks/useIsDesktop'
import { useNotifications } from './hooks/useNotifications'
import { useServerSync } from './hooks/useServerSync'
import { usePullToRefresh } from './hooks/usePullToRefresh'
import { useTrelloSync } from './hooks/useTrelloSync'
import { useNotionSync } from './hooks/useNotionSync'
import { useExternalSync } from './hooks/useExternalSync'
import { useGCalSync } from './hooks/useGCalSync'
import { useToastPrefetch } from './hooks/useToastPrefetch'
import { usePackages } from './hooks/usePackages'
import { usePackageNotifications } from './hooks/usePackageNotifications'
import Packages from './components/Packages'
import ProjectsView from './components/ProjectsView'

polyfill({ dragImageTranslateOverride: scrollBehaviourDragImageTranslateOverride })

function App() {
  const {
    tasks, setTasks, openTasks, staleTasks, snoozedTasks, waitingTasks, doingTasks, upNextTasks,
    addTask, addSpawnedTasks, completeTask, snoozeTask, replaceTask,
    updateTask, uncompleteTask, changeStatus, deleteTask, clearCompleted, clearAll, hydrateTasks,
  } = useTasks()

  const {
    routines, addRoutine, deleteRoutine, togglePause,
    completeRoutine, updateRoutine, updateRoutineNotion, spawnDueTasks, hydrateRoutines,
  } = useRoutines()

  const isDesktop = useIsDesktop()

  const [activeFilter, setActiveFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [snoozeTarget, setSnoozeTarget] = useState(null)
  const [reframeTarget, setReframeTarget] = useState(null)
  const [showWhatNow, setShowWhatNow] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [showRoutines, setShowRoutines] = useState(false)
  const [editRoutineId, setEditRoutineId] = useState(null)
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
  const [showPackages, setShowPackages] = useState(false)
  const [showProjects, setShowProjects] = useState(false)
  const [relatedTarget, setRelatedTarget] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchTimer = useRef(null)
  const sortRef = useRef(null)
  const quickRef = useRef(null)

  const labels = loadLabels()
  useNotifications(tasks)
  const { packages, addPackage, editPackage, removePackage, refresh: refreshPackage, refreshAll: refreshAllPackages, hydratePackages } = usePackages()
  usePackageNotifications(packages)
  const { syncTrello, pushStatusToTrello, syncing: trelloSyncing } = useTrelloSync(tasks, setTasks, changeStatus)
  const { syncing: notionSyncing, syncNotion } = useNotionSync(tasks, setTasks)
  const { syncing: gcalSyncing, syncGCal } = useGCalSync(tasks, setTasks)
  useExternalSync(tasks, updateTask)
  const prefetchToast = useToastPrefetch(tasks, updateTask)

  const hydrateFromServer = useCallback((data) => {
    if (data.tasks) hydrateTasks(data.tasks)
    if (data.routines) hydrateRoutines(data.routines)
    if (data.packages) hydratePackages(data.packages)
    // Also persist settings/labels so localStorage stays in sync with server
    if (data.settings) saveSettings(data.settings)
    if (data.labels) saveLabels(data.labels)
  }, [hydrateTasks, hydrateRoutines, hydratePackages])

  const [updateVersion, setUpdateVersion] = useState(null)
  const { flush: flushSync, checkVersion, syncStatus, queueLength } = useServerSync(tasks, routines, hydrateFromServer, (newVersion) => {
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
    if (showSettings || showDone || showAnalytics || showRoutines || showActivityLog || showPackages || showProjects || editTarget || showAdd || showWhatNow) {
      checkVersion()
    }
  }, [showSettings, showDone, showAnalytics, showRoutines, showActivityLog, showPackages, showProjects, editTarget, showAdd, showWhatNow, checkVersion])

  // Handle notification click deep links (?task=id)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const taskId = params.get('task')
    if (taskId) {
      // Clean URL without reload
      window.history.replaceState({}, '', '/')
      // Open the task if it exists
      const task = tasks.find(t => t.id === taskId)
      if (task) setEditTarget(task)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    const routine = addRoutine(title, cadence, customDays, tags, notes)
    // Link the original task to the new routine so it stays active as the first instance.
    // When completed later, handleComplete will log it on the routine and future instances
    // will be spawned by cadence (spawnDueTasks skips routines that already have an active task).
    updateTask(taskId, { routine_id: routine.id, last_touched: new Date().toISOString() })
    setEditTarget(null)
  }, [addRoutine, updateTask])

  const handleSearch = useCallback((query) => {
    setSearchQuery(query)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!query.trim()) {
      setSearchResults(null)
      return
    }
    searchTimer.current = setTimeout(() => {
      fetch(`/api/tasks?q=${encodeURIComponent(query.trim())}`)
        .then(res => res.ok ? res.json() : [])
        .then(results => setSearchResults(results))
        .catch(() => setSearchResults(null))
    }, 300)
  }, [])

  const filterTasks = (list) => {
    if (activeFilter === 'all') return list
    if (activeFilter === 'routines') return list.filter(t => t.routine_id)
    return list.filter(t => t.tags.includes(activeFilter))
  }

  const handleBacklog = useCallback((id, toBacklog) => {
    updateTask(id, { status: toBacklog ? 'backlog' : 'not_started', last_touched: new Date().toISOString() })
  }, [updateTask])

  const handleProject = useCallback((id, toProject) => {
    updateTask(id, { status: toProject ? 'project' : 'not_started', last_touched: new Date().toISOString() })
  }, [updateTask])

  const handleGmailApprove = useCallback((id) => {
    gmailApprove(id).then(() => {
      updateTask(id, { gmail_pending: false })
    }).catch(() => {})
  }, [updateTask])

  const handleGmailDismiss = useCallback((id) => {
    gmailDismiss(id).then(() => {
      deleteTask(id)
    }).catch(() => {})
  }, [deleteTask])

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
      const taskId = addTask({ title: text })
      setQuickText('')
      quickRef.current?.blur()
      // Auto-infer size + energy from title alone
      inferSize(text).then(inferred => {
        const updates = {}
        if (inferred.size) updates.size = inferred.size
        if (inferred.energy) updates.energy = inferred.energy
        if (inferred.energyLevel) updates.energyLevel = inferred.energyLevel
        if (Object.keys(updates).length > 0) updateTask(taskId, updates)
        prefetchToast(taskId, text, inferred.energy, inferred.energyLevel)
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
  const projectTasks = tasks.filter(t => t.status === 'project')
  const filteredStale = sortTasks(filterTasks(staleTasks), sortBy)
  const filteredDoing = sortTasks(filterTasks(doingTasks), sortBy)
  const filteredUpNext = sortTasks(filterTasks(upNextTasks), sortBy)
  const filteredWaiting = sortTasks(filterTasks(waitingTasks), sortBy)
  const filteredSnoozed = sortTasks(filterTasks(snoozedTasks), sortBy)
  const filteredBacklog = sortTasks(filterTasks(backlogTasks), sortBy)
  const filteredProjects = sortTasks(filterTasks(projectTasks), sortBy)

  return (
    <div className={`app${isDesktop ? ' desktop' : ''}`}>
      <header className="header">
        <div className="header-top">
          <div className="wordmark-lockup">
            <Logo size={24} />
            <span className="wordmark">BOOMERANG</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="header-icon-btn projects-color" onClick={() => setShowProjects(true)} title="Projects"><FolderKanban size={20} /></button>
            <button className="header-icon-btn packages-color" onClick={() => setShowPackages(true)} title="Packages"><Package size={20} /></button>
            <button className="header-icon-btn settings-color" onClick={() => setShowSettings(true)}><SettingsIcon size={20} /></button>
          </div>
        </div>
        <div className="header-stats">
          <MiniRings rings={miniRingsData} onClick={() => setShowAnalytics(true)} />
          <span className={`open-count ${settings.max_open_tasks && nonSnoozedCount > settings.max_open_tasks ? 'open-count-warn' : ''}`}>
            {nonSnoozedCount} open
          </span>
          {syncStatus && (
            <span className={`sync-indicator sync-indicator-${syncStatus}`} title={
              syncStatus === 'offline' ? `Offline${queueLength ? ` (${queueLength} pending)` : ''}` :
              syncStatus === 'saving' ? 'Syncing...' : 'Synced'
            }>
              {syncStatus === 'offline' ? <CloudOff size={13} /> :
               syncStatus === 'saving' ? <Cloud size={13} /> :
               <Cloud size={13} />}
            </span>
          )}
          <div className="sort-wrapper" ref={sortRef}>
            <button className="sort-btn" onClick={() => setShowSortDropdown(!showSortDropdown)}><ArrowUpDown size={15} /></button>
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
          <button className="sort-btn" onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) { setSearchQuery(''); setSearchResults(null) } }}>
            <Search size={15} />
          </button>
          {isDesktop && (
            <button className="what-now-btn-desktop" onClick={() => setShowWhatNow(true)}>
              What now?
            </button>
          )}
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

      {searchOpen && (
        <div className="search-bar" style={{ padding: '0 16px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="quick-input"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            autoFocus
            style={{ flex: 1 }}
          />
          <button
            className="sort-btn"
            onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults(null) }}
          >
            <X size={18} />
          </button>
        </div>
      )}

      {searchResults !== null && (
        <div className="task-list" style={{ padding: '0 16px' }}>
          <div className="section-label">
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
          </div>
          {searchResults.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onComplete={completeTask}
              onSnooze={setSnoozeTarget}
              onExpand={id => setExpandedTaskId(expandedTaskId === id ? null : id)}
              expanded={expandedTaskId === task.id}
              onEdit={setEditTarget}
              onStatusChange={changeStatus}
              onUpdate={updateTask}
            />
          ))}
          {searchResults.length === 0 && (
            <div className="empty-state">No tasks match your search.</div>
          )}
        </div>
      )}

      {searchResults === null && <>{isDesktop ? (
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
      ) : (
        <div className="tag-bar">
          <select
            className="tag-select"
            value={activeFilter}
            onChange={e => setActiveFilter(e.target.value)}
            style={activeFilter !== 'all' && activeFilter !== 'routines'
              ? { borderColor: labels.find(l => l.id === activeFilter)?.color }
              : {}}
          >
            <option value="all">All</option>
            {labels.map(label => (
              <option key={label.id} value={label.id}>
                {label.name.charAt(0).toUpperCase() + label.name.slice(1)}
              </option>
            ))}
          </select>
          <button
            className={`tag-pill ${activeFilter === 'routines' ? 'active' : ''}`}
            onClick={() => setShowRoutines(true)}
          >
            Routines{routines.length > 0 ? ` (${routines.length})` : ''}
          </button>
        </div>
      )}

      {isDesktop ? (
        <KanbanBoard
          filteredDoing={filteredDoing}
          filteredStale={filteredStale}
          filteredUpNext={filteredUpNext}
          filteredWaiting={filteredWaiting}
          filteredSnoozed={filteredSnoozed}
          filteredBacklog={filteredBacklog}
          filteredProjects={filteredProjects}
          onComplete={handleComplete}
          onSnooze={handleSnooze}
          onEdit={setEditTarget}
          onExtend={setExtendTarget}
          onStatusChange={handleStatusChange}
          onUpdate={updateTask}
          onDelete={handleDelete}
          onAddTask={(title, status) => {
            const taskId = addTask({ title })
            if (status !== 'not_started') changeStatus(taskId, status)
          }}
        />
      ) : (
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
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} onGmailApprove={handleGmailApprove} onGmailDismiss={handleGmailDismiss} />
            ))}
          </>
        )}

        {filteredStale.length > 0 && (
          <>
            <div className="section-label">Stale</div>
            {filteredStale.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} onGmailApprove={handleGmailApprove} onGmailDismiss={handleGmailDismiss} />
            ))}
          </>
        )}

        {filteredUpNext.length > 0 && (
          <>
            <div className="section-label">Up Next</div>
            {filteredUpNext.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} onGmailApprove={handleGmailApprove} onGmailDismiss={handleGmailDismiss} />
            ))}
          </>
        )}

        {filteredWaiting.length > 0 && (
          <>
            <div className="section-label">Waiting</div>
            {filteredWaiting.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} onGmailApprove={handleGmailApprove} onGmailDismiss={handleGmailDismiss} />
            ))}
          </>
        )}

        {filteredSnoozed.length > 0 && (
          <>
            <div className="section-label">Snoozed</div>
            {filteredSnoozed.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} onGmailApprove={handleGmailApprove} onGmailDismiss={handleGmailDismiss} />
            ))}
          </>
        )}

        {filteredBacklog.length > 0 && (
          <>
            <button className="backlog-toggle" onClick={() => setBacklogOpen(!backlogOpen)}>
              <span className={`backlog-arrow ${backlogOpen ? 'open' : ''}`}><ChevronRight size={12} /></span>
              Backlog ({filteredBacklog.length})
            </button>
            {backlogOpen && filteredBacklog.map(t => (
              <TaskCard key={t.id} task={t} onComplete={handleComplete} onSnooze={handleSnooze} onEdit={setEditTarget} onExtend={setExtendTarget} onBacklog={handleBacklog} onFindRelated={setRelatedTarget} onStatusChange={handleStatusChange} onUpdate={updateTask} onDelete={handleDelete} expandedId={expandedTaskId} onToggleExpand={setExpandedTaskId} onGmailApprove={handleGmailApprove} onGmailDismiss={handleGmailDismiss} />
            ))}
          </>
        )}
      </div>)}</>}

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
        <AddTaskModal onAdd={(taskData) => {
          const taskId = addTask(taskData)
          // Auto-infer size + energy if not manually set
          if (!taskData.size && taskData.title) {
            inferSize(taskData.title, taskData.notes).then(inferred => {
              const updates = {}
              if (inferred.size) updates.size = inferred.size
              if (inferred.energy) updates.energy = inferred.energy
              if (inferred.energyLevel) updates.energyLevel = inferred.energyLevel
              if (Object.keys(updates).length > 0) updateTask(taskId, updates)
              prefetchToast(taskId, taskData.title, inferred.energy, inferred.energyLevel)
            }).catch(() => {})
          } else {
            prefetchToast(taskId, taskData.title, taskData.energy, taskData.energyLevel)
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
          onNotionSync={syncNotion}
          notionSyncing={notionSyncing}
          onGCalSync={syncGCal}
          gcalSyncing={gcalSyncing}
          onShowActivityLog={() => { setShowSettings(false); setShowActivityLog(true) }}
          syncStatus={syncStatus}
          isDesktop={isDesktop}
        />
      )}

      {showAnalytics && (
        <Analytics onClose={() => setShowAnalytics(false)} isDesktop={isDesktop} />
      )}

      {showPackages && (
        <Packages
          packages={packages}
          onAdd={addPackage}
          onEdit={editPackage}
          onDelete={removePackage}
          onRefresh={refreshPackage}
          onRefreshAll={refreshAllPackages}
          onClose={() => setShowPackages(false)}
          isDesktop={isDesktop}
        />
      )}

      {showProjects && (
        <ProjectsView
          tasks={tasks}
          onComplete={handleComplete}
          onSnooze={handleSnooze}
          onEdit={setEditTarget}
          onExtend={setExtendTarget}
          onStatusChange={handleStatusChange}
          onUpdate={updateTask}
          onDelete={handleDelete}
          onClose={() => setShowProjects(false)}
          isDesktop={isDesktop}
        />
      )}

      {showDone && (
        <DoneList onClose={() => setShowDone(false)} onUncomplete={handleUncomplete} />
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
          onSave={(id, updates) => {
            updateTask(id, updates)
            if (updates.title || updates.energy || updates.energyLevel) {
              const task = tasks.find(t => t.id === id)
              if (task) {
                prefetchToast(id, updates.title || task.title, updates.energy || task.energy, updates.energyLevel || task.energyLevel)
              }
            }
          }}
          onConvertToRoutine={handleConvertToRoutine}
          onClose={() => setEditTarget(null)}
          onDelete={(id) => { handleDelete(id); setEditTarget(null) }}
          onBacklog={(id, toBacklog) => { handleBacklog(id, toBacklog); setEditTarget(null) }}
          onProject={(id, toProject) => { handleProject(id, toProject); setEditTarget(null) }}
          onStatusChange={handleStatusChange}
          onOpenRoutine={(routineId) => { setEditTarget(null); setShowRoutines(true); setEditRoutineId(routineId) }}
        />
      )}

      {showRoutines && (
        <Routines
          routines={routines}
          onAdd={addRoutine}
          onDelete={deleteRoutine}
          onTogglePause={togglePause}
          onUpdate={updateRoutine}
          onUpdateNotion={updateRoutineNotion}
          onClose={() => { setShowRoutines(false); setEditRoutineId(null) }}
          editRoutineId={editRoutineId}
          onClearEditRoutineId={() => setEditRoutineId(null)}
          isDesktop={isDesktop}
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
