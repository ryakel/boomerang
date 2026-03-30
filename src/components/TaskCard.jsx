import { useState } from 'react'
import { loadLabels, isStale, isSnoozed, isOverdue, formatSnoozeLabel, formatDueDate, daysOld } from '../store'

export default function TaskCard({ task, onComplete, onSnooze, onEdit, onExtend }) {
  const [expanded, setExpanded] = useState(false)

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
    <div
      className={`task-card ${stale ? 'stale' : ''} ${snoozed ? 'snoozed' : ''} ${overdue ? 'overdue' : ''}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="task-card-top">
        <span className="task-title">{task.title}</span>
        <div className="task-card-right">
          {metaText && (
            <span className={`task-meta ${overdue && !snoozed ? 'task-meta-overdue' : ''}`}>
              {metaText}
            </span>
          )}
          <div className="hover-actions" onClick={e => e.stopPropagation()}>
            <button className="hover-btn" onClick={() => { setExpanded(false); onEdit(task) }} title="Edit">✎</button>
            <button className="hover-btn hover-btn-done" onClick={() => onComplete(task.id)} title="Done">✓</button>
          </div>
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
          {task.notion_url && (
            <a href={task.notion_url} target="_blank" rel="noopener" className="notion-link" onClick={e => e.stopPropagation()}>
              Open in Notion ↗
            </a>
          )}
          <div className="task-actions">
            <button
              className="action-btn done"
              onClick={(e) => { e.stopPropagation(); onComplete(task.id) }}
            >
              Done ✓
            </button>
            <button
              className="action-btn snooze"
              onClick={(e) => { e.stopPropagation(); onSnooze(task) }}
            >
              Snooze
            </button>
            {task.due_date && (
              <button
                className="action-btn extend"
                onClick={(e) => { e.stopPropagation(); onExtend(task) }}
              >
                Extend
              </button>
            )}
            <button
              className="action-btn edit"
              onClick={(e) => { e.stopPropagation(); setExpanded(false); onEdit(task) }}
            >
              Edit
            </button>
          </div>
        </>
      )}
    </div>
  )
}
