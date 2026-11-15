import { useMemo, useState } from 'react'
import { AlertCircle, Sun, CalendarDays, History, CalendarClock, PlayCircle, Inbox, Hourglass, Check } from 'lucide-react'
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/dm-sans/opsz.css'
import { loadSettings, isCrisisTask, safeSetItem } from '../store'
import { buildImpactCtx } from '../impactContext'
import { buildTodayModel, normalizeEvents, recordNotNow, SIZE_MINUTES } from '../todayModel'
import { groupUpcoming, slippedChoices, ymd, SLIPPED_SHOWN, ANYTIME_SHOWN } from '../tasksModel'
import { NOT_NOW_KEY, LASTNIGHT_KEY, readJSON, minutesLabel, useCalendarEvents, useNow } from './today2Hooks'
import { Ring, Head, NextCard } from './today2Parts'
import RowSwipe from './RowSwipe'
import WeatherBadge from '../components/WeatherBadge'
import { resolveWeatherVisibility } from '../components/WeatherSection'
import './shell.css'
import './today2.css'

// The Tasks list's Upcoming tab on Kept 2.0 rules (BOOM-37). Which group a task
// lands in lives in src/tasksModel.js; the Worth doing next pick is Today's own
// (todayModel's buildTodayModel, same inputs, same Not now state), so the two
// screens never recommend different things and a pick never shows twice.

const RING = 'var(--bm-ember)'
const RING_QUIET = 'var(--t2-hair2)'
const weekday = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
const longDate = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const shortDate = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const sizeLabel = (t) => (SIZE_MINUTES[t.size] != null ? `About ${minutesLabel(SIZE_MINUTES[t.size])}` : null)

export default function TasksUpcoming({
  visible = [], tasks = [], routines = [], labels = [], labelsById = {}, weatherByDate = null, filtered = false,
  onToggleComplete, onToggleItem, onOpenSheet, onOpenTask, onDelete, onReschedule, onStatusChange,
}) {
  const now = useNow()
  const todayKey = ymd(now)
  const rawEvents = useCalendarEvents(todayKey)
  const settings = loadSettings()
  const isCrisis = (t) => isCrisisTask(t, settings)
  const [notNow, setNotNow] = useState(() => readJSON(NOT_NOW_KEY))
  const [slippedOpen, setSlippedOpen] = useState(false)
  const [anytimeOpen, setAnytimeOpen] = useState(false)
  const [letGone, setLetGone] = useState([])   // [{ id, title, prevStatus }] for inline Undo

  const events = useMemo(() => (rawEvents ? normalizeEvents(rawEvents, tasks) : null), [rawEvents, tasks])
  // Same call Today makes, so the pick is identical; only `.next` is used here.
  const next = useMemo(() => {
    if (filtered) return null
    let lastNightHidden = false
    try { lastNightHidden = localStorage.getItem(LASTNIGHT_KEY) === todayKey } catch { /* storage blocked */ }
    return buildTodayModel({
      tasks, routines, settings, now, events,
      rankCtx: buildImpactCtx({ labels, weatherByDate }),
      isCrisis, notNow, lastNightHidden,
    }).next
  // settings is read fresh each render on purpose (Settings saves don't notify).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, tasks, routines, now, events, labels, weatherByDate, notNow, todayKey])

  const g = useMemo(() => groupUpcoming({
    tasks: visible, routines, now, excludeIds: next ? [next.task.id] : [], isCrisis,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [visible, routines, now, next])

  const dismissNext = () => {
    if (!next) return
    const state = recordNotNow(notNow, todayKey, next.task.id, next.reasonKey)
    safeSetItem(NOT_NOW_KEY, JSON.stringify(state))
    setNotNow(state)
  }
  const letGo = (t) => {
    setLetGone(list => [{ id: t.id, title: t.title, prevStatus: t.status }, ...list.filter(x => x.id !== t.id)])
    onStatusChange?.(t.id, 'cancelled')
  }
  const undoLetGo = (x) => {
    setLetGone(list => list.filter(y => y.id !== x.id))
    onStatusChange?.(x.id, x.prevStatus || 'not_started')
  }

  const tagDots = (t) => (t.tags || []).map(id => labelsById[id]).filter(Boolean).slice(0, 2)
    .map(l => <span key={l.id} className="bm-tagdot" style={{ '--tag': l.color }}><i />{l.name}</span>)
  const weather = (t, due) => {
    if (!due || !weatherByDate) return null
    if (resolveWeatherVisibility({ task: t, labels, weatherEnabled: true }) !== 'visible') return null
    const day = weatherByDate[due]
    return day ? <WeatherBadge day={day} /> : null
  }

  const row = ({ task: t, due }, i, { meta = [], ring = RING, extra = null } = {}) => {
    const subItems = (Array.isArray(t.checklists) ? t.checklists : []).flatMap(cl => (cl.items || []).map(it => ({ ...it, clId: cl.id })))
    const text = meta.filter(m => typeof m === 'string').join(' · ')
    const metaNodes = [...meta.filter(m => m && typeof m !== 'string'), text || null, weather(t, due), t.diy_verdict === 'hire' ? <span key="hire" className="bm-tag-hire">🛠 hire it out</span> : null, ...tagDots(t)].filter(Boolean)
    return (
      <RowSwipe key={t.id} onCatch={() => onToggleComplete?.(t)} onDelete={() => onDelete?.(t)}>
        <div className={`t2-row${i === 0 ? ' is-first' : ''}`} data-task-id={t.id}>
          <Ring color={ring} onClick={() => onToggleComplete?.(t)} label={`Catch it: ${t.title}`} />
          <div className="t2-row-body" style={{ cursor: 'default' }}>
            <button className="t2-row-body" onClick={() => onOpenSheet?.(t)}>
              <span className="t2-row-title">{t.title}</span>
              {metaNodes.length > 0 && <span className="t2-row-meta">{metaNodes.map((n, k) => (typeof n === 'string' ? <span key={k}>{n}</span> : n))}</span>}
            </button>
            {subItems.length > 0 && (
              <ul className="bm-subtasks">
                {subItems.map(it => (
                  <li key={it.id} className="bm-subtask">
                    <button className={`bm-subcheck${it.completed ? ' is-done' : ''}`} onClick={() => onToggleItem?.(t, it.clId, it.id)} aria-label={it.completed ? 'Uncheck' : 'Check'}>
                      {it.completed && <Check size={10} strokeWidth={3} />}
                    </button>
                    <span className={`bm-subtask-text${it.completed ? ' is-done' : ''}`}>{it.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {extra}
          </div>
        </div>
      </RowSwipe>
    )
  }

  const choices = slippedChoices(now)
  const slippedShown = slippedOpen ? g.slipped : g.slipped.slice(0, SLIPPED_SHOWN)
  const anytimeShown = anytimeOpen ? g.anytime : g.anytime.slice(0, ANYTIME_SHOWN)
  const total = Object.values(g).reduce((n, list) => n + list.length, 0)

  if (!next && total === 0 && letGone.length === 0) return <p className="bm-empty">Nothing here.</p>

  return (
    <div className="bm-t2 t2-tasks">
      {g.critical.length > 0 && (
        <section className="t2-card">
          <Head icon={AlertCircle} color="var(--bm-danger)" title="Critical" count={g.critical.length} />
          {g.critical.map((e, i) => row(e, i, { ring: 'var(--bm-danger)', meta: [<span key="c" className="t2-crit">Critical</span>, e.due ? longDate(e.due) : null] }))}
        </section>
      )}

      {next && <NextCard next={next} onOpen={onOpenTask} onDismiss={dismissNext} />}

      {g.today.length > 0 && (
        <section className="t2-card">
          <Head icon={Sun} color="var(--bm-ember)" title="Today" count={g.today.length} />
          {g.today.map((e, i) => row(e, i, {
            meta: [e.routine ? `Loop · ${e.routine.cadence || 'routine'}` : sizeLabel(e.task)],
          }))}
        </section>
      )}

      {g.week.length > 0 && (
        <section className="t2-card">
          <Head icon={CalendarDays} color="var(--bm-ember)" title="This week" count={g.week.length} />
          {g.week.map((e, i) => (
            <RowSwipe key={e.task.id} onCatch={() => onToggleComplete?.(e.task)} onDelete={() => onDelete?.(e.task)}>
              <button className={`t2-clock${i === 0 ? ' is-first' : ''}`} data-task-id={e.task.id} onClick={() => onOpenSheet?.(e.task)}>
                <span className="t2-clock-time">{weekday(e.due)}</span>
                <span className="t2-clock-bar" />
                <span className="t2-clock-body">
                  <span className="t2-clock-title">{e.task.title}</span>
                  <span className="t2-row-meta t2-clock-meta">
                    {[e.routine ? `Loop · ${e.routine.cadence || 'routine'}` : sizeLabel(e.task), e.task.high_priority ? 'marked high priority' : null].filter(Boolean).join(' · ')}
                    {weather(e.task, e.due)}
                  </span>
                </span>
              </button>
            </RowSwipe>
          ))}
        </section>
      )}

      {(g.slipped.length > 0 || letGone.length > 0) && (
        <section className="t2-card">
          <Head icon={History} color="var(--t2-meta)" title="Slipped past their dates" count={g.slipped.length || null} />
          {g.slipped.length > 0 && <p className="t2-card-sub">Not late, just undecided. Give it a new day, or let it go. Tap one for any other date.</p>}
          {letGone.map(x => (
            <div key={x.id} className="t2-undo-row">
              <b>Let go: {x.title}</b>
              <button className="t2-letgo" onClick={() => undoLetGo(x)}>Undo</button>
            </div>
          ))}
          {slippedShown.map((e, i) => row(e, letGone.length ? i + 1 : i, {
            ring: RING_QUIET,
            meta: [`was due ${longDate(e.due)}`, e.task.high_priority ? 'marked high priority' : null],
            extra: (
              <div className="t2-picks">
                {choices.map(c => (
                  <button key={c.key} className="t2-pick" onClick={() => onReschedule?.(e.task, c.ymd)}>{c.label}</button>
                ))}
                <button className="t2-letgo" onClick={() => letGo(e.task)}>Let it go</button>
              </div>
            ),
          }))}
          {g.slipped.length > SLIPPED_SHOWN && (
            <button className="t2-more" onClick={() => setSlippedOpen(o => !o)}>
              {slippedOpen ? 'Show fewer' : `Show ${g.slipped.length - SLIPPED_SHOWN} more`}
            </button>
          )}
        </section>
      )}

      {g.later.length > 0 && (
        <section className="t2-card">
          <Head icon={CalendarClock} color="var(--bm-ember)" title="Later" count={g.later.length} />
          {g.later.map((e, i) => row(e, i, { meta: [shortDate(e.due), e.routine ? `Loop · ${e.routine.cadence || 'routine'}` : null] }))}
        </section>
      )}

      {g.started.length > 0 && (
        <section className="t2-card">
          <Head icon={PlayCircle} color="var(--bm-ember)" title="Started" count={g.started.length} />
          {g.started.map((e, i) => row(e, i))}
        </section>
      )}

      {g.anytime.length > 0 && (
        <section className="t2-card">
          <Head icon={Inbox} color="var(--bm-ember)" title="Anytime" count={g.anytime.length} />
          {anytimeShown.map((e, i) => row(e, i))}
          {g.anytime.length > ANYTIME_SHOWN && (
            <button className="t2-more" onClick={() => setAnytimeOpen(o => !o)}>
              {anytimeOpen ? 'Show fewer' : `Show ${g.anytime.length - ANYTIME_SHOWN} more`}
            </button>
          )}
        </section>
      )}

      {g.waiting.length > 0 && (
        <section className="t2-card">
          <Head icon={Hourglass} color="var(--bm-ember)" title="Waiting on someone" count={g.waiting.length} />
          {g.waiting.map((e, i) => row(e, i, {
            meta: [
              e.due ? (e.due < todayKey ? `expected ${longDate(e.due)}` : `expected ${weekday(e.due)}`) : null,
              e.days == null ? null : e.days === 0 ? 'since today' : `waiting ${e.days} day${e.days === 1 ? '' : 's'}`,
              e.checkIn ? 'maybe check in' : null,
            ],
          }))}
        </section>
      )}
    </div>
  )
}
