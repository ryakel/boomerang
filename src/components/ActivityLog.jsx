import { useState, useEffect, useMemo, useRef } from 'react'
import {
  History, Search, Sparkles, X, Plus, Check, RotateCcw, Trash2,
  ArrowRightLeft, Pencil, Clock3, FastForward, Flag, AlertTriangle,
} from 'lucide-react'
import { loadActivityLog, saveActivityLog, uuid, localYMD } from '../store'
import { aiSearchActivity } from '../api'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import './ActivityLog.css'

const ACTION_LABELS = {
  created: 'Created',
  completed: 'Completed',
  reopened: 'Reopened',
  deleted: 'Deleted',
  status_changed: 'Status changed',
  edited: 'Edited',
  snoozed: 'Snoozed',
  skipped: 'Skipped',
  priority_changed: 'Priority changed',
  error: 'Error',
}

const ACTION_ICONS = {
  created: Plus,
  completed: Check,
  reopened: RotateCcw,
  deleted: Trash2,
  status_changed: ArrowRightLeft,
  edited: Pencil,
  snoozed: Clock3,
  skipped: FastForward,
  priority_changed: Flag,
  error: AlertTriangle,
}

const ACTION_TONE = {
  created: 'var(--v2-accent)',
  completed: '#5DBC9B',
  reopened: '#6B8AFD',
  deleted: 'var(--v2-alert-overdue)',
  status_changed: '#6B8AFD',
  edited: 'var(--v2-alert-high-pri)',
  snoozed: 'var(--v2-text-faint)',
  skipped: 'var(--v2-text-faint)',
  priority_changed: 'var(--v2-alert-high-pri)',
  error: '#E8443A',
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

function dayLabel(ymd) {
  const today = localYMD(new Date())
  if (ymd === today) return 'Today'
  const y = new Date(); y.setDate(y.getDate() - 1)
  if (ymd === localYMD(y)) return 'Yesterday'
  const [yy, mm, dd] = ymd.split('-').map(Number)
  return new Date(yy, mm - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function ActivityLog({ open, onRestore, onClose }) {
  const [log, setLog] = useState(loadActivityLog)
  const [filter, setFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [aiMatchedIds, setAiMatchedIds] = useState(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isAI, setIsAI] = useState(false)
  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (open) {
      setLog(loadActivityLog())
      setSearchQuery('')
      setAiMatchedIds(null)
      setIsAI(false)
    }
  }, [open])

  const baseFiltered = filter === 'deleted'
    ? log.filter(e => e.action === 'deleted')
    : filter === 'errors'
    ? log.filter(e => e.action === 'error')
    : log

  // Local filter (instant)
  const localFiltered = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase()
    return baseFiltered.filter(e =>
      (e.task_title || '').toLowerCase().includes(q) ||
      (ACTION_LABELS[e.action] || '').toLowerCase().includes(q)
    )
  }, [searchQuery, baseFiltered])

  // AI search (debounced)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setAiMatchedIds(null)
      setIsAI(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const items = baseFiltered.map(e => ({
          id: e.id,
          title: `${ACTION_LABELS[e.action] || e.action}: ${e.task_title || '(untitled)'}`,
        }))
        const data = await aiSearchActivity(searchQuery, items)
        if (data.matchedIds) {
          setAiMatchedIds(new Set(data.matchedIds))
          setIsAI(data.ai || false)
        }
      } catch {
        // local fallback is already showing
      } finally {
        setIsSearching(false)
      }
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery, baseFiltered])

  const filteredLog = useMemo(() => {
    if (!searchQuery.trim()) return baseFiltered
    if (aiMatchedIds) {
      return baseFiltered.filter(e => aiMatchedIds.has(e.id))
    }
    return localFiltered || baseFiltered
  }, [searchQuery, baseFiltered, aiMatchedIds, localFiltered])

  const isFiltering = searchQuery.trim().length > 0

  const handleRestore = (entry) => {
    if (!entry.task_snapshot) return
    const snapshot = { ...entry.task_snapshot }
    snapshot.status = 'not_started'
    snapshot.completed_at = null
    snapshot.id = uuid()
    onRestore(snapshot)
  }

  const handleClearLog = () => {
    if (window.confirm('Clear all activity history?')) {
      saveActivityLog([])
      setLog([])
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Activity log" width="wide">
      {/* Search bar */}
      <div className="v2-smart-search">
        <Search size={15} className="v2-smart-search-icon" />
        <input
          ref={searchRef}
          type="text"
          className="v2-smart-search-input"
          placeholder="Search activity…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoComplete="off"
          spellCheck="false"
        />
        {isSearching && <span className="v2-smart-search-spinner" />}
        {isAI && !isSearching && <Sparkles size={13} className="v2-smart-search-ai" />}
        {searchQuery && (
          <button className="v2-smart-search-clear" onClick={() => { setSearchQuery(''); searchRef.current?.focus() }}>
            <X size={13} />
          </button>
        )}
      </div>

      <div className="v2-activity-toolbar">
        <div className="v2-activity-filters">
          <button
            className={`v2-form-seg${filter === 'all' ? ' v2-form-seg-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className={`v2-form-seg${filter === 'deleted' ? ' v2-form-seg-active' : ''}`}
            onClick={() => setFilter('deleted')}
          >
            Deleted
          </button>
          <button
            className={`v2-form-seg${filter === 'errors' ? ' v2-form-seg-active' : ''}`}
            onClick={() => setFilter('errors')}
          >
            Errors
          </button>
        </div>
        {log.length > 0 && (
          <button className="v2-activity-clear" onClick={handleClearLog}>
            Clear history
          </button>
        )}
      </div>

      {isFiltering && filteredLog.length > 0 && (
        <div className="v2-smart-search-count">
          {filteredLog.length} result{filteredLog.length !== 1 ? 's' : ''}
          {isAI && ' · AI-assisted'}
        </div>
      )}

      {isFiltering && filteredLog.length === 0 ? (
        <div className="v2-smart-search-empty">
          No matches for "{searchQuery}"
        </div>
      ) : filteredLog.length === 0 ? (
        <EmptyState
          icon={History}
          title="No activity yet"
          body="Creates, edits, completions, snoozes, status changes, and deletes show up here as you work."
        />
      ) : (
        <ul className="v2-activity-list">
          {(() => {
            // Group under day headers — a flat 200-row stream was unscannable.
            const groups = []
            for (const entry of filteredLog) {
              const key = localYMD(new Date(entry.timestamp))
              const g = groups[groups.length - 1]
              if (g && g.key === key) g.entries.push(entry)
              else groups.push({ key, entries: [entry] })
            }
            return groups.map(g => (
              <li key={g.key} className="v2-activity-group">
                <div className="v2-activity-day">{dayLabel(g.key)}</div>
                {g.entries.map(entry => {
                  const Icon = ACTION_ICONS[entry.action] || History
                  const tone = ACTION_TONE[entry.action] || 'var(--v2-text-meta)'
                  return (
                    <div key={entry.id} className="v2-activity-row">
                      <span className="v2-activity-icon" style={{ '--tone': tone }}>
                        <Icon size={13} strokeWidth={2.2} />
                      </span>
                      <div className="v2-activity-body">
                        <div className="v2-activity-title">{entry.task_title || '(untitled)'}</div>
                        <div className="v2-activity-meta-row">
                          <span className="v2-activity-action" style={{ color: tone }}>
                            {ACTION_LABELS[entry.action] || entry.action}
                          </span>
                          <span className="v2-activity-time">{timeAgo(entry.timestamp)}</span>
                        </div>
                        {entry.action === 'error' && entry.task_snapshot?.error && (
                          <pre className="v2-activity-error-detail">{entry.task_snapshot.error}</pre>
                        )}
                      </div>
                      {entry.action === 'deleted' && entry.task_snapshot && (
                        <button className="v2-activity-restore" onClick={() => handleRestore(entry)}>
                          Restore
                        </button>
                      )}
                    </div>
                  )
                })}
              </li>
            ))
          })()}
        </ul>
      )}
    </ModalShell>
  )
}
