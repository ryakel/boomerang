import { useState } from 'react'
import { reframeTask } from '../../api'
import ModalShell from './ModalShell'
import './ReframeModal.css'

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
    <ModalShell
      open={!!task}
      onClose={onClose}
      title="This one keeps coming back"
      subtitle={`"${task.title}" has been snoozed ${task.snooze_count} times. What's actually in the way?`}
    >
      {!results ? (
        <>
          <textarea
            className="v2-reframe-input"
            placeholder="What's blocking you? Be specific."
            value={blocker}
            onChange={e => setBlocker(e.target.value)}
            autoFocus
          />
          {error && <div className="v2-reframe-error">{error}</div>}
          <button
            className="v2-form-submit"
            disabled={!blocker.trim() || loading}
            onClick={handleSubmit}
          >
            {loading ? <><span className="v2-spinner" /> Reframing…</> : 'Reframe it'}
          </button>
        </>
      ) : (
        <>
          <ul className="v2-reframe-results">
            {results.map((title, i) => (
              <li key={i} className="v2-reframe-result-row">
                <span className="v2-reframe-result-bullet">→</span>
                <span>{title}</span>
              </li>
            ))}
          </ul>
          <button className="v2-form-submit" onClick={handleConfirm}>
            Looks good
          </button>
        </>
      )}
    </ModalShell>
  )
}
