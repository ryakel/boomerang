import { useState } from 'react'
import KeptHeader from './KeptHeader'
import KeptNav from './KeptNav'
import TodayView from './TodayView'
import LoopsView from './LoopsView'
import TasksViewKept from './TasksViewKept'
import MoreView from './MoreView'
import ThrowSheet from './ThrowSheet'
import './shell.css'

// Kept shell — the Boomerang IA on mobile (spec §6): KeptHeader · active
// surface · 4-tab nav with the center Throw button. Owns navigation + sheet
// state; data and mutation handlers come from AppV2 (shared hooks). Quokka
// lives in the header, not the nav.
export default function KeptShell({
  tasks = [], routines = [], labels = [],
  dailyStats = {}, pointsGoal = 15, streak = 0,
  onCompleteTask, onOpenTask, onToggleHabit, onRescheduleTask, onDeleteTask, onSpawnStackToday,
  onThrow, onOpenFullAdd, onEditLoop, onAddLoop,
  onOpenQuokka, onOpenSettings, onOpenPackages, onOpenAnalytics,
  onOpenProjects, onOpenDone, onOpenActivity, onOpenSuggestions,
  syncStatus = 'synced', queueLength = 0,
}) {
  const [tab, setTab] = useState('today')
  const [throwOpen, setThrowOpen] = useState(false)

  let surface
  if (tab === 'loops') {
    surface = <LoopsView routines={routines} onEditLoop={onEditLoop} onAddLoop={onAddLoop} />
  } else if (tab === 'tasks') {
    surface = (
      <TasksViewKept
        tasks={tasks} labels={labels}
        onToggleComplete={onCompleteTask} onOpenTask={onOpenTask}
        onDelete={onDeleteTask} onReschedule={onRescheduleTask}
      />
    )
  } else if (tab === 'more') {
    surface = (
      <MoreView
        onOpenProjects={onOpenProjects} onOpenAnalytics={onOpenAnalytics}
        onOpenPackages={onOpenPackages} onOpenDone={onOpenDone}
        onOpenActivity={onOpenActivity} onOpenSuggestions={onOpenSuggestions}
        onOpenSettings={onOpenSettings}
      />
    )
  } else {
    surface = (
      <TodayView
        tasks={tasks} routines={routines} labels={labels}
        dailyStats={dailyStats} pointsGoal={pointsGoal} streak={streak}
        onCompleteTask={onCompleteTask} onOpenTask={onOpenTask} onToggleHabit={onToggleHabit}
        onDeleteTask={onDeleteTask} onEditLoop={onEditLoop} onSpawnStackToday={onSpawnStackToday}
      />
    )
  }

  return (
    <div className="bm-shell">
      <KeptHeader
        onQuokka={onOpenQuokka}
        onBell={onOpenActivity}
        onAvatar={onOpenAnalytics}
        syncStatus={syncStatus}
        queueLength={queueLength}
      />
      <div className="bm-shell-surface">{surface}</div>
      <KeptNav active={tab} onChange={setTab} onThrow={() => setThrowOpen(true)} />
      <ThrowSheet
        open={throwOpen}
        onClose={() => setThrowOpen(false)}
        onThrow={onThrow}
        onMoreOptions={onOpenFullAdd}
      />
    </div>
  )
}
