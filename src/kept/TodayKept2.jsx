import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, Compass, CalendarDays, Clock, Bell, Inbox, ChevronRight, Check, X, Repeat2,
  Sunrise, Sun, Moon, StickyNote, Sprout, FolderKanban, Undo2, History, ChevronDown,
} from 'lucide-react'
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/dm-sans/opsz.css'
import { getTodayGrowthArea } from '../api'
import { loadSettings, isCrisisTask, safeSetItem } from '../store'
import { buildImpactCtx } from '../impactContext'
import { localYMD } from '../dates'
import { buildTodayModel, normalizeEvents } from '../todayModel'
import { routineFeathers } from './feathers'
import RowSwipe from './RowSwipe'
import { LASTNIGHT_KEY, useNotNow, clock, minutesLabel, useCalendarEvents, useNow } from './today2Hooks'
import { Ring, Head, NextCard } from './today2Parts'
import SheetPortal from './SheetPortal'
import TodayAlarm from './TodayAlarm'
import WeekPlan from './WeekPlan'
import './shell.css'
import './today2.css'

// Kept 2.0 Today. What shows and why lives in src/todayModel.js; this file only
// renders it and wires the existing handlers. No points, rally, arc or catches:
// Analytics counts completions (points and rally were removed, BOOM-33). The
// classic screen (TodayView.jsx) is gated off in src/kept/classicToday.js.



const shortDate = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function attentionLabel(reason) {
  switch (reason.key) {
    case 'critical': return 'Critical'
    case 'reminder': return `Reminder ${clock(reason.at)}`
    case 'due': return 'Due today'
    case 'pinned': return 'On Today until done'
    case 'committed': return 'Picked for today'
    case 'recent': return 'Was due yesterday'
    case 'back': return 'Back today'
    default: return null
  }
}

const inLabel = (atMs, nowMs) => {
  const min = Math.round((atMs - nowMs) / 60000)
  if (min <= 0 || min > 6 * 60) return null
  return `in ${minutesLabel(min)}`
}

function subtitle(m) {
  switch (m.headline) {
    case 'attention': return m.phase === 'morning' ? 'A few things to handle today.' : 'A few things still need you.'
    case 'next': return 'A good time to get ahead.'
    case 'evening': return 'Winding down.'
    case 'evening-clear': return 'Winding down. Nothing needs you tonight.'
    case 'clear': return m.phase === 'morning' ? 'Nothing pressing this morning.' : 'Nothing needs you right now.'
    default: return m.phase === 'morning' ? 'Nothing pressing this morning.' : 'Nothing pressing right now.'
  }
}

const routineIcon = (r) => {
  const h = Number(String(r.trigger_time || '').split(':')[0])
  if (!Number.isFinite(h)) return Repeat2
  return h < 12 ? Sunrise : h < 17 ? Sun : Moon
}

function TaskRow({ task, ring, meta, onComplete, onOpen, onDelete, first }) {
  const row = (
    <div className={`t2-row${first ? ' is-first' : ''}`} data-task-id={task.id}>
      <Ring color={ring} onClick={() => onComplete?.(task)} label={`Catch it: ${task.title}`} />
      <button className="t2-row-body" onClick={() => onOpen?.(task)}>
        <span className="t2-row-title">{task.title}</span>
        {meta && <span className="t2-row-meta">{meta}</span>}
      </button>
    </div>
  )
  return onDelete ? <RowSwipe onCatch={() => onComplete?.(task)} onDelete={() => onDelete(task)}>{row}</RowSwipe> : row
}

export default function TodayKept2({
  tasks = [], routines = [], labels = [], weatherByDate = null,
  onCompleteTask, onOpenTask, onDeleteTask, onEditLoop,
  onLogSession, onGmailKeep, onGmailDismiss, onWhatNow,
  onReconcileYesterday, onReconcileKeep,
  pinnedNotes = [], onOpenNotes, onUnpinNote, onShowTasks, onUpdateTask,
}) {
  const now = useNow()
  const todayKey = localYMD(now)
  const rawEvents = useCalendarEvents(todayKey)
  const settings = loadSettings()

  const [notNow, dismissNotNow] = useNotNow(todayKey)
  const [lastNightHiddenOn, setLastNightHiddenOn] = useState(() => {
    try { return localStorage.getItem(LASTNIGHT_KEY) } catch { return null }
  })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [slippedOpen, setSlippedOpen] = useState(false)
  const [lastNightOpen, setLastNightOpen] = useState(false)
  const [expandedLines, setExpandedLines] = useState({})
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [growth, setGrowth] = useState(null)

  useEffect(() => {
    let cancelled = false
    getTodayGrowthArea().then(p => { if (!cancelled && p?.date) setGrowth(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [todayKey])

  const feathers = useMemo(() => routineFeathers(routines), [routines])
  const routineById = useMemo(() => Object.fromEntries(routines.map(r => [r.id, r])), [routines])
  const events = useMemo(() => (rawEvents ? normalizeEvents(rawEvents, tasks) : null), [rawEvents, tasks])
  const m = useMemo(() => buildTodayModel({
    tasks, routines, settings, now, events,
    rankCtx: buildImpactCtx({ labels, weatherByDate }),
    isCrisis: t => isCrisisTask(t, settings),
    notNow,
    lastNightHidden: lastNightHiddenOn === todayKey,
  // settings is read fresh each render on purpose (Settings saves don't notify).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tasks, routines, now, events, labels, weatherByDate, notNow, lastNightHiddenOn, todayKey])

  const dismissNext = () => {
    if (!m.next) return
    dismissNotNow(m.next.task.id, m.next.reasonKey)
  }
  const hideLastNight = () => {
    safeSetItem(LASTNIGHT_KEY, todayKey)
    setLastNightHiddenOn(todayKey)
  }

  const growthPick = growth ? (now.getHours() >= 17 && growth.evening?.text ? growth.evening : growth.morning?.text ? growth.morning : growth.evening) : null
  const lineKey = (c) => `${c.routine.id}|${c.due}`
  const fullLists = m.checklists.filter(c => c.tier === 'full' || expandedLines[lineKey(c)])
  const lineLists = m.checklists.filter(c => c.tier === 'line' && !expandedLines[lineKey(c)])

  const checklistCard = (c) => {
    const color = feathers[c.routine.id] || 'var(--bm-ember)'
    return (
      <section key={lineKey(c)} className="t2-card">
        <Head icon={routineIcon(c.routine)} color={color} title={c.routine.title}
          count={`${c.done} of ${c.total}`} onTitle={() => onEditLoop?.(c.routine)} />
        {c.open.map((t, i) => (
          <TaskRow key={t.id} task={t} ring={color} first={i === 0} onComplete={onCompleteTask} onOpen={onOpenTask} />
        ))}
      </section>
    )
  }

  const clockRows = (items) => items.map((it, i) => {
    const key = it.event ? `e-${it.event.id}` : it.routine && it.kind === 'checklist' ? `c-${it.routine.id}` : `t-${it.task.id}`
    let title, meta, bar, Icon = null, onClick = null
    // A countdown is appointment language; a snoozed task coming back doesn't get one.
    const soon = it.kind !== 'due' && !it.snoozed ? inLabel(it.at, m.nowMs) : null
    if (it.kind === 'event') {
      const e = it.event
      title = e.title
      const dur = !e.allDay && e.endMs && e.startMs ? minutesLabel(Math.round((e.endMs - e.startMs) / 60000)) : null
      // A block is this task's own focus time: it opens the task (BOOM-57).
      const blockTask = e.blockTaskId ? tasks.find(t => t.id === e.blockTaskId) : null
      meta = [it.ongoing ? 'now' : soon, blockTask ? 'focus block' : null, e.allDay ? 'all day' : null, e.location, dur, blockTask ? null : e.calendar].filter(Boolean).join(' · ') || 'Calendar'
      bar = blockTask ? 'var(--bm-ember)' : 'var(--bm-f-billabong)'
      if (blockTask) onClick = () => onOpenTask?.(blockTask)
    } else if (it.kind === 'checklist') {
      title = it.routine.title
      meta = [soon, `checklist · ${it.count} ${it.count === 1 ? 'item' : 'items'}`].filter(Boolean).join(' · ')
      bar = feathers[it.routine.id] || 'var(--bm-ember)'
      Icon = Repeat2
      onClick = () => onEditLoop?.(it.routine)
    } else {
      title = it.task.title
      const kind = it.waiting ? 'waiting on someone'
        : it.snoozed ? (it.kind === 'loop' ? 'Snoozed loop · comes back' : 'Snoozed task · comes back')
          : it.kind === 'reminder' ? 'Reminder'
            : it.kind === 'due' ? (it.task.routine_id ? `${routineById[it.task.routine_id]?.cadence || 'repeating'} loop` : 'due')
              : 'loop'
      meta = [soon, kind].filter(Boolean).join(' · ')
      bar = it.snoozed ? 'var(--t2-faint)' : it.kind === 'reminder' ? 'var(--bm-gold)' : it.kind === 'loop' ? (feathers[it.routine?.id] || 'var(--bm-ember)') : 'var(--t2-hair2)'
      Icon = it.kind === 'reminder' ? Bell : it.kind === 'returns' ? Undo2 : it.kind === 'loop' ? Repeat2 : null
      onClick = () => onOpenTask?.(it.task)
    }
    // Beyond tomorrow the day matters more than the clock.
    const farDay = it.day && it.day !== m.todayKey && it.day !== m.tomorrowKey
    const when = farDay ? new Date(it.at).toLocaleDateString('en-US', { weekday: 'short' })
      : it.allDay ? 'All day' : it.kind === 'due' ? 'Due' : clock(it.at)
    const inner = (
      <>
        <span className="t2-clock-time">{when}</span>
        <span className="t2-clock-bar" style={{ background: bar }} aria-hidden="true" />
        <span className="t2-clock-body">
          <span className="t2-clock-title">{title}</span>
          <span className="t2-row-meta t2-clock-meta">{Icon && <Icon size={12} strokeWidth={2} style={{ color: bar }} aria-hidden="true" />}{meta}</span>
        </span>
      </>
    )
    return onClick
      ? <button key={key} className={`t2-clock${i === 0 ? ' is-first' : ''}${it.snoozed ? ' is-snoozed' : ''}`} onClick={onClick}>{inner}</button>
      : <div key={key} className={`t2-clock${i === 0 ? ' is-first' : ''}${it.snoozed ? ' is-snoozed' : ''}`}>{inner}</div>
  })

  // The large all-clear only when the main path is otherwise empty; with
  // Tonight or Tomorrow to show, "nothing needs you" is the subtitle instead.
  const bigClear = m.allClear && m.later.items.length === 0 && m.tomorrow.items.length === 0
    && m.upcoming.items.length === 0 && m.pinnedArcs.length === 0
  const slippedCount = m.needsReview.slipped.length
  const waitingCount = m.needsReview.waiting.length

  // One renderer per block; the model decides the order (morning/day vs evening).
  const blocks = {
    attention: () => m.attention.items.length > 0 && (
      <section key="attention" className="t2-card">
        <Head icon={AlertCircle} color="var(--bm-ember)" title="Needs attention"
          count={m.attention.items.length + m.attention.overflow} />
        {m.attention.items.map(({ task: t, reason }, i) => {
          const crit = reason.key === 'critical'
          const extra = []
          if (t.status === 'doing' || t.status === 'in_progress') extra.push('doing')
          if (reason.key !== 'reminder' && t.remind_at && localYMD(new Date(t.remind_at)) === m.todayKey) extra.push(`reminder ${clock(t.remind_at)}`)
          if (t.assignee) extra.push(`for ${t.assignee}`)
          return (
            <TaskRow key={t.id} task={t} first={i === 0}
              ring={crit ? 'var(--bm-danger)' : 'var(--bm-ember)'}
              meta={<><span className={`t2-why${crit ? ' is-over' : ''}`}>{attentionLabel(reason)}</span>{extra.length > 0 && <> · {extra.join(' · ')}</>}</>}
              onComplete={onCompleteTask} onOpen={onOpenTask} onDelete={onDeleteTask} />
          )
        })}
        {m.attention.overflow > 0 && (
          <button className="t2-more" onClick={() => onShowTasks?.()}>
            {m.attention.overflow} more in Tasks <ChevronRight size={14} strokeWidth={2} />
          </button>
        )}
      </section>
    ),

    next: () => m.next && (
      <NextCard key="next" next={m.next} onOpen={onOpenTask} onDismiss={dismissNext} />
    ),

    later: () => m.later.items.length > 0 && (
      <section key="later" className="t2-card">
        <Head icon={m.phase === 'evening' ? Moon : CalendarDays} color="var(--bm-ember)" title={m.later.label} />
        {clockRows(m.later.items)}
      </section>
    ),

    tomorrow: () => m.tomorrow.items.length > 0 && (
      <section key="tomorrow" className="t2-card">
        <Head icon={CalendarDays} color="var(--bm-ember)" title="Tomorrow" count={m.tomorrow.items.length} />
        {clockRows(m.tomorrow.items)}
      </section>
    ),

    upcoming: () => m.upcoming.items.length > 0 && (
      <section key="upcoming" className="t2-card">
        <Head icon={CalendarDays} color="var(--bm-ember)" title={m.upcoming.label} />
        {clockRows(m.upcoming.items)}
      </section>
    ),

    checklists: () => fullLists.length > 0 && <div key="checklists" className="t2-stack">{fullLists.map(checklistCard)}</div>,

    loops: () => m.loopTasks.length > 0 && (
      <section key="loops" className="t2-card">
        <Head icon={Repeat2} color="var(--bm-ember)" title="Loops" count={m.loopTasks.length} />
        {m.loopTasks.map(({ task: t, routine: r, overdueDays }, i) => (
          <TaskRow key={t.id} task={t} first={i === 0} ring={feathers[r.id] || 'var(--bm-ember)'}
            meta={overdueDays > 0 ? `${r.cadence || 'loop'} · from ${overdueDays === 1 ? 'yesterday' : `${overdueDays} days ago`}` : (r.cadence || 'loop')}
            onComplete={onCompleteTask} onOpen={onOpenTask} onDelete={onDeleteTask} />
        ))}
      </section>
    ),

    arcs: () => m.pinnedArcs.length > 0 && (
      <section key="arcs" className="t2-card">
        <Head icon={FolderKanban} color="var(--bm-gold)" title="Arcs" count={m.pinnedArcs.length} />
        {m.pinnedArcs.map(({ arc, children }, i) => (
          <div key={arc.id}>
            <div className={`t2-row t2-row-actions${i === 0 ? ' is-first' : ''}`}>
              <button className="t2-row-body" onClick={() => onOpenTask?.(arc)}>
                <span className="t2-row-title">{arc.title}</span>
                <span className="t2-row-meta">{arc.session_count || 0} sessions</span>
              </button>
              <button className="t2-chip" onClick={() => onLogSession?.(arc)}>Log session</button>
            </div>
            {children.map(c => (
              <TaskRow key={c.id} task={c} ring="var(--bm-gold)" onComplete={onCompleteTask} onOpen={onOpenTask} />
            ))}
          </div>
        ))}
      </section>
    ),

    // Bookkeeping: each is one compact row that opens on demand.
    quiet: () => (
      <div key="quiet" className="t2-quiet">
        {m.lastNight.length > 0 && (
          <div className="t2-quiet-group">
            <button className="t2-qrow" onClick={() => setLastNightOpen(v => !v)} aria-expanded={lastNightOpen}>
              <Moon size={15} strokeWidth={2} aria-hidden="true" />
              <span className="t2-qrow-text"><b>Last night</b> · {m.lastNight.length} to sort</span>
              {lastNightOpen ? <ChevronDown size={15} strokeWidth={2} className="t2-faint" /> : <ChevronRight size={15} strokeWidth={2} className="t2-faint" />}
            </button>
            {lastNightOpen && (
              <div className="t2-qpanel">
                {m.lastNight.map(({ task: t, kind }, i) => (
                  <div key={t.id} className={`t2-row t2-row-actions${i === 0 ? ' is-first' : ''}`}>
                    <button className="t2-row-body" onClick={() => onOpenTask?.(t)}>
                      <span className="t2-row-title">{t.title}</span>
                      <span className="t2-row-meta">{kind === 'ticked' ? 'ticked this morning' : 'still open'}</span>
                    </button>
                    <button className="t2-chip" onClick={() => onReconcileYesterday?.(t)}>
                      <Check size={13} strokeWidth={2.6} /> Yesterday
                    </button>
                    <button className="t2-x" onClick={() => onReconcileKeep?.(t)}
                      aria-label={kind === 'ticked' ? 'Keep it on today' : 'Still open'}>
                      <X size={15} strokeWidth={2.2} />
                    </button>
                  </div>
                ))}
                <button className="t2-more" onClick={hideLastNight}>Not now</button>
              </div>
            )}
          </div>
        )}

        {m.needsReview.count > 0 && (
          <button className="t2-qrow" onClick={() => setSlippedOpen(true)}>
            <History size={15} strokeWidth={2} aria-hidden="true" />
            <span className="t2-qrow-text">
              {slippedCount > 0 && <><b>{slippedCount}</b> slipped past {slippedCount === 1 ? 'its date' : 'their dates'}</>}
              {slippedCount > 0 && waitingCount > 0 && ' · '}
              {waitingCount > 0 && <><b>{waitingCount}</b> waiting a while</>}
            </span>
            <ChevronRight size={15} strokeWidth={2} className="t2-faint" />
          </button>
        )}

        {m.review.count > 0 && (
          <button className="t2-qrow" onClick={() => setReviewOpen(true)}>
            <Inbox size={15} strokeWidth={2} aria-hidden="true" />
            <span className="t2-qrow-text">
              <b>{m.review.count}</b> {m.review.count === 1 ? 'suggestion' : 'suggestions'}{m.review.source ? ` from ${m.review.source}` : ''} to review
            </span>
            <ChevronRight size={15} strokeWidth={2} className="t2-faint" />
          </button>
        )}

        {lineLists.map(c => (
          <button key={lineKey(c)} className="t2-qrow"
            onClick={() => setExpandedLines(s => ({ ...s, [lineKey(c)]: true }))}>
            <span className="t2-line-ring" style={{ '--ring': feathers[c.routine.id] || 'var(--bm-ember)' }} aria-hidden="true" />
            <span className="t2-qrow-text"><b>{c.routine.title}</b> · {c.open.length} left{c.note ? ` ${c.note}` : ''}</span>
            <ChevronRight size={15} strokeWidth={2} className="t2-faint" />
          </button>
        ))}

        <div className="t2-extras">
          {onWhatNow && <button className="t2-extra" onClick={onWhatNow}>What now?</button>}
          {growthPick?.text && (
            <button className="t2-extra" onClick={() => setNudgeOpen(v => !v)} aria-expanded={nudgeOpen}>
              <Sprout size={12} strokeWidth={2} /> Today's nudge
            </button>
          )}
        </div>
        {nudgeOpen && growthPick?.text && <p className="t2-nudge">{growthPick.text}</p>}
      </div>
    ),
  }

  return (
    <div className="bm-surface bm-t2">
      {pinnedNotes.map(n => (
        <div key={n.id} className="bm-note-sticky" onClick={() => onOpenNotes?.()} role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') onOpenNotes?.() }}>
          <span className="bm-note-sticky-icon"><StickyNote size={15} strokeWidth={2} /></span>
          <span className="bm-note-sticky-text">{n.body}</span>
          <button className="bm-note-sticky-unpin" onClick={e => { e.stopPropagation(); onUnpinNote?.(n) }}
            aria-label="Unpin note" title="Unpin (keeps the note in Notes)">
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>
      ))}

      <div className="t2-date">
        <div className="t2-date-line">
          <h1 className="t2-day">{now.toLocaleDateString('en-US', { weekday: 'long' })}</h1>
          <span className="t2-date-sub">{now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
        {!bigClear && <p className="t2-subtitle">{subtitle(m)}</p>}
        {m.allDayToday?.length > 0 && (
          <p className="t2-allday">
            <CalendarDays size={13} strokeWidth={2} aria-hidden="true" />
            <span>{m.allDayToday.map(e => e.calendar ? `${e.title} (${e.calendar})` : e.title).join(' · ')}</span>
          </p>
        )}
      </div>

      {/* Today's alarm (BOOM-51). Renders only on the Dev native build, and
          only when an alarm is armed for today or an arming is running out. */}
      <TodayAlarm />

      {/* The week (BOOM-59): priorities with their blocks, and the Friday review. */}
      <WeekPlan tasks={tasks} todayKey={todayKey} onCompleteTask={onCompleteTask} onOpenTask={onOpenTask}
        onUpdateTask={onUpdateTask} onGmailKeep={onGmailKeep} onGmailDismiss={onGmailDismiss} />

      {bigClear && (
        <section className="t2-clear">
          <span className="t2-clear-mark" aria-hidden="true"><Check size={20} strokeWidth={2.2} /></span>
          <h2 className="t2-clear-title">Nothing needs you right now.</h2>
          <p className="t2-clear-sub">Anything you throw in comes back when it matters.</p>
        </section>
      )}

      {m.order.map(id => blocks[id]?.())}

      {slippedOpen && (
        <SheetPortal>
        <div className="bm-sheet-backdrop" onClick={() => setSlippedOpen(false)}>
          <div className="bm-sheet bm-t2 t2-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="To look over">
            <div className="bm-grabber" />
            <h2 className="bm-sheet-title">To look over</h2>
            <p className="t2-sheet-sub">Not late, just undecided. Open one to give it a new date, or let it go.</p>
            {slippedCount > 0 && <h3 className="t2-sheet-group">Slipped past their dates</h3>}
            {m.needsReview.slipped.map(({ task: t, since }, i) => (
              <TaskRow key={t.id} task={t} first={i === 0} ring="var(--t2-hair2)"
                meta={`was ${t.due_date ? 'due' : 'a reminder for'} ${shortDate(new Date(`${since}T12:00:00`).getTime())}`}
                onComplete={onCompleteTask} onOpen={(x) => { setSlippedOpen(false); onOpenTask?.(x) }} />
            ))}
            {waitingCount > 0 && <h3 className="t2-sheet-group">Waiting a while</h3>}
            {m.needsReview.waiting.map(({ task: t, days }, i) => (
              <TaskRow key={t.id} task={t} first={i === 0} ring="var(--t2-hair2)"
                meta={`waiting ${days} days · maybe check in`}
                onComplete={onCompleteTask} onOpen={(x) => { setSlippedOpen(false); onOpenTask?.(x) }} />
            ))}
          </div>
        </div>
        </SheetPortal>
      )}

      {reviewOpen && (
        <SheetPortal>
        <div className="bm-sheet-backdrop" onClick={() => setReviewOpen(false)}>
          <div className="bm-sheet bm-t2 t2-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Suggestions to review">
            <div className="bm-grabber" />
            <h2 className="bm-sheet-title">Suggestions to review</h2>
            <p className="t2-sheet-sub">Nothing here is on your list until you keep it.</p>
            {m.review.items.length === 0 && <p className="t2-sheet-sub">All reviewed.</p>}
            {m.review.items.map((t, i) => (
              <div key={t.id} className={`t2-row t2-row-actions${i === 0 ? ' is-first' : ''}`}>
                <button className="t2-row-body" onClick={() => { setReviewOpen(false); onOpenTask?.(t) }}>
                  <span className="t2-row-title">{t.title}</span>
                  <span className="t2-row-meta">from {t.gmail_message_id ? 'Gmail' : t.notion_page_id ? 'Notion' : 'an import'}</span>
                </button>
                <button className="t2-chip" onClick={() => onGmailKeep?.(t)}><Check size={13} strokeWidth={2.6} /> Keep</button>
                <button className="t2-x" onClick={() => onGmailDismiss?.(t)} aria-label="Dismiss"><X size={15} strokeWidth={2.2} /></button>
              </div>
            ))}
          </div>
        </div>
        </SheetPortal>
      )}
    </div>
  )
}
