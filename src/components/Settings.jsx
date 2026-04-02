import { useState, useRef, useEffect } from 'react'
import { loadSettings, saveSettings, loadLabels, saveLabels, loadTasks, saveTasks, loadRoutines, saveRoutines, LABEL_COLORS, loadNotifLog, clearNotifLog, logNotification } from '../store'
import { getKeyStatus, callClaude, notionStatus, trelloStatus, trelloBoards, trelloBoardLists } from '../api'

const NOTIF_TYPE_LABELS = {
  high_priority: 'High Priority',
  overdue: 'Overdue',
  stale: 'Stale',
  nudge: 'Nudge',
  size: 'Size',
  pileup: 'Pile-up',
  test: 'Test',
}

function NotificationHistory() {
  const [log, setLog] = useState(() => loadNotifLog())
  const [expanded, setExpanded] = useState(false)

  if (log.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No notifications yet.</div>
  }

  const shown = expanded ? log : log.slice(0, 5)

  return (
    <div className="notif-history">
      {shown.map(entry => (
        <div key={entry.id} className="notif-history-item">
          <div className="notif-history-header">
            <span className="notif-history-type">{NOTIF_TYPE_LABELS[entry.type] || entry.type}</span>
            <span className="notif-history-time">
              {new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {' '}
              {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          </div>
          <div className="notif-history-title">{entry.title}</div>
          <div className="notif-history-body">{entry.body}</div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {log.length > 5 && (
          <button className="ci-upload-btn" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : `Show all (${log.length})`}
          </button>
        )}
        <button className="ci-clear-btn" onClick={() => { clearNotifLog(); setLog([]) }}>
          Clear history
        </button>
      </div>
    </div>
  )
}

const TABS = ['General', 'AI', 'Labels', 'Integrations', 'Notifications', 'Data']

export default function Settings({ onClose, onClearCompleted, onClearAll, onTrelloSync, trelloSyncing, onShowActivityLog, syncStatus }) {
  const [activeTab, setActiveTab] = useState('General')
  const [settings, setSettings] = useState(loadSettings)
  const [envKeys, setEnvKeys] = useState({ anthropic: false, notion: false, trello: false })

  useEffect(() => {
    getKeyStatus().then(setEnvKeys)
  }, [])

  // Anthropic connection state
  const [anthropicStatus, setAnthropicStatus] = useState(null) // null | 'checking' | 'connected' | 'error'
  const handleAnthropicConnect = async () => {
    setAnthropicStatus('checking')
    try {
      await callClaude('Respond with just "ok".', 'ping')
      setAnthropicStatus('connected')
    } catch {
      setAnthropicStatus('error')
    }
  }

  // Notion connection state
  const [notionConnected, setNotionConnected] = useState(null) // null | 'checking' | { connected, bot }
  const handleNotionConnect = async () => {
    setNotionConnected('checking')
    try {
      const status = await notionStatus()
      setNotionConnected(status)
    } catch {
      setNotionConnected({ connected: false })
    }
  }

  // Trello connection state
  const [trelloConnecting, setTrelloConnecting] = useState(false)
  const [trelloConnected, setTrelloConnected] = useState(false)
  const [trelloUsername, setTrelloUsername] = useState(null)
  const [trelloBoardsList, setTrelloBoardsList] = useState([])
  const [trelloListsList, setTrelloListsList] = useState([])
  const [trelloError, setTrelloError] = useState(null)

  const handleTrelloConnect = async () => {
    setTrelloConnecting(true)
    setTrelloError(null)
    try {
      const status = await trelloStatus()
      if (status.connected) {
        setTrelloConnected(true)
        setTrelloUsername(status.username)
        const boards = await trelloBoards()
        setTrelloBoardsList(boards)
      } else {
        setTrelloError('Could not connect. Check your API key and token.')
      }
    } catch (err) {
      setTrelloError(err.message)
    } finally {
      setTrelloConnecting(false)
    }
  }

  const [loadingLists, setLoadingLists] = useState(false)

  const handleTrelloBoardSelect = async (boardId) => {
    const board = trelloBoardsList.find(b => b.id === boardId)
    if (!board) return
    update('trello_board_id', boardId)
    update('trello_board_name', board.name)
    update('trello_list_id', '')
    update('trello_list_name', '')
    setTrelloListsList([])
    setLoadingLists(true)
    try {
      const lists = await trelloBoardLists(boardId)
      setTrelloListsList(lists)
    } catch (err) {
      setTrelloError(err.message)
    } finally {
      setLoadingLists(false)
    }
  }

  const handleTrelloListSelect = (listId) => {
    const list = trelloListsList.find(l => l.id === listId)
    if (!list) return
    update('trello_list_id', listId)
    update('trello_list_name', list.name)
  }

  // Auto-check Trello connection if credentials are already saved
  useEffect(() => {
    const s = loadSettings()
    if ((s.trello_api_key && s.trello_secret) || envKeys.trello) {
      trelloStatus().then(status => {
        if (status.connected) {
          setTrelloConnected(true)
          setTrelloUsername(status.username)
          trelloBoards().then(setTrelloBoardsList).catch(() => {})
          if (s.trello_board_id) {
            trelloBoardLists(s.trello_board_id).then(setTrelloListsList).catch(() => {})
          }
        }
      }).catch(() => {})
    }
  }, [envKeys.trello])

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
        // Push imported data to server before reloading so it isn't
        // overwritten by stale server data on the next hydration cycle
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
    setSettings(prev => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
  }

  const addLabel = () => {
    const name = newLabelName.trim()
    if (!name) return
    const newLabel = { id: crypto.randomUUID(), name, color: newLabelColor }
    const next = [...labels, newLabel]
    setLabels(next)
    saveLabels(next)
    setNewLabelName('')
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
        <span className="version-label">
          {syncStatus === 'saving' ? 'Saving...' : syncStatus === 'saved' ? 'Saved' : __APP_VERSION__}
        </span>
      </div>

      <div className="settings-tabs">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`settings-tab ${activeTab === tab ? 'settings-tab-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* General */}
      {activeTab === 'General' && (
        <div className="settings-group">
          <div className="settings-label">Theme</div>
          <div className="theme-toggle-row">
            <button
              className={`theme-btn ${(settings.theme || 'dark') === 'dark' ? 'theme-btn-active' : ''}`}
              onClick={() => {
                update('theme', 'dark')
                document.documentElement.setAttribute('data-theme', 'dark')
                document.querySelector('meta[name="theme-color"]').content = '#0B0B0F'
              }}
            >
              Dark
            </button>
            <button
              className={`theme-btn ${settings.theme === 'light' ? 'theme-btn-active' : ''}`}
              onClick={() => {
                update('theme', 'light')
                document.documentElement.setAttribute('data-theme', 'light')
                document.querySelector('meta[name="theme-color"]').content = '#F5F5F7'
              }}
            >
              Light
            </button>
          </div>

          <div className="settings-label" style={{ marginTop: 16 }}>Default due date (days from now)</div>
          <div className="settings-hint">0 = no default</div>
          <input
            className="settings-input"
            type="number"
            min="0"
            max="90"
            value={settings.default_due_days ?? 7}
            onChange={e => update('default_due_days', parseInt(e.target.value) || 0)}
          />

          <div className="settings-label" style={{ marginTop: 16 }}>Staleness threshold (days)</div>
          <input
            className="settings-input"
            type="number"
            min="1"
            max="30"
            value={settings.staleness_days}
            onChange={e => update('staleness_days', parseInt(e.target.value) || 1)}
          />

          <div className="settings-label" style={{ marginTop: 16 }}>Reframe trigger (snooze count)</div>
          <input
            className="settings-input"
            type="number"
            min="1"
            max="20"
            value={settings.reframe_threshold}
            onChange={e => update('reframe_threshold', parseInt(e.target.value) || 1)}
          />

          <div className="settings-label" style={{ marginTop: 16 }}>Max open tasks</div>
          <div className="settings-hint">Warns when you exceed this. 0 = no limit.</div>
          <input
            className="settings-input"
            type="number"
            min="0"
            max="100"
            value={settings.max_open_tasks ?? 10}
            onChange={e => update('max_open_tasks', parseInt(e.target.value) || 0)}
          />
        </div>
      )}

      {/* AI */}
      {activeTab === 'AI' && (
        <div className="settings-group">
          <div className="settings-label">Custom Instructions</div>
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
            <button className="ci-upload-btn" onClick={() => fileInputRef.current?.click()}>
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
              <button className="ci-clear-btn" onClick={() => update('custom_instructions', '')}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Labels */}
      {activeTab === 'Labels' && (
        <div className="settings-group">
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
      )}

      {/* Integrations */}
      {activeTab === 'Integrations' && (
        <div className="settings-group">
          <div className="settings-label">Anthropic (Claude AI)</div>
          {envKeys.anthropic ? (
            <div className="env-key-status">Set by environment variable</div>
          ) : (
            <input
              className="add-input"
              type="password"
              placeholder="API key (sk-ant-...)"
              value={settings.anthropic_api_key || ''}
              onChange={e => { update('anthropic_api_key', e.target.value); setAnthropicStatus(null) }}
              style={{ marginBottom: 8, fontSize: 13 }}
            />
          )}
          {anthropicStatus === 'connected' ? (
            <div className="integration-status connected">Connected</div>
          ) : anthropicStatus === 'error' ? (
            <div className="integration-status error">Connection failed — check your key</div>
          ) : (
            <button
              className="ci-upload-btn"
              disabled={anthropicStatus === 'checking' || (!settings.anthropic_api_key && !envKeys.anthropic)}
              onClick={handleAnthropicConnect}
            >
              {anthropicStatus === 'checking' ? 'Checking...' : 'Connect'}
            </button>
          )}

          <div className="settings-label" style={{ marginTop: 16 }}>Notion</div>
          {envKeys.notion ? (
            <div className="env-key-status">Set by environment variable</div>
          ) : (
            <input
              className="add-input"
              type="password"
              placeholder="Integration token (ntn_...)"
              value={settings.notion_token || ''}
              onChange={e => { update('notion_token', e.target.value); setNotionConnected(null) }}
              style={{ marginBottom: 8, fontSize: 13 }}
            />
          )}
          {notionConnected && notionConnected !== 'checking' && notionConnected.connected ? (
            <div className="integration-status connected">Connected{notionConnected.bot ? ` as ${notionConnected.bot}` : ''}</div>
          ) : notionConnected && notionConnected !== 'checking' && !notionConnected.connected ? (
            <div className="integration-status error">Connection failed — check your token</div>
          ) : (
            <button
              className="ci-upload-btn"
              disabled={notionConnected === 'checking' || (!settings.notion_token && !envKeys.notion)}
              onClick={handleNotionConnect}
            >
              {notionConnected === 'checking' ? 'Checking...' : 'Connect'}
            </button>
          )}

          <div className="settings-label" style={{ marginTop: 16 }}>Trello</div>
          {envKeys.trello ? (
            <div className="env-key-status">Set by environment variable</div>
          ) : (
            <>
              <input
                className="add-input"
                type="password"
                placeholder="API Key"
                value={settings.trello_api_key || ''}
                onChange={e => update('trello_api_key', e.target.value)}
                style={{ marginBottom: 8, fontSize: 13 }}
              />
              <input
                className="add-input"
                type="password"
                placeholder="Token (generated via authorize link — not the Secret)"
                value={settings.trello_secret || ''}
                onChange={e => update('trello_secret', e.target.value)}
                style={{ marginBottom: 0, fontSize: 13 }}
              />
            </>
          )}

          {trelloConnected ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                Connected as <strong style={{ color: 'var(--text-primary)' }}>{trelloUsername}</strong>
              </div>

              <div className="settings-label" style={{ marginBottom: 6 }}>Board</div>
              <select
                className="add-input"
                style={{ fontSize: 13, marginBottom: 8 }}
                value={settings.trello_board_id || ''}
                onChange={e => handleTrelloBoardSelect(e.target.value)}
              >
                <option value="" disabled>Select a board...</option>
                {trelloBoardsList.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>

              {settings.trello_board_id && (
                <>
                  <div className="settings-label" style={{ marginBottom: 6 }}>Default list</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>You can choose a different list when pushing each task.</div>
                  {loadingLists ? (
                    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Loading lists...</div>
                  ) : (
                    <select
                      className="add-input"
                      style={{ fontSize: 13, marginBottom: 0 }}
                      value={settings.trello_list_id || ''}
                      onChange={e => handleTrelloListSelect(e.target.value)}
                    >
                      <option value="" disabled>Select a list...</option>
                      {trelloListsList.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  )}
                </>
              )}

              {/* Sync controls */}
              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="ci-upload-btn"
                  disabled={trelloSyncing}
                  onClick={onTrelloSync}
                >
                  {trelloSyncing ? 'Syncing...' : 'Sync Now'}
                </button>
                {settings.trello_last_sync && (
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    Last: {new Date(settings.trello_last_sync).toLocaleString()}
                  </span>
                )}
              </div>

              {/* List mapping display */}
              {settings.trello_list_mapping && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Status mapping</div>
                  {Object.entries(settings.trello_list_mapping).map(([status, listId]) => {
                    const list = trelloListsList.find(l => l.id === listId)
                    return (
                      <div key={status} style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 2 }}>
                        {list?.name || listId} → <strong>{status}</strong>
                      </div>
                    )
                  })}
                  <button
                    className="ci-clear-btn"
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      update('trello_list_mapping', null)
                    }}
                  >
                    Re-infer mapping
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              className="ci-upload-btn"
              style={{ marginTop: 8 }}
              disabled={trelloConnecting || (!settings.trello_api_key && !envKeys.trello)}
              onClick={handleTrelloConnect}
            >
              {trelloConnecting ? 'Connecting...' : 'Connect'}
            </button>
          )}

          {trelloError && (
            <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 8 }}>{trelloError}</div>
          )}
        </div>
      )}

      {/* Notifications */}
      {activeTab === 'Notifications' && (
        <div className="settings-group">
          <button
            className={`notif-toggle ${settings.notifications_enabled ? 'notif-on' : ''}`}
            onClick={async () => {
              if (!settings.notifications_enabled) {
                const perm = await Notification.requestPermission()
                if (perm === 'granted') update('notifications_enabled', true)
              } else {
                update('notifications_enabled', false)
              }
            }}
          >
            {settings.notifications_enabled ? 'Notifications on' : 'Enable notifications'}
          </button>

          {settings.notifications_enabled && (
            <div className="notif-options">
              {/* Quiet Hours */}
              <div className="settings-label" style={{ marginTop: 16 }}>Quiet hours</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                Silence all notifications during these hours.
              </div>
              <label className="notif-check">
                <input type="checkbox" checked={!!settings.quiet_hours_enabled} onChange={e => update('quiet_hours_enabled', e.target.checked)} />
                <span>Enable quiet hours</span>
              </label>
              {settings.quiet_hours_enabled && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <input
                    type="time"
                    className="settings-input"
                    value={settings.quiet_hours_start || '22:00'}
                    onChange={e => update('quiet_hours_start', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>to</span>
                  <input
                    type="time"
                    className="settings-input"
                    value={settings.quiet_hours_end || '08:00'}
                    onChange={e => update('quiet_hours_end', e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
              )}

              <div className="settings-label" style={{ marginTop: 16 }}>High priority</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                Always on. Daily reminders before due, hourly on due date, every 30min when overdue.
              </div>
              <label className="notif-check">
                <input type="checkbox" checked={settings.notif_highpri_escalate !== false} onChange={e => update('notif_highpri_escalate', e.target.checked)} />
                <span>Repeat until addressed</span>
              </label>

              <div className="settings-label" style={{ marginTop: 16 }}>Notify me about</div>

              <div className="notif-type-row">
                <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                  <input type="checkbox" checked={settings.notif_overdue !== false} onChange={e => update('notif_overdue', e.target.checked)} />
                  <span>Overdue tasks</span>
                </label>
                {settings.notif_overdue !== false && (
                  <div className="notif-freq-input" style={{ marginLeft: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>every</span>
                    <input
                      className="settings-input"
                      type="number" min="1" max="1440"
                      value={settings.notif_freq_overdue ?? 30}
                      onChange={e => update('notif_freq_overdue', Math.max(1, parseInt(e.target.value) || 1))}
                      style={{ width: 56, textAlign: 'center' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>min</span>
                  </div>
                )}
              </div>

              <div className="notif-type-row">
                <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                  <input type="checkbox" checked={settings.notif_stale !== false} onChange={e => update('notif_stale', e.target.checked)} />
                  <span>Stale tasks</span>
                </label>
                {settings.notif_stale !== false && (
                  <div className="notif-freq-input" style={{ marginLeft: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>every</span>
                    <input
                      className="settings-input"
                      type="number" min="1" max="1440"
                      value={settings.notif_freq_stale ?? 30}
                      onChange={e => update('notif_freq_stale', Math.max(1, parseInt(e.target.value) || 1))}
                      style={{ width: 56, textAlign: 'center' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>min</span>
                  </div>
                )}
              </div>

              <div className="notif-type-row">
                <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                  <input type="checkbox" checked={settings.notif_nudge !== false} onChange={e => update('notif_nudge', e.target.checked)} />
                  <span>General nudges</span>
                </label>
                {settings.notif_nudge !== false && (
                  <div className="notif-freq-input" style={{ marginLeft: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>every</span>
                    <input
                      className="settings-input"
                      type="number" min="1" max="1440"
                      value={settings.notif_freq_nudge ?? 60}
                      onChange={e => update('notif_freq_nudge', Math.max(1, parseInt(e.target.value) || 1))}
                      style={{ width: 56, textAlign: 'center' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>min</span>
                  </div>
                )}
              </div>

              <div className="notif-type-row">
                <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                  <input type="checkbox" checked disabled style={{ opacity: 0.5 }} />
                  <span>Size-based reminders</span>
                </label>
                <div className="notif-freq-input" style={{ marginLeft: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>every</span>
                  <input
                    className="settings-input"
                    type="number" min="1" max="1440"
                    value={settings.notif_freq_size ?? 60}
                    onChange={e => update('notif_freq_size', Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ width: 56, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>min</span>
                </div>
              </div>

              <div className="settings-label" style={{ marginTop: 16 }}>Warn when tasks pile up</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="settings-input"
                  type="number" min="0" max="100"
                  value={settings.stale_warn_pct ?? 50}
                  onChange={e => update('stale_warn_pct', parseInt(e.target.value) || 0)}
                />
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>% older than</span>
                <input
                  className="settings-input"
                  type="number" min="1" max="90"
                  value={settings.stale_warn_days ?? 7}
                  onChange={e => update('stale_warn_days', parseInt(e.target.value) || 7)}
                />
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>days</span>
              </div>
              <div className="notif-type-row" style={{ marginTop: 8 }}>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-dim)' }}>Pile-up check</span>
                <div className="notif-freq-input" style={{ marginLeft: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>every</span>
                  <input
                    className="settings-input"
                    type="number" min="1" max="1440"
                    value={settings.notif_freq_pileup ?? 120}
                    onChange={e => update('notif_freq_pileup', Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ width: 56, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>min</span>
                </div>
              </div>

              {/* Test notification */}
              <button
                className="ci-upload-btn"
                style={{ marginTop: 16 }}
                onClick={() => {
                  if ('Notification' in window && Notification.permission === 'granted') {
                    const body = 'This is a test notification from Boomerang.'
                    new Notification('Test Notification', { body, icon: '/icon-192.png', tag: 'test' })
                    logNotification('test', 'Test Notification', body)
                  }
                }}
              >
                Send test notification
              </button>

              {/* Notification History */}
              <div className="settings-label" style={{ marginTop: 20 }}>Notification history</div>
              <NotificationHistory />
            </div>
          )}
        </div>
      )}

      {/* Data */}
      {activeTab === 'Data' && (
        <>
          <div className="settings-group">
            <div className="settings-label">Export / Import</div>
            <div className="ci-actions">
              <button className="ci-upload-btn" onClick={handleExportData}>Export</button>
              <input ref={dataImportRef} type="file" accept=".json" onChange={handleImportData} hidden />
              <button className="ci-upload-btn" onClick={() => dataImportRef.current?.click()}>Import</button>
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-label">Activity</div>
            <button className="ci-upload-btn" onClick={onShowActivityLog}>
              View Activity Log
            </button>
          </div>

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
        </>
      )}
    </div>
  )
}
