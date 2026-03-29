import { useState } from 'react'
import { loadLabels, RECURRENCE_OPTIONS, formatCadence, getNextDueDate } from '../store'

export default function Routines({ routines, onAdd, onDelete, onTogglePause, onClose }) {
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [cadence, setCadence] = useState('weekly')
  const [customDays, setCustomDays] = useState(14)
  const [selectedTags, setSelectedTags] = useState([])
  const [notes, setNotes] = useState('')
  const labels = loadLabels()

  const handleAdd = () => {
    if (!title.trim()) return
    onAdd(title.trim(), cadence, cadence === 'custom' ? customDays : null, selectedTags, notes.trim())
    setTitle('')
    setNotes('')
    setCadence('weekly')
    setShowAdd(false)
  }

  const toggleTag = (id) => {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  const active = routines.filter(r => !r.paused)
  const paused = routines.filter(r => r.paused)

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Routines</div>
        <button className="settings-back" onClick={() => setShowAdd(true)} style={{ color: 'var(--accent)' }}>+ New</button>
      </div>

      {routines.length === 0 && !showAdd && (
        <div className="empty-state">
          No routines yet.<br />Recurring tasks live here.
        </div>
      )}

      {showAdd && (
        <div className="routine-add-form">
          <input
            className="add-input"
            placeholder="Routine name..."
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
          />
          <div className="settings-label" style={{ marginBottom: 6 }}>Frequency</div>
          <div className="notif-freq-row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
            {RECURRENCE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`notif-freq ${cadence === opt.value ? 'notif-freq-active' : ''}`}
                onClick={() => setCadence(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {cadence === 'custom' && (
            <div style={{ marginBottom: 12 }}>
              <div className="settings-label" style={{ marginBottom: 4 }}>Every how many days?</div>
              <input
                className="settings-input"
                type="number"
                min="1"
                max="365"
                value={customDays}
                onChange={e => setCustomDays(parseInt(e.target.value) || 1)}
              />
            </div>
          )}
          <textarea
            className="notes-input"
            placeholder="Notes (optional)..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{ minHeight: 50, marginBottom: 12 }}
          />
          <div className="settings-label" style={{ marginBottom: 6 }}>Labels</div>
          <div className="tag-selector" style={{ marginBottom: 16 }}>
            {labels.map(label => (
              <button
                key={label.id}
                className={`tag-toggle ${selectedTags.includes(label.id) ? 'selected' : ''}`}
                style={selectedTags.includes(label.id) ? { background: label.color } : {}}
                onClick={() => toggleTag(label.id)}
              >
                {label.name}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="submit-btn" disabled={!title.trim()} onClick={handleAdd}>Add Routine</button>
            <button className="what-now-dismiss" onClick={() => setShowAdd(false)} style={{ marginTop: 0, padding: '10px 16px' }}>Cancel</button>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <>
          <div className="section-label">Active</div>
          {active.map(r => (
            <RoutineCard key={r.id} routine={r} onDelete={onDelete} onTogglePause={onTogglePause} />
          ))}
        </>
      )}

      {paused.length > 0 && (
        <>
          <div className="section-label">Paused</div>
          {paused.map(r => (
            <RoutineCard key={r.id} routine={r} onDelete={onDelete} onTogglePause={onTogglePause} />
          ))}
        </>
      )}
    </div>
  )
}

function RoutineCard({ routine, onDelete, onTogglePause }) {
  const [expanded, setExpanded] = useState(false)
  const nextDue = getNextDueDate(routine)
  const lastDone = routine.completed_history.length > 0
    ? new Date(routine.completed_history[routine.completed_history.length - 1])
    : null

  const nextLabel = routine.paused ? 'paused' :
    nextDue <= new Date() ? 'due now' :
    `next ${nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  return (
    <div className={`task-card ${routine.paused ? 'snoozed' : ''}`} onClick={() => setExpanded(!expanded)}>
      <div className="task-card-top">
        <span className="task-title">{routine.title}</span>
        <span className="task-meta">{formatCadence(routine)}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
        {nextLabel}
        {lastDone && ` · last done ${lastDone.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
        {routine.completed_history.length > 0 && ` · ${routine.completed_history.length}x completed`}
      </div>
      {routine.notion_url && (
        <a
          href={routine.notion_url}
          target="_blank"
          rel="noopener"
          className="notion-link"
          onClick={e => e.stopPropagation()}
        >
          Open in Notion ↗
        </a>
      )}
      {expanded && (
        <div className="task-actions">
          <button
            className="action-btn snooze"
            onClick={e => { e.stopPropagation(); onTogglePause(routine.id) }}
          >
            {routine.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            className="action-btn"
            style={{ background: 'rgba(255,60,40,0.12)', color: '#FF3B30' }}
            onClick={e => {
              e.stopPropagation()
              if (window.confirm(`Delete routine "${routine.title}"?`)) onDelete(routine.id)
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
