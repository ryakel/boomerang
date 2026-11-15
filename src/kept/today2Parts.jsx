import { Compass, Clock } from 'lucide-react'
import { clock, minutesLabel } from './today2Hooks'

// Kept 2.0 building blocks shared by Today and the Tasks list. Styles live in
// today2.css under .bm-t2, so a caller renders these inside a .bm-t2 wrapper.

export function Ring({ color, onClick, label }) {
  return <button className="t2-ring" style={{ '--ring': color }} onClick={onClick} aria-label={label} />
}

export function Head({ icon: Icon, color, title, count, onTitle }) {
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

// "Worth doing next": one recommendation with a reason about time. The pick
// itself comes from todayModel (buildTodayModel().next).
export function NextCard({ next, onOpen, onDismiss }) {
  return (
    <section className="t2-card">
      <Head icon={Compass} color="var(--bm-ember)" title="Worth doing next" />
      <div className="t2-next">
        <span className="t2-next-title">{next.task.title}</span>
        <span className="t2-next-meta">
          <Clock size={12} strokeWidth={2} aria-hidden="true" />
          <span>{[next.minutes != null && `About ${minutesLabel(next.minutes)}`, ...next.reasons].filter(Boolean).join(' · ')}</span>
        </span>
        {next.fitsBefore && (
          <span className="t2-next-meta">Fits before {next.fitsBefore.title} at {clock(next.fitsBefore.startMs)}</span>
        )}
        <div className="t2-next-actions">
          <button className="t2-btn t2-btn-primary" onClick={() => onOpen?.(next.task)}>Open task</button>
          <button className="t2-btn t2-btn-ghost" onClick={onDismiss}>Not now</button>
        </div>
      </div>
    </section>
  )
}
