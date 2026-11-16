import { useMemo, useState } from 'react'
import { ArrowLeft, Pencil, ChevronLeft, ChevronRight, ChevronDown, Check, Plane, Undo2, History } from 'lucide-react'
import MonthDots from './MonthDots'
import { cycleUnitLabel, loopGaps } from './cycles'
import { historyByDay } from './heatmapUtils'
import { formatScheduleAnchor, getNextDueDate, computeHabitStats, loadSettings } from '../store'
import { localYMD } from '../dates'
import { loopMode, canAutopilot, scheduleLabel, clockLabel, lastDoneWord, doneOnDay } from '../loopModes'
import './shell.css'
import './today2.css'
import './loops2.css'

// A loop's own page (Kept 2.0, BOOM-35). How it comes back (its mode), when,
// and a calendar to fix the record. Nothing here keeps score: no trail, no
// "caught N of M", no lifetime count, no red "needs attention".
//
// The repair tools stay, because some loop shapes have no other way to fix
// their history: the away offer, the collapsed "not recorded" list, the
// editable calendar and the log-a-day field all go through the same
// stampLoopDay path (onMarkLoopDay / onUnmarkLoopDay / onSkipLoopDay).

const MODES = [
  { id: 'reminder', label: 'Reminder' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'practice', label: 'Practice' },
  { id: 'autopilot', label: 'Autopilot' },
]

const fullDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function LoopDetail({
  routine, color, spawnBlocked = false, tasks = [], awayDays = null,
  onBack, onEdit, onSpawnNow, onSkipCycle, onMarkLoopDay, onUnmarkLoopDay, onSkipLoopDay, onPushLoopOut,
  onSetAutopilot, onTogglePause, onToggleHabit,
}) {
  const [monthRef, setMonthRef] = useState(() => new Date())
  const [logDay, setLogDay] = useState(() => localYMD(new Date()))
  const [fixOpen, setFixOpen] = useState(false)
  const [flash, setFlash] = useState(null)   // 'spawned' | 'blocked' | 'skipped'

  // Hooks before the null guard (rules-of-hooks); loopGaps no-ops on null.
  const gaps = useMemo(() => loopGaps(routine, tasks, 12, awayDays), [routine, tasks, awayDays])
  const fixItems = useMemo(() => [
    ...gaps.unrecorded.map(g => ({ ...g, kind: 'unrecorded' })),
    ...gaps.missed.map(g => ({ ...g, kind: 'missed' })),
  ].sort((a, b) => b.day.localeCompare(a.day)), [gaps])
  const awayItems = gaps.away || []

  if (!routine) return null

  const mode = loopMode(routine)
  const now = new Date()
  const todayYMD = localYMD(now)
  const createdYMD = routine.created_at ? localYMD(new Date(routine.created_at)) : null
  // A practice loop's day is a log task as well as a stamp (older logs have
  // no stamp), so its calendar shows either.
  const byDay = (() => {
    const base = historyByDay(routine.completed_history)
    if (mode !== 'practice') return base
    const out = { ...base }
    for (const t of tasks) {
      if (t.routine_id !== routine.id || t.parent_id || t.status !== 'done' || !t.completed_at) continue
      const k = localYMD(new Date(t.completed_at))
      out[k] = Math.max(out[k] || 0, 1)
    }
    return out
  })()
  const ended = !!routine.end_date && Date.now() > new Date(`${routine.end_date}T23:59:59`).getTime()
  const resting = routine.paused || ended
  const doneToday = mode === 'practice' ? doneOnDay(routine, tasks, todayYMD) : (byDay[todayYMD] || 0) > 0
  const logDayLogged = (byDay[logDay] || 0) > 0
  const at = clockLabel(routine.trigger_time)

  const toggleLoopDay = (ymd) => {
    if (!ymd || ymd > todayYMD || (createdYMD && ymd < createdYMD)) return
    if ((byDay[ymd] || 0) > 0) onUnmarkLoopDay?.(routine.id, ymd)
    else onMarkLoopDay?.(routine.id, ymd, null)
  }
  // A practice loop's "done today" is a logged task, not a raw stamp, so it
  // logs through the habit log (toggleHabitDay) like the list's Log today;
  // taking it back goes through the unmark path, which removes a log AND the
  // stamp (a calendar mark has a stamp and no log).
  const markToday = () => {
    if (mode !== 'practice') return toggleLoopDay(todayYMD)
    if (doneToday) return onUnmarkLoopDay?.(routine.id, todayYMD)
    return onToggleHabit?.(routine, todayYMD)
  }

  const pickMode = (id) => {
    if (id === mode) return
    if (id === 'autopilot' && canAutopilot(routine)) return onSetAutopilot?.(routine.id, true)
    if (id === 'reminder' && mode === 'autopilot') return onSetAutopilot?.(routine.id, false)
    // Checklist items and a practice target are structural: the editor sets
    // them. It opens on the mode tapped here, with a line saying what's left.
    onEdit?.(routine, id)
  }

  const help = {
    reminder: 'A task shows up on Today when it’s due. Tick it there or here. If a cycle slips by, it simply waits; nothing piles up.',
    checklist: `A set of items that comes back together${at ? ` at ${at}` : ''}. Change the items in the editor.`,
    practice: 'No task and no due date. Log it when you do it. The target is a direction, not a score.',
    autopilot: 'Something you already do. Boomerang won’t ask, remind you or count misses. Tap a day below if you want a record.',
  }[mode]

  const weekStartsOn = loadSettings()?.week_starts_on === 0 ? 0 : 1
  const habit = mode === 'practice' ? computeHabitStats(routine, tasks, weekStartsOn) : null
  const openTask = tasks
    .filter(t => t.routine_id === routine.id && !t.parent_id && ['not_started', 'doing', 'in_progress', 'waiting'].includes(t.status))
    .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))[0]
  const nextDate = (() => {
    if (resting || mode === 'practice' || mode === 'autopilot') return null
    if (openTask?.due_date) return new Date(`${String(openTask.due_date).slice(0, 10)}T12:00:00`)
    const d = getNextDueDate(routine)
    return d && Number.isFinite(d.getTime()) ? d : null
  })()
  const nextLabel = nextDate ? (localYMD(nextDate) <= todayYMD ? 'Today' : fullDate(nextDate)) : null
  const last = lastDoneWord(routine, now)

  const rows = [
    mode === 'practice'
      ? ['Aiming for', routine.target_count ? `${routine.target_count} a ${routine.target_period === 'month' ? 'month' : 'week'}` : 'No target']
      : ['Schedule', `${scheduleLabel(routine, formatScheduleAnchor(routine))}${at && mode !== 'autopilot' ? `, ${at}` : ''}`],
    mode === 'practice' && habit ? [`This ${routine.target_period === 'month' ? 'month' : 'week'}`, `${habit.completions} so far`] : null,
    mode === 'checklist' ? ['Items', String(routine.members.length)] : null,
    ['Last done', last ? last.replace(/^./, c => c.toUpperCase()) : 'Not yet'],
    nextLabel ? ['Next', nextLabel] : null,
    routine.assignee ? ['For', routine.assignee] : null,
  ].filter(Boolean)

  const stepMonth = (dir) => setMonthRef(m => new Date(m.getFullYear(), m.getMonth() + dir, 1))
  const monthLabel = monthRef.toLocaleDateString('en-US', { month: 'long', year: monthRef.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
  const blink = (k) => { setFlash(k); setTimeout(() => setFlash(null), 1500) }
  const missedCount = fixItems.filter(g => g.kind === 'missed').length
  const cyclic = mode === 'reminder' || mode === 'checklist'

  return (
    <div className="bm-surface bm-loop-detail" style={{ '--loop': color }}>
      <div className="bm-title-row">
        <button className="bm-back" onClick={onBack} aria-label="Back to loops">
          <ArrowLeft size={17} strokeWidth={2.2} />
        </button>
        <h1 className="bm-h1 bm-detail-title">{routine.title}</h1>
        <button className="lp-new" style={{ marginLeft: 'auto' }} onClick={() => onEdit?.(routine)}>
          <Pencil size={13} strokeWidth={2.2} /> Edit
        </button>
      </div>

      <div className="bm-t2 t2-tasks lp">
        {resting && (
          <section className="t2-card lp-resting">
            <p>
              {routine.paused
                ? 'Paused. Nothing comes back until you resume it, and its record is kept.'
                : `Ended ${new Date(`${routine.end_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Its record is kept; change the end date to bring it back.`}
            </p>
            <button className="t2-chip" onClick={() => (routine.paused ? onTogglePause?.(routine.id) : onEdit?.(routine))}>
              {routine.paused ? 'Resume' : 'Edit'}
            </button>
          </section>
        )}

        <section className="t2-card">
          <div className="t2-head"><h2 className="t2-head-title">How it comes back</h2></div>
          <div className="lp-seg" role="radiogroup" aria-label="How it comes back">
            {MODES.map(m => (
              <button key={m.id} role="radio" aria-checked={mode === m.id}
                className={mode === m.id ? 'is-on' : ''} onClick={() => pickMode(m.id)}>{m.label}</button>
            ))}
          </div>
          <p className="lp-help">{help}</p>
          {rows.map(([k, v]) => <div key={k} className="lp-kv"><span>{k}</span><b>{v}</b></div>)}
        </section>

        {cyclic && awayItems.length > 0 && (
          <section className="t2-card">
            <div className="t2-head">
              <Plane size={15} strokeWidth={2} style={{ color: 'var(--t2-meta)' }} aria-hidden="true" />
              <h2 className="t2-head-title">While you were away</h2>
              <span className="t2-head-count">{awayItems.length}</span>
            </div>
            <p className="t2-card-sub">
              {awayItems.length} {cycleUnitLabel(routine, awayItems.length === 1)} fell during a trip
              ({awayItems[awayItems.length - 1].label} – {awayItems[0].label}). They don’t count against you.
            </p>
            <div className="t2-picks">
              <button className="t2-pick" onClick={() => onPushLoopOut?.(routine.id)}>Push it out one {cycleUnitLabel(routine, true)}</button>
              <button className="t2-pick" onClick={() => { for (const g of awayItems) onSkipLoopDay?.(routine.id, g.day) }}>Pick it up as normal</button>
            </div>
            {awayItems.map((g, i) => (
              <div key={`away-${g.key}`} className={`lp-fix${i === 0 ? ' is-first' : ''}`}>
                <span className="lp-fix-day">{g.label}<span className="t2-faint">away</span></span>
                <button className="t2-pick" onClick={() => onMarkLoopDay?.(routine.id, g.day, g.iso)}><Check size={12} strokeWidth={2.6} /> Did it</button>
              </div>
            ))}
          </section>
        )}

        {cyclic && fixItems.length > 0 && (
          <section className="t2-card lp-fix-card">
            <button className="t2-qrow lp-fix-toggle" onClick={() => setFixOpen(o => !o)} aria-expanded={fixOpen}>
              <History size={16} strokeWidth={1.9} />
              <span className="t2-qrow-text"><b>{fixItems.length} day{fixItems.length === 1 ? '' : 's'} not recorded</b></span>
              {fixOpen ? <ChevronDown size={16} strokeWidth={1.9} /> : <ChevronRight size={16} strokeWidth={1.9} />}
            </button>
            {fixOpen && (
              <>
                <p className="t2-card-sub">Mark a day done if it happened, or skip it. Either way it stops asking.</p>
                {fixItems.map((g, i) => (
                  <div key={`${g.kind}-${g.key}`} className={`lp-fix${i === 0 ? ' is-first' : ''}`}>
                    <span className="lp-fix-day">{g.label}<span className="t2-faint">{g.kind === 'unrecorded' ? 'finished, not recorded' : 'no record'}</span></span>
                    <span className="lp-fix-acts">
                      <button className="t2-pick" onClick={() => onMarkLoopDay?.(routine.id, g.day, g.iso)}><Check size={12} strokeWidth={2.6} /> Mark done</button>
                      <button className="t2-letgo" onClick={() => onSkipLoopDay?.(routine.id, g.day)}>Skip</button>
                    </span>
                  </div>
                ))}
                {missedCount > 1 && (
                  <button className="t2-more" onClick={() => {
                    if (!window.confirm(`Skip all ${missedCount} days with no record? They’ll stop asking; nothing gets marked done.`)) return
                    for (const g of fixItems) if (g.kind === 'missed') onSkipLoopDay?.(routine.id, g.day)
                  }}>Skip all {missedCount} with no record</button>
                )}
              </>
            )}
          </section>
        )}

        <section className="t2-card">
          <div className="t2-head lp-month-head">
            <h2 className="t2-head-title">{monthLabel}</h2>
            <button className="bm-back" style={{ width: 28, height: 28, marginLeft: 'auto' }} onClick={() => stepMonth(-1)} aria-label="Previous month">
              <ChevronLeft size={14} strokeWidth={2.2} />
            </button>
            <button className="bm-back" style={{ width: 28, height: 28 }} onClick={() => stepMonth(1)} aria-label="Next month">
              <ChevronRight size={14} strokeWidth={2.2} />
            </button>
          </div>
          <MonthDots monthRef={monthRef} valueByDay={byDay} color={color} onToggleDay={toggleLoopDay} maxDay={todayYMD} minDay={createdYMD} />
          <p className="t2-card-sub lp-cal-hint">Tap a day to fix the record. Nothing here counts against you.</p>
          <div className="lp-log-row">
            <input
              type="date"
              className="v2-form-input lp-log-date"
              value={logDay}
              max={todayYMD}
              {...(createdYMD ? { min: createdYMD } : {})}
              onChange={(e) => setLogDay(e.target.value)}
              aria-label="Day to mark"
            />
            <button
              className="t2-pick"
              disabled={!logDay || logDay > todayYMD || (createdYMD && logDay < createdYMD)}
              onClick={() => toggleLoopDay(logDay)}
            >
              {logDayLogged ? <><Undo2 size={12} strokeWidth={2.4} /> Remove</> : <><Check size={12} strokeWidth={2.6} /> Mark done</>}
            </button>
          </div>
        </section>

        <div className="lp-actions">
          <button className="t2-btn t2-btn-ghost" onClick={() => onTogglePause?.(routine.id)}>{routine.paused ? 'Resume' : 'Pause'}</button>
          <button className="t2-btn t2-btn-primary" onClick={markToday}>
            {doneToday ? <><Check size={15} strokeWidth={2.6} /> Done today</> : 'Mark done today'}
          </button>
        </div>
        {cyclic && !resting && (
          <div className="lp-more">
            <button className="t2-letgo" disabled={spawnBlocked || !!flash} onClick={() => {
              if (spawnBlocked) return
              // Say "Added" only if something was: the handler refuses when an
              // instance is already waiting anywhere (backlog included).
              const made = onSpawnNow?.(routine.id)
              blink(Array.isArray(made) && made.length ? 'spawned' : 'blocked')
            }}>
              {flash === 'spawned' ? 'Added' : flash === 'blocked' || spawnBlocked ? 'Already on your list' : 'Add a task now'}
            </button>
            <button className="t2-letgo" disabled={flash === 'skipped'} onClick={() => { onSkipCycle?.(routine.id); blink('skipped') }}>
              {flash === 'skipped' ? 'Skipped' : 'Skip this cycle'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
