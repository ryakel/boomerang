import { useMemo } from 'react'
import { Check, Compass } from 'lucide-react'
import { localYMD } from '../dates'
import { isSnoozed, isCrisisTask, loadSettings } from '../store'
import './shell.css'
import './desktop.css'

const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']

// Today rail (K5) — the ambient "what matters right now" column on the
// desktop command center, visible while you work in Tasks or Loops. The day's
// catch count + today's catchable list; catches ride the canonical handlers.
// The points arc and rally chip left with points/rally (BOOM-33); the rail
// itself is due a rethink with the rest of desktop.
export default function TodayRail({
  tasks = [], routines = [], dailyStats = {},
  onCompleteTask, onOpenTask, onWhatNow,
}) {
  const todayKey = localYMD()
  const settings = loadSettings()
  const stackIds = useMemo(() => new Set(
    routines.filter(r => Array.isArray(r.members) && r.members.length > 0).map(r => r.id),
  ), [routines])

  const dueToday = useMemo(() => tasks.filter(t => {
    if (t.parent_id || t.gmail_pending) return false
    if (t.routine_id && stackIds.has(t.routine_id)) return false
    if (!ACTIVE.includes(t.status)) return false
    if (isSnoozed(t)) return false
    // Kept 2.0 rule (BOOM-44): due today means due TODAY. A task past its date
    // has slipped and lives quietly in the Tasks list's Slipped card; listing it
    // here under "Due today" contradicted that card sitting right beside the
    // rail. A loop's open instance is the current cycle however late, and a
    // critical task always shows, as on Today.
    const due = t.due_date ? String(t.due_date).slice(0, 10) : null
    if (isCrisisTask(t, settings)) return true
    if (t.committed_on === todayKey) return true
    if (!due) return false
    return due === todayKey || (!!t.routine_id && due < todayKey)
  }).slice(0, 12), [tasks, todayKey, stackIds, settings])

  // Undated active tasks — mirrors TodayView.jsx's "Anytime" section. Without
  // this, an undated task is fully notifiable (isNotifiable() in db.js has no
  // due_date requirement) but was invisible anywhere on this rail — the exact
  // "nagged about something I can't even see" gap reported in prod, since the
  // rail is what's on screen while browsing Tasks/Loops.
  const anytimeTasks = useMemo(() => tasks.filter(t => {
    if (t.parent_id || t.gmail_pending || t.due_date) return false
    if (t.routine_id && stackIds.has(t.routine_id)) return false
    if (!ACTIVE.includes(t.status)) return false
    return !isSnoozed(t)
  }), [tasks, stackIds])
  const ANYTIME_CAP = 8
  const anytimeShown = anytimeTasks.slice(0, ANYTIME_CAP)
  const anytimeOverflow = anytimeTasks.length - anytimeShown.length

  const catches = dailyStats.tasksToday ?? 0

  return (
    <aside className="bm-rail">
      <div className="bm-rail-date">
        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
      <div className="bm-hero-meta" style={{ paddingTop: 4 }}>
        <span><b>{catches}</b> {catches === 1 ? 'catch' : 'catches'}</span>
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

      {anytimeTasks.length > 0 && (
        <>
          <div className="bm-rail-sec">Anytime</div>
          <div className="bm-rows">
            {anytimeShown.map(t => (
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
          {anytimeOverflow > 0 && (
            <p className="bm-rail-empty">+{anytimeOverflow} more in Tasks</p>
          )}
        </>
      )}
    </aside>
  )
}
