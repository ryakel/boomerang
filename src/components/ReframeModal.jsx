import { useState } from 'react'
import { reframeTask } from '../api'

export default function ReframeModal({ task, onReframe, onClose }) {
  const [blocker, setBlocker] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)

  const handleSubmit = async () => {
    if (!blocker.trim()) return
    setLoading(true)
    setError(null)
    try {
      const newTasks = await reframeTask(task.title, task.snooze_count, blocker.trim())
      setResults(newTasks)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = () => {
    onReframe(task.id, results, task.tags)
    onClose()
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">This one keeps coming back.</div>
        <div className="sheet-subtitle">
          "{task.title}" has been snoozed {task.snooze_count} times. What's actually in the way?
        </div>

        {!results ? (
          <>
            <textarea
              className="reframe-input"
              placeholder="What's blocking you?"
              value={blocker}
              onChange={e => setBlocker(e.target.value)}
            />
            {error && (
              <div style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 12 }}>{error}</div>
            )}
            <button
              className="submit-btn"
              disabled={!blocker.trim() || loading}
              onClick={handleSubmit}
            >
              {loading ? <><span className="spinner" /> Reframing...</> : 'Reframe It'}
            </button>
          </>
        ) : (
          <>
            <div className="reframe-results">
              {results.map((title, i) => (
                <div key={i} className="reframe-task">{title}</div>
              ))}
            </div>
            <button className="submit-btn" onClick={handleConfirm}>
              Looks good
            </button>
          </>
        )}
      </div>
    </div>
  )
}
