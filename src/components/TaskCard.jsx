import { useState, useRef, useCallback } from 'react'
import { loadLabels, isStale, isSnoozed, isOverdue, formatSnoozeLabel, formatDueDate, daysOld, ACTIVE_STATUSES, STATUS_META } from '../store'

const STATUS_CYCLE = ['not_started', 'doing', 'waiting']

const SWIPE_THRESHOLD = 70
const SWIPE_OPEN_OFFSET = -140 // how far card stays offset to reveal action buttons

export default function TaskCard({ task, onComplete, onSnooze, onEdit, onExtend, onStatusChange, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [statusPickerOpen, setStatusPickerOpen] = useState(false)
  const [swipeX, setSwipeX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const [swipeOpen, setSwipeOpen] = useState(false) // true when action buttons are revealed
  const [swipeTriggered, setSwipeTriggered] = useState(null) // 'left' | 'right' | null
  const touchStartRef = useRef(null)
  const cardRef = useRef(null)

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

    // If vertical scroll dominates, cancel swipe
    if (!swiping && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      touchStartRef.current = null
      return
    }

    if (Math.abs(dx) > 10) {
      setSwiping(true)
      const base = touchStartRef.current.startSwipeX || 0
      const raw = base + dx
      // Only allow swiping left (negative) for action reveal, and right (positive) for delete
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
      // Swiped right (left-to-right) → delete
      setSwipeTriggered('right')
      setSwipeX(400)
      setTimeout(() => onDelete(task.id), 300)
    } else if (swipeX < -SWIPE_THRESHOLD) {
      // Swiped left (right-to-left) → reveal Edit + Complete buttons
      setSwipeOpen(true)
      setSwipeX(SWIPE_OPEN_OFFSET)
    } else {
      // Snap back
      if (swipeOpen && swipeX > SWIPE_OPEN_OFFSET + 30) {
        // Swiped back to close
        closeSwipe()
      } else if (swipeOpen) {
        setSwipeX(SWIPE_OPEN_OFFSET)
      } else {
        setSwipeX(0)
      }
    }

    touchStartRef.current = null
    setTimeout(() => setSwiping(false), 300)
  }, [swipeX, swipeOpen, task.id, onDelete, closeSwipe])

  const handleClick = useCallback(() => {
    // Don't toggle if we just finished a swipe
    if (swiping || swipeTriggered) return
    // Close swipe if open
    if (swipeOpen) {
      closeSwipe()
      return
    }
    setExpanded(prev => !prev)
  }, [swiping, swipeTriggered, swipeOpen, closeSwipe])

  const stale = isStale(task)
  const snoozed = isSnoozed(task)
  const overdue = isOverdue(task)
  const days = daysOld(task)
  const labels = loadLabels()
  const labelMap = Object.fromEntries(labels.map(l => [l.id, l]))

  let metaText = ''
  if (snoozed) {
    metaText = formatSnoozeLabel(task.snoozed_until)
  } else if (task.due_date) {
    metaText = formatDueDate(task.due_date)
  } else if (days > 0) {
    metaText = `${days}d`
  }

  return (
    <div className={`swipe-container ${swipeTriggered === 'right' ? 'swipe-deleting' : ''}`}>
      {/* Delete background (only when swiping right / left-to-right) */}
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
      {/* Action buttons (only when swiping left / right-to-left) */}
      {(swipeX < 0 || swipeOpen) && (
        <div className="swipe-actions-left">
          <button className="swipe-action-btn swipe-edit" onClick={(e) => { e.stopPropagation(); closeSwipe(); onEdit(task) }}>
            <svg className="swipe-action-icon" viewBox="0 0 24 24">
              <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
          <button className="swipe-action-btn swipe-complete" onClick={(e) => { e.stopPropagation(); closeSwipe(); onComplete(task.id) }}>
            <svg className="swipe-action-icon" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      )}

      <div
        ref={cardRef}
        className={`task-card ${stale ? 'stale' : ''} ${snoozed ? 'snoozed' : ''} ${overdue ? 'overdue' : ''} ${task.high_priority ? 'high-priority' : ''}`}
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
          {task.status !== 'backlog' && (STATUS_META[task.status] || task.status === 'open') && (
            <span className="status-indicator" style={{ background: (STATUS_META[task.status] || STATUS_META.not_started).color }} title={(STATUS_META[task.status] || STATUS_META.not_started).label} />
          )}
          <span className="task-title">{task.title}</span>
          {(task.notion_page_id || task.trello_card_id) && (
            <span className="task-link-icons" onClick={e => e.stopPropagation()}>
              {task.notion_url && (
                <a href={task.notion_url} target="_blank" rel="noopener" className="task-link-icon" title="Open in Notion">N</a>
              )}
              {task.trello_card_url && (
                <a href={task.trello_card_url} target="_blank" rel="noopener" className="task-link-icon" title="Open in Trello">T</a>
              )}
            </span>
          )}
          <div className="task-card-right">
            {task.high_priority && <span className="priority-pill">!</span>}
            {task.size && (
              <span className={`size-pill size-${task.size.toLowerCase()}`}>{task.size}</span>
            )}
            {metaText && (
              <span className={`task-meta ${overdue && !snoozed ? 'task-meta-overdue' : ''}`}>
                {metaText}
              </span>
            )}
          </div>
        </div>

        {task.tags.length > 0 && (
          <div className="task-tags">
            {task.tags.map(tagId => {
              const label = labelMap[tagId]
              if (!label) return null
              return (
                <span
                  key={tagId}
                  className="task-tag"
                  style={{ background: `${label.color}22`, color: label.color }}
                >
                  {label.name}
                </span>
              )
            })}
          </div>
        )}

        {expanded && (
          <>
            {task.notes && (
              <div className="task-notes">{task.notes}</div>
            )}
            {task.checklist?.length > 0 && (
              <div className="checklist-section" onClick={e => e.stopPropagation()}>
                <div className="checklist-progress">
                  {task.checklist.filter(i => i.completed).length}/{task.checklist.length} items
                </div>
                {task.checklist.map(item => (
                  <label key={item.id} className="checklist-item">
                    <input
                      type="checkbox"
                      className="checklist-checkbox"
                      checked={item.completed}
                      onChange={() => {
                        const updated = task.checklist.map(i =>
                          i.id === item.id ? { ...i, completed: !i.completed } : i
                        )
                        onUpdate(task.id, { checklist: updated })
                      }}
                    />
                    <span className={`checklist-text${item.completed ? ' completed' : ''}`}>{item.text}</span>
                  </label>
                ))}
              </div>
            )}
            {task.attachments?.length > 0 && (
              <div className="attachment-list" onClick={e => e.stopPropagation()}>
                {task.attachments.map(a => {
                  const openAttachment = () => {
                    const byteChars = atob(a.data)
                    const byteArray = new Uint8Array(byteChars.length)
                    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
                    const blob = new Blob([byteArray], { type: a.type || 'application/octet-stream' })
                    window.open(URL.createObjectURL(blob), '_blank')
                  }
                  return (
                    <div key={a.id} className="attachment-item">
                      <a className="attachment-link" href="#" onClick={(e) => { e.preventDefault(); openAttachment() }}>
                        {a.name}
                      </a>
                    </div>
                  )
                })}
              </div>
            )}
            {task.notion_url && (
              <a href={task.notion_url} target="_blank" rel="noopener" className="notion-link" onClick={e => e.stopPropagation()}>
                Open in Notion ↗
              </a>
            )}
            <div className="task-toolbar" onClick={e => e.stopPropagation()}>
              <button className="toolbar-pill done" onClick={() => onComplete(task.id)} title="Done">
                <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
              </button>
              <button className="toolbar-pill snooze" onClick={() => onSnooze(task)} title="Snooze">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              </button>
              <button className="toolbar-pill edit" onClick={() => { setExpanded(false); onEdit(task) }} title="Edit">
                <svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
              </button>
              <button className="toolbar-pill extend" onClick={() => onExtend(task)} title={task.due_date ? 'Extend' : 'Set due date'}>
                {task.due_date ? (
                  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                )}
              </button>
              {task.status !== 'backlog' && onStatusChange && (
                <div className="toolbar-pill-wrapper">
                  <button
                    className="toolbar-pill status"
                    style={{ '--status-color': (STATUS_META[task.status] || STATUS_META.not_started).color }}
                    onClick={() => setStatusPickerOpen(!statusPickerOpen)}
                    title={(STATUS_META[task.status] || STATUS_META.not_started).label}
                  >
                    <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" /><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" /></svg>
                  </button>
                  {statusPickerOpen && (
                    <div className="status-picker">
                      {ACTIVE_STATUSES.map(s => (
                        <button
                          key={s}
                          className={`status-picker-opt${(task.status === s || (task.status === 'open' && s === 'not_started')) ? ' active' : ''}`}
                          style={{ '--status-color': STATUS_META[s].color }}
                          onClick={() => { onStatusChange(task.id, s); setStatusPickerOpen(false) }}
                        >
                          {STATUS_META[s].label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
