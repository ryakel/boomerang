import { useMemo, useState } from 'react'
import { ArrowLeft, Search, Plus, Check } from 'lucide-react'
import { localYMD } from './heatmapUtils'
import './TasksView.css'

const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']

// Wallaby "Tasks" surface — loggd-style task list. Segmented Upcoming / Backlog,
// pink square checkboxes, nested checklist items as circular sub-checkboxes,
// colored label chips, green FAB. Reads Boomerang's task + label shape directly.
export default function TasksView({
  tasks = [], labels = [],
  onToggleComplete, onToggleItem, onAdd, onClose, onOpenTask,
}) {
  const [tab, setTab] = useState('upcoming')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const labelsById = useMemo(() => {
    const m = {}
    for (const l of labels) m[l.id] = l
    return m
  }, [labels])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks.filter(t => {
      if (t.gmail_pending) return false
      if (t.parent_id) return false
      if (tab === 'backlog' ? t.status !== 'backlog' : !ACTIVE.includes(t.status)) return false
      if (q && !t.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [tasks, tab, query])

  const sections = useMemo(() => groupTasks(visible, tab), [visible, tab])

  return (
    <div className="wb-tasks">
      <header className="wb-tasks-head">
        <div className="wb-tasks-titlerow">
          {onClose && (
            <button className="wb-back" onClick={onClose} aria-label="Back">
              <ArrowLeft size={20} strokeWidth={2.25} />
            </button>
          )}
          <h1 className="wb-tasks-title">Tasks</h1>
          <button
            className={`wb-icon-btn${searchOpen ? ' is-active' : ''}`}
            onClick={() => { setSearchOpen(o => !o); if (searchOpen) setQuery('') }}
            aria-label="Search tasks"
          >
            <Search size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="wb-seg" role="tablist" aria-label="Task list">
          {[{ id: 'upcoming', label: 'Upcoming' }, { id: 'backlog', label: 'Backlog' }].map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`wb-seg-btn${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
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
        {sections.length === 0 && (
          <p className="wb-tasks-empty">Nothing here.</p>
        )}
        {sections.map(sec => (
          <section key={sec.key} className="wb-tasks-section">
            <h2 className="wb-tasks-section-label">{sec.label} <span className="wb-tasks-count">{sec.items.length}</span></h2>
            {sec.items.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                labelsById={labelsById}
                onToggleComplete={onToggleComplete}
                onToggleItem={onToggleItem}
                onOpenTask={onOpenTask}
              />
            ))}
          </section>
        ))}
      </div>

      <button className="wb-fab wb-fab-tasks" onClick={onAdd} aria-label="New task">
        <Plus size={26} strokeWidth={2.5} />
      </button>
    </div>
  )
}

function TaskRow({ task, labelsById, onToggleComplete, onToggleItem, onOpenTask }) {
  const items = (Array.isArray(task.checklists) ? task.checklists : []).flatMap(cl =>
    (cl.items || []).map(it => ({ ...it, clId: cl.id })),
  )
  const due = dueMeta(task.due_date)
  const tagChips = (task.tags || []).map(id => labelsById[id]).filter(Boolean)

  return (
    <div className="wb-task">
      <div className="wb-task-main">
        <button
          className={`wb-check${task.high_priority ? ' wb-check-hi' : ''}`}
          onClick={() => onToggleComplete?.(task)}
          aria-label="Complete task"
        />
        <button className="wb-task-body" onClick={() => onOpenTask?.(task)}>
          <span className="wb-task-title">{task.title}</span>
          {(tagChips.length > 0 || due) && (
            <span className="wb-task-meta">
              {due && <span className={`wb-task-due${due.tone ? ` wb-task-due-${due.tone}` : ''}`}>{due.label}</span>}
              {tagChips.map(l => (
                <span key={l.id} className="wb-task-tag" style={{ '--tag': l.color }}>{l.name}</span>
              ))}
            </span>
          )}
        </button>
      </div>
      {items.length > 0 && (
        <ul className="wb-subtasks">
          {items.map(it => (
            <li key={it.id} className="wb-subtask">
              <button
                className={`wb-subcheck${it.completed ? ' is-done' : ''}`}
                onClick={() => onToggleItem?.(task, it.clId, it.id)}
                aria-label={it.completed ? 'Uncheck' : 'Check'}
              >
                {it.completed && <Check size={11} strokeWidth={3} />}
              </button>
              <span className={`wb-subtask-text${it.completed ? ' is-done' : ''}`}>{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function dueMeta(due) {
  if (!due) return null
  const today = localYMD(new Date())
  const d = localYMD(due)
  if (!d) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const dd = new Date(due); dd.setHours(0, 0, 0, 0)
  const diff = Math.round((dd - t) / 86400000)
  if (d < today) return { label: `${Math.abs(diff)}d overdue`, tone: 'overdue' }
  if (diff === 0) return { label: 'Today', tone: 'today' }
  if (diff === 1) return { label: 'Tomorrow' }
  if (diff < 7) return { label: dd.toLocaleDateString('en-US', { weekday: 'short' }) }
  return { label: dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
}

function groupTasks(list, tab) {
  if (tab === 'backlog') {
    return list.length ? [{ key: 'backlog', label: 'Backlog', items: list }] : []
  }
  const today = localYMD(new Date())
  const buckets = { overdue: [], today: [], soon: [], anytime: [] }
  for (const t of list) {
    if (!t.due_date) { buckets.anytime.push(t); continue }
    const d = localYMD(t.due_date)
    if (d < today) buckets.overdue.push(t)
    else if (d === today) buckets.today.push(t)
    else buckets.soon.push(t)
  }
  const byDue = (a, b) => (a.due_date || '').localeCompare(b.due_date || '')
  const out = []
  if (buckets.overdue.length) out.push({ key: 'overdue', label: 'Overdue', items: buckets.overdue.sort(byDue) })
  if (buckets.today.length) out.push({ key: 'today', label: 'Today', items: buckets.today })
  if (buckets.soon.length) out.push({ key: 'soon', label: 'Upcoming', items: buckets.soon.sort(byDue) })
  if (buckets.anytime.length) out.push({ key: 'anytime', label: 'Anytime', items: buckets.anytime })
  return out
}
