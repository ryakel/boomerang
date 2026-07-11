import { useEffect, useState } from 'react'
import {
  Home, ListTodo, Repeat2, FolderKanban, BarChart3, Package, Settings,
  Sparkles, Plus, CheckCircle2, ScrollText, Inbox, Compass, Bell, TrendingUp, Sprout,
} from 'lucide-react'
import Logo from '../components/Logo'
import { useSyncBounce } from '../hooks/useSyncBounce'
import TodayView from './TodayView'
import TasksViewKept from './TasksViewKept'
import LoopsView from './LoopsView'
import ThrowSheet from './ThrowSheet'
import TodayRail from './TodayRail'
import './shell.css'
import './desktop.css'

// Kept desktop command center (spec §7) — v1: persistent sidebar nav over the
// shared Kept surfaces, ⌘K Throw. The Today rail + Board/Timeline view modes
// are the K5 continuation; Kanban remains available via the standard themes.
export default function KeptDesktop({
  tasks = [], routines = [], labels = [], weatherByDate = null,
  dailyStats = {}, pointsGoal = 15, streak = 0,
  onCompleteTask, onOpenTask, onToggleHabit, onRescheduleTask, onDeleteTask,
  onLogSession, onGmailKeep, onGmailDismiss, onWhatNow, onToggleItem, onUnsnooze,
  onThrow, onOpenFullAdd, onEditLoop, onAddLoop, onSpawnNow, onSkipCycle, onMarkLoopDay, onSkipLoopDay,
  onOpenQuokka, onOpenSettings, onOpenPackages, onOpenAnalytics,
  onOpenProjects, onOpenDone, onOpenActivity, onOpenSuggestions, onOpenGrowthAreas,
  onOpenNotifications, onOpenFlightLog, onStatusChange,
  syncStatus = 'synced', queueLength = 0,
}) {
  const [tab, setTab] = useState('today')
  const syncVisualState = useSyncBounce(syncStatus, queueLength)
  const [throwOpen, setThrowOpen] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setThrowOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navMain = [
    { id: 'today', label: 'Today', icon: Home },
    { id: 'tasks', label: 'Tasks', icon: ListTodo },
    { id: 'loops', label: 'Loops', icon: Repeat2 },
  ]
  const navReview = [
    { label: 'Flight log', icon: TrendingUp, onClick: onOpenFlightLog },
    { label: 'Notifications', icon: Bell, onClick: onOpenNotifications },
    { label: 'Arcs', icon: FolderKanban, onClick: onOpenProjects },
    { label: 'Caught', icon: CheckCircle2, onClick: onOpenDone },
    { label: 'Analytics', icon: BarChart3, onClick: onOpenAnalytics },
    { label: 'Packages', icon: Package, onClick: onOpenPackages },
    { label: 'Loop suggestions', icon: Inbox, onClick: onOpenSuggestions },
    { label: 'Growth areas', icon: Sprout, onClick: onOpenGrowthAreas },
    { label: 'Activity log', icon: ScrollText, onClick: onOpenActivity },
  ]

  let surface
  if (tab === 'tasks') {
    surface = (
      <TasksViewKept
        tasks={tasks} labels={labels}
        routines={routines} weatherByDate={weatherByDate}
        onToggleComplete={onCompleteTask} onToggleItem={onToggleItem} onOpenTask={onOpenTask}
        onDelete={onDeleteTask} onReschedule={onRescheduleTask} onUnsnooze={onUnsnooze}
        boardable onStatusChange={onStatusChange}
      />
    )
  } else if (tab === 'loops') {
    surface = <LoopsView routines={routines} tasks={tasks} onEditLoop={onEditLoop} onAddLoop={onAddLoop} onSpawnNow={onSpawnNow} onSkipCycle={onSkipCycle} onMarkLoopDay={onMarkLoopDay} onSkipLoopDay={onSkipLoopDay} onOpenSuggestions={onOpenSuggestions} />
  } else {
    surface = (
      <TodayView
        tasks={tasks} routines={routines} labels={labels} weatherByDate={weatherByDate}
        dailyStats={dailyStats} pointsGoal={pointsGoal} streak={streak}
        onCompleteTask={onCompleteTask} onOpenTask={onOpenTask} onToggleHabit={onToggleHabit}
        onDeleteTask={onDeleteTask} onEditLoop={onEditLoop}
        onLogSession={onLogSession} onGmailKeep={onGmailKeep} onGmailDismiss={onGmailDismiss}
        onWhatNow={onWhatNow}
      />
    )
  }

  return (
    <div className="bm-desktop bm-desktop-sheets">
      <aside className="bm-side">
        <div className="bm-side-brand">
          <Logo size={22} />
          <span className="v2-header-wordmark bm-header-mark" data-sync-state={syncVisualState}>
            {'boomerang.'.split('').map((ch, i) => (
              <span key={i} className="v2-header-wordmark-letter" style={{ '--letter-index': i }}>{ch}</span>
            ))}
          </span>
        </div>
        <button className="bm-side-throw" onClick={() => setThrowOpen(true)}>
          <Plus size={15} strokeWidth={2.4} /> Throw a task <kbd>⌘K</kbd>
        </button>
        <button className="bm-side-item" onClick={onWhatNow}>
          <Compass size={17} strokeWidth={2} /> What now?
        </button>
        {navMain.map(t => {
          const Icon = t.icon
          return (
            <button key={t.id} className={`bm-side-item${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon size={17} strokeWidth={2} /> {t.label}
            </button>
          )
        })}
        <div className="bm-side-sec">Review</div>
        {navReview.map(t => {
          const Icon = t.icon
          return (
            <button key={t.label} className="bm-side-item" onClick={t.onClick}>
              <Icon size={17} strokeWidth={2} /> {t.label}
            </button>
          )
        })}
        <div className="bm-side-spacer" />
        <button className="bm-side-quokka" onClick={onOpenQuokka}>
          <Sparkles size={18} strokeWidth={2} style={{ color: 'var(--bm-ember)', flex: '0 0 auto' }} />
          <span><b>Quokka</b><span>ask anything, change anything</span></span>
        </button>
        <button className="bm-side-item" onClick={onOpenSettings}>
          <Settings size={17} strokeWidth={2} /> Settings
        </button>
      </aside>
      <main className="bm-main">{surface}</main>
      {tab !== 'today' && (
        <TodayRail
          tasks={tasks} routines={routines}
          dailyStats={dailyStats} pointsGoal={pointsGoal} streak={streak}
          onCompleteTask={onCompleteTask} onOpenTask={onOpenTask} onWhatNow={onWhatNow}
        />
      )}
      <ThrowSheet
        open={throwOpen}
        onClose={() => setThrowOpen(false)}
        onThrow={onThrow}
        onMoreOptions={onOpenFullAdd}
      />
    </div>
  )
}
