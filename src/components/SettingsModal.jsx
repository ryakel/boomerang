import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react'
import { Trash2, Download, Upload, RefreshCw, Copy, FileText, ArrowUp, ArrowDown, Plus, ChevronRight, Server } from 'lucide-react'
import { isNativeShell, getApiBase, requestConnectionSetup, readJson } from '../apiConfig'
import { requestRemindersAccess, syncReminders } from '../remindersSync'
import { requestLocalReminderPermission, refreshLocalReminders, pendingLocalReminders } from '../localReminders'
import {
  loadSettings, saveSettings, loadTasks, saveTasks,
  loadRoutines, saveRoutines, safeSetItem, loadLabels, saveLabels,
  LABEL_COLORS, uuid, localYMD,
} from '../store'
import { restoreFromBackup } from '../api'
import { usePushSubscription } from '../hooks/usePushSubscription'
import ModalShell from './ModalShell'
import {
  SettingsNav, SettingsPage, SettingsGroup,
  SettingRow, ToggleRow, SegmentRow, ValueRow, NavRow, ActionRow, StatusRow,
} from './settings'
import EmptyState from './EmptyState'
import AutosaveIndicator from './AutosaveIndicator'
import { applyTheme } from '../theme'
import './SettingsModal.css'
import { MODEL_CATALOG as AI_MODEL_CATALOG, TIER_DEFAULTS as AI_TIER_DEFAULTS } from '../../server/aiModels.js'

// Shared toggle switch — was locally defined inside NotificationsPanel and
// hand-copied at ~10 other call sites across IntegrationsPanel/General. One
// definition so a future visual tweak doesn't need a find-and-replace.
// Collapsible settings section — session-local state that ALWAYS starts
// collapsed (2026-07-17: "Settings should start minimized across the
// board"). Deliberately NOT persisted: retained open-state is exactly how
// the pages got long and messy.

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
      {/* Plain groups, not framed cards — the danger zone stays the ONE framed
          element in settings. The colour <details> below stay: they are a
          picker popover, not a hidden section, so they are not part of the
          collapse family this rebuild is removing. */}
      <SettingsGroup caption="Existing labels">
        <p className="v2-set-page-intro">Tap a name to rename. Colour swatches open the picker. Use the arrows to reorder.</p>
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
      </SettingsGroup>

      <SettingsGroup caption="Add a label">
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
      </SettingsGroup>
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
// A labelled number with its unit. Composed from SettingRow rather than being
// a new row kind: the unit is what makes the number legible ("3 snoozes" needs
// no hint at all), and putting it beside the input is cheaper than a sentence
// underneath. Composition, not a parallel implementation — the thing §7 exists
// to prevent.
function NumberRow({ label, info, unit, value, onChange, min, max, disabled }) {
  return (
    <SettingRow
      label={label}
      info={info}
      disabled={disabled}
      trailing={
        <span className="v2-set-number">
          <input
            className="v2-form-input v2-settings-compact-input"
            type="number"
            min={min}
            max={max}
            aria-label={label}
            value={value}
            onChange={e => onChange(parseInt(e.target.value, 10))}
          />
          {unit && <span className="v2-set-number-unit">{unit}</span>}
        </span>
      }
    />
  )
}

// The settings categories, in index order. Formerly the tab strip — which
// overflowed on a phone ("Notifications" clipped to "Notifica" with nothing
// hinting it scrolled) and, being pure chrome, told you nothing about your
// setup. As index rows they each carry a live value summary instead.
const CATEGORIES = ['General', 'Tasks', 'Labels', 'Integrations', 'Notifications', 'Data']

// Sub-page titles. Page ids are paths ('Tasks/impact'), so a category page's
// title is just its own name; only the leaves below need naming. Capped at one
// level of sub-page — §6's rule that anything deeper wants splitting instead.
const PAGE_TITLES = {
  'Tasks/impact': 'Impact dates',
  'Tasks/instructions': 'Custom instructions',
  'Data/devices': 'Devices',
  'Data/logs': 'Server logs',
  'Notifications/types': 'Event pings',
  'Notifications/digest': 'Morning digest',
  'Notifications/vacation': 'Away mode',
  'Notifications/crisis': 'Critical mode',
  'Notifications/links': 'Deep links',
  'Notifications/email': 'Email deliverability',
  'Notifications/test': 'Test channels',
  'Notifications/history': 'History',
  // One per integration. Duplicated from IntegrationsPanel's own list rather
  // than derived, because the page title has to resolve before that component
  // mounts — a page whose header says "Integrations/gcal" for a frame is worse
  // than a small, stable map.
  'Integrations/anthropic': 'Anthropic',
  'Integrations/openai': 'OpenAI',
  'Integrations/notion': 'Notion',
  'Integrations/trello': 'Trello',
  'Integrations/gcal': 'Google Calendar',
  'Integrations/reminders': 'Apple Reminders',
  'Integrations/gmail': 'Gmail',
  'Integrations/tracking': '17track',
  'Integrations/shippo': 'Shippo',
  'Integrations/weather': 'Weather',
  'Integrations/pushover': 'Pushover',
}

// All Settings tabs now have v2 implementations.

// Per-type opt-in pings that survived the 2026-07-24 digest reshape.
// Everything ambient (overdue/stale/nudge/size/pile-up/habit/suggestions)
// was deleted — informational content folds into the morning digest.
const NOTIF_TYPES = [
  { key: 'escalation', label: 'Escalation ladder nudges', desc: 'Tactic-aware follow-up pings for tasks with an active contact ladder, at each rung\'s own cadence.' },
]

const NOTIF_PACKAGE_TYPES = [
  { key: 'package_delivered', label: 'Package delivered', desc: 'Shipping carrier reports the package was delivered.' },
  { key: 'package_exception', label: 'Package exception', desc: 'Delivery issue or routing problem reported by carrier.' },
  { key: 'package_signature', label: 'Signature required', desc: 'Carrier reports the package needs a signature on delivery.' },
]

// Devices & security (auth Phase A) — the per-device token registry. Shows
// honest state: with the auth gate off (or no devices enrolled) it says so
// instead of rendering an empty list. This-device detection uses the locally
// stored boom_device_id.
// Native-only: run the App Attest flow (Phase B native half, BoomerangKit).
// With the server's verifier still an honest 501 stub, "server_pending" is the
// good outcome — it proves the whole native side works on this device.
function AppAttestCheck() {
  const [result, setResult] = useState(null) // null | 'running' | {outcome, detail}
  if (!isNativeShell()) return null

  const run = async () => {
    setResult('running')
    try {
      const { registerPlugin } = await import('@capacitor/core')
      const res = await registerPlugin('BoomerangNative').runAppAttest()
      setResult(res && res.outcome ? res : { outcome: 'failed', detail: 'No response from the native layer.' })
    } catch (e) {
      setResult({ outcome: 'failed', detail: e?.message || 'Native call unavailable (older app build?)' })
    }
  }

  return (
    <div className="v2-settings-row" style={{ alignItems: 'center' }}>
      <div className="v2-settings-row-text">
        <div className="v2-settings-row-label">App Attest</div>
        <div className="v2-settings-row-hint">
          {result === null && 'Hardware-backed device identity (Phase B). Run the check to test the native flow.'}
          {result === 'running' && 'Running attestation…'}
          {result && result !== 'running' && `${result.outcome}: ${result.detail}`}
        </div>
      </div>
      <button className="v2-settings-btn" disabled={result === 'running'} onClick={run}>
        {result && result !== 'running' ? 'Run again' : 'Run check'}
      </button>
    </div>
  )
}

function AuthDevicesBlock() {
  const [devices, setDevices] = useState(null) // null = loading, [] = none
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  let thisDeviceId = ''
  try { thisDeviceId = localStorage.getItem('boom_device_id') || '' } catch { /* ignore */ }

  const load = async () => {
    try {
      const api = await import('../api')
      setDevices(await api.getAuthDevices())
      setError(null)
    } catch (e) {
      setError(e?.message || 'Could not load devices')
      setDevices([])
    }
  }
  useEffect(() => { load() }, [])

  const act = async (id, fn) => {
    setBusyId(id)
    try {
      const api = await import('../api')
      await fn(api)
      await load()
    } catch (e) {
      setError(e?.message)
    } finally {
      setBusyId(null)
    }
  }

  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

  return (
    <div className="v2-settings-block">
      {error && <div className="v2-settings-row-hint" style={{ color: 'var(--v2-alert-high-pri)' }}>{error}</div>}
      {devices === null ? (
        <div className="v2-settings-row-hint">Loading…</div>
      ) : devices.length === 0 ? (
        <div className="v2-settings-row-hint">
          No devices enrolled. The native app enrolls itself on the Connection screen when auth is on;
          until then machines use the static API token. Spec: wiki → Auth-Device-Tokens.
        </div>
      ) : (
        devices.map(d => (
          <div key={d.device_id} className="v2-settings-row" style={{ alignItems: 'center' }}>
            <div className="v2-settings-row-text">
              <div className="v2-settings-row-label">
                {d.name}{d.device_id === thisDeviceId ? ' · this device' : ''}
                {d.revoked_at ? ` · revoked (${d.revoked_reason || 'manual'})` : ''}
              </div>
              <div className="v2-settings-row-hint">
                {d.platform} · enrolled {fmt(d.created_at)} · last seen {fmt(d.last_seen)} · {d.generation} rotation{d.generation === 1 ? '' : 's'}
              </div>
            </div>
            {d.revoked_at ? (
              <button className="v2-settings-btn" disabled={busyId === d.device_id}
                onClick={() => act(d.device_id, api => api.deleteAuthDevice(d.device_id))}>
                Remove
              </button>
            ) : (
              <button className="v2-settings-btn v2-settings-btn-danger" disabled={busyId === d.device_id}
                onClick={() => act(d.device_id, api => api.revokeAuthDevice(d.device_id))}>
                Revoke
              </button>
            )}
          </div>
        ))
      )}
      <AppAttestCheck />
    </div>
  )
}

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

// Mirrors AnthropicKeyBlock. Test = free GET /v1/models via the server
// (validates the key without spending tokens).
function OpenAIKeyBlock({ settings, update }) {
  const [envKey, setEnvKey] = useState(false)
  const [status, setStatus] = useState(null) // null | 'checking' | 'connected' | 'error'
  const [error, setError] = useState(null)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    import('../api').then(m => m.getKeyStatus()).then(keys => {
      if (!cancelled) setEnvKey(!!keys?.openai)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const runTest = async () => {
    setStatus('checking')
    setError(null)
    try {
      const api = await import('../api')
      const result = await api.testOpenAI()
      if (result?.status === 'connected') {
        setStatus('connected')
        setTimeout(() => setStatus(s => s === 'connected' ? null : s), 4000)
      } else {
        setStatus('error')
        setError(result?.detail || 'Connection failed — check your key')
      }
    } catch (e) {
      setStatus('error')
      setError(e?.message || 'Connection failed — check your key')
    }
  }

  const hasKey = envKey || !!settings.openai_api_key
  const summary = status === 'checking' ? 'Checking…'
    : status === 'connected' ? 'Connected ✓'
    : status === 'error' ? (error || 'Connection failed')
    : envKey ? 'Provided via env var'
    : settings.openai_api_key ? 'Key saved'
    : 'Not configured'
  const summaryClass = status === 'connected' ? 'v2-integrations-status-ok'
    : status === 'error' ? 'v2-integrations-error'
    : 'v2-integrations-hint'

  return (
    <>
      {envKey ? (
        <div className="v2-integrations-env">
          Provided via env var. Configure server-side; this field is read-only.
        </div>
      ) : (
        <>
          <input
            type={showKey ? 'text' : 'password'}
            className="v2-form-input"
            placeholder="sk-…"
            value={settings.openai_api_key || ''}
            onChange={e => { update('openai_api_key', e.target.value); setStatus(null) }}
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
            {settings.openai_api_key && (
              <button
                className="v2-settings-btn v2-settings-btn-danger"
                onClick={() => { update('openai_api_key', ''); setStatus(null) }}
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
}

function IntegrationsPanel({
  settings, update, setActiveTab, page, setPage,
  onTrelloSync, trelloSyncing, onNotionSync, notionSyncing, onGCalSync, gcalSyncing,
}) {
  const [envKeys, setEnvKeys] = useState({ anthropic: false, notion: false, trello: false, tracking: false })
  const [statuses, setStatuses] = useState({})
  // Apple Reminders. An integration, not a notification channel: it is a
  // two-way data sync with an external system, the same shape as Trello and
  // GCal. iOS owning the alarm is a consequence of the integration, not the
  // reason it lives somewhere else.
  const [remindersBusy, setRemindersBusy] = useState(false)
  const [remindersMsg, setRemindersMsg] = useState('')
  // Per-DEVICE, so localStorage rather than the settings blob: Reminders
  // access is granted on this phone, and syncing that fact to other devices
  // would be a lie. Component state alone reset on every remount, so a granted
  // and actively syncing integration reported "Not set".
  const [remindersGranted, setRemindersGranted] = useState(() => {
    try { return localStorage.getItem('boom_reminders_ok') === '1' } catch { return false }
  })
  const markRemindersOk = () => {
    setRemindersGranted(true)
    safeSetItem('boom_reminders_ok', '1')
  }
  const handleRemindersAccess = async () => {
    setRemindersBusy(true); setRemindersMsg('')
    const res = await requestRemindersAccess()
    // Granting access alone changes nothing visible, so sync immediately —
    // otherwise the button appears to do nothing at all.
    if (res.ok) {
      markRemindersOk()
      const s2 = await syncReminders({ silent: false })
      setRemindersMsg(s2.ok
        ? `Access granted. Synced${s2.imported ? ` — ${s2.imported} brought in` : ''}.`
        : `Access granted, but the sync failed: ${s2.error}`)
    } else {
      setRemindersMsg(res.error)
    }
    setRemindersBusy(false)
  }
  const handleRemindersSync = async () => {
    setRemindersBusy(true); setRemindersMsg('')
    const res = await syncReminders({ silent: false })
    if (res.ok) markRemindersOk()
    setRemindersMsg(res.ok
      ? `Synced — ${res.imported} brought in, ${res.linked} newly linked${res.unlinked ? `, ${res.unlinked} unlinked` : ''}.${res.held?.length ? ` ${res.held.length} item(s) held; see the console.` : ''}`
      : (res.error || 'Sync failed.'))
    setRemindersBusy(false)
  }
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
      key: 'openai',
      label: 'OpenAI',
      hint: 'Optional second AI provider — run the utility AI surfaces on GPT models (pick per tier in Settings \u2192 Tasks \u2192 AI models). Quokka and image/PDF analysis stay on Anthropic.',
      connected: envKeys.openai || !!settings.openai_api_key,
      inline: 'openai',
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
      key: 'reminders',
      label: 'Apple Reminders',
      hint: 'Tasks with a reminder time sync to a Boomerang list and iOS rings the alarm. Anything you add there, including with Siri, comes back as a task.',
      // Only ever offered in the native shell — EventKit does not exist in a
      // browser, and a row that can never connect is worse than no row.
      nativeOnly: true,
      connected: remindersGranted,
      sub: remindersGranted ? 'Syncing' : null,
      inline: 'reminders',
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
      key: 'shippo',
      label: 'Shippo (USPS tracking)',
      hint: 'USPS blocks third-party tracking since April 2026; Shippo is the USPS-authorized source. Without a token, USPS packages are link-out cards.',
      connected: envKeys.shippo || !!settings.shippo_api_token,
      inline: 'shippo',
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

  // Sub-page routing. Every integration used to be a name-toggle expander in
  // one long list — a whole parallel collapse implementation of its own, and
  // the reason this page was a wall of config. Each integration is a page now,
  // which also finally gives its nested sub-settings a legal home under the
  // one-level rule (a config block inside an expander inside a page was two
  // levels of hiding).
  const sub = page?.startsWith('Integrations/') ? page.slice('Integrations/'.length) : ''
  const isMain = !sub

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
      {/* Plain rows, not a framed card — the danger zone stays the ONE framed
          element in settings. */}
      <SettingsGroup>
        <ul className="v2-integrations-list">
          {integrations.filter(int => !int.nativeOnly || isNativeShell()).map(int => (
            <Fragment key={int.key}>
              {isMain && (
                // The WHOLE ROW is the target (§2), not a small trailing
                // control. The old row made only the integration's NAME
                // pressable — it was the expander toggle — which is exactly
                // how the hierarchy ended up inverted, with the label doing
                // the work and looking like chrome.
                <SettingRow
                  label={int.label}
                  info={int.hint}
                  onPress={() => setPage(`Integrations/${int.key}`)}
                  trailing={
                    <span className="v2-set-status">
                      <span
                        className={`v2-set-dot v2-set-dot-${int.connected === 'warn' ? 'warn' : int.connected ? 'ok' : 'off'}`}
                        aria-hidden="true"
                      />
                      <span className="v2-set-row-value">
                        {int.sub || (int.connected === 'warn' ? 'Needs attention' : int.connected ? 'Connected' : 'Not set')}
                      </span>
                      <ChevronRight size={16} strokeWidth={2} className="v2-set-row-chev" />
                    </span>
                  }
                />
              )}
              {sub === int.key && (<>
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
                {int.inline === 'reminders' && (
                  <div className="v2-integrations-inline">
                    <div className="v2-integrations-hint">
                      Set a reminder time on any task and it appears in a <strong>Boomerang</strong> list
                      in Apple Reminders, with a real alarm — so it reaches your Lock Screen, watch and
                      CarPlay without Boomerang sending a notification. The sync runs on launch and
                      whenever you reopen the app.
                    </div>
                    <div className="v2-integrations-hint" style={{ marginTop: 6 }}>
                      Needs <strong>Full Access</strong> to Reminders. iOS also offers a write-only
                      permission, which cannot read the list and so cannot sync anything back.
                    </div>
                    {remindersMsg && (
                      <div className="v2-integrations-hint" style={{ marginTop: 8 }}>{remindersMsg}</div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button className="v2-settings-btn" onClick={handleRemindersAccess} disabled={remindersBusy}>
                        {remindersBusy ? 'Working…' : 'Allow access'}
                      </button>
                      <button className="v2-settings-btn" onClick={handleRemindersSync} disabled={remindersBusy}>
                        Sync now
                      </button>
                    </div>
                  </div>
                )}
                {int.inline === 'anthropic' && (
                  <div className="v2-integrations-inline">
                    <AnthropicKeyBlock settings={settings} update={update} embedded />
                  </div>
                )}
                {int.inline === 'openai' && (
                  <div className="v2-integrations-inline">
                    <OpenAIKeyBlock settings={settings} update={update} />
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
                    {/* iOS universal links hijack the Notion consent page into
                      * the Notion APP (where the OAuth flow dies) whenever the
                      * app is installed. Private tabs don't fire universal
                      * links, so that's the reliable phone path. */}
                    {!statuses.notion?.mcpHealth?.connected && (
                      <div className="v2-integrations-hint" style={{ marginBottom: 8 }}>
                        📱 iPhone tip: if connecting bounces you into the Notion app, open this page in a
                        <strong> private tab</strong> (universal links are disabled there) or connect once
                        from a desktop browser — the connection lives on the server, so every device gets it.
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
                {int.inline === 'shippo' && (
                  <div className="v2-integrations-inline">
                    {envKeys.shippo ? (
                      <div className="v2-integrations-hint">Provided via env var (SHIPPO_API_TOKEN).</div>
                    ) : (
                      <input type="password" className="v2-form-input" placeholder="Shippo live API token (shippo_live_…)" value={settings.shippo_api_token || ''} onChange={e => update('shippo_api_token', e.target.value)} />
                    )}
                    <div className="v2-integrations-hint">Live token required — test tokens only track Shippo&apos;s mock carrier. Non-Shippo shipments bill per tracking number (~5¢).</div>
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
              </>)}
            </Fragment>
          ))}
        </ul>
      </SettingsGroup>

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

function NotificationsPanel({ settings, update, page, setPage }) {
  // Pushover link mode is server-side state with its own endpoint (NOT part of
  // the synced settings blob — the blob's last-writer-wins semantics let other
  // devices revert it; see /api/pushover/link-mode in server.js). null = not
  // loaded yet (toggle disabled until the fetch lands).
  // Local reminders. Unlike the Apple Reminders INTEGRATION (Settings →
  // Integrations), this is a Boomerang delivery surface — the device itself
  // rings — so it belongs with the other channels.
  const [localBusy, setLocalBusy] = useState(false)
  const [localMsg, setLocalMsg] = useState('')
  const [localPending, setLocalPending] = useState(null)
  useEffect(() => {
    if (!isNativeShell()) return
    let alive = true
    pendingLocalReminders().then(r => { if (alive) setLocalPending(r?.count ?? 0) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const handleLocalEnable = async () => {
    setLocalBusy(true); setLocalMsg('')
    const res = await requestLocalReminderPermission()
    if (!res.ok) { setLocalMsg(res.error); setLocalBusy(false); return }
    const r = await refreshLocalReminders(loadTasks(), loadRoutines(), { force: true })
    setLocalMsg(r.ok
      ? `Scheduled — ${r.repeating} repeating, ${r.once} one-off${r.dropped ? `, ${r.dropped} past the 64 iOS allows` : ''}.`
      : (r.error || 'Could not schedule.'))
    if (r.ok) setLocalPending(r.pending ?? null)
    setLocalBusy(false)
  }
  const [pushoverOpenNative, setPushoverOpenNative] = useState(null)
  useEffect(() => {
    let alive = true
    fetch('/api/pushover/link-mode')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive && d) setPushoverOpenNative(!!d.open_native) })
      .catch(() => { if (alive) setPushoverOpenNative(false) })
    return () => { alive = false }
  }, [])

  // The away window — also server-side with its own endpoint, same carve-out
  // reasoning and for a sharper reason: a reverted window resumes every
  // notification it was set to silence, while you are away and not looking.
  // null = not loaded (controls disabled until it lands, so a slow fetch can
  // never look like "off").
  const [vacation, setVacation] = useState(null)
  const [vacationErr, setVacationErr] = useState('')
  const loadVacation = useCallback(() => {
    fetch('/api/vacation')
      .then(r => readJson(r, 'The server'))
      .then(d => { setVacation(d); setVacationErr('') })
      // Distinguish "failed" from "off" — an unreachable server must not render
      // as a window that isn't running.
      .catch(e => setVacationErr(e.message || 'Could not load'))
  }, [])
  useEffect(() => { loadVacation() }, [loadVacation])

  // What the row says at rest. Never a bare "On": a window that is suppressing
  // has to name its dates, because "why did nothing nag me last week" must be
  // answerable from the settings index without opening anything.
  const vacationSummary = (() => {
    if (vacationErr) return 'Unavailable'
    if (!vacation) return ''
    if (!vacation.active) return 'Off'
    const fmt = (ymd) => {
      if (!ymd) return null
      // Parse as a local date — `new Date('2026-07-27')` is UTC midnight and
      // renders as the 26th west of Greenwich.
      const [y, m, d] = ymd.split('-').map(Number)
      return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }
    const from = fmt(vacation.started_at)
    const to = fmt(vacation.ends_at)
    if (vacation.expired) return `Ended ${to}`
    if (from && to) return `${from} – ${to}`
    if (from) return `Since ${from}`
    return 'On, open-ended'
  })()

  // The repair preview — which tasks came due inside the window. Refetched
  // whenever the window changes, because the candidate set is derived from it.
  // null = not loaded; the offer only renders once there is something to offer.
  const [repair, setRepair] = useState(null)
  const [repairBusy, setRepairBusy] = useState(false)
  const [repairDone, setRepairDone] = useState(null)
  const loadRepair = useCallback(() => {
    fetch('/api/vacation/repair')
      .then(r => r.ok ? r.json() : null)
      .then(d => setRepair(d))
      .catch(() => setRepair(null))
  }, [])
  useEffect(() => { if (page === 'Notifications/vacation') loadRepair() }, [page, loadRepair])

  const applyRepair = useCallback(() => {
    setRepairBusy(true)
    fetch('/api/vacation/repair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => {
        setRepairDone(d)
        loadRepair()
        // The tasks changed server-side; the next sync pull picks them up.
      })
      .catch(() => setRepairDone(null))
      .finally(() => setRepairBusy(false))
  }, [loadRepair])

  const saveVacation = useCallback((next) => {
    // Optimistic, but the server's derived away_now/expired always win on the
    // response — the client must never be the authority on whether it is
    // currently suppressing.
    setVacation(v => ({ ...(v || {}), ...next }))
    fetch('/api/vacation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { setVacation(d); setVacationErr(''); loadRepair() })
      .catch(e => { setVacationErr(e.message || 'Could not save'); loadVacation() })
  }, [loadVacation, loadRepair])

  // Native iOS push (APNs) — Phase 4. Only rendered in the native shell.
  // Status comes from the server; enabling runs the full permission →
  // APNs-register → server-register chain via src/nativePush.js.
  const [apnsStatus, setApnsStatus] = useState(null)
  const [apnsBusy, setApnsBusy] = useState(false)
  const [apnsMsg, setApnsMsg] = useState('')
  const refreshApnsStatus = useCallback(() => {
    // Identify this device (stored at register time) so the server can say
    // whether it's already registered — drives the ✓ button state below.
    let tokenQs = ''
    try {
      const t = localStorage.getItem('boom_apns_token')
      if (t) tokenQs = `?token=${encodeURIComponent(t)}`
    } catch { /* state check degrades to the stateless button */ }
    fetch(`/api/apns/status${tokenQs}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setApnsStatus(d) })
      .catch(() => {})
  }, [])
  useEffect(() => { refreshApnsStatus() }, [refreshApnsStatus])
  const handleEnableNativePush = async () => {
    setApnsBusy(true)
    setApnsMsg('')
    const { enableNativePush } = await import('../nativePush')
    const result = await enableNativePush()
    setApnsMsg(result.ok ? 'This device is registered for native notifications.' : result.error)
    setApnsBusy(false)
    refreshApnsStatus()
  }
  const handleApnsTest = async () => {
    setApnsBusy(true)
    setApnsMsg('')
    const r = await fetch('/api/apns/test', { method: 'POST' }).then(x => x.json()).catch(() => ({ success: false, error: 'request failed' }))
    setApnsMsg(r.success ? `Test sent to ${r.sent} device(s).` : r.error)
    setApnsBusy(false)
  }

  // Server-side channel truth: the web-push subscription registry + the
  // dev-instance engine muzzle. Both exist so ANY client can see and control
  // what the server will actually send — the phantom-PWA incident (duplicate
  // web-push + Pushover banners that no visible toggle explained, because the
  // stale Home-Screen PWA's subscription was invisible from the native app)
  // is the reason this is surfaced here.
  const [pushDevices, setPushDevices] = useState([])
  const [notifsMuzzled, setNotifsMuzzled] = useState(false)
  const loadPushDevices = useCallback(() => {
    fetch('/api/push/subscriptions')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setPushDevices(d.subscriptions || []) })
      .catch(() => {})
  }, [])
  useEffect(() => {
    loadPushDevices()
    fetch('/api/health')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setNotifsMuzzled(!!d.notifsMuzzled) })
      .catch(() => {})
  }, [loadPushDevices])
  const removePushDevice = async (id) => {
    await fetch(`/api/push/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    loadPushDevices()
  }
  const pushServiceName = (endpoint) => {
    try {
      const host = new URL(endpoint).hostname
      if (host.includes('push.apple.com')) return 'Apple device (Safari / Home-Screen PWA)'
      if (host.includes('googleapis.com') || host.includes('fcm')) return 'Chrome / Android'
      if (host.includes('mozilla')) return 'Firefox'
      return host
    } catch { return 'unknown service' }
  }

  // Channel master toggles. Pushover gates additionally on credentials being
  // present, but for the v2 panel we just toggle the boolean and show a hint.
  const masters = [
    { key: 'push_notifications_enabled', label: 'Push', hint: 'One channel, two delivery legs: web push to browsers/PWAs + native APNs to the iOS app. The per-type "Push" toggles below gate both.' },
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

  // Sub-page routing. The seven collapsed sections that used to live on this
  // one screen — all folded by default, which is how a settings page ends up
  // telling you nothing — are pages now. `openSections`, `isCollapsed`,
  // `toggleCollapsed` and the local `SectionHeader` are gone with them: that
  // was the largest of the seven parallel collapse implementations this
  // rebuild exists to delete.
  const sub = page?.startsWith('Notifications/') ? page.slice('Notifications/'.length) : ''
  const isMain = !sub
  return (
    <div className="v2-settings-form">
      {isMain && (<>
      {/* Dev-instance muzzle banner — this server never background-sends. */}
      {notifsMuzzled && (
        <div className="v2-settings-block" style={{ borderLeft: '3px solid var(--v2-accent, #F26640)' }}>
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Dev server — background notifications muzzled</div>
            <div className="v2-settings-row-hint">
              This instance never sends scheduled nags, digests, package or weather alerts, so it can't
              duplicate what production sends. Test buttons still work. Set DEV_NOTIFICATIONS=1 on the
              container to unmuzzle.
            </div>
          </div>
        </div>
      )}

      <SettingsGroup caption="Channels">

        {masters.map(m => (
          <ToggleRow
            key={m.key}
            label={m.label}
            info={m.hint}
            checked={settings[m.key] === true}
            onChange={e => update(m.key, e.target.checked)}
          />
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

        {/* Server-side subscription registry — every device the server will
          * actually web-push to, visible from ANY client. The native app
          * cannot see a stale Home-Screen PWA's subscription any other way;
          * removing it here is how you stop a device that "shows nothing
          * enabled" from still receiving web push. Rendered regardless of the
          * master toggle for exactly that reason. */}
        {pushDevices.length > 0 && (
          <div className="v2-settings-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
            <div className="v2-settings-row-text">
              <div className="v2-settings-row-label">Registered push devices ({pushDevices.length})</div>
              <div className="v2-settings-row-hint">
                Every live web-push subscription on the server. If a device keeps getting notifications
                nothing on it explains (e.g. an old Home-Screen PWA), remove it here.
              </div>
            </div>
            {pushDevices.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <div className="v2-settings-row-hint" style={{ flex: 1 }}>
                  {pushServiceName(d.endpoint)} · added {d.updated_at ? new Date(d.updated_at + 'Z').toLocaleDateString() : '—'}
                </div>
                <button className="v2-settings-btn v2-settings-btn-danger" onClick={() => removePushDevice(d.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Native iOS (APNs) — the second delivery leg of the Push channel
          * (Phase 4b): every notification type the engine computes goes to
          * registered native devices, and Apple web-push endpoints are
          * skipped when native lands so one phone never gets two banners.
          * Status + test are available from any client; Enable needs the
          * native shell (Capacitor bridge). */}
        {(isNativeShell() || apnsStatus?.configured) && (
          <div className="v2-settings-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
            <div className="v2-settings-row-text">
              <div className="v2-settings-row-label">Native iOS (APNs)</div>
              <div className="v2-settings-row-hint">
                Boomerang-branded banners — tapping one opens the native app. Rides the Push master and
                the per-type Push toggles above.
                {apnsStatus && !apnsStatus.configured && ` Server not configured yet (missing: ${apnsStatus.missing.join(', ')}).`}
                {apnsStatus?.configured && ` Server ready (${apnsStatus.env}) · ${apnsStatus.devices} device(s) registered.`}
                {apnsMsg && ` ${apnsMsg}`}
              </div>
              {apnsStatus?.configured && apnsStatus?.devices > 0 && settings.push_notifications_enabled !== true && (
                <div className="v2-settings-row-hint" style={{ color: 'var(--v2-danger, #c83a3a)', marginTop: 4 }}>
                  ⚠ The Push master above is OFF — native banners won't send for real notifications
                  until it's on. (Send test bypasses it.)
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {isNativeShell() && (
                apnsStatus?.this_device ? (
                  <button className="v2-settings-btn" disabled title="This device is registered — re-registration happens automatically on every launch">
                    ✓ Enabled on this device
                  </button>
                ) : (
                  <button className="v2-settings-btn" onClick={handleEnableNativePush} disabled={apnsBusy}>
                    {apnsBusy ? 'Working…' : 'Enable on this device'}
                  </button>
                )
              )}
              <button className="v2-settings-btn" onClick={handleApnsTest} disabled={apnsBusy || !apnsStatus?.configured}>
                Send test
              </button>
            </div>
          </div>
        )}
        {isNativeShell() && (
          <div className="v2-settings-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
            <div className="v2-settings-row-text">
              <div className="v2-settings-row-label">Reminder alarms (on this device)</div>
              <div className="v2-settings-row-hint">
                Tasks with a reminder time, and loops set to remind, are scheduled as local
                alarms on this phone. They ring with <strong>no network, no VPN and no server</strong> —
                the phone fires them itself. iOS allows 64 pending at once; a repeating loop
                costs one of those no matter how far ahead it runs.
                {localPending != null && ` Currently ${localPending} scheduled.`}
                {localMsg && ` ${localMsg}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="v2-settings-btn" onClick={handleLocalEnable} disabled={localBusy}>
                {localBusy ? 'Working…' : 'Enable + refresh'}
              </button>
            </div>
          </div>
        )}

        {apnsStatus?.configured && apnsStatus?.devices > 0 && (
          <div className="v2-settings-row">
            <div className="v2-settings-row-text">
              <div className="v2-settings-row-label">Also send Apple web push alongside native</div>
              <div className="v2-settings-row-hint">
                Off (default): with a native device registered, pushes to Apple web-push endpoints
                (Safari / Home-Screen PWA) are skipped so the same phone isn't notified twice. Turn on
                only if you rely on a separate Apple device's PWA (e.g. an iPad or Mac Safari) that
                doesn't run the native app. Desktop Chrome/Firefox always receive either way.
              </div>
            </div>
            <Toggle
              checked={settings.push_web_alongside_native === true}
              onChange={e => update('push_web_alongside_native', e.target.checked)}
            />
          </div>
        )}
      </SettingsGroup>

      </>)}

      {sub === 'types' && (<>
      <p className="v2-set-page-intro">
        The morning digest is the one scheduled notification. These are the deliberate
        exceptions: event-driven package updates, Quokka plan-ready, and the per-task
        opt-ins — Critical mode, escalation ladders, and the per-task Remind-me toggle.
      </p>
      <SettingsGroup>
        {(() => {
          const offMasters = masters.filter(m => settings[m.key] !== true).map(m => m.label)
          return offMasters.length === 0 ? null : (
            <div className="v2-settings-row-hint" style={{ marginBottom: 10 }}>
              {offMasters.join(' + ')} column{offMasters.length > 1 ? 's are' : ' is'} locked because
              {offMasters.length > 1 ? ' those channels are' : ' that channel is'} off — flip the master
              in Channels above to edit {offMasters.length > 1 ? 'them' : 'it'}.
            </div>
          )
        })()}
        <div className="v2-notif-cards">
          {NOTIF_TYPES.map(t => (
            <div key={t.key} className="v2-notif-card">
              <div className="v2-notif-card-head">
                <div className="v2-notif-card-text">
                  <div className="v2-notif-card-label">{t.label}</div>
                  {t.desc && <div className="v2-notif-card-hint">{t.desc}</div>}
                </div>
                {t.freqKey && (
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
                )}
              </div>
              <div className="v2-notif-card-channels">
                {[
                  { key: 'push', master: 'push_notifications_enabled', defaultOn: true },
                  { key: 'email', master: 'email_notifications_enabled', defaultOn: true },
                  { key: 'pushover', master: 'pushover_notifications_enabled', defaultOn: true },
                ].map(c => (
                  <label key={c.key} className={`v2-notif-card-channel${settings[c.master] !== true ? ' v2-notif-card-channel-disabled' : ''}`}>
                    {/* Display is master-gated: a toggle must never LOOK on
                      * when its channel master means nothing will send. */}
                    <Toggle
                      checked={settings[c.master] === true && (c.defaultOn ? settings[`${c.key}_notif_${t.key}`] !== false : settings[`${c.key}_notif_${t.key}`] === true)}
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
                      checked={settings[c.master] === true && settings[`${c.key}_notif_${t.key}`] !== false}
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
                  checked={settings.push_notifications_enabled === true && settings.push_notif_quokka_plan_ready !== false}
                  onChange={e => update('push_notif_quokka_plan_ready', e.target.checked)}
                  disabled={settings.push_notifications_enabled !== true}
                />
                <span className="v2-notif-card-channel-label">Push</span>
              </label>
            </div>
          </div>
        </div>
      </SettingsGroup>
      </>)}

      {isMain && (<>
      {/* Plain rows, not a framed card. The danger zone is meant to be the ONE
          framed element in settings — a second frame here would have quietly
          made that claim false. Dependent rows dim rather than vanish. */}
      <SettingsGroup caption="Quiet hours">
        <ToggleRow
          label="Quiet hours"
          info="Suppress most notifications during this window. Tasks tagged with the bypass label still wake you."
          checked={!!settings.quiet_hours_enabled}
          onChange={e => update('quiet_hours_enabled', e.target.checked)}
        />
        <SettingRow
          label="From"
          disabled={!settings.quiet_hours_enabled}
          trailing={
            <input
              type="time"
              className="v2-form-input v2-settings-time-input"
              aria-label="Quiet hours start"
              value={settings.quiet_hours_start || '22:00'}
              onChange={e => update('quiet_hours_start', e.target.value)}
            />
          }
        />
        <SettingRow
          label="Until"
          disabled={!settings.quiet_hours_enabled}
          trailing={
            <input
              type="time"
              className="v2-form-input v2-settings-time-input"
              aria-label="Quiet hours end"
              value={settings.quiet_hours_end || '08:00'}
              onChange={e => update('quiet_hours_end', e.target.value)}
            />
          }
        />
        <SettingRow
          label="Bypass label"
          info="Tasks with this tag wake you even during quiet hours."
          disabled={!settings.quiet_hours_enabled}
          trailing={
            <input
              className="v2-form-input v2-settings-compact-input v2-settings-compact-input-wide"
              type="text"
              aria-label="Bypass label"
              value={settings.quiet_hours_bypass_label || 'wake-me'}
              onChange={e => update('quiet_hours_bypass_label', e.target.value)}
            />
          }
        />
      </SettingsGroup>

      {/* Everything below used to be a collapsed section on this same page —
          seven of them, all folded by default, which is how a settings screen
          ends up telling you nothing. They are pages now: the row says what
          it is set to, and you go there only when you mean to. */}
      <SettingsGroup caption="More">
        {/* A per-type x per-channel MATRIX, deliberately still a grid rather
            than rows. Rows are one-dimensional and this data is two — five
            types against three channels — so flattening it would mean five
            captions and fifteen toggle rows to say what a grid says in one
            glance. On its own page the length is no longer the problem it was
            when it sat collapsed on the main screen. Flagged as a call worth
            revisiting if the grid reads badly on a narrow phone. */}
        <NavRow
          label="Event pings"
          onPress={() => setPage('Notifications/types')}
          info="Per-type, per-channel switches for the deliberate exceptions to the digest."
        />
        <NavRow
          label="Morning digest"
          summary={settings.push_digest_enabled !== false || settings.email_digest_enabled === true ? 'On' : 'Off'}
          onPress={() => setPage('Notifications/digest')}
          info="The one scheduled notification of the day: today's three, a ten-minute nudge, gentle returns, snoozes landing today, Monday pool health, then weather and recap in the expanded view."
        />
        {/* Sits directly under the digest because it is the thing that silences
            it. Its summary states the suppression rather than reading "On" —
            invisible muting is this feature's whole hazard, so the row has to
            say what it is doing without being opened. */}
        <NavRow
          label="Away mode"
          summary={vacationSummary}
          onPress={() => setPage('Notifications/vacation')}
          info="Stops due dates and nags while you're away, and freezes the streak. Critical tasks still get through. Can be set for dates that have already passed."
        />
        <NavRow
          label="Critical mode"
          summary={settings.crisis_enabled === true ? 'On' : 'Off'}
          onPress={() => setPage('Notifications/crisis')}
          info="Tasks tagged critical get the most aggressive nag path in the app, plus a pinned section and an auto-drafted triage checklist. Pushover escalates to Emergency once a critical task is overdue or 24h old."
        />
        <NavRow
          label="Deep links"
          summary={settings.public_app_url ? 'Set' : 'Not set'}
          onPress={() => setPage('Notifications/links')}
          info="Where notification taps land — the public URL used by web push, Pushover, email and the digest, plus native-app link routing."
        />
        <NavRow
          label="Email deliverability"
          summary={settings.email_address ? 'Set' : 'Not set'}
          onPress={() => setPage('Notifications/email')}
          info="Recipient, From header overrides for SPF/DKIM/DMARC, and batch mode."
        />
        <NavRow
          label="Test channels"
          onPress={() => setPage('Notifications/test')}
          info="Send a one-off notification through each channel to verify it works. Test buttons obey the channel masters and Pushover credentials."
        />
        <NavRow
          label="History"
          summary={history ? `${history.length} entr${history.length === 1 ? 'y' : 'ies'}` : ''}
          onPress={() => { setHistoryOpen(true); setPage('Notifications/history') }}
        />
      </SettingsGroup>
      </>)}

      {sub === 'digest' && (<>
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Push digest</div>
            <div className="v2-settings-row-hint">Delivers via the Push channel — native banner on the iOS app, web push on subscribed browsers. Requires the Push master.</div>
          </div>
          <Toggle
            checked={settings.push_notifications_enabled === true && settings.push_digest_enabled !== false}
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
            checked={settings.email_notifications_enabled === true && settings.email_digest_enabled === true}
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
            checked={settings.pushover_notifications_enabled === true && settings.pushover_digest_enabled === true}
            onChange={e => update('pushover_digest_enabled', e.target.checked)}
            disabled={settings.pushover_notifications_enabled !== true}
          />
        </div>
        <div className="v2-settings-row" style={{ marginTop: 8 }}>
          <div className="v2-settings-row-text">
            <label className="v2-settings-row-label">Delivery time</label>
            <div className="v2-settings-row-hint">Your local morning (uses your timezone setting). If the server is down at this time, the digest sends on recovery before noon — after noon the day is skipped.</div>
          </div>
          <input type="time" className="v2-form-input v2-settings-time-input" value={settings.digest_time || '07:00'} onChange={e => update('digest_time', e.target.value)} />
        </div>
      </>)}

      {sub === 'vacation' && (<>
        {/* persistentInfo rather than folded ⓘ: this row silences the app, and
            §1.5 reserves always-visible descriptions for exactly that. */}
        <SettingsGroup>
          <SettingRow
            as="label"
            label="Away"
            persistentInfo={
              vacation?.away_now
                ? 'Suppressing now. Due dates and nags are held; critical tasks still get through; the streak is frozen.'
                : 'Holds due dates and nags while the window is open, freezes the streak, and lets critical tasks through.'
            }
            trailing={
              <Toggle
                checked={!!vacation?.active}
                // Disabled until the fetch lands, so a slow or failed load can
                // never present itself as a window that is switched off.
                disabled={!vacation && !vacationErr}
                onChange={e => saveVacation({
                  active: e.target.checked,
                  started_at: vacation?.started_at || null,
                  ends_at: vacation?.ends_at || null,
                  note: vacation?.note || '',
                })}
              />
            }
          />
          {vacationErr && (
            <StatusRow label="Away window" value="Unavailable" mono={false} dot="warn" detail={vacationErr} />
          )}
          {vacation?.away_now && (
            <StatusRow
              label="Suppressing"
              mono={false}
              dot="ok"
              value={vacation.days ? `${vacation.days} day${vacation.days === 1 ? '' : 's'}` : 'today'}
            />
          )}
          {vacation?.expired && (
            <StatusRow label="Window ended" value="Switch Away off, or extend it" mono={false} dot="warn" />
          )}
        </SettingsGroup>

        {/* The repair — the half that removes the date surgery. Renders only
            when there is something to move, and states exactly what it will do
            before doing it. Provenance is stamped server-side, so any moved
            date can always answer "did I set this or did the system?". */}
        {(repair?.count > 0 || repairDone) && (
          <SettingsGroup caption="While you were away">
            {repair?.count > 0 && (<>
              <SettingRow
                label={`${repair.count} task${repair.count === 1 ? '' : 's'} came due`}
                persistentInfo={`${repair.candidates.slice(0, 4).map(c => c.title).join(', ')}${repair.count > 4 ? '…' : ''}`}
                value={`${repair.window?.started_at || ''} – ${repair.window?.ends_at || 'now'}`}
              />
              <ActionRow info="Moves their due dates to today, keeping the original date on each task. Tasks you already rescheduled by hand are left alone, and critical tasks were never held.">
                <button
                  type="button"
                  className="v2-settings-btn"
                  disabled={repairBusy}
                  onClick={applyRepair}
                >
                  {repairBusy ? 'Moving…' : 'Move to today'}
                </button>
              </ActionRow>
            </>)}
            {repairDone && repair?.count === 0 && (
              <StatusRow label="Repaired" value={`${repairDone.moved} moved to today`} mono={false} dot="ok" />
            )}
          </SettingsGroup>
        )}

        <SettingsGroup caption="The trip">
          <div className="v2-settings-row">
            <div className="v2-settings-row-text">
              <label className="v2-settings-row-label">First day away</label>
              <div className="v2-settings-row-hint">Both days are included. A date in the past is fine — set it after you get back and the window still covers the trip.</div>
            </div>
            <input
              className="v2-form-input v2-settings-compact-input"
              type="date"
              value={vacation?.started_at || ''}
              disabled={!vacation}
              onChange={e => saveVacation({
                active: vacation?.active ?? true,
                started_at: e.target.value || null,
                ends_at: vacation?.ends_at || null,
                note: vacation?.note || '',
              })}
            />
          </div>
          <div className="v2-settings-row">
            <div className="v2-settings-row-text">
              <label className="v2-settings-row-label">Last day away</label>
              <div className="v2-settings-row-hint">Leave empty for open-ended — nothing expires it but you.</div>
            </div>
            <input
              className="v2-form-input v2-settings-compact-input"
              type="date"
              value={vacation?.ends_at || ''}
              disabled={!vacation}
              min={vacation?.started_at || undefined}
              onChange={e => saveVacation({
                active: vacation?.active ?? true,
                started_at: vacation?.started_at || null,
                ends_at: e.target.value || null,
                note: vacation?.note || '',
              })}
            />
          </div>
          <div className="v2-settings-row">
            <div className="v2-settings-row-text">
              <label className="v2-settings-row-label">Where</label>
              <div className="v2-settings-row-hint">Just a note to yourself. Never interpreted.</div>
            </div>
            <input
              className="v2-form-input v2-settings-compact-input v2-settings-compact-input-wide"
              type="text"
              placeholder="Wisconsin"
              value={vacation?.note || ''}
              disabled={!vacation}
              onChange={e => setVacation(v => ({ ...(v || {}), note: e.target.value }))}
              onBlur={e => saveVacation({
                active: vacation?.active ?? false,
                started_at: vacation?.started_at || null,
                ends_at: vacation?.ends_at || null,
                note: e.target.value,
              })}
            />
          </div>
        </SettingsGroup>
      </>)}

      {sub === 'crisis' && (<>
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

      {sub === 'links' && (<>
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
        <div className="v2-settings-row">
          <div className="v2-settings-row-text">
            <div className="v2-settings-row-label">Open Pushover links in the iOS app</div>
            <div className="v2-settings-row-hint">Pushover links open the native Boomerang app (boomerang:// deep link) instead of the web app in Safari. Stored on the server directly — this one can't be reverted by other devices syncing.</div>
          </div>
          <Toggle
            checked={pushoverOpenNative === true}
            disabled={pushoverOpenNative === null}
            onChange={e => {
              const next = e.target.checked
              setPushoverOpenNative(next)
              fetch('/api/pushover/link-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ open_native: next }),
              }).then(r => r.ok ? r.json() : null)
                .then(d => { if (d) setPushoverOpenNative(!!d.open_native) })
                .catch(() => setPushoverOpenNative(v => !v)) // revert optimistic state on failure
            }}
          />
        </div>
      </>)}

      {sub === 'email' && (<>
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
      </>)}

      {sub === 'test' && (<>
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

      {sub === 'history' && (<>
      <div className="v2-settings-block">
        {(
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
      </>)}

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
  // Page identity for the settings stack. 'index' is the root; any other
  // value is a category page. Component state only — never persisted, because
  // the settings blob is last-writer-wins and UI chrome must not ride it.
  const [page, setPage] = useState('index')
  // What the SERVER says is connected, for the Integrations index summary.
  // Deliberately the same two sources IntegrationsPanel reads — env key flags
  // and each integration's own status — so the summary can never disagree
  // with the page it points at. A settings-only check would be wrong here:
  // on this deployment the credentials come from env and the OAuth tokens
  // live server-side, so the row would render blank on the exact machine the
  // feature is built for. The panel keeps its own copy for now; the
  // duplication collapses when that panel converts.
  const [connStatus, setConnStatus] = useState(null)
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
  const [serverVersion, setServerVersion] = useState('')
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
      .then(r => readJson(r, 'The server'))
      .then(d => {
        if (!alive || !d) return
        setIsDev(!!d.isDev)
        setServerVersion(d.appVersion || 'unknown')
      })
      // A swallowed failure left this row on its '…' placeholder forever, so
      // "can't reach the server" and "still loading" rendered identically —
      // on the one row whose entire job is to tell you what you're talking to.
      .catch(() => { if (alive) setServerVersion('unreachable') })
    return () => { alive = false }
  }, [open])

  // The tier pickers used to render the catalog COMPILED INTO this bundle, so
  // a newly released model was invisible until someone edited the array and
  // shipped a build. /api/ai/models asks the configured providers instead.
  // The bundled catalog stays the initial value and the fallback: a failed
  // discovery must leave a usable picker, not an empty one.
  const [modelCatalog, setModelCatalog] = useState(AI_MODEL_CATALOG)
  useEffect(() => {
    if (!open) return
    let alive = true
    fetch('/api/ai/models')
      .then(r => readJson(r, 'The server'))
      .then(d => { if (alive && d?.models?.length) setModelCatalog(d.models) })
      .catch(() => { /* bundled catalog stands — never an empty picker */ })
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

  // Index summaries. Every one is a VALUE — never prose about what lives
  // inside. That is the whole reason the index beats the tab strip it
  // replaces: the root screen answers "what's my setup?" at a glance instead
  // of being pure navigation chrome.
  //
  // The one summary that can't come from local state is Integrations, so it
  // resolves asynchronously (design language §2.4, as amended): empty while in
  // flight, never a spinner, never a placeholder. Every failure is swallowed —
  // a settings screen must open whether or not the server answers.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([
      import('../api').then(m => m.getKeyStatus()).catch(() => ({})),
      import('../api').then(m => m.notionStatus()).catch(() => null),
      import('../api').then(m => m.trelloStatus()).catch(() => null),
      import('../api').then(m => m.gcalStatus()).catch(() => null),
      import('../api').then(m => m.gmailStatus()).catch(() => null),
      // Device count feeds the Data page's Devices row. Fetched here with the
      // rest rather than lifted out of AuthDevicesBlock, so that component
      // stays self-contained and the row still gets a real value.
      import('../api').then(m => m.getAuthDevices()).catch(() => null),
    ]).then(([keys, notion, trello, gcal, gmail, devices]) => {
      if (!cancelled) setConnStatus({ keys: keys || {}, notion, trello, gcal, gmail, devices })
    }).catch(() => { /* summary stays empty; never blocks the surface */ })
    return () => { cancelled = true }
  }, [open])

  const summaries = useMemo(() => {
    if (!open) return {}
    const theme = settings.theme || 'light'
    const family = theme.startsWith('kept') ? 'Kept' : 'Standard'
    const mode = theme.endsWith('system') ? 'System' : theme.endsWith('dark') ? 'Dark' : 'Light'

    const labelCount = loadLabels().length
    const taskCount = loadTasks().length

    // Mirrors IntegrationsPanel's own `connected` predicates, integration for
    // integration. If one of those changes, this must change with it — a
    // summary that disagrees with its destination is worse than no summary.
    const c = connStatus
    const connected = []
    if (c?.notion?.connected || c?.notion?.mcpHealth?.connected) connected.push('Notion')
    if (c?.trello?.connected) connected.push('Trello')
    if (c?.gcal?.connected) connected.push('GCal')
    if (c?.gmail?.connected) connected.push('Gmail')
    if (c?.keys?.tracking || settings.tracking_api_key) connected.push('17track')
    if (settings.weather_enabled && settings.weather_latitude) connected.push('Weather')

    // `=== true`, matching NotificationsPanel's own gate — push_notifications_
    // enabled has no store default, so it is undefined until first opted in.
    const channels = []
    if (settings.push_notifications_enabled === true) channels.push('Push')
    if (settings.email_notifications_enabled === true) channels.push('Email')
    if (settings.pushover_notifications_enabled === true) channels.push('Pushover')

    const DOT = '\u00b7'
    return {
      General: `${family} ${DOT} ${mode}`,
      Tasks: `Due +${settings.default_due_days ?? 7}d ${DOT} Stale ${settings.staleness_days ?? 7}d`,
      Labels: labelCount ? `${labelCount} label${labelCount === 1 ? '' : 's'}` : 'None yet',
      // Empty ONLY while the status fetch is in flight (or it failed). Once
      // it resolves the row always shows a value, including "None" — the
      // amended §2.4 rule allows a summary to arrive late, not to never
      // arrive. Three names fit the row; a fourth would be eaten by the
      // ellipsis, so the overflow surfaces as a count instead of vanishing.
      Integrations: !connStatus
        ? ''
        : connected.length
          ? connected.slice(0, 3).join(` ${DOT} `) + (connected.length > 3 ? ` +${connected.length - 3}` : '')
          : 'None',
      Notifications: channels.length ? channels.join(` ${DOT} `) : 'Off',
      Data: `${taskCount} task${taskCount === 1 ? '' : 's'}`,
    }
  }, [open, settings, connStatus])

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Settings"
      width="wide"
      headerSlot={<AutosaveIndicator saved={justSaved} />}
    >
      <SettingsNav page={page}>
      {page === 'index' ? (
        <SettingsPage>
          <SettingsGroup>
            {CATEGORIES.map(tab => (
              <NavRow
                key={tab}
                label={tab}
                summary={summaries[tab]}
                onPress={() => setPage(tab)}
              />
            ))}
          </SettingsGroup>
        </SettingsPage>
      ) : (
      <SettingsPage
        title={PAGE_TITLES[page] || page}
        backLabel={page.includes('/') ? page.split('/')[0] : 'Settings'}
        onBack={() => setPage(page.includes('/') ? page.split('/')[0] : 'index')}
      >
      <div className="v2-settings-content">

        {page === 'General' && (
          <div className="v2-settings-form">
            <SettingsGroup caption="Appearance">
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
                  {/* The marketing copy that used to sit under this label
                      ("warm Smoke/Linen canvases with ember + gold, arcs not
                      grids") is deleted rather than folded: you can see both
                      themes by tapping them, so prose describing them is
                      pure cost. */}
                  {/* Stacked for the same reason Mode is: the segment is
                      width:100% up to 320px, which leaves nothing for a label
                      beside it at phone width — §2.3's "when the options can't
                      fit beside the label". Inline, it overlapped. */}
                  <SegmentRow
                    label="Theme"
                    value={family}
                    options={[
                      { value: 'standard', label: 'Standard' },
                      { value: 'kept', label: 'Kept' },
                    ]}
                    onChange={v => setTheme(v, mode)}
                    stacked
                  />
                  <SegmentRow
                    label="Mode"
                    value={mode}
                    options={[
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                      { value: 'system', label: 'System' },
                    ]}
                    onChange={v => setTheme(family, v)}
                    stacked
                  />
                </>
              )
            })()}
            </SettingsGroup>

            <SettingsGroup caption="Home screen">
              <ToggleRow
                label="Show 7-day strip"
                checked={settings.show_week_strip}
                onChange={e => update('show_week_strip', e.target.checked)}
                info="Calendar row above the task list with activity intensity per day. Tap the date in the home stats line to show or hide it."
              />
              {/* Dependent rows DIM rather than disappear, so the relationship
                  between the parent toggle and this one stays visible instead
                  of being a mystery. */}
              <ToggleRow
                label="Open strip by default"
                checked={settings.week_strip_always_open}
                onChange={e => update('week_strip_always_open', e.target.checked)}
                disabled={!settings.show_week_strip}
                info="Show the strip expanded when the app loads. Tap the date in the home stats line any time to hide or re-open it."
              />
              <SettingRow
                label="Daily task goal"
                info="Used by the progress bar and the activity intensity on the 7-day strip."
                trailing={
                  <input
                    className="v2-form-input v2-settings-compact-input"
                    type="number"
                    min="1"
                    max="50"
                    aria-label="Daily task goal"
                    value={settings.daily_task_goal ?? 3}
                    onChange={e => update('daily_task_goal', parseInt(e.target.value) || 1)}
                  />
                }
              />
            </SettingsGroup>

            <SettingsGroup caption="About">
              {/* These two genuinely differ in the native shell, which is why
                  the explanation earns its ⓘ rather than being deleted. */}
              <StatusRow
                label="App build"
                info="The bundle this client is running — in the native app, what Xcode installed; on the web, what the server served."
                value={
                  <code
                    className="v2-settings-build"
                    onClick={handleBuildTap}
                    role="button"
                    tabIndex={-1}
                  >{__APP_VERSION__}</code>
                }
              />
              <StatusRow
                label="Server version"
                info="Live from the connected server's /api/health — what is actually deployed there right now. In the native app these two are DIFFERENT builds; they only match on the web."
                value={<code className="v2-settings-build">{serverVersion || '…'}</code>}
              />
            </SettingsGroup>
          </div>
        )}

        {page === 'Tasks' && (
          <div className="v2-settings-form">
            <SettingsGroup caption="Behavior">
              <NumberRow
                label="Default due date"
                info="Days from now. 0 means no default — tasks ship without a due date unless you pick one."
                unit="days"
                min={0} max={90}
                value={settings.default_due_days ?? 7}
                onChange={v => update('default_due_days', v || 0)}
              />
              <NumberRow
                label="Staleness threshold"
                info="Days of inactivity before a task counts as stale. Drives the Stale section on the task list AND the Stale notification type."
                unit="days"
                min={1} max={30}
                value={settings.staleness_days ?? 7}
                onChange={v => update('staleness_days', v || 1)}
              />
              {/* No hint: "snoozes" already says what the number counts. */}
              <NumberRow
                label="Reframe after"
                unit="snoozes"
                min={1} max={20}
                value={settings.reframe_threshold ?? 3}
                onChange={v => update('reframe_threshold', v || 1)}
              />
              <ToggleRow
                label="DIY reality check"
                checked={settings.diy_reality_check !== false}
                onChange={e => update('diy_reality_check', e.target.checked)}
                info="Repair and construction-shaped tasks get a blunt “DIY or hire it out?” verdict — hire-out by default. A hire verdict switches that task's reminders to push the call instead of the repair. Override per task in the edit modal."
              />
            </SettingsGroup>

            <SettingsGroup caption="Impact dates">
              <NavRow
                label="Impact dates"
                summary={(settings.impact_dates || []).length
                  ? `${(settings.impact_dates || []).length} date${(settings.impact_dates || []).length === 1 ? '' : 's'}`
                  : 'None'}
                onPress={() => setPage('Tasks/impact')}
                info="Events that make related work more urgent as they approach — a holiday, a visit, a trip."
              />
            </SettingsGroup>

            <SettingsGroup caption="AI">
              {/* The summary is Set/Off, never the prose. A row at rest shows
                  its VALUE — the instructions themselves live on the page. */}
              <NavRow
                label="Custom instructions"
                summary={settings.custom_instructions?.trim() ? 'Set' : 'Off'}
                onPress={() => setPage('Tasks/instructions')}
              />
              {[
                { key: 'ai_model_workhorse', label: 'Workhorse model', def: AI_TIER_DEFAULTS.workhorse,
                  info: 'Classification, inference, polish and scans. OpenAI models need a key under Settings → Integrations.' },
                { key: 'ai_model_quick', label: 'Quick model', def: AI_TIER_DEFAULTS.quick,
                  info: 'One-liners and AI search. Quokka and image/PDF analysis always use Anthropic.' },
              ].map(({ key, label, def, info }) => {
                const known = modelCatalog.some(m => m.id === (settings[key] || def))
                return (
                  <Fragment key={key}>
                    <ValueRow
                      label={label}
                      info={info}
                      trailing={
                        <select
                          className="v2-form-input v2-settings-inline-select"
                          aria-label={label}
                          value={known ? (settings[key] || def) : '__custom'}
                          onChange={e => update(key, e.target.value === '__custom' ? `anthropic:${settings[key] || def}` : e.target.value)}
                        >
                          {[
                            ['anthropic', 'Anthropic'],
                            ['openai', 'OpenAI'],
                          ].map(([prov, provLabel]) => {
                            const rows = modelCatalog.filter(m => m.provider === prov)
                            if (!rows.length) return null
                            return (
                              <optgroup key={prov} label={provLabel}>
                                {rows.map(m => (
                                  <option key={m.id} value={m.id}>{m.label}{m.id === def ? ' (default)' : ''}</option>
                                ))}
                              </optgroup>
                            )
                          })}
                          <option value="__custom">Custom…</option>
                        </select>
                      }
                    />
                    {!known && (
                      <SettingRow
                        label="Custom model id"
                        trailing={
                          <input
                            type="text"
                            className="v2-form-input"
                            aria-label={`${label} custom id`}
                            placeholder="provider:model-id"
                            value={settings[key] || ''}
                            onChange={e => update(key, e.target.value)}
                          />
                        }
                      />
                    )}
                  </Fragment>
                )
              })}
            </SettingsGroup>
          </div>
        )}

        {/* Sub-page: one row per event instead of five inputs crammed into a
            wrapping flexbox. */}
        {page === 'Tasks/impact' && (
          <div className="v2-settings-form">
            <p className="v2-set-page-intro">
              Events that make related work more urgent as they approach. Tasks sharing an
              event's label rank higher in Impact sort and Today ordering during the lead-up.
              Quokka can edit these too — “add an impact date for Christmas”.
            </p>
            <SettingsGroup>
              {(settings.impact_dates || []).map(ev => (
                <div key={ev.id} className="v2-set-impact">
                  <div className="v2-set-impact-top">
                    <input
                      className="v2-form-input"
                      type="text"
                      aria-label="Event name"
                      placeholder="Christmas"
                      value={ev.label || ''}
                      onChange={e => update('impact_dates', (settings.impact_dates || []).map(x => x.id === ev.id ? { ...x, label: e.target.value } : x))}
                    />
                    <button
                      className="v2-settings-btn v2-settings-btn-danger"
                      onClick={() => update('impact_dates', (settings.impact_dates || []).filter(x => x.id !== ev.id))}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="v2-set-impact-fields">
                    <label>
                      <span>Date</span>
                      <input
                        className="v2-form-input"
                        type="date"
                        value={ev.date || ''}
                        onChange={e => update('impact_dates', (settings.impact_dates || []).map(x => x.id === ev.id ? { ...x, date: e.target.value } : x))}
                      />
                    </label>
                    <label>
                      <span>Lead days</span>
                      <input
                        className="v2-form-input"
                        type="number" min="1" max="90"
                        value={ev.lead_days ?? 14}
                        onChange={e => update('impact_dates', (settings.impact_dates || []).map(x => x.id === ev.id ? { ...x, lead_days: parseInt(e.target.value, 10) || 14 } : x))}
                      />
                    </label>
                    <label>
                      <span>Label</span>
                      <select
                        className="v2-form-input"
                        value={ev.tag || ''}
                        onChange={e => update('impact_dates', (settings.impact_dates || []).map(x => x.id === ev.id ? { ...x, tag: e.target.value || null } : x))}
                      >
                        <option value="">No label</option>
                        {loadLabels().map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              ))}
              <ActionRow>
                <button
                  className="v2-settings-btn"
                  onClick={() => update('impact_dates', [...(settings.impact_dates || []), { id: uuid(), label: '', date: '', lead_days: 14, tag: null }])}
                >
                  <Plus size={13} strokeWidth={1.75} /> Add impact date
                </button>
              </ActionRow>
            </SettingsGroup>
          </div>
        )}

        {page === 'Tasks/instructions' && (
          <div className="v2-settings-form">
            <p className="v2-set-page-intro">
              How should the AI talk to you? Shapes every AI feature — task reframes, polish,
              “what now?” suggestions, Quokka's tone, notification rewrites.
            </p>
            <textarea
              className="v2-form-textarea v2-settings-ci-textarea"
              aria-label="Custom instructions"
              placeholder="e.g. Keep it casual and short. Don't sugarcoat. Phone calls are confrontation-level for me."
              value={settings.custom_instructions || ''}
              onChange={e => update('custom_instructions', e.target.value)}
            />
            <SettingsGroup>
              <ActionRow>
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
              </ActionRow>
            </SettingsGroup>
          </div>
        )}

        {page === 'Data' && (
          <div className="v2-settings-form">
            <SettingsGroup>
              {isNativeShell() && (
                <SettingRow
                  label="Server"
                  info="Changing the server or API token reloads the app."
                  value={getApiBase() || 'not set'}
                  trailing={
                    <button className="v2-settings-btn" onClick={requestConnectionSetup}>
                      <Server size={13} strokeWidth={1.75} /> Change…
                    </button>
                  }
                />
              )}
              <NavRow
                label="Devices"
                summary={connStatus?.devices
                  ? `${connStatus.devices.length} device${connStatus.devices.length === 1 ? '' : 's'}`
                  : ''}
                onPress={() => setPage('Data/devices')}
                info="Per-device access tokens. Revoking a device kills its tokens immediately; a superseded refresh token presented again auto-revokes and alerts."
              />
              <NavRow
                label="Server logs"
                onPress={() => setPage('Data/logs')}
                info="Live tail of the running server — Google, push, email, DB and SSE lines, plus errors."
              />
              <SettingRow
                label="Activity log"
                info="Audit trail of edits, completions and deletes. Deleted tasks can be restored from snapshots in the log."
                onPress={onShowActivityLog ? () => { onClose?.(); onShowActivityLog() } : undefined}
                disabled={!onShowActivityLog}
                trailing={<ChevronRight size={16} strokeWidth={2} className="v2-set-row-chev" />}
              />
            </SettingsGroup>

            <SettingsGroup caption="Import & export">
              <ActionRow
                label="Backup"
                info="Tasks, routines, settings and labels as one JSON file. Importing REPLACES the current state and reloads."
              >
                <button className="v2-settings-btn" onClick={handleExportData}>
                  <Download size={13} strokeWidth={1.75} /> Export
                </button>
                <input ref={dataImportRef} type="file" accept=".json" onChange={handleImportData} hidden />
                <button className="v2-settings-btn" onClick={() => dataImportRef.current?.click()}>
                  <Upload size={13} strokeWidth={1.75} /> Import
                </button>
              </ActionRow>
              {/* No description: the button says what it does. The old copy
                  ("rarely used; lives here so it doesn't crowd the main menu")
                  was meta-commentary about the UI's own layout, which is
                  exactly the kind of prose §1.5 says has to be earned. */}
              <ActionRow label="Markdown">
                <button
                  className="v2-settings-btn"
                  onClick={() => { onClose?.(); onShowMarkdownImport?.() }}
                  disabled={!onShowMarkdownImport}
                >
                  <Upload size={13} strokeWidth={1.75} /> Import from markdown
                </button>
              </ActionRow>
            </SettingsGroup>

            {isDev && (
              <SettingsGroup caption="Developer · dev only">
                <ActionRow info="Wipe this dev database and reload fresh seed data. Only shown on the dev build; the server blocks it everywhere else.">
                  <button className="v2-settings-btn" onClick={handleReseed} disabled={reseeding}>
                    <RefreshCw size={13} strokeWidth={1.75} /> {reseeding ? 'Reseeding…' : 'Reseed dev database'}
                  </button>
                </ActionRow>
              </SettingsGroup>
            )}

            {/* The ONE framed element in the whole surface, and last on the
                page. That exception is the point (§4): everything else is a
                plain hairline row, so the frame means "this one is different".
                Never collapsed — hiding a wipe button behind a disclosure is
                how you tap it by accident. Its description is persistent
                rather than behind an ⓘ, because "no undo" is not something to
                make someone go looking for. */}
            <div className="v2-set-danger">
              <h3 className="v2-set-danger-caption">Danger zone</h3>
              <p className="v2-set-danger-note">
                These wipe data. There is no undo other than restoring from a backup.
              </p>
              <div className="v2-set-danger-actions">
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

        {page === 'Data/devices' && (
          <div className="v2-settings-form">
            <p className="v2-set-page-intro">
              Per-device access tokens. Revoking a device kills its tokens immediately;
              a superseded refresh token presented again auto-revokes and raises a security alert.
            </p>
            <AuthDevicesBlock />
          </div>
        )}

        {page === 'Data/logs' && (
          <div className="v2-settings-form">
            <p className="v2-set-page-intro">
              Live tail of the running server — Google, push, email, DB and SSE lines, plus errors.
            </p>
            <ServerLogsPanel />
          </div>
        )}

        {page === 'Labels' && <LabelsPanel />}

        {page.startsWith('Notifications') && (
          <NotificationsPanel settings={settings} update={update} page={page} setPage={setPage} />
        )}

        {page.startsWith('Integrations') && (
          <IntegrationsPanel
            settings={settings}
            update={update}
            setActiveTab={setPage}
            page={page}
            setPage={setPage}
            onTrelloSync={onTrelloSync}
            trelloSyncing={trelloSyncing}
            onNotionSync={onNotionSync}
            notionSyncing={notionSyncing}
            onGCalSync={onGCalSync}
            gcalSyncing={gcalSyncing}
          />
        )}


      </div>
      </SettingsPage>
      )}
      </SettingsNav>

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
