import { useState } from 'react'
import { History } from 'lucide-react'
import { loadActivityLog, saveActivityLog, uuid } from '../../store'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import './ActivityLog.css'

const ACTION_LABELS = {
  created: 'Created',
  completed: 'Completed',
  reopened: 'Reopened',
  deleted: 'Deleted',
  status_changed: 'Status changed',
  edited: 'Edited',
  snoozed: 'Snoozed',
  skipped: 'Skipped',
  priority_changed: 'Priority changed',
}

// Muted v2 alert/accent palette — ties color to action without shouting.
const ACTION_TONE = {
  created: 'var(--v2-accent)',
  completed: '#5DBC9B',
  reopened: '#6B8AFD',
  deleted: 'var(--v2-alert-overdue)',
  status_changed: '#6B8AFD',
  edited: 'var(--v2-alert-high-pri)',
  snoozed: 'var(--v2-text-faint)',
  skipped: 'var(--v2-text-faint)',
  priority_changed: 'var(--v2-alert-high-pri)',
}

function timeAgo(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ActivityLog({ open, onRestore, onClose }) {
  const [log, setLog] = useState(loadActivityLog)
  const [filter, setFilter] = useState('all')

  const filteredLog = filter === 'deleted'
    ? log.filter(e => e.action === 'deleted')
    : log

  const handleRestore = (entry) => {
    if (!entry.task_snapshot) return
    const snapshot = { ...entry.task_snapshot }
    snapshot.status = 'not_started'
    snapshot.completed_at = null
    snapshot.id = uuid()
    onRestore(snapshot)
  }

  const handleClearLog = () => {
    if (window.confirm('Clear all activity history?')) {
      saveActivityLog([])
      setLog([])
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Activity log" terminalTitle="> log" width="wide">
      <div className="v2-activity-toolbar">
        <div className="v2-activity-filters">
          <button
            className={`v2-form-seg${filter === 'all' ? ' v2-form-seg-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className={`v2-form-seg${filter === 'deleted' ? ' v2-form-seg-active' : ''}`}
            onClick={() => setFilter('deleted')}
          >
            Deleted
          </button>
        </div>
        {log.length > 0 && (
          <button className="v2-activity-clear" onClick={handleClearLog}>
            Clear history
          </button>
        )}
      </div>

      {filteredLog.length === 0 ? (
        <EmptyState
          icon={History}
          title="No activity yet"
          body="Creates, edits, completions, snoozes, status changes, and deletes show up here as you work."
          terminalCommand="// log empty — creates, edits, completions, snoozes, status changes, and deletes will appear here"
        />
      ) : (
        <ul className="v2-activity-list">
          {filteredLog.map(entry => (
            <li key={entry.id} className="v2-activity-row">
              <div className="v2-activity-meta-row">
                <span
                  className="v2-activity-action"
                  style={{ color: ACTION_TONE[entry.action] || 'var(--v2-text-meta)' }}
                >
                  {ACTION_LABELS[entry.action] || entry.action}
                </span>
                <span className="v2-activity-time">{timeAgo(entry.timestamp)}</span>
              </div>
              <div className="v2-activity-title">{entry.task_title}</div>
              {entry.action === 'deleted' && entry.task_snapshot && (
                <button className="v2-activity-restore" onClick={() => handleRestore(entry)}>
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  )
}
