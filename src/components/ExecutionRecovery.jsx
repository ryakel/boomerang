import { useEffect, useState } from 'react'

async function choose(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok || data.error) throw new Error(data.error || 'The recovery choice could not be confirmed. Refresh its status.')
  return data
}

export function ExecutionRecovery({ record, onModify }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const act = async choice => {
    setBusy(true); setError('')
    try {
      const data = await choose(`/api/adviser/executions/${record.executionId}/recover`, { sequence: record.sequence, choice })
      if (choice === 'modify') onModify?.(data)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  if (record.state !== 'stopped' || record.undoApplied) return null
  const remaining = record.results.filter(r => r.state === 'not_started').length
  return <div>
    <p>Stopped. {remaining} {remaining === 1 ? 'action remains' : 'actions remain'}. What now?</p>
    <div className="v2-local-undo-actions">
      <button className="v2-adviser-btn v2-adviser-btn-primary" disabled={busy} onClick={() => act('continue')}>Continue{remaining ? ` (${remaining} remaining)` : ' to finish'}</button>
      <button className="v2-adviser-link" disabled={busy} onClick={() => act('modify')}>Modify remaining actions</button>
    </div>
    <p>Continue runs only the remaining approved actions. Modify starts a new review. Review Undo below to reverse supported changes.</p>
    {error && <p role="alert">{error}</p>}
  </div>
}

export default function SessionRecovery({ sessionId, runnerState, onModify, onReview }) {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setSnapshot(null)
    if (!sessionId) return
    fetch(`/api/adviser/session/${sessionId}`).then(r => r.ok ? r.json() : null).then(data => { if (!cancelled) setSnapshot(data) }).catch(() => {})
    return () => { cancelled = true }
  }, [sessionId, runnerState])
  const act = async choice => {
    try {
      const data = await choose(`/api/adviser/session/${sessionId}/recover`, { choice })
      if (choice === 'modify') onModify?.(data)
      else onReview?.(data)
    } catch (err) { setError(err.message) }
  }
  if (!snapshot || (!['stopped','stopping'].includes(runnerState) && !snapshot.queue?.length && !snapshot.modificationContext)) return null
  return <section className="v2-adviser-plan" aria-label="What now">
    {runnerState === 'stopping' && <p>Stopping after the current request settles. Its outcome may still need checking.</p>}
    {runnerState === 'stopped' && !snapshot.hasRecovery && <>
      <p>What now? Use the execution choices below for applied actions. If thinking stopped before Apply, continue to review the staged changes or modify your request.</p>
      <button className="v2-adviser-link" onClick={() => act('continue')}>Continue to review</button>{' '}
      <button className="v2-adviser-link" onClick={() => act('modify')}>Modify request</button>
    </>}
    {snapshot.modificationContext && <p>Describe the changes you want to the remaining actions. The revised plan will need approval.</p>}
    {!!snapshot.queue?.length && <><p>Queued messages are held for your review:</p><ul>{snapshot.queue.map((item, index) => <li key={index}>{item.message}</li>)}</ul><p>Send a message again when you want to act on it.</p></>}
    {error && <p role="alert">{error}</p>}
  </section>
}
