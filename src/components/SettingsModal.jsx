import { useState, useEffect, useRef, useCallback } from 'react'
import { Trash2, Download, Upload, RefreshCw, Copy, FileText, ArrowUp, ArrowDown, Plus, ChevronRight } from 'lucide-react'
import {
  loadSettings, saveSettings, loadTasks, saveTasks,
  loadRoutines, saveRoutines, loadLabels, saveLabels,
  LABEL_COLORS, uuid, localYMD,
} from '../store'
import { restoreFromBackup } from '../api'
import { usePushSubscription } from '../hooks/usePushSubscription'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import AutosaveIndicator from './AutosaveIndicator'
import { applyTheme } from '../theme'
import './SettingsModal.css'

// Shared toggle switch — was locally defined inside NotificationsPanel and
// hand-copied at ~10 other call sites across IntegrationsPanel/General. One
// definition so a future visual tweak doesn't need a find-and-replace.
function Toggle({ checked, onChange, disabled }) {
  return (
    <label className={`v2-settings-toggle${disabled ? ' v2-settings-toggle-disabled' : ''}`}>
      <input type="checkbox" checked={!!checked} onChange={onChange} disabled={disabled} />
      <span className="v2-settings-toggle-track"><span className="v2-settings-toggle-thumb" /></span>
    </label>
  )
}

// Labels tab — extracted so SettingsModal stays readable.
function LabelsPanel() {
  const [labels, setLabels] = useState(() => loadLabels())
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(LABEL_COLORS[0])
  const [confirmDelete, setConfirmDelete] = useState(null) // label.id

  const persist = (next) => {
    setLabels(next)
    saveLabels(next)
  }

  const addLabel = () => {
    const name = newName.trim()
    if (!name) return
    const next = [...labels, { id: uuid(), name, color: newColor }]
    persist(next)
    setNewName('')
    const idx = LABEL_COLORS.indexOf(newColor)
    setNewColor(LABEL_COLORS[(idx + 1) % LABEL_COLORS.length])
  }

  const removeLabel = (id) => {
    persist(labels.filter(l => l.id !== id))
    setConfirmDelete(null)
  }

  const updateLabel = (id, patch) => {
    persist(labels.map(l => (l.id === id ? { ...l, ...patch } : l)))
  }

  const moveLabel = (id, dir) => {
    const idx = labels.findIndex(l => l.id === id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= labels.length) return
    const next = [...labels]
    const [item] = next.splice(idx, 1)
    next.splice(target, 0, item)
    persist(next)
  }

  return (
    <div className="v2-settings-form">
      <div className="v2-settings-block">
        <div className="v2-form-label">Existing labels</div>
        <div className="v2-settings-row-hint">Tap a name to rename. Color swatches show the picker. Use the arrows to reorder.</div>
        {labels.length === 0 ? (
          <div className="v2-labels-empty">No labels yet. Add one below.</div>
        ) : (
          <ul className="v2-labels-list">
            {labels.map((label, idx) => (
              <li key={label.id} className="v2-labels-row">
                <details className="v2-labels-color">
                  <summary className="v2-labels-swatch" style={{ background: label.color }} aria-label="Change color" />
                  <div className="v2-labels-color-picker">
                    {LABEL_COLORS.map(c => (
                      <button
                        key={c}
                        className={`v2-labels-color-dot${label.color === c ? ' v2-labels-color-dot-active' : ''}`}
                        style={{ background: c }}
                        onClick={() => updateLabel(label.id, { color: c })}
                        aria-label={`Set color to ${c}`}
                      />
                    ))}
                  </div>
                </details>
                <input
                  className="v2-labels-name"
                  value={label.name}
                  onChange={e => updateLabel(label.id, { name: e.target.value })}
                />
                <div className="v2-labels-actions">
                  <button
                    className="v2-labels-icon-btn"
                    onClick={() => moveLabel(label.id, -1)}
                    disabled={idx === 0}
                    aria-label="Move up"
                  >
                    <ArrowUp size={14} strokeWidth={1.75} />
                  </button>
                  <button
                    className="v2-labels-icon-btn"
                    onClick={() => moveLabel(label.id, 1)}
                    disabled={idx === labels.length - 1}
                    aria-label="Move down"
                  >
                    <ArrowDown size={14} strokeWidth={1.75} />
                  </button>
                  {confirmDelete === label.id ? (
                    <>
                      <button
                        className="v2-labels-icon-btn v2-labels-icon-btn-confirm"
                        onClick={() => removeLabel(label.id)}
                        aria-label="Confirm delete"
                      >
                        Yes
                      </button>
                      <button
                        className="v2-labels-icon-btn"
                        onClick={() => setConfirmDelete(null)}
                        aria-label="Cancel"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      className="v2-labels-icon-btn v2-labels-icon-btn-danger"
                      onClick={() => setConfirmDelete(label.id)}
                      aria-label="Delete"
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="v2-settings-block">
        <div className="v2-form-label">Add a label</div>
        <div className="v2-labels-add">
          <details className="v2-labels-color">
            <summary className="v2-labels-swatch" style={{ background: newColor }} aria-label="Pick color" />
            <div className="v2-labels-color-picker">
              {LABEL_COLORS.map(c => (
                <button
                  key={c}
                  className={`v2-labels-color-dot${newColor === c ? ' v2-labels-color-dot-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setNewColor(c)}
                  aria-label={`Set color to ${c}`}
                />
              ))}
            </div>
          </details>
          <input
            className="v2-labels-name"
            placeholder="Label name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addLabel() }}
          />
          <button
            className="v2-settings-btn"
            onClick={addLabel}
            disabled={!newName.trim()}
          >
            <Plus size={13} strokeWidth={2} /> Add
          </button>
        </div>
      </div>
    </div>
  )
}


// IA rethink (2026-07-11, "shit is everywhere" prod feedback): the old 7-tab
// layout split closely-related settings across tabs with no cross-reference
// (task-behavior thresholds lived in General while the AI tone that shapes
// the same tasks lived in a near-empty standalone AI tab; the rarely-used
// server-log viewer got its own top-level tab despite being pure diagnostics,
// same category as the Data tab's activity log / backup tools). Folded AI's
// one real setting (custom instructions) in next to the task-behavior
// thresholds it's most related to as "Tasks", and Logs into Data.
const TABS = ['General', 'Tasks', 'Labels', 'Integrations', 'Notifications', 'Data']

// All Settings tabs now have v2 implementations.

// Notification types (excluding high priority which has its own escalation
// section) + their channel-specific setting key suffixes. Same scheme v1
// uses: push_notif_<key>, email_notif_<key>, pushover_notif_<key>.
const NOTIF_TYPES = [
  { key: 'overdue', label: 'Overdue', desc: 'Past-due tasks. Repeats until done or snoozed.', freqKey: 'notif_freq_overdue', freqDefault: 0.5 },
  { key: 'stale', label: 'Stale', desc: 'Tasks untouched longer than the staleness threshold (set in General).', freqKey: 'notif_freq_stale', freqDefault: 0.5 },
  { key: 'nudge', label: 'Nudges', desc: 'General "got a minute?" pokes when the list is sitting idle.', freqKey: 'notif_freq_nudge', freqDefault: 1 },
  { key: 'size', label: 'Size-based', desc: 'Heads-up on L/XL tasks approaching their due date.', freqKey: 'notif_freq_size', freqDefault: 1 },
  { key: 'pileup', label: 'Pile-up', desc: 'Warning when too many active tasks accumulate.', freqKey: 'notif_freq_pileup', freqDefault: 2 },
  // Habit nudges are throttled per-routine (24h), not by global frequency —
  // freqKey/freqDefault carried for matrix consistency but the dispatcher
  // ignores them.
  { key: 'habit_nudge', label: 'Habit nudges', desc: 'Behind-pace pokes for habit routines (e.g. "2× / week").', freqKey: 'notif_freq_habit_nudge', freqDefault: 24 },
  // Activity Prompts PR 3: weekly suggestion summary. The frequency input is
  // carried for matrix consistency but the dispatcher hard-codes weekly.
  { key: 'routine_suggestion', label: 'Routine suggestions', desc: 'Weekly summary of pattern-detected routine candidates.', freqKey: 'notif_freq_routine_suggestion', freqDefault: 168 },
]

const NOTIF_PACKAGE_TYPES = [
  { key: 'package_delivered', label: 'Package delivered', desc: 'Shipping carrier reports the package was delivered.' },
  { key: 'package_exception', label: 'Package exception', desc: 'Delivery issue or routing problem reported by carrier.' },
  { key: 'package_signature', label: 'Signature required', desc: 'Carrier reports the package needs a signature on delivery.' },
]

// Integrations panel — status summary + inline config for each
// OAuth-heavy ones. Inline credential entry for simple key-only integrations
// (Anthropic, 17track) since those are one-field forms.
// Anthropic key entry + test. Embedded under the Anthropic row in
// IntegrationsPanel; the Tasks tab just shows a one-liner pointer back here.
function AnthropicKeyBlock({ settings, update, embedded = false }) {
  const [envKey, setEnvKey] = useState(false)
  const [status, setStatus] = useState(null) // null | 'checking' | 'connected' | 'error'
  const [error, setError] = useState(null)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    import('../api').then(m => m.getKeyStatus()).then(keys => {
      if (!cancelled) setEnvKey(!!keys?.anthropic)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const runTest = async () => {
    setStatus('checking')
    setError(null)
    try {
      const api = await import('../api')
      await api.callClaude('Respond with just "ok".', 'ping')
      setStatus('connected')
      setTimeout(() => setStatus(s => s === 'connected' ? null : s), 4000)
    } catch (e) {
      setStatus('error')
      setError(e?.message || 'Connection failed — check your key')
    }
  }

  const hasKey = envKey || !!settings.anthropic_api_key
  const summary = status === 'checking' ? 'Checking…'
    : status === 'connected' ? 'Connected ✓'
    : status === 'error' ? (error || 'Connection failed')
    : envKey ? 'Provided via env var'
    : settings.anthropic_api_key ? 'Key saved'
    : 'Not configured'
  const summaryClass = status === 'connected' ? 'v2-integrations-status-ok'
    : status === 'error' ? 'v2-integrations-error'
    : 'v2-integrations-hint'

  const inner = (
    <>
      {!embedded && (
        <>
          <div className="v2-form-label">Anthropic API key</div>
          <div className="v2-settings-row-hint">
            Powers AI inference, Quokka, polish, what-now suggestions, and notification rewrites.
            Keys at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          </div>
        </>
      )}
      {envKey ? (
        <div className="v2-integrations-env">
          Provided via env var. Configure server-side; this field is read-only.
        </div>
      ) : (
        <>
          <input
            type={showKey ? 'text' : 'password'}
            className="v2-form-input"
            placeholder="sk-ant-…"
            value={settings.anthropic_api_key || ''}
            onChange={e => { update('anthropic_api_key', e.target.value); setStatus(null) }}
          />
          <div className="v2-integrations-actions">
            <button className="v2-settings-btn" onClick={() => setShowKey(s => !s)}>
              {showKey ? 'Hide key' : 'Show key'}
            </button>
            <button
              className="v2-settings-btn"
              onClick={runTest}
              disabled={!hasKey || status === 'checking'}
            >
              {status === 'checking' ? 'Testing…' : 'Test'}
            </button>
            {settings.anthropic_api_key && (
              <button
                className="v2-settings-btn v2-settings-btn-danger"
                onClick={() => { update('anthropic_api_key', ''); setStatus(null) }}
              >
                Disconnect
              </button>
            )}
          </div>
        </>
      )}
      {envKey && (
        <div className="v2-integrations-actions">
          <button className="v2-settings-btn" onClick={runTest} disabled={status === 'checking'}>
            {status === 'checking' ? 'Testing…' : 'Test'}
          </button>
        </div>
      )}
      <div className={summaryClass}>{summary}</div>
    </>
  )

  return embedded ? inner : <div className="v2-settings-block">{inner}</div>
}

function IntegrationsPanel({
  settings, update, setActiveTab,
  onTrelloSync, trelloSyncing, onNotionSync, notionSyncing, onGCalSync, gcalSyncing,
}) {
  const [envKeys, setEnvKeys] = useState({ anthropic: false, notion: false, trello: false, tracking: false })
  const [statuses, setStatuses] = useState({})
  const [pushoverTest, setPushoverTest] = useState({ status: null, error: null })
  const [pushoverEmer, setPushoverEmer] = useState({ status: null, error: null })
  const [emergencyConfirm, setEmergencyConfirm] = useState(false)
  const [gmailSyncing, setGmailSyncing] = useState(false)
  const [gmailSyncResult, setGmailSyncResult] = useState(null)
  const [gcalBulkDeleting, setGcalBulkDeleting] = useState(false)
  const [gcalBulkDeleteResult, setGcalBulkDeleteResult] = useState(null)
  const [trackingTestResult, setTrackingTestResult] = useState(null)
  const [gmailResetting, setGmailResetting] = useState(false)
  const [weatherQuery, setWeatherQuery] = useState('')
  const [weatherResults, setWeatherResults] = useState([])
  const [weatherSearching, setWeatherSearching] = useState(false)
  const [weatherError, setWeatherError] = useState(null)
  const [notionSearchQuery, setNotionSearchQuery] = useState('')
  const [notionSearchResults, setNotionSearchResults] = useState(null)
  const [notionSearching, setNotionSearching] = useState(false)
  const [notionSearchError, setNotionSearchError] = useState(null)
  const [notionReconnecting, setNotionReconnecting] = useState(false)
  const [notionChildCount, setNotionChildCount] = useState(null)
  const [notionDbInput, setNotionDbInput] = useState('')
  const [notionDbVerifying, setNotionDbVerifying] = useState(false)
  const [notionDbError, setNotionDbError] = useState(null)
  const [showNotionTemplate, setShowNotionTemplate] = useState(false)
  // Knowledge base setup state — separate from sync-parent so the two
  // Notion features stay independent.
  const [kbStatus, setKbStatus] = useState(null) // { configured, database_id, database_url, last_sync }
  const [kbSetupBusy, setKbSetupBusy] = useState(false)
  const [kbError, setKbError] = useState(null)
  const [trelloBoards, setTrelloBoardsList] = useState([])
  const [trelloLists, setTrelloListsList] = useState([])
  const [trelloListsLoading, setTrelloListsLoading] = useState(false)
  const [gcalCalendars, setGcalCalendarsList] = useState([])

  // Load Trello boards + GCal calendars when their integrations are connected.
  useEffect(() => {
    if (!statuses.trello?.connected) return
    let cancelled = false
    import('../api').then(m => m.trelloBoards()).then(boards => {
      if (!cancelled) setTrelloBoardsList(Array.isArray(boards) ? boards : [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [statuses.trello?.connected])

  useEffect(() => {
    if (!settings.trello_board_id || !statuses.trello?.connected) return
    let cancelled = false
    setTrelloListsLoading(true)
    import('../api').then(m => m.trelloBoardLists(settings.trello_board_id)).then(lists => {
      if (!cancelled) setTrelloListsList(Array.isArray(lists) ? lists : [])
    }).catch(() => { if (!cancelled) setTrelloListsList([]) })
      .finally(() => { if (!cancelled) setTrelloListsLoading(false) })
    return () => { cancelled = true }
  }, [settings.trello_board_id, statuses.trello?.connected])

  useEffect(() => {
    if (!statuses.gcal?.connected) return
    let cancelled = false
    import('../api').then(m => m.gcalListCalendars()).then(cals => {
      if (!cancelled) setGcalCalendarsList(Array.isArray(cals) ? cals : [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [statuses.gcal?.connected])

  const handleTrelloBoardChange = (boardId) => {
    update('trello_board_id', boardId)
    update('trello_list_id', '') // reset list when board changes
    setTrelloListsList([])
  }

  // Trello connect — key + token verification (no popup OAuth; Trello's
  // dev portal generates a long-lived token that the user pastes here).
  const [trelloConnecting, setTrelloConnecting] = useState(false)
  const [trelloError, setTrelloError] = useState(null)
  const [showTrelloCreds, setShowTrelloCreds] = useState(false)

  const handleTrelloConnect = async () => {
    setTrelloConnecting(true)
    setTrelloError(null)
    try {
      const api = await import('../api')
      const status = await api.trelloStatus()
      if (status.connected) {
        setStatuses(prev => ({ ...prev, trello: status }))
        const boards = await api.trelloBoards().catch(() => [])
        setTrelloBoardsList(Array.isArray(boards) ? boards : [])
      } else {
        setTrelloError('Could not connect. Check your API key and token.')
      }
    } catch (e) {
      setTrelloError(e?.message || 'Connect failed')
    } finally {
      setTrelloConnecting(false)
    }
  }

  const handleTrelloDisconnect = () => {
    update('trello_api_key', '')
    update('trello_secret', '')
    setStatuses(prev => ({ ...prev, trello: { connected: false } }))
    setTrelloBoardsList([])
  }

  // GCal connect — popup OAuth. Server returns authUrl; we open it in a
  // popup; on success the popup posts {type: 'gcal-connected'} which
  // triggers a status refresh.
  const [gcalConnecting, setGcalConnecting] = useState(false)
  const [gcalError, setGcalError] = useState(null)
  const [showGcalCreds, setShowGcalCreds] = useState(false)

  const handleGcalConnect = async () => {
    setGcalConnecting(true)
    setGcalError(null)
    try {
      const api = await import('../api')
      const { url } = await api.gcalGetAuthUrl()
      window.open(url, '_blank', 'width=500,height=600')
    } catch (e) {
      setGcalError(e?.message || 'Connect failed')
    } finally {
      setGcalConnecting(false)
    }
  }

  const handleGcalDisconnect = async () => {
    try {
      const api = await import('../api')
      await api.gcalDisconnect()
      setStatuses(prev => ({ ...prev, gcal: { connected: false } }))
    } catch { /* swallow */ }
  }

  // Gmail connect — same popup pattern as GCal, reuses gcal_client_id +
  // gcal_client_secret (same Google Cloud project). Status refreshed via
  // postMessage handler below.
  const [gmailConnecting, setGmailConnecting] = useState(false)
  const [gmailError, setGmailError] = useState(null)

  const handleGmailConnect = async () => {
    setGmailConnecting(true)
    setGmailError(null)
    try {
      const api = await import('../api')
      const { url } = await api.gmailGetAuthUrl()
      window.open(url, '_blank', 'width=500,height=600')
    } catch (e) {
      setGmailError(e?.message || 'Connect failed')
    } finally {
      setGmailConnecting(false)
    }
  }

  const handleGmailDisconnect = async () => {
    try {
      const api = await import('../api')
      await api.gmailDisconnect()
      setStatuses(prev => ({ ...prev, gmail: { connected: false } }))
    } catch { /* swallow */ }
  }

  const handleGcalBulkDelete = async () => {
    setGcalBulkDeleting(true)
    setGcalBulkDeleteResult(null)
    try {
      const api = await import('../api')
      const r = await api.gcalBulkDeleteEvents(settings.gcal_calendar_id || 'primary')
      setGcalBulkDeleteResult(`Deleted ${r.deleted || 0} events, unlinked ${r.unlinked || 0} tasks`)
    } catch (e) { setGcalBulkDeleteResult(e?.message || 'Failed') }
    finally { setGcalBulkDeleting(false) }
  }

  const handleTrackingTest = async () => {
    setTrackingTestResult(null)
    try {
      const api = await import('../api')
      const r = await api.testTrackingConnection()
      setTrackingTestResult(r?.ok ? `Connected — ${r.remaining ?? '?'} queries remaining` : (r?.error || 'Failed'))
    } catch (e) { setTrackingTestResult(e?.message || 'Failed') }
  }

  const handleGmailReset = async () => {
    setGmailResetting(true)
    try {
      const api = await import('../api')
      await api.gmailReset()
      await api.gmailSync()
      setGmailSyncResult('Reset complete — rescanning…')
    } catch { /* swallow */ }
    finally { setGmailResetting(false) }
  }

  const handleWeatherRefresh = async () => {
    try {
      const api = await import('../api')
      await api.refreshWeather({ force: true })
    } catch { /* swallow */ }
  }

  // Popup postMessage handlers — refresh status when the OAuth callback page
  // signals success.
  useEffect(() => {
    const handler = async (event) => {
      if (event.data?.type === 'gcal-connected') {
        try {
          const api = await import('../api')
          const s = await api.gcalStatus()
          setStatuses(prev => ({ ...prev, gcal: s }))
        } catch { /* swallow */ }
      } else if (event.data?.type === 'notion-mcp-connected') {
        try {
          const api = await import('../api')
          const s = await api.notionStatus()
          setStatuses(prev => ({ ...prev, notion: s }))
        } catch { /* swallow */ }
      } else if (event.data?.type === 'gmail-connected') {
        try {
          const api = await import('../api')
          const s = await api.gmailStatus()
          setStatuses(prev => ({ ...prev, gmail: s }))
        } catch { /* swallow */ }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const runNotionSearch = async () => {
    const q = notionSearchQuery.trim()
    if (!q) return
    setNotionSearching(true)
    setNotionSearchError(null)
    setNotionSearchResults(null)
    try {
      const api = await import('../api')
      const results = await api.notionSearch(q)
      setNotionSearchResults(Array.isArray(results) ? results : [])
    } catch (e) {
      setNotionSearchError(e?.message || 'Search failed')
    } finally {
      setNotionSearching(false)
    }
  }

  const pickNotionParent = async (page) => {
    update('notion_sync_parent_id', page.id)
    update('notion_sync_parent_title', page.title)
    setNotionSearchResults(null)
    setNotionSearchQuery('')
    try {
      const api = await import('../api')
      const children = await api.notionGetChildPages(page.id)
      setNotionChildCount(Array.isArray(children) ? children.length : null)
    } catch { /* swallow — count is informational */ }
  }

  const clearNotionParent = () => {
    update('notion_sync_parent_id', '')
    update('notion_sync_parent_title', '')
    setNotionChildCount(null)
  }

  const [notionConnectError, setNotionConnectError] = useState(null)
  const [notionAuthUrl, setNotionAuthUrl] = useState(null)

  const reconnectNotionMCP = async () => {
    setNotionReconnecting(true)
    setNotionConnectError(null)
    setNotionAuthUrl(null)
    try {
      const api = await import('../api')
      const result = await api.notionMCPConnect()
      if (result.alreadyAuthorized) {
        const s = await api.notionStatus()
        setStatuses(prev => ({ ...prev, notion: s }))
      } else if (result.authUrl) {
        const popup = window.open(result.authUrl, 'notion-mcp-auth', 'width=600,height=700')
        if (!popup) setNotionAuthUrl(result.authUrl)
      }
    } catch (e) {
      setNotionConnectError(e?.message || 'Connection failed — check server logs for details')
    } finally {
      setNotionReconnecting(false)
    }
  }

  const handleConnectDatabase = async () => {
    const input = notionDbInput.trim()
    if (!input) return
    setNotionDbVerifying(true)
    setNotionDbError(null)
    try {
      const api = await import('../api')
      let dbId = input
      const urlMatch = input.match(/([a-f0-9]{32})/)
      if (urlMatch) dbId = urlMatch[1]
      if (dbId.length === 32 && !dbId.includes('-')) {
        dbId = `${dbId.slice(0,8)}-${dbId.slice(8,12)}-${dbId.slice(12,16)}-${dbId.slice(16,20)}-${dbId.slice(20)}`
      }
      const result = await api.notionQueryDatabase(dbId)
      const title = result.pages?.[0]?.title ? `Database (${result.pages.length} rows)` : 'Connected database'
      update('notion_db_id', dbId)
      update('notion_db_title', title)
      setNotionDbInput('')
    } catch (err) {
      setNotionDbError(err.message || 'Could not connect to database. Check the ID and permissions.')
    } finally {
      setNotionDbVerifying(false)
    }
  }

  const disconnectNotionMCP = async () => {
    try {
      const api = await import('../api')
      await api.notionMCPDisconnect()
      setStatuses(prev => ({ ...prev, notion: { connected: false } }))
      clearNotionParent()
    } catch { /* swallow */ }
  }

  // Auto-load child count for already-configured parent pages on mount.
  useEffect(() => {
    if (!settings.notion_sync_parent_id || !statuses.notion?.connected) return
    let cancelled = false
    import('../api').then(m => m.notionGetChildPages(settings.notion_sync_parent_id))
      .then(c => { if (!cancelled) setNotionChildCount(Array.isArray(c) ? c.length : null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [settings.notion_sync_parent_id, statuses.notion?.connected])

  // Load knowledge-base status whenever the Notion connection state flips.
  useEffect(() => {
    if (!statuses.notion?.connected) { setKbStatus(null); return }
    let cancelled = false
    import('../api').then(m => m.knowledgeStatus())
      .then(s => { if (!cancelled) setKbStatus(s) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [statuses.notion?.connected])

  const [kbExistingInput, setKbExistingInput] = useState('')
  const runKnowledgeAdopt = async () => {
    setKbError(null)
    setKbSetupBusy(true)
    try {
      const api = await import('../api')
      const result = await api.knowledgeSetup(null, kbExistingInput.trim())
      const next = await api.knowledgeStatus()
      setKbStatus(next || result)
      setKbExistingInput('')
    } catch (e) {
      setKbError(e?.message || 'Could not connect that database')
    } finally {
      setKbSetupBusy(false)
    }
  }

  const runKnowledgeSetup = async () => {
    setKbError(null)
    setKbSetupBusy(true)
    try {
      const api = await import('../api')
      const result = await api.knowledgeSetup()
      const next = await api.knowledgeStatus()
      setKbStatus(next || result)
    } catch (e) {
      setKbError(e?.message || 'Setup failed')
    } finally {
      setKbSetupBusy(false)
    }
  }

  const runKnowledgeRefresh = async () => {
    setKbError(null)
    try {
      const api = await import('../api')
      await api.knowledgeRefresh()
      const next = await api.knowledgeStatus()
      setKbStatus(next)
    } catch (e) {
      setKbError(e?.message || 'Refresh failed')
    }
  }

  const runWeatherSearch = async () => {
    const q = weatherQuery.trim()
    if (!q) return
    setWeatherSearching(true)
    setWeatherError(null)
    setWeatherResults([])
    try {
      const api = await import('../api')
      const results = await api.geocodeWeather(q)
      if (!results || results.length === 0) setWeatherError('No matches found')
      else setWeatherResults(results)
    } catch (e) {
      setWeatherError(e?.message || 'Search failed')
    } finally {
      setWeatherSearching(false)
    }
  }

  const pickWeatherLocation = async (r) => {
    update('weather_latitude', r.latitude)
    update('weather_longitude', r.longitude)
    update('weather_location_name', r.label)
    if (r.timezone) update('weather_timezone', r.timezone)
    if (!settings.weather_enabled) update('weather_enabled', true)
    setWeatherResults([])
    setWeatherQuery('')
    try {
      const api = await import('../api')
      await api.refreshWeather({ force: true })
    } catch { /* status will catch up on next mount */ }
  }

  const clearWeatherLocation = () => {
    update('weather_latitude', null)
    update('weather_longitude', null)
    update('weather_location_name', '')
    update('weather_enabled', false)
  }

  const runGmailSync = async () => {
    setGmailSyncing(true)
    setGmailSyncResult(null)
    try {
      const api = await import('../api')
      const result = await api.gmailSync(settings.gmail_scan_days || 7)
      setGmailSyncResult(`${result.tasksCreated || 0} task(s), ${result.packagesCreated || 0} package(s)`)
      setTimeout(() => setGmailSyncResult(null), 6000)
    } catch (e) {
      setGmailSyncResult(`Error: ${e?.message || 'Sync failed'}`)
    } finally {
      setGmailSyncing(false)
    }
  }

  // Load env-key flags + each integration's connection status on mount.
  // Failures are silent — a missing status just leaves the dot grey.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      import('../api').then(m => m.getKeyStatus()).catch(() => ({})),
      import('../api').then(m => m.notionStatus()).catch(() => null),
      import('../api').then(m => m.trelloStatus()).catch(() => null),
      import('../api').then(m => m.gcalStatus()).catch(() => null),
      import('../api').then(m => m.gmailStatus()).catch(() => null),
      import('../api').then(m => m.pushoverStatus()).catch(() => null),
    ]).then(([keys, notion, trello, gcal, gmail, pushover]) => {
      if (cancelled) return
      setEnvKeys(keys || {})
      setStatuses({ notion, trello, gcal, gmail, pushover })
    })
    return () => { cancelled = true }
  }, [])

  const integrations = [
    {
      key: 'anthropic',
      label: 'Anthropic (Claude)',
      hint: 'Powers AI inference, Quokka, polish, what-now suggestions, notification rewrites.',
      connected: envKeys.anthropic || !!settings.anthropic_api_key,
      inline: 'anthropic',
    },
    {
      key: 'notion',
      label: 'Notion',
      hint: statuses.notion?.mcpHealth?.needsReauth
        ? 'MCP connection expired — reconnect to restore Quokka + Knowledge Base.'
        : 'Pull pages as tasks, sync edits both ways. MCP-based connection (recommended).',
      connected: statuses.notion?.mcpHealth?.needsReauth ? 'warn' : !!(statuses.notion?.connected || statuses.notion?.mcpHealth?.connected),
      sync: onNotionSync && settings.notion_sync_parent_id ? { fn: onNotionSync, busy: notionSyncing } : null,
      inline: 'notion-full',
    },
    {
      key: 'trello',
      label: 'Trello',
      hint: 'Push tasks to Trello with checklists + attachments. Bidirectional status sync.',
      connected: !!statuses.trello?.connected,
      sub: statuses.trello?.username ? `Connected as ${statuses.trello.username}` : null,
      // trello_sync_enabled has no UI control anywhere and was never true,
      // so this button could never appear — condition on trello_board_id
      // instead (mirrors Notion's notion_sync_parent_id check above).
      sync: onTrelloSync && settings.trello_board_id ? { fn: onTrelloSync, busy: trelloSyncing } : null,
      inline: statuses.trello?.connected ? 'trello-config' : 'trello-connect',
    },
    {
      key: 'gcal',
      label: 'Google Calendar',
      hint: 'Schedule tasks as events, AI-inferred times, optional pull-from-calendar.',
      connected: !!statuses.gcal?.connected,
      sub: statuses.gcal?.email,
      sync: onGCalSync && settings.gcal_pull_enabled ? { fn: onGCalSync, busy: gcalSyncing } : null,
      inline: statuses.gcal?.connected ? 'gcal-config' : 'gcal-connect',
    },
    {
      key: 'gmail',
      label: 'Gmail',
      hint: 'AI-extracted tasks + tracking numbers from your inbox. Manual approval per item.',
      connected: !!statuses.gmail?.connected,
      sub: statuses.gmail?.email,
      sync: statuses.gmail?.connected ? { fn: runGmailSync, busy: gmailSyncing } : null,
      syncResult: gmailSyncResult,
      inline: statuses.gmail?.connected ? 'gmail-config' : 'gmail-connect',
    },
    {
      key: 'tracking',
      label: '17track (packages)',
      hint: 'Server-side polling for delivery status across most major carriers.',
      connected: envKeys.tracking || !!settings.tracking_api_key,
      inline: 'tracking',
    },
    {
      key: 'weather',
      label: 'Weather (Open-Meteo)',
      hint: 'Free 7-day forecast — no key, no auth. Powers task badges, "best days" picks, weather notifications.',
      connected: !!settings.weather_enabled && !!settings.weather_latitude,
      sub: settings.weather_location_name,
      inline: 'weather',
    },
    {
      key: 'pushover',
      label: 'Pushover',
      hint: 'iOS-friendly transport that bypasses Safari throttling. One-time $5 app required.',
      connected: !!statuses.pushover?.configured,
      inline: 'pushover',
      appTokenFromEnv: !!statuses.pushover?.app_token_from_env,
    },
  ]

  // Per-integration collapse state, same persisted-in-settings pattern the
  // Notifications panel already uses (collapsed_notif_sections) — this
  // panel never had it: every integration's full inline config (API key
  // fields, Disconnect, Sync Parent, Knowledge Base, etc.) rendered
  // unconditionally, forcing a long scroll with no way to fold rows shut.
  const collapsedIntegrations = settings.collapsed_integrations_sections || {}
  const isIntCollapsed = (key) => !!collapsedIntegrations[key]
  const toggleIntCollapsed = (key) => {
    update('collapsed_integrations_sections', { ...collapsedIntegrations, [key]: !collapsedIntegrations[key] })
  }

  const runPushoverTest = async (emergency) => {
    const setter = emergency ? setPushoverEmer : setPushoverTest
    setter({ status: 'sending', error: null })
    try {
      const api = await import('../api')
      const fn = emergency ? api.testPushoverEmergency : api.testPushover
      const result = await fn({
        userKey: settings.pushover_user_key,
        appToken: settings.pushover_app_token,
      })
      if (result?.success) {
        setter({ status: 'sent', error: null })
        setTimeout(() => setter({ status: null, error: null }), 4000)
      } else {
        setter({ status: 'error', error: result?.error || 'Send failed' })
      }
    } catch (e) {
      setter({ status: 'error', error: e?.message || 'Send failed' })
    }
  }

  return (
    <div className="v2-settings-form">
      <div className="v2-settings-block">
        <div className="v2-form-label">Status</div>
        <div className="v2-settings-row-hint">
          Connect, configure, and disconnect every integration inline. Tokens are shared
          Tokens persist across reloads — you only connect once.
        </div>
        <ul className="v2-integrations-list">
          {integrations.map(int => (
            <li key={int.key} className="v2-integrations-row">
              <span className={`v2-integrations-dot v2-integrations-dot-${int.connected === 'warn' ? 'warn' : int.connected ? 'connected' : 'unconfigured'}`} />
              <div className="v2-integrations-meta">
                <button
                  type="button"
                  className="v2-integrations-name v2-integrations-name-toggle"
                  onClick={() => toggleIntCollapsed(int.key)}
                  aria-expanded={!isIntCollapsed(int.key)}
                >
                  <span className="v2-settings-section-chev" aria-hidden="true">
                    {isIntCollapsed(int.key) ? '▸' : '▾'}
                  </span>
                  {int.label}
                </button>
                {int.sub && <div className="v2-integrations-sub">{int.sub}</div>}
                <div className="v2-integrations-hint">{int.hint}</div>
                {!isIntCollapsed(int.key) && (<>
                {int.inline === 'api-key' && (
                  <div className="v2-integrations-inline">
                    {int.envFlag ? (
                      <div className="v2-integrations-env">
                        Provided via env var. Configure server-side; this field is read-only.
                      </div>
                    ) : (
                      <input
                        type="password"
                        className="v2-form-input"
                        placeholder="API key…"
                        value={settings[int.keyName] || ''}
                        onChange={e => update(int.keyName, e.target.value)}
                      />
                    )}
                  </div>
                )}
                {int.inline === 'anthropic' && (
                  <div className="v2-integrations-inline">
                    <AnthropicKeyBlock settings={settings} update={update} embedded />
                  </div>
                )}
                {int.inline === 'notion-full' && (
                  <div className="v2-integrations-inline">
                    {notionConnectError && <div className="v2-integrations-warn" style={{ marginBottom: 8 }}>⚠️ {notionConnectError}</div>}
                    {notionAuthUrl && (
                      <div className="v2-integrations-hint" style={{ marginBottom: 8 }}>
                        Popup blocked — <a href={notionAuthUrl} target="_blank" rel="noreferrer">click here to connect</a>
                      </div>
                    )}
                    {!statuses.notion?.connected && !statuses.notion?.mcpHealth?.connected && !statuses.notion?.mcpHealth?.needsReauth && (
                      <button className="v2-settings-btn" onClick={reconnectNotionMCP} disabled={notionReconnecting}>
                        {notionReconnecting ? 'Connecting…' : 'Connect via MCP'}
                      </button>
                    )}
                    {statuses.notion?.mcpHealth?.needsReauth && (
                      <>
                        <div className="v2-integrations-warn" style={{ marginBottom: 8 }}>⚠️ MCP connection expired. Reconnect to restore Quokka + Knowledge Base.</div>
                        <div className="v2-integrations-actions" style={{ marginBottom: 8 }}>
                          <button className="v2-settings-btn" onClick={reconnectNotionMCP} disabled={notionReconnecting}>
                            {notionReconnecting ? 'Reconnecting…' : 'Reconnect'}
                          </button>
                          <button className="v2-settings-btn v2-settings-btn-danger" onClick={disconnectNotionMCP}>Disconnect</button>
                        </div>
                      </>
                    )}
                    {(statuses.notion?.connected || statuses.notion?.mcpHealth?.connected) && !statuses.notion?.mcpHealth?.needsReauth && (
                      <>
                        <div className="v2-integrations-actions" style={{ marginBottom: 8 }}>
                          <button className="v2-settings-btn v2-settings-btn-danger" onClick={disconnectNotionMCP}>Disconnect</button>
                        </div>
                        {settings.notion_sync_parent_id ? (
                          <>
                            <label className="v2-form-label">Sync parent</label>
                            <div className="v2-integrations-toggle-row">
                              <span>📄 {settings.notion_sync_parent_title || 'Selected page'}</span>
                              <button className="v2-settings-btn" onClick={clearNotionParent}>Change</button>
                            </div>
                            {notionChildCount != null && (
                              <div className="v2-integrations-hint">
                                {notionChildCount} child page{notionChildCount === 1 ? '' : 's'} discovered
                                {settings.notion_last_sync ? ` · last synced ${new Date(settings.notion_last_sync).toLocaleString()}` : ''}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <label className="v2-form-label">Sync parent</label>
                            <div className="v2-integrations-hint" style={{ marginBottom: 4 }}>Pick a parent page — its children become tasks.</div>
                            <div className="v2-weather-search">
                              <input type="text" className="v2-form-input" placeholder="Search Notion pages…" value={notionSearchQuery} onChange={e => setNotionSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runNotionSearch() } }} />
                              <button className="v2-settings-btn" onClick={runNotionSearch} disabled={notionSearching || !notionSearchQuery.trim()}>
                                {notionSearching ? 'Searching…' : 'Search'}
                              </button>
                            </div>
                            {notionSearchError && <div className="v2-integrations-error">{notionSearchError}</div>}
                            {notionSearchResults && notionSearchResults.length > 0 && (
                              <ul className="v2-weather-results">
                                {notionSearchResults.map(page => (
                                  <li key={page.id}><button className="v2-weather-result" onClick={() => pickNotionParent(page)}>{page.title}</button></li>
                                ))}
                              </ul>
                            )}
                            {notionSearchResults && notionSearchResults.length === 0 && (
                              <div className="v2-integrations-hint">No pages found.</div>
                            )}
                          </>
                        )}
                        <label className="v2-form-label" style={{ marginTop: 12 }}>Knowledge base</label>
                        {kbStatus?.configured ? (
                          <>
                            <div className="v2-integrations-toggle-row">
                              <span>
                                ✓ Connected
                                {kbStatus.database_url && <> · <a href={kbStatus.database_url} target="_blank" rel="noreferrer">Open in Notion</a></>}
                              </span>
                              <button className="v2-settings-btn" onClick={runKnowledgeRefresh}>Sync now</button>
                            </div>
                            <div className="v2-integrations-actions" style={{ marginTop: 4 }}>
                              <button className="v2-settings-btn v2-settings-btn-danger" onClick={async () => {
                                try {
                                  await fetch('/api/knowledge/reset', { method: 'POST' })
                                  setKbStatus(null)
                                } catch { /* swallow */ }
                              }}>Reset KB</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <button className="v2-settings-btn" onClick={runKnowledgeSetup} disabled={kbSetupBusy || !settings.notion_sync_parent_id}>
                              {kbSetupBusy ? 'Setting up…' : 'Set up Knowledge Base'}
                            </button>
                            <div className="v2-integrations-hint" style={{ marginTop: 10 }}>…or connect an existing database:</div>
                            <div className="v2-integrations-toggle-row" style={{ gap: 8 }}>
                              <input
                                className="v2-form-input"
                                style={{ flex: '1 1 auto', minWidth: 0 }}
                                placeholder="Notion database URL or ID"
                                value={kbExistingInput}
                                onChange={e => setKbExistingInput(e.target.value)}
                              />
                              <button
                                className="v2-settings-btn"
                                disabled={kbSetupBusy || !kbExistingInput.trim()}
                                onClick={runKnowledgeAdopt}
                              >Connect</button>
                            </div>
                          </>
                        )}
                        {kbStatus?.last_sync && <div className="v2-integrations-hint">Last synced {new Date(kbStatus.last_sync).toLocaleString()}</div>}
                        {!settings.notion_sync_parent_id && !kbStatus?.configured && (
                          <div className="v2-integrations-hint">Pick a sync parent first.</div>
                        )}
                        {kbError && <div className="v2-integrations-error">{kbError}</div>}

                        {/* Database Sync */}
                        <label className="v2-form-label" style={{ marginTop: 12 }}>Database sync</label>
                        {settings.notion_db_id ? (
                          <>
                            <div className="v2-integrations-toggle-row">
                              <span>📊 {settings.notion_db_title || 'Connected'}</span>
                              <button className="v2-settings-btn" onClick={() => { update('notion_db_id', ''); update('notion_db_title', '') }}>Disconnect</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="v2-integrations-hint" style={{ marginBottom: 4 }}>Paste a Notion database ID or URL to sync its rows as tasks.</div>
                            <div className="v2-weather-search">
                              <input type="text" className="v2-form-input" placeholder="Database ID or URL…" value={notionDbInput} onChange={e => { setNotionDbInput(e.target.value); setNotionDbError(null) }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleConnectDatabase() } }} />
                              <button className="v2-settings-btn" onClick={handleConnectDatabase} disabled={notionDbVerifying || !notionDbInput.trim()}>
                                {notionDbVerifying ? 'Verifying…' : 'Connect'}
                              </button>
                            </div>
                            {notionDbError && <div className="v2-integrations-error">{notionDbError}</div>}
                          </>
                        )}

                        {/* Page Template */}
                        <button className="v2-integrations-toggle-btn" onClick={() => setShowNotionTemplate(s => !s)} style={{ marginTop: 12 }}>
                          <ChevronRight size={12} className={showNotionTemplate ? 'v2-chevron-open' : ''} />
                          Page template
                        </button>
                        {showNotionTemplate && (
                          <div style={{ marginTop: 6 }}>
                            <div className="v2-integrations-hint" style={{ marginBottom: 4 }}>
                              Structure for synced Notion pages. Use ## for headings, - [ ] for tasks, &gt; for callouts.
                            </div>
                            <textarea
                              className="v2-form-input"
                              value={settings.notion_page_template ?? ''}
                              onChange={e => update('notion_page_template', e.target.value)}
                              rows={8}
                              style={{ fontFamily: 'var(--v2-font-mono, monospace)', fontSize: 12 }}
                            />
                            <button className="v2-settings-btn" style={{ marginTop: 4 }} onClick={() => update('notion_page_template', null)}>
                              Reset to default
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                {int.inline === 'trello-connect' && (
                  <div className="v2-integrations-inline">
                    <div className="v2-integrations-hint">
                      Get your API key from <a href="https://trello.com/app-key" target="_blank" rel="noreferrer">trello.com/app-key</a>, then click "Token" on that page to generate a Token (paste it below — not the Secret).
                    </div>
                    {showTrelloCreds ? (
                      <>
                        <input
                          type="password"
                          className="v2-form-input"
                          placeholder="API key"
                          value={settings.trello_api_key || ''}
                          onChange={e => update('trello_api_key', e.target.value)}
                        />
                        <input
                          type="password"
                          className="v2-form-input"
                          placeholder="Token"
                          value={settings.trello_secret || ''}
                          onChange={e => update('trello_secret', e.target.value)}
                        />
                      </>
                    ) : (
                      <button
                        type="button"
                        className="v2-settings-btn"
                        onClick={() => setShowTrelloCreds(true)}
                      >
                        Enter credentials
                      </button>
                    )}
                    {showTrelloCreds && (
                      <div className="v2-integrations-actions">
                        <button
                          type="button"
                          className="v2-settings-btn"
                          onClick={handleTrelloConnect}
                          disabled={trelloConnecting || !settings.trello_api_key || !settings.trello_secret}
                        >
                          {trelloConnecting ? 'Connecting…' : 'Connect'}
                        </button>
                        <button
                          type="button"
                          className="v2-settings-btn"
                          onClick={() => { setShowTrelloCreds(false); setTrelloError(null) }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {trelloError && <div className="v2-integrations-error">{trelloError}</div>}
                  </div>
                )}
                {int.inline === 'gcal-connect' && (
                  <div className="v2-integrations-inline">
                    <div className="v2-integrations-hint">
                      Create OAuth credentials in your <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud project</a> (Web app type, redirect URI <code>{window.location.origin}/api/gcal/callback</code>), paste the client ID + secret, then connect.
                    </div>
                    {showGcalCreds ? (
                      <>
                        <input
                          type="text"
                          className="v2-form-input"
                          placeholder="Client ID"
                          value={settings.gcal_client_id || ''}
                          onChange={e => update('gcal_client_id', e.target.value)}
                        />
                        <input
                          type="password"
                          className="v2-form-input"
                          placeholder="Client Secret"
                          value={settings.gcal_client_secret || ''}
                          onChange={e => update('gcal_client_secret', e.target.value)}
                        />
                      </>
                    ) : (
                      <button
                        type="button"
                        className="v2-settings-btn"
                        onClick={() => setShowGcalCreds(true)}
                      >
                        Enter credentials
                      </button>
                    )}
                    {showGcalCreds && (
                      <div className="v2-integrations-actions">
                        <button
                          type="button"
                          className="v2-settings-btn"
                          onClick={handleGcalConnect}
                          disabled={gcalConnecting || !settings.gcal_client_id || !settings.gcal_client_secret}
                        >
                          {gcalConnecting ? 'Connecting…' : 'Connect'}
                        </button>
                        <button
                          type="button"
                          className="v2-settings-btn"
                          onClick={() => { setShowGcalCreds(false); setGcalError(null) }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {gcalError && <div className="v2-integrations-error">{gcalError}</div>}
                  </div>
                )}
                {int.inline === 'gmail-connect' && (
                  <div className="v2-integrations-inline">
                    <div className="v2-integrations-hint">
                      Reuses Google credentials from the Google Calendar row above (same Google Cloud project). Add the redirect URI <code>{window.location.origin}/api/gmail/callback</code> to your OAuth client first.
                    </div>
                    <div className="v2-integrations-actions">
                      <button
                        type="button"
                        className="v2-settings-btn"
                        onClick={handleGmailConnect}
                        disabled={gmailConnecting || !settings.gcal_client_id || !settings.gcal_client_secret}
                      >
                        {gmailConnecting ? 'Connecting…' : 'Connect Gmail'}
                      </button>
                    </div>
                    {gmailError && <div className="v2-integrations-error">{gmailError}</div>}
                    {!settings.gcal_client_id && (
                      <div className="v2-integrations-hint">
                        Configure Google Calendar credentials first.
                      </div>
                    )}
                  </div>
                )}
                {int.inline === 'trello-config' && (
                  <div className="v2-integrations-inline">
                    <div className="v2-integrations-actions" style={{ marginBottom: 8 }}>
                      <button
                        type="button"
                        className="v2-settings-btn v2-settings-btn-danger"
                        onClick={handleTrelloDisconnect}
                      >
                        Disconnect
                      </button>
                    </div>
                    <label className="v2-form-label">Board</label>
                    <select
                      className="v2-form-input"
                      value={settings.trello_board_id || ''}
                      onChange={e => handleTrelloBoardChange(e.target.value)}
                    >
                      <option value="" disabled>Select a board…</option>
                      {trelloBoards.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    {settings.trello_board_id && (
                      <>
                        <label className="v2-form-label">Default list</label>
                        <div className="v2-settings-row-hint" style={{ marginTop: -4, marginBottom: 4 }}>
                          You can pick a different list when pushing each task.
                        </div>
                        {trelloListsLoading ? (
                          <div className="v2-integrations-hint">Loading lists…</div>
                        ) : (
                          <>
                            <select
                              className="v2-form-input"
                              value={settings.trello_list_id || ''}
                              onChange={e => update('trello_list_id', e.target.value)}
                            >
                              <option value="" disabled>Select a list…</option>
                              {trelloLists.map(l => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                              ))}
                            </select>
                            {trelloLists.length > 0 && (
                              <div className="v2-integrations-sub-settings">
                                <label className="v2-form-label">Sync from lists</label>
                                <div className="v2-integrations-hint">Select which lists to pull tasks from during sync.</div>
                                {trelloLists.map(l => {
                                  const syncIds = settings.trello_sync_list_ids || [settings.trello_list_id].filter(Boolean)
                                  return (
                                    <label key={l.id} className="v2-integrations-check">
                                      <input type="checkbox" checked={syncIds.includes(l.id)} onChange={e => {
                                        const cur = settings.trello_sync_list_ids || [settings.trello_list_id].filter(Boolean)
                                        update('trello_sync_list_ids', e.target.checked ? [...cur, l.id] : cur.filter(id => id !== l.id))
                                      }} />
                                      <span>{l.name}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                            {settings.trello_list_mapping && (
                              <div className="v2-integrations-sub-settings">
                                <div className="v2-integrations-hint">Status mapping</div>
                                {Object.entries(settings.trello_list_mapping).map(([status, listId]) => {
                                  const list = trelloLists.find(l => l.id === listId)
                                  return <div key={status} className="v2-integrations-hint">{list?.name || listId} → <strong>{status}</strong></div>
                                })}
                                <button className="v2-settings-btn" onClick={() => update('trello_list_mapping', null)}>Re-infer mapping</button>
                              </div>
                            )}
                          </>
                        )}
                        {settings.trello_last_sync && <div className="v2-integrations-hint">Last sync: {new Date(settings.trello_last_sync).toLocaleString()}</div>}
                      </>
                    )}
                  </div>
                )}
                {int.inline === 'gcal-config' && (
                  <div className="v2-integrations-inline">
                    <div className="v2-integrations-actions" style={{ marginBottom: 8 }}>
                      <button type="button" className="v2-settings-btn v2-settings-btn-danger" onClick={handleGcalDisconnect}>Disconnect</button>
                      <button type="button" className="v2-settings-btn" onClick={handleGcalBulkDelete} disabled={gcalBulkDeleting}>
                        {gcalBulkDeleting ? 'Deleting…' : 'Remove All Events'}
                      </button>
                    </div>
                    {gcalBulkDeleteResult && <div className="v2-integrations-hint">{gcalBulkDeleteResult}</div>}
                    <label className="v2-form-label">Calendar</label>
                    <select className="v2-form-input" value={settings.gcal_calendar_id || 'primary'} onChange={e => update('gcal_calendar_id', e.target.value)}>
                      {gcalCalendars.length === 0 && <option value="primary">Primary</option>}
                      {gcalCalendars.map(c => <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (Primary)' : ''}</option>)}
                    </select>
                    <div className="v2-integrations-toggle-row">
                      <span>Push tasks as calendar events</span>
                      <Toggle checked={settings.gcal_sync_enabled} onChange={e => update('gcal_sync_enabled', e.target.checked)} />
                    </div>
                    {settings.gcal_sync_enabled && (
                      <div className="v2-integrations-sub-settings">
                        <div className="v2-integrations-hint">Sync tasks with these statuses:</div>
                        {['not_started', 'doing', 'waiting', 'open'].map(status => (
                          <label key={status} className="v2-integrations-check">
                            <input type="checkbox" checked={(settings.gcal_sync_statuses || []).includes(status)} onChange={e => {
                              const cur = settings.gcal_sync_statuses || []
                              update('gcal_sync_statuses', e.target.checked ? [...cur, status] : cur.filter(s => s !== status))
                            }} />
                            <span>{status.replace('_', ' ')}</span>
                          </label>
                        ))}
                        <div className="v2-integrations-toggle-row">
                          <span>AI-timed events (vs all-day)</span>
                          <Toggle checked={settings.gcal_use_timed_events} onChange={e => update('gcal_use_timed_events', e.target.checked)} />
                        </div>
                        {settings.gcal_use_timed_events && (
                          <div className="v2-integrations-row-compact">
                            <label className="v2-integrations-hint">Fallback time</label>
                            <input type="time" className="v2-form-input v2-settings-compact-input" value={settings.gcal_default_time || '09:00'} onChange={e => update('gcal_default_time', e.target.value)} />
                            <label className="v2-integrations-hint">Duration (min)</label>
                            <input type="number" className="v2-form-input v2-settings-compact-input" min={5} max={480} value={settings.gcal_event_duration || 60} onChange={e => update('gcal_event_duration', parseInt(e.target.value, 10) || 60)} />
                          </div>
                        )}
                        <div className="v2-integrations-toggle-row">
                          <span>Remove events when tasks completed</span>
                          <Toggle checked={settings.gcal_remove_on_complete !== false} onChange={e => update('gcal_remove_on_complete', e.target.checked)} />
                        </div>
                        <div className="v2-integrations-toggle-row">
                          <span>15-min buffer around events</span>
                          <Toggle checked={settings.gcal_event_buffer} onChange={e => update('gcal_event_buffer', e.target.checked)} />
                        </div>
                      </div>
                    )}
                    <div className="v2-integrations-toggle-row">
                      <span>Pull events as tasks</span>
                      <Toggle checked={settings.gcal_pull_enabled} onChange={e => update('gcal_pull_enabled', e.target.checked)} />
                    </div>
                    {settings.gcal_pull_enabled && (
                      <div className="v2-integrations-sub-settings">
                        <label className="v2-form-label">Filter by title (optional)</label>
                        <input className="v2-form-input" placeholder="e.g. FAA, IFR Exam…" value={settings.gcal_pull_filter || ''} onChange={e => update('gcal_pull_filter', e.target.value)} />
                        {settings.gcal_last_sync && <div className="v2-integrations-hint">Last sync: {new Date(settings.gcal_last_sync).toLocaleString()}</div>}
                      </div>
                    )}
                  </div>
                )}
                {int.inline === 'gmail-config' && (
                  <div className="v2-integrations-inline">
                    <div className="v2-integrations-actions" style={{ marginBottom: 8 }}>
                      <button type="button" className="v2-settings-btn v2-settings-btn-danger" onClick={handleGmailDisconnect}>Disconnect</button>
                      <button type="button" className="v2-settings-btn" onClick={handleGmailReset} disabled={gmailResetting}>
                        {gmailResetting ? 'Resetting…' : 'Reset & Rescan'}
                      </button>
                    </div>
                    <div className="v2-integrations-toggle-row">
                      <span>Auto-scan inbox for tasks &amp; tracking numbers</span>
                      <Toggle checked={settings.gmail_sync_enabled} onChange={e => update('gmail_sync_enabled', e.target.checked)} />
                    </div>
                    <div className="v2-integrations-toggle-row">
                      <span>Scan window (days back)</span>
                      <input className="v2-form-input v2-settings-compact-input" type="number" min="1" max="30" value={settings.gmail_scan_days || 7} onChange={e => update('gmail_scan_days', parseInt(e.target.value, 10) || 7)} />
                    </div>
                    {settings.gmail_last_sync && <div className="v2-integrations-hint">Last sync: {new Date(settings.gmail_last_sync).toLocaleString()}</div>}
                  </div>
                )}
                {int.inline === 'weather' && (
                  <div className="v2-integrations-inline">
                    <div className="v2-integrations-toggle-row">
                      <span>Enable weather features</span>
                      <Toggle checked={settings.weather_enabled} onChange={e => update('weather_enabled', e.target.checked)} />
                    </div>
                    {settings.weather_latitude && settings.weather_location_name ? (
                      <div className="v2-weather-current">
                        <div className="v2-weather-current-label">📍 {settings.weather_location_name}</div>
                        <div className="v2-integrations-actions">
                          <button className="v2-settings-btn" onClick={clearWeatherLocation}>Change location</button>
                          <button className="v2-settings-btn" onClick={handleWeatherRefresh}>Refresh now</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="v2-weather-search">
                          <input type="text" className="v2-form-input" placeholder="City or zip code…" value={weatherQuery} onChange={e => setWeatherQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runWeatherSearch() } }} />
                          <button className="v2-settings-btn" onClick={runWeatherSearch} disabled={weatherSearching || !weatherQuery.trim()}>
                            {weatherSearching ? 'Searching…' : 'Search'}
                          </button>
                        </div>
                        {weatherError && <div className="v2-integrations-error">{weatherError}</div>}
                        {weatherResults.length > 0 && (
                          <ul className="v2-weather-results">
                            {weatherResults.map((r, i) => (
                              <li key={i}><button className="v2-weather-result" onClick={() => pickWeatherLocation(r)}>{r.label}</button></li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                    <div className="v2-integrations-hint">Per-task: tag a task <code>outside</code> to force-show weather, or <code>inside</code> to collapse it. Otherwise auto-detected from energy + title.</div>
                  </div>
                )}
                {int.inline === 'tracking' && (
                  <div className="v2-integrations-inline">
                    {envKeys.tracking ? (
                      <div className="v2-integrations-hint">Provided via env var.</div>
                    ) : (
                      <input type="password" className="v2-form-input" placeholder="17track API key…" value={settings.tracking_api_key || ''} onChange={e => update('tracking_api_key', e.target.value)} />
                    )}
                    <div className="v2-integrations-actions">
                      <button className="v2-settings-btn" onClick={handleTrackingTest}>Test Connection</button>
                    </div>
                    {trackingTestResult && <div className="v2-integrations-hint">{trackingTestResult}</div>}
                    <div className="v2-integrations-toggle-row">
                      <span>Auto-cleanup after</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="number" className="v2-form-input v2-settings-compact-input" min={1} max={30} value={settings.package_retention_days ?? 3} onChange={e => update('package_retention_days', parseInt(e.target.value, 10) || 3)} />
                        <span className="v2-integrations-hint">days</span>
                      </div>
                    </div>
                    <div className="v2-integrations-hint" style={{ marginTop: 4 }}>
                      Delivery/exception/signature notifications are configured per-channel in Settings → Notifications.
                    </div>
                    <div className="v2-integrations-toggle-row">
                      <span>Auto-create errand task for signature</span>
                      <Toggle checked={settings.package_auto_task_signature !== false} onChange={e => update('package_auto_task_signature', e.target.checked)} />
                    </div>
                  </div>
                )}
                {int.inline === 'pushover' && (
                  <div className="v2-integrations-inline">
                    <input
                      type="password"
                      className="v2-form-input"
                      placeholder="User Key (from pushover.net dashboard)"
                      value={settings.pushover_user_key || ''}
                      onChange={e => update('pushover_user_key', e.target.value)}
                    />
                    <input
                      type="password"
                      className="v2-form-input"
                      placeholder={int.appTokenFromEnv ? 'App Token (from env var)' : 'App Token (create app named "Boomerang")'}
                      value={settings.pushover_app_token || ''}
                      onChange={e => update('pushover_app_token', e.target.value)}
                      disabled={int.appTokenFromEnv && !settings.pushover_app_token}
                    />
                    <div className="v2-integrations-actions">
                      <button
                        className="v2-settings-btn"
                        disabled={pushoverTest.status === 'sending'}
                        onClick={() => runPushoverTest(false)}
                      >
                        {pushoverTest.status === 'sending' ? 'Sending…' : pushoverTest.status === 'sent' ? 'Sent ✓' : 'Test'}
                      </button>
                      <button
                        className="v2-settings-btn v2-settings-btn-danger"
                        disabled={pushoverEmer.status === 'sending'}
                        onClick={() => setEmergencyConfirm(true)}
                      >
                        {pushoverEmer.status === 'sending' ? 'Triggering…' : pushoverEmer.status === 'sent' ? 'Alarm sent ✓' : 'Test emergency'}
                      </button>
                    </div>
                    {pushoverTest.status === 'error' && pushoverTest.error && (
                      <div className="v2-integrations-error">{pushoverTest.error}</div>
                    )}
                    {pushoverEmer.status === 'error' && pushoverEmer.error && (
                      <div className="v2-integrations-error">{pushoverEmer.error}</div>
                    )}
                    <div className="v2-integrations-hint" style={{ marginTop: 6 }}>
                      Configure which notification types fire over Pushover, and the Public app URL used for deep links, in the Notifications tab.
                    </div>
                  </div>
                )}
                {int.syncResult && (
                  <div className="v2-integrations-sync-result">{int.syncResult}</div>
                )}
                </>)}
              </div>
              <div className="v2-integrations-row-actions">
                {int.sync && (
                  <button
                    className="v2-settings-btn"
                    onClick={() => int.sync.fn()}
                    disabled={int.sync.busy}
                    title="Pull/refresh from this integration"
                  >
                    <RefreshCw size={13} strokeWidth={1.75} className={int.sync.busy ? 'v2-spinner' : ''} />
                    {int.sync.busy ? 'Syncing…' : 'Sync now'}
                  </button>
                )}
                {int.manageInTab && (
                  <button
                    className="v2-settings-btn"
                    onClick={() => setActiveTab(int.manageInTab)}
                    title={`Open ${int.manageInTab} tab`}
                  >
                    Configure in {int.manageInTab}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {emergencyConfirm && (
        <div className="v2-settings-confirm-overlay" onClick={() => setEmergencyConfirm(false)}>
          <div className="v2-settings-confirm" onClick={e => e.stopPropagation()}>
            <div className="v2-settings-confirm-title">Trigger Emergency alarm?</div>
            <div className="v2-settings-confirm-message">
              This will fire a priority-2 Pushover alarm on your iOS device that repeats every 30 seconds and bypasses Do Not Disturb. The alarm auto-cancels after about 90 seconds.
            </div>
            <div className="v2-settings-confirm-actions">
              <button className="v2-settings-btn" onClick={() => setEmergencyConfirm(false)}>Cancel</button>
              <button
                className="v2-settings-btn v2-settings-btn-danger"
                onClick={() => { setEmergencyConfirm(false); runPushoverTest(true) }}
              >
                Trigger
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function NotificationsPanel({ settings, update }) {
  // Pile-up exemption label picker, shown right after "Pile-up thresholds"
  // below. loadLabels() is a cheap synchronous localStorage read, same
  // pattern LabelsPanel uses.
  const allLabels = loadLabels()
  const pileupExemptLabels = Array.isArray(settings.pileup_exempt_labels) ? settings.pileup_exempt_labels : []
  const togglePileupExempt = (id) => {
    const next = pileupExemptLabels.includes(id)
      ? pileupExemptLabels.filter(x => x !== id)
      : [...pileupExemptLabels, id]
    update('pileup_exempt_labels', next)
  }

  // Channel master toggles. Pushover gates additionally on credentials being
  // present, but for the v2 panel we just toggle the boolean and show a hint.
  const masters = [
    { key: 'push_notifications_enabled', label: 'Web push', hint: 'Browser-native notifications. Per-device subscription.' },
    { key: 'email_notifications_enabled', label: 'Email', hint: 'Server-side SMTP. Address comes from `email_address` setting or NOTIFICATION_EMAIL env.' },
    { key: 'pushover_notifications_enabled', label: 'Pushover', hint: 'iOS-friendly transport via the Pushover app. Credentials in Integrations tab.' },
  ]

  // Web push needs a per-device subscribe step (browser permission +
  // pushManager.subscribe). The master toggle alone only flips the server-side
  // boolean — without this, no iOS permission prompt fires and the server
  // never gets an endpoint to push to.
  const pushSub = usePushSubscription()
  const [subscribeError, setSubscribeError] = useState(null)

  // Channel test buttons — small per-button state machine: idle | sending | sent | error.
  const [tests, setTests] = useState({})
  const [emergencyConfirm, setEmergencyConfirm] = useState(false)

  const runTest = async (key, fn) => {
    setTests(prev => ({ ...prev, [key]: { status: 'sending' } }))
    try {
      const result = await fn()
      if (result?.success === false) {
        setTests(prev => ({ ...prev, [key]: { status: 'error', error: result.error || 'Send failed' } }))
        return
      }
      const sentMsg = result?.fired ? `Sent via ${result.fired.join(', ')}` : null
      setTests(prev => ({ ...prev, [key]: { status: 'sent', detail: sentMsg } }))
      setTimeout(() => setTests(prev => ({ ...prev, [key]: { status: null } })), 4000)
    } catch (e) {
      setTests(prev => ({ ...prev, [key]: { status: 'error', error: e?.message || 'Send failed' } }))
    }
  }

  // Notification history — last 50 entries from the server-side log.
  const [history, setHistory] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const api = await import('../api')
      const data = await api.getNotifLog(50)
      setHistory(Array.isArray(data) ? data : (data?.entries || []))
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  const clearHistory = async () => {
    try {
      const api = await import('../api')
      await api.clearServerNotifLog()
      setHistory([])
    } catch { /* no-op */ }
  }

  useEffect(() => {
    if (historyOpen && history === null) loadHistory()
  }, [historyOpen, history])

  // Per-section collapse state for the notifications panel. Persists via
  // settings so each section's fold state survives reloads. Section keys
  // match the labels below; default is "all expanded" so first-time
  // users see everything.
  const collapsedSections = settings.collapsed_notif_sections || {}
  const isCollapsed = (key) => !!collapsedSections[key]
  const toggleCollapsed = (key) => {
    update('collapsed_notif_sections', { ...collapsedSections, [key]: !collapsedSections[key] })
  }
  const SectionHeader = ({ k, label, hint }) => (
    <button
      type="button"
      className={`v2-settings-section-header${isCollapsed(k) ? ' v2-settings-section-header-collapsed' : ''}`}
      onClick={() => toggleCollapsed(k)}
      aria-expanded={!isCollapsed(k)}
    >
      <span className="v2-settings-section-chev" aria-hidden="true">
        {isCollapsed(k) ? '▸' : '▾'}
      </span>
      <span className="v2-settings-section-header-text">
        <span className="v2-form-label">{label}</span>
        {hint && <span className="v2-settings-row-hint">{hint}</span>}
      </span>
    </button>
  )

  return (
    <div className="v2-settings-form">
      {/* Channel masters */}
      <div className="v2-settings-block">
        <SectionHeader k="channels" label="Channels" hint="Master toggle per delivery channel. Each channel still respects its per-type settings below." />
        {!isCollapsed('channels') && (<>

        {masters.map(m => (
          <div key={m.key} className="v2-settings-row">
            <div className="v2-settings-row-text">
              <div className="v2-settings-row-label">{m.label}</div>
              <div className="v2-settings-row-hint">{m.hint}</div>
            </div>
            <Toggle
              checked={settings[m.key] === true}
              onChange={e => update(m.key, e.target.checked)}
            />
          </div>
        ))}

        {/* Per-device subscribe — only relevant when Web push is enabled. */}
        {settings.push_notifications_enabled === true && pushSub.supported && (
          <div className="v2-settings-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
            <div className="v2-settings-row-text">
              <div className="v2-settings-row-label">This device</div>
              <div className="v2-settings-row-hint">
                {pushSub.subscribed
                  ? 'Subscribed. Push notifications will deliver to this browser.'
                  : 'Not subscribed. Grant notification permission to receive web push on this device.'}
              </div>
            </div>
            {!pushSub.subscribed && (
              <button
                className="v2-settings-btn"
                disabled={pushSub.loading}
                onClick={async () => {
                  setSubscribeError(null)
                  const result = await pushSub.subscribe()
                  if (!result.success) setSubscribeError(result.error)
                }}
              >
                {pushSub.loading ? 'Enabling…' : 'Enable on this device'}
              </button>
            )}
            {pushSub.subscribed && (
              <button
                className="v2-settings-btn"
                disabled={pushSub.loading}
                onClick={async () => {
                  setSubscribeError(null)
                  const result = await pushSub.unsubscribe()
                  if (!result.success) setSubscribeError(result.error)
                }}
              >
                {pushSub.loading ? 'Disabling…' : 'Disable on this device'}
              </button>
            )}
            {subscribeError && (
              <div className="v2-settings-row-hint" style={{ color: 'var(--v2-danger, #c83a3a)' }}>
                {subscribeError}
              </div>
            )}
          </div>
        )}
        {settings.push_notifications_enabled === true && !pushSub.supported && (
          <div className="v2-settings-row-hint" style={{ marginTop: 8 }}>
            Web push isn't supported in this browser. On iOS, add Boomerang to the Home Screen and open from there.
          </div>
        )}
        </>)}
      </div>

      {/* Public app URL — genuinely cross-channel infra (web push, Pushover,
        * and the daily digest all use it for tappable deep links), but used
        * to be buried inside the Pushover integration block labeled as if it
        * were Pushover-specific. */}
      <div className="v2-settings-block">
        <div className="v2-settings-row-text">
          <label className="v2-form-label" htmlFor="v2-public-app-url">Public app URL</label>
          <div className="v2-settings-row-hint">When set, notifications and the daily digest include a tappable link back to the relevant task — used by web push, Pushover, and email.</div>
        </div>
        <input
          id="v2-public-app-url"
          type="text"
          className="v2-form-input"
          placeholder="https://boomerang.example.com"
          value={settings.public_app_url || ''}
          onChange={e => update('public_app_url', e.target.value)}
        />
      </div>

      {/* Per-type × per-channel — card-per-type layout works at any width */}
      <div className="v2-settings-block">
        <SectionHeader k="types" label="Notification types" hint="Each card toggles a notification type per channel. Frequency is the cooldown between repeats." />
        {!isCollapsed('types') && (
        <div className="v2-notif-cards">
          {NOTIF_TYPES.map(t => (
            <div key={t.key} className="v2-notif-card">
              <div className="v2-notif-card-head">
                <div className="v2-notif-card-text">
                  <div className="v2-notif-card-label">{t.label}</div>
                  {t.desc && <div className="v2-notif-card-hint">{t.desc}</div>}
                </div>
                <div className="v2-notif-card-freq">
                  <input
                    className="v2-form-input v2-notif-card-freq-input"
                    type="number"
                    min="0.25"
                    max="168"
                    step="0.25"
                    value={settings[t.freqKey] ?? t.freqDefault}
                    onChange={e => update(t.freqKey, Math.max(0.25, parseFloat(e.target.value) || 0.25))}
                    aria-label={`${t.label} frequency in hours`}
                  />
                  <span className="v2-notif-card-freq-unit">h</span>
                </div>
              </div>
              <div className="v2-notif-card-channels">
                {[
                  { key: 'push', master: 'push_notifications_enabled', defaultOn: true },
                  { key: 'email', master: 'email_notifications_enabled', defaultOn: true },
                  { key: 'pushover', master: 'pushover_notifications_enabled', defaultOn: false },
                ].map(c => (
                  <label key={c.key} className={`v2-notif-card-channel${settings[c.master] !== true ? ' v2-notif-card-channel-disabled' : ''}`}>
                    <Toggle
                      checked={c.defaultOn ? settings[`${c.key}_notif_${t.key}`] !== false : settings[`${c.key}_notif_${t.key}`] === true}
                      onChange={e => update(`${c.key}_notif_${t.key}`, e.target.checked)}
                      disabled={settings[c.master] !== true}
                    />
                    <span className="v2-notif-card-channel-label">{c.key === 'push' ? 'Push' : c.key === 'email' ? 'Email' : 'Pushover'}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {NOTIF_PACKAGE_TYPES.map(t => (
            <div key={t.key} className="v2-notif-card">
              <div className="v2-notif-card-head">
                <div className="v2-notif-card-text">
                  <div className="v2-notif-card-label">{t.label}</div>
                  {t.desc && <div className="v2-notif-card-hint">{t.desc}</div>}
                </div>
              </div>
              <div className="v2-notif-card-channels">
                {[
                  { key: 'push', master: 'push_notifications_enabled' },
                  { key: 'email', master: 'email_notifications_enabled' },
                  { key: 'pushover', master: 'pushover_notifications_enabled' },
                ].map(c => (
                  <label key={c.key} className={`v2-notif-card-channel${settings[c.master] !== true ? ' v2-notif-card-channel-disabled' : ''}`}>
                    <Toggle
                      checked={settings[`${c.key}_notif_${t.key}`] !== false}
                      onChange={e => update(`${c.key}_notif_${t.key}`, e.target.checked)}
                      disabled={settings[c.master] !== true}
                    />
                    <span className="v2-notif-card-channel-label">{c.key === 'push' ? 'Push' : c.key === 'email' ? 'Email' : 'Pushover'}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {/* Quokka plan-ready — web push only (informational, not a nag).
            * Fires when the background runner stages a plan and the user
            * isn't actively watching. Default ON since the whole point of
            * the background-runner feature is "you can leave it." */}
          <div className="v2-notif-card">
            <div className="v2-notif-card-head">
              <div className="v2-notif-card-text">
                <div className="v2-notif-card-label">Quokka plan ready</div>
                <div className="v2-notif-card-hint">Fires when Quokka finishes thinking in the background and has a plan ready to review. Web push only.</div>
              </div>
            </div>
            <div className="v2-notif-card-channels">
              <label className={`v2-notif-card-channel${settings.push_notifications_enabled !== true ? ' v2-notif-card-channel-disabled' : ''}`}>
                <Toggle
                  checked={settings.push_notif_quokka_plan_ready !== false}
                  onChange={e => update('push_notif_quokka_plan_ready', e.target.checked)}
                  disabled={settings.push_notifications_enabled !== true}
                />
                <span className="v2-notif-card-channel-label">Push</span>
              </label>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* High-priority escalation */}
      <div className="v2-settings-block">
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">High-priority escalation</div>
            <div className="v2-settings-row-hint">Three-stage cadence as a high-pri task approaches due and goes overdue. Values in hours.</div>
          </div>
          <Toggle
            checked={settings.notif_highpri_escalate !== false}
            onChange={e => update('notif_highpri_escalate', e.target.checked)}
          />
        </div>
        {settings.notif_highpri_escalate !== false && (
          <div className="v2-notif-stages-grid">
            <label className="v2-notif-stage-cell">
              <span className="v2-notif-stage-cell-label">Before due</span>
              <input
                className="v2-form-input v2-notif-stage-cell-input"
                type="number" min="0.25" max="168" step="0.25"
                value={settings.notif_freq_highpri_before ?? 24}
                onChange={e => update('notif_freq_highpri_before', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
              />
            </label>
            <label className="v2-notif-stage-cell">
              <span className="v2-notif-stage-cell-label">On due</span>
              <input
                className="v2-form-input v2-notif-stage-cell-input"
                type="number" min="0.25" max="24" step="0.25"
                value={settings.notif_freq_highpri_due ?? 1}
                onChange={e => update('notif_freq_highpri_due', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
              />
            </label>
            <label className="v2-notif-stage-cell">
              <span className="v2-notif-stage-cell-label">Overdue</span>
              <input
                className="v2-form-input v2-notif-stage-cell-input"
                type="number" min="0.25" max="24" step="0.25"
                value={settings.notif_freq_highpri_overdue ?? 0.5}
                onChange={e => update('notif_freq_highpri_overdue', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
              />
            </label>
          </div>
        )}
      </div>

      {/* Pile-up — every knob for "too many open tasks" lives in one place:
        * the limit itself (max_open_tasks — moved here from General, where it
        * was stranded next to unrelated task-behavior fields with no link to
        * the rest of this feature), the percentage-based warning, and the
        * label exemption. Previously split across two tabs with zero
        * cross-reference — reported in prod as "shit is everywhere." */}
      <div className="v2-settings-block">
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <label className="v2-settings-row-label" htmlFor="v2-max-open">Max open tasks</label>
            <div className="v2-settings-row-hint">Warns when you exceed this. 0 = no limit.</div>
          </div>
          <input
            id="v2-max-open"
            className="v2-form-input v2-settings-compact-input"
            type="number"
            min="0"
            max="100"
            value={settings.max_open_tasks ?? 10}
            onChange={e => update('max_open_tasks', parseInt(e.target.value) || 0)}
          />
        </div>
        <div className="v2-settings-row" style={{ paddingTop: 12, borderTop: '1px solid var(--v2-hairline)' }}>
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Pile-up thresholds</div>
            <div className="v2-settings-row-hint">Fire a pile-up warning when this percentage of active tasks are older than N days.</div>
          </div>
        </div>
        <div className="v2-integrations-row-compact" style={{ paddingBottom: 8 }}>
          <input type="number" className="v2-form-input v2-settings-compact-input" min={0} max={100} value={settings.stale_warn_pct ?? 50} onChange={e => update('stale_warn_pct', parseInt(e.target.value, 10) || 0)} />
          <span className="v2-integrations-hint">% older than</span>
          <input type="number" className="v2-form-input v2-settings-compact-input" min={1} max={90} value={settings.stale_warn_days ?? 7} onChange={e => update('stale_warn_days', parseInt(e.target.value, 10) || 7)} />
          <span className="v2-integrations-hint">days</span>
        </div>
        {allLabels.length > 0 && (
          <div className="v2-settings-row" style={{ alignItems: 'flex-start', paddingTop: 12, borderTop: '1px solid var(--v2-hairline)' }}>
            <div className="v2-settings-row-text">
              <div className="v2-settings-row-label">Exempt from pile-up count</div>
              <div className="v2-settings-row-hint">Tasks with any of these labels don't count toward the limit or its warning — useful for things you're deliberately tracking for reference, not actively working.</div>
              <div className="v2-form-label-grid" style={{ marginTop: 8 }}>
                {allLabels.map(lbl => {
                  const active = pileupExemptLabels.includes(lbl.id)
                  return (
                    <button
                      key={lbl.id}
                      type="button"
                      className={`v2-form-label-pill${active ? ' v2-form-label-pill-active' : ''}`}
                      onClick={() => togglePileupExempt(lbl.id)}
                      style={{ '--label-color': lbl.color }}
                      title={lbl.name}
                    >
                      {lbl.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quiet hours — section header is the toggle row, no redundant sub-toggle */}
      <div className="v2-settings-block">
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Quiet hours</div>
            <div className="v2-settings-row-hint">Suppress most notifications during this window. Tasks tagged with the bypass label still wake you.</div>
          </div>
          <Toggle
            checked={!!settings.quiet_hours_enabled}
            onChange={e => update('quiet_hours_enabled', e.target.checked)}
          />
        </div>
        {settings.quiet_hours_enabled && (
          <div className="v2-settings-quiet-times">
            <div className="v2-settings-quiet-field">
              <label className="v2-form-label">Start</label>
              <input
                type="time"
                className="v2-form-input v2-settings-time-input"
                value={settings.quiet_hours_start || '22:00'}
                onChange={e => update('quiet_hours_start', e.target.value)}
              />
            </div>
            <div className="v2-settings-quiet-field">
              <label className="v2-form-label">End</label>
              <input
                type="time"
                className="v2-form-input v2-settings-time-input"
                value={settings.quiet_hours_end || '08:00'}
                onChange={e => update('quiet_hours_end', e.target.value)}
              />
            </div>
          </div>
        )}
        {settings.quiet_hours_enabled && (
          <div className="v2-settings-row" style={{ marginTop: 12 }}>
            <div className="v2-settings-row-text">
              <label className="v2-settings-row-label">Bypass label</label>
              <div className="v2-settings-row-hint">Tasks with this tag wake you even during quiet hours.</div>
            </div>
            <input
              className="v2-form-input v2-settings-compact-input v2-settings-compact-input-wide"
              type="text"
              value={settings.quiet_hours_bypass_label || 'wake-me'}
              onChange={e => update('quiet_hours_bypass_label', e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Critical mode — the critical tag's nag path (internal identifiers
          keep the original crisis_* names). One card for everything about
          critical behavior (cadence, staleness check-in, auto triage). The
          tag itself is applied per-task via EditTaskModal's Critical
          checkbox or by adding the label directly. */}
      <div className="v2-settings-block">
        <SectionHeader k="crisis" label="Critical mode" hint='Tasks tagged with the critical label get the most aggressive nag path in the app: their own per-task pings on every enabled channel (rides the High priority toggles), a pinned 🚨 section, and an auto-drafted triage checklist. Pushover escalates to Emergency once a critical task is overdue or 24h old.' />
        {!isCollapsed('crisis') && (<>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <label className="v2-settings-row-label">Critical label</label>
            <div className="v2-settings-row-hint">Which label puts a task on the critical path. Never auto-applied by AI tagging.</div>
          </div>
          <input
            className="v2-form-input v2-settings-compact-input v2-settings-compact-input-wide"
            type="text"
            value={settings.crisis_label || 'critical'}
            onChange={e => update('crisis_label', e.target.value)}
          />
        </div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <label className="v2-settings-row-label">Nag every (hours)</label>
            <div className="v2-settings-row-hint">Per-task critical cadence, fractional ok (0.5 = 30 min). Ignoring a critical task never backs this off.</div>
          </div>
          <input
            className="v2-form-input v2-settings-compact-input"
            type="number" min="0.25" step="0.25"
            value={settings.notif_freq_crisis ?? 2}
            onChange={e => update('notif_freq_crisis', e.target.value === '' ? 2 : parseFloat(e.target.value))}
          />
        </div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <label className="v2-settings-row-label">"Still critical?" check-in (days)</label>
            <div className="v2-settings-row-hint">After this long marked critical, one gentle ping asks to keep or demote. Never demotes on its own. 0 = never ask.</div>
          </div>
          <input
            className="v2-form-input v2-settings-compact-input"
            type="number" min="0" step="1"
            value={settings.crisis_stale_days ?? 7}
            onChange={e => update('crisis_stale_days', e.target.value === '' ? 7 : parseInt(e.target.value, 10))}
          />
        </div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Auto triage checklist</div>
            <div className="v2-settings-row-hint">When a task is marked critical, AI drafts 3-5 first moves into its checklist (first one doable in under 5 minutes).</div>
          </div>
          <Toggle
            checked={settings.crisis_auto_breakdown !== false}
            onChange={e => update('crisis_auto_breakdown', e.target.checked)}
          />
        </div>
        </>)}
      </div>

      {/* Daily digest — per-channel opt-in. sendDigestNow gates on these flags,
          not on channel masters, so users with push/email/pushover enabled still
          need to opt into the digest separately. */}
      <div className="v2-settings-block">
        <SectionHeader k="digest" label="Daily digest" hint="Curated daily summary — yesterday recap + streak, today's focus, coming up, carrying, quick wins. Each channel must opt in separately." />
        {!isCollapsed('digest') && (<>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Web push digest</div>
            <div className="v2-settings-row-hint">Requires Web push to be enabled and subscribed on this device.</div>
          </div>
          <Toggle
            checked={settings.push_digest_enabled === true}
            onChange={e => update('push_digest_enabled', e.target.checked)}
            disabled={settings.push_notifications_enabled !== true}
          />
        </div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Email digest</div>
            <div className="v2-settings-row-hint">Requires Email to be enabled with a recipient address.</div>
          </div>
          <Toggle
            checked={settings.email_digest_enabled === true}
            onChange={e => update('email_digest_enabled', e.target.checked)}
            disabled={settings.email_notifications_enabled !== true}
          />
        </div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Pushover digest</div>
            <div className="v2-settings-row-hint">Delivers as a single priority-0 Pushover message each morning.</div>
          </div>
          <Toggle
            checked={settings.pushover_digest_enabled === true}
            onChange={e => update('pushover_digest_enabled', e.target.checked)}
            disabled={settings.pushover_notifications_enabled !== true}
          />
        </div>
        <div className="v2-settings-row" style={{ marginTop: 8 }}>
          <div className="v2-settings-row-text">
            <label className="v2-settings-row-label">Delivery time</label>
            <div className="v2-settings-row-hint">Local time on the server. Default 07:00.</div>
          </div>
          <input type="time" className="v2-form-input v2-settings-time-input" value={settings.digest_time || '07:00'} onChange={e => update('digest_time', e.target.value)} />
        </div>
        <div className="v2-settings-row" style={{ marginTop: 8 }}>
          <div className="v2-settings-row-text">
            <label className="v2-settings-row-label">Digest style</label>
          </div>
          <select className="v2-form-input v2-settings-compact-input v2-settings-compact-input-wide" value={settings.digest_style || 'curated'} onChange={e => update('digest_style', e.target.value)}>
            <option value="curated">Curated</option>
            <option value="counts">Counts only</option>
          </select>
        </div>
        </>)}
      </div>

      {/* Test channels — fire a one-off notification per channel to verify config */}
      <div className="v2-settings-block">
        <SectionHeader k="test" label="Test channels" hint="Send a one-off test notification through each channel to verify it's working. Test buttons obey channel master toggles + Pushover credentials." />
        {!isCollapsed('test') && (<>
        <div className="v2-notif-tests">
          {[
            { key: 'push', label: 'Test push', enabled: settings.push_notifications_enabled === true,
              fn: () => import('../api').then(m => m.testPush()) },
            { key: 'email', label: 'Test email', enabled: settings.email_notifications_enabled === true,
              fn: () => import('../api').then(m => m.testEmail()) },
            { key: 'pushover', label: 'Test Pushover', enabled: settings.pushover_notifications_enabled === true && !!settings.pushover_user_key,
              fn: () => import('../api').then(m => m.testPushover({ userKey: settings.pushover_user_key, appToken: settings.pushover_app_token })) },
            { key: 'digest', label: 'Test digest',
              enabled: settings.push_digest_enabled === true || settings.email_digest_enabled === true || settings.pushover_digest_enabled === true,
              fn: () => import('../api').then(m => m.testDigest()) },
          ].map(t => {
            const state = tests[t.key] || {}
            return (
              <div key={t.key} className="v2-notif-test-row">
                <button
                  className="v2-settings-btn"
                  disabled={!t.enabled || state.status === 'sending'}
                  onClick={() => runTest(t.key, t.fn)}
                  title={!t.enabled ? 'Channel disabled or unconfigured' : `Send a test ${t.label.replace('Test ', '').toLowerCase()}`}
                >
                  {state.status === 'sending' ? 'Sending…' : state.status === 'sent' ? 'Sent ✓' : t.label}
                </button>
                {state.status === 'sent' && state.detail && (
                  <span className="v2-integrations-status-ok">{state.detail}</span>
                )}
                {state.status === 'error' && (
                  <span className="v2-integrations-error">{state.error}</span>
                )}
              </div>
            )
          })}
          <div className="v2-notif-test-row">
            <button
              className="v2-settings-btn v2-settings-btn-danger"
              disabled={settings.pushover_notifications_enabled !== true || !settings.pushover_user_key || (tests.emergency || {}).status === 'sending'}
              onClick={() => setEmergencyConfirm(true)}
              title="Trigger a real Pushover priority-2 alarm (auto-cancels after ~90s)"
            >
              {(tests.emergency || {}).status === 'sending' ? 'Triggering…' : (tests.emergency || {}).status === 'sent' ? 'Alarm sent ✓' : 'Test Pushover Emergency'}
            </button>
            {(tests.emergency || {}).status === 'error' && (
              <span className="v2-integrations-error">{(tests.emergency || {}).error}</span>
            )}
          </div>
        </div>
        </>)}
      </div>

      {/* Notification history — collapsible to keep the panel calm by default */}
      <div className="v2-settings-block">
        <button
          className="v2-notif-history-toggle"
          onClick={() => setHistoryOpen(o => !o)}
          aria-expanded={historyOpen}
        >
          <span className="v2-form-label">Notification history</span>
          <span className="v2-notif-history-chev">{historyOpen ? '−' : '+'}</span>
        </button>
        {historyOpen && (
          <div className="v2-notif-history">
            <div className="v2-notif-history-toolbar">
              <button className="v2-settings-btn" onClick={loadHistory} disabled={historyLoading}>
                <RefreshCw size={13} strokeWidth={1.75} className={historyLoading ? 'v2-spinner' : ''} />
                {historyLoading ? 'Loading…' : 'Refresh'}
              </button>
              <button className="v2-settings-btn v2-settings-btn-danger" onClick={clearHistory} disabled={!history?.length}>
                <Trash2 size={13} strokeWidth={1.75} /> Clear
              </button>
            </div>
            {history === null || historyLoading ? (
              <div className="v2-notif-history-empty">Loading…</div>
            ) : history.length === 0 ? (
              <div className="v2-notif-history-empty">No notifications logged yet.</div>
            ) : (
              <ul className="v2-notif-history-list">
                {history.map((entry, i) => (
                  <li key={i} className="v2-notif-history-item">
                    <div className="v2-notif-history-meta">
                      <span className="v2-notif-history-channel">{entry.channel || 'unknown'}</span>
                      <span className="v2-notif-history-type">{entry.type}</span>
                      <span className="v2-notif-history-time">{new Date(entry.sent_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    {entry.title && <div className="v2-notif-history-title">{entry.title}</div>}
                    {entry.body && <div className="v2-notif-history-body">{entry.body}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {emergencyConfirm && (
        <div className="v2-settings-confirm-overlay" onClick={() => setEmergencyConfirm(false)}>
          <div className="v2-settings-confirm" onClick={e => e.stopPropagation()}>
            <div className="v2-settings-confirm-title">Trigger Emergency alarm?</div>
            <div className="v2-settings-confirm-message">
              This fires a Pushover priority-2 alarm that repeats every 30 seconds and bypasses Do Not Disturb. Auto-cancels after about 90 seconds.
            </div>
            <div className="v2-settings-confirm-actions">
              <button className="v2-settings-btn" onClick={() => setEmergencyConfirm(false)}>Cancel</button>
              <button
                className="v2-settings-btn v2-settings-btn-danger"
                onClick={() => {
                  setEmergencyConfirm(false)
                  runTest('emergency', () => import('../api').then(m => m.testPushoverEmergency({
                    userKey: settings.pushover_user_key,
                    appToken: settings.pushover_app_token,
                  })))
                }}
              >
                Trigger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email deliverability — recipient + From override + batch mode */}
      <div className="v2-settings-block">
        <SectionHeader k="email_deliv" label="Email deliverability" hint="Recipient, From header overrides (SPF/DKIM/DMARC), and batch mode." />
        {!isCollapsed('email_deliv') && (<>
        <div className="v2-settings-row" style={{ marginTop: 8 }}>
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Recipient email</div>
            <div className="v2-settings-row-hint">Where notifications go. Can also be set via NOTIFICATION_EMAIL env var.</div>
          </div>
          <input className="v2-form-input v2-settings-compact-input v2-settings-compact-input-wide" type="email" placeholder="you@example.com" value={settings.email_address || ''} onChange={e => update('email_address', e.target.value)} />
        </div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">From name</div>
          </div>
          <input
            className="v2-form-input v2-settings-compact-input v2-settings-compact-input-wide"
            type="text"
            placeholder="Boomerang Digest"
            value={settings.email_from_name || ''}
            onChange={e => update('email_from_name', e.target.value)}
          />
        </div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">From address</div>
          </div>
          <input
            className="v2-form-input v2-settings-compact-input v2-settings-compact-input-wide"
            type="email"
            placeholder="digest@yourdomain.com"
            value={settings.email_from_address || ''}
            onChange={e => update('email_from_address', e.target.value)}
          />
        </div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Batch mode</div>
            <div className="v2-settings-row-hint">Bundles eligible notifications into a single digest-style email instead of sending one per event. Reduces inbox noise; trades immediacy for calm.</div>
          </div>
          <Toggle
            checked={!!settings.email_batch_mode}
            onChange={e => update('email_batch_mode', e.target.checked)}
            disabled={settings.email_notifications_enabled !== true}
          />
        </div>
        </>)}
      </div>

      {/* Weather notifications — master + per-channel toggles. No Pushover
        * row here (unlike every other notification type) because
        * pushoverNotifications.js has no weather-event dispatch at all —
        * adding a toggle with nothing behind it would just be another dead
        * setting. Real feature work, not a settings-placement fix; tracked
        * as a known gap rather than faked with a non-functional toggle. */}
      <div className="v2-settings-block">
        <SectionHeader k="weather" label="Weather notifications" hint="Alerts for nice-day windows, bad-weekend warnings, and consecutive-nice-day windows. Requires a weather location in Integrations." />
        {!isCollapsed('weather') && (<>
        <div className="v2-settings-row" style={{ marginTop: 8 }}>
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Enable weather notifications</div>
          </div>
          <Toggle
            checked={settings.weather_notifications_enabled !== false}
            onChange={e => update('weather_notifications_enabled', e.target.checked)}
            disabled={!settings.weather_enabled}
          />
        </div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Push</div>
          </div>
          <Toggle
            checked={settings.weather_notif_push !== false}
            onChange={e => update('weather_notif_push', e.target.checked)}
            disabled={settings.weather_notifications_enabled === false || settings.push_notifications_enabled !== true}
          />
        </div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Email</div>
          </div>
          <Toggle
            checked={settings.weather_notif_email !== false}
            onChange={e => update('weather_notif_email', e.target.checked)}
            disabled={settings.weather_notifications_enabled === false || settings.email_notifications_enabled !== true}
          />
        </div>
        </>)}
      </div>

    </div>
  )
}

// v2 server-logs panel — same data as v1, redrawn with v2 tokens.
function ServerLogsPanel() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [copied, setCopied] = useState(false)

  const fetchLogs = useCallback(() => {
    setLoading(true)
    fetch('/api/logs')
      .then(r => r.json())
      .then(data => setLogs(data.logs || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const FILTERS = ['all', 'Google', 'Push', 'Email', 'DB', 'SSE', 'error']
  const FILTER_PATTERNS = {
    Google: ['[Gmail]', '[GCal]', '[GCalSync]'],
    Push: ['[Push]'],
    Email: ['[Email]'],
    DB: ['[DB]'],
    SSE: ['[SSE]', '[SYNC]'],
  }
  const filtered = filter === 'all' ? logs
    : filter === 'error' ? logs.filter(l => l.level === 'error' || l.level === 'warn')
    : logs.filter(l => (FILTER_PATTERNS[filter] || [`[${filter}]`]).some(p => l.msg.includes(p)))

  const handleCopy = () => {
    const text = filtered.map(l => `${l.ts} [${l.level}] ${l.msg}`).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="v2-settings-logs">
      <div className="v2-settings-logs-toolbar">
        <button className="v2-settings-btn" onClick={fetchLogs} disabled={loading}>
          <RefreshCw size={13} strokeWidth={1.75} className={loading ? 'v2-spinner' : ''} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button className="v2-settings-btn" onClick={handleCopy} disabled={filtered.length === 0}>
          <Copy size={13} strokeWidth={1.75} />
          {copied ? 'Copied' : filter === 'all' ? 'Copy all' : `Copy ${filtered.length}`}
        </button>
      </div>
      <div className="v2-settings-logs-filters">
        {FILTERS.map(f => (
          <button
            key={f}
            className={`v2-settings-filter${filter === f ? ' v2-settings-filter-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'error' ? 'Errors' : f}
          </button>
        ))}
      </div>
      <div className="v2-settings-logs-stream">
        {filtered.length === 0 ? (
          <div className="v2-settings-logs-empty">
            {loading ? 'Loading…' : 'No logs to display.'}
          </div>
        ) : (
          filtered.slice().reverse().map((l, i) => (
            <div key={i} className={`v2-settings-log-row v2-settings-log-${l.level}`}>
              <span className="v2-settings-log-time">
                {new Date(l.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="v2-settings-log-msg">{l.msg}</span>
            </div>
          ))
        )}
      </div>
      <div className="v2-settings-logs-meta">
        Showing {filtered.length} of {logs.length} entries (last 500 in memory)
      </div>
    </div>
  )
}

export default function SettingsModal({
  open, onClose, onFlush, onClearCompleted, onClearAll, onShowActivityLog, onShowMarkdownImport,
  onOpenEasterEgg,
  onTrelloSync, trelloSyncing, onNotionSync, notionSyncing, onGCalSync, gcalSyncing,
}) {
  const [activeTab, setActiveTab] = useState('General')
  const [settings, setSettings] = useState(() => loadSettings())
  const [confirmDialog, setConfirmDialog] = useState(null)
  const flushDebounceRef = useRef(null)
  const dataImportRef = useRef(null)
  const ciFileRef = useRef(null)
  // Mirror the EditTaskModal autosave-flash pattern. Flips true when
  // the debounced flush fires; back to false after 2s.
  const [justSaved, setJustSaved] = useState(false)
  const justSavedTimer = useRef(null)
  // Dev-only reseed: only the dev environment exposes the button. The server
  // also hard-gates POST /api/dev/seed to dev, so this is just visibility.
  const [isDev, setIsDev] = useState(false)
  const [reseeding, setReseeding] = useState(false)
  // Easter egg trigger — 7 taps on the Build row within a rolling 2s
  // window opens the hidden tic-tac-toe game. Android-build-number
  // metaphor. Undocumented in user-facing copy.
  const buildTapsRef = useRef({ count: 0, last: 0 })
  const handleBuildTap = () => {
    if (!onOpenEasterEgg) return
    const now = Date.now()
    const taps = buildTapsRef.current
    if (now - taps.last > 2000) taps.count = 0
    taps.count += 1
    taps.last = now
    if (taps.count >= 7) {
      taps.count = 0
      onOpenEasterEgg()
    }
  }

  // Reload settings whenever the modal reopens — server may have updated them.
  useEffect(() => {
    if (open) setSettings(loadSettings())
  }, [open])

  // Detect the dev environment (gates the reseed button). /api/health returns
  // isDev:true only when APP_VERSION is 'dev' or 'dev-<sha>'.
  useEffect(() => {
    if (!open) return
    let alive = true
    fetch('/api/health')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive && d) setIsDev(!!d.isDev) })
      .catch(() => {})
    return () => { alive = false }
  }, [open])

  const handleReseed = () => {
    setConfirmDialog({
      title: 'Reseed dev database',
      message: 'This WIPES the dev database and reloads fresh seed data (tasks rebased to today + synthesized routine history). Dev only — there is no undo. Continue?',
      onConfirm: async () => {
        setConfirmDialog(null)
        setReseeding(true)
        try {
          const res = await fetch('/api/dev/seed', { method: 'POST' })
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error || `Reseed failed (${res.status})`)
          }
          // Fresh data — full reload so every view rehydrates from the seeded DB.
          window.location.reload()
        } catch (err) {
          setReseeding(false)
          setConfirmDialog({ title: 'Reseed failed', message: err.message, onConfirm: () => setConfirmDialog(null) })
        }
      },
    })
  }

  // Cleanup the saved-flash timer on unmount.
  useEffect(() => () => {
    if (justSavedTimer.current) clearTimeout(justSavedTimer.current)
  }, [])

  const update = useCallback((key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
    if (onFlush) {
      if (flushDebounceRef.current) clearTimeout(flushDebounceRef.current)
      flushDebounceRef.current = setTimeout(() => {
        onFlush()
        setJustSaved(true)
        if (justSavedTimer.current) clearTimeout(justSavedTimer.current)
        justSavedTimer.current = setTimeout(() => setJustSaved(false), 2000)
      }, 300)
    }
  }, [onFlush])

  const handleExportData = () => {
    const data = {
      tasks: loadTasks(),
      routines: loadRoutines(),
      settings: loadSettings(),
      labels: loadLabels(),
      exported_at: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `boomerang-backup-${localYMD()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportData = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      let data
      try {
        data = JSON.parse(ev.target.result)
      } catch {
        setConfirmDialog({
          title: 'Invalid backup file',
          message: 'The selected file is not valid JSON. Pick a Boomerang export file (.json) and try again.',
          onConfirm: () => setConfirmDialog(null),
        })
        return
      }
      const taskCount = Array.isArray(data.tasks) ? data.tasks.length : 0
      const routineCount = Array.isArray(data.routines) ? data.routines.length : 0
      setConfirmDialog({
        title: 'Restore from backup?',
        message: `This will REPLACE your current tasks and routines with ${taskCount} tasks and ${routineCount} routines from the backup file. OAuth tokens, push subscriptions, and notification history are NOT affected.`,
        onConfirm: async () => {
          setConfirmDialog(null)
          try {
            if (data.tasks) saveTasks(data.tasks)
            if (data.routines) saveRoutines(data.routines)
            if (data.settings) saveSettings(data.settings)
            if (data.labels) saveLabels(data.labels)
            if (data.settings) setSettings({ ...loadSettings(), ...data.settings })
            await restoreFromBackup(data)
            window.location.reload()
          } catch (err) {
            setConfirmDialog({
              title: 'Restore failed',
              message: err.message || 'Unknown error',
              onConfirm: () => setConfirmDialog(null),
            })
          }
        },
      })
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleCIUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => update('custom_instructions', ev.target.result)
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleCIExport = () => {
    const text = settings.custom_instructions || ''
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'boomerang-instructions.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Settings"
      width="wide"
      headerSlot={<AutosaveIndicator saved={justSaved} />}
    >
      <div className="v2-settings-tabs">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`v2-settings-tab${activeTab === tab ? ' v2-settings-tab-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="v2-settings-content">

        {activeTab === 'General' && (
          <div className="v2-settings-form">
            {(() => {
              const currentTheme = settings.theme || 'light'
              const family = currentTheme.startsWith('kept') ? 'kept' : 'standard'
              const mode = currentTheme.endsWith('system') ? 'system' : currentTheme.endsWith('dark') ? 'dark' : 'light'
              const setTheme = (nextFamily, nextMode) => {
                const value = nextFamily === 'standard'
                  ? (nextMode === 'dark' ? 'dark' : nextMode === 'system' ? 'system' : 'light')
                  : `${nextFamily}-${nextMode}`
                update('theme', value)
                applyTheme(value)
              }
              return (
                <>
                  <div className="v2-settings-row v2-settings-row-stacked">
                    <div className="v2-settings-row-text">
                      <div className="v2-settings-row-label">Theme</div>
                      <div className="v2-settings-row-hint">Standard is the calm hairline UI. Kept is the Boomerang language — warm Smoke/Linen canvases with ember + gold, arcs not grids.</div>
                    </div>
                    <div className="v2-settings-segment" role="radiogroup" aria-label="Theme family">
                      {[
                        { value: 'standard', label: 'Standard' },
                        { value: 'kept', label: 'Kept' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={family === opt.value}
                          className={`v2-settings-segment-btn${family === opt.value ? ' v2-settings-segment-btn-active' : ''}`}
                          onClick={() => setTheme(opt.value, mode)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="v2-settings-row v2-settings-row-stacked">
                    <div className="v2-settings-row-text">
                      <div className="v2-settings-row-label">Mode</div>
                      <div className="v2-settings-row-hint">Light, dark, or follow your device's setting. Applies to whichever family is active.</div>
                    </div>
                    <div className="v2-settings-segment" role="radiogroup" aria-label="Theme mode">
                      {[
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' },
                        { value: 'system', label: 'System' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={mode === opt.value}
                          className={`v2-settings-segment-btn${mode === opt.value ? ' v2-settings-segment-btn-active' : ''}`}
                          onClick={() => setTheme(family, opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )
            })()}

            <div className="v2-settings-subhead">Home screen</div>

            <div className="v2-settings-row">
              <div className="v2-settings-row-text">
                <div className="v2-settings-row-label">Show 7-day strip (light/dark)</div>
                <div className="v2-settings-row-hint">Calendar row above the task list with activity intensity per day. Tap the date in the home stats line to show/hide.</div>
              </div>
              <Toggle checked={settings.show_week_strip} onChange={e => update('show_week_strip', e.target.checked)} />
            </div>

            <div className="v2-settings-row">
              <div className="v2-settings-row-text">
                <div className="v2-settings-row-label">Open 7-day strip by default</div>
                <div className="v2-settings-row-hint">Show the strip expanded when the app loads. Tap the date in the home stats line any time to hide it or re-open it.</div>
              </div>
              <Toggle checked={settings.week_strip_always_open} onChange={e => update('week_strip_always_open', e.target.checked)} />
            </div>

            <div className="v2-settings-row">
              <div className="v2-settings-row-text">
                <label className="v2-settings-row-label" htmlFor="v2-daily-goal">Daily task goal</label>
                <div className="v2-settings-row-hint">Used by the progress bar + activity intensity on the 7-day strip.</div>
              </div>
              <input
                id="v2-daily-goal"
                className="v2-form-input v2-settings-compact-input"
                type="number"
                min="1"
                max="50"
                value={settings.daily_task_goal ?? 3}
                onChange={e => update('daily_task_goal', parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="v2-settings-row">
              <div className="v2-settings-row-text">
                <div className="v2-settings-row-label">Build</div>
                <div className="v2-settings-row-hint">Static identifier of the running build.</div>
              </div>
              <code
                className="v2-settings-build"
                onClick={handleBuildTap}
                role="button"
                tabIndex={-1}
              >{__APP_VERSION__}</code>
            </div>
          </div>
        )}

        {activeTab === 'Tasks' && (
          <div className="v2-settings-form">
            <div className="v2-settings-row">
              <div className="v2-settings-row-text">
                <label className="v2-settings-row-label" htmlFor="v2-default-due-days">Default due date</label>
                <div className="v2-settings-row-hint">Days from now. 0 = no default; tasks ship without a due date unless you pick one.</div>
              </div>
              <input
                id="v2-default-due-days"
                className="v2-form-input v2-settings-compact-input"
                type="number"
                min="0"
                max="90"
                value={settings.default_due_days ?? 7}
                onChange={e => update('default_due_days', parseInt(e.target.value) || 0)}
              />
            </div>

            <div className="v2-settings-row">
              <div className="v2-settings-row-text">
                <label className="v2-settings-row-label" htmlFor="v2-staleness-days">Staleness threshold</label>
                <div className="v2-settings-row-hint">Days of inactivity before a task counts as stale — drives the Stale section on the task list AND the Stale notification type (Settings → Notifications).</div>
              </div>
              <input
                id="v2-staleness-days"
                className="v2-form-input v2-settings-compact-input"
                type="number"
                min="1"
                max="30"
                value={settings.staleness_days ?? 7}
                onChange={e => update('staleness_days', parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="v2-settings-row">
              <div className="v2-settings-row-text">
                <label className="v2-settings-row-label" htmlFor="v2-reframe-threshold">Reframe trigger</label>
                <div className="v2-settings-row-hint">Snooze count after which tapping Snooze opens the Reframe modal instead.</div>
              </div>
              <input
                id="v2-reframe-threshold"
                className="v2-form-input v2-settings-compact-input"
                type="number"
                min="1"
                max="20"
                value={settings.reframe_threshold ?? 3}
                onChange={e => update('reframe_threshold', parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="v2-settings-subhead">Impact dates</div>

            <div className="v2-settings-block">
              <div className="v2-settings-row-hint">
                Events that make related work more urgent as they approach — a holiday, a visit, a trip. Tasks sharing the event's label rank higher in Impact sort / Today ordering during the lead-up. Quokka can edit these too ("add an impact date for Christmas").
              </div>
              {(settings.impact_dates || []).map(ev => (
                <div key={ev.id} className="v2-settings-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    className="v2-form-input"
                    style={{ flex: '1 1 120px' }}
                    type="text"
                    placeholder="Label (e.g. Christmas)"
                    value={ev.label || ''}
                    onChange={e => update('impact_dates', (settings.impact_dates || []).map(x => x.id === ev.id ? { ...x, label: e.target.value } : x))}
                  />
                  <input
                    className="v2-form-input"
                    style={{ width: 140 }}
                    type="date"
                    value={ev.date || ''}
                    onChange={e => update('impact_dates', (settings.impact_dates || []).map(x => x.id === ev.id ? { ...x, date: e.target.value } : x))}
                  />
                  <input
                    className="v2-form-input v2-settings-compact-input"
                    type="number" min="1" max="90"
                    title="Lead days — how far out the boost starts ramping"
                    value={ev.lead_days ?? 14}
                    onChange={e => update('impact_dates', (settings.impact_dates || []).map(x => x.id === ev.id ? { ...x, lead_days: parseInt(e.target.value, 10) || 14 } : x))}
                  />
                  <select
                    className="v2-form-input"
                    style={{ width: 130 }}
                    value={ev.tag || ''}
                    onChange={e => update('impact_dates', (settings.impact_dates || []).map(x => x.id === ev.id ? { ...x, tag: e.target.value || null } : x))}
                  >
                    <option value="">No label</option>
                    {loadLabels().map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <button
                    className="v2-settings-btn v2-settings-btn-danger"
                    onClick={() => update('impact_dates', (settings.impact_dates || []).filter(x => x.id !== ev.id))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="v2-settings-actions">
                <button
                  className="v2-settings-btn"
                  onClick={() => update('impact_dates', [...(settings.impact_dates || []), { id: uuid(), label: '', date: '', lead_days: 14, tag: null }])}
                >
                  + Add impact date
                </button>
              </div>
            </div>

            <div className="v2-settings-subhead">AI tone</div>

            <div className="v2-settings-block">
              <label className="v2-form-label" htmlFor="v2-ci">Custom instructions</label>
              <div className="v2-settings-row-hint">
                How should the AI talk to you? Shapes every AI feature — task reframes, polish, "what now?" suggestions, Quokka tone, notification rewrites.
              </div>
              <textarea
                id="v2-ci"
                className="v2-form-textarea v2-settings-ci-textarea"
                placeholder="e.g. Keep it casual and short. Don't sugarcoat. Phone calls are confrontation-level for me."
                value={settings.custom_instructions || ''}
                onChange={e => update('custom_instructions', e.target.value)}
              />
              <div className="v2-settings-actions">
                <input ref={ciFileRef} type="file" accept=".md,.txt,.markdown" onChange={handleCIUpload} hidden />
                <button className="v2-settings-btn" onClick={() => ciFileRef.current?.click()}>
                  <Upload size={13} strokeWidth={1.75} /> Import
                </button>
                <button
                  className="v2-settings-btn"
                  onClick={handleCIExport}
                  disabled={!settings.custom_instructions?.trim()}
                >
                  <Download size={13} strokeWidth={1.75} /> Export
                </button>
                {settings.custom_instructions?.trim() && (
                  <button
                    className="v2-settings-btn v2-settings-btn-danger"
                    onClick={() => update('custom_instructions', '')}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="v2-settings-block">
              <div className="v2-form-label">Anthropic API key</div>
              <div className="v2-settings-row-hint">
                Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>, then configure it under <button type="button" className="v2-settings-inline-link" onClick={() => setActiveTab('Integrations')}>Settings → Integrations</button>.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Data' && (
          <div className="v2-settings-form">
            <div className="v2-settings-block">
              <div className="v2-form-label">Backup</div>
              <div className="v2-settings-row-hint">Export tasks, routines, settings, and labels as a single JSON file. Importing replaces the current state and reloads.</div>
              <div className="v2-settings-actions">
                <button className="v2-settings-btn" onClick={handleExportData}>
                  <Download size={13} strokeWidth={1.75} /> Export
                </button>
                <input ref={dataImportRef} type="file" accept=".json" onChange={handleImportData} hidden />
                <button className="v2-settings-btn" onClick={() => dataImportRef.current?.click()}>
                  <Upload size={13} strokeWidth={1.75} /> Import
                </button>
              </div>
            </div>

            <div className="v2-settings-block">
              <div className="v2-form-label">Activity</div>
              <div className="v2-settings-row-hint">Audit trail of edits, completions, and deletes. Deleted tasks can be restored from snapshots.</div>
              <button
                className="v2-settings-btn"
                onClick={() => { onClose?.(); onShowActivityLog?.() }}
                disabled={!onShowActivityLog}
              >
                <FileText size={13} strokeWidth={1.75} /> Open activity log
              </button>
            </div>

            <div className="v2-settings-block">
              <div className="v2-form-label">Server logs</div>
              <div className="v2-settings-row-hint">Live tail of the server process — Google/Push/Email/DB/SSE lines and errors. Used to be its own top-level tab despite being the same kind of diagnostics as Activity above.</div>
              <ServerLogsPanel />
            </div>

            <div className="v2-settings-block">
              <div className="v2-form-label">Markdown import</div>
              <div className="v2-settings-row-hint">Paste a markdown list or checklist and have it parsed into tasks. Rarely used; lives here so it doesn't crowd the main menu.</div>
              <button
                className="v2-settings-btn"
                onClick={() => { onClose?.(); onShowMarkdownImport?.() }}
                disabled={!onShowMarkdownImport}
              >
                <Upload size={13} strokeWidth={1.75} /> Import from markdown
              </button>
            </div>

            {isDev && (
              <div className="v2-settings-block">
                <div className="v2-form-label">Developer · dev only</div>
                <div className="v2-settings-row-hint">Wipe this dev database and reload fresh seed data (tasks rebased to today, ~250 days of routine history). Only shown on the dev build; the server blocks it everywhere else.</div>
                <button className="v2-settings-btn" onClick={handleReseed} disabled={reseeding}>
                  <RefreshCw size={13} strokeWidth={1.75} /> {reseeding ? 'Reseeding…' : 'Reseed dev database'}
                </button>
              </div>
            )}

            <div className="v2-settings-danger">
              <div className="v2-form-label">Danger zone</div>
              <div className="v2-settings-row-hint">These wipe data. No undo other than restoring from a backup.</div>
              <div className="v2-settings-danger-actions">
                <button
                  className="v2-settings-btn v2-settings-btn-danger v2-settings-btn-block"
                  onClick={onClearCompleted}
                >
                  <Trash2 size={13} strokeWidth={1.75} /> Clear completed tasks
                </button>
                <button
                  className="v2-settings-btn v2-settings-btn-danger v2-settings-btn-danger-strong v2-settings-btn-block"
                  onClick={() => setConfirmDialog({
                    title: 'Clear all data',
                    message: 'This will delete all tasks, settings, and history. Are you sure?',
                    onConfirm: () => { setConfirmDialog(null); onClearAll?.() },
                  })}
                >
                  <Trash2 size={13} strokeWidth={1.75} /> Clear all data
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Labels' && <LabelsPanel />}

        {activeTab === 'Notifications' && (
          <NotificationsPanel settings={settings} update={update} />
        )}

        {activeTab === 'Integrations' && (
          <IntegrationsPanel
            settings={settings}
            update={update}
            setActiveTab={setActiveTab}
            onTrelloSync={onTrelloSync}
            trelloSyncing={trelloSyncing}
            onNotionSync={onNotionSync}
            notionSyncing={notionSyncing}
            onGCalSync={onGCalSync}
            gcalSyncing={gcalSyncing}
          />
        )}


      </div>

      {confirmDialog && (
        <div className="v2-settings-confirm-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="v2-settings-confirm" onClick={e => e.stopPropagation()}>
            <h3 className="v2-settings-confirm-title">{confirmDialog.title}</h3>
            <p className="v2-settings-confirm-message">{confirmDialog.message}</p>
            <div className="v2-settings-confirm-actions">
              <button className="v2-settings-btn" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button
                className="v2-settings-btn v2-settings-btn-danger v2-settings-btn-danger-strong"
                onClick={confirmDialog.onConfirm}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  )
}
