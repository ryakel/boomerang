import { useState, useRef, useCallback, useEffect } from 'react'
import { loadLabels, loadSettings, RECURRENCE_OPTIONS, formatCadence, getNextDueDate } from '../store'
import { suggestNotionLink, generateNotionContent, notionCreatePage } from '../api'

export default function Routines({ routines, onAdd, onDelete, onTogglePause, onUpdate, onUpdateNotion, onClose, editRoutineId, onClearEditRoutineId, isDesktop }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editingRoutine, setEditingRoutine] = useState(null)
  const [title, setTitle] = useState('')
  const [cadence, setCadence] = useState('weekly')
  const [customDays, setCustomDays] = useState(14)
  const [selectedTags, setSelectedTags] = useState([])
  const [notes, setNotes] = useState('')
  const [highPriority, setHighPriority] = useState(false)
  const [lowPriority, setLowPriority] = useState(false)
  const [endDate, setEndDate] = useState('')
  const [notionState, setNotionState] = useState(null)
  const [notionCreating, setNotionCreating] = useState(false)
  const [notionResult, setNotionResult] = useState(null)
  const labels = loadLabels()

  const defaultEndDate = () => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().split('T')[0]
  }

  const resetForm = () => {
    setTitle('')
    setNotes('')
    setCadence('weekly')
    setCustomDays(14)
    setSelectedTags([])
    setHighPriority(false)
    setLowPriority(false)
    setEndDate(defaultEndDate())
    setNotionState(null)
    setNotionCreating(false)
    setNotionResult(null)
    setShowAdd(false)
    setEditingRoutine(null)
  }

  const handleAdd = () => {
    if (!title.trim()) return
    const routine = onAdd(title.trim(), cadence, cadence === 'custom' ? customDays : null, selectedTags, notes.trim(), highPriority, endDate || null)
    if (notionResult && routine) {
      onUpdateNotion(routine.id, notionResult.id, notionResult.url)
    }
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
    setLowPriority(routine.low_priority || false)
    setEndDate(routine.end_date || '')
    setNotionResult(routine.notion_page_id ? { id: routine.notion_page_id, url: routine.notion_url } : null)
    setNotionState(null)
    setShowAdd(true)
  }

  // Auto-open edit form when navigating from a task's routine link
  useEffect(() => {
    if (editRoutineId) {
      const routine = routines.find(r => r.id === editRoutineId)
      if (routine) handleEdit(routine)
      if (onClearEditRoutineId) onClearEditRoutineId()
    }
  }, [editRoutineId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (notionResult) {
      onUpdateNotion(editingRoutine.id, notionResult.id, notionResult.url)
    } else if (editingRoutine.notion_page_id) {
      onUpdateNotion(editingRoutine.id, null, null)
    }
    resetForm()
  }

  const handleNotionSearch = async () => {
    if (!title.trim()) return
    setNotionState('searching')
    try {
      const result = await suggestNotionLink(title, notes)
      setNotionState(result)
    } catch (err) {
      setNotionState({ action: 'error', reason: err.message })
    }
  }

  const handleNotionCreate = async () => {
    setNotionCreating(true)
    try {
      const settings = loadSettings()
      const tagNames = selectedTags.map(id => labels.find(l => l.id === id)?.name || id)
      const metadata = { tags: tagNames, lastUpdated: new Date().toLocaleDateString(), frequency: cadence }
      const content = await generateNotionContent(title, notes, true, metadata)
      const page = await notionCreatePage(title, content, settings.notion_parent_page_id || null)
      setNotionResult(page)
      setNotionState(null)
    } catch (err) {
      setNotionState({ action: 'error', reason: err.message })
    } finally {
      setNotionCreating(false)
    }
  }

  const handleNotionLink = (page) => {
    setNotionResult({ id: page.id, url: page.url })
    setNotionState(null)
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

          {/* Frequency + Custom days inline */}
          <div className="form-inline-row">
            <div className="form-inline-field" style={{ flex: 1 }}>
              <div className="settings-label" style={{ marginBottom: 4 }}>Frequency</div>
              <select
                className="routine-select"
                value={cadence}
                onChange={e => setCadence(e.target.value)}
                style={{ marginBottom: 0 }}
              >
                {RECURRENCE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {cadence === 'custom' && (
              <div className="form-inline-field" style={{ width: 90 }}>
                <div className="settings-label" style={{ marginBottom: 4 }}>Every</div>
                <div className="duration-inline">
                  <input
                    className="add-input"
                    type="number"
                    min="1"
                    max="365"
                    value={customDays}
                    onChange={e => setCustomDays(parseInt(e.target.value) || 1)}
                    style={{ width: 56, textAlign: 'center', padding: '8px 4px' }}
                  />
                  <span className="duration-unit">days</span>
                </div>
              </div>
            )}
          </div>

          <textarea
            className="notes-input"
            placeholder="Notes (optional)..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{ minHeight: 50, marginBottom: 12 }}
          />

          {/* Priority + End Date inline */}
          <div className="form-inline-row" style={{ gap: 16 }}>
            <div className="form-inline-field">
              <div className="settings-label" style={{ marginBottom: 4 }}>Priority</div>
              <button
                className={`priority-toggle${highPriority ? ' active' : lowPriority ? ' low' : ''}`}
                onClick={() => {
                  if (!highPriority && !lowPriority) { setHighPriority(true); setLowPriority(false) }
                  else if (highPriority) { setHighPriority(false); setLowPriority(true) }
                  else { setHighPriority(false); setLowPriority(false) }
                }}
              >
                {highPriority ? '! High' : lowPriority ? '↓ Low' : 'Normal'}
              </button>
            </div>
            <div className="form-inline-field" style={{ flex: 1, overflow: 'hidden' }}>
              <div className="settings-label" style={{ marginBottom: 4 }}>End Date</div>
              <input
                className="routine-select"
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                style={{ marginBottom: 0, padding: '8px 10px', fontSize: 14, maxWidth: '100%' }}
              />
            </div>
          </div>

          {/* Labels */}
          <div className="settings-label" style={{ marginBottom: 4 }}>Labels</div>
          <select
            className="routine-select"
            value=""
            onChange={e => { if (e.target.value) toggleTag(e.target.value) }}
            style={{ marginBottom: selectedTags.length > 0 ? 6 : 12 }}
          >
            <option value="">Add label...</option>
            {labels.filter(l => !selectedTags.includes(l.id)).map(label => (
              <option key={label.id} value={label.id}>{label.name}</option>
            ))}
          </select>
          {selectedTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {selectedTags.map(id => {
                const label = labels.find(l => l.id === id)
                if (!label) return null
                return (
                  <button key={id} className="routine-label-pill" style={{ background: label.color }} onClick={() => toggleTag(id)}>
                    {label.name} <span style={{ marginLeft: 4, opacity: 0.7 }}>✕</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Connections */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {notionResult ? (
              <div className="connection-linked-btn">
                <a href={notionResult.url} target="_blank" rel="noopener" className="connection-link">Notion ↗</a>
                <button className="connection-unlink" onClick={() => setNotionResult(null)} title="Unlink">✕</button>
              </div>
            ) : notionState === 'searching' ? (
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}><span className="spinner" /> Searching...</span>
            ) : notionState?.action === 'error' ? (
              <button className="ci-upload-btn" onClick={handleNotionSearch}>Retry Notion</button>
            ) : notionState ? (
              <div className="notion-suggestions">
                {notionState.pages?.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>{notionState.reason}</div>
                    {notionState.pages.map(page => (
                      <button key={page.id} className="notion-page-btn" onClick={() => handleNotionLink(page)}>
                        {page.title}
                      </button>
                    ))}
                  </>
                )}
                <button className="ci-upload-btn" onClick={handleNotionCreate} disabled={notionCreating} style={{ marginTop: 8 }}>
                  {notionCreating ? <><span className="spinner" /> Creating...</> : '+ Create new Notion page'}
                </button>
              </div>
            ) : (
              <button className="ci-upload-btn" onClick={handleNotionSearch} disabled={!title.trim()}>
                Notion
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
        className={`task-card ${routine.paused ? 'snoozed' : ''} ${routine.high_priority ? 'high-priority' : routine.low_priority ? 'low-priority' : ''}`}
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
          {routine.low_priority && <span className="priority-pill low-pill">↓</span>}
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
          <div className="task-toolbar" onClick={e => e.stopPropagation()}>
            <button className="toolbar-pill edit" onClick={() => { setExpanded(false); onEdit(routine) }} title="Edit">
              <svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
            </button>
            <button className="toolbar-pill snooze" onClick={() => onTogglePause(routine.id)} title={routine.paused ? 'Resume' : 'Pause'}>
              <svg viewBox="0 0 24 24">
                {routine.paused
                  ? <polygon points="5 3 19 12 5 21 5 3" />
                  : <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
                }
              </svg>
            </button>
            <button
              className="toolbar-pill delete"
              onClick={() => {
                if (window.confirm(`Delete routine "${routine.title}"?`)) onDelete(routine.id)
              }}
              title="Delete"
            >
              <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
