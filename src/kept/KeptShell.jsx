import { useState } from 'react'
import KeptHeader from './KeptHeader'
import KeptNav from './KeptNav'
import PullToRefresh from './PullToRefresh'
import TodayView from './TodayView'
import TodayKept2 from './TodayKept2'
import { classicTodayOn } from './classicToday'
import { loadSettings } from '../store'
import LoopsView from './LoopsView'
import TasksViewKept from './TasksViewKept'
import MoreView from './MoreView'
import ThrowSheet from './ThrowSheet'
import { SheetHostContext } from './sheetHost'
import './shell.css'

// Kept shell — the Boomerang IA on mobile (spec §6): KeptHeader · active
// surface · 4-tab nav with the center Throw button. Owns navigation + sheet
// state; data and mutation handlers come from AppV2 (shared hooks). Quokka
// lives in the header, not the nav.
export default function KeptShell({
  tasks = [], routines = [], labels = [], weatherByDate = null,
  dailyStats = {},
  onCompleteTask, onOpenTask, onToggleHabit, onRescheduleTask, onDeleteTask,
  onLogSession, onGmailKeep, onGmailDismiss, onReconcileYesterday, onReconcileKeep, onWhatNow, onToggleItem, onUnsnooze, onUpdateTask,
  onCycleImpact, onStatusChange, onRestoreStatus,
  onThrow, onThrowNote, onOpenFullAdd, onScanSchedule, onEditLoop, onAddLoop, onSpawnNow, onSkipCycle, onMarkLoopDay, onUnmarkLoopDay, onSkipLoopDay, onPushLoopOut, onSetLoopAutopilot, onToggleLoopPause, onDeleteLoop, onTurnOffLoopReminder, onSetKeepToday, onUpdateLoop,
  onOpenQuokka, onOpenSettings, onOpenPackages, onOpenAnalytics,
  onOpenProjects, onOpenActivity, onOpenSuggestions, onOpenNotifications,
  onOpenNotes,
  onOpenLists,
  onOpenReminders,
  pinnedNotes = [], onUnpinNote,
  onRefresh,
  syncStatus = 'synced', queueLength = 0,
}) {
  const [tab, setTab] = useState('today')
  const [throwOpen, setThrowOpen] = useState(false)
  // Sheets opened inside a surface portal to the shell root (SheetPortal.jsx).
  const [sheetHost, setSheetHost] = useState(null)

  let surface
  if (tab === 'loops') {
    surface = <LoopsView routines={routines} tasks={tasks} onEditLoop={onEditLoop} onAddLoop={onAddLoop} onSpawnNow={onSpawnNow} onSkipCycle={onSkipCycle} onMarkLoopDay={onMarkLoopDay} onUnmarkLoopDay={onUnmarkLoopDay} onSkipLoopDay={onSkipLoopDay} onPushLoopOut={onPushLoopOut} onOpenSuggestions={onOpenSuggestions} onSetAutopilot={onSetLoopAutopilot} onTogglePause={onToggleLoopPause} onDeleteLoop={onDeleteLoop} onTurnOffLoopReminder={onTurnOffLoopReminder} onUpdateLoop={onUpdateLoop} onCompleteTask={onCompleteTask} onOpenTask={onOpenTask} onToggleHabit={onToggleHabit} />
  } else if (tab === 'tasks') {
    surface = (
      <TasksViewKept
        tasks={tasks} labels={labels}
        routines={routines} weatherByDate={weatherByDate}
        onToggleComplete={onCompleteTask} onToggleItem={onToggleItem} onOpenTask={onOpenTask}
        onDelete={onDeleteTask} onReschedule={onRescheduleTask} onUnsnooze={onUnsnooze}
        onCycleImpact={onCycleImpact} onStatusChange={onStatusChange} onRestoreStatus={onRestoreStatus} onSetKeepToday={onSetKeepToday}
      />
    )
  } else if (tab === 'more') {
    surface = (
      <MoreView
        onOpenProjects={onOpenProjects}
        onOpenPackages={onOpenPackages}
        onOpenSettings={onOpenSettings}
        onOpenNotes={onOpenNotes}
        onOpenLists={onOpenLists}
        onOpenReminders={onOpenReminders}
      />
    )
  } else {
    // Kept 2.0 Today. The classic screen is gated off (src/kept/classicToday.js);
    // same props either way.
    const Today = classicTodayOn(loadSettings()) ? TodayView : TodayKept2
    surface = (
      <Today
        tasks={tasks} routines={routines} labels={labels} weatherByDate={weatherByDate}
        dailyStats={dailyStats}
        onCompleteTask={onCompleteTask} onOpenTask={onOpenTask} onToggleHabit={onToggleHabit}
        onDeleteTask={onDeleteTask} onEditLoop={onEditLoop}
        onLogSession={onLogSession} onGmailKeep={onGmailKeep} onGmailDismiss={onGmailDismiss}
        onReconcileYesterday={onReconcileYesterday} onReconcileKeep={onReconcileKeep}
        onUpdateTask={onUpdateTask}
        onWhatNow={onWhatNow}
        onCycleImpact={onCycleImpact}
        pinnedNotes={pinnedNotes} onOpenNotes={onOpenNotes} onUnpinNote={onUnpinNote}
        onShowTasks={() => setTab('tasks')}
      />
    )
  }

  return (
    <SheetHostContext.Provider value={sheetHost}>
    <div className="bm-shell" ref={setSheetHost}>
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
        onScanSchedule={onScanSchedule}
      />
    </div>
    </SheetHostContext.Provider>
  )
}
