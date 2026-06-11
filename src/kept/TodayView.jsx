import { useMemo, useState } from 'react'
import { Check, Repeat2, Flame, FolderKanban, Inbox, X, Compass } from 'lucide-react'
import DayArc from './DayArc'
import FlightTrail from './FlightTrail'
import { localYMD, parseLocalDate } from '../dates'
import { historyByDay, currentStreak } from '../wallaby/heatmapUtils'
import { isSnoozed, isStale, formatSnoozeLabel, getNextDueDate, loadSettings } from '../store'
import { calculateTaskPoints } from '../scoring'
import { routineFeathers } from './feathers'
import RowSwipe from './RowSwipe'
import Section, { useCollapsedSections } from './Section'
import WeekBreakdown from './WeekBreakdown'
import './shell.css'

const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']

// Kept "Today" — Day Arc hero + today's tasks (hairline rows) + loops rows
// with mini Flight Trails (spec §6). Handlers come from AppV2; loop checks
// route through the canonical onToggleHabit/onCompleteTask completion paths.
export default function TodayView({
  tasks = [], routines = [], labels = [],
  dailyStats = {}, pointsGoal = 15, streak = 0,
  onCompleteTask, onOpenTask, onToggleHabit, onDeleteTask, onEditLoop,
  onLogSession, onGmailKeep, onGmailDismiss, onWhatNow,
}) {
  const todayKey = localYMD()
  const [collapsed, toggleSection] = useCollapsedSections()
  const [showBreakdown, setShowBreakdown] = useState(false)
  // Breakdown day selection lives here so the hero arc + counts follow it
  // (prod report: "slider and counts should change with the date selection").
  const [breakdownDay, setBreakdownDay] = useState(null)
  const labelsById = useMemo(() => { const m = {}; for (const l of labels) m[l.id] = l; return m }, [labels])

  const stackRoutineIds = useMemo(() => new Set(
    routines.filter(r => Array.isArray(r.members) && r.members.length > 0).map(r => r.id),
  ), [routines])

  const dayTasks = useMemo(() => tasks.filter(t => {
    if (t.parent_id || t.gmail_pending) return false
    // Stack members render grouped under their stack in the Loops section.
    if (t.routine_id && stackRoutineIds.has(t.routine_id)) return false
    // Caught tasks leave the list immediately (v2 contract — the toast's
    // Undo covers regret; Caught keeps the record). No done strikethroughs.
    if (!ACTIVE.includes(t.status)) return false
    if (isSnoozed(t)) return false
    return t.due_date ? String(t.due_date).slice(0, 10) <= todayKey : false
  }), [tasks, todayKey, stackRoutineIds])

  // Undated active tasks — the main page must show them (v2's Up next did).
  // Future-DATED tasks stay off Today until their day; undated means
  // "anytime", and anytime includes today.
  const anytimeTasks = useMemo(() => tasks.filter(t => {
    if (t.parent_id || t.gmail_pending || t.due_date) return false
    if (t.routine_id && stackRoutineIds.has(t.routine_id)) return false
    if (!ACTIVE.includes(t.status)) return false
    return !isSnoozed(t)
  }), [tasks, stackRoutineIds])

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
        // Habit-mode (target frequency) loops are loggable ANY day — the
        // cadence engine doesn't model them, so they're always "due".
        dueToday: r.spawn_mode === 'habit' || (!!dueKey && dueKey <= todayKey),
      }
    // Plain loops: due/done today. Stacks: while a cycle is surfaced, OR
    // cleared today — a finished stack stays counted + visible as a checked
    // receipt until midnight (prod report: clearing Bedtime's last member
    // flipped the hero from 2/3 loops to 2/2 instead of crediting 3/3).
    }).filter(l => (l.isStack ? (l.cycles.length > 0 || l.doneToday) : (l.dueToday || l.doneToday)))
  }, [routines, tasks, todayKey])
  const loopsDone = loops.filter(l => l.doneToday).length

  // Gmail-imported items awaiting review (Keep / Dismiss) — restores the
  // v1-era inline review that died in the purge (v2 never ported it).
  const gmailPending = useMemo(() => tasks.filter(t => t.gmail_pending), [tasks])

  // Pinned Arcs (projects) — v2's main list led with these; restore them.
  const pinnedArcs = useMemo(() => tasks.filter(t => t.status === 'project' && t.pinned_to_today), [tasks])
  const arcChildren = useMemo(() => {
    const m = {}
    for (const p2 of pinnedArcs) {
      m[p2.id] = tasks.filter(t => t.parent_id === p2.id && t.child_visibility === 'active'
        && ACTIVE.includes(t.status) && !isSnoozed(t))
    }
    return m
  }, [tasks, pinnedArcs])
  const catches = dailyStats.tasksToday ?? 0

  // Stats for a non-today breakdown selection — the hero swaps to that
  // day's numbers. Catches/points computed the same way the breakdown's
  // item list is, so the arc total always matches the itemization. Loops
  // shown as a plain done-count (historical due-ness isn't reconstructable).
  const selStats = useMemo(() => {
    if (!showBreakdown || !breakdownDay || breakdownDay === todayKey) return null
    let pts = 0, n = 0
    for (const t of tasks) {
      const ts = t.status === 'done' && t.completed_at ? t.completed_at
        : t.status === 'waiting' && t.waiting_at ? t.waiting_at
        : null
      if (!ts || localYMD(new Date(ts)) !== breakdownDay) continue
      n++; pts += calculateTaskPoints(t)
    }
    if ((loadSettings().easter_egg_wins || {})[breakdownDay]) { n++; pts += 1 }
    let loopsDone = 0
    for (const r2 of routines) {
      if (historyByDay(r2.completed_history)[breakdownDay]) loopsDone++
    }
    const d = parseLocalDate(breakdownDay)
    return { pts, n, loopsDone, date: d }
  }, [showBreakdown, breakdownDay, todayKey, tasks, routines])

  return (
    <div className="bm-surface">
      <div className="bm-card bm-card-hero">
        <div className="bm-hero-date">
          <span className="bm-hero-day">{(selStats ? selStats.date : new Date()).toLocaleDateString('en-US', { weekday: 'long' })}</span>
          <span className="bm-hero-sub">{(selStats ? selStats.date : new Date()).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span>
          {streak > 0 && <span className="bm-rally-chip">↻ {streak}-day rally</span>}
        </div>
        <button
          className="bm-hero-tap"
          onClick={() => {
            setShowBreakdown(v => {
              setBreakdownDay(v ? null : todayKey)
              return !v
            })
          }}
          aria-expanded={showBreakdown}
          aria-label="Show daily breakdown"
        >
          <DayArc
            value={selStats ? selStats.pts : (dailyStats.pointsToday ?? 0)}
            goal={pointsGoal}
            caption={selStats ? 'points that day' : 'points today'}
          />
          <div className="bm-hero-meta">
            {selStats ? (
              <>
                <span><b>{selStats.n}</b> {selStats.n === 1 ? 'catch' : 'catches'}</span>
                <span><b>{selStats.loopsDone}</b> {selStats.loopsDone === 1 ? 'loop' : 'loops'}</span>
                <span><b>{selStats.pts}</b> pts</span>
              </>
            ) : (
              <>
                <span><b>{catches}</b> {catches === 1 ? 'catch' : 'catches'}</span>
                <span><b>{loopsDone}/{loops.length}</b> loops</span>
                <span><b>{Math.max(0, pointsGoal - (dailyStats.pointsToday ?? 0))}</b> pts left</span>
              </>
            )}
          </div>
        </button>
        {showBreakdown && (
          <WeekBreakdown tasks={tasks} selected={breakdownDay} onSelect={setBreakdownDay} />
        )}
        <button className="bm-btn bm-btn-tonal bm-whatnow" onClick={onWhatNow}>
          <Compass size={15} strokeWidth={2.1} /> What now?
        </button>
      </div>

      {gmailPending.length > 0 && (
        <Section id="review" label="Review" count={gmailPending.length} collapsed={!!collapsed.review} onToggle={toggleSection}>
          <div className="bm-rows">
            {gmailPending.map(t => (
              <div key={t.id} className="bm-row bm-review-row">
                <span className="bm-review-icon"><Inbox size={14} strokeWidth={2} /></span>
                <button className="bm-row-body" onClick={() => onOpenTask?.(t)}>
                  <span className="bm-row-title">{t.title}</span>
                  <span className="bm-row-meta"><span>from Gmail</span></span>
                </button>
                <button className="bm-btn bm-btn-tonal bm-review-keep" onClick={() => onGmailKeep?.(t)}>
                  <Check size={13} strokeWidth={2.6} /> Keep
                </button>
                <button className="bm-review-dismiss" onClick={() => onGmailDismiss?.(t)} aria-label="Dismiss">
                  <X size={15} strokeWidth={2.2} />
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {pinnedArcs.length > 0 && (
        <Section id="arcs" label="Arcs" count={pinnedArcs.length} collapsed={!!collapsed.arcs} onToggle={toggleSection}>
          <div className="bm-rows">
            {pinnedArcs.map(p2 => (
              <div key={p2.id} className="bm-arc">
                <div className="bm-arc-head">
                  <span className="bm-arc-icon"><FolderKanban size={14} strokeWidth={2} /></span>
                  <button className="bm-row-body" onClick={() => onOpenTask?.(p2)}>
                    <span className="bm-row-title">{p2.title}</span>
                    <span className="bm-row-meta">
                      <span><Flame size={11} strokeWidth={2.25} style={{ verticalAlign: '-1px' }} /> {p2.session_count || 0} sessions</span>
                    </span>
                  </button>
                  <button className="bm-btn bm-btn-tonal bm-arc-log" onClick={() => onLogSession?.(p2)}>Log session</button>
                </div>
                {(arcChildren[p2.id] || []).map(c => (
                  <div key={c.id} className="bm-stack-member">
                    <button className="bm-chk" style={{ borderColor: 'var(--bm-gold)' }} onClick={() => onCompleteTask?.(c)} aria-label="Catch it" />
                    <button className="bm-row-body" onClick={() => onOpenTask?.(c)}>
                      <span className="bm-row-title">{c.title}</span>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section id="today" label="Today" count={dayTasks.length} collapsed={!!collapsed.today} onToggle={toggleSection}>
      <div className="bm-rows">
        {dayTasks.length === 0 && <p className="bm-empty">Nothing due — enjoy it.</p>}
        {dayTasks.map(t => {
          const done = false
          const overdue = !done && t.due_date && String(t.due_date).slice(0, 10) < todayKey
          const chips = (t.tags || []).map(id => labelsById[id]).filter(Boolean)
          const stale = !done && isStale(t)
          const ageDays = stale ? Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000) : 0
          const statusTag = t.status === 'doing' ? 'doing' : t.status === 'waiting' ? 'waiting' : null
          return (
            <RowSwipe key={t.id} done={done} onCatch={() => onCompleteTask?.(t)} onDelete={() => onDeleteTask?.(t)}>
              <div className="bm-row">
                <button
                  className={`bm-chk${done ? ' is-done' : ''}${t.high_priority ? ' is-hi' : ''}`}
                  onClick={() => onCompleteTask?.(t)}
                  aria-label={done ? 'Reopen' : 'Catch it'}
                >{done && <Check size={13} strokeWidth={3.4} />}</button>
                <button className="bm-row-body" onClick={() => onOpenTask?.(t)}>
                  <span className={`bm-row-title${done ? ' is-done' : ''}`}>{t.title}</span>
                  {!done && (overdue || stale || statusTag || t.high_priority || chips.length > 0) && (
                    <span className="bm-row-meta">
                      {t.high_priority && <span className="bm-tag-hi">high</span>}
                      {statusTag && <span className="bm-tag-status">{statusTag}</span>}
                      {overdue && <span className="bm-due-over">overdue</span>}
                      {stale && <span className="bm-tag-stale">{ageDays}d on list</span>}
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
      </Section>

      {anytimeTasks.length > 0 && (
        <Section id="anytime" label="Anytime" count={anytimeTasks.length} collapsed={!!collapsed.anytime} onToggle={toggleSection}>
          <div className="bm-rows">
            {anytimeTasks.map(t => {
              const chips = (t.tags || []).map(id => labelsById[id]).filter(Boolean)
              return (
                <RowSwipe key={t.id} onCatch={() => onCompleteTask?.(t)} onDelete={() => onDeleteTask?.(t)}>
                  <div className="bm-row">
                    <button className="bm-chk" onClick={() => onCompleteTask?.(t)} aria-label="Catch it" />
                    <button className="bm-row-body" onClick={() => onOpenTask?.(t)}>
                      <span className="bm-row-title">{t.title}</span>
                      {chips.length > 0 && (
                        <span className="bm-row-meta">
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
          </div>
        </Section>
      )}

      {loops.length > 0 && (
        <Section id="loops" label="Loops" count={`${loopsDone}/${loops.length}`} collapsed={!!collapsed.loops} onToggle={toggleSection}>
          <div className="bm-rows">
            {loops.map(({ r, color, byDay, rally, doneToday, isStack, cycles }) => {
              if (isStack && cycles.length === 0 && doneToday) {
                // Cleared-today receipt: the folder is done, keep the loop
                // visible + credited until midnight. Check is display-only —
                // un-clearing goes through reopening the member task.
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
                    <span className="bm-loop-chk is-done" aria-label="Cleared today"><Check size={15} strokeWidth={3.2} /></span>
                  </div>
                )
              }
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
        </Section>
      )}
    </div>
  )
}
