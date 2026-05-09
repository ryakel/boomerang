import { useState, useEffect, useRef, useCallback } from 'react'
import { Trash2, Download, Upload, RefreshCw, Copy, FileText, ArrowUp, ArrowDown, Plus } from 'lucide-react'
import {
  loadSettings, saveSettings, loadTasks, saveTasks,
  loadRoutines, saveRoutines, loadLabels, saveLabels,
  LABEL_COLORS, uuid,
} from '../../store'
import { restoreFromBackup } from '../../api'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import './SettingsModal.css'

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

const STORAGE_KEY = 'ui_version'

const TABS = ['General', 'AI', 'Labels', 'Integrations', 'Notifications', 'Data', 'Logs', 'Beta']

// All Settings tabs now have v2 implementations. Integrations is a
// status-summary panel — full OAuth flows still live in v1 because each
// flow has 6+ states and isn't worth duplicating.
const PLACEHOLDER_TABS = new Set()
const PLACEHOLDER_BODY = {}

// Notification types (excluding high priority which has its own escalation
// section) + their channel-specific setting key suffixes. Same scheme v1
// uses: push_notif_<key>, email_notif_<key>, pushover_notif_<key>.
const NOTIF_TYPES = [
  { key: 'overdue', label: 'Overdue', freqKey: 'notif_freq_overdue', freqDefault: 0.5 },
  { key: 'stale', label: 'Stale', freqKey: 'notif_freq_stale', freqDefault: 0.5 },
  { key: 'nudge', label: 'Nudges', freqKey: 'notif_freq_nudge', freqDefault: 1 },
  { key: 'size', label: 'Size-based', freqKey: 'notif_freq_size', freqDefault: 1 },
  { key: 'pileup', label: 'Pile-up', freqKey: 'notif_freq_pileup', freqDefault: 2 },
]

const NOTIF_PACKAGE_TYPES = [
  { key: 'package_delivered', label: 'Package delivered' },
  { key: 'package_exception', label: 'Package exception' },
]

// Integrations panel — status summary + "Configure in v1" CTAs for the
// OAuth-heavy ones. Inline credential entry for simple key-only integrations
// (Anthropic, 17track) since those are one-field forms.
// Anthropic key entry + status check. Lives in the AI tab; the
// IntegrationsPanel still surfaces a status dot but the actual key
// management happens here.
function AnthropicKeyBlock({ settings, update }) {
  const [envKey, setEnvKey] = useState(false)
  const [status, setStatus] = useState(null) // null | 'checking' | 'connected' | 'error'
  const [error, setError] = useState(null)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    import('../../api').then(m => m.getKeyStatus()).then(keys => {
      if (!cancelled) setEnvKey(!!keys?.anthropic)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const runTest = async () => {
    setStatus('checking')
    setError(null)
    try {
      const api = await import('../../api')
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

  return (
    <div className="v2-settings-block">
      <div className="v2-form-label">Anthropic API key</div>
      <div className="v2-settings-row-hint">
        Powers AI inference, Quokka, polish, what-now suggestions, and notification rewrites.
        Keys at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
      </div>
      {envKey ? (
        <div className="v2-integrations-env">
          Provided via env var. Configure server-side; this field is read-only.
        </div>
      ) : (
        <div className="v2-integrations-inline">
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
        </div>
      )}
      {envKey && (
        <div className="v2-integrations-actions" style={{ marginTop: 8 }}>
          <button className="v2-settings-btn" onClick={runTest} disabled={status === 'checking'}>
            {status === 'checking' ? 'Testing…' : 'Test'}
          </button>
        </div>
      )}
      <div className={summaryClass} style={{ marginTop: 8 }}>{summary}</div>
    </div>
  )
}

function IntegrationsPanel({
  settings, update, switchToV1, setActiveTab,
  onTrelloSync, trelloSyncing, onNotionSync, notionSyncing, onGCalSync, gcalSyncing,
}) {
  const [envKeys, setEnvKeys] = useState({ anthropic: false, notion: false, trello: false, tracking: false })
  const [statuses, setStatuses] = useState({})
  const [pushoverTest, setPushoverTest] = useState({ status: null, error: null })
  const [pushoverEmer, setPushoverEmer] = useState({ status: null, error: null })
  const [emergencyConfirm, setEmergencyConfirm] = useState(false)
  const [gmailSyncing, setGmailSyncing] = useState(false)
  const [gmailSyncResult, setGmailSyncResult] = useState(null)
  const [weatherQuery, setWeatherQuery] = useState('')
  const [weatherResults, setWeatherResults] = useState([])
  const [weatherSearching, setWeatherSearching] = useState(false)
  const [weatherError, setWeatherError] = useState(null)
  const [trelloBoards, setTrelloBoardsList] = useState([])
  const [trelloLists, setTrelloListsList] = useState([])
  const [trelloListsLoading, setTrelloListsLoading] = useState(false)
  const [gcalCalendars, setGcalCalendarsList] = useState([])

  // Load Trello boards + GCal calendars when their integrations are connected.
  useEffect(() => {
    if (!statuses.trello?.connected) return
    let cancelled = false
    import('../../api').then(m => m.trelloBoards()).then(boards => {
      if (!cancelled) setTrelloBoardsList(Array.isArray(boards) ? boards : [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [statuses.trello?.connected])

  useEffect(() => {
    if (!settings.trello_board_id || !statuses.trello?.connected) return
    let cancelled = false
    setTrelloListsLoading(true)
    import('../../api').then(m => m.trelloBoardLists(settings.trello_board_id)).then(lists => {
      if (!cancelled) setTrelloListsList(Array.isArray(lists) ? lists : [])
    }).catch(() => { if (!cancelled) setTrelloListsList([]) })
      .finally(() => { if (!cancelled) setTrelloListsLoading(false) })
    return () => { cancelled = true }
  }, [settings.trello_board_id, statuses.trello?.connected])

  useEffect(() => {
    if (!statuses.gcal?.connected) return
    let cancelled = false
    import('../../api').then(m => m.gcalListCalendars()).then(cals => {
      if (!cancelled) setGcalCalendarsList(Array.isArray(cals) ? cals : [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [statuses.gcal?.connected])

  const handleTrelloBoardChange = (boardId) => {
    update('trello_board_id', boardId)
    update('trello_list_id', '') // reset list when board changes
    setTrelloListsList([])
  }

  const runWeatherSearch = async () => {
    const q = weatherQuery.trim()
    if (!q) return
    setWeatherSearching(true)
    setWeatherError(null)
    setWeatherResults([])
    try {
      const api = await import('../../api')
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
      const api = await import('../../api')
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
      const api = await import('../../api')
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
      import('../../api').then(m => m.getKeyStatus()).catch(() => ({})),
      import('../../api').then(m => m.notionStatus()).catch(() => null),
      import('../../api').then(m => m.trelloStatus()).catch(() => null),
      import('../../api').then(m => m.gcalStatus()).catch(() => null),
      import('../../api').then(m => m.gmailStatus()).catch(() => null),
      import('../../api').then(m => m.pushoverStatus()).catch(() => null),
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
      hint: 'Powers AI inference, Quokka, polish, what-now suggestions, notification rewrites. Configure in the AI tab.',
      connected: envKeys.anthropic || !!settings.anthropic_api_key,
      v1Section: 'AI',
      manageInTab: 'AI',
    },
    {
      key: 'notion',
      label: 'Notion',
      hint: 'Pull pages as tasks, sync edits both ways. MCP-based connection (recommended).',
      connected: !!statuses.notion?.connected,
      v1Section: 'Integrations → Notion',
      sync: onNotionSync && settings.notion_sync_parent_id ? { fn: onNotionSync, busy: notionSyncing } : null,
    },
    {
      key: 'trello',
      label: 'Trello',
      hint: 'Push tasks to Trello with checklists + attachments. Bidirectional status sync.',
      connected: !!statuses.trello?.connected,
      v1Section: 'Integrations → Trello',
      sync: onTrelloSync && settings.trello_sync_enabled ? { fn: onTrelloSync, busy: trelloSyncing } : null,
      inline: statuses.trello?.connected ? 'trello-config' : null,
    },
    {
      key: 'gcal',
      label: 'Google Calendar',
      hint: 'Schedule tasks as events, AI-inferred times, optional pull-from-calendar.',
      connected: !!statuses.gcal?.connected,
      sub: statuses.gcal?.email,
      v1Section: 'Integrations → Google Calendar',
      sync: onGCalSync && settings.gcal_pull_enabled ? { fn: onGCalSync, busy: gcalSyncing } : null,
      inline: statuses.gcal?.connected ? 'gcal-config' : null,
    },
    {
      key: 'gmail',
      label: 'Gmail',
      hint: 'AI-extracted tasks + tracking numbers from your inbox. Manual approval per item.',
      connected: !!statuses.gmail?.connected,
      sub: statuses.gmail?.email,
      v1Section: 'Integrations → Gmail',
      sync: statuses.gmail?.connected ? { fn: runGmailSync, busy: gmailSyncing } : null,
      syncResult: gmailSyncResult,
      inline: statuses.gmail?.connected ? 'gmail-config' : null,
    },
    {
      key: 'tracking',
      label: '17track (packages)',
      hint: 'Server-side polling for delivery status across most major carriers.',
      connected: envKeys.tracking || !!settings.tracking_api_key,
      v1Section: 'Integrations → Package Tracking',
      inline: 'api-key',
      keyName: 'tracking_api_key',
      envFlag: envKeys.tracking,
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
      v1Section: 'Integrations → Pushover',
      inline: 'pushover',
      appTokenFromEnv: !!statuses.pushover?.app_token_from_env,
    },
  ]

  const runPushoverTest = async (emergency) => {
    const setter = emergency ? setPushoverEmer : setPushoverTest
    setter({ status: 'sending', error: null })
    try {
      const api = await import('../../api')
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
          OAuth-heavy integrations (Notion, Trello, GCal, Gmail) are configured in v1
          to avoid duplicating multi-step consent flows. Anthropic is configured in
          the AI tab. Simple key-only integrations (17track, Pushover) can be set
          inline below.
        </div>
        <ul className="v2-integrations-list">
          {integrations.map(int => (
            <li key={int.key} className="v2-integrations-row">
              <span className={`v2-integrations-dot v2-integrations-dot-${int.connected ? 'connected' : 'unconfigured'}`} />
              <div className="v2-integrations-meta">
                <div className="v2-integrations-name">{int.label}</div>
                {int.sub && <div className="v2-integrations-sub">{int.sub}</div>}
                <div className="v2-integrations-hint">{int.hint}</div>
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
                {int.inline === 'trello-config' && (
                  <div className="v2-integrations-inline">
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
                        )}
                      </>
                    )}
                  </div>
                )}
                {int.inline === 'gcal-config' && (
                  <div className="v2-integrations-inline">
                    <label className="v2-form-label">Calendar</label>
                    <select
                      className="v2-form-input"
                      value={settings.gcal_calendar_id || 'primary'}
                      onChange={e => update('gcal_calendar_id', e.target.value)}
                    >
                      {gcalCalendars.length === 0 && <option value="primary">Primary</option>}
                      {gcalCalendars.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.summary}{c.primary ? ' (Primary)' : ''}
                        </option>
                      ))}
                    </select>
                    <div className="v2-integrations-toggle-row">
                      <span>Push tasks as calendar events</span>
                      <label className="v2-settings-toggle">
                        <input
                          type="checkbox"
                          checked={!!settings.gcal_sync_enabled}
                          onChange={e => update('gcal_sync_enabled', e.target.checked)}
                        />
                        <span className="v2-settings-toggle-track"><span className="v2-settings-toggle-thumb" /></span>
                      </label>
                    </div>
                    <div className="v2-integrations-toggle-row">
                      <span>Pull events as tasks</span>
                      <label className="v2-settings-toggle">
                        <input
                          type="checkbox"
                          checked={!!settings.gcal_pull_enabled}
                          onChange={e => update('gcal_pull_enabled', e.target.checked)}
                        />
                        <span className="v2-settings-toggle-track"><span className="v2-settings-toggle-thumb" /></span>
                      </label>
                    </div>
                  </div>
                )}
                {int.inline === 'gmail-config' && (
                  <div className="v2-integrations-inline">
                    <div className="v2-integrations-toggle-row">
                      <span>Auto-scan inbox for tasks &amp; tracking numbers</span>
                      <label className="v2-settings-toggle">
                        <input
                          type="checkbox"
                          checked={!!settings.gmail_sync_enabled}
                          onChange={e => update('gmail_sync_enabled', e.target.checked)}
                        />
                        <span className="v2-settings-toggle-track"><span className="v2-settings-toggle-thumb" /></span>
                      </label>
                    </div>
                    <div className="v2-integrations-toggle-row">
                      <span>Scan window (days back)</span>
                      <input
                        className="v2-form-input v2-settings-compact-input"
                        type="number"
                        min="1"
                        max="30"
                        value={settings.gmail_scan_days || 7}
                        onChange={e => update('gmail_scan_days', parseInt(e.target.value, 10) || 7)}
                      />
                    </div>
                  </div>
                )}
                {int.inline === 'weather' && (
                  <div className="v2-integrations-inline">
                    {settings.weather_latitude && settings.weather_location_name ? (
                      <div className="v2-weather-current">
                        <div className="v2-weather-current-label">📍 {settings.weather_location_name}</div>
                        <button className="v2-settings-btn" onClick={clearWeatherLocation}>Change location</button>
                      </div>
                    ) : (
                      <>
                        <div className="v2-weather-search">
                          <input
                            type="text"
                            className="v2-form-input"
                            placeholder="City or zip code…"
                            value={weatherQuery}
                            onChange={e => setWeatherQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runWeatherSearch() } }}
                          />
                          <button
                            className="v2-settings-btn"
                            onClick={runWeatherSearch}
                            disabled={weatherSearching || !weatherQuery.trim()}
                          >
                            {weatherSearching ? 'Searching…' : 'Search'}
                          </button>
                        </div>
                        {weatherError && <div className="v2-integrations-error">{weatherError}</div>}
                        {weatherResults.length > 0 && (
                          <ul className="v2-weather-results">
                            {weatherResults.map((r, i) => (
                              <li key={i}>
                                <button className="v2-weather-result" onClick={() => pickWeatherLocation(r)}>
                                  {r.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
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
                      Configure which notification types fire over Pushover in the Notifications tab.
                    </div>
                  </div>
                )}
                {int.syncResult && (
                  <div className="v2-integrations-sync-result">{int.syncResult}</div>
                )}
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
                {!['pushover', 'weather', 'trello-config', 'gcal-config', 'gmail-config'].includes(int.inline) && (
                  int.manageInTab ? (
                    <button
                      className="v2-settings-btn"
                      onClick={() => setActiveTab(int.manageInTab)}
                      title={`Open ${int.manageInTab} tab`}
                    >
                      Configure in {int.manageInTab}
                    </button>
                  ) : (
                    <button
                      className="v2-settings-btn"
                      onClick={switchToV1}
                      title={`Open ${int.v1Section} in v1`}
                    >
                      {int.connected ? 'Manage in v1' : 'Connect in v1'}
                    </button>
                  )
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

      <div className="v2-settings-block">
        <div className="v2-form-label">Why v1 for OAuth?</div>
        <div className="v2-settings-row-hint">
          OAuth flows for Notion / Trello / Google Calendar / Gmail each have 4–8 UI
          states (consent prompt, callback handling, calendar picker, scope error, env-var
          override, disconnect with confirmation). v2 will absorb them in a future release;
          for now, v1 → Settings → Integrations does the work, and the resulting tokens are
          shared between v1 and v2 — connect once, both interfaces benefit.
        </div>
      </div>
    </div>
  )
}

function NotificationsPanel({ settings, update }) {
  // Channel master toggles. Pushover gates additionally on credentials being
  // present, but for the v2 panel we just toggle the boolean and show a hint.
  const masters = [
    { key: 'push_notifications_enabled', label: 'Web push', hint: 'Browser-native notifications. Per-device subscription.' },
    { key: 'email_notifications_enabled', label: 'Email', hint: 'Server-side SMTP. Address comes from `email_address` setting or NOTIFICATION_EMAIL env.' },
    { key: 'pushover_notifications_enabled', label: 'Pushover', hint: 'iOS-friendly transport via the Pushover app. Credentials in v1 → Integrations.' },
  ]

  const Toggle = ({ checked, onChange, disabled }) => (
    <label className={`v2-settings-toggle${disabled ? ' v2-settings-toggle-disabled' : ''}`}>
      <input type="checkbox" checked={!!checked} onChange={onChange} disabled={disabled} />
      <span className="v2-settings-toggle-track"><span className="v2-settings-toggle-thumb" /></span>
    </label>
  )

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
      const api = await import('../../api')
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
      const api = await import('../../api')
      await api.clearServerNotifLog()
      setHistory([])
    } catch { /* no-op */ }
  }

  useEffect(() => {
    if (historyOpen && history === null) loadHistory()
  }, [historyOpen, history])

  return (
    <div className="v2-settings-form">
      {/* Channel masters */}
      <div className="v2-settings-block">
        <div className="v2-form-label">Channels</div>
        <div className="v2-settings-row-hint">Master toggle per delivery channel. Each channel still respects its per-type settings below.</div>
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
      </div>

      {/* Per-type × per-channel — card-per-type layout works at any width */}
      <div className="v2-settings-block">
        <div className="v2-form-label">Notification types</div>
        <div className="v2-settings-row-hint">Each card toggles a notification type per channel. Frequency is the cooldown between repeats.</div>
        <div className="v2-notif-cards">
          {NOTIF_TYPES.map(t => (
            <div key={t.key} className="v2-notif-card">
              <div className="v2-notif-card-head">
                <div className="v2-notif-card-label">{t.label}</div>
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
                <div className="v2-notif-card-label">{t.label}</div>
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
        </div>
      </div>

      {/* High-priority escalation */}
      <div className="v2-settings-block">
        <div className="v2-form-label">High-priority escalation</div>
        <div className="v2-settings-row-hint">Three-stage cadence as a high-pri task approaches its due date and goes overdue.</div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Enable escalation</div>
          </div>
          <Toggle
            checked={settings.notif_highpri_escalate !== false}
            onChange={e => update('notif_highpri_escalate', e.target.checked)}
          />
        </div>
        {settings.notif_highpri_escalate !== false && (
          <div className="v2-notif-stages">
            <div className="v2-notif-stage">
              <label className="v2-form-label">Before due (h)</label>
              <input
                className="v2-form-input v2-settings-narrow-input"
                type="number" min="0.25" max="168" step="0.25"
                value={settings.notif_freq_highpri_before ?? 24}
                onChange={e => update('notif_freq_highpri_before', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
              />
            </div>
            <div className="v2-notif-stage">
              <label className="v2-form-label">On due day (h)</label>
              <input
                className="v2-form-input v2-settings-narrow-input"
                type="number" min="0.25" max="24" step="0.25"
                value={settings.notif_freq_highpri_due ?? 1}
                onChange={e => update('notif_freq_highpri_due', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
              />
            </div>
            <div className="v2-notif-stage">
              <label className="v2-form-label">Overdue (h)</label>
              <input
                className="v2-form-input v2-settings-narrow-input"
                type="number" min="0.25" max="24" step="0.25"
                value={settings.notif_freq_highpri_overdue ?? 0.5}
                onChange={e => update('notif_freq_highpri_overdue', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
              />
            </div>
          </div>
        )}
      </div>

      {/* Quiet hours */}
      <div className="v2-settings-block">
        <div className="v2-form-label">Quiet hours</div>
        <div className="v2-settings-row-hint">Suppress most notifications during this window. Tasks tagged with the bypass label still wake you.</div>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Enable quiet hours</div>
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

      {/* Test channels — fire a one-off notification per channel to verify config */}
      <div className="v2-settings-block">
        <div className="v2-form-label">Test channels</div>
        <div className="v2-settings-row-hint">Send a one-off test notification through each channel to verify it's working. Test buttons obey channel master toggles + Pushover credentials.</div>
        <div className="v2-notif-tests">
          {[
            { key: 'push', label: 'Test push', enabled: settings.push_notifications_enabled === true,
              fn: () => import('../../api').then(m => m.testPush()) },
            { key: 'email', label: 'Test email', enabled: settings.email_notifications_enabled === true,
              fn: () => import('../../api').then(m => m.testEmail()) },
            { key: 'pushover', label: 'Test Pushover', enabled: settings.pushover_notifications_enabled === true && !!settings.pushover_user_key,
              fn: () => import('../../api').then(m => m.testPushover({ userKey: settings.pushover_user_key, appToken: settings.pushover_app_token })) },
            { key: 'digest', label: 'Test digest', enabled: settings.push_notifications_enabled || settings.email_notifications_enabled || settings.pushover_digest_enabled,
              fn: () => import('../../api').then(m => m.testDigest()) },
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
                      <span className="v2-notif-history-time">{new Date(entry.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
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
                  runTest('emergency', () => import('../../api').then(m => m.testPushoverEmergency({
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

      {/* Pointer to v1 for the rest */}
      <div className="v2-settings-block">
        <div className="v2-form-label">More notification options</div>
        <div className="v2-settings-row-hint">
          Morning digest schedule + style, adaptive throttling 👍/👎 feedback chips, email From overrides + batch mode,
          Pushover priority routing helper text, and weather-notification toggles still live in v1 → Settings → Notifications.
        </div>
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

  const FILTERS = ['all', 'Gmail', 'GCal', 'Push', 'Email', 'DB', 'SSE', 'error']
  const FILTER_PATTERNS = {
    Gmail: ['[Gmail]'],
    GCal: ['[GCal]', '[GCalSync]'],
    Push: ['[Push]'],
    Email: ['[Email]'],
    DB: ['[DB]'],
    SSE: ['[SSE]', '[SYNC]'],
  }
  const filtered = filter === 'all' ? logs
    : filter === 'error' ? logs.filter(l => l.level === 'error' || l.level === 'warn')
    : logs.filter(l => (FILTER_PATTERNS[filter] || [`[${filter}]`]).some(p => l.msg.includes(p)))

  const handleCopy = () => {
    const text = logs.map(l => `${l.ts} [${l.level}] ${l.msg}`).join('\n')
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
        <button className="v2-settings-btn" onClick={handleCopy} disabled={logs.length === 0}>
          <Copy size={13} strokeWidth={1.75} />
          {copied ? 'Copied' : 'Copy all'}
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
  open, onClose, onFlush, onClearCompleted, onClearAll, onShowActivityLog,
  onTrelloSync, trelloSyncing, onNotionSync, notionSyncing, onGCalSync, gcalSyncing,
}) {
  const [activeTab, setActiveTab] = useState('Beta')
  const [settings, setSettings] = useState(() => loadSettings())
  const [confirmDialog, setConfirmDialog] = useState(null)
  const flushDebounceRef = useRef(null)
  const dataImportRef = useRef(null)
  const ciFileRef = useRef(null)

  // Reload settings whenever the modal reopens — server may have updated them.
  useEffect(() => {
    if (open) setSettings(loadSettings())
  }, [open])

  const update = useCallback((key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
    if (onFlush) {
      if (flushDebounceRef.current) clearTimeout(flushDebounceRef.current)
      flushDebounceRef.current = setTimeout(() => { onFlush() }, 300)
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
    a.download = `boomerang-backup-${new Date().toISOString().split('T')[0]}.json`
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

  const switchToV1 = () => {
    localStorage.setItem(STORAGE_KEY, 'v1')
    window.location.reload()
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Settings" width="wide">
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
        {PLACEHOLDER_TABS.has(activeTab) && (
          <EmptyState
            title={`${activeTab} settings`}
            body={`${PLACEHOLDER_BODY[activeTab]} Use v1 → Settings → ${activeTab} to configure for now.`}
            cta="Open v1"
            ctaOnClick={switchToV1}
          />
        )}

        {activeTab === 'General' && (
          <div className="v2-settings-form">
            <div className="v2-settings-row">
              <div className="v2-settings-row-text">
                <div className="v2-settings-row-label">Dark mode</div>
                <div className="v2-settings-row-hint">Light mode flips the off-white background to soft grey and inverts the text palette.</div>
              </div>
              <label className="v2-settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.theme === 'dark'}
                  onChange={e => {
                    const theme = e.target.checked ? 'dark' : 'light'
                    update('theme', theme)
                    document.documentElement.setAttribute('data-theme', theme)
                    const meta = document.querySelector('meta[name="theme-color"]')
                    if (meta) meta.content = theme === 'dark' ? '#0B0B0F' : '#FFFFFF'
                  }}
                />
                <span className="v2-settings-toggle-track"><span className="v2-settings-toggle-thumb" /></span>
              </label>
            </div>

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
                <div className="v2-settings-row-hint">Days of inactivity before a task surfaces in the Stale section.</div>
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
          </div>
        )}

        {activeTab === 'AI' && (
          <div className="v2-settings-form">
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
            <AnthropicKeyBlock settings={settings} update={update} />
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
            switchToV1={switchToV1}
            setActiveTab={setActiveTab}
            onTrelloSync={onTrelloSync}
            trelloSyncing={trelloSyncing}
            onNotionSync={onNotionSync}
            notionSyncing={notionSyncing}
            onGCalSync={onGCalSync}
            gcalSyncing={gcalSyncing}
          />
        )}

        {activeTab === 'Logs' && <ServerLogsPanel />}

        {activeTab === 'Beta' && (
          <div className="v2-settings-beta">
            <div className="v2-settings-block">
              <h3 className="v2-settings-heading">Interface</h3>
              <p className="v2-settings-body">
                You're on <strong>v2</strong> — the redesigned interface. It's the default.
                If you want the legacy v1 interface, toggle below; you can flip back any time.
              </p>
              <label className="v2-settings-toggle v2-settings-toggle-inline">
                <input
                  type="checkbox"
                  defaultChecked={false}
                  onChange={e => {
                    if (e.target.checked) {
                      localStorage.setItem(STORAGE_KEY, 'v1')
                      window.location.reload()
                    }
                  }}
                />
                <span className="v2-settings-toggle-track">
                  <span className="v2-settings-toggle-thumb" />
                </span>
                <span className="v2-settings-toggle-label">Use legacy v1 interface</span>
              </label>
              <p className="v2-settings-hint">
                URL escape hatch: <code>?ui=v1</code> or <code>?ui=v2</code> sets the flag and reloads.
              </p>
            </div>

            <div className="v2-settings-block">
              <h3 className="v2-settings-heading">Build</h3>
              <p className="v2-settings-body">Static identifier of the running build — never overwritten by autosave.</p>
              <code className="v2-settings-build">{__APP_VERSION__}</code>
            </div>

            <div className="v2-settings-block">
              <h3 className="v2-settings-heading">What's coming</h3>
              <ul className="v2-settings-roadmap">
                <li>Remaining Settings tabs (Labels, Integrations, Notifications)</li>
                <li>Desktop KanbanBoard</li>
                <li>Toast + motion polish + dark-mode parity sweep</li>
              </ul>
            </div>
          </div>
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
