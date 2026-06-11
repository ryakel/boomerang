import { useMemo, useState } from 'react'
import { Check, Search, Pencil, Trash2, Calendar, X } from 'lucide-react'
import { localYMD, parseLocalDate, addDays } from '../dates'
import { isSnoozed } from '../store'
import RowSwipe from './RowSwipe'
import Section, { useCollapsedSections } from './Section'
import './shell.css'

const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']
const TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'done', label: 'Done' },
]

// Kept "Tasks" — grouped hairline rows, gold circle checks, dot-tags, and the
// action sheet with reschedule chips ("throw it back") (spec §6).
export default function TasksViewKept({ tasks = [], labels = [], onToggleComplete, onOpenTask, onDelete, onReschedule }) {
  const [tab, setTab] = useState('upcoming')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [sheetTask, setSheetTask] = useState(null)
  const [collapsed, toggleSection] = useCollapsedSections()
  const labelsById = useMemo(() => { const m = {}; for (const l of labels) m[l.id] = l; return m }, [labels])

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
    <div className="bm-surface">
      <div className="bm-title-row">
        <h1 className="bm-h1">Tasks</h1>
        <button
          className="bm-back" style={{ marginLeft: 'auto' }}
          onClick={() => { setSearchOpen(o => !o); if (searchOpen) setQuery('') }}
          aria-label="Search tasks"
        ><Search size={16} strokeWidth={2} /></button>
      </div>
      <div className="bm-seg" role="tablist" aria-label="Task list">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
            className={`bm-seg-btn${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {searchOpen && (
        <input
          className="bm-throw-input"
          placeholder="Search tasks…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
      )}

      {sections.length === 0 && <p className="bm-empty">Nothing here.</p>}
      {sections.map(sec => (
        <div key={sec.key}>
          <Section id={`tasks-${sec.key}`} label={sec.label} count={sec.items.length} collapsed={!!collapsed[`tasks-${sec.key}`]} onToggle={toggleSection}>
          <div className="bm-rows">
            {sec.items.map(t => {
              const done = t.status === 'done'
              const due = dueMeta(t.due_date)
              const chips = (t.tags || []).map(id => labelsById[id]).filter(Boolean)
              return (
                <RowSwipe key={t.id} done={done} onCatch={() => onToggleComplete?.(t)} onDelete={() => onDelete?.(t)}>
                  <div className="bm-row">
                    <button
                      className={`bm-chk${done ? ' is-done' : ''}`}
                      onClick={() => onToggleComplete?.(t)}
                      aria-label={done ? 'Reopen' : 'Catch it'}
                    >{done && <Check size={13} strokeWidth={3.4} />}</button>
                    <button className="bm-row-body" onClick={() => setSheetTask(t)}>
                      <span className={`bm-row-title${done ? ' is-done' : ''}`}>{t.title}</span>
                      {!done && (due || chips.length > 0) && (
                        <span className="bm-row-meta">
                          {due && <span className={due.tone === 'over' ? 'bm-due-over' : due.tone === 'hot' ? 'bm-due-hot' : undefined}>{due.label}</span>}
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
        </div>
      ))}

      {sheetTask && (
        <div className="bm-sheet-backdrop" onClick={() => setSheetTask(null)}>
          <div className="bm-sheet" onClick={e => e.stopPropagation()}>
            <div className="bm-grabber" />
            <h3 className="bm-sheet-title">{sheetTask.title}</h3>
            <div className="bm-chip-row">
              {[
                { label: 'Today', ymd: localYMD() },
                { label: 'Tomorrow', ymd: localYMD(addDays(new Date(), 1)) },
                { label: 'Next week', ymd: localYMD(addDays(new Date(), 7)) },
                { label: '↩ No date', ymd: null },
              ].map(o => (
                <button key={o.label} className="bm-pick" onClick={() => { onReschedule?.(sheetTask, o.ymd); setSheetTask(null) }}>{o.label}</button>
              ))}
            </div>
            <button className="bm-sheet-row" onClick={() => { const t = sheetTask; setSheetTask(null); onOpenTask?.(t) }}>
              <Pencil size={16} strokeWidth={2} /> Edit task
            </button>
            <button className="bm-sheet-row is-danger" onClick={() => { onDelete?.(sheetTask); setSheetTask(null) }}>
              <Trash2 size={16} strokeWidth={2} /> Delete
            </button>
            <button className="bm-sheet-row" onClick={() => setSheetTask(null)} style={{ color: 'var(--bm-text-meta)' }}>
              <X size={16} strokeWidth={2} /> Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function dueMeta(due) {
  if (!due) return null
  const today = localYMD()
  const d = localYMD(due)
  if (!d) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const dd = parseLocalDate(due); dd.setHours(0, 0, 0, 0)
  const diff = Math.round((dd - t) / 86400000)
  if (d < today) return { label: `${Math.abs(diff)}d overdue`, tone: 'over' }
  if (diff === 0) return { label: 'today', tone: 'hot' }
  if (diff === 1) return { label: 'tomorrow' }
  if (diff < 7) return { label: dd.toLocaleDateString('en-US', { weekday: 'short' }) }
  return { label: dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
}

function groupTasks(list, tab) {
  if (tab === 'done') {
    const sorted = [...list].sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))
    return sorted.length ? [{ key: 'done', label: 'Caught', items: sorted.slice(0, 100) }] : []
  }
  if (tab === 'backlog') {
    return list.length ? [{ key: 'backlog', label: 'Backlog', items: list }] : []
  }
  const today = localYMD()
  const tmr = localYMD(addDays(new Date(), 1))
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
  if (b.soon.length) out.push({ key: 'soon', label: 'Up next', items: b.soon.sort(byDue) })
  if (b.anytime.length) out.push({ key: 'anytime', label: 'Anytime', items: b.anytime })
  return out
}
