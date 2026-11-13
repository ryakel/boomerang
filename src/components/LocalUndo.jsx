import { useState } from 'react'

const fieldLabels = { title: 'Title', notes: 'Notes', due_date: 'Due date', body: 'Note', pinned: 'Pinned on Today' }
const display = (field, value) => field === 'pinned' ? (value ? 'Yes' : 'No') : String(value ?? '(empty)')

export default function LocalUndo({ record }) {
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (record.undoOf || record.state === 'undone') return null
  const review = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/adviser/executions/${record.executionId}/undo`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Undo preview unavailable. Try reviewing it again.')
      setPreview(await response.json())
    } catch { setError('Undo preview unavailable. Try reviewing it again.') }
    finally { setBusy(false) }
  }
  const apply = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/adviser/executions/${record.executionId}/undo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: preview.revision }),
      })
      const outcome = await response.json()
      if (!response.ok || !outcome.ok) throw Object.assign(new Error(outcome.error || 'Undo needs checking. Inspect the result before taking further action.'), { display: true })
      setPreview(null)
    } catch (e) { setError(e.display ? e.message : 'Undo outcome unavailable. Check the result before retrying.') }
    finally { setBusy(false) }
  }
  return <div>
    <button className="v2-adviser-link" onClick={review} disabled={busy}>Review Undo</button>
    {error && <p role="alert">{error}</p>}
    {preview && <div aria-label="Undo preview">
      <p>Only the local changes listed below will be undone.</p>
      <ul>{preview.actions.map(action => <li key={action.stepId}>
        {action.action === 'create' ? `Remove the created ${action.kind}` : `Restore ${action.kind} fields`}: {action.targetLabel}
        {action.fields.map(change => <div key={change.field}>
          {fieldLabels[change.field] || change.field}: “{display(change.field, change.from)}” → “{display(change.field, change.to)}”
        </div>)}
        {action.reason && <p>{action.reason}</p>}
      </li>)}</ul>
      {preview.unsupported.length > 0 && <>
        <p>These other actions cannot be undone here and will remain:</p>
        <ul>{preview.unsupported.map((name, index) => <li key={index}>{name.replace(/^gcal_/, 'calendar_').replaceAll('_', ' ')}</li>)}</ul>
      </>}
      {!preview.actions.length && <p>No supported local changes are available to undo.</p>}
      <div className="v2-local-undo-actions">
        <button className="v2-adviser-link" onClick={() => setPreview(null)} disabled={busy}>Cancel Undo</button>
        <button className="v2-adviser-btn v2-adviser-btn-primary" onClick={apply} disabled={busy || !preview.available}>Undo local changes</button>
      </div>
    </div>}
  </div>
}
