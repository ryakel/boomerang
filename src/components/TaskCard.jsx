import { useState, useRef, useCallback } from 'react'
import { loadLabels, isStale, isSnoozed, isOverdue, formatSnoozeLabel, formatDueDate, daysOld, ACTIVE_STATUSES } from '../store'

const STATUS_META = {
  not_started: { label: 'Not Started', color: 'var(--text-dim)' },
  doing: { label: 'Doing', color: '#4A9EFF' },
  waiting: { label: 'Waiting', color: '#FFB347' },
  done: { label: 'Done', color: '#52C97F' },
}

const SWIPE_THRESHOLD = 70

export default function TaskCard({ task, onComplete, onSnooze, onEdit, onExtend, onBacklog, onStatusChange, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [swipeX, setSwipeX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const [swipeTriggered, setSwipeTriggered] = useState(null) // 'left' | 'right' | null
  const touchStartRef = useRef(null)
  const cardRef = useRef(null)

  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
    setSwipeTriggered(null)
  }, [])

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
      // Resistance at the edges
      const clamped = Math.max(-150, Math.min(150, dx))
      setSwipeX(clamped)
    }
  }, [swiping])

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current) {
      setSwiping(false)
      return
    }

    if (swipeX < -SWIPE_THRESHOLD) {
      // Swiped left → delete
      setSwipeTriggered('left')
      setSwipeX(-300) // animate off screen
      setTimeout(() => onDelete(task.id), 250)
    } else if (swipeX > SWIPE_THRESHOLD) {
      // Swiped right → done
      setSwipeTriggered('right')
      setSwipeX(300)
      setTimeout(() => onComplete(task.id), 250)
    } else {
      setSwipeX(0)
    }

    touchStartRef.current = null
    setTimeout(() => setSwiping(false), 300)
  }, [swipeX, task.id, onDelete, onComplete])

  const handleClick = useCallback(() => {
    // Don't toggle if we just finished a swipe
    if (swiping || swipeTriggered) return
    setExpanded(prev => !prev)
  }, [swiping, swipeTriggered])

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
    <div className={`swipe-container ${swipeTriggered === 'left' ? 'swipe-deleting' : ''} ${swipeTriggered === 'right' ? 'swipe-completing' : ''}`}>
      {/* Background revealed by swipe */}
      <div className="swipe-bg-left">🗑️</div>
      <div className="swipe-bg-right">✓</div>

      <div
        ref={cardRef}
        className={`task-card ${stale ? 'stale' : ''} ${snoozed ? 'snoozed' : ''} ${overdue ? 'overdue' : ''}`}
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
            {task.status !== 'backlog' && onStatusChange && (
              <div className="status-selector" onClick={e => e.stopPropagation()}>
                {[...ACTIVE_STATUSES, 'done'].map(s => (
                  <button
                    key={s}
                    className={`status-btn${task.status === s || (task.status === 'open' && s === 'not_started') ? ' active' : ''}`}
                    style={{ '--status-color': STATUS_META[s].color }}
                    onClick={() => onStatusChange(task.id, s)}
                  >
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>
            )}
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
            <div className="task-actions">
              <button className="action-btn done" onClick={(e) => { e.stopPropagation(); onComplete(task.id) }}>Done ✓</button>
              <button className="action-btn snooze" onClick={(e) => { e.stopPropagation(); onSnooze(task) }}>Snooze</button>
              {task.due_date && (
                <button className="action-btn extend" onClick={(e) => { e.stopPropagation(); onExtend(task) }}>Extend</button>
              )}
              <button className="action-btn edit" onClick={(e) => { e.stopPropagation(); setExpanded(false); onEdit(task) }}>Edit</button>
              {task.status !== 'backlog' ? (
                <button className="action-btn backlog" onClick={(e) => { e.stopPropagation(); onBacklog(task.id, true) }}>Backlog</button>
              ) : (
                <button className="action-btn snooze" onClick={(e) => { e.stopPropagation(); onBacklog(task.id, false) }}>Activate</button>
              )}
              <button className="action-btn delete" onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}>Delete</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
