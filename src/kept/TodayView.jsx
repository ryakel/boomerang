import { useMemo } from 'react'
import { Check, Repeat2 } from 'lucide-react'
import DayArc from './DayArc'
import FlightTrail from './FlightTrail'
import { localYMD } from '../dates'
import { historyByDay, currentStreak } from '../wallaby/heatmapUtils'
import { isSnoozed, formatSnoozeLabel, getNextDueDate } from '../store'
import { routineFeathers } from './feathers'
import RowSwipe from './RowSwipe'
import './shell.css'

const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']

// Kept "Today" — Day Arc hero + today's tasks (hairline rows) + loops rows
// with mini Flight Trails (spec §6). Handlers come from AppV2; loop checks
// route through the canonical onToggleHabit/onCompleteTask completion paths.
export default function TodayView({
  tasks = [], routines = [], labels = [],
  dailyStats = {}, pointsGoal = 15, streak = 0,
  onCompleteTask, onOpenTask, onToggleHabit, onDeleteTask, onEditLoop,
}) {
  const todayKey = localYMD()
  const labelsById = useMemo(() => { const m = {}; for (const l of labels) m[l.id] = l; return m }, [labels])

  const stackRoutineIds = useMemo(() => new Set(
    routines.filter(r => Array.isArray(r.members) && r.members.length > 0).map(r => r.id),
  ), [routines])

  const dayTasks = useMemo(() => tasks.filter(t => {
    if (t.parent_id || t.gmail_pending) return false
    // Stack members render grouped under their stack in the Loops section.
    if (t.routine_id && stackRoutineIds.has(t.routine_id)) return false
    const doneToday = t.status === 'done' && t.completed_at && localYMD(new Date(t.completed_at)) === todayKey
    if (doneToday) return true
    if (!ACTIVE.includes(t.status)) return false
    if (isSnoozed(t)) return false
    return t.due_date ? String(t.due_date).slice(0, 10) <= todayKey : false
  }).sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)), [tasks, todayKey, stackRoutineIds])

  const returningSoon = useMemo(() => tasks.filter(t =>
    ACTIVE.includes(t.status) && !t.parent_id && !t.gmail_pending && isSnoozed(t) && !t.snooze_indefinite
    && !(t.routine_id && stackRoutineIds.has(t.routine_id)),
  ).slice(0, 3), [tasks, stackRoutineIds])

  // Only loops that are actually DUE today (per the cadence engine — weekly/
  // monthly/quarterly stay hidden until their day), already done today (so a
  // checked loop doesn't vanish), or overdue from an earlier cycle. The full
  // library lives on the Loops tab. (Prod bug: every non-paused loop was
  // listed daily — loggd's all-habits-are-daily assumption.)
  const loops = useMemo(() => {
    const feathers = routineFeathers(routines)
    return routines.filter(r => !r.paused).map(r => {
      const byDay = historyByDay(r.completed_history)
      const next = getNextDueDate(r)
      const dueKey = next ? localYMD(next) : null
      const isStack = Array.isArray(r.members) && r.members.length > 0
      // v2-parity stack model: the stack is a FOLDER. Group this routine's
      // member tasks into cycles by due_date; a cycle is shown only while it
      // has open, un-snoozed members. Done members drop out of the display
      // (the done/total header carries the progress); pre-trigger (snoozed)
      // cycles show NOTHING; fully-cleared cycles disappear.
      let cycles = []
      if (isStack) {
        const byCycle = new Map()
        for (const t of tasks) {
          if (t.routine_id !== r.id) continue
          if (['cancelled', 'backlog', 'project'].includes(t.status)) continue
          const dueKey2 = String(t.due_date || '').slice(0, 10)
          if (!dueKey2 || dueKey2 > todayKey) continue
          if (!byCycle.has(dueKey2)) byCycle.set(dueKey2, { due: dueKey2, open: [], total: 0, done: 0 })
          const c = byCycle.get(dueKey2)
          c.total++
          if (t.status === 'done') c.done++
          else if (!isSnoozed(t)) c.open.push(t)
        }
        cycles = [...byCycle.values()].filter(c => c.open.length > 0)
          .sort((a, b) => a.due.localeCompare(b.due))
      }
      return {
        r, color: feathers[r.id], byDay, isStack, cycles,
        rally: currentStreak(byDay),
        doneToday: !!byDay[todayKey],
        dueToday: !!dueKey && dueKey <= todayKey,
      }
    // Plain loops: due/done today. Stacks: ONLY while a cycle is surfaced —
    // no waiting row, no cleared receipt (v2 behavior).
    }).filter(l => (l.isStack ? l.cycles.length > 0 : (l.dueToday || l.doneToday)))
  }, [routines, tasks, todayKey])
  const loopsDone = loops.filter(l => l.doneToday).length
  const catches = dailyStats.tasksToday ?? 0

  return (
    <div className="bm-surface">
      <div className="bm-card bm-card-hero">
        <div className="bm-hero-date">
          <span className="bm-hero-day">{new Date().toLocaleDateString('en-US', { weekday: 'long' })}</span>
          <span className="bm-hero-sub">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span>
          {streak > 0 && <span className="bm-rally-chip">↻ {streak}-day rally</span>}
        </div>
        <DayArc value={dailyStats.pointsToday ?? 0} goal={pointsGoal} />
        <div className="bm-hero-meta">
          <span><b>{catches}</b> {catches === 1 ? 'catch' : 'catches'}</span>
          <span><b>{loopsDone}/{loops.length}</b> loops</span>
          <span><b>{Math.max(0, pointsGoal - (dailyStats.pointsToday ?? 0))}</b> pts left</span>
        </div>
      </div>

      <div className="bm-sec"><span className="bm-sec-tick" /> Today <span className="bm-sec-n">{dayTasks.length}</span></div>
      <div className="bm-rows">
        {dayTasks.length === 0 && <p className="bm-empty">Nothing due — enjoy it.</p>}
        {dayTasks.map(t => {
          const done = t.status === 'done'
          const overdue = !done && t.due_date && String(t.due_date).slice(0, 10) < todayKey
          const chips = (t.tags || []).map(id => labelsById[id]).filter(Boolean)
          return (
            <RowSwipe key={t.id} done={done} onCatch={() => onCompleteTask?.(t)} onDelete={() => onDeleteTask?.(t)}>
              <div className="bm-row">
                <button
                  className={`bm-chk${done ? ' is-done' : ''}`}
                  onClick={() => onCompleteTask?.(t)}
                  aria-label={done ? 'Reopen' : 'Catch it'}
                >{done && <Check size={13} strokeWidth={3.4} />}</button>
                <button className="bm-row-body" onClick={() => onOpenTask?.(t)}>
                  <span className={`bm-row-title${done ? ' is-done' : ''}`}>{t.title}</span>
                  {!done && (overdue || chips.length > 0) && (
                    <span className="bm-row-meta">
                      {overdue && <span className="bm-due-over">overdue</span>}
                      {chips.slice(0, 3).map(l => (
                        <span key={l.id} className="bm-tagdot" style={{ '--tag': l.color }}><i />{l.name}</span>
                      ))}
                    </span>
                  )}
                </button>
              </div>
            </RowSwipe>
          )
        })}
        {returningSoon.map(t => (
          <div key={t.id} className="bm-row">
            <span className="bm-chk is-muted" aria-hidden="true" />
            <button className="bm-row-body" onClick={() => onOpenTask?.(t)}>
              <span className="bm-row-title" style={{ color: 'var(--bm-text-meta)' }}>{t.title}</span>
              <span className="bm-row-meta"><span className="bm-return-chip">↩ returns {formatSnoozeLabel(t.snoozed_until)}</span></span>
            </button>
          </div>
        ))}
      </div>

      {loops.length > 0 && (
        <>
          <div className="bm-sec"><span className="bm-sec-tick" /> Loops <span className="bm-sec-n">{loopsDone}/{loops.length}</span></div>
          <div className="bm-rows">
            {loops.map(({ r, color, byDay, rally, doneToday, isStack, cycles }) => {
              if (isStack) {
                // Folder per surfaced cycle: header (name · done/total) over
                // the OPEN members. Checks ride the real task path so the
                // clear bonus + single history stamp hold; the folder
                // disappears with its last member.
                return cycles.map(c => (
                  <div key={`${r.id}|${c.due}`} className="bm-stack" style={{ '--loop': color }}>
                    <div className="bm-stack-head">
                      <span className="bm-loop-ring" style={{ width: 26, height: 26 }}><Repeat2 size={13} strokeWidth={2.2} /></span>
                      <button className="bm-stack-title" onClick={() => onEditLoop?.(r)}>{r.title}</button>
                      <span className="bm-stack-progress">{c.done}/{c.total}</span>
                    </div>
                    {c.open.map(t => (
                      <div key={t.id} className="bm-stack-member">
                        <button
                          className="bm-chk"
                          style={{ borderColor: color }}
                          onClick={() => onCompleteTask?.(t)}
                          aria-label="Catch it"
                        />
                        <button className="bm-row-body" onClick={() => onOpenTask?.(t)}>
                          <span className="bm-row-title">{t.title}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              }
              return (
              <div key={r.id} className="bm-loop" style={{ '--loop': color }}>
                <span className="bm-loop-ring"><Repeat2 size={15} strokeWidth={2.2} /></span>
                <button className="bm-loop-body" onClick={() => onEditLoop?.(r)} aria-label={`Edit ${r.title}`}>
                  <div className="bm-loop-title">{r.title}</div>
                  <div className="bm-loop-sub">
                    {r.cadence || 'routine'}{rally > 0 && <> · <span className="bm-loop-rally">↻ {rally}</span></>}
                  </div>
                </button>
                <span className="bm-loop-trail"><FlightTrail valueByDay={byDay} color={color} mini /></span>
                <button
                  className={`bm-loop-chk${doneToday ? ' is-done' : ''}`}
                  onClick={() => onToggleHabit?.(r, todayKey)}
                  aria-label={doneToday ? 'Mark not done' : 'Mark done'}
                >{doneToday && <Check size={15} strokeWidth={3.2} />}</button>
              </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
