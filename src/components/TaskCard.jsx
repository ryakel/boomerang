import { useState } from 'react'
import { loadLabels, isStale, isSnoozed, isOverdue, formatSnoozeLabel, formatDueDate, daysOld } from '../store'

export default function TaskCard({ task, onComplete, onSnooze, onEdit, onExtend, onBacklog, onFindRelated }) {
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
          {task.size && (
            <span className={`size-pill size-${task.size.toLowerCase()}`}>{task.size}</span>
          )}
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
            {task.status !== 'backlog' ? (
              <button
                className="action-btn backlog"
                onClick={(e) => { e.stopPropagation(); onBacklog(task.id, true) }}
              >
                Backlog
              </button>
            ) : (
              <button
                className="action-btn snooze"
                onClick={(e) => { e.stopPropagation(); onBacklog(task.id, false) }}
              >
                Activate
              </button>
            )}
            {!task.notion_page_id && onFindRelated && (
              <button
                className="action-btn find-related"
                onClick={(e) => { e.stopPropagation(); onFindRelated(task) }}
              >
                Find related
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
