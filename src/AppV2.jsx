import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ListChecks } from 'lucide-react'
import Header from './components/Header'
import ModalShell from './components/ModalShell'
import BottomTabs from './components/BottomTabs'
import SystemMenu from './components/SystemMenu'
import SpacesHub from './components/SpacesHub'
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
import WallabyShell from './wallaby/WallabyShell'
import KeptShell from './kept/KeptShell'
import KeptDesktop from './kept/KeptDesktop'
import WallabyEditTask from './wallaby/WallabyEditTask'
import SuggestionsModal from './components/SuggestionsModal'
import PackagesModal from './components/PackagesModal'
import AdviserModal from './components/AdviserModal'
import AnalyticsModal from './components/AnalyticsModal'
import KanbanBoard from './components/KanbanBoard'
import ProjectPinnedSection from './components/ProjectPinnedSection'
import StackSection from './components/StackSection'
import TaskListToolbar from './components/TaskListToolbar'
import MarkdownImportModal from './components/MarkdownImportModal'
import WeekStrip from './components/WeekStrip'
import Toast from './components/Toast'
import FloatingCapture from './components/FloatingCapture'
import ConfirmDialog from './components/ConfirmDialog'
import TicTacToe from './components/TicTacToe'
import { useTasks } from './hooks/useTasks'
import { useRoutines, enhanceSpawnedTasks } from './hooks/useRoutines'
import { useNotifications } from './hooks/useNotifications'
import { useServerSync } from './hooks/useServerSync'
import { useExternalSync } from './hooks/useExternalSync'
import { useSizeAutoInfer } from './hooks/useSizeAutoInfer'
import { useToastPrefetch } from './hooks/useToastPrefetch'
import { usePackages } from './hooks/usePackages'
import { usePackageNotifications } from './hooks/usePackageNotifications'
import { useAdviser } from './hooks/useAdviser'
import { useIsDesktop } from './hooks/useIsDesktop'
import { useWeather } from './hooks/useWeather'
import { useTrelloSync } from './hooks/useTrelloSync'
import { useNotionSync } from './hooks/useNotionSync'
import { useGCalSync } from './hooks/useGCalSync'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { inferSize, trelloUpdateCard, serverSkipAdvanceTask } from './api'
import { loadLabels, loadSettings, saveSettings, saveLabels, sortTasks, computeDailyStats, computeStreak, logActivity, localYMD } from './store'
import { computeRecords, calculateTaskPoints } from './scoring'
import { applyTheme } from './theme'
import './AppV2.css'

export default function AppV2() {
  const [snoozeTarget, setSnoozeTarget] = useState(null)
  const [reframeTarget, setReframeTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  // Wallaby gets a chip-language quick editor; "More options" flips to the full
  // EditTaskModal for advanced config. Reset whenever the edit target clears.
  const [editFull, setEditFull] = useState(false)
  useEffect(() => { if (!editTarget) setEditFull(false) }, [editTarget])
  const [showAdd, setShowAdd] = useState(false)
  const [toast, setToast] = useState(null)
  const [showWhatNow, setShowWhatNow] = useState(false)
  // Bottom-tab navigation state. 'today' = main task list, 'spaces' =
  // SpacesHub picker for Projects/Routines/Knowledge. Mobile only —
  // desktop keeps Kanban + side drawer. Modal-driven sub-destinations
  // (the existing ProjectsView etc.) reset activeTab to 'today' on
  // their close so the tab indicator never lies about where the user is.
  const [activeTab, setActiveTab] = useState('today')
  // Anchored-popover off the header ⚙ icon. Hosts Settings, Analytics,
  // Done, Suggestions, Activity log. Replaces the legacy ⋯ More menu
  // sheet; the ⋯ button is gone and the ⚙ icon takes its slot.
  const [systemMenuOpen, setSystemMenuOpen] = useState(false)
  // When the user is on the Spaces tab and every spaces-related surface
  // (hub + sub-destinations launched from it) has closed, snap the tab
  // indicator back to 'today'. Safety net so the active-tab pill never
  // claims "spaces" while the user is actually looking at the Today
  // list. Effect runs after each render — no race with the close
  // handlers that fire synchronously.
  const [showSettings, setShowSettings] = useState(false)
  const [showProjects, setShowProjects] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [showActivityLog, setShowActivityLog] = useState(false)
  const [showMarkdownImport, setShowMarkdownImport] = useState(false)
  const [updateVersion, setUpdateVersion] = useState(null)
  // SpacesHub is the destination for the Spaces tab. Opens a picker
  // for Projects / Routines / Knowledge; tapping a row closes the hub
  // and launches the existing dedicated modal. C-upgrade replaces the
  // picker rows with rich preview cards but keeps the contract.
  const [spacesHubOpen, setSpacesHubOpen] = useState(false)
  const [showRoutines, setShowRoutines] = useState(false)
  const [editRoutineId, setEditRoutineId] = useState(null)
  const [showPackages, setShowPackages] = useState(false)
  const [showAdviser, setShowAdviser] = useState(false)
  // One-shot input draft handed to AdviserModal when opened via a
  // pre-seeded entry point (currently the Knowledge menu item).
  const [adviserDraftSeed, setAdviserDraftSeed] = useState('')
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  // 7-day strip visibility — single source of truth. Date tap toggles
  // it in all themes. Two settings can seed the initial state on load:
  //   - week_strip_always_open: explicit "open by default" toggle
  //   - show_week_strip: legacy non-terminal setting (light/dark default
  //     is true). Either being on means "start with the strip open".
  const [weekStripShown, setWeekStripShown] = useState(() => {
    const s = loadSettings()
    return !!s.week_strip_always_open || !!s.show_week_strip
  })
  // Which home-stats detail section is expanded: 'streak' | 'today' | null
  const [statsDetail, setStatsDetail] = useState(null)
  const [expandedTaskId, setExpandedTaskId] = useState(null)
  const [activeFilter, setActiveFilter] = useState('all')
  const [sortBy, setSortBy] = useState(() => loadSettings().sort_by || 'age')
  const [labels, setLabels] = useState(() => loadLabels())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const searchTimerRef = useRef(null)
  // Adviser conversation state lives at the App level so it survives modal
  // open/close — user can pop in, ask something, close, come back to the
  // same thread. Server session TTL still governs the staged-plan life.
  const adviserState = useAdviser()
  const isDesktop = useIsDesktop()
  const weather = useWeather()

  // Hidden tic-tac-toe Easter egg. Triggered by either: 7-tap the Build
  // row in Settings → Logs (Android-build-number metaphor) OR say "want
  // to play a game" / "wanna play a game" to Quokka.
  const [tttOpen, setTttOpen] = useState(false)
  const openEasterEgg = useCallback(() => setTttOpen(true), [])
  const [collapsedSections, setCollapsedSections] = useState(() => loadSettings().collapsed_sections || {})
  const toggleSection = useCallback((name) => {
    setCollapsedSections(prev => {
      const next = { ...prev, [name]: !prev[name] }
      const merged = { ...loadSettings(), collapsed_sections: next }
      saveSettings(merged)
      return next
    })
  }, [])
  // Per-project collapse state for the pinned-projects section. Keyed by
  // project id so each pinned project can fold its sub list independently
  // (useful when you have multiple pinned and only want one expanded).
  // Persisted in settings → survives reloads + cross-device sync.
  const [collapsedPinnedProjects, setCollapsedPinnedProjects] = useState(() => loadSettings().collapsed_pinned_projects || {})
  const togglePinnedProjectCollapse = useCallback((projectId) => {
    setCollapsedPinnedProjects(prev => {
      const next = { ...prev, [projectId]: !prev[projectId] }
      const merged = { ...loadSettings(), collapsed_pinned_projects: next }
      saveSettings(merged)
      return next
    })
  }, [])

  // Safety net for the Spaces tab indicator. The hub launches Projects /
  // Routines / Adviser (Knowledge) modals, which close independently.
  // When all of them AND the hub itself are closed, snap activeTab back
  // to 'today' so the bottom-tab pill never claims 'spaces' over an
  // empty Today list.
  useEffect(() => {
    if (activeTab === 'spaces' && !spacesHubOpen && !showProjects && !showRoutines && !showAdviser) {
      setActiveTab('today')
    }
  }, [activeTab, spacesHubOpen, showProjects, showRoutines, showAdviser])

  // Mark the document so v2-namespaced tokens activate. Also apply the saved
  // theme on mount so the rendered UI matches whatever the Settings theme
  // picker reads — without this, settings.theme could be 'dark'/'terminal'
  // (carried over from another device or previous session) but data-theme
  // would be unset, making the modal say one thing while the rest of the
  // app renders another.
  useEffect(() => {
    document.documentElement.setAttribute('data-ui', 'v2')
    applyTheme(loadSettings().theme)
    return () => { document.documentElement.removeAttribute('data-ui') }
  }, [])

  // Shared task + routine state — same hooks v1 uses, no fork.
  const {
    tasks, setTasks, addTask, addSpawnedTasks, completeTask, snoozeTask, unsnoozeTask, replaceTask, updateTask,
    uncompleteTask, changeStatus, deleteTask, clearCompleted, clearAll,
    staleTasks, snoozedTasks, waitingTasks, doingTasks, upNextTasks, hydrateTasks,
    pinnedProjects, activeChildrenOfPinned, isPinnedChild,
    setProjectPinned, setTaskParent, setChildVisibility, logProjectSession,
  } = useTasks()
  const {
    routines, addRoutine, deleteRoutine, togglePause, updateRoutine,
    completeRoutine, uncompleteRoutine, adjustRoutineHistory, spawnDueTasks, spawnNow, logHabit, skipCycle, hydrateRoutines,
  } = useRoutines()

  // Background work that must keep running even when v2 is the active shell:
  // notifications, AI inference, external (Trello/Notion) outbound sync,
  // package polling + delivery notifications.
  useNotifications(tasks)
  useExternalSync(tasks, updateTask)
  useSizeAutoInfer(tasks, updateTask)
  const prefetchToast = useToastPrefetch(tasks, updateTask)

  // Routine-id set for routines with an active instance on the list. Drives
  // the "Already on list" disabled state on the RoutinesModal Spawn now button.
  const activeRoutineIds = useMemo(() => {
    const s = new Set()
    for (const t of tasks) {
      if (t.routine_id && !['done', 'completed', 'cancelled'].includes(t.status)) {
        s.add(t.routine_id)
      }
    }
    return s
  }, [tasks])
  const { packages, addPackage, removePackage, refresh: refreshPackage, refreshAll: refreshAllPackages } = usePackages()
  usePackageNotifications(packages)
  // Trello status push lives at this level so handleComplete / status-change
  // / handleUncomplete can fire it for any task with a linked Trello card.
  const { pushStatusToTrello, syncTrello, syncing: trelloSyncing } = useTrelloSync(tasks, setTasks, changeStatus)
  // Notion + GCal pull-syncs. Both also auto-fire on mount + visibility-change
  // when configured — matching v1 behavior. v2 previously didn't run them at
  // all, so the dev image was silently missing inbound Notion/GCal sync.
  const { syncing: notionSyncing, syncNotion, routineSuggestions, dismissSuggestion, acceptSuggestion } = useNotionSync(tasks, setTasks)
  const { syncing: gcalSyncing, syncGCal } = useGCalSync(tasks, setTasks)

  // Server hydration + cross-client sync. Mirror v1's hydrateFromServer so
  // settings + labels stay in localStorage when other clients update them.
  //
  // Note on theme: `useServerSync` owns the localStorage write for settings
  // and has a theme-preservation guard (theme is device-local; a stale
  // server snapshot shouldn't overwrite a fresh local pick). Don't call
  // `saveSettings(data.settings)` here — it'd bypass that guard. We only
  // mirror downstream React state that depends on server-side settings.
  const hydrateFromServer = useCallback((data) => {
    if (data.tasks) hydrateTasks(data.tasks)
    if (data.routines) hydrateRoutines(data.routines)
    if (data.settings) {
      if (data.settings.sort_by) setSortBy(data.settings.sort_by)
    }
    if (data.labels) {
      saveLabels(data.labels)
      setLabels(data.labels)
    }
  }, [hydrateTasks, hydrateRoutines])

  const { flush: flushSync, checkVersion, syncStatus, queueLength } = useServerSync(tasks, routines, hydrateFromServer, (newVersion) => {
    setUpdateVersion(newVersion)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        for (const r of regs) r.unregister()
      })
    }
    setTimeout(() => window.location.reload(), 1000)
  })

  // Check app version whenever a view/modal opens — same cadence v1 uses.
  // Catches stale clients without waiting for the next SSE/sync round-trip.
  useEffect(() => {
    if (showSettings || showDone || showAnalytics || showRoutines || showActivityLog || showPackages || showProjects || showAdviser || showSuggestions || editTarget || showAdd || showWhatNow || showMarkdownImport) {
      checkVersion()
    }
  }, [showSettings, showDone, showAnalytics, showRoutines, showActivityLog, showPackages, showProjects, showAdviser, showSuggestions, editTarget, showAdd, showWhatNow, showMarkdownImport, checkVersion])

  // Deep-link handler. Notifications come in as `/?task=<id>` (task tap),
  // `/?routine=<id>` (habit nudge tap, PR 2 — currently no-op without
  // matching state), or `/?suggestions=1` (routine_suggestion push, PR 3).
  // Strip the query after handling so reload doesn't re-trigger.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const taskId = params.get('task')
    const wantSuggestions = params.get('suggestions') === '1'
    const wantAdviser = params.has('adviser')
    if (!taskId && !wantSuggestions && !wantAdviser) return
    params.delete('task')
    params.delete('suggestions')
    params.delete('adviser')
    const search = params.toString()
    window.history.replaceState({}, '', `/${search ? `?${search}` : ''}${window.location.hash}`)
    if (taskId) {
      const task = tasks.find(t => t.id === taskId)
      if (task) setEditTarget(task)
      import('./api').then(({ markNotificationTap }) => {
        markNotificationTap?.(taskId).catch(() => {})
      }).catch(() => {})
    }
    if (wantSuggestions) {
      setShowSuggestions(true)
    }
    // Plan-ready push deep-link — open the Quokka modal so the user can
    // review the staged plan. The chatId in the URL param is informational
    // for analytics; useAdviser hydrates the active chat regardless.
    if (wantAdviser) {
      setShowAdviser(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Spawn due routine tasks on load + when routines change. Auto-roll routines
  // bump an existing active instance forward instead of spawning a duplicate
  // — see useRoutines.spawnDueTasks + wiki/Activity-Prompts.md.
  useEffect(() => {
    const { spawned, rolled } = spawnDueTasks(tasks)
    for (const { taskId, updates } of rolled) updateTask(taskId, updates)
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

  // Filter + sort. activeFilter = 'all' | 'routines' | <label-id>; sortBy
  // persists via settings.sort_by. Routines is a header pill that opens the
  // RoutinesModal rather than filtering — list never sees that value.
  const filterTasks = useCallback((list) => {
    if (activeFilter === 'all') return list
    return list.filter(t => Array.isArray(t.tags) && t.tags.includes(activeFilter))
  }, [activeFilter])

  // On mobile, active children of pinned projects render inside the
  // ProjectPinnedSection so we filter them out of the regular sections to
  // avoid double-display. On desktop, the Kanban has no pinned-projects
  // section, so the children show in their natural status columns.
  const dropPinnedChildren = (list) => isDesktop ? list : list.filter(t => !isPinnedChild(t))
  // Stack members render in their own grouped StackSection (mobile), so drop
  // them from the regular ACTIVE sections to avoid double-display. They stay in
  // the Snoozed section pre-trigger (consistent with trigger_time semantics —
  // the group only surfaces once members un-snooze). On desktop the Kanban has
  // no StackSection, so members show in their natural columns.
  const stackRoutineIds = new Set(
    routines.filter(r => Array.isArray(r.members) && r.members.length > 0).map(r => r.id),
  )
  const isStackMember = (t) => !!t.routine_id && stackRoutineIds.has(t.routine_id)
  const dropStackMembers = (list) => isDesktop ? list : list.filter(t => !isStackMember(t))
  const sortedDoing = sortTasks(dropStackMembers(dropPinnedChildren(filterTasks(doingTasks))), sortBy)
  const sortedStale = sortTasks(dropStackMembers(dropPinnedChildren(filterTasks(staleTasks))), sortBy)
  const sortedUpNext = sortTasks(dropStackMembers(dropPinnedChildren(filterTasks(upNextTasks))), sortBy)
  const sortedWaiting = sortTasks(dropStackMembers(dropPinnedChildren(filterTasks(waitingTasks))), sortBy)
  const sortedSnoozed = sortTasks(dropPinnedChildren(filterTasks(snoozedTasks)), sortBy)

  // Group surfaced stack members into cycles for the grouped display. A cycle
  // is the (routine_id, due_date) set; it surfaces once at least one member is
  // un-snoozed. Progress = done/total across the cycle; bonus preview = 20% of
  // the cycle's combined member points.
  const stackGroups = (() => {
    if (isDesktop) return []
    const now = Date.now()
    const isSnoozed = (t) => t.snoozed_until && new Date(t.snoozed_until).getTime() > now
    const byCycle = new Map()
    for (const t of tasks) {
      if (!isStackMember(t)) continue
      if (['backlog', 'project', 'cancelled'].includes(t.status)) continue
      const key = `${t.routine_id}|${t.due_date || ''}`
      if (!byCycle.has(key)) {
        byCycle.set(key, {
          key,
          routine: routines.find(r => r.id === t.routine_id),
          dueDate: t.due_date,
          tasks: [],
        })
      }
      byCycle.get(key).tasks.push(t)
    }
    const groups = []
    for (const g of byCycle.values()) {
      const active = g.tasks.filter(t => t.status !== 'done')
      const surfaced = sortTasks(filterTasks(active.filter(t => !isSnoozed(t))), sortBy)
      if (surfaced.length === 0) continue
      const total = g.tasks.length
      const doneCount = total - active.length
      const bonusPreview = Math.round(0.2 * g.tasks.reduce((s, t) => s + calculateTaskPoints(t), 0))
      groups.push({ ...g, surfaced, total, doneCount, bonusPreview })
    }
    groups.sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'))
    return groups
  })()
  const backlogTasks = sortTasks(filterTasks(tasks.filter(t => t.status === 'backlog')), sortBy)
  const projectTasks = sortTasks(filterTasks(tasks.filter(t => t.status === 'project')), sortBy === 'age' ? 'name' : sortBy)

  const handleSortChange = useCallback((value) => {
    setSortBy(value)
    saveSettings({ ...loadSettings(), sort_by: value })
    flushSync()
  }, [flushSync])

  // Debounced search against /api/tasks?q=. Mirrors v1's pattern. Empty
  // query clears the result set; results=null means "search inactive."
  const handleSearchChange = useCallback((query) => {
    setSearchQuery(query)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!query.trim()) { setSearchResults(null); return }
    searchTimerRef.current = setTimeout(() => {
      fetch(`/api/tasks?q=${encodeURIComponent(query.trim())}`)
        .then(res => res.ok ? res.json() : [])
        .then(results => setSearchResults(results))
        .catch(() => setSearchResults(null))
    }, 300)
  }, [])

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults(null)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
  }, [])
  const totalActive = sortedDoing.length + sortedStale.length + sortedUpNext.length + sortedWaiting.length
  const todayStr = new Date().toDateString()
  const todayCount = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).toDateString() === todayStr).length
  const hasDone = todayCount > 0 || tasks.some(t => t.status === 'done')
  // Mini-rings driven by daily-stats + streak. Same colors v1 uses.
  const settingsForRings = loadSettings()
  const dailyStats = computeDailyStats(tasks, settingsForRings)
  const streak = computeStreak(tasks, settingsForRings)
  const records = useMemo(() => computeRecords(tasks), [tasks])
  // Wallaby presents the full loggd IA (bottom-nav shell) on mobile. Desktop
  // keeps the Kanban + drawer for now.
  const isWallaby = (settingsForRings.theme || '').startsWith('wallaby')
  // Kept presents the Boomerang IA (KeptShell: Today/Loops/Throw/Tasks/More)
  // on mobile. Desktop keeps the standard layout until K5's command center.
  const isKept = (settingsForRings.theme || '').startsWith('kept')
  // editTarget is the snapshot captured when the editor opened. Resolve the
  // LIVE task for the editor modals so the Wallaby chip-editor → "More
  // options" handoff doesn't show (and autosave back) values the chip editor
  // already changed — the full editor seeds its form from the task prop at
  // mount. Falls back to the snapshot for tasks not in local state (e.g.
  // server search results).
  const liveEditTarget = editTarget ? (tasks.find(t => t.id === editTarget.id) || editTarget) : null
  // Use the Wallaby chip-language quick editor for regular tasks on mobile;
  // projects/subs and "More options" fall through to the full EditTaskModal.
  const useWallabyEditor = !!liveEditTarget && isWallaby && !isDesktop && !editFull
    && liveEditTarget.status !== 'project' && !liveEditTarget.parent_id
  // Flat ordered list for desktop keyboard nav (j/k). Mirrors the visual order:
  // doing → stale → up next → waiting → snoozed → backlog → projects.
  const visibleTasks = isDesktop
    ? [...sortedDoing, ...sortedStale, ...sortedUpNext, ...sortedWaiting, ...sortedSnoozed, ...backlogTasks, ...projectTasks]
    : []

  const miniRingsData = [
    { progress: (settingsForRings.daily_task_goal || 3) > 0 ? dailyStats.tasksToday / (settingsForRings.daily_task_goal || 3) : 0, color: '#52C97F' },
    { progress: (settingsForRings.daily_points_goal || 15) > 0 ? dailyStats.pointsToday / (settingsForRings.daily_points_goal || 15) : 0, color: '#FFB347' },
    { progress: streak > 0 ? Math.min(streak / 7, 1) : 0, color: '#4A9EFF' },
  ]

  // Keyboard-shortcut bookkeeping. activeModals is a top-down list (latest
  // opened wins on Esc); closeTopModal pops the top one. Order matters here —
  // if two modals can be open at once (e.g. snooze on top of the task list),
  // the deeper one comes first.
  const activeModals = []
  if (snoozeTarget) activeModals.push('snooze')
  if (reframeTarget) activeModals.push('reframe')
  if (editTarget) activeModals.push('edit')
  if (showAdd) activeModals.push('add')
  if (showWhatNow) activeModals.push('whatnow')
  if (showSettings) activeModals.push('settings')
  if (showProjects) activeModals.push('projects')
  if (showDone) activeModals.push('done')
  if (showActivityLog) activeModals.push('activitylog')
  if (showRoutines) activeModals.push('routines')
  if (showPackages) activeModals.push('packages')
  if (showAdviser) activeModals.push('adviser')
  if (showAnalytics) activeModals.push('analytics')
  if (showSuggestions) activeModals.push('suggestions')
  if (spacesHubOpen) activeModals.push('spaces')
  if (systemMenuOpen) activeModals.push('systemMenu')
  if (searchOpen) activeModals.push('search')

  const closeTopModal = useCallback(() => {
    if (snoozeTarget) { setSnoozeTarget(null); return }
    if (reframeTarget) { setReframeTarget(null); return }
    if (editTarget) { setEditTarget(null); return }
    if (showAdd) { setShowAdd(false); return }
    if (showWhatNow) { setShowWhatNow(false); return }
    if (showSettings) { setShowSettings(false); return }
    if (showProjects) { setShowProjects(false); return }
    if (showDone) { setShowDone(false); return }
    if (showActivityLog) { setShowActivityLog(false); return }
    if (showRoutines) { setShowRoutines(false); return }
    if (showPackages) { setShowPackages(false); return }
    if (showAdviser) { setShowAdviser(false); return }
    if (showAnalytics) { setShowAnalytics(false); return }
    if (showSuggestions) { setShowSuggestions(false); return }
    if (spacesHubOpen) { setSpacesHubOpen(false); setActiveTab('today'); return }
    if (systemMenuOpen) { setSystemMenuOpen(false); return }
    if (searchOpen) { handleCloseSearch(); return }
  }, [snoozeTarget, reframeTarget, editTarget, showAdd, showWhatNow, showSettings, showProjects, showDone, showActivityLog, showRoutines, showPackages, showAdviser, showAnalytics, showSuggestions, spacesHubOpen, systemMenuOpen, searchOpen, handleCloseSearch])

  const focusSearchInput = useCallback(() => {
    setSearchOpen(true)
    setTimeout(() => document.querySelector('.v2-toolbar-search-input')?.focus(), 60)
  }, [])

  const handleComplete = useCallback((id) => {
    const task = tasks.find(t => t.id === id)
    completeTask(id)
    setShowWhatNow(false)
    // Routine completion + stack-clear bonus.
    let stackBonus = 0
    if (task?.routine_id) {
      const routine = routines.find(r => r.id === task.routine_id)
      const isStack = Array.isArray(routine?.members) && routine.members.length > 0
      if (!isStack) {
        // Ordinary routine: advance the cadence clock on every completion.
        completeRoutine(task.routine_id)
      } else {
        // Stack member: the cycle is the (routine_id, due_date) set. Only the
        // completion that clears the LAST member advances the cadence and pays
        // the bonus. Each member already scored its own points on completion.
        const siblings = tasks.filter(
          t => t.routine_id === task.routine_id && t.due_date === task.due_date,
        )
        const allDone = siblings.every(s => s.id === id || s.status === 'done')
        if (allDone) {
          // 20% of the cycle's combined member points (treat the just-completed
          // one as done-now for its speed multiplier).
          const total = siblings.reduce((sum, s) => sum + calculateTaskPoints(
            s.id === id ? { ...s, completed_at: new Date().toISOString() } : s,
          ), 0)
          stackBonus = Math.round(total * 0.2)
          if (stackBonus > 0) updateTask(id, { stack_bonus: stackBonus })
          completeRoutine(task.routine_id)
        }
      }
    }
    // Push completion to Trello so the linked card moves to the done list.
    if (task?.trello_card_id) pushStatusToTrello(task, 'done')
    // Score the next-best candidate for the toast's "Next up" hint.
    // Base signal: high_priority +100, due-today/overdue +50, XS/S +20 (v1 carryover).
    // Follow-up signal: prefer tasks that look related to the one just completed —
    // shared routine_id (next instance of the same recurring task), shared
    // notion_page_id (same Notion-doc context), shared tags (related work),
    // explicit follow-up keywords in the title. Caps the follow-up bonus so
    // a wildly-overdue stranger task can still beat a same-tag low-pri future task.
    if (task) {
      const ACTIVE = ['not_started', 'doing', 'waiting']
      const candidates = tasks.filter(t =>
        t.id !== id &&
        ACTIVE.includes(t.status) &&
        !t.gmail_pending &&
        !t.notifications_muted &&
        (!t.snoozed_until || new Date(t.snoozed_until) <= new Date())
      )
      const todayStr = localYMD()
      const completedTags = new Set(task.tags || [])
      const completedTitleLower = (task.title || '').toLowerCase()
      const followUpKeywords = ['follow up', 'follow-up', 'followup', 'after ', 'next step', 'reply to', 'respond to']
      const score = t => {
        let s = 0
        if (t.high_priority) s += 100
        if (t.due_date && t.due_date <= todayStr) s += 50
        if (t.size === 'XS' || t.size === 'S') s += 20
        // Follow-up signal — capped at +90 total so it tunes the order rather than dominating.
        let followUp = 0
        if (task.routine_id && t.routine_id === task.routine_id) followUp += 40
        if (task.notion_page_id && t.notion_page_id === task.notion_page_id) followUp += 25
        if (Array.isArray(t.tags) && t.tags.length > 0) {
          const sharedTags = t.tags.filter(tag => completedTags.has(tag)).length
          if (sharedTags > 0) followUp += Math.min(60, sharedTags * 30)
        }
        const titleLower = (t.title || '').toLowerCase()
        if (followUpKeywords.some(kw => titleLower.includes(kw))) followUp += 35
        // "After X" / "X follow-up" style — title mentions the completed task's title.
        if (completedTitleLower && completedTitleLower.length > 3 && titleLower.includes(completedTitleLower)) {
          followUp += 50
        }
        s += Math.min(90, followUp)
        return s
      }
      candidates.sort((a, b) => score(b) - score(a))
      const nextTask = candidates[0] || null
      setToast({ ...task, completed_at: new Date().toISOString(), nextTask, stackBonus })
    }
  }, [tasks, routines, completeTask, completeRoutine, updateTask, pushStatusToTrello])

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

  // Keyboard shortcuts hook needs handleComplete + handleSnooze in scope —
  // const declarations don't hoist, so this call lives below the handler
  // definitions. Hook order is stable across renders, which is all React
  // requires.
  const { selectedTaskId, showHelp, setShowHelp } = useKeyboardShortcuts({
    isDesktop,
    visibleTasks,
    onEdit: setEditTarget,
    onComplete: handleComplete,
    onSnooze: handleSnooze,
    openAddModal: useCallback(() => setShowAdd(true), []),
    focusSearch: focusSearchInput,
    activeModals,
    closeTopModal,
  })

  // Sequences PR 2: chain-break confirmation gate. When a task with queued
  // follow-ups is about to be deleted / cancelled / moved to backlog / moved
  // to projects, pop a modal warning that the chain will stop. Completion
  // (`status='done'`) goes through `handleComplete` and ADVANCES the chain
  // — never gated. Going FROM backlog/project back to active is also fine.
  const [chainConfirm, setChainConfirm] = useState(null)
  const gateOnChainBreak = useCallback((task, actionLabel, confirmLabel, proceed) => {
    const len = Array.isArray(task?.follow_ups) ? task.follow_ups.length : 0
    if (len === 0) { proceed(); return }
    setChainConfirm({
      title: 'Stop the follow-up chain?',
      body: `This task has ${len} follow-up step${len === 1 ? '' : 's'} queued. ${actionLabel} will stop the chain — the queued step${len === 1 ? '' : 's'} won't spawn.`,
      confirmLabel,
      onConfirm: () => { setChainConfirm(null); proceed() },
    })
  }, [])

  const handleStatusChange = useCallback((id, newStatus) => {
    if (newStatus === 'done') { handleComplete(id); return }
    const task = tasks.find(t => t.id === id)
    const chainBreaking = ['cancelled', 'backlog', 'project'].includes(newStatus)
    const proceed = () => {
      changeStatus(id, newStatus)
      if (task?.trello_card_id) pushStatusToTrello(task, newStatus)
    }
    if (chainBreaking) {
      gateOnChainBreak(task, `Moving to ${newStatus === 'cancelled' ? 'cancelled' : newStatus}`, 'Stop chain', proceed)
    } else {
      proceed()
    }
  }, [handleComplete, changeStatus, tasks, pushStatusToTrello, gateOnChainBreak])

  const handleBacklog = useCallback((id, toBacklog) => {
    const apply = () => updateTask(id, { status: toBacklog ? 'backlog' : 'not_started', last_touched: new Date().toISOString() })
    if (!toBacklog) { apply(); return }
    const task = tasks.find(t => t.id === id)
    gateOnChainBreak(task, 'Moving to backlog', 'Stop chain & move', apply)
  }, [updateTask, tasks, gateOnChainBreak])

  const handleProject = useCallback((id, toProject) => {
    const apply = () => updateTask(id, { status: toProject ? 'project' : 'not_started', last_touched: new Date().toISOString() })
    if (!toProject) { apply(); return }
    const task = tasks.find(t => t.id === id)
    gateOnChainBreak(task, 'Moving to projects', 'Stop chain & move', apply)
  }, [updateTask, tasks, gateOnChainBreak])

  // Pin a project to the main list (or unpin). Pinning is a visibility
  // toggle only — nags and child-spawn behavior unchanged. The pinned
  // section renders above all the regular sections on the main list.
  const handleUnpinProject = useCallback((id) => {
    setProjectPinned(id, false)
  }, [setProjectPinned])

  // "Add child task" launcher — opens the standard AddTaskModal with the
  // parent_id pre-populated. The modal already handles size/energy inference
  // and routing through the same createTask path; we just append the parent
  // link to the result.
  const [addChildOfProject, setAddChildOfProject] = useState(null)
  const handleAddChildToProject = useCallback((project) => {
    setAddChildOfProject(project)
    setShowAdd(true)
  }, [])

  // "+ New project" launcher — opens AddTaskModal with a flag so the
  // created task lands as status='project' instead of the default
  // 'not_started'. Mutually exclusive with the "Add child" path
  // (parents are tasks, projects are top-level).
  const [createAsProject, setCreateAsProject] = useState(false)
  const handleCreateProject = useCallback(() => {
    setShowProjects(false)
    setCreateAsProject(true)
    setShowAdd(true)
  }, [])

  // Log a project session. Renders a toast with the points awarded, or an
  // explanatory message when capped. Falls back silently to a local-only
  // update if the network is unavailable so the user doesn't lose the tap.
  const handleLogSession = useCallback(async (projectId) => {
    return logProjectSession(projectId)
  }, [logProjectSession])

  const handleConvertToRoutine = useCallback((taskId, { title, cadence, customDays, customUnit, tags, notes }) => {
    // addRoutine signature: (title, cadence, customDays, tags, notes, highPriority,
    //   endDate, scheduleDayOfWeek, followUps, autoRoll, spawnMode, targetCount,
    //   targetPeriod, customUnit). Pass undefined for the middle args we don't
    //   override here so customUnit lands in the right slot.
    const routine = addRoutine(
      title, cadence, customDays, tags, notes,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, customUnit
    )
    updateTask(taskId, { routine_id: routine.id, last_touched: new Date().toISOString() })
    setEditTarget(null)
  }, [addRoutine, updateTask])

  // Wrapper around updateTask used by EditTaskModal. When the user backdates
  // a routine-spawned task's completed_at, sync the matching entry in the
  // parent routine's completed_history so cadence calculations (next due,
  // skip counts) don't drift from the visible task data.
  const handleEditModalSave = useCallback((id, payload) => {
    const existing = tasks.find(t => t.id === id)
    updateTask(id, payload)
    if (
      existing?.routine_id &&
      payload.completed_at &&
      payload.completed_at !== existing.completed_at
    ) {
      adjustRoutineHistory(existing.routine_id, existing.completed_at, payload.completed_at)
    }
  }, [tasks, updateTask, adjustRoutineHistory])

  const handleUncomplete = useCallback((task) => {
    uncompleteTask(task.id)
    setToast({ task, variant: 'reopen' })
    if (task?.trello_card_id) pushStatusToTrello(task, 'not_started')
    // Reopening a routine-spawned task must also drop its completed_history
    // stamp, or the Wallaby grids/streaks keep counting the day as done
    // (phantom). Mirror the stamp logic: ordinary routines stamp on every
    // completion (always remove); stacks stamp only on the last-member clear,
    // so remove only if this task's cycle was fully cleared.
    if (task?.routine_id) {
      const routine = routines.find(r => r.id === task.routine_id)
      const day = localYMD(new Date(task.completed_at || task.due_date || Date.now()))
      const isStack = Array.isArray(routine?.members) && routine.members.length > 0
      if (!isStack) {
        uncompleteRoutine(task.routine_id, day)
      } else {
        const siblings = tasks.filter(t => t.routine_id === task.routine_id && t.due_date === task.due_date)
        if (siblings.every(s => s.status === 'done')) uncompleteRoutine(task.routine_id, day)
      }
    }
  }, [uncompleteTask, pushStatusToTrello, routines, tasks, uncompleteRoutine])

  // Single shortcut into the canonical routine-completion path, shared by the
  // Wallaby and Kept shells. Routes through the real surfaced task so
  // completeRoutine stays the lone completed_history writer (the doubling
  // bug); raw-toggles the stamp only when no concrete task applies (past-day
  // backfill, or today with nothing surfaced).
  const toggleHabitDay = (routine, ymd) => {
    const day = ymd || localYMD(new Date())
    const today = localYMD(new Date())
    const hist = Array.isArray(routine.completed_history) ? routine.completed_history : []
    const onDay = (ts) => localYMD(new Date(ts)) === day
    const rawToggle = () => {
      if (hist.some(onDay)) updateRoutine(routine.id, { completed_history: hist.filter(ts => !onDay(ts)) })
      else updateRoutine(routine.id, { completed_history: [...hist, `${day}T12:00:00.000Z`] })
    }

    // Habit-mode (target frequency), today: each completion is a logged
    // done-task; logHabit stamps history once. Un-log removes today's most-
    // recent log and its stamp. (Past days fall through to rawToggle.)
    if (routine.spawn_mode === 'habit' && day === today) {
      const logs = tasks.filter(t => t.routine_id === routine.id && t.status === 'done'
        && localYMD(new Date(t.completed_at || `${day}T12:00:00.000Z`)) === day)
      if (logs.length) {
        deleteTask(logs[logs.length - 1].id)
        uncompleteRoutine(routine.id, day)
      } else {
        const t = logHabit(routine.id)
        if (t) addSpawnedTasks([t])
      }
      return
    }

    // Auto (cadence) routine, today: complete/reopen the real surfaced task.
    if (day === today && routine.spawn_mode !== 'habit') {
      const todays = tasks.filter(t => t.routine_id === routine.id
        && String(t.due_date || '').slice(0, 10) === day)
      const doneTask = todays.find(t => t.status === 'done')
      if (doneTask) { handleUncomplete(doneTask); return }
      const openTask = todays.find(t => t.status !== 'done')
      if (openTask) { handleComplete(openTask.id); return }
    }

    rawToggle()
  }


  // Archive the Trello card on delete so the next inbound sync doesn't
  // re-import the task. Mirrors v1 handleDelete. Also gated on chain-break
  // — if the task has queued follow-ups, the user gets a confirmation
  // modal before the delete proceeds.
  const handleDelete = useCallback((id) => {
    const task = tasks.find(t => t.id === id)
    const proceed = () => {
      if (task?.trello_card_id) {
        trelloUpdateCard(task.trello_card_id, { closed: true }).catch(() => {})
      }
      deleteTask(id)
    }
    gateOnChainBreak(task, 'Deleting', 'Stop chain & delete', proceed)
  }, [tasks, deleteTask, gateOnChainBreak])

  const handleRestore = useCallback((snapshot) => {
    setTasks(prev => [snapshot, ...prev])
    setShowActivityLog(false)
  }, [setTasks])

  // Sequences PR 3: skip-and-advance handler. Optimistically marks the task
  // cancelled+skipped locally so the card disappears instantly, then calls
  // the dedicated server endpoint which atomically marks it cancelled+
  // skipped and fires spawnNextChainStep. The new spawned task arrives
  // via SSE-triggered hydration. If the server call fails, the optimistic
  // change is reverted on the next /api/data refetch.
  const handleSkipAdvance = useCallback((task) => {
    // Optimistic local update — the server response will overwrite this
    // with the canonical state including any new spawned step.
    updateTask(task.id, {
      status: 'cancelled',
      skipped: true,
      completed_at: new Date().toISOString(),
      last_touched: new Date().toISOString(),
    })
    // Activity log marks this as 'skipped' so DoneList / ActivityLog can
    // distinguish it from a true cancellation in future polish.
    logActivity('skipped', task)
    serverSkipAdvanceTask(task.id).catch(err => {
      console.error('skip-advance failed:', err)
      // On failure, the server stays authoritative — next refetch reverts
      // the optimistic update if the action didn't actually land.
    })
  }, [updateTask])

  // Mirrors v1's add path: create task, kick off AI inference for size/energy
  // when not manually set, and prefetch the completion toast copy. If the
  // user opened the modal via "Add child" on a pinned project, stamp the
  // parent_id + active visibility so the new task surfaces under the
  // project. If the user opened via "+ New project" from ProjectsView,
  // promote the new task to status='project' immediately. Both context
  // flags clear after one use.
  const handleAddTask = useCallback((taskData) => {
    const taskId = addTask(taskData)
    if (addChildOfProject) {
      setTaskParent(taskId, addChildOfProject.id)
      setChildVisibility(taskId, 'active')
      setAddChildOfProject(null)
    }
    if (createAsProject) {
      updateTask(taskId, { status: 'project' })
      setCreateAsProject(false)
    }
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
  }, [addTask, updateTask, prefetchToast, addChildOfProject, setTaskParent, setChildVisibility, createAsProject])

  const renderSection = (label, list, sigil) => {
    if (list.length === 0) return null
    const collapsed = !!collapsedSections[label]
    return (
      <>
        <SectionLabel
          count={list.length}
          sigil={sigil}
          onToggle={() => toggleSection(label)}
          collapsed={collapsed}
        >
          {label}
        </SectionLabel>
        {!collapsed && list.map(t => (
          <TaskCard
            key={t.id}
            task={t}
            expanded={expandedTaskId === t.id}
            onToggleExpand={setExpandedTaskId}
            onComplete={handleComplete}
            onEdit={handleEdit}
            onSnooze={handleSnooze}
            onSkipAdvance={handleSkipAdvance}
            weatherByDate={weather.enabled ? weather.byDate : null}
          />
        ))}
      </>
    )
  }

  return (
    <div className="v2-app">
      <Header
        onOpenAdviser={() => setShowAdviser(true)}
        onOpenPackages={() => setShowPackages(true)}
        onOpenSystemMenu={() => setSystemMenuOpen(o => !o)}
        systemMenuOpen={systemMenuOpen}
        miniRingsData={miniRingsData}
        onOpenAnalytics={() => setShowAnalytics(true)}
        todayCount={todayCount}
        hasDone={hasDone}
        onOpenDone={() => setShowDone(true)}
        syncStatus={syncStatus}
        queueLength={queueLength}
      />
      <SystemMenu
        open={systemMenuOpen}
        onClose={() => setSystemMenuOpen(false)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenAnalytics={() => setShowAnalytics(true)}
        onOpenDone={() => setShowDone(true)}
        onOpenSuggestions={() => setShowSuggestions(true)}
        onOpenActivityLog={() => setShowActivityLog(true)}
      />
      <main className={`v2-main${isDesktop ? ' v2-main-kanban' : ''}`}>
        {(tasks.length > 0 || searchOpen) && (
          <TaskListToolbar
            labels={labels}
            routinesCount={routines.length}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onOpenRoutines={() => setShowRoutines(true)}
            sortBy={sortBy}
            onSortChange={handleSortChange}
            searchMode={searchOpen}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            onOpenSearch={() => setSearchOpen(true)}
            onCloseSearch={handleCloseSearch}
          />
        )}
        {!searchOpen && routineSuggestions?.length > 0 && (
          <div className="v2-routine-suggestions">
            {routineSuggestions.map(s => (
              <div key={s.patternKey} className="v2-routine-suggestion">
                <div className="v2-routine-suggestion-text">
                  Create routine: <strong>{s.title}</strong>
                  <span className="v2-routine-suggestion-cadence">{s.cadence}</span>
                </div>
                <button
                  className="v2-routine-suggestion-accept"
                  onClick={() => {
                    addRoutine(s.title, s.cadence, undefined, [], s.notes)
                    acceptSuggestion(s.patternKey)
                  }}
                >
                  Create
                </button>
                <button
                  className="v2-routine-suggestion-dismiss"
                  onClick={() => dismissSuggestion(s.patternKey)}
                  aria-label="Dismiss suggestion"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Home stats line — renders on both mobile and desktop.
          * Date → WeekStrip. Streak → streak detail. Today → daily detail. */}
        {!searchOpen && (totalActive > 0 || sortedSnoozed.length > 0 || backlogTasks.length > 0 || projectTasks.length > 0) && (
          <>
            <div className="v2-home-stats" aria-hidden="false">
              <button
                type="button"
                className={`v2-thx-date v2-thx-date-toggle${weekStripShown ? ' v2-thx-date-open' : ''}`}
                onClick={() => { setWeekStripShown(v => !v); setStatsDetail(null) }}
                aria-expanded={weekStripShown}
                aria-controls="v2-week-strip-days"
                aria-label={weekStripShown ? 'Hide 7-day strip' : 'Show 7-day strip'}
              >
                📅 {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                <span className="v2-thx-date-chev" aria-hidden="true">{weekStripShown ? '▴' : '▾'}</span>
              </button>
              <span className="v2-thx-sep">·</span>
              <button
                type="button"
                className={`v2-thx-btn v2-thx-streak${statsDetail === 'streak' ? ' v2-thx-btn-active' : ''}`}
                onClick={() => { setStatsDetail(v => v === 'streak' ? null : 'streak'); setWeekStripShown(false) }}
                aria-expanded={statsDetail === 'streak'}
              >
                🔥 {streak} day{streak === 1 ? '' : 's'}
              </button>
              <span className="v2-thx-sep">·</span>
              <button
                type="button"
                className={`v2-thx-btn v2-thx-today${statsDetail === 'today' ? ' v2-thx-btn-active' : ''}`}
                onClick={() => { setStatsDetail(v => v === 'today' ? null : 'today'); setWeekStripShown(false) }}
                aria-expanded={statsDetail === 'today'}
              >
                ✓ {dailyStats.tasksToday}/{settingsForRings.daily_task_goal || 3} today
              </button>
            </div>
            {weekStripShown && (
              <WeekStrip
                tasks={tasks}
                dailyTaskGoal={settingsForRings.daily_task_goal || 3}
                easterEggWins={settingsForRings.easter_egg_wins}
              />
            )}
            {statsDetail === 'streak' && (() => {
              const bestStreak = Math.max(streak, records.longestStreak)
              return (
              <div className="v2-stats-detail">
                <div className="v2-stats-detail-row">
                  <span className="v2-stats-detail-label">Current streak</span>
                  <span className="v2-stats-detail-value">{streak} day{streak === 1 ? '' : 's'}</span>
                </div>
                <div className="v2-stats-detail-row">
                  <span className="v2-stats-detail-label">Best streak</span>
                  <span className="v2-stats-detail-value">{bestStreak} day{bestStreak === 1 ? '' : 's'}</span>
                </div>
                <div className="v2-stats-detail-row">
                  <span className="v2-stats-detail-label">Best day (tasks)</span>
                  <span className="v2-stats-detail-value">{records.bestTasks}</span>
                </div>
                <div className="v2-stats-detail-row">
                  <span className="v2-stats-detail-label">Best day (points)</span>
                  <span className="v2-stats-detail-value">{records.bestPoints}</span>
                </div>
              </div>
              )
            })()}
            {statsDetail === 'today' && (() => {
              const todayStr = new Date().toDateString()
              const now = new Date()
              const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
              const doneTasks = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).toDateString() === todayStr)
              const activeTasks = tasks.filter(t => ['not_started', 'in_progress', 'waiting'].includes(t.status))
              const taskGoal = settingsForRings.daily_task_goal || 3
              const pointsGoal = settingsForRings.daily_points_goal || 15
              const eggWon = !!settingsForRings.easter_egg_wins?.[todayIso]
              return (
                <div className="v2-stats-detail">
                  <div className="v2-stats-detail-row">
                    <span className="v2-stats-detail-label">Tasks done</span>
                    <span className="v2-stats-detail-value">{dailyStats.tasksToday} / {taskGoal}</span>
                  </div>
                  <div className="v2-stats-detail-row">
                    <span className="v2-stats-detail-label">Points earned</span>
                    <span className="v2-stats-detail-value">{dailyStats.pointsToday} / {pointsGoal}</span>
                  </div>
                  <div className="v2-stats-detail-row">
                    <span className="v2-stats-detail-label">Remaining active</span>
                    <span className="v2-stats-detail-value">{activeTasks.length}</span>
                  </div>
                  {(doneTasks.length > 0 || eggWon) && (
                    <div className="v2-stats-detail-done">
                      {eggWon && (
                        <div className="v2-stats-detail-done-item">✓ Daily Bonus</div>
                      )}
                      {doneTasks.map(t => (
                        <div key={t.id} className="v2-stats-detail-done-item">✓ {t.title}</div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}
          </>
        )}
        {searchOpen ? (
          <div className="v2-list">
            {searchResults === null ? (
              <EmptyState
                icon={ListChecks}
                title="Type to search"
                body="Searches every task — active, done, backlog, or project."
              />
            ) : searchResults.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="No matches"
                body={`Nothing matches "${searchQuery}". Try a different keyword.`}
              />
            ) : (
              <>
                <SectionLabel count={searchResults.length}>
                  {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
                </SectionLabel>
                {searchResults.map(t => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    expanded={expandedTaskId === t.id}
                    onToggleExpand={setExpandedTaskId}
                    onComplete={handleComplete}
                    onEdit={handleEdit}
                    onSnooze={handleSnooze}
                    onSkipAdvance={handleSkipAdvance}
                    weatherByDate={weather.enabled ? weather.byDate : null}
                  />
                ))}
              </>
            )}
          </div>
        ) : totalActive === 0 && sortedSnoozed.length === 0 && backlogTasks.length === 0 && projectTasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={activeFilter !== 'all' ? 'No tasks match this filter' : 'Nothing on your plate'}
            body={activeFilter !== 'all' ? 'Tap All above to clear the filter.' : 'No active tasks right now. Tap the + above to add one.'}
            cta={activeFilter !== 'all' ? 'Show all' : 'Add task'}
            ctaOnClick={activeFilter !== 'all' ? () => setActiveFilter('all') : () => setShowAdd(true)}
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
            onSkipAdvance={handleSkipAdvance}
            weatherByDate={weather.enabled ? weather.byDate : null}
            selectedTaskId={selectedTaskId}
          />
        ) : (
          <div className="v2-list">
            <ProjectPinnedSection
              projects={pinnedProjects}
              activeChildren={activeChildrenOfPinned}
              allTasks={tasks}
              expandedTaskId={expandedTaskId}
              onToggleExpand={setExpandedTaskId}
              onLogSession={handleLogSession}
              onUnpin={handleUnpinProject}
              onAddChild={handleAddChildToProject}
              onEditProject={handleEdit}
              onComplete={handleComplete}
              onEdit={handleEdit}
              onSnooze={handleSnooze}
              onSkipAdvance={handleSkipAdvance}
              weatherByDate={weather.enabled ? weather.byDate : null}
              collapsedProjects={collapsedPinnedProjects}
              onToggleCollapse={togglePinnedProjectCollapse}
            />
            <StackSection
              groups={stackGroups}
              expandedTaskId={expandedTaskId}
              onToggleExpand={setExpandedTaskId}
              onComplete={handleComplete}
              onEdit={handleEdit}
              onSnooze={handleSnooze}
              onSkipAdvance={handleSkipAdvance}
              weatherByDate={weather.enabled ? weather.byDate : null}
            />
            {renderSection('Doing', sortedDoing, '→')}
            {renderSection('Stale', sortedStale, '~')}
            {renderSection('Up next', sortedUpNext, '+')}
            {renderSection('Waiting', sortedWaiting, '…')}
            {renderSection('Snoozed', sortedSnoozed, 'z')}
          </div>
        )}
      </main>

      {/* Bottom tab bar — mobile only. Hidden on desktop (which has
       * its own Kanban + side-drawer navigation pattern). The strip
       * itself also has a @media gate as belt-and-suspenders. */}
      {!isDesktop && !isWallaby && !isKept && (
        <BottomTabs
          activeTab={activeTab}
          onTabChange={(next) => {
            if (next === 'today') {
              setActiveTab('today')
              setSpacesHubOpen(false)
            } else if (next === 'spaces') {
              setActiveTab('spaces')
              setSpacesHubOpen(true)
            }
          }}
          onQuickAdd={(title) => addTask({ title })}
          onAddLongPress={() => setShowAdd(true)}
          onWhatNow={() => setShowWhatNow(true)}
        />
      )}

      {/* Wallaby shell — the loggd IA (Home/Habits/Tasks/Timer/More) on mobile.
        * Covers the standard list + header (z below the shared modals, which
        * still open above it). Replaces BottomTabs in Wallaby mode. */}
      {isWallaby && !isDesktop && (
        <WallabyShell
          tasks={tasks}
          routines={routines}
          projects={projectTasks}
          labels={labels}
          dailyStats={dailyStats}
          streak={streak}
          records={records}
          lifetimeDone={tasks.filter(t => t.status === 'done').length}
          onToggleHabit={toggleHabitDay}
          onSpawnStackToday={(routineId) => {
            const spawned = spawnNow(routineId)
            if (spawned && spawned.length) addSpawnedTasks(spawned)
            return spawned
          }}
          onCompleteTask={(task) => task.status === 'done' ? handleUncomplete(task) : handleComplete(task.id)}
          onToggleItem={(task, clId, itemId) => {
            const checklists = (task.checklists || []).map(cl =>
              cl.id !== clId ? cl : { ...cl, items: (cl.items || []).map(it => it.id === itemId ? { ...it, completed: !it.completed } : it) },
            )
            updateTask(task.id, { checklists })
          }}
          onOpenTask={(task) => setEditTarget(task)}
          onAddTask={() => setShowAdd(true)}
          onAddGoal={() => { setCreateAsProject(true); setShowAdd(true) }}
          onRescheduleTask={(task, ymd) => updateTask(task.id, { due_date: ymd })}
          onDeleteTask={(task) => deleteTask(task.id)}
          onAddHabit={() => setShowRoutines(true)}
          onEditHabit={(r) => { setEditRoutineId(r.id); setShowRoutines(true) }}
          onArchiveHabit={(r) => togglePause(r.id)}
          onDeleteHabit={(r) => deleteRoutine(r.id)}
          onLogSession={(p) => logProjectSession(p.id)}
          onCompleteProject={(p) => handleComplete(p.id)}
          onEditProject={(p) => setEditTarget(p)}
          onSetAsideProject={(p) => updateTask(p.id, { status: 'backlog' })}
          onDeleteProject={(p) => deleteTask(p.id)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenPackages={() => setShowPackages(true)}
          onOpenAnalytics={() => setShowAnalytics(true)}
          adviser={adviserState}
          onOpenEasterEgg={openEasterEgg}
          syncStatus={syncStatus}
          queueLength={queueLength}
        />
      )}

      {/* Kept shell — the Boomerang IA (Today/Loops/Throw/Tasks/More) on
        * mobile. Shares every handler with the Wallaby shell; Quokka lives in
        * the Kept header. Desktop keeps the standard layout until K5. */}
      {isKept && !isDesktop && (
        <KeptShell
          tasks={tasks}
          routines={routines}
          labels={labels}
          dailyStats={dailyStats}
          pointsGoal={settingsForRings.daily_points_goal || 15}
          streak={streak}
          onCompleteTask={(task) => task.status === 'done' ? handleUncomplete(task) : handleComplete(task.id)}
          onOpenTask={(task) => setEditTarget(task)}
          onToggleHabit={toggleHabitDay}
          onRescheduleTask={(task, ymd) => updateTask(task.id, { due_date: ymd })}
          onDeleteTask={(task) => handleDelete(task.id)}
          onThrow={({ title, dueDate }) => handleAddTask({ title, dueDate })}
          onOpenFullAdd={() => setShowAdd(true)}
          onEditLoop={(r) => { setEditRoutineId(r.id); setShowRoutines(true) }}
          onAddLoop={() => setShowRoutines(true)}
          onOpenQuokka={() => setShowAdviser(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenPackages={() => setShowPackages(true)}
          onOpenAnalytics={() => setShowAnalytics(true)}
          onOpenProjects={() => setShowProjects(true)}
          onOpenDone={() => setShowDone(true)}
          onOpenActivity={() => setShowActivityLog(true)}
          onOpenSuggestions={() => setShowSuggestions(true)}
          syncStatus={syncStatus}
          queueLength={queueLength}
        />
      )}

      {/* Kept desktop command center (K5 v1) — sidebar + work surface over
        * the shared Kept views; cmd-K Throw. Covers the standard layout the
        * same way the mobile shells do; modals open above it. */}
      {isKept && isDesktop && (
        <KeptDesktop
          tasks={tasks}
          routines={routines}
          labels={labels}
          dailyStats={dailyStats}
          pointsGoal={settingsForRings.daily_points_goal || 15}
          streak={streak}
          onCompleteTask={(task) => task.status === 'done' ? handleUncomplete(task) : handleComplete(task.id)}
          onOpenTask={(task) => setEditTarget(task)}
          onToggleHabit={toggleHabitDay}
          onRescheduleTask={(task, ymd) => updateTask(task.id, { due_date: ymd })}
          onDeleteTask={(task) => handleDelete(task.id)}
          onThrow={({ title, dueDate }) => handleAddTask({ title, dueDate })}
          onOpenFullAdd={() => setShowAdd(true)}
          onEditLoop={(r) => { setEditRoutineId(r.id); setShowRoutines(true) }}
          onAddLoop={() => setShowRoutines(true)}
          onOpenQuokka={() => setShowAdviser(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenPackages={() => setShowPackages(true)}
          onOpenAnalytics={() => setShowAnalytics(true)}
          onOpenProjects={() => setShowProjects(true)}
          onOpenDone={() => setShowDone(true)}
          onOpenActivity={() => setShowActivityLog(true)}
          syncStatus={syncStatus}
          queueLength={queueLength}
        />
      )}

      {/* Spaces hub — picker for Projects / Routines / Knowledge. Each
       * row launches the existing dedicated modal and resets activeTab
       * to 'today' on that sub-modal close, so the tab indicator never
       * lies about where the user is after the hub itself dismisses. */}
      <SpacesHub
        open={spacesHubOpen}
        onClose={() => {
          setSpacesHubOpen(false)
          // X-out of the hub returns to Today.
          setActiveTab('today')
        }}
        onOpenProjects={() => setShowProjects(true)}
        onOpenRoutines={() => setShowRoutines(true)}
        onOpenKnowledge={() => {
          setAdviserDraftSeed("What's in my knowledge base?")
          setShowAdviser(true)
        }}
      />
      {snoozeTarget && (
        <SnoozeModal
          task={snoozeTarget}
          onSnooze={snoozeTask}
          onUnsnooze={unsnoozeTask}
          onClose={() => setSnoozeTarget(null)}
        />
      )}

      <AddTaskModal
        open={showAdd}
        onAdd={handleAddTask}
        onClose={() => { setShowAdd(false); setAddChildOfProject(null); setCreateAsProject(false) }}
        parentProject={addChildOfProject}
        createAsProject={createAsProject}
      />

      {editTarget && useWallabyEditor && (
        <WallabyEditTask
          task={liveEditTarget}
          onSave={handleEditModalSave}
          onClose={() => setEditTarget(null)}
          onDelete={(id) => { handleDelete(id); setEditTarget(null) }}
          onStatusChange={handleStatusChange}
          onOpenFull={() => setEditFull(true)}
        />
      )}

      {editTarget && !useWallabyEditor && (
        <EditTaskModal
          task={liveEditTarget}
          onSave={handleEditModalSave}
          onClose={() => setEditTarget(null)}
          onDelete={(id) => { handleDelete(id); setEditTarget(null) }}
          onBacklog={handleBacklog}
          onProject={handleProject}
          onStatusChange={handleStatusChange}
          onConvertToRoutine={handleConvertToRoutine}
          weather={weather}
          projects={tasks.filter(t => t.status === 'project')}
          childTasks={tasks.filter(t => t.parent_id === liveEditTarget.id)}
          siblingSubs={liveEditTarget.parent_id
            ? tasks.filter(t => t.parent_id === liveEditTarget.parent_id && t.id !== liveEditTarget.id)
            : []}
          onLogSession={handleLogSession}
          onAddChild={(project) => {
            setEditTarget(null)
            handleAddChildToProject(project)
          }}
          onOpenTask={(otherTask) => setEditTarget(otherTask)}
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

      <MarkdownImportModal
        open={showMarkdownImport}
        onClose={() => setShowMarkdownImport(false)}
        onImport={(tasks) => {
          for (const t of tasks) addTask({ title: t.title })
        }}
      />

      <ModalShell open={showHelp} onClose={() => setShowHelp(false)} title="Keyboard shortcuts" width="narrow">
        <ul className="v2-shortcut-list">
          {[
            { keys: ['n'], desc: 'New task' },
            { keys: ['/'], desc: 'Search tasks' },
            { keys: ['j', '↓'], desc: 'Next task' },
            { keys: ['k', '↑'], desc: 'Previous task' },
            { keys: ['Enter', 'e'], desc: 'Edit selected task' },
            { keys: ['x'], desc: 'Complete selected task' },
            { keys: ['s'], desc: 'Snooze selected task' },
            { keys: ['Esc'], desc: 'Close modal or clear selection' },
            { keys: ['?'], desc: 'Toggle this help' },
          ].map(s => (
            <li key={s.desc} className="v2-shortcut-row">
              <span className="v2-shortcut-keys">
                {s.keys.map((k, i) => (
                  <span key={i}>
                    <kbd className="v2-shortcut-kbd">{k}</kbd>
                    {i < s.keys.length - 1 && <span className="v2-shortcut-sep">or</span>}
                  </span>
                ))}
              </span>
              <span className="v2-shortcut-desc">{s.desc}</span>
            </li>
          ))}
        </ul>
      </ModalShell>

      <SettingsModal
        open={showSettings}
        onClose={() => { setShowSettings(false); setLabels(loadLabels()); flushSync() }}
        onFlush={flushSync}
        onClearCompleted={() => { clearCompleted(); setShowSettings(false); flushSync() }}
        onClearAll={() => { clearAll(); setShowSettings(false); flushSync() }}
        onShowActivityLog={() => setShowActivityLog(true)}
        onShowMarkdownImport={() => setShowMarkdownImport(true)}
        onOpenEasterEgg={openEasterEgg}
        onTrelloSync={syncTrello}
        trelloSyncing={trelloSyncing}
        onNotionSync={syncNotion}
        notionSyncing={notionSyncing}
        onGCalSync={syncGCal}
        gcalSyncing={gcalSyncing}
      />
      <ProjectsView
        open={showProjects}
        tasks={tasks}
        onClose={() => setShowProjects(false)}
        onComplete={handleComplete}
        onEdit={handleEdit}
        onSnooze={handleSnooze}
        weatherByDate={weather.enabled ? weather.byDate : null}
        onTogglePin={(id, pinned) => setProjectPinned(id, pinned)}
        onAddChild={(project) => { setShowProjects(false); handleAddChildToProject(project) }}
        onSetChildVisibility={setChildVisibility}
        onCreateProject={handleCreateProject}
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
        tasks={tasks}
        onAdd={addRoutine}
        onDelete={deleteRoutine}
        onTogglePause={togglePause}
        onUpdate={updateRoutine}
        onSpawnNow={(routineId) => {
          // Guard at the call site: if an instance of this routine is still
          // active on the list, refuse the spawn. Stops the "tap 10 times,
          // get 10 duplicates" footgun the user hit.
          const hasActive = tasks.some(t =>
            t.routine_id === routineId &&
            !['done', 'completed', 'cancelled'].includes(t.status)
          )
          if (hasActive) return null
          const spawned = spawnNow(routineId)
          if (spawned.length) addSpawnedTasks(spawned)
          return spawned
        }}
        onLogHabit={(routineId) => {
          const task = logHabit(routineId)
          if (task) addSpawnedTasks([task])
          return task
        }}
        activeRoutineIds={activeRoutineIds}
        onSkipCycle={skipCycle}
        onClose={() => { setShowRoutines(false); setEditRoutineId(null) }}
        editRoutineId={editRoutineId}
        onClearEditRoutineId={() => setEditRoutineId(null)}
      />

      <SuggestionsModal
        open={showSuggestions}
        onClose={() => setShowSuggestions(false)}
        onAccepted={() => {
          // Routine was just created server-side — refresh the local routines
          // cache on next SSE poke (handled by useServerSync), or fall back
          // to a manual flush. The user will see the new routine on the
          // Routines screen.
        }}
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
        onClose={() => { setShowAdviser(false); setAdviserDraftSeed('') }}
        onOpenEasterEgg={openEasterEgg}
        draftSeed={adviserDraftSeed}
      />

      <TicTacToe
        open={tttOpen}
        onClose={() => setTttOpen(false)}
        onPointEarned={flushSync}
      />

      <AnalyticsModal
        open={showAnalytics}
        onClose={() => setShowAnalytics(false)}
        tasks={tasks}
        routines={routines}
        records={records}
        streak={streak}
      />

      {isDesktop && !isKept && (
        <FloatingCapture
          onAddTask={(title) => {
            const id = addTask({ title })
            if (id) {
              // Quick-add lands a task with the configured default due-date,
              // M size, and the size-auto-infer hook will refine energy on
              // the next render tick. No EditTaskModal opens — the user is
              // doing rapid-fire capture, not careful curation.
            }
          }}
          onOpenWhatNow={() => setShowWhatNow(true)}
        />
      )}

      <ConfirmDialog
        open={!!chainConfirm}
        title={chainConfirm?.title || ''}
        body={chainConfirm?.body || ''}
        confirmLabel={chainConfirm?.confirmLabel || 'Confirm'}
        cancelLabel="Keep task"
        tone="danger"
        onConfirm={() => chainConfirm?.onConfirm?.()}
        onCancel={() => setChainConfirm(null)}
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

      {updateVersion && (
        <div className="v2-update-overlay">
          <div className="v2-update-modal">
            <div className="v2-update-title">Update available</div>
            <div className="v2-update-version">{/^\d/.test(updateVersion) ? `v${updateVersion}` : updateVersion}</div>
            <div className="v2-update-sub">Refreshing automatically…</div>
            <button
              className="v2-update-reload"
              onClick={() => {
                if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(regs => { for (const r of regs) r.unregister() })
                window.location.reload()
              }}
            >
              Reload now
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
