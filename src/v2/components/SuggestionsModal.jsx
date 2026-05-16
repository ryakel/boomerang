import { useState, useEffect, useCallback } from 'react'
import { Check, X, Clock, Sparkles } from 'lucide-react'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import './SuggestionsModal.css'

// Format cadence as a human-friendly chip.
const CADENCE_LABEL = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  annually: 'annually',
}

function timeAgo(epochMs) {
  if (!epochMs) return ''
  const days = Math.floor((Date.now() - epochMs) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function SuggestionCard({ suggestion, onAccept, onSnooze, onDismiss, busy }) {
  const [showSamples, setShowSamples] = useState(false)
  const samples = suggestion.sample_titles || []
  const extraSampleCount = Math.max(0, samples.length - 1)
  const confidence = Math.round((suggestion.confidence || 0) * 100)
  return (
    <li className="v2-suggestion-card">
      <div className="v2-suggestion-head">
        <div className="v2-suggestion-title-row">
          <span className="v2-suggestion-title">{suggestion.display_title}</span>
          <span className={`v2-suggestion-cadence v2-suggestion-cadence-${suggestion.detected_cadence}`}>
            {CADENCE_LABEL[suggestion.detected_cadence] || suggestion.detected_cadence}
          </span>
        </div>
        <div className="v2-suggestion-meta">
          <span>{suggestion.occurrence_count}× in past 12mo</span>
          <span className="v2-suggestion-meta-sep">·</span>
          <span>last {timeAgo(suggestion.last_seen_at)}</span>
          <span className="v2-suggestion-meta-sep">·</span>
          <span title="Confidence">{confidence}% match</span>
        </div>
        {extraSampleCount > 0 && (
          <button className="v2-suggestion-samples-toggle" onClick={() => setShowSamples(v => !v)}>
            {showSamples ? 'Hide variants' : `and ${extraSampleCount} similar`}
          </button>
        )}
        {showSamples && (
          <ul className="v2-suggestion-samples">
            {samples.map((s, i) => (
              <li key={i} className="v2-suggestion-sample">{s}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="v2-suggestion-actions">
        <button
          className="v2-suggestion-action v2-suggestion-action-primary"
          disabled={busy}
          onClick={() => onAccept(suggestion)}
          title="Create a routine from this pattern"
        >
          <Check size={14} strokeWidth={1.75} /> Make it a routine
        </button>
        <button
          className="v2-suggestion-action"
          disabled={busy}
          onClick={() => onSnooze(suggestion, 14)}
          title="Don't show this for the next 2 weeks"
        >
          <Clock size={14} strokeWidth={1.75} /> Not yet (14d)
        </button>
        <button
          className="v2-suggestion-action v2-suggestion-action-danger"
          disabled={busy}
          onClick={() => onDismiss(suggestion)}
          title="Hide this pattern permanently"
        >
          <X size={14} strokeWidth={1.75} /> Dismiss
        </button>
      </div>
    </li>
  )
}

export default function SuggestionsModal({ open, onClose, onAccepted }) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [recentAcceptTitle, setRecentAcceptTitle] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/suggestions')
      if (res.ok) {
        const data = await res.json()
        setSuggestions(data.suggestions || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleAccept = async (sug) => {
    setBusyId(sug.id)
    try {
      // Sensible defaults: daily/weekly → auto+auto_roll (they're frequent
      // enough that missed days shouldn't stack). Longer cadences → just auto
      // since stacking less of a concern. User can refine on the Routines
      // screen afterward.
      const shouldAutoRoll = ['daily', 'weekly'].includes(sug.detected_cadence)
      const routineConfig = {
        title: sug.display_title,
        cadence: sug.detected_cadence,
        auto_roll: shouldAutoRoll,
      }
      const res = await fetch(`/api/suggestions/${sug.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routineConfig }),
      })
      if (res.ok) {
        setRecentAcceptTitle(sug.display_title)
        setTimeout(() => setRecentAcceptTitle(null), 4000)
        await load()
        onAccepted?.()
      }
    } finally {
      setBusyId(null)
    }
  }

  const handleSnooze = async (sug, days = 14) => {
    setBusyId(sug.id)
    try {
      const res = await fetch(`/api/suggestions/${sug.id}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      if (res.ok) await load()
    } finally {
      setBusyId(null)
    }
  }

  const handleDismiss = async (sug) => {
    setBusyId(sug.id)
    try {
      const res = await fetch(`/api/suggestions/${sug.id}/dismiss`, { method: 'POST' })
      if (res.ok) await load()
    } finally {
      setBusyId(null)
    }
  }

  const handleScan = async () => {
    setLoading(true)
    try {
      await fetch('/api/suggestions/scan', { method: 'POST' })
      await load()
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Routine suggestions"
      terminalTitle="$ suggestions"
      subtitle={suggestions.length === 0
        ? (loading ? 'Loading…' : undefined)
        : `${suggestions.length} waiting`}
      width="wide"
    >
      {recentAcceptTitle && (
        <div className="v2-suggestion-toast">
          <Sparkles size={14} strokeWidth={1.75} />
          Created routine “{recentAcceptTitle}”. Open Routines to refine.
        </div>
      )}
      {suggestions.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No suggestions right now"
          body="Boomerang scans your completed task history weekly (Sundays at 3am) and surfaces patterns that look routine-shaped. Once you've completed a recurring task a few times, it'll show up here."
          cta="Run scan now"
          ctaOnClick={handleScan}
        />
      ) : (
        <>
          <div className="v2-suggestion-hint">
            Boomerang noticed these in your completed history. Accept to turn into a routine, snooze if you're not sure, or dismiss to hide permanently.
          </div>
          <ul className="v2-suggestion-list">
            {suggestions.map(s => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                onAccept={handleAccept}
                onSnooze={handleSnooze}
                onDismiss={handleDismiss}
                busy={busyId === s.id}
              />
            ))}
          </ul>
          <button className="v2-suggestion-scan-link" onClick={handleScan} disabled={loading}>
            {loading ? 'Scanning…' : 'Run scan now'}
          </button>
        </>
      )}
    </ModalShell>
  )
}
