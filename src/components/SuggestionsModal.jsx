import { useState, useEffect, useCallback } from 'react'
import { Check, X, Clock, Sparkles, Tag } from 'lucide-react'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import { getTagSuggestions, dismissTagSuggestion, scanTagSuggestions } from '../api'
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

function TagSuggestionCard({ suggestion, onAdd, onDismiss, busy }) {
  return (
    <li className="v2-suggestion-card v2-tagsug-card">
      <div className="v2-suggestion-head">
        <div className="v2-suggestion-title-row">
          <span className="v2-tagsug-chip"><Tag size={12} strokeWidth={2} /> {suggestion.name}</span>
        </div>
        {suggestion.rationale && <div className="v2-tagsug-rationale">{suggestion.rationale}</div>}
        {Array.isArray(suggestion.examples) && suggestion.examples.length > 0 && (
          <ul className="v2-suggestion-samples">
            {suggestion.examples.map((s, i) => <li key={i} className="v2-suggestion-sample">{s}</li>)}
          </ul>
        )}
      </div>
      <div className="v2-suggestion-actions">
        <button
          className="v2-suggestion-action v2-suggestion-action-primary"
          disabled={busy}
          onClick={() => onAdd(suggestion)}
          title="Create this label"
        >
          <Check size={14} strokeWidth={1.75} /> Add tag
        </button>
        <button
          className="v2-suggestion-action v2-suggestion-action-danger"
          disabled={busy}
          onClick={() => onDismiss(suggestion)}
          title="Hide this tag suggestion"
        >
          <X size={14} strokeWidth={1.75} /> Dismiss
        </button>
      </div>
    </li>
  )
}

export default function SuggestionsModal({ open, onClose, onAccepted, onCreateTag, title = 'Routine suggestions' }) {
  const [suggestions, setSuggestions] = useState([])
  const [tagSuggestions, setTagSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [recentAcceptTitle, setRecentAcceptTitle] = useState(null)
  const [scanResult, setScanResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [routineRes, tagRes] = await Promise.allSettled([
        fetch('/api/suggestions').then(r => (r.ok ? r.json() : null)),
        getTagSuggestions().catch(() => null),
      ])
      if (routineRes.status === 'fulfilled' && routineRes.value) setSuggestions(routineRes.value.suggestions || [])
      if (tagRes.status === 'fulfilled' && tagRes.value) setTagSuggestions(tagRes.value.suggestions || [])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleAddTag = async (sug) => {
    setBusyId(sug.id)
    try {
      onCreateTag?.(sug.name)
      await dismissTagSuggestion(sug.id)
      setTagSuggestions(prev => prev.filter(s => s.id !== sug.id))
    } finally {
      setBusyId(null)
    }
  }

  const handleDismissTag = async (sug) => {
    setBusyId(sug.id)
    try {
      await dismissTagSuggestion(sug.id)
      setTagSuggestions(prev => prev.filter(s => s.id !== sug.id))
    } finally {
      setBusyId(null)
    }
  }

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
      // Surface what the scan actually saw — a silent empty result is
      // indistinguishable from a broken scanner (prod report 2026-06-11).
      const [res] = await Promise.all([
        fetch('/api/suggestions/scan', { method: 'POST' }),
        scanTagSuggestions().catch(() => null), // discover new tags in the same pass
      ])
      const data = await res.json().catch(() => null)
      setScanResult(res.ok && data?.ok ? data : { error: data?.error || `scan failed (${res.status})` })
      await load()
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={title}
      subtitle={(suggestions.length + tagSuggestions.length) === 0
        ? (loading ? 'Loading…' : undefined)
        : `${suggestions.length + tagSuggestions.length} waiting`}
      width="wide"
    >
      {recentAcceptTitle && (
        <div className="v2-suggestion-toast">
          <Sparkles size={14} strokeWidth={1.75} />
          Created routine “{recentAcceptTitle}”. Open Routines to refine.
        </div>
      )}

      {tagSuggestions.length > 0 && (
        <>
          <div className="v2-suggestion-hint">
            <Tag size={13} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Themes Boomerang noticed across your recent tasks. Add the ones worth tracking as labels — new tasks then auto-tag with them.
          </div>
          <ul className="v2-suggestion-list">
            {tagSuggestions.map(s => (
              <TagSuggestionCard
                key={s.id}
                suggestion={s}
                onAdd={handleAddTag}
                onDismiss={handleDismissTag}
                busy={busyId === s.id}
              />
            ))}
          </ul>
        </>
      )}

      {suggestions.length === 0 && tagSuggestions.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={scanResult ? 'Scan complete — nothing routine-shaped yet' : 'No suggestions right now'}
          body={scanResult
            ? (scanResult.error
              ? `The scan hit an error: ${scanResult.error}`
              : `Scanned ${scanResult.scanned} completed task${scanResult.scanned === 1 ? '' : 's'} and found ${scanResult.candidates} repeating candidate${scanResult.candidates === 1 ? '' : 's'}; ${scanResult.surfaced} cleared the confidence bar. Tasks spawned by your existing loops are skipped on purpose — only ad-hoc repeats count, and a pattern needs 3+ completions at a steady rhythm before it surfaces.`)
            : 'Boomerang scans your task history weekly (Sundays) and surfaces routine-shaped patterns and new tag themes. Once you\'ve completed a recurring task a few times, or built up a theme across tasks, it\'ll show up here.'}
          cta={loading ? 'Scanning…' : 'Run scan now'}
          ctaOnClick={handleScan}
        />
      ) : suggestions.length > 0 ? (
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
      ) : (
        <button className="v2-suggestion-scan-link" onClick={handleScan} disabled={loading}>
          {loading ? 'Scanning…' : 'Run scan now'}
        </button>
      )}
    </ModalShell>
  )
}
