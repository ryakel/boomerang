import { useEffect, useState } from 'react'
import { Timer, Package, BookOpen, Smile, Settings, BarChart3, FolderKanban, User, ChevronRight, ArrowLeft } from 'lucide-react'
import HomeView from './HomeView'
import HabitsView from './HabitsView'
import TasksView from './TasksView'
import ProfileView from './ProfileView'
import GoalsView from './GoalsView'
import NotificationsView from './NotificationsView'
import WallabyNav from './WallabyNav'
import WallabyHeader from './WallabyHeader'
import './WallabyShell.css'

// Wallaby shell — the loggd IA. Full-screen container shown in Wallaby mode on
// mobile: a bottom nav (Home/Habits/Tasks/Timer/More) over the active surface.
// "More" opens secondary surfaces (Profile, Goals) and deferred-feature
// placeholders (Timer, Vision, Daily) — those features land after the reskin.
export default function WallabyShell({
  tasks = [], routines = [], projects = [], labels = [],
  dailyStats = {}, streak = 0, records = {}, lifetimeDone = 0,
  onToggleHabit, onCompleteTask, onToggleItem, onOpenTask, onAddTask, onAddHabit,
  onRescheduleTask, onDeleteTask,
  onEditHabit, onArchiveHabit, onDeleteHabit,
  onLogSession, onCompleteProject, onEditProject, onSetAsideProject, onDeleteProject,
  onOpenSettings, onOpenAdviser, onOpenPackages, onOpenAnalytics,
  syncStatus = 'synced', queueLength = 0,
}) {
  const [tab, setTab] = useState('home')
  const [sub, setSub] = useState(null) // 'profile' | 'goals' | 'notifications' | null

  // Notifications center reads the existing notification_log (reskin — no new
  // data). Mark-all-read is optimistic client-side for now; reliable read
  // persistence is part of the backend notifications fix.
  const [notifEntries, setNotifEntries] = useState([])
  useEffect(() => {
    fetch('/api/notifications/log?limit=200')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.entries) setNotifEntries(d.entries) })
      .catch(() => {})
  }, [])
  const unread = notifEntries.filter(e => !e.tapped_at).length
  const markAllRead = () => {
    const now = new Date().toISOString()
    setNotifEntries(prev => prev.map(e => e.tapped_at ? e : { ...e, tapped_at: now }))
  }

  let surface
  if (sub === 'profile') {
    surface = (
      <ProfileView
        dailyStats={dailyStats} streak={streak} records={records}
        lifetimeDone={lifetimeDone} routines={routines}
        onClose={() => setSub(null)}
      />
    )
  } else if (sub === 'goals') {
    surface = (
      <GoalsView
        projects={projects} tasks={tasks} labels={labels}
        onLogSession={onLogSession} onComplete={onCompleteProject} onEdit={onEditProject}
        onSetAside={onSetAsideProject} onDelete={onDeleteProject} onAdd={onAddTask}
        onClose={() => setSub(null)}
      />
    )
  } else if (sub === 'notifications') {
    surface = <NotificationsView entries={notifEntries} onMarkAllRead={markAllRead} onClose={() => setSub(null)} />
  } else if (tab === 'home') {
    surface = (
      <HomeView
        routines={routines} tasks={tasks} labels={labels}
        onToggleHabit={onToggleHabit} onCompleteTask={onCompleteTask} onOpenTask={onOpenTask}
      />
    )
  } else if (tab === 'habits') {
    surface = (
      <HabitsView
        routines={routines}
        onAdd={onAddHabit}
        onEditHabit={onEditHabit}
        onArchiveHabit={onArchiveHabit}
        onDeleteHabit={onDeleteHabit}
      />
    )
  } else if (tab === 'tasks') {
    surface = (
      <TasksView
        tasks={tasks} labels={labels}
        onToggleComplete={onCompleteTask} onToggleItem={onToggleItem}
        onOpenTask={onOpenTask} onAdd={onAddTask}
        onReschedule={onRescheduleTask} onDelete={onDeleteTask}
      />
    )
  } else if (sub === 'timer') {
    surface = <Placeholder icon={<Timer size={34} strokeWidth={1.75} />} title="Timer" body="Focus timer is coming after the reskin." onClose={() => setSub(null)} />
  } else {
    surface = (
      <MoreMenu
        onOpenProfile={() => setSub('profile')}
        onOpenGoals={() => setSub('goals')}
        onOpenAnalytics={onOpenAnalytics}
        onOpenTimer={() => setSub('timer')}
        onOpenPackages={onOpenPackages}
        onOpenSettings={onOpenSettings}
      />
    )
  }

  return (
    <div className="wb-shell">
      <WallabyHeader
        unread={unread}
        onBell={() => setSub('notifications')}
        onAvatar={() => setSub('profile')}
        syncStatus={syncStatus}
        queueLength={queueLength}
      />
      <div className="wb-shell-surface">{surface}</div>
      <WallabyNav
        active={sub ? '' : tab}
        onChange={(t) => { setSub(null); setTab(t) }}
        onQuokka={onOpenAdviser}
      />
    </div>
  )
}

function MoreMenu({ onOpenProfile, onOpenGoals, onOpenAnalytics, onOpenTimer, onOpenPackages, onOpenSettings }) {
  const rows = [
    { key: 'profile', icon: User, label: 'Profile', sub: 'Stats + your activity year', onClick: onOpenProfile },
    { key: 'goals', icon: FolderKanban, label: 'Goals', sub: 'Projects · progress + sessions', onClick: onOpenGoals },
    { key: 'analytics', icon: BarChart3, label: 'Analytics', sub: 'Productivity insights', onClick: onOpenAnalytics },
    { key: 'packages', icon: Package, label: 'Packages', sub: 'Track deliveries', onClick: onOpenPackages },
    { key: 'timer', icon: Timer, label: 'Timer', sub: 'Focus sessions', onClick: onOpenTimer },
    { key: 'vision', icon: BookOpen, label: 'Vision', sub: 'Coming soon', soon: true },
    { key: 'daily', icon: Smile, label: 'Daily check-in', sub: 'Coming soon', soon: true },
    { key: 'settings', icon: Settings, label: 'Settings', sub: 'App configuration', onClick: onOpenSettings },
  ]
  return (
    <div className="wb-more">
      <h1 className="wb-more-title">More</h1>
      <div className="wb-more-list">
        {rows.map(r => {
          const Icon = r.icon
          return (
            <button
              key={r.key}
              className={`wb-more-row${r.soon ? ' is-soon' : ''}`}
              onClick={() => !r.soon && r.onClick?.()}
              disabled={r.soon}
            >
              <span className="wb-more-icon"><Icon size={20} strokeWidth={1.9} /></span>
              <span className="wb-more-text">
                <span className="wb-more-label">{r.label}</span>
                <span className="wb-more-sub">{r.sub}</span>
              </span>
              {!r.soon && <ChevronRight size={18} strokeWidth={1.75} className="wb-more-chev" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Placeholder({ icon, title, body, onClose }) {
  return (
    <div className="wb-placeholder">
      {onClose && (
        <button className="wb-back wb-placeholder-back" onClick={onClose} aria-label="Back"><ArrowLeft size={20} strokeWidth={2.25} /></button>
      )}
      <span className="wb-placeholder-icon">{icon}</span>
      <h2 className="wb-placeholder-title">{title}</h2>
      <p className="wb-placeholder-body">{body}</p>
    </div>
  )
}
