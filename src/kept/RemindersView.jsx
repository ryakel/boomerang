import { useMemo } from 'react'
import { AlarmClock, Plus, X } from 'lucide-react'
import { localYMD } from '../dates'
import './shell.css'

// Kept "Reminders" — every task carrying a remind_at, in time order.
//
// Requested as "a way for me to understand what tasks are actual reminders".
// It is a LENS, not a container: these are ordinary tasks that happen to have
// a moment attached, and they still live in Today/Tasks alongside everything
// else. Nothing exists only here, which is why completing one is done from the
// row it already has rather than duplicating the action.
//
// Grouped by how soon rather than by day, because the question this surface
// answers is "what is about to go off", not "what does my calendar look like".

const fmt = (iso, withDay) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, withDay
    ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { hour: 'numeric', minute: '2-digit' })
}

const ACTIVE = ['not_started', 'doing', 'waiting']

export default function RemindersView({ tasks = [], onOpenTask, onClearReminder, onNewReminder }) {
  const groups = useMemo(() => {
    const now = Date.now()
    const today = localYMD()
    const withReminders = tasks
      .filter(t => t.remind_at && ACTIVE.includes(t.status) && !t.parent_id)
      .sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))

    const past = [], todayList = [], upcoming = []
    for (const t of withReminders) {
      const d = new Date(t.remind_at)
      if (Number.isNaN(d.getTime())) continue
      // "Passed" means the moment is gone and the task is still open — the
      // alarm rang and nothing happened, which is the state most worth seeing.
      if (d.getTime() < now) past.push(t)
      else if (localYMD(d) === today) todayList.push(t)
      else upcoming.push(t)
    }
    return { past, todayList, upcoming }
  }, [tasks])

  const total = groups.past.length + groups.todayList.length + groups.upcoming.length

  const row = (t, withDay) => (
    <div key={t.id} className="bm-row">
      <button className="bm-row-body" onClick={() => onOpenTask?.(t)}>
        <span className="bm-row-title">{t.title}</span>
        <span className="bm-row-meta">
          <span className="bm-tag-status">⏰ {fmt(t.remind_at, withDay)}</span>
          {t.due_date && <span className="bm-tag-status">due {String(t.due_date).slice(5)}</span>}
        </span>
      </button>
      {onClearReminder && (
        <button
          className="bm-more-row-x"
          aria-label={`Clear the reminder on ${t.title}`}
          title="Clear this reminder — the task stays"
          onClick={() => onClearReminder(t)}
          style={{ background: 'none', border: 0, padding: '0 8px', color: 'var(--bm-text-meta)', cursor: 'pointer' }}
        >
          <X size={15} strokeWidth={2} />
        </button>
      )}
    </div>
  )

  // No <h1> here: ModalShell already renders the "Reminders" title, and
  // repeating it inside the body printed the word twice down the page.
  return (
    <div className="bm-surface">
      {onNewReminder && (
        // A lens over tasks still needs a way to MAKE one. Without this the
        // surface that exists to answer "what is about to go off" was the one
        // place in the app you could not set something off.
        <button className="bm-btn bm-btn-fill bm-reminders-new" onClick={onNewReminder}>
          <Plus size={15} strokeWidth={2.2} /> New reminder
        </button>
      )}

      {total === 0 && (
        <p className="bm-empty">
          Nothing set. Throw a task and tap <strong>Remind</strong>, or open any task and use its
          Remind chip to give it a time.
        </p>
      )}

      {groups.past.length > 0 && (<>
        <div className="bm-sec"><AlarmClock size={13} strokeWidth={2} /> Passed <span className="bm-sec-n">{groups.past.length}</span></div>
        <div className="bm-rows">{groups.past.map(t => row(t, true))}</div>
      </>)}

      {groups.todayList.length > 0 && (<>
        <div className="bm-sec">Later today <span className="bm-sec-n">{groups.todayList.length}</span></div>
        <div className="bm-rows">{groups.todayList.map(t => row(t, false))}</div>
      </>)}

      {groups.upcoming.length > 0 && (<>
        <div className="bm-sec">Upcoming <span className="bm-sec-n">{groups.upcoming.length}</span></div>
        <div className="bm-rows">{groups.upcoming.map(t => row(t, true))}</div>
      </>)}
    </div>
  )
}
