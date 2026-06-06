import { useState } from 'react'
import { Timer, BookOpen, Smile, Settings, FolderKanban, User, ChevronRight } from 'lucide-react'
import HomeView from './HomeView'
import HabitsView from './HabitsView'
import TasksView from './TasksView'
import ProfileView from './ProfileView'
import GoalsView from './GoalsView'
import WallabyNav from './WallabyNav'
import './WallabyShell.css'

// Wallaby shell — the loggd IA. Full-screen container shown in Wallaby mode on
// mobile: a bottom nav (Home/Habits/Tasks/Timer/More) over the active surface.
// "More" opens secondary surfaces (Profile, Goals) and deferred-feature
// placeholders (Timer, Vision, Daily) — those features land after the reskin.
export default function WallabyShell({
  tasks = [], routines = [], projects = [], labels = [],
  dailyStats = {}, streak = 0, records = {}, lifetimeDone = 0,
  onToggleHabit, onCompleteTask, onToggleItem, onOpenTask, onAddTask, onAddHabit,
  onEditHabit, onArchiveHabit, onDeleteHabit,
  onLogSession, onCompleteProject, onEditProject, onSetAsideProject, onDeleteProject,
  onOpenSettings,
}) {
  const [tab, setTab] = useState('home')
  const [sub, setSub] = useState(null) // 'profile' | 'goals' | null

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
  } else if (tab === 'home') {
    surface = <HomeView routines={routines} onToggleHabit={onToggleHabit} onOpenProfile={() => setSub('profile')} />
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
      />
    )
  } else if (tab === 'timer') {
    surface = <Placeholder icon={<Timer size={34} strokeWidth={1.75} />} title="Timer" body="Focus timer is coming after the reskin." />
  } else {
    surface = <MoreMenu onOpenProfile={() => setSub('profile')} onOpenGoals={() => setSub('goals')} onOpenSettings={onOpenSettings} />
  }

  return (
    <div className="wb-shell">
      <div className="wb-shell-surface">{surface}</div>
      <WallabyNav
        active={sub ? '' : tab}
        onChange={(t) => { setSub(null); setTab(t) }}
      />
    </div>
  )
}

function MoreMenu({ onOpenProfile, onOpenGoals, onOpenSettings }) {
  const rows = [
    { key: 'profile', icon: User, label: 'Profile', sub: 'Stats + your activity year', onClick: onOpenProfile },
    { key: 'goals', icon: FolderKanban, label: 'Goals', sub: 'Projects · progress + sessions', onClick: onOpenGoals },
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

function Placeholder({ icon, title, body }) {
  return (
    <div className="wb-placeholder">
      <span className="wb-placeholder-icon">{icon}</span>
      <h2 className="wb-placeholder-title">{title}</h2>
      <p className="wb-placeholder-body">{body}</p>
    </div>
  )
}
