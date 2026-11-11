import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, Compass, CalendarDays, Clock, Bell, Inbox, ChevronRight, Check, X, Repeat2,
  Sunrise, Sun, Moon, StickyNote, Sprout, FolderKanban, Undo2, History, ChevronDown,
} from 'lucide-react'
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/dm-sans/opsz.css'
import { getTodayGrowthArea, gcalListEvents, gcalStatus } from '../api'
import { loadSettings, isCrisisTask, safeSetItem } from '../store'
import { buildImpactCtx } from '../impactContext'
import { localYMD } from '../dates'
import { buildTodayModel, normalizeEvents, recordNotNow } from '../todayModel'
import { routineFeathers } from './feathers'
import RowSwipe from './RowSwipe'
import './shell.css'
import './today2.css'

// Kept 2.0 Today. What shows and why lives in src/todayModel.js; this file only
// renders it and wires the existing handlers. No points, rally, arc or catches:
// that data is untouched and still lives in Analytics (the header's Flight log).
// The classic screen (TodayView.jsx) is one toggle away in Settings → General.

const NOT_NOW_KEY = 'boom_today_notnow'
const LASTNIGHT_KEY = 'boom_lastnight_hidden_on'   // shared with the classic screen
const ANYTIME_OPEN_KEY = 'boom_today_anytime_open'
const EVENTS_TTL_MS = 10 * 60 * 1000

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}

const clock = (msOrIso) => {
  const d = new Date(msOrIso)
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`
}
const minutesLabel = (min) => {
  if (min == null) return null
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r ? `${h} hr ${r} min` : `${h} hr`
}
const shortDate = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function attentionLabel(reason) {
  switch (reason.key) {
    case 'critical': return 'Critical'
    case 'reminder': return `Reminder ${clock(reason.at)}`
    case 'due': return 'Due today'
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
  if (m.allClear) return m.phase === 'evening' ? 'Winding down. Nothing needs you tonight.' : 'Nothing needs you right now.'
  if (m.phase === 'evening') return 'Winding down.'
  if (m.attention.items.length > 0) return m.phase === 'morning' ? 'A few things to handle today.' : 'A few things still need you.'
  return m.phase === 'morning' ? 'Nothing pressing this morning.' : 'Nothing pressing right now.'
}

const routineIcon = (r) => {
  const h = Number(String(r.trigger_time || '').split(':')[0])
  if (!Number.isFinite(h)) return Repeat2
  return h < 12 ? Sunrise : h < 17 ? Sun : Moon
}

// Calendar events for today and tomorrow, from the existing read-only
// GET /api/gcal/events. Not connected, offline or slow: no events, no error.
function useCalendarEvents(todayKey) {
  const [raw, setRaw] = useState(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // Ask once whether Google Calendar is connected before asking for events.
      const status = await gcalStatus().catch(() => null)
      if (cancelled) return
      if (!status?.connected) { setRaw(null); return }
      const s = loadSettings()
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const end = new Date(start); end.setDate(end.getDate() + 2)
      const calendars = [...new Set(['primary', s.gcal_calendar_id].filter(Boolean))]
      const results = await Promise.allSettled(calendars.map(c => gcalListEvents(start.toISOString(), end.toISOString(), c)))
      if (cancelled) return
      const ok = results.filter(r => r.status === 'fulfilled')
      if (ok.length === 0) { setRaw(null); return }
      const seen = new Set()
      const merged = []
      for (const r of ok) for (const e of r.value || []) { if (!seen.has(e.id)) { seen.add(e.id); merged.push(e) } }
      setRaw(merged)
    }
    load()
    const timer = setInterval(load, EVENTS_TTL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [todayKey])
  return raw
}

// The current minute, so time-based sections move without a reload.
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(new Date()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return now
}

function Ring({ color, onClick, label }) {
  return <button className="t2-ring" style={{ '--ring': color }} onClick={onClick} aria-label={label} />
}

function Head({ icon: Icon, color, title, count, onTitle }) {
  return (
    <div className="t2-head">
      <Icon size={15} strokeWidth={2} style={{ color }} aria-hidden="true" />
      {onTitle
        ? <button className="t2-head-title t2-head-link" onClick={onTitle}>{title}</button>
        : <h2 className="t2-head-title">{title}</h2>}
      {count != null && <span className="t2-head-count">{count}</span>}
    </div>
  )
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
  pinnedNotes = [], onOpenNotes, onUnpinNote, onShowTasks,
}) {
  const now = useNow()
  const todayKey = localYMD(now)
  const rawEvents = useCalendarEvents(todayKey)
  const settings = loadSettings()

  const [notNow, setNotNow] = useState(() => readJSON(NOT_NOW_KEY))
  const [lastNightHiddenOn, setLastNightHiddenOn] = useState(() => {
    try { return localStorage.getItem(LASTNIGHT_KEY) } catch { return null }
  })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [slippedOpen, setSlippedOpen] = useState(false)
  const [lastNightOpen, setLastNightOpen] = useState(false)
  const [expandedLines, setExpandedLines] = useState({})
  const [anytimeOpen, setAnytimeOpen] = useState(() => readJSON(ANYTIME_OPEN_KEY) === true)
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [growth, setGrowth] = useState(null)

  useEffect(() => {
    let cancelled = false
    getTodayGrowthArea().then(p => { if (!cancelled && p?.date) setGrowth(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [todayKey])

  const feathers = useMemo(() => routineFeathers(routines), [routines])
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
    const nextState = recordNotNow(notNow, todayKey, m.next.task.id, m.next.reasonKey)
    safeSetItem(NOT_NOW_KEY, JSON.stringify(nextState))
    setNotNow(nextState)
  }
  const hideLastNight = () => {
    safeSetItem(LASTNIGHT_KEY, todayKey)
    setLastNightHiddenOn(todayKey)
  }
  const toggleAnytime = () => {
    const v = !anytimeOpen
    safeSetItem(ANYTIME_OPEN_KEY, JSON.stringify(v))
    setAnytimeOpen(v)
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
    const soon = it.kind !== 'due' ? inLabel(it.at, m.nowMs) : null
    if (it.kind === 'event') {
      const e = it.event
      title = e.title
      const dur = e.endMs && e.startMs ? minutesLabel(Math.round((e.endMs - e.startMs) / 60000)) : null
      meta = [it.ongoing ? 'now' : soon, e.location, dur].filter(Boolean).join(' · ') || 'Calendar'
      bar = 'var(--bm-f-billabong)'
    } else if (it.kind === 'checklist') {
      title = it.routine.title
      meta = [soon, `checklist · ${it.count} ${it.count === 1 ? 'item' : 'items'}`].filter(Boolean).join(' · ')
      bar = feathers[it.routine.id] || 'var(--bm-ember)'
      Icon = Repeat2
      onClick = () => onEditLoop?.(it.routine)
    } else {
      title = it.task.title
      const kind = it.kind === 'reminder' ? 'Reminder' : it.kind === 'loop' ? 'loop' : it.kind === 'due' ? 'due' : 'back from snooze'
      meta = [soon, kind].filter(Boolean).join(' · ')
      bar = it.kind === 'reminder' ? 'var(--bm-gold)' : it.kind === 'loop' ? (feathers[it.routine?.id] || 'var(--bm-ember)') : 'var(--t2-hair2)'
      Icon = it.kind === 'reminder' ? Bell : it.kind === 'returns' ? Undo2 : it.kind === 'loop' ? Repeat2 : null
      onClick = () => onOpenTask?.(it.task)
    }
    const when = it.kind === 'due' ? 'Due' : clock(it.at)
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
      ? <button key={key} className={`t2-clock${i === 0 ? ' is-first' : ''}`} onClick={onClick}>{inner}</button>
      : <div key={key} className={`t2-clock${i === 0 ? ' is-first' : ''}`}>{inner}</div>
  })

  // The large all-clear only when the main path is otherwise empty; with
  // Tonight or Tomorrow to show, "nothing needs you" is the subtitle instead.
  const bigClear = m.allClear && m.later.items.length === 0 && m.tomorrow.items.length === 0
    && m.pinnedArcs.length === 0
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
      <section key="next" className="t2-card">
        <Head icon={Compass} color="var(--bm-ember)" title="Worth doing next" />
        <div className="t2-next">
          <span className="t2-next-title">{m.next.task.title}</span>
          <span className="t2-next-meta">
            <Clock size={12} strokeWidth={2} aria-hidden="true" />
            <span>{[m.next.minutes != null && `About ${minutesLabel(m.next.minutes)}`, ...m.next.reasons].filter(Boolean).join(' · ')}</span>
          </span>
          {m.next.fitsBefore && (
            <span className="t2-next-meta">Fits before {m.next.fitsBefore.title} at {clock(m.next.fitsBefore.startMs)}</span>
          )}
          <div className="t2-next-actions">
            <button className="t2-btn t2-btn-primary" onClick={() => onOpenTask?.(m.next.task)}>Open task</button>
            <button className="t2-btn t2-btn-ghost" onClick={dismissNext}>Not now</button>
          </div>
        </div>
      </section>
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
          {m.anytime.length > 0 && (
            <button className="t2-extra" onClick={toggleAnytime} aria-expanded={anytimeOpen}>
              Anytime · {m.anytime.length}
            </button>
          )}
          {onWhatNow && <button className="t2-extra" onClick={onWhatNow}>What now?</button>}
          {growthPick?.text && (
            <button className="t2-extra" onClick={() => setNudgeOpen(v => !v)} aria-expanded={nudgeOpen}>
              <Sprout size={12} strokeWidth={2} /> Today's nudge
            </button>
          )}
        </div>
        {nudgeOpen && growthPick?.text && <p className="t2-nudge">{growthPick.text}</p>}
        {anytimeOpen && m.anytime.length > 0 && (
          <section className="t2-card t2-anytime">
            {m.anytime.map((t, i) => (
              <TaskRow key={t.id} task={t} first={i === 0} ring="var(--t2-hair2)"
                onComplete={onCompleteTask} onOpen={onOpenTask} onDelete={onDeleteTask} />
            ))}
          </section>
        )}
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
      </div>

      {bigClear && (
        <section className="t2-clear">
          <span className="t2-clear-mark" aria-hidden="true"><Check size={20} strokeWidth={2.2} /></span>
          <h2 className="t2-clear-title">Nothing needs you right now.</h2>
          <p className="t2-clear-sub">Anything you throw in comes back when it matters.</p>
        </section>
      )}

      {m.order.map(id => blocks[id]?.())}

      {slippedOpen && (
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
      )}

      {reviewOpen && (
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
      )}
    </div>
  )
}
