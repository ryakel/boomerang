import { useCallback, useEffect, useState } from 'react'
import { ListChecks, Settings as SettingsIcon, FolderKanban, BarChart3, History, ChevronRight, CheckCircle2, RotateCw } from 'lucide-react'
import Header from './components/Header'
import ModalShell from './components/ModalShell'
import EmptyState from './components/EmptyState'
import SectionLabel from './components/SectionLabel'
import TaskCard from './components/TaskCard'
import SnoozeModal from './components/SnoozeModal'
import AddTaskModal from './components/AddTaskModal'
import EditTaskModal from './components/EditTaskModal'
import ReframeModal from './components/ReframeModal'
import WhatNowModal from './components/WhatNowModal'
import SettingsModal from './components/SettingsModal'
import ProjectsView from './components/ProjectsView'
import DoneList from './components/DoneList'
import ActivityLog from './components/ActivityLog'
import RoutinesModal from './components/RoutinesModal'
import PackagesModal from './components/PackagesModal'
import AdviserModal from './components/AdviserModal'
import AnalyticsModal from './components/AnalyticsModal'
import KanbanBoard from './components/KanbanBoard'
import Toast from './components/Toast'
import { useTasks } from '../hooks/useTasks'
import { useRoutines, enhanceSpawnedTasks } from '../hooks/useRoutines'
import { useNotifications } from '../hooks/useNotifications'
import { useServerSync } from '../hooks/useServerSync'
import { useExternalSync } from '../hooks/useExternalSync'
import { useSizeAutoInfer } from '../hooks/useSizeAutoInfer'
import { useToastPrefetch } from '../hooks/useToastPrefetch'
import { usePackages } from '../hooks/usePackages'
import { usePackageNotifications } from '../hooks/usePackageNotifications'
import { useAdviser } from '../hooks/useAdviser'
import { useIsDesktop } from '../hooks/useIsDesktop'
import { useWeather } from '../hooks/useWeather'
import { useTrelloSync } from '../hooks/useTrelloSync'
import { inferSize, trelloUpdateCard } from '../api'
import { loadSettings, saveSettings, saveLabels, sortTasks } from '../store'
import './AppV2.css'

export default function AppV2() {
  const [snoozeTarget, setSnoozeTarget] = useState(null)
  const [reframeTarget, setReframeTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [toast, setToast] = useState(null)
  const [showWhatNow, setShowWhatNow] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showProjects, setShowProjects] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [showActivityLog, setShowActivityLog] = useState(false)
  const [showRoutines, setShowRoutines] = useState(false)
  const [editRoutineId, setEditRoutineId] = useState(null)
  const [showPackages, setShowPackages] = useState(false)
  const [showAdviser, setShowAdviser] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [expandedTaskId, setExpandedTaskId] = useState(null)
  // Adviser conversation state lives at the App level so it survives modal
  // open/close — user can pop in, ask something, close, come back to the
  // same thread. Server session TTL still governs the staged-plan life.
  const adviserState = useAdviser()
  const isDesktop = useIsDesktop()
  const weather = useWeather()

  // Mark the document so v2-namespaced tokens activate.
  useEffect(() => {
    document.documentElement.setAttribute('data-ui', 'v2')
    return () => { document.documentElement.removeAttribute('data-ui') }
  }, [])

  // Shared task + routine state — same hooks v1 uses, no fork.
  const {
    tasks, setTasks, addTask, addSpawnedTasks, completeTask, snoozeTask, replaceTask, updateTask,
    uncompleteTask, changeStatus, deleteTask, clearCompleted, clearAll,
    staleTasks, snoozedTasks, waitingTasks, doingTasks, upNextTasks, hydrateTasks,
  } = useTasks()
  const {
    routines, addRoutine, deleteRoutine, togglePause, updateRoutine,
    completeRoutine, spawnDueTasks, spawnNow, skipCycle, hydrateRoutines,
  } = useRoutines()

  // Background work that must keep running even when v2 is the active shell:
  // notifications, AI inference, external (Trello/Notion) outbound sync,
  // package polling + delivery notifications.
  useNotifications(tasks)
  useExternalSync(tasks, updateTask)
  useSizeAutoInfer(tasks, updateTask)
  const prefetchToast = useToastPrefetch(tasks, updateTask)
  const { packages, addPackage, removePackage, refresh: refreshPackage, refreshAll: refreshAllPackages } = usePackages()
  usePackageNotifications(packages)
  // Trello status push lives at this level so handleComplete / status-change
  // / handleUncomplete can fire it for any task with a linked Trello card.
  const { pushStatusToTrello } = useTrelloSync(tasks, setTasks, changeStatus)

  // Server hydration + cross-client sync. Mirror v1's hydrateFromServer so
  // settings + labels stay in localStorage when other clients update them.
  const hydrateFromServer = useCallback((data) => {
    if (data.tasks) hydrateTasks(data.tasks)
    if (data.routines) hydrateRoutines(data.routines)
    if (data.settings) saveSettings(data.settings)
    if (data.labels) saveLabels(data.labels)
  }, [hydrateTasks, hydrateRoutines])

  const { flush: flushSync } = useServerSync(tasks, routines, hydrateFromServer, () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        for (const r of regs) r.unregister()
      })
    }
    setTimeout(() => window.location.reload(), 1000)
  })

  // Spawn due routine tasks on load + when routines change.
  useEffect(() => {
    const spawned = spawnDueTasks(tasks)
    if (spawned.length > 0) {
      addSpawnedTasks(spawned)
      enhanceSpawnedTasks(spawned, routines).then(enhanced => {
        for (const t of enhanced) {
          if (t.due_date) updateTask(t.id, { due_date: t.due_date })
        }
      }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routines])

  // Sorted views — v2 currently uses a fixed 'age' sort. Sort UI ports later.
  const sortedDoing = sortTasks(doingTasks, 'age')
  const sortedStale = sortTasks(staleTasks, 'age')
  const sortedUpNext = sortTasks(upNextTasks, 'age')
  const sortedWaiting = sortTasks(waitingTasks, 'age')
  const sortedSnoozed = sortTasks(snoozedTasks, 'age')
  const backlogTasks = sortTasks(tasks.filter(t => t.status === 'backlog'), 'age')
  const projectTasks = sortTasks(tasks.filter(t => t.status === 'project'), 'name')
  const totalActive = sortedDoing.length + sortedStale.length + sortedUpNext.length + sortedWaiting.length
  const todayStr = new Date().toDateString()
  const todayCount = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).toDateString() === todayStr).length

  const handleComplete = useCallback((id) => {
    const task = tasks.find(t => t.id === id)
    completeTask(id)
    setShowWhatNow(false)
    // Log completion on the parent routine so the cadence clock advances.
    if (task?.routine_id) completeRoutine(task.routine_id)
    // Push completion to Trello so the linked card moves to the done list.
    if (task?.trello_card_id) pushStatusToTrello(task, 'done')
    // Score the next-best candidate for the toast's "Next up" hint —
    // high_priority +100, due-today/overdue +50, XS/S +20. Same logic v1
    // uses. Trello status push deferred to PR8 (needs useTrelloSync).
    if (task) {
      const ACTIVE = ['not_started', 'doing', 'waiting']
      const candidates = tasks.filter(t =>
        t.id !== id &&
        ACTIVE.includes(t.status) &&
        !t.gmail_pending &&
        !t.notifications_muted &&
        (!t.snoozed_until || new Date(t.snoozed_until) <= new Date())
      )
      const todayStr = new Date().toISOString().split('T')[0]
      const score = t => {
        let s = 0
        if (t.high_priority) s += 100
        if (t.due_date && t.due_date <= todayStr) s += 50
        if (t.size === 'XS' || t.size === 'S') s += 20
        return s
      }
      candidates.sort((a, b) => score(b) - score(a))
      const nextTask = candidates[0] || null
      setToast({ ...task, completed_at: new Date().toISOString(), nextTask })
    }
  }, [tasks, completeTask, completeRoutine, pushStatusToTrello])

  const handleEdit = useCallback((task) => setEditTarget(task), [])

  // Snooze with reframe-threshold check: if a task's been snoozed enough
  // times (configurable via reframe_threshold), open the Reframe modal
  // instead of Snooze. Mirrors v1 App.jsx logic.
  const handleSnooze = useCallback((task) => {
    const settings = loadSettings()
    if (task.snooze_count >= settings.reframe_threshold) {
      setReframeTarget(task)
    } else {
      setSnoozeTarget(task)
    }
  }, [])

  const handleStatusChange = useCallback((id, newStatus) => {
    if (newStatus === 'done') { handleComplete(id); return }
    changeStatus(id, newStatus)
    // Push the new status to Trello if the task has a linked card.
    const task = tasks.find(t => t.id === id)
    if (task?.trello_card_id) pushStatusToTrello(task, newStatus)
  }, [handleComplete, changeStatus, tasks, pushStatusToTrello])

  const handleBacklog = useCallback((id, toBacklog) => {
    updateTask(id, { status: toBacklog ? 'backlog' : 'not_started', last_touched: new Date().toISOString() })
  }, [updateTask])

  const handleProject = useCallback((id, toProject) => {
    updateTask(id, { status: toProject ? 'project' : 'not_started', last_touched: new Date().toISOString() })
  }, [updateTask])

  const handleConvertToRoutine = useCallback((taskId, { title, cadence, customDays, tags, notes }) => {
    const routine = addRoutine(title, cadence, customDays, tags, notes)
    updateTask(taskId, { routine_id: routine.id, last_touched: new Date().toISOString() })
    setEditTarget(null)
  }, [addRoutine, updateTask])

  const handleUncomplete = useCallback((task) => {
    uncompleteTask(task.id)
    setToast({ task, variant: 'reopen' })
    if (task?.trello_card_id) pushStatusToTrello(task, 'not_started')
  }, [uncompleteTask, pushStatusToTrello])

  // Archive the Trello card on delete so the next inbound sync doesn't
  // re-import the task. Mirrors v1 handleDelete.
  const handleDelete = useCallback((id) => {
    const task = tasks.find(t => t.id === id)
    if (task?.trello_card_id) {
      trelloUpdateCard(task.trello_card_id, { closed: true }).catch(() => {})
    }
    deleteTask(id)
  }, [tasks, deleteTask])

  const handleRestore = useCallback((snapshot) => {
    setTasks(prev => [snapshot, ...prev])
    setShowActivityLog(false)
  }, [setTasks])

  // Mirrors v1's add path: create task, kick off AI inference for size/energy
  // when not manually set, and prefetch the completion toast copy.
  const handleAddTask = useCallback((taskData) => {
    const taskId = addTask(taskData)
    if (!taskData.size && taskData.title) {
      inferSize(taskData.title, taskData.notes).then(inferred => {
        const updates = {}
        if (inferred.size) updates.size = inferred.size
        if (inferred.energy) updates.energy = inferred.energy
        if (inferred.energyLevel) updates.energyLevel = inferred.energyLevel
        if (Object.keys(updates).length > 0) {
          updates.size_inferred = true
          updateTask(taskId, updates)
        }
        prefetchToast(taskId, taskData.title, inferred.energy, inferred.energyLevel)
      }).catch(() => {})
    } else {
      prefetchToast(taskId, taskData.title, taskData.energy, taskData.energyLevel)
    }
  }, [addTask, updateTask, prefetchToast])

  const renderSection = (label, list) => list.length > 0 && (
    <>
      <SectionLabel count={list.length}>{label}</SectionLabel>
      {list.map(t => (
        <TaskCard
          key={t.id}
          task={t}
          expanded={expandedTaskId === t.id}
          onToggleExpand={setExpandedTaskId}
          onComplete={handleComplete}
          onEdit={handleEdit}
          onSnooze={handleSnooze}
          weatherByDate={weather.enabled ? weather.byDate : null}
        />
      ))}
    </>
  )

  return (
    <div className="v2-app">
      <Header
        onOpenWhatNow={() => setShowWhatNow(true)}
        onOpenAdd={() => setShowAdd(true)}
        onOpenAdviser={() => setShowAdviser(true)}
        onOpenPackages={() => setShowPackages(true)}
        onOpenMenu={() => setShowMenu(true)}
      />
      <main className={`v2-main${isDesktop ? ' v2-main-kanban' : ''}`}>
        {totalActive === 0 && sortedSnoozed.length === 0 && backlogTasks.length === 0 && projectTasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Nothing on your plate"
            body="No active tasks right now. Tap the + above to add one."
            cta="Add task"
            ctaOnClick={() => setShowAdd(true)}
          />
        ) : isDesktop ? (
          <KanbanBoard
            doingTasks={sortedDoing}
            staleTasks={sortedStale}
            upNextTasks={sortedUpNext}
            waitingTasks={sortedWaiting}
            snoozedTasks={sortedSnoozed}
            backlogTasks={backlogTasks}
            projectTasks={projectTasks}
            onAddTask={(title, status) => {
              const taskId = addTask({ title })
              if (status !== 'not_started') changeStatus(taskId, status)
            }}
            onStatusChange={handleStatusChange}
            expandedTaskId={expandedTaskId}
            onToggleExpand={setExpandedTaskId}
            onComplete={handleComplete}
            onEdit={handleEdit}
            onSnooze={handleSnooze}
            weatherByDate={weather.enabled ? weather.byDate : null}
          />
        ) : (
          <div className="v2-list">
            {renderSection('Doing', sortedDoing)}
            {renderSection('Stale', sortedStale)}
            {renderSection('Up next', sortedUpNext)}
            {renderSection('Waiting', sortedWaiting)}
            {renderSection('Snoozed', sortedSnoozed)}
          </div>
        )}
      </main>

      {snoozeTarget && (
        <SnoozeModal
          task={snoozeTarget}
          onSnooze={snoozeTask}
          onClose={() => setSnoozeTarget(null)}
        />
      )}

      <AddTaskModal
        open={showAdd}
        onAdd={handleAddTask}
        onClose={() => setShowAdd(false)}
      />

      {editTarget && (
        <EditTaskModal
          task={editTarget}
          onSave={updateTask}
          onClose={() => setEditTarget(null)}
          onDelete={(id) => { handleDelete(id); setEditTarget(null) }}
          onBacklog={handleBacklog}
          onProject={handleProject}
          onStatusChange={handleStatusChange}
          onConvertToRoutine={handleConvertToRoutine}
        />
      )}

      {reframeTarget && (
        <ReframeModal
          task={reframeTarget}
          onReframe={replaceTask}
          onClose={() => setReframeTarget(null)}
        />
      )}

      <WhatNowModal
        open={showWhatNow}
        tasks={tasks}
        onClose={() => setShowWhatNow(false)}
        onComplete={handleComplete}
      />

      {/* More-menu sheet. Each row's icon is tinted to match v1's color hint
          system so users can recognize destinations at a glance. */}
      <ModalShell open={showMenu} onClose={() => setShowMenu(false)} title="More" width="narrow">
        <ul className="v2-more-menu">
          <li>
            <button className="v2-more-row" onClick={() => { setShowMenu(false); setShowSettings(true) }}>
              <SettingsIcon size={18} strokeWidth={1.75} className="v2-more-row-icon v2-more-row-icon-settings" />
              <span className="v2-more-row-label">Settings</span>
              <ChevronRight size={16} strokeWidth={1.75} className="v2-more-row-chev" />
            </button>
          </li>
          <li>
            <button className="v2-more-row" onClick={() => { setShowMenu(false); setShowProjects(true) }}>
              <FolderKanban size={18} strokeWidth={1.75} className="v2-more-row-icon v2-more-row-icon-projects" />
              <span className="v2-more-row-label">Projects</span>
              <ChevronRight size={16} strokeWidth={1.75} className="v2-more-row-chev" />
            </button>
          </li>
          <li>
            <button className="v2-more-row" onClick={() => { setShowMenu(false); setShowRoutines(true) }}>
              <RotateCw size={18} strokeWidth={1.75} className="v2-more-row-icon v2-more-row-icon-routines" />
              <span className="v2-more-row-label">Routines</span>
              <ChevronRight size={16} strokeWidth={1.75} className="v2-more-row-chev" />
            </button>
          </li>
          <li>
            <button className="v2-more-row" onClick={() => { setShowMenu(false); setShowDone(true) }}>
              <CheckCircle2 size={18} strokeWidth={1.75} className="v2-more-row-icon v2-more-row-icon-done" />
              <span className="v2-more-row-label">Done</span>
              <ChevronRight size={16} strokeWidth={1.75} className="v2-more-row-chev" />
            </button>
          </li>
          <li>
            <button className="v2-more-row" onClick={() => { setShowMenu(false); setShowAnalytics(true) }}>
              <BarChart3 size={18} strokeWidth={1.75} className="v2-more-row-icon v2-more-row-icon-analytics" />
              <span className="v2-more-row-label">Analytics</span>
              <ChevronRight size={16} strokeWidth={1.75} className="v2-more-row-chev" />
            </button>
          </li>
          <li>
            <button className="v2-more-row" onClick={() => { setShowMenu(false); setShowActivityLog(true) }}>
              <History size={18} strokeWidth={1.75} className="v2-more-row-icon v2-more-row-icon-activity" />
              <span className="v2-more-row-label">Activity log</span>
              <ChevronRight size={16} strokeWidth={1.75} className="v2-more-row-chev" />
            </button>
          </li>
        </ul>
      </ModalShell>

      <SettingsModal
        open={showSettings}
        onClose={() => { setShowSettings(false); flushSync() }}
        onFlush={flushSync}
        onClearCompleted={() => { clearCompleted(); setShowSettings(false); flushSync() }}
        onClearAll={() => { clearAll(); setShowSettings(false); flushSync() }}
        onShowActivityLog={() => setShowActivityLog(true)}
      />
      <ProjectsView
        open={showProjects}
        tasks={tasks}
        onClose={() => setShowProjects(false)}
        onComplete={handleComplete}
        onEdit={handleEdit}
        onSnooze={handleSnooze}
        weatherByDate={weather.enabled ? weather.byDate : null}
      />
      <DoneList
        open={showDone}
        onClose={() => setShowDone(false)}
        onUncomplete={handleUncomplete}
      />
      <ActivityLog
        open={showActivityLog}
        onClose={() => setShowActivityLog(false)}
        onRestore={handleRestore}
      />
      <RoutinesModal
        open={showRoutines}
        routines={routines}
        onAdd={addRoutine}
        onDelete={deleteRoutine}
        onTogglePause={togglePause}
        onUpdate={updateRoutine}
        onSpawnNow={(routineId) => {
          const task = spawnNow(routineId)
          if (task) addSpawnedTasks([task])
        }}
        onSkipCycle={skipCycle}
        onClose={() => { setShowRoutines(false); setEditRoutineId(null) }}
        editRoutineId={editRoutineId}
        onClearEditRoutineId={() => setEditRoutineId(null)}
      />

      <PackagesModal
        open={showPackages}
        packages={packages}
        onAdd={addPackage}
        onDelete={removePackage}
        onRefresh={refreshPackage}
        onRefreshAll={refreshAllPackages}
        onClose={() => setShowPackages(false)}
      />

      <AdviserModal
        open={showAdviser}
        adviser={adviserState}
        onClose={() => setShowAdviser(false)}
      />

      <AnalyticsModal
        open={showAnalytics}
        onClose={() => setShowAnalytics(false)}
      />

      {toast && (
        <Toast
          task={toast.variant ? toast.task : toast}
          todayCount={todayCount}
          variant={toast.variant || 'complete'}
          nextTask={toast.nextTask}
          onNextTaskClick={t => { setEditTarget(t); setToast(null) }}
          onDone={() => setToast(null)}
          onUndo={() => {
            const taskToUndo = toast.variant ? toast.task : toast
            uncompleteTask(taskToUndo.id)
            setToast(null)
          }}
        />
      )}
    </div>
  )
}
