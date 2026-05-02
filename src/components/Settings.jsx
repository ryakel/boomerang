import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronRight } from 'lucide-react'
import './Settings.css'
import { loadSettings, saveSettings, loadLabels, saveLabels, loadTasks, saveTasks, loadRoutines, saveRoutines, LABEL_COLORS, loadNotifLog, clearNotifLog, logNotification, DEFAULT_SETTINGS, uuid } from '../store'
import { getKeyStatus, callClaude, notionStatus, notionMCPConnect, notionMCPStatus, notionMCPDisconnect, trelloStatus, trelloBoards, trelloBoardLists, notionSearch, notionGetChildPages, notionQueryDatabase, gcalGetAuthUrl, gcalStatus, gcalDisconnect, gcalListCalendars, gcalBulkDeleteEvents, gmailGetAuthUrl, gmailStatus, gmailDisconnect, gmailSync, gmailReset, emailStatus, testEmail, pushStatus, testPush, pushoverStatus, testPushover, testPushoverEmergency, testDigest, getWeather, refreshWeather, geocodeWeather } from '../api'
import { usePushSubscription } from '../hooks/usePushSubscription'

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

function ServerLogs() {
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
    <div className="settings-group">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="settings-label" style={{ margin: 0 }}>Server Logs</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ci-upload-btn" onClick={fetchLogs} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="ci-upload-btn" onClick={handleCopy} disabled={logs.length === 0}>
            {copied ? 'Copied!' : 'Copy All'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        {FILTERS.map(f => (
          <button
            key={f}
            className={`tag-pill${filter === f ? ' active' : ''}`}
            style={{ fontSize: 11, padding: '3px 8px' }}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'error' ? 'Errors' : f}
          </button>
        ))}
      </div>

      <div className="server-logs-container">
        {filtered.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: 12 }}>
            {loading ? 'Loading...' : 'No logs to display.'}
          </div>
        ) : (
          filtered.slice().reverse().map((l, i) => (
            <div key={i} className={`server-log-entry server-log-${l.level}`}>
              <span className="server-log-time">
                {new Date(l.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="server-log-msg">{l.msg}</span>
            </div>
          ))
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
        Showing {filtered.length} of {logs.length} entries (last 500 kept in memory)
      </div>
    </div>
  )
}

const TABS = ['General', 'AI', 'Labels', 'Integrations', 'Notifications', 'Data', 'Logs']

export default function Settings({ onClose, onClearCompleted, onClearAll, onTrelloSync, trelloSyncing, onNotionSync, notionSyncing, onGCalSync, gcalSyncing, onShowActivityLog, syncStatus, isDesktop }) {
  const [activeTab, setActiveTab] = useState('General')
  const [confirmDialog, setConfirmDialog] = useState(null) // { title, message, onConfirm }
  const [settings, setSettings] = useState(loadSettings)
  const [envKeys, setEnvKeys] = useState({ anthropic: false, notion: false, trello: false, tracking: false })

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
      // Always check Notion status, not just when the legacy env var is set —
      // the user may have connected via MCP, in which case keys.notion is false
      // but the server still reports connected: true via getNotionAccessToken().
      setNotionConnected('checking')
      notionStatus()
        .then(s => setNotionConnected(s))
        .catch(() => setNotionConnected({ connected: false }))
      if (keys.tracking) {
        import('../api').then(({ testTrackingConnection }) => {
          setTrackingStatus('checking')
          testTrackingConnection()
            .then(r => setTrackingStatus(r.connected ? 'connected' : 'error'))
            .catch(() => setTrackingStatus('error'))
        })
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
    emailStatus().then(setEmailSmtpStatus)
    pushStatus().then(setPushServerStatus)
    pushoverStatus().then(setPushoverServerStatus).catch(() => {})
  }, [])

  // Re-fetch Pushover server status when credentials change so the Integrations tab display stays fresh.
  // Uses a delay because the server only receives new credentials after flushSync (on close), but the
  // app_token_from_env flag is stable — the main value here is keeping the two fields in sync.
  useEffect(() => {
    const t = setTimeout(() => {
      pushoverStatus().then(setPushoverServerStatus).catch(() => {})
    }, 500)
    return () => clearTimeout(t)
  }, [settings.pushover_user_key, settings.pushover_app_token])

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

  // Email notification state
  const [emailSmtpStatus, setEmailSmtpStatus] = useState(null) // null | { configured, host, ... }
  const [emailTestStatus, setEmailTestStatus] = useState(null) // null | 'sending' | 'sent' | 'error'
  const [emailTestError, setEmailTestError] = useState(null)

  // Push notification state
  const pushSub = usePushSubscription()
  const [pushServerStatus, setPushServerStatus] = useState(null)
  const [pushTestStatus, setPushTestStatus] = useState(null) // null | 'sending' | 'sent' | 'error'
  const [pushTestError, setPushTestError] = useState(null)

  // Pushover state
  const [pushoverServerStatus, setPushoverServerStatus] = useState(null)
  const [pushoverTestStatus, setPushoverTestStatus] = useState(null) // null | 'sending' | 'sent' | 'error'
  const [pushoverTestError, setPushoverTestError] = useState(null)
  const [pushoverEmergencyStatus, setPushoverEmergencyStatus] = useState(null) // null | 'sending' | 'sent' | 'error'
  const [pushoverEmergencyError, setPushoverEmergencyError] = useState(null)

  // Digest test state
  const [digestTestStatus, setDigestTestStatus] = useState(null)
  const [digestTestError, setDigestTestError] = useState(null)

  // Tracking connection state
  const [trackingStatus, setTrackingStatus] = useState(null) // null | 'checking' | 'connected' | 'error'
  const [trackingError, setTrackingError] = useState(null)
  const handleTrackingConnect = async () => {
    setTrackingStatus('checking')
    setTrackingError(null)
    try {
      const { testTrackingConnection } = await import('../api')
      const result = await testTrackingConnection()
      if (result.connected) {
        setTrackingStatus('connected')
      } else {
        setTrackingStatus('error')
        setTrackingError(result.error || 'Connection failed')
      }
    } catch {
      setTrackingStatus('error')
      setTrackingError('Connection failed')
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
  const [notionDbInput, setNotionDbInput] = useState('')
  const [notionDbVerifying, setNotionDbVerifying] = useState(false)
  const [notionDbError, setNotionDbError] = useState(null)

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

  const handleConnectDatabase = async () => {
    const input = notionDbInput.trim()
    if (!input) return
    setNotionDbVerifying(true)
    setNotionDbError(null)
    try {
      // Parse database ID from URL or raw ID
      let dbId = input
      const urlMatch = input.match(/([a-f0-9]{32})/)
      if (urlMatch) dbId = urlMatch[1]
      // Format with dashes if needed (Notion IDs are UUIDs)
      if (dbId.length === 32 && !dbId.includes('-')) {
        dbId = `${dbId.slice(0,8)}-${dbId.slice(8,12)}-${dbId.slice(12,16)}-${dbId.slice(16,20)}-${dbId.slice(20)}`
      }
      // Test the connection by querying with no results
      const result = await notionQueryDatabase(dbId)
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

  const [notionMCP, setNotionMCP] = useState(null) // null | { connected, toolCount }
  const [notionMCPConnecting, setNotionMCPConnecting] = useState(false)
  const [notionMCPError, setNotionMCPError] = useState(null)

  const refreshNotionMCP = async () => {
    try {
      const s = await notionMCPStatus()
      setNotionMCP(s)
    } catch {
      setNotionMCP({ connected: false, toolCount: 0 })
    }
  }

  useEffect(() => { refreshNotionMCP() }, [])

  const handleNotionMCPConnect = async () => {
    setNotionMCPConnecting(true)
    setNotionMCPError(null)
    try {
      const out = await notionMCPConnect()
      if (out.alreadyAuthorized) {
        await refreshNotionMCP()
        return
      }
      window.open(out.authUrl, '_blank', 'width=600,height=700')
    } catch (err) {
      setNotionMCPError(err.message || 'Failed to start MCP auth')
    } finally {
      setNotionMCPConnecting(false)
    }
  }

  const handleNotionMCPDisconnect = async () => {
    try {
      await notionMCPDisconnect()
      await refreshNotionMCP()
    } catch (err) {
      setNotionMCPError(err.message || 'Failed to disconnect')
    }
  }

  // Listen for Notion MCP callback message
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'notion-mcp-connected') {
        refreshNotionMCP()
        // MCP connection also flips the /api/notion/status response, so refresh that too.
        notionStatus().then(s => setNotionConnected(s)).catch(() => {})
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

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

  const handleGcalBulkDelete = () => {
    setConfirmDialog({
      title: 'Remove All Events',
      message: 'Delete all Boomerang-managed events from Google Calendar? This will also unlink all tasks from their calendar events.',
      onConfirm: async () => {
        setConfirmDialog(null)
        setGcalBulkDeleting(true)
        setGcalBulkDeleteResult(null)
        try {
          const calendarId = settings.gcal_calendar_id || 'primary'
          const result = await gcalBulkDeleteEvents(calendarId)
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
      },
    })
  }

  // Gmail connection state
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailEmail, setGmailEmail] = useState(null)
  const [gmailConnecting, setGmailConnecting] = useState(false)
  const [gmailError, setGmailError] = useState(null)
  const [gmailSyncing, setGmailSyncing] = useState(false)
  const [gmailSyncResult, setGmailSyncResult] = useState(null)
  const [gmailLastSync, setGmailLastSync] = useState(null)

  const handleGmailConnect = async () => {
    setGmailConnecting(true)
    setGmailError(null)
    try {
      const { url } = await gmailGetAuthUrl()
      window.open(url, '_blank', 'width=500,height=600')
    } catch (err) {
      setGmailError(err.message)
    } finally {
      setGmailConnecting(false)
    }
  }

  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'gmail-connected') {
        gmailStatus().then(s => {
          setGmailConnected(s.connected)
          setGmailEmail(s.email)
          setGmailLastSync(s.lastSync)
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  useEffect(() => {
    gmailStatus().then(s => {
      if (s.connected) {
        setGmailConnected(true)
        setGmailEmail(s.email)
        setGmailLastSync(s.lastSync)
      }
    }).catch(() => {})
  }, [])

  const handleGmailDisconnect = async () => {
    try {
      await gmailDisconnect()
      setGmailConnected(false)
      setGmailEmail(null)
      setGmailSyncResult(null)
      setGmailLastSync(null)
      update('gmail_sync_enabled', false)
    } catch (err) {
      setGmailError(err.message)
    }
  }

  const handleGmailSync = async () => {
    setGmailSyncing(true)
    setGmailSyncResult(null)
    try {
      const result = await gmailSync(settings.gmail_scan_days || 7)
      if (result.error) {
        setGmailSyncResult(`Error: ${result.error}`)
      } else {
        const parts = []
        if (result.tasks > 0) parts.push(`${result.tasks} task${result.tasks !== 1 ? 's' : ''}`)
        if (result.packages > 0) parts.push(`${result.packages} package${result.packages !== 1 ? 's' : ''}`)
        if (parts.length === 0) parts.push('no new items')
        setGmailSyncResult(`Found ${parts.join(', ')} (${result.total} emails scanned)`)
        setGmailLastSync(new Date().toISOString())
      }
    } catch (err) {
      setGmailSyncResult(`Error: ${err.message}`)
    } finally {
      setGmailSyncing(false)
    }
  }

  // Weather state
  const [weatherStatus, setWeatherStatus] = useState(null)
  const [weatherSearchQuery, setWeatherSearchQuery] = useState('')
  const [weatherSearchResults, setWeatherSearchResults] = useState([])
  const [weatherSearching, setWeatherSearching] = useState(false)
  const [weatherSearchError, setWeatherSearchError] = useState(null)
  const [weatherRefreshing, setWeatherRefreshing] = useState(false)

  useEffect(() => {
    getWeather().then(s => setWeatherStatus(s)).catch(() => {})
  }, [])

  const handleWeatherSearch = async () => {
    const q = weatherSearchQuery.trim()
    if (!q) return
    setWeatherSearching(true)
    setWeatherSearchError(null)
    setWeatherSearchResults([])
    try {
      const results = await geocodeWeather(q)
      if (results.length === 0) setWeatherSearchError('No matches found')
      else setWeatherSearchResults(results)
    } catch (err) {
      setWeatherSearchError(err.message)
    } finally {
      setWeatherSearching(false)
    }
  }

  const handleWeatherPickLocation = async (result) => {
    update('weather_latitude', result.latitude)
    update('weather_longitude', result.longitude)
    update('weather_location_name', result.label)
    if (result.timezone) update('weather_timezone', result.timezone)
    if (!settings.weather_enabled) update('weather_enabled', true)
    setWeatherSearchResults([])
    setWeatherSearchQuery('')
    // Trigger server refresh so the cache updates before the user navigates away
    setTimeout(() => {
      refreshWeather({ force: true })
        .then(() => getWeather().then(s => setWeatherStatus(s)))
        .catch(() => {})
    }, 500)
  }

  const handleWeatherRefresh = async () => {
    setWeatherRefreshing(true)
    try {
      await refreshWeather({ force: true })
      const s = await getWeather()
      setWeatherStatus(s)
    } catch {
      // swallow — status UI will just show stale
    } finally {
      setWeatherRefreshing(false)
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
                  {notionMCP?.connected
                    ? `Connected via MCP — ${notionMCP.toolCount} tools`
                    : notionConnected && notionConnected !== 'checking' && notionConnected.connected
                    ? `Connected${notionConnected.bot ? ` as ${notionConnected.bot}` : ''} (legacy env)`
                    : envKeys.notion ? 'Environment variable' : 'Not connected'}
                </span>
              )}
            </div>
            {expandedIntegration === 'notion' && (
              <div className="integration-body">
                {/* MCP connection — the only supported interactive path */}
                {notionMCP?.connected ? (
                  <>
                    <div className="integration-status connected" style={{ marginBottom: 6 }}>
                      Connected via MCP — {notionMCP.toolCount} tools discovered
                    </div>
                    <button className="ci-clear-btn" onClick={handleNotionMCPDisconnect}>Disconnect</button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, marginBottom: 8 }}>
                      One-click OAuth into your Notion workspace. User-scoped access — no per-page sharing, no integration app to register.
                    </div>
                    <button className="ci-upload-btn" disabled={notionMCPConnecting} onClick={handleNotionMCPConnect}>
                      {notionMCPConnecting ? 'Opening...' : 'Connect via MCP'}
                    </button>
                    {notionMCPError && <div className="integration-status error" style={{ marginTop: 8 }}>{notionMCPError}</div>}
                    {envKeys.notion && (
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>
                        A legacy <code>NOTION_INTEGRATION_TOKEN</code> is set via env var and will be used as a fallback. Connecting via MCP is still recommended — it removes the per-page sharing requirement.
                      </div>
                    )}
                  </>
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

                {/* Notion Database Sync — only show when connected */}
                {notionConnected && notionConnected.connected && (
                  <div style={{ marginTop: 12, padding: '12px', background: 'rgba(164, 120, 255, 0.04)', borderRadius: 'var(--radius-sm)' }}>
                    <div className="settings-label" style={{ marginBottom: 8 }}>Database Sync</div>
                    {settings.notion_db_id ? (
                      <div style={{ fontSize: 13 }}>
                        <div style={{ marginBottom: 6 }}>
                          Database: <strong>{settings.notion_db_title || 'Connected'}</strong>
                        </div>
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
                              update('notion_db_id', '')
                              update('notion_db_title', '')
                            }}
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                          Paste a Notion database ID or URL to sync its rows as tasks
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                          <input
                            className="add-input"
                            placeholder="Database ID or URL..."
                            value={notionDbInput}
                            onChange={e => { setNotionDbInput(e.target.value); setNotionDbError(null) }}
                            onKeyDown={e => e.key === 'Enter' && handleConnectDatabase()}
                            style={{ flex: 1, fontSize: 13 }}
                          />
                          <button
                            className="ci-upload-btn"
                            disabled={notionDbVerifying || !notionDbInput.trim()}
                            onClick={handleConnectDatabase}
                          >
                            {notionDbVerifying ? 'Verifying...' : 'Connect'}
                          </button>
                        </div>
                        {notionDbError && (
                          <div style={{ fontSize: 12, color: '#FF3B30', marginTop: 4 }}>{notionDbError}</div>
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

                    {/* Multi-list sync selection */}
                    {settings.trello_board_id && trelloListsList.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div className="settings-label" style={{ marginBottom: 6 }}>Sync from lists</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>Select which lists to pull tasks from during sync.</div>
                        {trelloListsList.map(l => {
                          const syncListIds = settings.trello_sync_list_ids || [settings.trello_list_id].filter(Boolean)
                          const checked = syncListIds.includes(l.id)
                          return (
                            <label key={l.id} className="notif-check" style={{ marginBottom: 4 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  const current = settings.trello_sync_list_ids || [settings.trello_list_id].filter(Boolean)
                                  const next = e.target.checked
                                    ? [...current, l.id]
                                    : current.filter(id => id !== l.id)
                                  update('trello_sync_list_ids', next)
                                }}
                              />
                              <span style={{ fontSize: 13 }}>{l.name}</span>
                            </label>
                          )
                        })}
                      </div>
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
                      <button className="gcal-action-btn" onClick={handleGcalDisconnect}>
                        Disconnect
                      </button>
                      <button
                        className="gcal-action-btn gcal-action-btn-danger"
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
                      <>
                        <div style={{ marginTop: 8, marginBottom: 8 }}>
                          <div className="settings-label" style={{ marginBottom: 4 }}>Filter by title (optional)</div>
                          <input
                            className="add-input"
                            placeholder="e.g. FAA, IFR Exam..."
                            value={settings.gcal_pull_filter || ''}
                            onChange={e => update('gcal_pull_filter', e.target.value)}
                            style={{ fontSize: 14, marginBottom: 0 }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                      </>
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

          {/* ── Gmail ── */}
          <div>
            <div
              className={`integration-row${expandedIntegration === 'gmail' ? ' expanded' : ''}`}
              onClick={() => setExpandedIntegration(expandedIntegration === 'gmail' ? null : 'gmail')}
            >
              <span className={`backlog-arrow${expandedIntegration === 'gmail' ? ' open' : ''}`}><ChevronRight size={12} /></span>
              <span className={`integration-dot ${gmailConnected ? 'connected' : gmailConnecting ? 'checking' : gmailError ? 'error' : 'unconfigured'}`} />
              <span className="integration-row-name">Gmail</span>
              {expandedIntegration !== 'gmail' && (
                <span className="integration-row-summary">
                  {gmailConnecting ? 'Connecting...'
                    : gmailConnected ? `Connected${gmailEmail ? ` as ${gmailEmail}` : ''}`
                    : gmailError ? 'Error'
                    : 'Not connected'}
                </span>
              )}
            </div>
            {expandedIntegration === 'gmail' && (
              <div className="integration-body">
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Uses the same Google OAuth credentials as Google Calendar. Enable the Gmail API in your Google Cloud project.
                </div>

                {gmailConnected ? (
                  <div>
                    <div className="integration-status connected" style={{ marginBottom: 8 }}>
                      Connected{gmailEmail && <> as <strong>{gmailEmail}</strong></>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                      <button className="gcal-action-btn" onClick={handleGmailDisconnect}>
                        Disconnect
                      </button>
                    </div>

                    <label className="notif-check" style={{ marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!settings.gmail_sync_enabled}
                        onChange={e => update('gmail_sync_enabled', e.target.checked)}
                      />
                      <span>Auto-scan for tasks &amp; packages</span>
                    </label>

                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Scan window (days back):</div>
                      <input
                        type="number"
                        className="settings-input"
                        style={{ width: 60 }}
                        min={1}
                        max={30}
                        value={settings.gmail_scan_days || 7}
                        onChange={e => update('gmail_scan_days', parseInt(e.target.value, 10) || 7)}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        className="ci-upload-btn"
                        disabled={gmailSyncing}
                        onClick={handleGmailSync}
                      >
                        {gmailSyncing ? 'Scanning...' : 'Scan Now'}
                      </button>
                      <button
                        className="ci-upload-btn"
                        disabled={gmailSyncing}
                        onClick={async () => {
                          await gmailReset()
                          setGmailSyncResult(null)
                          setGmailLastSync(null)
                          handleGmailSync()
                        }}
                      >
                        {gmailSyncing ? 'Scanning...' : 'Reset & Rescan'}
                      </button>
                    </div>
                    {gmailLastSync && (
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                        Last: {new Date(gmailLastSync).toLocaleString()}
                      </div>
                    )}

                    {gmailSyncResult && (
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>{gmailSyncResult}</div>
                    )}

                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 12, lineHeight: 1.4 }}>
                      Items found in emails appear as pending cards with a yellow border. Tap to expand, then Keep or Dismiss.
                    </div>
                  </div>
                ) : (
                  <button
                    className="ci-upload-btn"
                    style={{ marginTop: 8 }}
                    disabled={gmailConnecting || (!settings.gcal_client_id && !envKeys.gcal)}
                    onClick={handleGmailConnect}
                  >
                    {gmailConnecting ? 'Connecting...' : 'Connect'}
                  </button>
                )}

                {gmailError && (
                  <div style={{ color: 'var(--accent)', fontSize: 12, marginTop: 8 }}>{gmailError}</div>
                )}
              </div>
            )}
          </div>

          {/* ── Package Tracking (17track) ── */}
          <div>
            <div
              className={`integration-row${expandedIntegration === 'tracking' ? ' expanded' : ''}`}
              onClick={() => setExpandedIntegration(expandedIntegration === 'tracking' ? null : 'tracking')}
            >
              <span className={`backlog-arrow${expandedIntegration === 'tracking' ? ' open' : ''}`}><ChevronRight size={12} /></span>
              <span className={`integration-dot ${trackingStatus === 'connected' ? 'connected' : trackingStatus === 'error' ? 'error' : trackingStatus === 'checking' ? 'checking' : 'unconfigured'}`} />
              <span className="integration-row-name">Package Tracking (17track)</span>
              {expandedIntegration !== 'tracking' && (
                <span className="integration-row-summary">
                  {trackingStatus === 'checking' ? 'Checking...' : trackingStatus === 'connected' ? 'Connected' : trackingStatus === 'error' ? 'Error' : envKeys.tracking ? 'Environment variable' : settings.tracking_api_key ? 'Key saved' : 'Not configured'}
                </span>
              )}
            </div>
            {expandedIntegration === 'tracking' && (
              <div className="integration-body">
                {envKeys.tracking ? (
                  <div className="env-key-status">Set by environment variable</div>
                ) : (
                  <>
                    <button className="credentials-toggle" onClick={() => setShowCredentials(s => ({ ...s, tracking: !s.tracking }))}>
                      {showCredentials.tracking ? 'Hide' : 'Show'} API key
                    </button>
                    {showCredentials.tracking && (
                      <input
                        className="add-input"
                        type="password"
                        placeholder="17track API key"
                        value={settings.tracking_api_key || ''}
                        onChange={e => { update('tracking_api_key', e.target.value); setTrackingStatus(null) }}
                        style={{ marginBottom: 8, fontSize: 13 }}
                      />
                    )}
                  </>
                )}

                {trackingStatus === 'connected' ? (
                  <div className="integration-status connected">Connected</div>
                ) : trackingStatus === 'error' ? (
                  <>
                    <div className="integration-status error">Connection failed{trackingError ? `: ${trackingError}` : ''}</div>
                    <button className="ci-upload-btn" onClick={handleTrackingConnect} style={{ marginBottom: 8 }}>
                      Retry
                    </button>
                  </>
                ) : (
                  <button
                    className="ci-upload-btn"
                    onClick={handleTrackingConnect}
                    disabled={trackingStatus === 'checking'}
                    style={{ marginBottom: 8 }}
                  >
                    {trackingStatus === 'checking' ? 'Testing...' : 'Test Connection'}
                  </button>
                )}

                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
                  Get a free API key at <a href="https://api.17track.net" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-link)' }}>api.17track.net</a>. Without a key, tracking works as a manual notebook with carrier links.
                </div>

                <div className="settings-label" style={{ marginTop: 8 }}>Auto-cleanup delivered packages</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <input
                    type="number"
                    className="settings-input"
                    min="1"
                    max="30"
                    value={settings.package_retention_days ?? 3}
                    onChange={e => update('package_retention_days', parseInt(e.target.value, 10) || 3)}
                    style={{ width: 60 }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>days after delivery</span>
                </div>

                <div className="settings-label">Notifications</div>
                <label className="notif-check">
                  <input type="checkbox" checked={settings.package_notify_delivered !== false} onChange={e => update('package_notify_delivered', e.target.checked)} />
                  <span>Notify on delivery</span>
                </label>
                <label className="notif-check">
                  <input type="checkbox" checked={settings.package_notify_exception !== false} onChange={e => update('package_notify_exception', e.target.checked)} />
                  <span>Notify on delays / exceptions</span>
                </label>
                <label className="notif-check">
                  <input type="checkbox" checked={settings.package_notify_signature !== false} onChange={e => update('package_notify_signature', e.target.checked)} />
                  <span>Notify when signature required</span>
                </label>
                <label className="notif-check">
                  <input type="checkbox" checked={settings.package_auto_task_signature !== false} onChange={e => update('package_auto_task_signature', e.target.checked)} />
                  <span>Auto-create errand task for signature required</span>
                </label>
              </div>
            )}
          </div>

          {/* ── Weather ── */}
          <div>
            <div
              className={`integration-row${expandedIntegration === 'weather' ? ' expanded' : ''}`}
              onClick={() => setExpandedIntegration(expandedIntegration === 'weather' ? null : 'weather')}
            >
              <span className={`backlog-arrow${expandedIntegration === 'weather' ? ' open' : ''}`}><ChevronRight size={12} /></span>
              <span className={`integration-dot ${settings.weather_enabled && settings.weather_latitude != null ? 'connected' : 'unconfigured'}`} />
              <span className="integration-row-name">Weather</span>
              {expandedIntegration !== 'weather' && (
                <span className="integration-row-summary">
                  {settings.weather_enabled && settings.weather_location_name
                    ? settings.weather_location_name
                    : settings.weather_enabled
                      ? 'Enabled (no location)'
                      : 'Not configured'}
                </span>
              )}
            </div>
            {expandedIntegration === 'weather' && (
              <div className="integration-body">
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Uses <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-link)' }}>Open-Meteo</a> (free, no API key). Updates every 30 min when enabled.
                </div>

                <label className="notif-check" style={{ marginBottom: 10 }}>
                  <input
                    type="checkbox"
                    checked={!!settings.weather_enabled}
                    onChange={e => update('weather_enabled', e.target.checked)}
                  />
                  <span>Enable weather features</span>
                </label>

                {settings.weather_enabled && (
                  <>
                    <div className="settings-label" style={{ marginTop: 4, marginBottom: 4 }}>Location</div>
                    {settings.weather_location_name ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, color: 'var(--text)' }}>{settings.weather_location_name}</span>
                        <button
                          className="ci-clear-btn"
                          onClick={() => {
                            update('weather_latitude', null)
                            update('weather_longitude', null)
                            update('weather_location_name', null)
                          }}
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <input
                            className="add-input"
                            type="text"
                            placeholder="City, zip, or address"
                            value={weatherSearchQuery}
                            onChange={e => setWeatherSearchQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleWeatherSearch() } }}
                            style={{ fontSize: 13, flex: 1 }}
                          />
                          <button
                            className="ci-upload-btn"
                            onClick={handleWeatherSearch}
                            disabled={weatherSearching || !weatherSearchQuery.trim()}
                          >
                            {weatherSearching ? 'Searching...' : 'Search'}
                          </button>
                        </div>
                        {weatherSearchError && (
                          <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 6 }}>{weatherSearchError}</div>
                        )}
                        {weatherSearchResults.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {weatherSearchResults.map(r => (
                              <button
                                key={`${r.latitude},${r.longitude}`}
                                className="ci-upload-btn"
                                style={{ textAlign: 'left', fontSize: 13, padding: '6px 10px' }}
                                onClick={() => handleWeatherPickLocation(r)}
                              >
                                {r.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {weatherStatus?.cache?.forecast?.days?.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                        {weatherStatus.cache.forecast.days.slice(0, 3).map((d, i) => {
                          const [y, m, day] = d.date.split('-').map(Number)
                          const dt = new Date(y, m - 1, day)
                          const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dt.toLocaleDateString('en-US', { weekday: 'short' })
                          return (
                            <div key={d.date}>
                              <strong>{label}:</strong> {Math.round(d.temp_max)}°/{Math.round(d.temp_min)}°, {d.precipitation_prob_max ?? 0}% precip
                            </div>
                          )
                        })}
                        {weatherStatus.cache.fetched_at && (
                          <div style={{ marginTop: 4, opacity: 0.7 }}>
                            Updated {new Date(weatherStatus.cache.fetched_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <button
                        className="ci-upload-btn"
                        onClick={handleWeatherRefresh}
                        disabled={weatherRefreshing || settings.weather_latitude == null}
                      >
                        {weatherRefreshing ? 'Refreshing...' : 'Refresh now'}
                      </button>
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, marginBottom: 12 }}>
                      Per-task control: tag a task with <code>outside</code> to force-show the weather widget, or <code>inside</code> to collapse it into a drawer. Otherwise auto-detected from energy + title.
                    </div>

                    <div className="settings-label">Notifications</div>
                    <label className="notif-check">
                      <input
                        type="checkbox"
                        checked={settings.weather_notifications_enabled !== false}
                        onChange={e => update('weather_notifications_enabled', e.target.checked)}
                      />
                      <span>Send weather alerts (rough weekend, rare nice day, etc.)</span>
                    </label>
                    <label className="notif-check">
                      <input
                        type="checkbox"
                        checked={settings.weather_notif_push !== false}
                        onChange={e => update('weather_notif_push', e.target.checked)}
                        disabled={settings.weather_notifications_enabled === false}
                      />
                      <span>Deliver via push</span>
                    </label>
                    <label className="notif-check">
                      <input
                        type="checkbox"
                        checked={settings.weather_notif_email !== false}
                        onChange={e => update('weather_notif_email', e.target.checked)}
                        disabled={settings.weather_notifications_enabled === false}
                      />
                      <span>Deliver via email</span>
                    </label>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Pushover Integration */}
          <div className="settings-group" style={{ marginTop: 24 }}>
            <div className="settings-label">Pushover</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
              Reliable iOS notifications via the Pushover app's APNs entitlements. Bypasses Safari web-push throttling. Supports Emergency priority (repeats every 30s, bypasses Do Not Disturb). Requires the Pushover iOS app ($5 one-time) and an account at <a href="https://pushover.net" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>pushover.net</a>.
            </div>

            <label className="notif-check" style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={!!settings.pushover_notifications_enabled}
                onChange={e => update('pushover_notifications_enabled', e.target.checked)}
              />
              <span>Enable Pushover</span>
            </label>

            {settings.pushover_notifications_enabled && (
              <>
                <div className="settings-label" style={{ marginTop: 8 }}>Public app URL (for deep links)</div>
                <input
                  className="add-input"
                  type="text"
                  placeholder="https://boomerang.example.com"
                  value={settings.public_app_url || ''}
                  onChange={e => update('public_app_url', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', marginBottom: 4, fontSize: 13 }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>
                  When set, notifications include an "Open in Boomerang" link that opens the relevant task. Required for tappable Pushover messages.
                </div>

                <div className="settings-label">Credentials</div>
                <input
                  className="add-input"
                  type="password"
                  placeholder="User Key (from pushover.net dashboard)"
                  value={settings.pushover_user_key || ''}
                  onChange={e => update('pushover_user_key', e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, fontSize: 13 }}
                />
                <input
                  className="add-input"
                  type="password"
                  placeholder={pushoverServerStatus?.app_token_from_env ? 'App Token (set by env var)' : 'App Token (create app named "Boomerang" in dashboard)'}
                  value={settings.pushover_app_token || ''}
                  onChange={e => update('pushover_app_token', e.target.value)}
                  disabled={pushoverServerStatus?.app_token_from_env && !settings.pushover_app_token}
                  style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, fontSize: 13 }}
                />

                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8, marginBottom: 12, padding: 8, background: 'var(--surface-elevated, rgba(0,0,0,0.04))', borderRadius: 6 }}>
                  <strong>Priority levels:</strong> nudges and stage-1 reminders use normal priority. Overdue and stage-2 high-priority use high priority (alert sound, bypasses quiet hours). Stage-3 high-priority and avoidance-flagged overdue use Emergency priority (repeats every 30s for up to 1 hour, bypasses Do Not Disturb). Per-task opt-in via the <code>wake-me</code> label keeps you covered during quiet hours only for tasks you've explicitly flagged.
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Configure which notification types fire over Pushover in the <strong>Notifications</strong> tab.
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <button
                    className="ci-upload-btn"
                    disabled={pushoverTestStatus === 'sending'}
                    onClick={async () => {
                      setPushoverTestStatus('sending')
                      setPushoverTestError(null)
                      try {
                        const result = await testPushover()
                        if (result.success) {
                          setPushoverTestStatus('sent')
                          setTimeout(() => setPushoverTestStatus(null), 3000)
                        } else {
                          setPushoverTestStatus('error')
                          setPushoverTestError(result.error || 'Send failed')
                        }
                      } catch {
                        setPushoverTestStatus('error')
                        setPushoverTestError('Send failed')
                      }
                    }}
                  >
                    {pushoverTestStatus === 'sending' ? 'Sending...' : pushoverTestStatus === 'sent' ? 'Sent!' : 'Test Pushover'}
                  </button>
                  <button
                    className="ci-upload-btn"
                    style={{ background: '#FF6240' }}
                    disabled={pushoverEmergencyStatus === 'sending'}
                    onClick={async () => {
                      if (!confirm('This will trigger a priority-2 Emergency alarm on your iOS device that repeats every 30 seconds. It will auto-cancel after 90 seconds. Continue?')) return
                      setPushoverEmergencyStatus('sending')
                      setPushoverEmergencyError(null)
                      try {
                        const result = await testPushoverEmergency()
                        if (result.success) {
                          setPushoverEmergencyStatus('sent')
                          setTimeout(() => setPushoverEmergencyStatus(null), 5000)
                        } else {
                          setPushoverEmergencyStatus('error')
                          setPushoverEmergencyError(result.error || 'Send failed')
                        }
                      } catch {
                        setPushoverEmergencyStatus('error')
                        setPushoverEmergencyError('Send failed')
                      }
                    }}
                  >
                    {pushoverEmergencyStatus === 'sending' ? 'Triggering...' : pushoverEmergencyStatus === 'sent' ? 'Alarm sent!' : 'Test Emergency'}
                  </button>
                </div>
                {pushoverTestStatus === 'error' && pushoverTestError && (
                  <div style={{ fontSize: 12, color: '#FF6240', marginTop: 4 }}>{pushoverTestError}</div>
                )}
                {pushoverEmergencyStatus === 'error' && pushoverEmergencyError && (
                  <div style={{ fontSize: 12, color: '#FF6240', marginTop: 4 }}>{pushoverEmergencyError}</div>
                )}
              </>
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
                <>
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
                  <div style={{ marginTop: 12 }}>
                    <div className="settings-label" style={{ marginBottom: 4 }}>Bypass label</div>
                    <input
                      className="add-input"
                      type="text"
                      value={settings.quiet_hours_bypass_label || 'wake-me'}
                      onChange={e => update('quiet_hours_bypass_label', e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 13 }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                      Tasks tagged with this label can wake you during quiet hours (Pushover priority 1+2 only). Default: <code>wake-me</code>. Use the "Wake me up for this" checkbox in EditTask to opt a task in.
                    </div>
                  </div>
                </>
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

          {/* Morning Digest */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div className="settings-label" style={{ marginBottom: 8 }}>Morning Digest</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
              Curated daily summary — yesterday recap + streak, today's focus, coming up, what you're carrying, and quick wins. Tasks are tappable links into the app.
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Style:</span>
              <select
                value={settings.digest_style || 'curated'}
                onChange={e => update('digest_style', e.target.value)}
                style={{ fontSize: 13, padding: '4px 8px' }}
              >
                <option value="curated">Curated (recommended)</option>
                <option value="counts">Counts only (legacy)</option>
              </select>
            </div>

            <label className="notif-check" style={{ marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={!!settings.email_digest_enabled}
                onChange={e => update('email_digest_enabled', e.target.checked)}
              />
              <span>Email digest</span>
            </label>
            <label className="notif-check" style={{ marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={!!settings.push_digest_enabled}
                onChange={e => update('push_digest_enabled', e.target.checked)}
              />
              <span>Web push digest</span>
            </label>
            <label className="notif-check" style={{ marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={!!settings.pushover_digest_enabled}
                onChange={e => update('pushover_digest_enabled', e.target.checked)}
              />
              <span>Pushover digest</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Time:</span>
              <input
                type="time"
                className="settings-input"
                value={settings.digest_time || '07:00'}
                onChange={e => update('digest_time', e.target.value)}
                style={{ width: 120, fontSize: 13 }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <button
                className="ci-upload-btn"
                disabled={digestTestStatus === 'sending'}
                onClick={async () => {
                  setDigestTestStatus('sending')
                  setDigestTestError(null)
                  try {
                    const result = await testDigest()
                    if (result.success) {
                      setDigestTestStatus('sent')
                      setDigestTestError(`Sent via ${result.fired.join(', ')}`)
                      setTimeout(() => setDigestTestStatus(null), 4000)
                    } else {
                      setDigestTestStatus('error')
                      setDigestTestError(result.error || 'No channels enabled or all failed')
                    }
                  } catch (e) {
                    setDigestTestStatus('error')
                    setDigestTestError(e.message || 'Send failed')
                  }
                }}
              >
                {digestTestStatus === 'sending' ? 'Sending...' : digestTestStatus === 'sent' ? 'Sent!' : 'Test daily digest'}
              </button>
              {digestTestError && (
                <div style={{ fontSize: 12, color: digestTestStatus === 'error' ? '#FF6240' : '#52C97F', marginTop: 4 }}>
                  {digestTestError}
                </div>
              )}
            </div>
          </div>

          {/* Push Notifications */}
          {pushSub.supported && pushServerStatus?.configured && (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <label className="notif-check">
                <input
                  type="checkbox"
                  checked={!!settings.push_notifications_enabled}
                  onChange={e => update('push_notifications_enabled', e.target.checked)}
                />
                <span>Push notifications (background)</span>
              </label>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, marginBottom: 8 }}>
                Receive notifications even when the app is closed.
              </div>

              {settings.push_notifications_enabled && (
                <div className="notif-options">
                  {!pushSub.subscribed ? (
                    <>
                      <button
                        className="ci-upload-btn"
                        disabled={pushSub.loading}
                        onClick={async () => {
                          setPushTestStatus(null)
                          setPushTestError(null)
                          const result = await pushSub.subscribe()
                          if (!result.success) {
                            setPushTestStatus('error')
                            setPushTestError(result.error)
                          }
                        }}
                      >
                        {pushSub.loading ? 'Enabling...' : 'Enable push for this device'}
                      </button>
                      {pushTestStatus === 'error' && pushTestError && (
                        <div style={{ fontSize: 12, color: '#FF6240', marginTop: 8 }}>{pushTestError}</div>
                      )}
                      {!pushSub.supported && (
                        <div style={{ fontSize: 12, color: '#FF6240', marginTop: 8 }}>Push not supported on this browser/device.</div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: '#52C97F', marginBottom: 8 }}>
                        Push enabled on this device
                      </div>

                      <div className="settings-label">Push me about</div>

                      <div className="notif-type-row">
                        <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                          <input type="checkbox" checked={settings.push_notif_highpri !== false} onChange={e => update('push_notif_highpri', e.target.checked)} />
                          <span>High priority tasks</span>
                        </label>
                      </div>

                      <div className="notif-type-row">
                        <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                          <input type="checkbox" checked={settings.push_notif_overdue !== false} onChange={e => update('push_notif_overdue', e.target.checked)} />
                          <span>Overdue tasks</span>
                        </label>
                      </div>

                      <div className="notif-type-row">
                        <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                          <input type="checkbox" checked={settings.push_notif_stale !== false} onChange={e => update('push_notif_stale', e.target.checked)} />
                          <span>Stale tasks</span>
                        </label>
                      </div>

                      <div className="notif-type-row">
                        <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                          <input type="checkbox" checked={settings.push_notif_nudge !== false} onChange={e => update('push_notif_nudge', e.target.checked)} />
                          <span>Nudges</span>
                        </label>
                      </div>

                      <div className="notif-type-row">
                        <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                          <input type="checkbox" checked={settings.push_notif_size !== false} onChange={e => update('push_notif_size', e.target.checked)} />
                          <span>Size-based reminders</span>
                        </label>
                      </div>

                      <div className="notif-type-row">
                        <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                          <input type="checkbox" checked={settings.push_notif_pileup !== false} onChange={e => update('push_notif_pileup', e.target.checked)} />
                          <span>Pile-up warnings</span>
                        </label>
                      </div>

                      <div className="notif-type-row">
                        <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                          <input type="checkbox" checked={settings.push_notif_package_delivered !== false} onChange={e => update('push_notif_package_delivered', e.target.checked)} />
                          <span>Package delivered</span>
                        </label>
                      </div>

                      <div className="notif-type-row">
                        <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                          <input type="checkbox" checked={settings.push_notif_package_exception !== false} onChange={e => update('push_notif_package_exception', e.target.checked)} />
                          <span>Package exceptions</span>
                        </label>
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button
                          className="ci-upload-btn"
                          disabled={pushTestStatus === 'sending'}
                          onClick={async () => {
                            setPushTestStatus('sending')
                            setPushTestError(null)
                            try {
                              const result = await testPush()
                              if (result.success) {
                                setPushTestStatus('sent')
                                setTimeout(() => setPushTestStatus(null), 3000)
                              } else {
                                setPushTestStatus('error')
                                setPushTestError(result.error || 'Send failed')
                              }
                            } catch {
                              setPushTestStatus('error')
                              setPushTestError('Send failed')
                            }
                          }}
                        >
                          {pushTestStatus === 'sending' ? 'Sending...' : pushTestStatus === 'sent' ? 'Sent!' : 'Test push'}
                        </button>
                        <button
                          className="ci-upload-btn"
                          style={{ color: '#ef4444' }}
                          onClick={async () => {
                            await pushSub.unsubscribe()
                          }}
                        >
                          Disable push
                        </button>
                      </div>
                      {pushTestStatus === 'error' && pushTestError && (
                        <div style={{ fontSize: 12, color: '#FF6240', marginTop: 4 }}>{pushTestError}</div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Pushover — per-type toggles only. Credentials + test buttons live in the Integrations tab. */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div className="settings-label" style={{ marginBottom: 4 }}>Pushover</div>
            {!settings.pushover_notifications_enabled || !(settings.pushover_user_key && (settings.pushover_app_token || pushoverServerStatus?.app_token_from_env)) ? (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: 8, background: 'var(--surface-elevated, rgba(0,0,0,0.04))', borderRadius: 6 }}>
                Pushover isn't connected yet. Set it up in <strong>Settings → Integrations → Pushover</strong>, then come back here to choose which notifications fire over the channel.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Choose which notification types fire over Pushover. Connection settings live in the Integrations tab.
                </div>

                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.pushover_notif_highpri !== false} onChange={e => update('pushover_notif_highpri', e.target.checked)} />
                    <span>High priority tasks</span>
                  </label>
                </div>
                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.pushover_notif_overdue !== false} onChange={e => update('pushover_notif_overdue', e.target.checked)} />
                    <span>Overdue tasks</span>
                  </label>
                </div>
                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.pushover_notif_stale === true} onChange={e => update('pushover_notif_stale', e.target.checked)} />
                    <span>Stale tasks</span>
                  </label>
                </div>
                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.pushover_notif_nudge === true} onChange={e => update('pushover_notif_nudge', e.target.checked)} />
                    <span>Nudges</span>
                  </label>
                </div>
                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.pushover_notif_size === true} onChange={e => update('pushover_notif_size', e.target.checked)} />
                    <span>Size-based reminders</span>
                  </label>
                </div>
                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.pushover_notif_pileup !== false} onChange={e => update('pushover_notif_pileup', e.target.checked)} />
                    <span>Pile-up warnings</span>
                  </label>
                </div>
                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.pushover_notif_package_delivered !== false} onChange={e => update('pushover_notif_package_delivered', e.target.checked)} />
                    <span>Package delivered</span>
                  </label>
                </div>
                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.pushover_notif_package_exception !== false} onChange={e => update('pushover_notif_package_exception', e.target.checked)} />
                    <span>Package exceptions</span>
                  </label>
                </div>
              </>
            )}
          </div>

          {/* Email Notifications */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <label className="notif-check">
              <input
                type="checkbox"
                checked={!!settings.email_notifications_enabled}
                onChange={e => update('email_notifications_enabled', e.target.checked)}
              />
              <span>Email notifications</span>
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, marginBottom: 8 }}>
              Send notifications via email when the app isn't open. Requires SMTP configuration via environment variables.
            </div>

            {emailSmtpStatus && !emailSmtpStatus.configured && settings.email_notifications_enabled && (
              <div style={{ fontSize: 12, color: '#FF6240', marginBottom: 8 }}>
                {!emailSmtpStatus.smtp_configured
                  ? 'SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS environment variables.'
                  : 'No recipient email. Set an email address below or NOTIFICATION_EMAIL env var.'}
              </div>
            )}

            {settings.email_notifications_enabled && (
              <div className="notif-options">
                <div className="settings-label">Email address</div>
                {emailSmtpStatus?.recipient_source === 'env' ? (
                  <>
                    <div className="settings-input" style={{ width: '100%', boxSizing: 'border-box', opacity: 0.7, cursor: 'not-allowed' }}>
                      {emailSmtpStatus.recipient}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                      Set via NOTIFICATION_EMAIL env var. Remove the env var to use a custom address here.
                    </div>
                  </>
                ) : (
                  <>
                    <input
                      className="settings-input"
                      type="email"
                      placeholder="you@example.com"
                      value={settings.email_address || ''}
                      onChange={e => update('email_address', e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                      Can also be set via NOTIFICATION_EMAIL env var.
                    </div>
                  </>
                )}

                {emailSmtpStatus?.configured && (
                  <div style={{ fontSize: 12, color: '#52C97F', marginTop: 8 }}>
                    SMTP connected ({emailSmtpStatus.host}:{emailSmtpStatus.port})
                  </div>
                )}

                <div className="settings-label" style={{ marginTop: 16 }}>From address (deliverability)</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="add-input"
                    type="text"
                    placeholder="From name"
                    value={settings.email_from_name || ''}
                    onChange={e => update('email_from_name', e.target.value)}
                    style={{ flex: 1, fontSize: 13 }}
                  />
                  <input
                    className="add-input"
                    type="email"
                    placeholder="digest@yourdomain.com"
                    value={settings.email_from_address || ''}
                    onChange={e => update('email_from_address', e.target.value)}
                    style={{ flex: 2, fontSize: 13 }}
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                  For digests to land in your inbox (not spam), use an address from a domain you control with SPF, DKIM, and DMARC records configured on your SMTP relay (Postmark, Resend, Mailgun, SES). Defaults to the SMTP user.
                </div>

                <div className="settings-label" style={{ marginTop: 16 }}>Email me about</div>

                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={!!settings.email_batch_mode} onChange={e => update('email_batch_mode', e.target.checked)} />
                    <span>Batch mode (combine into one email)</span>
                  </label>
                </div>

                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.email_notif_highpri !== false} onChange={e => update('email_notif_highpri', e.target.checked)} />
                    <span>High priority tasks</span>
                  </label>
                </div>

                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.email_notif_overdue !== false} onChange={e => update('email_notif_overdue', e.target.checked)} />
                    <span>Overdue tasks</span>
                  </label>
                </div>

                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.email_notif_stale !== false} onChange={e => update('email_notif_stale', e.target.checked)} />
                    <span>Stale tasks</span>
                  </label>
                </div>

                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.email_notif_nudge !== false} onChange={e => update('email_notif_nudge', e.target.checked)} />
                    <span>General nudges</span>
                  </label>
                </div>

                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.email_notif_size !== false} onChange={e => update('email_notif_size', e.target.checked)} />
                    <span>Size-based reminders</span>
                  </label>
                </div>

                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.email_notif_pileup !== false} onChange={e => update('email_notif_pileup', e.target.checked)} />
                    <span>Pile-up warnings</span>
                  </label>
                </div>

                <div className="settings-label" style={{ marginTop: 16 }}>Package tracking</div>

                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.email_notif_package_delivered !== false} onChange={e => update('email_notif_package_delivered', e.target.checked)} />
                    <span>Delivered</span>
                  </label>
                </div>

                <div className="notif-type-row">
                  <label className="notif-check" style={{ flex: 1, marginBottom: 0 }}>
                    <input type="checkbox" checked={settings.email_notif_package_exception !== false} onChange={e => update('email_notif_package_exception', e.target.checked)} />
                    <span>Exceptions</span>
                  </label>
                </div>

                {/* Test email */}
                <button
                  className="ci-upload-btn"
                  style={{ marginTop: 16 }}
                  disabled={emailTestStatus === 'sending' || !emailSmtpStatus?.configured}
                  onClick={async () => {
                    setEmailTestStatus('sending')
                    setEmailTestError(null)
                    try {
                      const result = await testEmail()
                      if (result.success) {
                        setEmailTestStatus('sent')
                        setTimeout(() => setEmailTestStatus(null), 3000)
                      } else {
                        setEmailTestStatus('error')
                        setEmailTestError(result.error || 'Send failed')
                      }
                    } catch {
                      setEmailTestStatus('error')
                      setEmailTestError('Send failed')
                    }
                  }}
                >
                  {emailTestStatus === 'sending' ? 'Sending...' : emailTestStatus === 'sent' ? 'Sent!' : 'Send test email'}
                </button>
                {emailTestStatus === 'error' && emailTestError && (
                  <div style={{ fontSize: 12, color: '#FF6240', marginTop: 4 }}>{emailTestError}</div>
                )}
              </div>
            )}
          </div>
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
                onClick={() => setConfirmDialog({
                  title: 'Clear All Data',
                  message: 'This will delete all tasks, settings, and history. Are you sure?',
                  onConfirm: () => { setConfirmDialog(null); onClearAll() },
                })}
              >
                Clear all data
              </button>
            </div>
          </div>
        </>
      )}

      {activeTab === 'Logs' && (
        <ServerLogs />
      )}
    </>
  )

  const confirmOverlay = confirmDialog && (
    <div className="sheet-overlay" style={{ zIndex: 200 }} onClick={() => setConfirmDialog(null)}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className="confirm-dialog-title">{confirmDialog.title}</div>
        <div className="confirm-dialog-message">{confirmDialog.message}</div>
        <div className="confirm-dialog-actions">
          <button className="confirm-dialog-cancel" onClick={() => setConfirmDialog(null)}>Cancel</button>
          <button className="confirm-dialog-ok" onClick={confirmDialog.onConfirm}>OK</button>
        </div>
      </div>
    </div>
  )

  if (isDesktop) {
    return (
      <>
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
        {confirmOverlay}
      </>
    )
  }

  return (
    <>
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
      {confirmOverlay}
    </>
  )
}
