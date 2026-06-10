import { useMemo, useState } from 'react'
import {
  Search, Plus, Check, Sun, ArrowRight, AlertCircle, CalendarDays,
  Inbox, CheckCircle2, Pencil, Trash2, Timer, X, Calendar,
} from 'lucide-react'
import { localYMD, parseLocalDate } from './heatmapUtils'
import { isSnoozed } from '../store'
import { useSwipeActions } from '../hooks/useSwipeActions'
import './TasksView.css'

const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']
// Per-task checkbox color cycle — the --wb-cat-* palette plus the pause
// yellow (palette.css); pink-first per the loggd reference.
const CHECK_COLORS = ['#EA6C9D', '#F0973E', '#E6B43E', '#4F8DF5', '#41C083', '#8C7CF0']
function taskColor(id) {
  const s = String(id ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return CHECK_COLORS[h % CHECK_COLORS.length]
}
const SECTION_ICON = {
  overdue: AlertCircle, today: Sun, tomorrow: ArrowRight,
  soon: CalendarDays, anytime: Inbox, backlog: Inbox, done: CheckCircle2,
}

export default function TasksView({
  tasks = [], labels = [],
  onToggleComplete, onToggleItem, onOpenTask, onAdd, onReschedule, onDelete,
}) {
  const [tab, setTab] = useState('upcoming')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [sheetTask, setSheetTask] = useState(null)

  const labelsById = useMemo(() => {
    const m = {}; for (const l of labels) m[l.id] = l; return m
  }, [labels])

  const counts = useMemo(() => ({
    // Upcoming excludes snoozed tasks (routine spawns waiting on a trigger time,
    // "set aside" tasks) — they aren't actionable yet.
    upcoming: tasks.filter(t => ACTIVE.includes(t.status) && !t.gmail_pending && !t.parent_id && !isSnoozed(t)).length,
    backlog: tasks.filter(t => t.status === 'backlog' && !t.gmail_pending && !t.parent_id).length,
    done: tasks.filter(t => t.status === 'done').length,
  }), [tasks])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks.filter(t => {
      if (t.gmail_pending || t.parent_id) return false
      if (tab === 'done') { if (t.status !== 'done') return false }
      else if (tab === 'backlog') { if (t.status !== 'backlog') return false }
      else if (!ACTIVE.includes(t.status) || isSnoozed(t)) return false
      if (q && !t.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [tasks, tab, query])

  const sections = useMemo(() => groupTasks(visible, tab), [visible, tab])

  return (
    <div className="wb-tasks">
      <header className="wb-tasks-head">
        <div className="wb-tasks-titlerow">
          <h1 className="wb-tasks-title">Tasks</h1>
          <button
            className={`wb-icon-btn${searchOpen ? ' is-active' : ''}`}
            onClick={() => { setSearchOpen(o => !o); if (searchOpen) setQuery('') }}
            aria-label="Search tasks"
          ><Search size={18} strokeWidth={2} /></button>
        </div>

        <div className="wb-seg" role="tablist" aria-label="Task list">
          {[
            { id: 'upcoming', label: 'Upcoming', n: counts.upcoming },
            { id: 'backlog', label: 'Backlog', n: counts.backlog },
            { id: 'done', label: 'Done', n: counts.done },
          ].map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`wb-seg-btn${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >{t.label}{t.n ? <span className="wb-seg-count">{t.n}</span> : null}</button>
          ))}
        </div>

        {searchOpen && (
          <input
            className="wb-tasks-search"
            placeholder="Search tasks…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
        )}
      </header>

      <div className="wb-tasks-list">
        {sections.length === 0 && <p className="wb-tasks-empty">Nothing here.</p>}
        {sections.map(sec => {
          const SIcon = SECTION_ICON[sec.key] || CalendarDays
          return (
            <section key={sec.key} className="wb-tasks-section">
              <h2 className="wb-tasks-section-label">
                <SIcon size={13} strokeWidth={2.25} className="wb-tasks-section-icon" />
                {sec.label} <span className="wb-tasks-count">{sec.items.length}</span>
              </h2>
              {sec.items.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  labelsById={labelsById}
                  done={tab === 'done'}
                  onToggleComplete={onToggleComplete}
                  onToggleItem={onToggleItem}
                  onDelete={onDelete}
                  onOpen={() => setSheetTask(task)}
                />
              ))}
            </section>
          )
        })}
      </div>

      <button className="wb-fab wb-fab-tasks" onClick={onAdd} aria-label="New task"><Plus size={26} strokeWidth={2.5} /></button>

      {sheetTask && (
        <TaskActionSheet
          task={sheetTask}
          labelsById={labelsById}
          onClose={() => setSheetTask(null)}
          onEdit={() => { const t = sheetTask; setSheetTask(null); onOpenTask?.(t) }}
          onReschedule={(ymd) => { onReschedule?.(sheetTask, ymd); setSheetTask(null) }}
          onDelete={() => { onDelete?.(sheetTask); setSheetTask(null) }}
        />
      )}
    </div>
  )
}

function TaskRow({ task, labelsById, done, onToggleComplete, onToggleItem, onDelete, onOpen }) {
  const items = (Array.isArray(task.checklists) ? task.checklists : []).flatMap(cl =>
    (cl.items || []).map(it => ({ ...it, clId: cl.id })))
  const due = dueMeta(task.due_date)
  const tagChips = (task.tags || []).map(id => labelsById[id]).filter(Boolean)
  const color = taskColor(task.id)
  // Swipe-left reveals quick actions (parity with the v2 TaskCard).
  const swipe = useSwipeActions({ openOffset: -132 })
  const handleBody = () => { if (swipe.swiping) return; if (swipe.open) { swipe.close(); return } onOpen?.() }

  return (
    <div className="wb-task-swipe">
      <div className="wb-task-swipe-actions">
        <button
          className="wb-task-swipe-act wb-task-swipe-done"
          onClick={() => { onToggleComplete?.(task); swipe.close() }}
        >
          <Check size={16} strokeWidth={2.5} />{done ? 'Reopen' : 'Done'}
        </button>
        <button
          className="wb-task-swipe-act wb-task-swipe-del"
          onClick={() => { onDelete?.(task); swipe.close() }}
        >
          <Trash2 size={16} strokeWidth={2} />Delete
        </button>
      </div>
      <div
        className="wb-task"
        style={{ transform: swipe.x !== 0 ? `translateX(${swipe.x}px)` : undefined }}
        {...swipe.handlers}
      >
      <div className="wb-task-main">
        <button
          className={`wb-check${done ? ' is-done' : ''}`}
          style={done ? { background: color, borderColor: color } : { borderColor: color }}
          onClick={() => onToggleComplete?.(task)}
          aria-label={done ? 'Reopen task' : 'Complete task'}
        >{done && <Check size={14} strokeWidth={3} color="var(--wb-on-action)" />}</button>
        <button className="wb-task-body" onClick={handleBody}>
          <span className={`wb-task-title${done ? ' is-done' : ''}`}>{task.title}</span>
          {task.notes && !done && <span className="wb-task-sub">{task.notes.replace(/\s+/g, ' ').trim().slice(0, 80)}</span>}
          {(tagChips.length > 0 || due) && !done && (
            <span className="wb-task-meta">
              {due && <span className={`wb-task-due${due.tone ? ` wb-task-due-${due.tone}` : ''}`}>{due.label}</span>}
              {tagChips.map(l => <span key={l.id} className="wb-task-tag" style={{ '--tag': l.color }}>{l.name}</span>)}
            </span>
          )}
        </button>
      </div>
      {items.length > 0 && !done && (
        <ul className="wb-subtasks">
          {items.map(it => (
            <li key={it.id} className="wb-subtask">
              <button
                className={`wb-subcheck${it.completed ? ' is-done' : ''}`}
                onClick={() => onToggleItem?.(task, it.clId, it.id)}
                aria-label={it.completed ? 'Uncheck' : 'Check'}
              >{it.completed && <Check size={11} strokeWidth={3} />}</button>
              <span className={`wb-subtask-text${it.completed ? ' is-done' : ''}`}>{it.text}</span>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  )
}

function TaskActionSheet({ task, labelsById, onClose, onEdit, onReschedule, onDelete }) {
  const due = dueMeta(task.due_date)
  const tagChips = (task.tags || []).map(id => labelsById[id]).filter(Boolean)
  const ymd = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return localYMD(d) }
  const opts = [
    { label: 'Today', sub: '', act: () => onReschedule(ymd(0)) },
    { label: 'Tomorrow', sub: '', act: () => onReschedule(ymd(1)) },
    { label: 'Next week', sub: '', act: () => onReschedule(ymd(7)) },
    { label: 'No date', sub: '', act: () => onReschedule(null) },
  ]
  return (
    <div className="wb-sheet-backdrop" onClick={onClose}>
      <div className="wb-sheet" onClick={e => e.stopPropagation()}>
        <button className="wb-sheet-close" onClick={onClose} aria-label="Close"><X size={18} strokeWidth={2.25} /></button>
        <h3 className="wb-sheet-title">{task.title}</h3>
        <div className="wb-sheet-meta">
          {due && <span className={`wb-task-due${due.tone ? ` wb-task-due-${due.tone}` : ''}`}>{due.label}</span>}
          {tagChips.map(l => <span key={l.id} className="wb-task-tag" style={{ '--tag': l.color }}>{l.name}</span>)}
        </div>

        <div className="wb-sheet-section-label"><Calendar size={13} strokeWidth={2.25} /> Reschedule</div>
        <div className="wb-sheet-resched">
          {opts.map(o => (
            <button key={o.label} className="wb-sheet-chip" onClick={o.act}>{o.label}</button>
          ))}
        </div>

        <div className="wb-sheet-actions">
          <button className="wb-sheet-row is-soon" disabled><Timer size={17} strokeWidth={2} /> Start focus timer <span className="wb-sheet-soon">Soon</span></button>
          <button className="wb-sheet-row" onClick={onEdit}><Pencil size={16} strokeWidth={2} /> Edit task</button>
          <button className="wb-sheet-row wb-sheet-row-danger" onClick={onDelete}><Trash2 size={16} strokeWidth={2} /> Delete task</button>
        </div>
      </div>
    </div>
  )
}

function dueMeta(due) {
  if (!due) return null
  const today = localYMD(new Date())
  const d = localYMD(due)
  if (!d) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  // parseLocalDate: date-only strings are LOCAL days (naive new Date() reads
  // them as UTC midnight → off-by-one west of UTC).
  const dd = parseLocalDate(due); dd.setHours(0, 0, 0, 0)
  const diff = Math.round((dd - t) / 86400000)
  if (d < today) return { label: `${Math.abs(diff)}d overdue`, tone: 'overdue' }
  if (diff === 0) return { label: 'Today', tone: 'today' }
  if (diff === 1) return { label: 'Tomorrow' }
  if (diff < 7) return { label: dd.toLocaleDateString('en-US', { weekday: 'short' }) }
  return { label: dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
}

function groupTasks(list, tab) {
  if (tab === 'done') {
    const sorted = [...list].sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))
    return sorted.length ? [{ key: 'done', label: 'Completed', items: sorted.slice(0, 100) }] : []
  }
  if (tab === 'backlog') {
    return list.length ? [{ key: 'backlog', label: 'Backlog', items: list }] : []
  }
  const today = localYMD(new Date())
  const tmr = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return localYMD(d) })()
  const b = { overdue: [], today: [], tomorrow: [], soon: [], anytime: [] }
  for (const t of list) {
    if (!t.due_date) { b.anytime.push(t); continue }
    const d = localYMD(t.due_date)
    if (d < today) b.overdue.push(t)
    else if (d === today) b.today.push(t)
    else if (d === tmr) b.tomorrow.push(t)
    else b.soon.push(t)
  }
  const byDue = (x, y) => (x.due_date || '').localeCompare(y.due_date || '')
  const out = []
  if (b.overdue.length) out.push({ key: 'overdue', label: 'Overdue', items: b.overdue.sort(byDue) })
  if (b.today.length) out.push({ key: 'today', label: 'Today', items: b.today })
  if (b.tomorrow.length) out.push({ key: 'tomorrow', label: 'Tomorrow', items: b.tomorrow })
  if (b.soon.length) out.push({ key: 'soon', label: 'Upcoming', items: b.soon.sort(byDue) })
  if (b.anytime.length) out.push({ key: 'anytime', label: 'Anytime', items: b.anytime })
  return out
}
