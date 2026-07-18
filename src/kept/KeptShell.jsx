import { useState } from 'react'
import KeptHeader from './KeptHeader'
import KeptNav from './KeptNav'
import PullToRefresh from './PullToRefresh'
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
  tasks = [], routines = [], labels = [], weatherByDate = null,
  dailyStats = {}, pointsGoal = 15, streak = 0,
  onCompleteTask, onOpenTask, onToggleHabit, onRescheduleTask, onDeleteTask,
  onLogSession, onGmailKeep, onGmailDismiss, onWhatNow, onToggleItem, onUnsnooze,
  onCycleImpact,
  onThrow, onThrowNote, onOpenFullAdd, onEditLoop, onAddLoop, onSpawnNow, onSkipCycle, onMarkLoopDay, onSkipLoopDay,
  onOpenQuokka, onOpenSettings, onOpenPackages, onOpenAnalytics,
  onOpenProjects, onOpenDone, onOpenActivity, onOpenSuggestions, onOpenNotifications,
  onOpenGrowthAreas, onOpenNotes,
  pinnedNotes = [], onUnpinNote,
  onRefresh,
  syncStatus = 'synced', queueLength = 0,
}) {
  const [tab, setTab] = useState('today')
  const [throwOpen, setThrowOpen] = useState(false)

  let surface
  if (tab === 'loops') {
    surface = <LoopsView routines={routines} tasks={tasks} onEditLoop={onEditLoop} onAddLoop={onAddLoop} onSpawnNow={onSpawnNow} onSkipCycle={onSkipCycle} onMarkLoopDay={onMarkLoopDay} onSkipLoopDay={onSkipLoopDay} onOpenSuggestions={onOpenSuggestions} />
  } else if (tab === 'tasks') {
    surface = (
      <TasksViewKept
        tasks={tasks} labels={labels}
        routines={routines} weatherByDate={weatherByDate}
        onToggleComplete={onCompleteTask} onToggleItem={onToggleItem} onOpenTask={onOpenTask}
        onDelete={onDeleteTask} onReschedule={onRescheduleTask} onUnsnooze={onUnsnooze}
        onCycleImpact={onCycleImpact}
      />
    )
  } else if (tab === 'more') {
    surface = (
      <MoreView
        onOpenProjects={onOpenProjects} onOpenAnalytics={onOpenAnalytics}
        onOpenPackages={onOpenPackages} onOpenDone={onOpenDone}
        onOpenActivity={onOpenActivity}
        onOpenSettings={onOpenSettings}
        onOpenGrowthAreas={onOpenGrowthAreas}
        onOpenNotes={onOpenNotes}
        onWhatNow={onWhatNow}
      />
    )
  } else {
    surface = (
      <TodayView
        tasks={tasks} routines={routines} labels={labels} weatherByDate={weatherByDate}
        dailyStats={dailyStats} pointsGoal={pointsGoal} streak={streak}
        onCompleteTask={onCompleteTask} onOpenTask={onOpenTask} onToggleHabit={onToggleHabit}
        onDeleteTask={onDeleteTask} onEditLoop={onEditLoop}
        onLogSession={onLogSession} onGmailKeep={onGmailKeep} onGmailDismiss={onGmailDismiss}
        onWhatNow={onWhatNow}
        onCycleImpact={onCycleImpact}
        pinnedNotes={pinnedNotes} onOpenNotes={onOpenNotes} onUnpinNote={onUnpinNote}
      />
    )
  }

  return (
    <div className="bm-shell">
      <KeptHeader
        onQuokka={onOpenQuokka}
        onBell={onOpenNotifications || onOpenActivity}
        onAvatar={onOpenAnalytics}
        syncStatus={syncStatus}
        queueLength={queueLength}
      />
      <PullToRefresh onRefresh={onRefresh}>{surface}</PullToRefresh>
      <KeptNav active={tab} onChange={setTab} onThrow={() => setThrowOpen(true)} />
      <ThrowSheet
        open={throwOpen}
        onClose={() => setThrowOpen(false)}
        onThrow={onThrow}
        onThrowNote={onThrowNote}
        onMoreOptions={onOpenFullAdd}
      />
    </div>
  )
}
