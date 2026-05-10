import { useState } from 'react'
import { Sparkles, X, Check } from 'lucide-react'
import { aiReconcileChain } from '../../api'
import './ChainReconcileModal.css'

// Sequences PR 4. Lives between the routine form's save click and the
// actual save. When the user has edited any step's title in a follow-up
// chain that has 2+ steps, this modal asks: "want Quokka to scan the
// rest of the chain for matching updates?" If they accept, calls the AI,
// shows per-suggestion accept/reject toggles, then applies the accepted
// suggestions and proceeds with the save.
//
// The form owns the actual save — this modal is purely about deciding
// what `follow_ups` array to commit. The lifecycle is:
//   review → loading → diffs → done (calls onApply with final chain)
//   review → done (calls onApply with the user's chain unchanged — skip)
//   any state → cancel (calls onCancel; form goes back to editable state)
//
// Quokka-aware: failures fall back to "save without scan" silently so a
// stale or down API never blocks the user from saving.
const STATE = { REVIEW: 'review', LOADING: 'loading', DIFFS: 'diffs', NONE_FOUND: 'none-found' }

export default function ChainReconcileModal({
  open,
  parentTitle,
  originalChain,
  currentChain,
  onApply,
  onCancel,
}) {
  const [state, setState] = useState(STATE.REVIEW)
  const [suggestions, setSuggestions] = useState([])
  const [accepted, setAccepted] = useState({})  // stepIndex -> boolean
  const [error, setError] = useState(null)

  if (!open) return null

  // Compute title-only diff summary for the review screen.
  const changes = []
  for (const cur of currentChain) {
    const orig = originalChain.find(s => s.id === cur.id)
    if (!orig) changes.push({ kind: 'added', title: cur.title })
    else if ((orig.title || '') !== (cur.title || '')) changes.push({ kind: 'edited', from: orig.title, to: cur.title })
  }
  for (const orig of originalChain) {
    if (!currentChain.find(s => s.id === orig.id)) changes.push({ kind: 'removed', title: orig.title })
  }

  const askQuokka = async () => {
    setState(STATE.LOADING)
    setError(null)
    try {
      const result = await aiReconcileChain(originalChain, currentChain, parentTitle)
      if (!result.length) {
        setState(STATE.NONE_FOUND)
      } else {
        // Default all suggestions to accepted — the user can opt out per row.
        const initialAccepted = {}
        for (const s of result) initialAccepted[s.stepIndex] = true
        setSuggestions(result)
        setAccepted(initialAccepted)
        setState(STATE.DIFFS)
      }
    } catch (err) {
      setError(err.message || 'AI reconciliation failed')
      setState(STATE.REVIEW)
    }
  }

  const skipScan = () => {
    onApply(currentChain)
  }

  const applySuggestions = () => {
    // Merge accepted suggestions into a fresh chain copy.
    const finalChain = currentChain.map((step, idx) => {
      const sug = suggestions.find(s => s.stepIndex === idx)
      if (sug && accepted[idx]) {
        return { ...step, title: sug.suggestedTitle }
      }
      return step
    })
    onApply(finalChain)
  }

  return (
    <div className="v2-reconcile-overlay" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="v2-reconcile" onClick={e => e.stopPropagation()}>
        <button type="button" className="v2-reconcile-close" onClick={onCancel} aria-label="Close">
          <X size={18} strokeWidth={1.75} />
        </button>

        {state === STATE.REVIEW && (
          <>
            <div className="v2-reconcile-header">
              <Sparkles size={18} className="v2-reconcile-spark" />
              <h3 className="v2-reconcile-title">Scan the rest of the chain?</h3>
            </div>
            <p className="v2-reconcile-body">
              You changed {changes.length} step{changes.length === 1 ? '' : 's'} in this chain.
              Quokka can read the unchanged steps and suggest matching updates if any of them
              now read inconsistently. Suggestions are opt-in per step — nothing applies
              automatically.
            </p>
            <ul className="v2-reconcile-changes">
              {changes.map((c, i) => (
                <li key={i} className={`v2-reconcile-change v2-reconcile-change-${c.kind}`}>
                  {c.kind === 'edited' && (
                    <>
                      <span className="v2-reconcile-change-from">{c.from}</span>
                      <span className="v2-reconcile-change-arrow">→</span>
                      <span className="v2-reconcile-change-to">{c.to}</span>
                    </>
                  )}
                  {c.kind === 'added' && <span>+ {c.title}</span>}
                  {c.kind === 'removed' && <span>− {c.title}</span>}
                </li>
              ))}
            </ul>
            {error && <p className="v2-reconcile-error">{error}</p>}
            <div className="v2-reconcile-actions">
              <button type="button" className="v2-reconcile-btn v2-reconcile-btn-cancel" onClick={skipScan}>
                Save without scan
              </button>
              <button type="button" className="v2-reconcile-btn v2-reconcile-btn-primary" onClick={askQuokka}>
                <Sparkles size={14} strokeWidth={2} />
                Ask Quokka
              </button>
            </div>
          </>
        )}

        {state === STATE.LOADING && (
          <div className="v2-reconcile-loading">
            <Sparkles size={20} className="v2-reconcile-spark v2-reconcile-spark-spin" />
            <p>Quokka is reading your chain…</p>
          </div>
        )}

        {state === STATE.NONE_FOUND && (
          <>
            <div className="v2-reconcile-header">
              <Check size={18} className="v2-reconcile-check" />
              <h3 className="v2-reconcile-title">Chain reads clean</h3>
            </div>
            <p className="v2-reconcile-body">
              Quokka didn't find any steps that need updating. Your edits are
              consistent with the rest of the chain.
            </p>
            <div className="v2-reconcile-actions">
              <button type="button" className="v2-reconcile-btn v2-reconcile-btn-primary" onClick={skipScan}>
                Save chain
              </button>
            </div>
          </>
        )}

        {state === STATE.DIFFS && (
          <>
            <div className="v2-reconcile-header">
              <Sparkles size={18} className="v2-reconcile-spark" />
              <h3 className="v2-reconcile-title">{suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'}</h3>
            </div>
            <p className="v2-reconcile-body">
              Quokka spotted these steps that may now read inconsistently. Toggle
              the ones you want to apply.
            </p>
            <ul className="v2-reconcile-suggestions">
              {suggestions.map(s => (
                <li key={s.stepIndex} className="v2-reconcile-suggestion">
                  <label className="v2-reconcile-suggestion-row">
                    <input
                      type="checkbox"
                      checked={!!accepted[s.stepIndex]}
                      onChange={e => setAccepted(prev => ({ ...prev, [s.stepIndex]: e.target.checked }))}
                    />
                    <div className="v2-reconcile-suggestion-content">
                      <div className="v2-reconcile-suggestion-diff">
                        <span className="v2-reconcile-change-from">{s.originalTitle}</span>
                        <span className="v2-reconcile-change-arrow">→</span>
                        <span className="v2-reconcile-change-to">{s.suggestedTitle}</span>
                      </div>
                      {s.reasoning && (
                        <div className="v2-reconcile-suggestion-reason">{s.reasoning}</div>
                      )}
                    </div>
                  </label>
                </li>
              ))}
            </ul>
            <div className="v2-reconcile-actions">
              <button type="button" className="v2-reconcile-btn v2-reconcile-btn-cancel" onClick={skipScan}>
                Skip all
              </button>
              <button type="button" className="v2-reconcile-btn v2-reconcile-btn-primary" onClick={applySuggestions}>
                Apply selected
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
