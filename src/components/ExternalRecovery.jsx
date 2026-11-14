import { useState } from 'react'
const text = value => typeof value === 'object' ? JSON.stringify(value) : String(value ?? '(empty)')
export default function ExternalRecovery({ record, step }) {
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (!step.evidence) return null
  const base = `/api/adviser/executions/${record.executionId}/steps/${step.stepId}`
  const request = async (path, method = 'GET', body) => {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(base + path, { method, cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || 'Recovery changed. Review the latest status.')
      if (path === '/undo' && method === 'GET') setPreview(data)
      else { setPreview(null); setMessage(data.ok ? 'Outcome verified.' : 'Check the updated evidence. Uncertain actions remain blocked.') }
    } catch (error) { setMessage(error.message || 'Recovery unavailable. Check status before retrying.') }
    finally { setBusy(false) }
  }
  return <div>
    <p>{step.evidence.service === 'Calendar' ? `Calendar: ${step.evidence.calendarId} · Event: ${step.evidence.eventId}` : `Trello checklist: ${step.evidence.checklistId || 'identity unknown'} · ${step.evidence.itemIds?.length || 0} acknowledged items`}</p>
    {step.evidence.cleanup && <p>Cleanup: {step.evidence.cleanup.replaceAll('_', ' ')}. {step.evidence.cleanup !== 'verified_absent' && 'Inspect the card; remaining effects are preserved.'}</p>}
    {['unknown','compensation_unverified'].includes(step.state) && <button className="v2-adviser-link" disabled={busy} onClick={() => request('/check', 'POST')}>Check outcome</button>}
    {step.evidence.service === 'Calendar' && step.state !== 'verified_undone' && <button className="v2-adviser-link" disabled={busy} onClick={() => request('/undo')}>Review Calendar Undo</button>}
    {message && <p role="status">{message}</p>}
    {preview && <div aria-label="Calendar Undo preview">
      <p>{preview.action}: {preview.label} (calendar {preview.calendarId}).</p>
      {preview.fields.map(change => <p key={change.field}>{change.field}: {text(change.from)} → {text(change.to)}</p>)}
      <p>{preview.warning}</p>
      {preview.reason && <p>{preview.reason}</p>}
      <div className="v2-local-undo-actions">
        <button className="v2-adviser-link" disabled={busy} onClick={() => setPreview(null)}>Cancel Calendar Undo</button>
        <button className="v2-adviser-btn v2-adviser-btn-primary" disabled={busy || !preview.available} onClick={() => request('/undo', 'POST', { revision: preview.revision })}>Undo Calendar action</button>
      </div>
    </div>}
  </div>
}
