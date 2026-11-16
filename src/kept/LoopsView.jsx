import { useEffect, useMemo, useState } from 'react'
import { Sun, Moon, Sprout, CalendarDays, RefreshCw, Pause, History, ChevronRight, ChevronDown, Sparkle, Check, Plus } from 'lucide-react'
import LoopDetail from './LoopDetail'
import { Ring, Head } from './today2Parts'
import { useNow } from './today2Hooks'
import { loopGaps } from './cycles'
import { routineFeathers } from './feathers'
import { groupLoops, cadenceWord, clockLabel, lastDoneWord } from '../loopModes'
import { getNextDueDate, computeHabitStats, loadSettings } from '../store'
import { localYMD } from '../dates'
import './shell.css'
import './today2.css'
import './loops2.css'

// Kept 2.0 Loops (BOOM-35, 2026-11-15). Loops are grouped by what they ask of
// you today, not scored: no trails, no "caught N of M", no lifetime counts, no
// red badges. Which group a loop lands in lives in src/loopModes.js (pure);
// the repair tools (calendar, not-recorded days, away offer) live on the
// loop's own page, LoopDetail.

const weekday = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
const shortDate = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const names = (list) => {
  const t = list.map(x => x.routine.title)
  return t.length > 3 ? `${t.slice(0, 3).join(', ')} and ${t.length - 3} more` : t.join(', ')
}

function StatusRing({ done = false, dashed = false, color }) {
  return (
    <span className={`lp-ring${done ? ' is-done' : ''}${dashed ? ' is-dashed' : ''}`} style={color ? { '--ring': color } : undefined} aria-hidden="true">
      {done && <Check size={13} strokeWidth={3} />}
    </span>
  )
}

export default function LoopsView({
  routines = [], tasks = [], onEditLoop, onAddLoop, onSpawnNow, onSkipCycle, onMarkLoopDay, onUnmarkLoopDay,
  onSkipLoopDay, onPushLoopOut, onOpenSuggestions, onSetAutopilot, onTogglePause, onCompleteTask, onToggleHabit,
}) {
  const now = useNow()
  const todayKey = localYMD(now)
  const [detailId, setDetailId] = useState(null)
  const [restingOpen, setRestingOpen] = useState(false)
  const [slippedOpen, setSlippedOpen] = useState(false)
  // Pending pattern-scan suggestions: a dot on the Suggestions button.
  const [suggestionCount, setSuggestionCount] = useState(0)
  useEffect(() => {
    let alive = true
    fetch('/api/suggestions')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d) setSuggestionCount(d.count || 0) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Days the away window covered (the stamped settings.away_days the alarms
  // read): a cycle you were away for is never "not recorded".
  const awayDays = useMemo(() => new Set(loadSettings()?.away_days || []), [])
  const feathers = useMemo(() => routineFeathers(routines), [routines])
  const weekStartsOn = loadSettings()?.week_starts_on === 0 ? 0 : 1

  const g = useMemo(() => groupLoops({
    routines, tasks, now,
    nextDue: getNextDueDate,
    habitStats: (r, ts) => computeHabitStats(r, ts, weekStartsOn),
    missedCount: (r) => { const x = loopGaps(r, tasks, 12, awayDays); return x.unrecorded.length + x.missed.length },
  }), [routines, tasks, now, awayDays, weekStartsOn])

  const selected = detailId ? routines.find(r => r.id === detailId) : null
  if (selected) {
    const spawnBlocked = tasks.some(t => t.routine_id === selected.id && !t.parent_id && !['done', 'completed', 'cancelled', 'backlog', 'project'].includes(t.status))
    return (
      <LoopDetail
        routine={selected}
        color={feathers[selected.id]}
        spawnBlocked={spawnBlocked}
        tasks={tasks}
        awayDays={awayDays}
        onBack={() => setDetailId(null)}
        onEdit={(r) => { setDetailId(null); onEditLoop?.(r) }}
        onSpawnNow={onSpawnNow}
        onSkipCycle={onSkipCycle}
        onMarkLoopDay={onMarkLoopDay}
        onUnmarkLoopDay={onUnmarkLoopDay}
        onSkipLoopDay={onSkipLoopDay}
        onPushLoopOut={onPushLoopOut}
        onSetAutopilot={onSetAutopilot}
        onTogglePause={onTogglePause}
        onToggleHabit={onToggleHabit}
      />
    )
  }

  const open = (r) => setDetailId(r.id)
  const meta = (parts) => <span className="t2-row-meta">{parts.filter(Boolean).join(' · ')}</span>
  const hasAny = routines.length > 0
  const slippedTotal = g.slipped.reduce((n, x) => n + x.count, 0)

  return (
    <div className="bm-surface">
      <div className="bm-title-row lp-title-row">
        <h1 className="bm-h1">Loops</h1>
        <button className="bm-back lp-suggest" style={{ marginLeft: 'auto' }} onClick={onOpenSuggestions} aria-label={suggestionCount > 0 ? `Suggestions, ${suggestionCount} pending` : 'Suggestions'}>
          <Sparkle size={15} strokeWidth={2} />
          {suggestionCount > 0 && <span className="bm-suggest-dot" />}
        </button>
        <button className="lp-new" onClick={onAddLoop}><Plus size={14} strokeWidth={2.4} /> New loop</button>
      </div>
      <p className="lp-lede">Things that come back around. Nothing here keeps score.</p>

      <div className="bm-t2 t2-tasks lp">
        {!hasAny && <p className="bm-empty">No loops yet. Things that come back around live here.</p>}

        {g.dueToday.length > 0 && (
          <section className="t2-card">
            <Head icon={Sun} color="var(--bm-ember)" title="Due today" count={g.dueToday.length} />
            {g.dueToday.map(({ routine: r, task, doneTask }, i) => {
              const due = task?.due_date ? String(task.due_date).slice(0, 10) : null
              return (
                <div key={r.id} className={`t2-row${i === 0 ? ' is-first' : ''}`}>
                  {task
                    ? <Ring color="var(--bm-ember)" onClick={() => onCompleteTask?.(task)} label={`Done: ${r.title}`} />
                    : <button className="lp-ring-btn" onClick={() => onCompleteTask?.(doneTask)} aria-label={`Undo: ${r.title}`}><StatusRing done /></button>}
                  <button className="t2-row-body" onClick={() => open(r)}>
                    <span className="t2-row-title">{r.title}</span>
                    {meta(['Reminder', cadenceWord(r),
                      task ? (due && due < todayKey ? `since ${weekday(due)}` : null) : `done at ${timeOf(doneTask.completed_at)}`,
                      r.assignee ? `for ${r.assignee}` : null])}
                  </button>
                </div>
              )
            })}
          </section>
        )}

        {g.checklists.length > 0 && (
          <section className="t2-card">
            <Head icon={Moon} color="var(--bm-ember)" title="Checklists" count={g.checklists.length} />
            {g.checklists.map(({ routine: r, items, doneToday, spawnedToday }, i) => {
              const at = clockLabel(r.trigger_time)
              const allDone = spawnedToday > 0 && doneToday >= spawnedToday
              return (
                <div key={r.id} className={`t2-row${i === 0 ? ' is-first' : ''}`}>
                  <StatusRing done={allDone} />
                  <div className="t2-row-body" style={{ cursor: 'default' }}>
                    <button className="t2-row-body" onClick={() => open(r)}>
                      <span className="t2-row-title">{r.title}</span>
                      {meta(['Checklist', at ? (Number(r.trigger_time.slice(0, 2)) >= 17 ? `tonight at ${at}` : `at ${at}`) : cadenceWord(r),
                        spawnedToday > 0 ? `${doneToday} of ${spawnedToday} done` : `${items} item${items === 1 ? '' : 's'}`])}
                    </button>
                    <div className="lp-items">
                      {r.members.map(m => <span key={m.id || m.title}>{m.title}</span>)}
                    </div>
                  </div>
                </div>
              )
            })}
          </section>
        )}

        {g.practice.length > 0 && (
          <section className="t2-card">
            <Head icon={Sprout} color="var(--bm-ember)" title="Practice" count={g.practice.length} />
            {g.practice.map(({ routine: r, done, target, loggedToday }, i) => {
              const period = r.target_period === 'month' ? 'month' : 'week'
              return (
                <div key={r.id} className={`t2-row t2-row-actions${i === 0 ? ' is-first' : ''}`}>
                  <StatusRing done={loggedToday} />
                  <button className="t2-row-body" onClick={() => open(r)}>
                    <span className="t2-row-title">{r.title}</span>
                    {meta(['Practice', target ? `aiming for ${target} a ${period}` : 'log it when you do it', target ? `${done} so far this ${period}` : null])}
                  </button>
                  <button className={`t2-chip${loggedToday ? ' lp-chip-done' : ''}`} onClick={() => onToggleHabit?.(r, todayKey)}>
                    {loggedToday ? <><Check size={13} strokeWidth={2.6} /> Logged</> : <><Plus size={13} strokeWidth={2.6} /> Log today</>}
                  </button>
                </div>
              )
            })}
          </section>
        )}

        {g.comingUp.length > 0 && (
          <section className="t2-card">
            <Head icon={CalendarDays} color="var(--bm-ember)" title="Coming up" count={g.comingUp.length} />
            {g.comingUp.map(({ routine: r, due }, i) => {
              const inWeek = due && (new Date(`${due}T12:00:00`) - new Date(`${todayKey}T12:00:00`)) / 86400000 < 7
              const last = lastDoneWord(r, now)
              return (
                <button key={r.id} className={`t2-clock${i === 0 ? ' is-first' : ''}`} onClick={() => open(r)}>
                  <span className="t2-clock-time">{due ? (inWeek ? weekday(due) : shortDate(due)) : '—'}</span>
                  <span className="t2-clock-bar" />
                  <span className="t2-clock-body">
                    <span className="t2-clock-title">{r.title}</span>
                    <span className="t2-row-meta t2-clock-meta">{['Reminder', cadenceWord(r), last ? `last done ${last}` : null, r.assignee ? `for ${r.assignee}` : null].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              )
            })}
          </section>
        )}

        {g.autopilot.length > 0 && (
          <section className="t2-card">
            <Head icon={RefreshCw} color="var(--t2-meta)" title="On autopilot" count={g.autopilot.length} />
            {g.autopilot.map(({ routine: r, doneToday }, i) => (
              <div key={r.id} className={`t2-row${i === 0 ? ' is-first' : ''}`}>
                <StatusRing dashed={!doneToday} done={doneToday} />
                <button className="t2-row-body" onClick={() => open(r)}>
                  <span className="t2-row-title">{r.title}</span>
                  {meta([cadenceWord(r).replace(/^./, c => c.toUpperCase()), doneToday ? 'logged today' : null, 'Boomerang won’t ask or count misses'])}
                </button>
              </div>
            ))}
          </section>
        )}

        {(g.slipped.length > 0 || g.resting.length > 0) && (
          <div className="t2-quiet lp-quiet">
            {g.slipped.length > 0 && (
              <div className="t2-quiet-group">
                <button className="t2-qrow" onClick={() => setSlippedOpen(o => !o)} aria-expanded={slippedOpen}>
                  <History size={16} strokeWidth={1.9} />
                  <span className="t2-qrow-text"><b>{slippedTotal} day{slippedTotal === 1 ? '' : 's'} not recorded</b> · {names(g.slipped)}</span>
                  {slippedOpen ? <ChevronDown size={16} strokeWidth={1.9} /> : <ChevronRight size={16} strokeWidth={1.9} />}
                </button>
                {slippedOpen && (
                  <div className="lp-qlist">
                    {g.slipped.map(({ routine: r, count }) => (
                      <button key={r.id} className="lp-qitem" onClick={() => open(r)}>
                        <span>{r.title}</span><span className="t2-faint">{count} to look at</span><ChevronRight size={14} strokeWidth={1.9} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {g.resting.length > 0 && (
              <div className="t2-quiet-group">
                <button className="t2-qrow" onClick={() => setRestingOpen(o => !o)} aria-expanded={restingOpen}>
                  <Pause size={16} strokeWidth={1.9} />
                  <span className="t2-qrow-text"><b>{g.resting.length} resting</b> · {names(g.resting)}</span>
                  {restingOpen ? <ChevronDown size={16} strokeWidth={1.9} /> : <ChevronRight size={16} strokeWidth={1.9} />}
                </button>
                {restingOpen && (
                  <div className="lp-qlist">
                    {g.resting.map(({ routine: r }) => (
                      <button key={r.id} className="lp-qitem" onClick={() => open(r)}>
                        <span>{r.title}</span><span className="t2-faint">{r.paused ? 'paused' : `ended ${shortDate(r.end_date)}`}</span><ChevronRight size={14} strokeWidth={1.9} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
