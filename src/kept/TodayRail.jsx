import { useMemo } from 'react'
import { Check, Compass } from 'lucide-react'
import DayArc from './DayArc'
import { localYMD } from '../dates'
import { isSnoozed } from '../store'
import './shell.css'
import './desktop.css'

const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']

// Today rail (K5) — the ambient "what matters right now" column on the
// desktop command center, visible while you work in Tasks or Loops. Day Arc
// + stats + today's catchable list; catches ride the canonical handlers.
export default function TodayRail({
  tasks = [], routines = [], dailyStats = {}, pointsGoal = 15, streak = 0,
  onCompleteTask, onOpenTask, onWhatNow,
}) {
  const todayKey = localYMD()
  const stackIds = useMemo(() => new Set(
    routines.filter(r => Array.isArray(r.members) && r.members.length > 0).map(r => r.id),
  ), [routines])

  const dueToday = useMemo(() => tasks.filter(t => {
    if (t.parent_id || t.gmail_pending) return false
    if (t.routine_id && stackIds.has(t.routine_id)) return false
    if (!ACTIVE.includes(t.status)) return false
    if (isSnoozed(t)) return false
    return t.due_date ? String(t.due_date).slice(0, 10) <= todayKey : false
  }).slice(0, 12), [tasks, todayKey, stackIds])

  const catches = dailyStats.tasksToday ?? 0

  return (
    <aside className="bm-rail">
      <div className="bm-rail-date">
        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        {streak > 0 && <span className="bm-rally-chip">↻ {streak}</span>}
      </div>
      <DayArc value={dailyStats.pointsToday ?? 0} goal={pointsGoal} />
      <div className="bm-hero-meta" style={{ paddingTop: 4 }}>
        <span><b>{catches}</b> {catches === 1 ? 'catch' : 'catches'}</span>
        <span><b>{Math.max(0, pointsGoal - (dailyStats.pointsToday ?? 0))}</b> pts left</span>
      </div>
      <button className="bm-btn bm-btn-tonal bm-whatnow" style={{ margin: '10px 0 14px' }} onClick={onWhatNow}>
        <Compass size={14} strokeWidth={2.1} /> What now?
      </button>

      <div className="bm-rail-sec">Due today</div>
      {dueToday.length === 0 ? (
        <p className="bm-rail-empty">Nothing due — enjoy it.</p>
      ) : (
        <div className="bm-rows">
          {dueToday.map(t => (
            <div key={t.id} className="bm-row bm-rail-row">
              <button
                className={`bm-chk${t.high_priority ? ' is-hi' : ''}`}
                onClick={() => onCompleteTask?.(t)}
                aria-label="Catch it"
              ><Check size={12} strokeWidth={3.2} style={{ opacity: 0 }} /></button>
              <button className="bm-row-body" onClick={() => onOpenTask?.(t)}>
                <span className="bm-row-title" style={{ fontSize: 13.5 }}>{t.title}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
