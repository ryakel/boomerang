import { useEffect, useState } from 'react'
import LocalUndo from './LocalUndo'
import { ExecutionRecovery } from './ExecutionRecovery'

const labels = {
  stopping: 'Stopping after the current request', stopped: 'Stopped — what now?', modified: 'Remaining actions moved to a new review',
  running: 'Applying changes', completed: 'Actions reported applied',
  partial: 'Some actions need checking', needs_checking: 'Outcome needs checking',
  conflict: 'Plan changed — review again', undone: 'Local changes undone',
}
const stepLabels = {
  not_started: 'Not started', executing: 'Executing', reported_applied: 'Reported applied',
  unknown: 'Outcome not verified', compensating: 'Attempting restoration',
  compensation_unverified: 'Restoration not verified',
  verified_undone: 'Local change undone',
}

export default function ExecutionStatus({ chatId, onRecords, onModify }) {
  const [records, setRecords] = useState([])
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    let inFlight = false
    setRecords([])
    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const response = await fetch(`/api/adviser/executions?chatId=${encodeURIComponent(chatId)}`, { cache: 'no-store' })
        if (!response.ok) throw new Error('Status unavailable')
        const data = await response.json()
        if (!cancelled) { setRecords(data.executions); setError(false); onRecords?.(data.executions) }
      } catch { if (!cancelled) setError(true) }
      finally { inFlight = false }
    }
    if (!chatId) return
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [chatId, onRecords])
  if (!chatId) return null
  const visible = [...records.filter(r => r.state !== 'completed'), ...records.filter(r => r.state === 'completed').slice(0, 5)]
  return <section className="v2-execution-status" aria-label="Execution status" aria-live="polite">
    {error && <p role="status">Execution status unavailable. Check what happened before trying again.</p>}
    {visible.map(record => <details open={['running','stopping','stopped','needs_checking'].includes(record.state) || undefined} key={record.executionId} className="v2-adviser-plan">
      <summary>{record.undoApplied && record.state === 'partial' ? 'Local changes undone; other actions remain' : record.undoOf && record.ok ? 'Undo completed' : labels[record.state] || 'Outcome needs checking'} · {new Date(record.createdAt).toLocaleString()}</summary>
      {record.error && <p>{record.error}</p>}
      <ul>{record.results.map(step => <li key={step.stepId}>
        {step.toolName.replace(/^gcal_/, 'calendar_').replaceAll('_', ' ')}: {stepLabels[step.state] || 'Outcome not verified'}
      </li>)}</ul>
      {(record.state === 'partial' || record.state === 'needs_checking') &&
        <p>Check affected tasks or the connected service. These actions will not be retried automatically.</p>}
      {['running','stopping'].includes(record.state) && <button className="v2-adviser-link" onClick={async () => {
        try {
          const response = await fetch('/api/adviser/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: record.sessionId }) })
          if (!response.ok) setError(true)
        } catch { setError(true) }
      }}>Stop</button>}
      <ExecutionRecovery record={record} onModify={onModify} />
      <LocalUndo record={record} />
    </details>)}
  </section>
}
