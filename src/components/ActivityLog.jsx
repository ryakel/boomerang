import { useState } from 'react'
import { loadActivityLog, saveActivityLog } from '../store'

const ACTION_LABELS = {
  created: 'Created',
  completed: 'Completed',
  deleted: 'Deleted',
  status_changed: 'Status changed',
  edited: 'Edited',
  snoozed: 'Snoozed',
  priority_changed: 'Priority changed',
}

const ACTION_COLORS = {
  created: '#52C97F',
  completed: '#52C97F',
  deleted: '#FF3B30',
  status_changed: '#4A9EFF',
  edited: '#FFB347',
  snoozed: '#8E8E93',
  priority_changed: '#FF9500',
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

export default function ActivityLog({ onRestore, onClose }) {
  const [log, setLog] = useState(loadActivityLog)
  const [filter, setFilter] = useState('all') // 'all' | 'deleted'

  const filteredLog = filter === 'deleted'
    ? log.filter(e => e.action === 'deleted')
    : log

  const handleRestore = (entry) => {
    if (!entry.task_snapshot) return
    const snapshot = { ...entry.task_snapshot }
    snapshot.status = 'not_started'
    snapshot.completed_at = null
    snapshot.id = crypto.randomUUID() // new ID to avoid conflicts
    onRestore(snapshot)
  }

  const handleClearLog = () => {
    if (window.confirm('Clear all activity history?')) {
      saveActivityLog([])
      setLog([])
    }
  }

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Activity Log</div>
        <button className="settings-back" onClick={handleClearLog} style={{ color: '#FF3B30', fontSize: 12 }}>Clear</button>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 16px', marginBottom: 12 }}>
        <button
          className={`notif-freq ${filter === 'all' ? 'notif-freq-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          className={`notif-freq ${filter === 'deleted' ? 'notif-freq-active' : ''}`}
          onClick={() => setFilter('deleted')}
        >
          Deleted
        </button>
      </div>

      {filteredLog.length === 0 && (
        <div className="empty-state">No activity yet.</div>
      )}

      {filteredLog.map(entry => (
        <div key={entry.id} className="activity-entry">
          <div className="activity-entry-top">
            <span
              className="activity-action"
              style={{ color: ACTION_COLORS[entry.action] || 'var(--text-dim)' }}
            >
              {ACTION_LABELS[entry.action] || entry.action}
            </span>
            <span className="activity-time">{timeAgo(entry.timestamp)}</span>
          </div>
          <div className="activity-title">{entry.task_title}</div>
          {entry.action === 'deleted' && entry.task_snapshot && (
            <button
              className="action-btn snooze"
              style={{ marginTop: 6, fontSize: 12, padding: '4px 10px' }}
              onClick={() => handleRestore(entry)}
            >
              Restore
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
