import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, Compass, CalendarDays, Clock, Bell, Inbox, ChevronRight, Check, X, Repeat2,
  Sunrise, Sun, Moon, StickyNote, Sprout, FolderKanban, Undo2,
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

function attentionLabel(reason, todayKey) {
  switch (reason.key) {
    case 'critical': return 'Critical'
    case 'overdue': return reason.days === 1 ? 'Overdue since yesterday' : `Overdue ${reason.days} days`
    case 'due': return 'Due today'
    case 'reminder': return localYMD(new Date(reason.at)) === todayKey
      ? `Reminder ${clock(reason.at)}` : `Reminder passed ${shortDate(reason.at)}`
    case 'back': return 'Back today'
    default: return null
  }
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
  const fullLists = m.checklists.filter(c => c.tier === 'full')
  const lineLists = m.checklists.filter(c => c.tier === 'line' && !expandedLines[`${c.routine.id}|${c.due}`])
  const openedLines = m.checklists.filter(c => c.tier === 'line' && expandedLines[`${c.routine.id}|${c.due}`])

  const checklistSection = (c) => {
    const color = feathers[c.routine.id] || 'var(--bm-ember)'
    return (
      <section key={`${c.routine.id}|${c.due}`} className="t2-open">
        <Head icon={routineIcon(c.routine)} color={color} title={c.routine.title}
          count={`${c.done} of ${c.total}`} onTitle={() => onEditLoop?.(c.routine)} />
        {c.open.map((t, i) => (
          <TaskRow key={t.id} task={t} ring={color} first={i === 0} onComplete={onCompleteTask} onOpen={onOpenTask} />
        ))}
      </section>
    )
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
        <h1 className="t2-day">{now.toLocaleDateString('en-US', { weekday: 'long' })}</h1>
        <span className="t2-date-sub">{now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>

      {m.allClear && (
        <section className="t2-clear">
          <span className="t2-clear-mark" aria-hidden="true"><Check size={20} strokeWidth={2.2} /></span>
          <h2 className="t2-clear-title">Nothing needs you right now.</h2>
          <p className="t2-clear-sub">Anything you throw in comes back when it matters.</p>
        </section>
      )}

      {m.attention.items.length > 0 && (
        <section className="t2-card">
          <Head icon={AlertCircle} color="var(--bm-ember)" title="Needs attention"
            count={m.attention.items.length + m.attention.overflow} />
          {m.attention.items.map(({ task: t, reason }, i) => {
            const extra = []
            if (t.status === 'waiting') extra.push('waiting')
            if (t.status === 'doing' || t.status === 'in_progress') extra.push('doing')
            if (reason.key !== 'reminder' && t.remind_at && localYMD(new Date(t.remind_at)) === m.todayKey) extra.push(`reminder ${clock(t.remind_at)}`)
            if (t.assignee) extra.push(`for ${t.assignee}`)
            return (
              <TaskRow key={t.id} task={t} first={i === 0}
                ring={reason.key === 'critical' || reason.key === 'overdue' ? 'var(--bm-danger)' : 'var(--bm-ember)'}
                meta={<><span className={`t2-why${reason.key === 'overdue' || reason.key === 'critical' ? ' is-over' : ''}`}>{attentionLabel(reason, m.todayKey)}</span>{extra.length > 0 && <> · {extra.join(' · ')}</>}</>}
                onComplete={onCompleteTask} onOpen={onOpenTask} onDelete={onDeleteTask} />
            )
          })}
          {m.attention.overflow > 0 && (
            <button className="t2-more" onClick={() => onShowTasks?.()}>
              {m.attention.overflow} more in Tasks <ChevronRight size={14} strokeWidth={2} />
            </button>
          )}
        </section>
      )}

      {m.lastNight.length > 0 && (
        <section className="t2-open">
          <Head icon={Moon} color="var(--t2-meta)" title="Last night" count={m.lastNight.length} />
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
        </section>
      )}

      {fullLists.map(checklistSection)}
      {openedLines.map(checklistSection)}

      {m.loopTasks.length > 0 && (
        <section className="t2-open">
          <Head icon={Repeat2} color="var(--t2-meta)" title="Loops" count={m.loopTasks.length} />
          {m.loopTasks.map(({ task: t, routine: r, overdueDays }, i) => (
            <TaskRow key={t.id} task={t} first={i === 0} ring={feathers[r.id] || 'var(--bm-ember)'}
              meta={overdueDays > 0 ? `${r.cadence || 'loop'} · due ${overdueDays === 1 ? 'yesterday' : `${overdueDays} days ago`}` : (r.cadence || 'loop')}
              onComplete={onCompleteTask} onOpen={onOpenTask} onDelete={onDeleteTask} />
          ))}
        </section>
      )}

      {m.next && (
        <section className="t2-card">
          <Head icon={Compass} color="var(--t2-meta)" title="Worth doing next" />
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
              <button className="t2-btn t2-btn-tonal" onClick={() => onOpenTask?.(m.next.task)}>Open task</button>
              <button className="t2-btn t2-btn-ghost" onClick={dismissNext}>Not now</button>
            </div>
          </div>
        </section>
      )}

      {lineLists.map(c => (
        <button key={`${c.routine.id}|${c.due}`} className="t2-line"
          onClick={() => setExpandedLines(s => ({ ...s, [`${c.routine.id}|${c.due}`]: true }))}>
          <span className="t2-line-ring" style={{ '--ring': feathers[c.routine.id] || 'var(--bm-ember)' }} aria-hidden="true" />
          <span className="t2-line-text">
            <b>{c.routine.title}</b> · {c.open.length} left{c.note ? ` ${c.note}` : ''}
          </span>
          <ChevronRight size={15} strokeWidth={2} className="t2-faint" />
        </button>
      ))}

      {m.coming.items.length > 0 && (
        <section className="t2-open">
          <Head icon={CalendarDays} color="var(--t2-meta)" title={m.coming.label} />
          {m.coming.items.map((it, i) => {
            const key = it.event ? `e-${it.event.id}` : it.routine && it.kind === 'checklist' ? `c-${it.routine.id}` : `t-${it.task.id}`
            let title, meta, bar, Icon = null, onClick = null
            if (it.kind === 'event') {
              const e = it.event
              title = e.title
              const dur = e.endMs && e.startMs ? minutesLabel(Math.round((e.endMs - e.startMs) / 60000)) : null
              meta = [it.ongoing ? 'now' : null, e.location, dur].filter(Boolean).join(' · ') || 'Calendar'
              bar = 'var(--bm-f-billabong)'
            } else if (it.kind === 'checklist') {
              title = it.routine.title
              meta = `checklist · ${it.count} ${it.count === 1 ? 'item' : 'items'}`
              bar = feathers[it.routine.id] || 'var(--bm-ember)'
              Icon = Repeat2
              onClick = () => onEditLoop?.(it.routine)
            } else {
              title = it.task.title
              meta = it.kind === 'reminder' ? 'Reminder' : it.kind === 'loop' ? 'loop' : it.kind === 'due' ? 'due' : 'back from snooze'
              bar = it.kind === 'reminder' ? 'var(--bm-gold)' : it.kind === 'loop' ? (feathers[it.routine?.id] || 'var(--bm-ember)') : 'var(--t2-hair2)'
              Icon = it.kind === 'reminder' ? Bell : it.kind === 'returns' ? Undo2 : it.kind === 'loop' ? Repeat2 : null
              onClick = () => onOpenTask?.(it.task)
            }
            const when = it.kind === 'due'
              ? new Date(it.at).toLocaleDateString('en-US', { weekday: 'short' })
              : clock(it.at)
            const body = (
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
              ? <button key={key} className={`t2-clock${i === 0 ? ' is-first' : ''}`} onClick={onClick}>{body}</button>
              : <div key={key} className={`t2-clock${i === 0 ? ' is-first' : ''}`}>{body}</div>
          })}
        </section>
      )}

      {m.pinnedArcs.length > 0 && (
        <section className="t2-open">
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
      )}

      {m.review.count > 0 && (
        <button className="t2-review" onClick={() => setReviewOpen(true)}>
          <Inbox size={16} strokeWidth={2} aria-hidden="true" />
          <span className="t2-review-text">
            <b>{m.review.count}</b> {m.review.count === 1 ? 'suggestion' : 'suggestions'}{m.review.source ? ` from ${m.review.source}` : ''} to review
          </span>
          <ChevronRight size={15} strokeWidth={2} className="t2-faint" />
        </button>
      )}

      {/* Quiet extras: everything the classic screen had that isn't a section here. */}
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
        <section className="t2-open t2-anytime">
          {m.anytime.map((t, i) => (
            <TaskRow key={t.id} task={t} first={i === 0} ring="var(--t2-hair2)"
              onComplete={onCompleteTask} onOpen={onOpenTask} onDelete={onDeleteTask} />
          ))}
        </section>
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
