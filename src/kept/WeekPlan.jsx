import { useMemo, useState } from 'react'
import { Check, ChevronRight, CalendarClock, Flag, Inbox, X } from 'lucide-react'
import { Ring, Head } from './today2Parts'
import SheetPortal from './SheetPortal'
import BlockSheet from './BlockSheet'
import { blockLabel } from '../blockModel'
import { safeSetItem } from '../store'
import { MAX_PRIORITIES, weekPriorities, reviewState, reviewWeek, isReviewDay, priorityCandidates, priorityUpdates, dueInWeek, weekStart } from '../weekPlan'

// The week on Today (BOOM-59): this week's 2–3 priorities at the top, each
// with its block (BOOM-57), and on Friday through Sunday the weekly review.
// The review never notifies and nothing counts it. Skipping it only hides the
// offer for that weekend, on this device: it is an offer, not a record.

const SKIP_KEY = 'boom_week_review_skipped'
const readSkip = () => { try { return localStorage.getItem(SKIP_KEY) } catch { return null } }
const fmtWeek = (week) => new Date(`${week}T12:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })
const dayShort = (key) => new Date(`${key}T12:00`).toLocaleDateString([], { weekday: 'short' })

export default function WeekPlan({ tasks = [], todayKey, onCompleteTask, onOpenTask, onUpdateTask, onGmailKeep, onGmailDismiss }) {
  const [skipped, setSkipped] = useState(readSkip)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [blockFor, setBlockFor] = useState(null)
  const now = Date.now()
  const priorities = useMemo(() => weekPriorities(tasks, todayKey), [tasks, todayKey])
  const review = useMemo(() => reviewState({ tasks, dayKey: todayKey, skippedWeek: skipped }), [tasks, todayKey, skipped])
  if (!onUpdateTask) return null

  const skip = () => { safeSetItem(SKIP_KEY, review.week); setSkipped(review.week) }
  const live = blockFor ? tasks.find(t => t.id === blockFor) : null

  return (
    <>
      {review.state === 'offer' && (
        <section className="t2-card wk-offer" aria-label="Weekly review">
          <Head icon={Flag} color="var(--bm-ember)" title="Weekly review" />
          <p className="wk-sub">Fifteen minutes: clear the inbox, look at next week, pick two or three priorities.</p>
          <div className="wk-actions">
            <button className="t2-btn t2-btn-ghost" onClick={skip}>Not this week</button>
            <button className="t2-btn t2-btn-primary" onClick={() => setReviewOpen(true)}>Start</button>
          </div>
        </section>
      )}

      {priorities.length > 0 && (
        <section className="t2-card" aria-label="This week">
          <Head icon={Flag} color="var(--bm-ember)" title="This week" />
          {priorities.map((t, i) => {
            const block = blockLabel(t, now)
            return (
              <div key={t.id} className={`t2-row t2-row-actions${i === 0 ? ' is-first' : ''}`} data-task-id={t.id}>
                <Ring color="var(--bm-ember)" onClick={() => onCompleteTask?.(t)} label={`Catch it: ${t.title}`} />
                <button className="t2-row-body" onClick={() => onOpenTask?.(t)}>
                  <span className="t2-row-title">{t.title}</span>
                  <span className="t2-row-meta">{block ? `Blocked ${block}` : 'No block yet'}</span>
                </button>
                <button className="t2-chip" onClick={() => setBlockFor(t.id)}>
                  <CalendarClock size={13} strokeWidth={2.4} /> {block ? 'Move' : 'Block'}
                </button>
              </div>
            )
          })}
          {!isReviewDay(todayKey) && <button className="t2-more" onClick={() => setReviewOpen(true)}>Change this week’s priorities</button>}
        </section>
      )}

      {review.state === 'planned' && (
        <div className="t2-quiet">
          <button className="t2-qrow" onClick={() => setReviewOpen(true)}>
            <Flag size={15} strokeWidth={2} aria-hidden="true" />
            <span className="t2-qrow-text"><b>Week of {fmtWeek(review.week)}</b> · {review.picked.map(t => t.title).join(', ')}</span>
            <ChevronRight size={15} strokeWidth={2} className="t2-faint" />
          </button>
        </div>
      )}

      {priorities.length === 0 && !isReviewDay(todayKey) && (
        <div className="t2-quiet">
          <button className="t2-qrow" onClick={() => setReviewOpen(true)}>
            <Flag size={15} strokeWidth={2} aria-hidden="true" />
            <span className="t2-qrow-text">Pick this week’s priorities</span>
            <ChevronRight size={15} strokeWidth={2} className="t2-faint" />
          </button>
        </div>
      )}

      {reviewOpen && (
        <WeekReviewSheet tasks={tasks} todayKey={todayKey} onClose={() => setReviewOpen(false)}
          onUpdateTask={onUpdateTask} onGmailKeep={onGmailKeep} onGmailDismiss={onGmailDismiss} onOpenTask={onOpenTask} />
      )}
      {live && <BlockSheet task={live} updateTask={onUpdateTask} onClose={() => setBlockFor(null)} />}
    </>
  )
}

export function WeekReviewSheet({ tasks, todayKey, onClose, onUpdateTask, onGmailKeep, onGmailDismiss, onOpenTask }) {
  const week = reviewWeek(todayKey)
  const planningNext = week !== weekStart(todayKey)
  const inbox = tasks.filter(t => t.gmail_pending && !['done', 'cancelled'].includes(t.status))
  const coming = useMemo(() => dueInWeek(tasks, week), [tasks, week])
  const candidates = useMemo(() => priorityCandidates(tasks, todayKey, week), [tasks, todayKey, week])
  const [picked, setPicked] = useState(() => tasks.filter(t => t.week_priority === week && !t.gmail_pending && !['done', 'cancelled'].includes(t.status)).map(t => t.id))
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)

  const others = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const seen = new Set([...candidates.map(c => c.task.id), ...picked])
    return tasks.filter(t => !seen.has(t.id) && !t.gmail_pending && ['not_started', 'doing', 'waiting', 'open', 'in_progress'].includes(t.status)
      && (t.title || '').toLowerCase().includes(q)).slice(0, 8)
  }, [query, candidates, tasks, picked])

  const toggle = (id) => {
    if (picked.includes(id)) { setPicked(picked.filter(x => x !== id)); setError(null) }
    else if (picked.length >= MAX_PRIORITIES) setError('Two or three is the point. Unpick one first.')
    else { setPicked([...picked, id]); setError(null) }
  }
  // A pick found through search stays visible after the search is cleared.
  const extra = picked.filter(id => !candidates.some(c => c.task.id === id)).map(id => tasks.find(t => t.id === id)).filter(Boolean)
  const save = () => {
    for (const [id, patch] of priorityUpdates(tasks, week, picked)) onUpdateTask(id, patch)
    onClose()
  }
  const pickRow = (t, why, i) => {
    const on = picked.includes(t.id)
    return (
      <button key={t.id} className={`t2-row wk-pick${on ? ' is-on' : ''}${i === 0 ? ' is-first' : ''}`} aria-pressed={on} onClick={() => toggle(t.id)}>
        <span className="wk-check" aria-hidden="true">{on && <Check size={13} strokeWidth={3} />}</span>
        <span className="t2-row-body wk-pick-body">
          <span className="t2-row-title">{t.title}</span>
          {why && <span className="t2-row-meta">{why}</span>}
        </span>
      </button>
    )
  }

  return (
    <SheetPortal>
      <div className="bm-sheet-backdrop" onClick={onClose}>
        <div className="bm-sheet bm-t2 t2-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Weekly review">
          <div className="bm-grabber" />
          <h2 className="bm-sheet-title">{planningNext ? `Week of ${fmtWeek(week)}` : 'This week'}</h2>
          <p className="t2-sheet-sub">Clear the inbox, look ahead, pick two or three. That’s all.</p>

          <h3 className="t2-sheet-group"><Inbox size={13} strokeWidth={2} aria-hidden="true" /> Inbox</h3>
          {inbox.length === 0 && <p className="wk-empty">Inbox is clear.</p>}
          {inbox.map((t, i) => (
            <div key={t.id} className={`t2-row t2-row-actions${i === 0 ? ' is-first' : ''}`}>
              <button className="t2-row-body" onClick={() => { onClose(); onOpenTask?.(t) }}>
                <span className="t2-row-title">{t.title}</span>
                <span className="t2-row-meta">from {t.gmail_message_id ? 'Gmail' : t.notion_page_id ? 'Notion' : 'an import'}</span>
              </button>
              <button className="t2-chip" onClick={() => onGmailKeep?.(t)}><Check size={13} strokeWidth={2.6} /> Keep</button>
              <button className="t2-x" onClick={() => onGmailDismiss?.(t)} aria-label={`Dismiss ${t.title}`}><X size={15} strokeWidth={2.2} /></button>
            </div>
          ))}

          <h3 className="t2-sheet-group">{planningNext ? 'Due next week' : 'Due this week'}</h3>
          {coming.length === 0 && <p className="wk-empty">Nothing has a date that week.</p>}
          {coming.slice(0, 8).map(t => (
            <p key={t.id} className="wk-due"><b>{dayShort(t.due_date)}</b> {t.title}</p>
          ))}
          {coming.length > 8 && <p className="wk-due wk-faint">and {coming.length - 8} more</p>}

          <h3 className="t2-sheet-group">Pick up to {MAX_PRIORITIES} · {picked.length} picked</h3>
          {extra.map((t, i) => pickRow(t, null, i))}
          {candidates.map(({ task: t, why }, i) => pickRow(t, why === 'picked' ? null : why, i + extra.length))}
          <input className="wk-search" placeholder="Something else? Search your tasks" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search tasks" />
          {others.map((t, i) => pickRow(t, null, i))}
          {error && <p className="al-note al-error" role="alert">{error}</p>}

          <div className="wk-actions">
            <button className="t2-btn t2-btn-ghost" onClick={onClose}>Cancel</button>
            <button className="t2-btn t2-btn-primary" onClick={save}>{picked.length ? `Save ${picked.length}` : 'Save with none'}</button>
          </div>
        </div>
      </div>
    </SheetPortal>
  )
}
