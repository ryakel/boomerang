import { useState, useRef, useCallback } from 'react'
import { loadLabels, RECURRENCE_OPTIONS, formatCadence, getNextDueDate } from '../store'

export default function Routines({ routines, onAdd, onDelete, onTogglePause, onUpdate, onClose, isDesktop }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editingRoutine, setEditingRoutine] = useState(null)
  const [title, setTitle] = useState('')
  const [cadence, setCadence] = useState('weekly')
  const [customDays, setCustomDays] = useState(14)
  const [selectedTags, setSelectedTags] = useState([])
  const [notes, setNotes] = useState('')
  const [highPriority, setHighPriority] = useState(false)
  const [endDate, setEndDate] = useState('')
  const labels = loadLabels()

  const resetForm = () => {
    setTitle('')
    setNotes('')
    setCadence('weekly')
    setCustomDays(14)
    setSelectedTags([])
    setHighPriority(false)
    setEndDate('')
    setShowAdd(false)
    setEditingRoutine(null)
  }

  const handleAdd = () => {
    if (!title.trim()) return
    onAdd(title.trim(), cadence, cadence === 'custom' ? customDays : null, selectedTags, notes.trim(), highPriority, endDate || null)
    resetForm()
  }

  const handleEdit = (routine) => {
    setEditingRoutine(routine)
    setTitle(routine.title)
    setCadence(routine.cadence)
    setCustomDays(routine.custom_days || 14)
    setSelectedTags(routine.tags || [])
    setNotes(routine.notes || '')
    setHighPriority(routine.high_priority || false)
    setEndDate(routine.end_date || '')
    setShowAdd(true)
  }

  const handleSaveEdit = () => {
    if (!title.trim() || !editingRoutine) return
    onUpdate(editingRoutine.id, {
      title: title.trim(),
      cadence,
      custom_days: cadence === 'custom' ? customDays : null,
      tags: selectedTags,
      notes: notes.trim(),
      high_priority: highPriority,
      end_date: endDate || null,
    })
    resetForm()
  }

  const toggleTag = (id) => {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  const active = routines.filter(r => !r.paused)
  const paused = routines.filter(r => r.paused)

  const content = (
    <>
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
          <div className="tag-selector" style={{ marginBottom: 12 }}>
            {RECURRENCE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`tag-toggle ${cadence === opt.value ? 'selected' : ''}`}
                style={cadence === opt.value ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' } : {}}
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
          <LabelMultiSelect labels={labels} selectedTags={selectedTags} toggleTag={toggleTag} />
          <div className="priority-group" style={{ marginBottom: 16, alignItems: 'flex-start', flexDirection: 'row', gap: 8 }}>
            <span className="settings-label" style={{ marginBottom: 0 }}>Priority</span>
            <button
              className={`priority-btn${highPriority ? ' priority-active' : ''}`}
              onClick={() => setHighPriority(!highPriority)}
            >
              !
            </button>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="settings-label" style={{ marginBottom: 6 }}>End Date</div>
            <input
              className="add-input date-input"
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
            {endDate && (
              <button
                className="what-now-dismiss"
                onClick={() => setEndDate('')}
                style={{ marginTop: 0, padding: '4px 8px', fontSize: 12 }}
              >
                Clear end date
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="submit-btn" disabled={!title.trim()} onClick={editingRoutine ? handleSaveEdit : handleAdd}>
              {editingRoutine ? 'Save Changes' : 'Add Routine'}
            </button>
            <button className="what-now-dismiss" onClick={resetForm} style={{ marginTop: 0, padding: '10px 16px' }}>Cancel</button>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <>
          <div className="section-label">Active</div>
          {active.map(r => (
            <RoutineCard key={r.id} routine={r} onDelete={onDelete} onTogglePause={onTogglePause} onEdit={handleEdit} />
          ))}
        </>
      )}

      {paused.length > 0 && (
        <>
          <div className="section-label">Paused</div>
          {paused.map(r => (
            <RoutineCard key={r.id} routine={r} onDelete={onDelete} onTogglePause={onTogglePause} onEdit={handleEdit} />
          ))}
        </>
      )}
    </>
  )

  if (isDesktop) {
    return (
      <div className="sheet-overlay" onClick={onClose}>
        <div className="sheet" onClick={e => e.stopPropagation()}>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
          <div className="edit-task-title-row">
            <div className="sheet-title">Routines</div>
            <button className="settings-back" onClick={() => { resetForm(); setShowAdd(true) }} style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>+ New</button>
          </div>
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Routines</div>
        <button className="settings-back" onClick={() => { resetForm(); setShowAdd(true) }} style={{ color: 'var(--accent)' }}>+ New</button>
      </div>
      {content}
    </div>
  )
}

function LabelMultiSelect({ labels, selectedTags, toggleTag }) {
  const [open, setOpen] = useState(false)
  const selectedLabels = selectedTags.map(id => labels.find(l => l.id === id)).filter(Boolean)
  const displayText = selectedLabels.length === 0 ? 'None' : selectedLabels.map(l => l.name).join(', ')

  return (
    <div className="label-multiselect" style={{ marginBottom: 16 }}>
      <button
        className="add-input"
        type="button"
        onClick={() => setOpen(!open)}
        style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: selectedLabels.length ? 'var(--text)' : 'var(--text-dim)', marginBottom: 0 }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayText}</span>
        <span style={{ fontSize: 10, marginLeft: 8, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="label-multiselect-dropdown">
          {labels.map(label => (
            <button
              key={label.id}
              className="label-multiselect-item"
              onClick={() => toggleTag(label.id)}
            >
              <span className="label-swatch" style={{ background: label.color }} />
              <span style={{ flex: 1 }}>{label.name}</span>
              {selectedTags.includes(label.id) && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const SWIPE_THRESHOLD = 70
const SWIPE_OPEN_OFFSET = -140

function RoutineCard({ routine, onDelete, onTogglePause, onEdit }) {
  const [expanded, setExpanded] = useState(false)
  const [swipeX, setSwipeX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const [swipeOpen, setSwipeOpen] = useState(false)
  const [swipeTriggered, setSwipeTriggered] = useState(null)
  const touchStartRef = useRef(null)

  const closeSwipe = useCallback(() => {
    setSwipeOpen(false)
    setSwipeX(0)
  }, [])

  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now(), startSwipeX: swipeX }
    setSwipeTriggered(null)
  }, [swipeX])

  const handleTouchMove = useCallback((e) => {
    if (!touchStartRef.current) return
    const touch = e.touches[0]
    const dx = touch.clientX - touchStartRef.current.x
    const dy = touch.clientY - touchStartRef.current.y
    if (!swiping && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      touchStartRef.current = null
      return
    }
    if (Math.abs(dx) > 10) {
      setSwiping(true)
      const base = touchStartRef.current.startSwipeX || 0
      const raw = base + dx
      const clamped = Math.max(-160, Math.min(150, raw))
      setSwipeX(clamped)
    }
  }, [swiping])

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current) {
      setSwiping(false)
      return
    }
    if (swipeX > SWIPE_THRESHOLD) {
      // Swipe right → delete
      setSwipeTriggered('right')
      setSwipeX(400)
      setTimeout(() => {
        if (window.confirm(`Delete routine "${routine.title}"?`)) onDelete(routine.id)
        else { setSwipeTriggered(null); setSwipeX(0) }
      }, 250)
    } else if (swipeX < -SWIPE_THRESHOLD) {
      setSwipeOpen(true)
      setSwipeX(SWIPE_OPEN_OFFSET)
    } else {
      if (swipeOpen && swipeX > SWIPE_OPEN_OFFSET + 30) closeSwipe()
      else if (swipeOpen) setSwipeX(SWIPE_OPEN_OFFSET)
      else setSwipeX(0)
    }
    touchStartRef.current = null
    setTimeout(() => setSwiping(false), 300)
  }, [swipeX, swipeOpen, routine.id, routine.title, onDelete, closeSwipe])

  const handleClick = useCallback(() => {
    if (swiping || swipeTriggered) return
    if (swipeOpen) { closeSwipe(); return }
    setExpanded(prev => !prev)
  }, [swiping, swipeTriggered, swipeOpen, closeSwipe])

  const nextDue = getNextDueDate(routine)
  const lastDone = routine.completed_history.length > 0
    ? new Date(routine.completed_history[routine.completed_history.length - 1])
    : null

  const endedOrExpired = routine.end_date && new Date() > new Date(routine.end_date + 'T23:59:59')

  const nextLabel = routine.paused ? 'paused' :
    endedOrExpired ? 'ended' :
    nextDue <= new Date() ? 'due now' :
    `next ${nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  return (
    <div className={`swipe-container ${swipeTriggered === 'right' ? 'swipe-deleting' : ''}`}>
      {swipeX > 0 && (
        <div className="swipe-bg-delete">
          <svg className="swipe-delete-icon" viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </div>
      )}
      {(swipeX < 0 || swipeOpen) && (
        <div className="swipe-actions-left">
          <button className="swipe-action-btn swipe-edit" onClick={(e) => { e.stopPropagation(); closeSwipe(); onEdit(routine) }}>
            <svg className="swipe-action-icon" viewBox="0 0 24 24">
              <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
          <button className="swipe-action-btn swipe-complete" onClick={(e) => { e.stopPropagation(); closeSwipe(); onTogglePause(routine.id) }}>
            <svg className="swipe-action-icon" viewBox="0 0 24 24">
              {routine.paused
                ? <polygon points="5 3 19 12 5 21 5 3" />
                : <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
              }
            </svg>
          </button>
        </div>
      )}

      <div
        className={`task-card ${routine.paused ? 'snoozed' : ''} ${routine.high_priority ? 'high-priority' : ''}`}
        style={{
          transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
          transition: swiping ? 'none' : 'transform 0.25s ease',
        }}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="task-card-top">
          <span className="task-title">{routine.title}</span>
          {routine.high_priority && <span className="priority-pill">!</span>}
          <span className="task-meta">{formatCadence(routine)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          {nextLabel}
          {routine.end_date && ` · ends ${new Date(routine.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
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
              className="action-btn edit"
              onClick={e => { e.stopPropagation(); setExpanded(false); onEdit(routine) }}
            >
              Edit
            </button>
            <button
              className="action-btn snooze"
              onClick={e => { e.stopPropagation(); onTogglePause(routine.id) }}
            >
              {routine.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              className="action-btn delete"
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
    </div>
  )
}
