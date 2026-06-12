import { useMemo, useState } from 'react'
import { Check, Search, Pencil, Trash2, X, Undo2, ArrowUpDown } from 'lucide-react'
import { localYMD, parseLocalDate, addDays } from '../dates'
import { isSnoozed, formatSnoozeLabel } from '../store'
import RowSwipe from './RowSwipe'
import Section, { useCollapsedSections } from './Section'
import './shell.css'

const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']
const TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'done', label: 'Done' },
]

// Kept "Tasks" — grouped hairline rows, gold circle checks, dot-tags, and the
// action sheet with reschedule chips ("throw it back") (spec §6).
export default function TasksViewKept({ tasks = [], labels = [], routines = [], onToggleComplete, onToggleItem, onOpenTask, onDelete, onReschedule, onUnsnooze }) {
  const [tab, setTab] = useState('upcoming')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [sheetTask, setSheetTask] = useState(null)
  const [collapsed, toggleSection] = useCollapsedSections()
  const labelsById = useMemo(() => { const m = {}; for (const l of labels) m[l.id] = l; return m }, [labels])
  const [labelFilter, setLabelFilter] = useState('all')
  // Sort modes (prod-requested): 'due' keeps the grouped day-planner view;
  // the others flatten to a single sorted list within the active tab+filters.
  const [sortBy, setSortBy] = useState('due')
  const [sortOpen, setSortOpen] = useState(false)
  // Stack members live in their Today folder (v2 dropped them from the main
  // sections too); they stay visible in Done as records.
  const stackIds = useMemo(() => new Set(
    routines.filter(r => Array.isArray(r.members) && r.members.length > 0).map(r => r.id),
  ), [routines])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks.filter(t => {
      if (t.gmail_pending || t.parent_id) return false
      if (tab !== 'done' && t.routine_id && stackIds.has(t.routine_id)) return false
      if (tab === 'done') { if (t.status !== 'done') return false }
      else if (tab === 'backlog') { if (t.status !== 'backlog') return false }
      else if (tab === 'snoozed') { if (!ACTIVE.includes(t.status) || !isSnoozed(t)) return false }
      else if (!ACTIVE.includes(t.status) || isSnoozed(t)) return false
      if (labelFilter !== 'all' && !(t.tags || []).includes(labelFilter)) return false
      if (q && !t.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [tasks, tab, query, labelFilter, stackIds])

  const sections = useMemo(() => {
    if (sortBy === 'due' || tab === 'done' || tab === 'snoozed') return groupTasks(visible, tab)
    const sorted = [...visible]
    if (sortBy === 'newest') sorted.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    else if (sortBy === 'oldest') sorted.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    else if (sortBy === 'az') sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    const label = sortBy === 'newest' ? 'Newest first' : sortBy === 'oldest' ? 'Oldest first' : 'A to Z'
    return sorted.length ? [{ key: `sort-${sortBy}`, label, items: sorted }] : []
  }, [visible, tab, sortBy])

  return (
    <div className="bm-surface">
      <div className="bm-title-row">
        <h1 className="bm-h1">Tasks</h1>
        <button
          className={`bm-back${sortBy !== 'due' ? ' is-active-sort' : ''}`} style={{ marginLeft: 'auto' }}
          onClick={() => setSortOpen(o => !o)}
          aria-label="Sort tasks"
          aria-expanded={sortOpen}
        ><ArrowUpDown size={15} strokeWidth={2} /></button>
        <button
          className="bm-back"
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
      {sortOpen && tab !== 'done' && tab !== 'snoozed' && (
        <div className="bm-filter-row" aria-label="Sort order">
          {[['due', 'By due date'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['az', 'A–Z']].map(([id, label]) => (
            <button key={id} className={`bm-pick bm-pick-sm${sortBy === id ? ' is-on' : ''}`} onClick={() => setSortBy(id)}>{label}</button>
          ))}
        </div>
      )}
      {labels.length > 0 && tab !== 'done' && (
        <div className="bm-filter-row">
          <button className={`bm-pick bm-pick-sm${labelFilter === 'all' ? ' is-on' : ''}`} onClick={() => setLabelFilter('all')}>All</button>
          {labels.map(l => (
            <button key={l.id} className={`bm-pick bm-pick-sm${labelFilter === l.id ? ' is-on' : ''}`} style={{ '--tag': l.color }} onClick={() => setLabelFilter(labelFilter === l.id ? 'all' : l.id)}>
              <i className="bm-filter-dot" /> {l.name}
            </button>
          ))}
        </div>
      )}

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
              const subItems = tab === 'snoozed' || done ? [] : (Array.isArray(t.checklists) ? t.checklists : [])
                .flatMap(cl => (cl.items || []).map(it => ({ ...it, clId: cl.id })))
              return (
                <RowSwipe key={t.id} done={done} onCatch={() => onToggleComplete?.(t)} onDelete={() => onDelete?.(t)}>
                  <div className="bm-row">
                    <button
                      className={`bm-chk${done ? ' is-done' : ''}${t.high_priority ? ' is-hi' : ''}`}
                      onClick={() => onToggleComplete?.(t)}
                      aria-label={done ? 'Reopen' : 'Catch it'}
                    >{done && <Check size={13} strokeWidth={3.4} />}</button>
                    <div className="bm-row-stack">
                      <button className="bm-row-body" onClick={() => setSheetTask(t)}>
                        <span className={`bm-row-title${done ? ' is-done' : ''}`}>{t.title}</span>
                        {!done && (due || chips.length > 0 || tab === 'snoozed') && (
                          <span className="bm-row-meta">
                            {tab === 'snoozed' && <span className="bm-return-chip">↩ returns {formatSnoozeLabel(t.snoozed_until)}</span>}
                            {due && <span className={due.tone === 'over' ? 'bm-due-over' : due.tone === 'hot' ? 'bm-due-hot' : undefined}>{due.label}</span>}
                            {chips.slice(0, 3).map(l => (
                              <span key={l.id} className="bm-tagdot" style={{ '--tag': l.color }}><i />{l.name}</span>
                            ))}
                          </span>
                        )}
                      </button>
                      {subItems.length > 0 && (
                        <ul className="bm-subtasks">
                          {subItems.map(it => (
                            <li key={it.id} className="bm-subtask">
                              <button
                                className={`bm-subcheck${it.completed ? ' is-done' : ''}`}
                                onClick={() => onToggleItem?.(t, it.clId, it.id)}
                                aria-label={it.completed ? 'Uncheck' : 'Check'}
                              >{it.completed && <Check size={10} strokeWidth={3} />}</button>
                              <span className={`bm-subtask-text${it.completed ? ' is-done' : ''}`}>{it.text}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {tab === 'snoozed' && (
                      <button className="bm-btn bm-btn-tonal bm-bringback" onClick={() => onUnsnooze?.(t)}>
                        <Undo2 size={13} strokeWidth={2.2} /> Now
                      </button>
                    )}
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
  if (tab === 'snoozed') {
    const sorted = [...list].sort((a, b) => (a.snoozed_until || '').localeCompare(b.snoozed_until || ''))
    return sorted.length ? [{ key: 'snoozed', label: 'Returning', items: sorted }] : []
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
