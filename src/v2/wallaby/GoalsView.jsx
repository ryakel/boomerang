import { useMemo, useState } from 'react'
import { ArrowLeft, Plus, Pencil, Check, Pause, Trash2, ChevronRight, Flame } from 'lucide-react'
import { parseLocalDate } from './heatmapUtils'
import { computeProjectBudget } from '../../scoring'
import './GoalsView.css'

// Wallaby "Goals" surface — Boomerang projects as loggd-style goals (IMG_1572).
// A list of goal cards; tapping one opens the detail with a progress bar, a big
// metric, a "why this matters" line, and the semantic action buttons
// (orange Log session / slate Edit / green Complete / yellow Set aside / red
// Delete). Maps project sessions + child steps onto the loggd metric model.
export default function GoalsView({
  projects = [], tasks = [], labels = [],
  onLogSession, onComplete, onEdit, onSetAside, onDelete, onAdd, onClose,
}) {
  const [selectedId, setSelectedId] = useState(null)
  const labelsById = useMemo(() => {
    const m = {}; for (const l of labels) m[l.id] = l; return m
  }, [labels])

  const selected = projects.find(p => p.id === selectedId)
  if (selected) {
    return (
      <GoalDetail
        project={selected}
        tasks={tasks}
        labelsById={labelsById}
        onBack={() => setSelectedId(null)}
        onLogSession={onLogSession}
        onComplete={(p) => { onComplete?.(p); setSelectedId(null) }}
        onEdit={onEdit}
        onSetAside={(p) => { onSetAside?.(p); setSelectedId(null) }}
        onDelete={(p) => { onDelete?.(p); setSelectedId(null) }}
      />
    )
  }

  return (
    <div className="wb-goals">
      <header className="wb-goals-head">
        <div className="wb-goals-titlerow">
          {onClose && (
            <button className="wb-back" onClick={onClose} aria-label="Back"><ArrowLeft size={20} strokeWidth={2.25} /></button>
          )}
          <h1 className="wb-goals-title">Goals</h1>
        </div>
      </header>

      <div className="wb-goals-list">
        {projects.length === 0 && <p className="wb-goals-empty">No goals yet. Tap + to start one.</p>}
        {projects.map(p => {
          const prog = progressFor(p, tasks)
          const cat = (p.tags || []).map(id => labelsById[id]).find(Boolean)
          return (
            <button key={p.id} className="wb-goal-card" onClick={() => setSelectedId(p.id)}>
              <div className="wb-goal-card-top">
                <span className="wb-goal-card-title">{p.title}</span>
                <ChevronRight size={18} strokeWidth={1.75} className="wb-goal-card-chev" />
              </div>
              {cat && <span className="wb-goal-chip" style={{ '--tag': cat.color }}>{cat.name}</span>}
              <Progress value={prog.pct} />
              <span className="wb-goal-card-meta">
                {prog.label} · <Flame size={11} strokeWidth={2.25} /> {p.session_count || 0} sessions
              </span>
            </button>
          )
        })}
      </div>

      <button className="wb-fab wb-fab-habits" onClick={onAdd} aria-label="New goal"><Plus size={26} strokeWidth={2.5} /></button>
    </div>
  )
}

function GoalDetail({ project, tasks, labelsById, onBack, onLogSession, onComplete, onEdit, onSetAside, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const prog = progressFor(project, tasks)
  const budget = computeProjectBudget(project, tasks)
  const cats = (project.tags || []).map(id => labelsById[id]).filter(Boolean)
  // parseLocalDate — a date-only due_date is a local day; naive new Date()
  // would display the previous day west of UTC.
  const target = project.due_date
    ? parseLocalDate(project.due_date)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="wb-goals">
      <header className="wb-goals-head">
        <div className="wb-goals-titlerow">
          <button className="wb-back" onClick={onBack} aria-label="Back"><ArrowLeft size={20} strokeWidth={2.25} /></button>
          <h1 className="wb-goals-title wb-goal-detail-title">{project.title}</h1>
        </div>
        <div className="wb-goal-chips">
          {cats.map(c => <span key={c.id} className="wb-goal-chip" style={{ '--tag': c.color }}>{c.name}</span>)}
          <span className="wb-goal-chip wb-goal-chip-soft">{target ? `Target ${target}` : 'Ongoing'}</span>
        </div>
      </header>

      <div className="wb-goal-detail-body">
        <div className="wb-goal-metric-card">
          <span className="wb-goal-metric-label">{prog.metricLabel}</span>
          <span className="wb-goal-metric-value">{prog.metricValue}</span>
          <Progress value={prog.pct} big />
          <span className="wb-goal-metric-sub">
            <Flame size={12} strokeWidth={2.25} /> {project.session_count || 0} sessions · budget {budget}
          </span>
        </div>

        {project.notes && (
          <div className="wb-goal-why">
            <span className="wb-goal-why-label">Why this matters</span>
            <p className="wb-goal-why-text">{project.notes}</p>
          </div>
        )}

        <div className="wb-goal-actions">
          <button className="wb-btn wb-btn-primary" onClick={() => onLogSession?.(project)}>
            <Flame size={16} strokeWidth={2.25} /> Log session
          </button>
          <button className="wb-btn wb-btn-secondary" onClick={() => onEdit?.(project)}>
            <Pencil size={15} strokeWidth={2} /> Edit goal
          </button>
          <div className="wb-goal-actions-row">
            <button className="wb-btn wb-btn-complete" onClick={() => onComplete?.(project)}>
              <Check size={16} strokeWidth={2.5} /> Complete
            </button>
            <button className="wb-btn wb-btn-pause" onClick={() => onSetAside?.(project)}>
              <Pause size={15} strokeWidth={2.25} /> Set aside
            </button>
          </div>
          {confirmDelete ? (
            <div className="wb-confirm">
              <span>Delete this goal?</span>
              <button className="wb-btn wb-btn-delete-solid" onClick={() => onDelete?.(project)}>Delete</button>
              <button className="wb-btn wb-btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <button className="wb-btn wb-btn-delete" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} strokeWidth={2} /> Delete goal
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Progress({ value, big }) {
  return (
    <div className={`wb-progress${big ? ' wb-progress-big' : ''}`}>
      <div className="wb-progress-fill" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

// Progress model: prefer child-step completion; fall back to session cap (10).
function progressFor(project, tasks) {
  const children = tasks.filter(t => t.parent_id === project.id)
  if (children.length > 0) {
    const done = children.filter(c => c.status === 'done').length
    return {
      pct: done / children.length,
      label: `${done}/${children.length} steps`,
      metricLabel: 'Steps complete',
      metricValue: `${done} / ${children.length}`,
    }
  }
  const sessions = project.session_count || 0
  const cap = 10
  return {
    pct: Math.min(1, sessions / cap),
    label: `${sessions} sessions`,
    metricLabel: 'Sessions logged',
    metricValue: `${sessions}`,
  }
}
