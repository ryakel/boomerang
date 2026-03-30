import { useState, useRef, useEffect } from 'react'
import { loadSettings, saveSettings, loadLabels, saveLabels, loadTasks, saveTasks, loadRoutines, saveRoutines, LABEL_COLORS } from '../store'
import { getKeyStatus } from '../api'

export default function Settings({ onClose, onClearCompleted, onClearAll }) {
  const [settings, setSettings] = useState(loadSettings)
  const [envKeys, setEnvKeys] = useState({ anthropic: false, notion: false })

  useEffect(() => {
    getKeyStatus().then(setEnvKeys)
  }, [])
  const [labels, setLabels] = useState(loadLabels)
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[0])
  const fileInputRef = useRef(null)
  const dataImportRef = useRef(null)

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
        if (data.labels) {
          saveLabels(data.labels)
          setLabels(data.labels)
        }
        if (data.settings) setSettings({ ...loadSettings(), ...data.settings })
        window.location.reload()
      } catch {
        alert('Invalid backup file')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      update('custom_instructions', ev.target.result)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const update = (key, value) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    saveSettings(next)
  }

  const addLabel = () => {
    const name = newLabelName.trim()
    if (!name) return
    const newLabel = {
      id: crypto.randomUUID(),
      name,
      color: newLabelColor,
    }
    const next = [...labels, newLabel]
    setLabels(next)
    saveLabels(next)
    setNewLabelName('')
    // Cycle to next color
    const idx = LABEL_COLORS.indexOf(newLabelColor)
    setNewLabelColor(LABEL_COLORS[(idx + 1) % LABEL_COLORS.length])
  }

  const removeLabel = (id) => {
    const next = labels.filter(l => l.id !== id)
    setLabels(next)
    saveLabels(next)
  }

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Settings</div>
        <span className="version-label">v{__APP_VERSION__}</span>
      </div>

      <div className="settings-group">
        <div className="settings-label">API Keys</div>
        {envKeys.anthropic ? (
          <div className="env-key-status">Anthropic API key set by environment variable</div>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <input
              className="add-input"
              type="password"
              placeholder="Anthropic API key (sk-ant-...)"
              value={settings.anthropic_api_key || ''}
              onChange={e => update('anthropic_api_key', e.target.value)}
              style={{ marginBottom: 0, fontSize: 13 }}
            />
          </div>
        )}
        {envKeys.notion ? (
          <div className="env-key-status">Notion token set by environment variable</div>
        ) : (
          <div>
            <input
              className="add-input"
              type="password"
              placeholder="Notion integration token (ntn_...)"
              value={settings.notion_token || ''}
              onChange={e => update('notion_token', e.target.value)}
              style={{ marginBottom: 0, fontSize: 13 }}
            />
          </div>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-label">AI Custom Instructions</div>
        <div className="settings-hint">
          How should the AI talk to you? Shapes all AI features.
        </div>
        <textarea
          className="custom-instructions-input"
          placeholder="e.g. Keep it casual and short. Don't sugarcoat. I respond better to direct language."
          value={settings.custom_instructions || ''}
          onChange={e => update('custom_instructions', e.target.value)}
        />
        <div className="ci-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,.markdown"
            onChange={handleFileUpload}
            hidden
          />
          <button
            className="ci-upload-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Import
          </button>
          <button
            className="ci-upload-btn"
            onClick={() => {
              const text = settings.custom_instructions || ''
              const blob = new Blob([text], { type: 'text/markdown' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'boomerang-instructions.md'
              a.click()
              URL.revokeObjectURL(url)
            }}
            disabled={!settings.custom_instructions?.trim()}
            style={!settings.custom_instructions?.trim() ? { opacity: 0.4 } : {}}
          >
            Export
          </button>
          {settings.custom_instructions?.trim() && (
            <button
              className="ci-clear-btn"
              onClick={() => update('custom_instructions', '')}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-label">Staleness threshold (days)</div>
        <input
          className="settings-input"
          type="number"
          min="1"
          max="30"
          value={settings.staleness_days}
          onChange={e => update('staleness_days', parseInt(e.target.value) || 1)}
        />
      </div>

      <div className="settings-group">
        <div className="settings-label">Reframe trigger (snooze count)</div>
        <input
          className="settings-input"
          type="number"
          min="1"
          max="20"
          value={settings.reframe_threshold}
          onChange={e => update('reframe_threshold', parseInt(e.target.value) || 1)}
        />
      </div>

      {/* Labels */}
      <div className="settings-group">
        <div className="settings-label">Labels</div>
        <div className="label-list">
          {labels.map(label => (
            <div key={label.id} className="label-row">
              <span className="label-swatch" style={{ background: label.color }} />
              <span className="label-name">{label.name}</span>
              <button className="label-remove" onClick={() => removeLabel(label.id)}>✕</button>
            </div>
          ))}
        </div>
        <div className="label-add-row">
          <div className="color-picker">
            {LABEL_COLORS.map(c => (
              <button
                key={c}
                className={`color-dot ${newLabelColor === c ? 'color-dot-active' : ''}`}
                style={{ background: c }}
                onClick={() => setNewLabelColor(c)}
              />
            ))}
          </div>
          <div className="label-add-input-row">
            <input
              className="add-input"
              placeholder="New label..."
              value={newLabelName}
              onChange={e => setNewLabelName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addLabel()}
              style={{ marginBottom: 0 }}
            />
            <button
              className="submit-btn"
              disabled={!newLabelName.trim()}
              onClick={addLabel}
              style={{ width: 'auto', padding: '10px 20px', marginTop: 0 }}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="settings-group">
        <div className="settings-label">Notifications</div>
        <button
          className={`notif-toggle ${settings.notifications_enabled ? 'notif-on' : ''}`}
          onClick={async () => {
            if (!settings.notifications_enabled) {
              const perm = await Notification.requestPermission()
              if (perm === 'granted') {
                update('notifications_enabled', true)
              }
            } else {
              update('notifications_enabled', false)
            }
          }}
        >
          {settings.notifications_enabled ? 'Notifications on' : 'Enable notifications'}
        </button>

        {settings.notifications_enabled && (
          <div className="notif-options">
            <div className="settings-label" style={{ marginTop: 16 }}>Check every</div>
            <div className="notif-freq-row">
              {[15, 30, 60, 120].map(min => (
                <button
                  key={min}
                  className={`notif-freq ${(settings.notif_frequency || 30) === min ? 'notif-freq-active' : ''}`}
                  onClick={() => update('notif_frequency', min)}
                >
                  {min < 60 ? `${min}m` : `${min / 60}h`}
                </button>
              ))}
            </div>

            <div className="settings-label" style={{ marginTop: 16 }}>Notify me about</div>
            <label className="notif-check">
              <input
                type="checkbox"
                checked={settings.notif_overdue !== false}
                onChange={e => update('notif_overdue', e.target.checked)}
              />
              <span>Overdue tasks</span>
            </label>
            <label className="notif-check">
              <input
                type="checkbox"
                checked={settings.notif_stale !== false}
                onChange={e => update('notif_stale', e.target.checked)}
              />
              <span>Stale tasks</span>
            </label>
            <label className="notif-check">
              <input
                type="checkbox"
                checked={settings.notif_nudge !== false}
                onChange={e => update('notif_nudge', e.target.checked)}
              />
              <span>General nudges</span>
            </label>
          </div>
        )}
      </div>

      {/* Data export/import */}
      <div className="settings-group">
        <div className="settings-label">Data</div>
        <div className="ci-actions">
          <button className="ci-upload-btn" onClick={handleExportData}>
            Export
          </button>
          <input
            ref={dataImportRef}
            type="file"
            accept=".json"
            onChange={handleImportData}
            hidden
          />
          <button className="ci-upload-btn" onClick={() => dataImportRef.current?.click()}>
            Import
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="danger-zone">
        <div className="settings-label">Danger Zone</div>
        <div className="danger-zone-buttons">
          <button className="settings-danger" onClick={onClearCompleted}>
            Clear completed tasks
          </button>
          <button
            className="settings-danger settings-danger-full"
            onClick={() => {
              if (window.confirm('This will delete all tasks, settings, and history. Are you sure?')) {
                onClearAll()
              }
            }}
          >
            Clear all data
          </button>
        </div>
      </div>
    </div>
  )
}
