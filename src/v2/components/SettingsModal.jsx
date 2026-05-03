import { useState, useEffect, useRef, useCallback } from 'react'
import { Trash2, Download, Upload, RefreshCw, Copy, FileText, ArrowUp, ArrowDown, Plus } from 'lucide-react'
import {
  loadSettings, saveSettings, loadTasks, saveTasks,
  loadRoutines, saveRoutines, loadLabels, saveLabels,
  LABEL_COLORS, uuid,
} from '../../store'
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
function IntegrationsPanel({ settings, update, switchToV1 }) {
  const [envKeys, setEnvKeys] = useState({ anthropic: false, notion: false, trello: false, tracking: false })
  const [statuses, setStatuses] = useState({})

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
      hint: 'Powers AI inference, Quokka, polish, what-now suggestions, notification rewrites.',
      connected: envKeys.anthropic || !!settings.anthropic_api_key,
      v1Section: 'Integrations → Anthropic',
      inline: 'api-key',
      keyName: 'anthropic_api_key',
      envFlag: envKeys.anthropic,
    },
    {
      key: 'notion',
      label: 'Notion',
      hint: 'Pull pages as tasks, sync edits both ways. MCP-based connection (recommended).',
      connected: !!statuses.notion?.connected,
      v1Section: 'Integrations → Notion',
    },
    {
      key: 'trello',
      label: 'Trello',
      hint: 'Push tasks to Trello with checklists + attachments. Bidirectional status sync.',
      connected: !!statuses.trello?.connected,
      v1Section: 'Integrations → Trello',
    },
    {
      key: 'gcal',
      label: 'Google Calendar',
      hint: 'Schedule tasks as events, AI-inferred times, optional pull-from-calendar.',
      connected: !!statuses.gcal?.connected,
      sub: statuses.gcal?.email,
      v1Section: 'Integrations → Google Calendar',
    },
    {
      key: 'gmail',
      label: 'Gmail',
      hint: 'AI-extracted tasks + tracking numbers from your inbox. Manual approval per item.',
      connected: !!statuses.gmail?.connected,
      sub: statuses.gmail?.email,
      v1Section: 'Integrations → Gmail',
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
      key: 'pushover',
      label: 'Pushover',
      hint: 'iOS-friendly transport that bypasses Safari throttling. One-time $5 app required.',
      connected: !!statuses.pushover?.configured,
      v1Section: 'Integrations → Pushover',
    },
  ]

  return (
    <div className="v2-settings-form">
      <div className="v2-settings-block">
        <div className="v2-form-label">Status</div>
        <div className="v2-settings-row-hint">
          OAuth-heavy integrations (Notion, Trello, GCal, Gmail, Pushover) are configured in v1
          to avoid duplicating multi-step consent flows. Simple key-only integrations
          (Anthropic, 17track) can be set inline below.
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
              </div>
              <button
                className="v2-settings-btn"
                onClick={switchToV1}
                title={`Open ${int.v1Section} in v1`}
              >
                {int.connected ? 'Manage in v1' : 'Connect in v1'}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="v2-settings-block">
        <div className="v2-form-label">Why v1 for OAuth?</div>
        <div className="v2-settings-row-hint">
          OAuth flows for Notion / Trello / Google Calendar / Gmail / Pushover each have 4–8 UI
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

      {/* Per-type × per-channel matrix */}
      <div className="v2-settings-block">
        <div className="v2-form-label">Notification types</div>
        <div className="v2-settings-row-hint">Each row toggles per channel. Frequency is the cooldown between repeats.</div>
        <div className="v2-notif-matrix-wrap">
          <table className="v2-notif-matrix">
            <thead>
              <tr>
                <th className="v2-notif-matrix-type">Type</th>
                <th>Push</th>
                <th>Email</th>
                <th>Pushover</th>
                <th>Every (h)</th>
              </tr>
            </thead>
            <tbody>
              {NOTIF_TYPES.map(t => (
                <tr key={t.key}>
                  <td className="v2-notif-matrix-type">{t.label}</td>
                  <td>
                    <Toggle
                      checked={settings[`push_notif_${t.key}`] !== false}
                      onChange={e => update(`push_notif_${t.key}`, e.target.checked)}
                      disabled={settings.push_notifications_enabled !== true}
                    />
                  </td>
                  <td>
                    <Toggle
                      checked={settings[`email_notif_${t.key}`] !== false}
                      onChange={e => update(`email_notif_${t.key}`, e.target.checked)}
                      disabled={settings.email_notifications_enabled !== true}
                    />
                  </td>
                  <td>
                    <Toggle
                      checked={settings[`pushover_notif_${t.key}`] === true}
                      onChange={e => update(`pushover_notif_${t.key}`, e.target.checked)}
                      disabled={settings.pushover_notifications_enabled !== true}
                    />
                  </td>
                  <td>
                    <input
                      className="v2-notif-matrix-freq"
                      type="number"
                      min="0.25"
                      max="168"
                      step="0.25"
                      value={settings[t.freqKey] ?? t.freqDefault}
                      onChange={e => update(t.freqKey, Math.max(0.25, parseFloat(e.target.value) || 0.25))}
                    />
                  </td>
                </tr>
              ))}
              {NOTIF_PACKAGE_TYPES.map(t => (
                <tr key={t.key}>
                  <td className="v2-notif-matrix-type">{t.label}</td>
                  <td>
                    <Toggle
                      checked={settings[`push_notif_${t.key}`] !== false}
                      onChange={e => update(`push_notif_${t.key}`, e.target.checked)}
                      disabled={settings.push_notifications_enabled !== true}
                    />
                  </td>
                  <td>
                    <Toggle
                      checked={settings[`email_notif_${t.key}`] !== false}
                      onChange={e => update(`email_notif_${t.key}`, e.target.checked)}
                      disabled={settings.email_notifications_enabled !== true}
                    />
                  </td>
                  <td>
                    <Toggle
                      checked={settings[`pushover_notif_${t.key}`] !== false}
                      onChange={e => update(`pushover_notif_${t.key}`, e.target.checked)}
                      disabled={settings.pushover_notifications_enabled !== true}
                    />
                  </td>
                  <td className="v2-notif-matrix-freq-na">—</td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <div className="v2-form-row" style={{ marginTop: 12 }}>
            <div className="v2-form-field">
              <label className="v2-form-label">Start</label>
              <input
                type="time"
                className="v2-form-input"
                value={settings.quiet_hours_start || '22:00'}
                onChange={e => update('quiet_hours_start', e.target.value)}
              />
            </div>
            <div className="v2-form-field">
              <label className="v2-form-label">End</label>
              <input
                type="time"
                className="v2-form-input"
                value={settings.quiet_hours_end || '08:00'}
                onChange={e => update('quiet_hours_end', e.target.value)}
              />
            </div>
          </div>
        )}
        {settings.quiet_hours_enabled && (
          <div className="v2-settings-block" style={{ marginTop: 12 }}>
            <label className="v2-form-label">Bypass label</label>
            <div className="v2-settings-row-hint">Tasks with this tag wake you even during quiet hours.</div>
            <input
              className="v2-form-input v2-settings-narrow-input"
              type="text"
              value={settings.quiet_hours_bypass_label || 'wake-me'}
              onChange={e => update('quiet_hours_bypass_label', e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Pointer to v1 for the rest */}
      <div className="v2-settings-block">
        <div className="v2-form-label">More notification options</div>
        <div className="v2-settings-row-hint">
          Morning digest configuration, channel test buttons, notification history, adaptive throttling controls,
          and Pushover priority routing live in v1 → Settings → Notifications.
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
      try {
        const data = JSON.parse(ev.target.result)
        if (data.tasks) saveTasks(data.tasks)
        if (data.routines) saveRoutines(data.routines)
        if (data.settings) saveSettings(data.settings)
        if (data.labels) saveLabels(data.labels)
        if (data.settings) setSettings({ ...loadSettings(), ...data.settings })
        // Push imported data to server before reloading so the next SSE
        // hydration doesn't overwrite it with stale server state. Same
        // pattern v1 uses.
        const payload = {}
        if (data.tasks) payload.tasks = data.tasks
        if (data.routines) payload.routines = data.routines
        if (data.settings) payload.settings = data.settings
        if (data.labels) payload.labels = data.labels
        fetch('/api/data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).finally(() => window.location.reload())
      } catch {
        alert('Invalid backup file')
      }
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
                  checked={(settings.theme || 'dark') === 'dark'}
                  onChange={e => {
                    const theme = e.target.checked ? 'dark' : 'light'
                    update('theme', theme)
                    document.documentElement.setAttribute('data-theme', theme)
                    const meta = document.querySelector('meta[name="theme-color"]')
                    if (meta) meta.content = theme === 'dark' ? '#0B0B0F' : '#F5F5F7'
                  }}
                />
                <span className="v2-settings-toggle-track"><span className="v2-settings-toggle-thumb" /></span>
              </label>
            </div>

            <div className="v2-settings-block">
              <label className="v2-form-label" htmlFor="v2-default-due-days">Default due date (days from now)</label>
              <div className="v2-settings-row-hint">0 means no default — tasks ship without a due date unless you pick one.</div>
              <input
                id="v2-default-due-days"
                className="v2-form-input v2-settings-narrow-input"
                type="number"
                min="0"
                max="90"
                value={settings.default_due_days ?? 7}
                onChange={e => update('default_due_days', parseInt(e.target.value) || 0)}
              />
            </div>

            <div className="v2-settings-block">
              <label className="v2-form-label" htmlFor="v2-staleness-days">Staleness threshold (days)</label>
              <div className="v2-settings-row-hint">A task with no activity for this long shows up in the Stale section.</div>
              <input
                id="v2-staleness-days"
                className="v2-form-input v2-settings-narrow-input"
                type="number"
                min="1"
                max="30"
                value={settings.staleness_days ?? 7}
                onChange={e => update('staleness_days', parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="v2-settings-block">
              <label className="v2-form-label" htmlFor="v2-reframe-threshold">Reframe trigger (snooze count)</label>
              <div className="v2-settings-row-hint">After this many snoozes, tapping snooze opens the Reframe modal instead.</div>
              <input
                id="v2-reframe-threshold"
                className="v2-form-input v2-settings-narrow-input"
                type="number"
                min="1"
                max="20"
                value={settings.reframe_threshold ?? 3}
                onChange={e => update('reframe_threshold', parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="v2-settings-block">
              <label className="v2-form-label" htmlFor="v2-max-open">Max open tasks</label>
              <div className="v2-settings-row-hint">Warns when you exceed this. 0 = no limit.</div>
              <input
                id="v2-max-open"
                className="v2-form-input v2-settings-narrow-input"
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
            <div className="v2-settings-block">
              <div className="v2-form-label">API key</div>
              <div className="v2-settings-row-hint">
                Anthropic API key entry + provider testing lives in v1 → Settings → AI for now.
                It's a multi-state form (env-set vs user-provided, status check, model picker)
                that ports in PR5h.
              </div>
              <button className="v2-settings-btn" onClick={switchToV1}>
                Open v1 → AI
              </button>
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

            <div className="v2-settings-danger">
              <div className="v2-form-label">Danger zone</div>
              <div className="v2-settings-row-hint">These wipe data. No undo other than restoring from a backup.</div>
              <div className="v2-settings-actions">
                <button
                  className="v2-settings-btn v2-settings-btn-danger"
                  onClick={onClearCompleted}
                >
                  <Trash2 size={13} strokeWidth={1.75} /> Clear completed tasks
                </button>
                <button
                  className="v2-settings-btn v2-settings-btn-danger v2-settings-btn-danger-strong"
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
          <IntegrationsPanel settings={settings} update={update} switchToV1={switchToV1} />
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
