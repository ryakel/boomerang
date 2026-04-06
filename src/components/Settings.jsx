import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronRight } from 'lucide-react'
import './Settings.css'
import { loadSettings, saveSettings, loadLabels, saveLabels, loadTasks, saveTasks, loadRoutines, saveRoutines, LABEL_COLORS, loadNotifLog, clearNotifLog, logNotification, DEFAULT_SETTINGS, uuid } from '../store'
import { getKeyStatus, callClaude, notionStatus, trelloStatus, trelloBoards, trelloBoardLists, notionSearch, notionGetChildPages, gcalGetAuthUrl, gcalStatus, gcalDisconnect, gcalListCalendars, gcalBulkDeleteEvents } from '../api'

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

export default function Settings({ onClose, onClearCompleted, onClearAll, onTrelloSync, trelloSyncing, onNotionSync, notionSyncing, onGCalSync, gcalSyncing, onShowActivityLog, syncStatus, isDesktop }) {
  const [activeTab, setActiveTab] = useState('General')
  const [settings, setSettings] = useState(loadSettings)
  const [envKeys, setEnvKeys] = useState({ anthropic: false, notion: false, trello: false })

  // Load env key status, then auto-test env-provided integrations
  useEffect(() => {
    getKeyStatus().then(keys => {
      setEnvKeys(keys)
      if (keys.anthropic) {
        setAnthropicStatus('checking')
        callClaude('Respond with just "ok".', 'ping')
          .then(() => setAnthropicStatus('connected'))
          .catch(() => setAnthropicStatus('error'))
      }
      if (keys.notion) {
        setNotionConnected('checking')
        notionStatus()
          .then(s => setNotionConnected(s))
          .catch(() => setNotionConnected({ connected: false }))
      }
      if (keys.trello) {
        setTrelloConnecting(true)
        trelloStatus()
          .then(s => {
            if (s.connected) {
              setTrelloConnected(true)
              setTrelloUsername(s.username)
              return trelloBoards().then(setTrelloBoardsList)
            } else {
              setTrelloError('Environment variable set but connection failed.')
            }
          })
          .catch(e => setTrelloError(e.message))
          .finally(() => setTrelloConnecting(false))
      }
    })
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
  const [expandedIntegration, setExpandedIntegration] = useState(null) // 'anthropic' | 'notion' | 'trello' | null
  const [showCredentials, setShowCredentials] = useState({}) // { anthropic: bool, notion: bool, trello: bool }
  // Notion sync: search for parent page
  const [notionSyncSearch, setNotionSyncSearch] = useState('')
  const [notionSyncResults, setNotionSyncResults] = useState(null)
  const [notionSyncSearching, setNotionSyncSearching] = useState(false)
  const [notionSyncChildCount, setNotionSyncChildCount] = useState(null)

  const handleNotionSyncSearch = async () => {
    if (!notionSyncSearch.trim()) return
    setNotionSyncSearching(true)
    try {
      const results = await notionSearch(notionSyncSearch.trim())
      setNotionSyncResults(results.pages || [])
    } catch {
      setNotionSyncResults([])
    } finally {
      setNotionSyncSearching(false)
    }
  }

  const handleSelectSyncParent = async (page) => {
    update('notion_sync_parent_id', page.id)
    update('notion_sync_parent_title', page.title)
    setNotionSyncResults(null)
    setNotionSyncSearch('')
    // Fetch child count for display
    try {
      const children = await notionGetChildPages(page.id)
      setNotionSyncChildCount(children.pages?.length || 0)
    } catch {
      setNotionSyncChildCount(null)
    }
  }

  // Load child count on mount if sync parent is configured
  useEffect(() => {
    if (settings.notion_sync_parent_id) {
      notionGetChildPages(settings.notion_sync_parent_id)
        .then(r => setNotionSyncChildCount(r.pages?.length || 0))
        .catch(() => setNotionSyncChildCount(null))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Google Calendar connection state
  const [gcalConnected, setGcalConnected] = useState(false)
  const [gcalEmail, setGcalEmail] = useState(null)
  const [gcalConnecting, setGcalConnecting] = useState(false)
  const [gcalError, setGcalError] = useState(null)
  const [gcalCalendars, setGcalCalendars] = useState([])
  const [gcalBulkDeleting, setGcalBulkDeleting] = useState(false)
  const [gcalBulkDeleteResult, setGcalBulkDeleteResult] = useState(null)

  const handleGcalConnect = async () => {
    setGcalConnecting(true)
    setGcalError(null)
    try {
      const { url } = await gcalGetAuthUrl()
      window.open(url, '_blank', 'width=500,height=600')
    } catch (err) {
      setGcalError(err.message)
    } finally {
      setGcalConnecting(false)
    }
  }

  // Listen for OAuth callback message
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'gcal-connected') {
        gcalStatus().then(s => {
          setGcalConnected(s.connected)
          setGcalEmail(s.email)
          if (s.connected) {
            gcalListCalendars().then(setGcalCalendars).catch(() => {})
          }
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Auto-check GCal connection on mount
  useEffect(() => {
    gcalStatus().then(s => {
      if (s.connected) {
        setGcalConnected(true)
        setGcalEmail(s.email)
        gcalListCalendars().then(setGcalCalendars).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  const handleGcalDisconnect = async () => {
    try {
      await gcalDisconnect()
      setGcalConnected(false)
      setGcalEmail(null)
      setGcalCalendars([])
      update('gcal_sync_enabled', false)
      update('gcal_pull_enabled', false)
    } catch (err) {
      setGcalError(err.message)
    }
  }

  const handleGcalBulkDelete = async () => {
    if (!confirm('Delete ALL Boomerang-managed events from Google Calendar?\n\nThis will also unlink all tasks from their calendar events.')) return
    setGcalBulkDeleting(true)
    setGcalBulkDeleteResult(null)
    try {
      const calendarId = settings.gcal_calendar_id || 'primary'
      const result = await gcalBulkDeleteEvents(calendarId)
      // Clear gcal_event_id from all tasks
      const tasks = loadTasks()
      let cleared = 0
      const updated = tasks.map(t => {
        if (t.gcal_event_id) { cleared++; return { ...t, gcal_event_id: null } }
        return t
      })
      if (cleared > 0) saveTasks(updated)
      setGcalBulkDeleteResult(`Deleted ${result.deleted} event${result.deleted !== 1 ? 's' : ''} from calendar, unlinked ${cleared} task${cleared !== 1 ? 's' : ''}${result.failed ? `, ${result.failed} failed` : ''}`)
    } catch (err) {
      setGcalBulkDeleteResult(`Error: ${err.message}`)
    } finally {
      setGcalBulkDeleting(false)
    }
  }

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
    const newLabel = { id: uuid(), name, color: newLabelColor }
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

  // Drag-to-reorder labels
  const dragLabelIdx = useRef(null)
  const dragOverIdx = useRef(null)

  const handleLabelDragStart = useCallback((idx) => {
    dragLabelIdx.current = idx
  }, [])

  const handleLabelDragOver = useCallback((e, idx) => {
    e.preventDefault()
    dragOverIdx.current = idx
  }, [])

  const handleLabelDrop = useCallback(() => {
    const from = dragLabelIdx.current
    const to = dragOverIdx.current
    if (from == null || to == null || from === to) return
    const next = [...labels]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setLabels(next)
    saveLabels(next)
    dragLabelIdx.current = null
    dragOverIdx.current = null
  }, [labels])

  // Touch drag for mobile label reorder
  const touchDragRef = useRef(null)
  const labelListRef = useRef(null)

  const handleLabelTouchStart = useCallback((e, idx) => {
    const touch = e.touches[0]
    touchDragRef.current = { idx, startY: touch.clientY }
  }, [])

  const handleLabelTouchMove = useCallback((e) => {
    if (!touchDragRef.current || !labelListRef.current) return
    const touch = e.touches[0]
    const rows = labelListRef.current.querySelectorAll('.label-row')
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect()
      if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        dragOverIdx.current = i
        rows.forEach((r, j) => r.classList.toggle('label-drag-over', j === i && i !== touchDragRef.current.idx))
        break
      }
    }
  }, [])

  const handleLabelTouchEnd = useCallback(() => {
    if (!touchDragRef.current) return
    const from = touchDragRef.current.idx
    const to = dragOverIdx.current
    if (labelListRef.current) {
      labelListRef.current.querySelectorAll('.label-row').forEach(r => r.classList.remove('label-drag-over'))
    }
    if (from != null && to != null && from !== to) {
      const next = [...labels]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      setLabels(next)
      saveLabels(next)
    }
    touchDragRef.current = null
    dragOverIdx.current = null
  }, [labels])

  const savePill = (
    <span className={`autosave-pill ${syncStatus === 'saved' ? 'autosave-pill-saved' : ''}`}>
      {syncStatus === 'saving' ? 'Saving...' : syncStatus === 'saved' ? '✓ Saved' : 'Auto Save'}
    </span>
  )

  const tabBar = (
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
  )

  const settingsContent = (
    <>
      {/* General */}
      {activeTab === 'General' && (
        <div className="settings-group">
          <label className="notif-check">
            <input
              type="checkbox"
              checked={(settings.theme || 'dark') === 'dark'}
              onChange={e => {
                const theme = e.target.checked ? 'dark' : 'light'
                update('theme', theme)
                document.documentElement.setAttribute('data-theme', theme)
                document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0B0B0F' : '#F5F5F7'
              }}
            />
            <span>Dark mode</span>
          </label>

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
          <div className="label-list" ref={labelListRef} onTouchMove={handleLabelTouchMove} onTouchEnd={handleLabelTouchEnd}>
            {labels.map((label, idx) => (
              <div
                key={label.id}
                className="label-row"
                draggable
                onDragStart={() => handleLabelDragStart(idx)}
                onDragOver={e => handleLabelDragOver(e, idx)}
                onDrop={handleLabelDrop}
                onTouchStart={e => handleLabelTouchStart(e, idx)}
              >
                <span className="label-drag-handle">⠿</span>
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
        <div className="settings-group" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* ── Anthropic (Claude AI) ── */}
          <div>
            <div
              className={`integration-row${expandedIntegration === 'anthropic' ? ' expanded' : ''}`}
              onClick={() => setExpandedIntegration(expandedIntegration === 'anthropic' ? null : 'anthropic')}
            >
              <span className={`backlog-arrow${expandedIntegration === 'anthropic' ? ' open' : ''}`}><ChevronRight size={12} /></span>
              <span className={`integration-dot ${anthropicStatus === 'connected' ? 'connected' : anthropicStatus === 'error' ? 'error' : anthropicStatus === 'checking' ? 'checking' : 'unconfigured'}`} />
              <span className="integration-row-name">Anthropic (Claude AI)</span>
              {expandedIntegration !== 'anthropic' && (
                <span className="integration-row-summary">
                  {anthropicStatus === 'checking' ? 'Checking...' : anthropicStatus === 'connected' ? 'Connected' : anthropicStatus === 'error' ? 'Error' : envKeys.anthropic ? 'Environment variable' : settings.anthropic_api_key ? 'Key saved' : 'Not configured'}
                </span>
              )}
            </div>
            {expandedIntegration === 'anthropic' && (
              <div className="integration-body">
                {envKeys.anthropic ? (
                  <div className="env-key-status">Set by environment variable</div>
                ) : (
                  <>
                    <button className="credentials-toggle" onClick={() => setShowCredentials(s => ({ ...s, anthropic: !s.anthropic }))}>
                      {showCredentials.anthropic ? 'Hide' : 'Show'} API key
                    </button>
                    {showCredentials.anthropic && (
                      <input
                        className="add-input"
                        type="password"
                        placeholder="API key (sk-ant-...)"
                        value={settings.anthropic_api_key || ''}
                        onChange={e => { update('anthropic_api_key', e.target.value); setAnthropicStatus(null) }}
                        style={{ marginBottom: 8, fontSize: 13 }}
                      />
                    )}
                  </>
                )}
                {anthropicStatus === 'connected' ? (
                  <>
                    <div className="integration-status connected">Connected</div>
                    {envKeys.anthropic ? (
                      <button className="ci-upload-btn" onClick={handleAnthropicConnect}>
                        {anthropicStatus === 'checking' ? 'Testing...' : 'Test'}
                      </button>
                    ) : (
                      <button className="ci-clear-btn" onClick={() => {
                        update('anthropic_api_key', '')
                        setAnthropicStatus(null)
                      }}>
                        Disconnect
                      </button>
                    )}
                  </>
                ) : anthropicStatus === 'error' ? (
                  <>
                    <div className="integration-status error">Connection failed — check your key</div>
                    <button
                      className="ci-upload-btn"
                      onClick={handleAnthropicConnect}
                    >
                      {envKeys.anthropic ? 'Retest' : 'Retry'}
                    </button>
                  </>
                ) : (
                  <button
                    className="ci-upload-btn"
                    disabled={anthropicStatus === 'checking' || (!settings.anthropic_api_key && !envKeys.anthropic)}
                    onClick={handleAnthropicConnect}
                  >
                    {anthropicStatus === 'checking' ? 'Checking...' : envKeys.anthropic ? 'Test' : 'Connect'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Notion ── */}
          <div>
            <div
              className={`integration-row${expandedIntegration === 'notion' ? ' expanded' : ''}`}
              onClick={() => setExpandedIntegration(expandedIntegration === 'notion' ? null : 'notion')}
            >
              <span className={`backlog-arrow${expandedIntegration === 'notion' ? ' open' : ''}`}><ChevronRight size={12} /></span>
              <span className={`integration-dot ${notionConnected === 'checking' ? 'checking' : notionConnected && notionConnected !== 'checking' && notionConnected.connected ? 'connected' : notionConnected && notionConnected !== 'checking' && !notionConnected.connected ? 'error' : 'unconfigured'}`} />
              <span className="integration-row-name">Notion</span>
              {expandedIntegration !== 'notion' && (
                <span className="integration-row-summary">
                  {notionConnected === 'checking' ? 'Checking...'
                    : notionConnected && notionConnected !== 'checking' && notionConnected.connected
                    ? `Connected${notionConnected.bot ? ` as ${notionConnected.bot}` : ''}`
                    : notionConnected && !notionConnected.connected ? 'Error'
                    : envKeys.notion ? 'Environment variable' : settings.notion_token ? 'Token saved' : 'Not configured'}
                </span>
              )}
            </div>
            {expandedIntegration === 'notion' && (
              <div className="integration-body">
                {envKeys.notion ? (
                  <div className="env-key-status">Set by environment variable</div>
                ) : (
                  <>
                    <button className="credentials-toggle" onClick={() => setShowCredentials(s => ({ ...s, notion: !s.notion }))}>
                      {showCredentials.notion ? 'Hide' : 'Show'} token
                    </button>
                    {showCredentials.notion && (
                      <input
                        className="add-input"
                        type="password"
                        placeholder="Integration token (ntn_...)"
                        value={settings.notion_token || ''}
                        onChange={e => { update('notion_token', e.target.value); setNotionConnected(null) }}
                        style={{ marginBottom: 8, fontSize: 13 }}
                      />
                    )}
                  </>
                )}
                {notionConnected && notionConnected !== 'checking' && notionConnected.connected ? (
                  <>
                    <div className="integration-status connected">Connected{notionConnected.bot ? ` as ${notionConnected.bot}` : ''}</div>
                    {envKeys.notion ? (
                      <button className="ci-upload-btn" onClick={handleNotionConnect}>Test</button>
                    ) : (
                      <button className="ci-clear-btn" onClick={() => {
                        update('notion_token', '')
                        setNotionConnected(null)
                      }}>
                        Disconnect
                      </button>
                    )}
                  </>
                ) : notionConnected && notionConnected !== 'checking' && !notionConnected.connected ? (
                  <>
                    <div className="integration-status error">Connection failed — check your token</div>
                    <button className="ci-upload-btn" onClick={handleNotionConnect}>
                      {envKeys.notion ? 'Retest' : 'Retry'}
                    </button>
                  </>
                ) : (
                  <button
                    className="ci-upload-btn"
                    disabled={notionConnected === 'checking' || (!settings.notion_token && !envKeys.notion)}
                    onClick={handleNotionConnect}
                  >
                    {notionConnected === 'checking' ? 'Checking...' : envKeys.notion ? 'Test' : 'Connect'}
                  </button>
                )}

                {/* Notion Sync Configuration — only show when connected */}
                {notionConnected && notionConnected.connected && (
                  <div style={{ marginTop: 12, padding: '12px', background: 'rgba(164, 120, 255, 0.04)', borderRadius: 'var(--radius-sm)' }}>
                    <div className="settings-label" style={{ marginBottom: 8 }}>Notion Sync</div>
                    {settings.notion_sync_parent_id ? (
                      <div style={{ fontSize: 13 }}>
                        <div style={{ marginBottom: 6 }}>
                          Syncing from: <strong>{settings.notion_sync_parent_title || 'Selected page'}</strong>
                          {notionSyncChildCount != null && (
                            <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>({notionSyncChildCount} child pages)</span>
                          )}
                        </div>
                        {settings.notion_last_sync && (
                          <div style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 8 }}>
                            Last synced: {new Date(settings.notion_last_sync).toLocaleString()}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="ci-upload-btn"
                            disabled={notionSyncing}
                            onClick={onNotionSync}
                          >
                            {notionSyncing ? 'Syncing...' : 'Sync Now'}
                          </button>
                          <button
                            className="ci-upload-btn"
                            onClick={() => {
                              update('notion_sync_parent_id', '')
                              update('notion_sync_parent_title', '')
                              setNotionSyncChildCount(null)
                            }}
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                          Select a parent page — its child pages will be pulled as tasks
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <input
                            className="add-input"
                            placeholder="Search Notion pages..."
                            value={notionSyncSearch}
                            onChange={e => setNotionSyncSearch(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleNotionSyncSearch()}
                            style={{ flex: 1, fontSize: 13 }}
                          />
                          <button
                            className="ci-upload-btn"
                            disabled={notionSyncSearching || !notionSyncSearch.trim()}
                            onClick={handleNotionSyncSearch}
                          >
                            {notionSyncSearching ? 'Searching...' : 'Search'}
                          </button>
                        </div>
                        {notionSyncResults && notionSyncResults.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {notionSyncResults.map(page => (
                              <button
                                key={page.id}
                                className="what-now-option"
                                style={{ textAlign: 'left', fontSize: 13, padding: '8px 12px' }}
                                onClick={() => handleSelectSyncParent(page)}
                              >
                                {page.title}
                              </button>
                            ))}
                          </div>
                        )}
                        {notionSyncResults && notionSyncResults.length === 0 && (
                          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No pages found</div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Page Template — collapsible */}
                {(settings.notion_token || envKeys.notion) && (
                  <div style={{ marginTop: 12 }}>
                    <button className="backlog-toggle" onClick={() => setShowCredentials(s => ({ ...s, notionTemplate: !s.notionTemplate }))} style={{ padding: '8px 0' }}>
                      <span className={`backlog-arrow ${showCredentials.notionTemplate ? 'open' : ''}`}><ChevronRight size={12} /></span>
                      Page Template
                    </button>
                    {showCredentials.notionTemplate && (
                      <>
                        <div className="settings-hint" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                          Structure for Notion pages. Use ## for headings, - [ ] for tasks, &gt; for callouts, --- for dividers.
                        </div>
                        <textarea
                          className="custom-instructions-input"
                          value={settings.notion_page_template ?? DEFAULT_SETTINGS.notion_page_template}
                          onChange={e => update('notion_page_template', e.target.value)}
                          rows={10}
                        />
                        <button
                          className="ci-upload-btn"
                          style={{ marginTop: 4, fontSize: 11 }}
                          onClick={() => update('notion_page_template', DEFAULT_SETTINGS.notion_page_template)}
                        >
                          Reset to Default
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Trello ── */}
          <div>
            <div
              className={`integration-row${expandedIntegration === 'trello' ? ' expanded' : ''}`}
              onClick={() => setExpandedIntegration(expandedIntegration === 'trello' ? null : 'trello')}
            >
              <span className={`backlog-arrow${expandedIntegration === 'trello' ? ' open' : ''}`}><ChevronRight size={12} /></span>
              <span className={`integration-dot ${trelloConnected ? 'connected' : trelloConnecting ? 'checking' : trelloError ? 'error' : 'unconfigured'}`} />
              <span className="integration-row-name">Trello</span>
              {expandedIntegration !== 'trello' && (
                <span className="integration-row-summary">
                  {trelloConnecting ? 'Checking...'
                    : trelloConnected ? `Connected as ${trelloUsername}`
                    : trelloError ? 'Error'
                    : envKeys.trello ? 'Environment variable' : (settings.trello_api_key && settings.trello_secret) ? 'Credentials saved' : 'Not configured'}
                </span>
              )}
            </div>
            {expandedIntegration === 'trello' && (
              <div className="integration-body">
                {envKeys.trello ? (
                  <div className="env-key-status">Set by environment variable</div>
                ) : (
                  <>
                    <button className="credentials-toggle" onClick={() => setShowCredentials(s => ({ ...s, trello: !s.trello }))}>
                      {showCredentials.trello ? 'Hide' : 'Show'} credentials
                    </button>
                    {showCredentials.trello && (
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
                          style={{ marginBottom: 8, fontSize: 13 }}
                        />
                      </>
                    )}
                  </>
                )}

                {trelloConnected ? (
                  <div>
                    <div className="integration-status connected" style={{ marginBottom: 8 }}>
                      Connected as <strong>{trelloUsername}</strong>
                    </div>
                    {envKeys.trello ? (
                      <button className="ci-upload-btn" style={{ marginBottom: 12 }} onClick={handleTrelloConnect}>
                        {trelloConnecting ? 'Testing...' : 'Test'}
                      </button>
                    ) : (
                      <button className="ci-clear-btn" style={{ marginBottom: 12 }} onClick={() => {
                        update('trello_api_key', '')
                        update('trello_secret', '')
                        setTrelloConnected(false)
                        setTrelloUsername(null)
                        setTrelloBoardsList([])
                        setTrelloListsList([])
                      }}>
                        Disconnect
                      </button>
                    )}

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
                    {trelloConnecting ? 'Checking...' : envKeys.trello ? 'Test' : 'Connect'}
                  </button>
                )}

                {trelloError && (
                  <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 8 }}>{trelloError}</div>
                )}
              </div>
            )}
          </div>

          {/* ── Google Calendar ── */}
          <div>
            <div
              className={`integration-row${expandedIntegration === 'gcal' ? ' expanded' : ''}`}
              onClick={() => setExpandedIntegration(expandedIntegration === 'gcal' ? null : 'gcal')}
            >
              <span className={`backlog-arrow${expandedIntegration === 'gcal' ? ' open' : ''}`}><ChevronRight size={12} /></span>
              <span className={`integration-dot ${gcalConnected ? 'connected' : gcalConnecting ? 'checking' : gcalError ? 'error' : 'unconfigured'}`} />
              <span className="integration-row-name">Google Calendar</span>
              {expandedIntegration !== 'gcal' && (
                <span className="integration-row-summary">
                  {gcalConnecting ? 'Connecting...'
                    : gcalConnected ? `Connected${gcalEmail ? ` as ${gcalEmail}` : ''}`
                    : gcalError ? 'Error'
                    : envKeys.gcal ? 'Environment variable' : 'Not configured'}
                </span>
              )}
            </div>
            {expandedIntegration === 'gcal' && (
              <div className="integration-body">
                {!envKeys.gcal && (
                  <>
                    <button className="credentials-toggle" onClick={() => setShowCredentials(s => ({ ...s, gcal: !s.gcal }))}>
                      {showCredentials.gcal ? 'Hide' : 'Show'} credentials
                    </button>
                    {showCredentials.gcal && (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                          Create OAuth credentials at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-link)' }}>Google Cloud Console</a>. Enable the Google Calendar API first.
                        </div>
                        <input
                          className="add-input"
                          type="password"
                          placeholder="Client ID"
                          value={settings.gcal_client_id || ''}
                          onChange={e => update('gcal_client_id', e.target.value)}
                          style={{ marginBottom: 8, fontSize: 13 }}
                        />
                        <input
                          className="add-input"
                          type="password"
                          placeholder="Client Secret"
                          value={settings.gcal_client_secret || ''}
                          onChange={e => update('gcal_client_secret', e.target.value)}
                          style={{ marginBottom: 8, fontSize: 13 }}
                        />
                      </>
                    )}
                  </>
                )}
                {envKeys.gcal && !gcalConnected && (
                  <div className="env-key-status">Set by environment variable</div>
                )}

                {gcalConnected ? (
                  <div>
                    <div className="integration-status connected" style={{ marginBottom: 8 }}>
                      Connected{gcalEmail && <> as <strong>{gcalEmail}</strong></>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                      <button className="ci-clear-btn" onClick={handleGcalDisconnect}>
                        Disconnect
                      </button>
                      <button
                        className="ci-clear-btn"
                        disabled={gcalBulkDeleting}
                        onClick={handleGcalBulkDelete}
                      >
                        {gcalBulkDeleting ? 'Deleting...' : 'Remove All Events'}
                      </button>
                    </div>
                    {gcalBulkDeleteResult && (
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>{gcalBulkDeleteResult}</div>
                    )}

                    {/* Calendar picker */}
                    <div className="settings-label" style={{ marginBottom: 6 }}>Calendar</div>
                    <select
                      className="add-input"
                      style={{ fontSize: 13, marginBottom: 12 }}
                      value={settings.gcal_calendar_id || 'primary'}
                      onChange={e => update('gcal_calendar_id', e.target.value)}
                    >
                      {gcalCalendars.length === 0 && <option value="primary">Primary</option>}
                      {gcalCalendars.map(c => (
                        <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (Primary)' : ''}</option>
                      ))}
                    </select>

                    {/* Push sync toggle */}
                    <label className="notif-check" style={{ marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!settings.gcal_sync_enabled}
                        onChange={e => update('gcal_sync_enabled', e.target.checked)}
                      />
                      <span>Sync tasks to Google Calendar</span>
                    </label>

                    {settings.gcal_sync_enabled && (
                      <div style={{ marginLeft: 24, marginBottom: 12 }}>
                        {/* Status filter */}
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Sync tasks with these statuses:</div>
                        {['not_started', 'doing', 'waiting', 'open'].map(status => (
                          <label key={status} className="notif-check" style={{ marginBottom: 2 }}>
                            <input
                              type="checkbox"
                              checked={(settings.gcal_sync_statuses || []).includes(status)}
                              onChange={e => {
                                const current = settings.gcal_sync_statuses || []
                                const next = e.target.checked
                                  ? [...current, status]
                                  : current.filter(s => s !== status)
                                update('gcal_sync_statuses', next)
                              }}
                            />
                            <span style={{ fontSize: 12 }}>{status.replace('_', ' ')}</span>
                          </label>
                        ))}

                        {/* Timed events toggle */}
                        <label className="notif-check" style={{ marginTop: 8, marginBottom: 4 }}>
                          <input
                            type="checkbox"
                            checked={!!settings.gcal_use_timed_events}
                            onChange={e => update('gcal_use_timed_events', e.target.checked)}
                          />
                          <span style={{ fontSize: 12 }}>AI-timed events (vs all-day)</span>
                        </label>
                        {!settings.gcal_use_timed_events && (
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Tasks appear as all-day events</div>
                        )}
                        {settings.gcal_use_timed_events && (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Fallback time:</span>
                            <input
                              type="time"
                              className="settings-input"
                              style={{ flex: 1 }}
                              value={settings.gcal_default_time || '09:00'}
                              onChange={e => update('gcal_default_time', e.target.value)}
                            />
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Duration:</span>
                            <input
                              type="number"
                              className="settings-input"
                              style={{ width: 60 }}
                              min={5}
                              max={480}
                              value={settings.gcal_event_duration || 60}
                              onChange={e => update('gcal_event_duration', parseInt(e.target.value, 10) || 60)}
                            />
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>min</span>
                          </div>
                        )}

                        {/* Remove on complete */}
                        <label className="notif-check" style={{ marginTop: 4 }}>
                          <input
                            type="checkbox"
                            checked={settings.gcal_remove_on_complete !== false}
                            onChange={e => update('gcal_remove_on_complete', e.target.checked)}
                          />
                          <span style={{ fontSize: 12 }}>Remove events when tasks completed</span>
                        </label>

                        {/* Event buffer */}
                        <label className="notif-check" style={{ marginTop: 4 }}>
                          <input
                            type="checkbox"
                            checked={!!settings.gcal_event_buffer}
                            onChange={e => update('gcal_event_buffer', e.target.checked)}
                          />
                          <span style={{ fontSize: 12 }}>Add 15-min buffer around events</span>
                        </label>
                      </div>
                    )}

                    {/* Pull sync toggle */}
                    <label className="notif-check" style={{ marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!settings.gcal_pull_enabled}
                        onChange={e => update('gcal_pull_enabled', e.target.checked)}
                      />
                      <span>Pull calendar events as tasks</span>
                    </label>

                    {settings.gcal_pull_enabled && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          className="ci-upload-btn"
                          disabled={gcalSyncing}
                          onClick={onGCalSync}
                        >
                          {gcalSyncing ? 'Syncing...' : 'Sync Now'}
                        </button>
                        {settings.gcal_last_sync && (
                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                            Last: {new Date(settings.gcal_last_sync).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    className="ci-upload-btn"
                    style={{ marginTop: 8 }}
                    disabled={gcalConnecting || (!settings.gcal_client_id && !envKeys.gcal)}
                    onClick={handleGcalConnect}
                  >
                    {gcalConnecting ? 'Connecting...' : 'Connect'}
                  </button>
                )}

                {gcalError && (
                  <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 8 }}>{gcalError}</div>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {/* Notifications */}
      {activeTab === 'Notifications' && (
        <div className="settings-group">
          <label className="notif-check">
            <input
              type="checkbox"
              checked={!!settings.notifications_enabled}
              onChange={async (e) => {
                if (e.target.checked) {
                  const perm = await Notification.requestPermission()
                  if (perm === 'granted') update('notifications_enabled', true)
                  else e.target.checked = false
                } else {
                  update('notifications_enabled', false)
                }
              }}
            />
            <span>Notifications</span>
          </label>

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
                Always on. Frequency escalates as due date approaches.
              </div>
              <label className="notif-check">
                <input type="checkbox" checked={settings.notif_highpri_escalate !== false} onChange={e => update('notif_highpri_escalate', e.target.checked)} />
                <span>Repeat until addressed</span>
              </label>
              {settings.notif_highpri_escalate !== false && (<>
              <div className="notif-type-row">
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-dim)' }}>Before due</span>
                <div className="notif-freq-input" style={{ marginLeft: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>every</span>
                  <input
                    className="settings-input"
                    type="number" min="0.25" max="168" step="0.25"
                    value={settings.notif_freq_highpri_before ?? 24}
                    onChange={e => update('notif_freq_highpri_before', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
                    style={{ width: 56, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>hrs</span>
                </div>
              </div>
              <div className="notif-type-row">
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-dim)' }}>On due date</span>
                <div className="notif-freq-input" style={{ marginLeft: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>every</span>
                  <input
                    className="settings-input"
                    type="number" min="0.25" max="24" step="0.25"
                    value={settings.notif_freq_highpri_due ?? 1}
                    onChange={e => update('notif_freq_highpri_due', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
                    style={{ width: 56, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>hrs</span>
                </div>
              </div>
              <div className="notif-type-row">
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-dim)' }}>When overdue</span>
                <div className="notif-freq-input" style={{ marginLeft: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>every</span>
                  <input
                    className="settings-input"
                    type="number" min="0.25" max="24" step="0.25"
                    value={settings.notif_freq_highpri_overdue ?? 0.5}
                    onChange={e => update('notif_freq_highpri_overdue', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
                    style={{ width: 56, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>hrs</span>
                </div>
              </div>
              </>)}

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
                      type="number" min="0.25" max="168" step="0.25"
                      value={settings.notif_freq_overdue ?? 0.5}
                      onChange={e => update('notif_freq_overdue', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
                      style={{ width: 56, textAlign: 'center' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>hrs</span>
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
                      type="number" min="0.25" max="168" step="0.25"
                      value={settings.notif_freq_stale ?? 0.5}
                      onChange={e => update('notif_freq_stale', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
                      style={{ width: 56, textAlign: 'center' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>hrs</span>
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
                      type="number" min="0.25" max="168" step="0.25"
                      value={settings.notif_freq_nudge ?? 1}
                      onChange={e => update('notif_freq_nudge', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
                      style={{ width: 56, textAlign: 'center' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>hrs</span>
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
                    type="number" min="0.25" max="168" step="0.25"
                    value={settings.notif_freq_size ?? 1}
                    onChange={e => update('notif_freq_size', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
                    style={{ width: 56, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>hrs</span>
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
                    type="number" min="0.25" max="168" step="0.25"
                    value={settings.notif_freq_pileup ?? 2}
                    onChange={e => update('notif_freq_pileup', Math.max(0.25, parseFloat(e.target.value) || 0.25))}
                    style={{ width: 56, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>hrs</span>
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
    </>
  )

  if (isDesktop) {
    return (
      <div className="sheet-overlay" onClick={onClose}>
        <div className="sheet" onClick={e => e.stopPropagation()}>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
          <div className="edit-task-title-row">
            <div className="sheet-title">Settings</div>
            {savePill}
            <span className="version-label">{__APP_VERSION__}</span>
          </div>
          {tabBar}
          {settingsContent}
        </div>
      </div>
    )
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
      {tabBar}
      {settingsContent}
    </div>
  )
}
