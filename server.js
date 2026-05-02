import express from 'express'
import cors from 'cors'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { initDb, getAllData, setAllData, setData, clearAllData, getVersion, bumpVersion, flushNow,
  upsertTask, getTask, deleteTask, queryTasks, updateTaskPartial,
  upsertRoutine, getRoutine, getAllRoutines, deleteRoutine, updateRoutinePartial,
  getAnalytics, getAnalyticsHistory, getData,
  upsertPackage, getPackage, getAllPackages, deletePackage, updatePackagePartial,
  markNotificationTapped, getNotificationAnalytics,
  listThrottleDecisions, markThrottleDecisionFeedback } from './db.js'
import { seedDatabase } from './seed.js'
import { startEmailNotifications, sendTestEmail, getEmailStatus, resetTransporter, sendPackageEmail } from './emailNotifications.js'
import { startPushNotifications, sendTestPush, getPushStatus, getVapidPublicKey, sendPackagePush } from './pushNotifications.js'
import {
  startPushoverNotifications, sendTestNotification as sendTestPushover,
  sendTestEmergency as sendTestPushoverEmergency, getPushoverStatus,
  sendPackagePushover, cancelEmergencyForTask as cancelPushoverEmergencyForTask,
  sendDigestNow,
} from './pushoverNotifications.js'
import { upsertPushSubscription, deletePushSubscription, getGmailProcessedCount, clearGmailProcessed, getNotifThrottle, setNotifThrottle } from './db.js'
import { initGmailSync, syncGmail, startGmailPolling } from './gmailSync.js'
import { startWeatherSync, refreshWeather, geocodeLocation, getWeatherCache, getWeatherStatus, clearWeatherCache } from './weatherSync.js'
import {
  listToolSchemas, newSession, getSession, abortSession, clearSession,
  handleToolCall, commitPlan,
} from './adviserTools.js'
import { registerTaskTools } from './adviserToolsTasks.js'
import { registerGCalTools, registerNotionTools, registerTrelloTools } from './adviserToolsIntegrations.js'
import { registerMiscTools } from './adviserToolsMisc.js'
import * as notionMCP from './notionMCP.js'
import crypto from 'crypto'

// Register adviser tools once at module load
registerTaskTools()
registerGCalTools()
registerNotionTools()
registerTrelloTools()
registerMiscTools()

// --- App version ---
const appVersion = process.env.APP_VERSION || 'dev'

// --- Environment (fallback keys — user can override via UI) ---
let envApiKey = process.env.ANTHROPIC_API_KEY
let envNotionToken = process.env.NOTION_INTEGRATION_TOKEN
let envTrelloKey = process.env.TRELLO_API_KEY
let envTrelloToken = process.env.TRELLO_SECRET
let envGoogleClientId = process.env.GOOGLE_CLIENT_ID
let envGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET
let envTrackingApiKey = process.env.TRACKING_API_KEY
let envUspsClientId = process.env.USPS_CLIENT_ID
let envUspsClientSecret = process.env.USPS_CLIENT_SECRET
const envSmtpHost = process.env.SMTP_HOST

if (existsSync('.env')) {
  const envFile = readFileSync('.env', 'utf-8')
  envApiKey = envApiKey || envFile.match(/(?:VITE_)?ANTHROPIC_API_KEY="?([^"\n]+)"?/)?.[1]
  envNotionToken = envNotionToken || envFile.match(/NOTION_INTEGRATION_TOKEN="?([^"\n]+)"?/)?.[1]
  envTrelloKey = envTrelloKey || envFile.match(/TRELLO_API_KEY="?([^"\n]+)"?/)?.[1]
  envTrelloToken = envTrelloToken || envFile.match(/TRELLO_SECRET="?([^"\n]+)"?/)?.[1]
  envGoogleClientId = envGoogleClientId || envFile.match(/GOOGLE_CLIENT_ID="?([^"\n]+)"?/)?.[1]
  envGoogleClientSecret = envGoogleClientSecret || envFile.match(/GOOGLE_CLIENT_SECRET="?([^"\n]+)"?/)?.[1]
  envTrackingApiKey = envTrackingApiKey || envFile.match(/TRACKING_API_KEY="?([^"\n]+)"?/)?.[1]
  envUspsClientId = envUspsClientId || envFile.match(/USPS_CLIENT_ID="?([^"\n]+)"?/)?.[1]
  envUspsClientSecret = envUspsClientSecret || envFile.match(/USPS_CLIENT_SECRET="?([^"\n]+)"?/)?.[1]
}

// Helper: resolve API key from request header or env var
function getAnthropicKey(req) {
  return req.headers['x-anthropic-key'] || envApiKey || null
}

// Legacy integration token (pre-MCP). Prefer getNotionAccessToken() for new code.
function getLegacyNotionToken(req) {
  return req?.headers?.['x-notion-token'] || envNotionToken || null
}

// Preferred: returns the Notion OAuth access token (via MCP) when connected, else falls back to
// the legacy integration token. Async because token refresh may require a round-trip.
async function getNotionAccessToken(req) {
  // MCP-issued token (Stage 2 OAuth via Notion's hosted MCP). Notion issues a standard OAuth
  // access token through the MCP DCR flow, which is also valid for direct REST API calls —
  // so every REST endpoint inherits MCP's user-scoped workspace access automatically.
  const mcpTokens = getData('notion_mcp_tokens')
  if (mcpTokens?.access_token) {
    if (!mcpTokens.expires_in || !mcpTokens.saved_at || (Date.now() < (mcpTokens.saved_at + mcpTokens.expires_in * 1000 - 300000))) {
      return mcpTokens.access_token
    }
    // Token may be stale; the MCP SDK refreshes on its own cadence via the provider.
    // Fall through rather than duplicating refresh logic here.
  }
  return getLegacyNotionToken(req)
}

function getTrelloAuth(req) {
  const key = req.headers['x-trello-key'] || envTrelloKey || null
  const token = req.headers['x-trello-token'] || envTrelloToken || null
  return { key, token }
}

function getGoogleClientId(req) {
  return req.headers['x-google-client-id'] || envGoogleClientId || null
}

// Google Calendar token management — tokens stored server-side in app_data
const GCAL_TOKENS_KEY = 'gcal_tokens'
const GCAL_BASE = 'https://www.googleapis.com/calendar/v3'

async function getGCalAccessToken() {
  const tokens = getData(GCAL_TOKENS_KEY)
  if (!tokens?.refresh_token) return null

  // Still valid (with 5-min buffer)
  if (tokens.expiry_date && Date.now() < tokens.expiry_date - 300000) {
    return tokens.access_token
  }

  // Refresh the token
  const clientId = envGoogleClientId
  const clientSecret = envGoogleClientSecret
  if (!clientId || !clientSecret) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    console.error('[GCal] Token refresh failed:', data.error_description || data.error)
    return null
  }

  tokens.access_token = data.access_token
  tokens.expiry_date = Date.now() + data.expires_in * 1000
  setData(GCAL_TOKENS_KEY, tokens)
  return tokens.access_token
}

// --- Server log capture (circular buffer) ---
const LOG_BUFFER_MAX = 500
const serverLogs = []
const originalConsoleLog = console.log.bind(console)
const originalConsoleError = console.error.bind(console)
const originalConsoleWarn = console.warn.bind(console)

function captureLog(level, args) {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  serverLogs.push({ ts: new Date().toISOString(), level, msg: line })
  if (serverLogs.length > LOG_BUFFER_MAX) serverLogs.shift()
}

console.log = (...args) => { captureLog('info', args); originalConsoleLog(...args) }
console.error = (...args) => { captureLog('error', args); originalConsoleError(...args) }
console.warn = (...args) => { captureLog('warn', args); originalConsoleWarn(...args) }

// --- Express ---
const app = express()
app.set('trust proxy', 1)
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', appVersion })
})

// --- Server logs endpoint ---
app.get('/api/logs', (req, res) => {
  res.json({ logs: serverLogs, total: serverLogs.length })
})

// --- Client log relay ---
app.post('/api/log', (req, res) => {
  const lines = req.body?.lines
  if (Array.isArray(lines)) {
    for (const line of lines) console.log(`[CLIENT] ${line}`)
  }
  res.json({ ok: true })
})

// --- Key status route (tells frontend what's configured via env) ---
app.get('/api/keys/status', (req, res) => {
  res.json({
    anthropic: !!envApiKey,
    notion: !!envNotionToken,
    trello: !!(envTrelloKey && envTrelloToken),
    gcal: !!(envGoogleClientId && envGoogleClientSecret),
    tracking: !!getTrackingApiKey(),
    usps: !!(envUspsClientId && envUspsClientSecret),
    smtp: !!envSmtpHost,
  })
})

// --- SSE (Server-Sent Events) for cross-client sync ---
const sseClients = new Set()

function broadcast(version, sourceClientId) {
  const msg = JSON.stringify({ type: 'update', version, sourceClientId })
  for (const client of sseClients) {
    client.write(`data: ${msg}\n\n`)
  }
  console.log(`[SSE] broadcast v${version} to ${sseClients.size} client(s) (source: ${sourceClientId || 'server'})`)
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  })
  // Send current data version and app version on connect
  const version = getVersion()
  res.write(`data: ${JSON.stringify({ type: 'connected', version, appVersion })}\n\n`)
  sseClients.add(res)
  console.log(`[SSE] client connected (${sseClients.size} total), version=${version}`)

  // Keep-alive ping every 30s to prevent proxy timeouts
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 30000)

  req.on('close', () => {
    clearInterval(keepAlive)
    sseClients.delete(res)
    console.log(`[SSE] client disconnected (${sseClients.size} remaining)`)
  })
})

// --- Data routes ---
app.get('/api/data', (req, res) => {
  const data = getAllData()
  data._version = getVersion()
  res.json(data)
})

// Guard: reject writes from stale cached JS (old code won't include _clientId)
function guardStaleClient(req, res) {
  if (!req.body._clientId) {
    console.log(`[SYNC] REJECTED stale ${req.method} /api/data — no _clientId (old cached JS)`)
    res.json({ ok: true }) // 200 so old code doesn't retry
    return true
  }
  // Reject pushes from clients running an old app version
  const clientAppVer = req.body._appVersion
  if (clientAppVer && clientAppVer !== 'dev' && clientAppVer !== appVersion) {
    console.log(`[SYNC] REJECTED stale push from app ${clientAppVer} (server is ${appVersion})`)
    res.json({ ok: true, version: getVersion() })
    return true
  }
  // Reject pushes from clients that are behind the data version
  const clientVersion = req.body._version
  const serverVer = getVersion()
  if (clientVersion != null && clientVersion < serverVer) {
    console.log(`[SYNC] REJECTED stale push from data v${clientVersion} (server at v${serverVer})`)
    res.json({ ok: true, version: serverVer })
    return true
  }
  return false
}

function handleWeatherSettingsChange(prevSettings, nextSettings) {
  if (!nextSettings) return
  const prevLat = prevSettings?.weather_latitude
  const prevLon = prevSettings?.weather_longitude
  const locationChanged = prevLat !== nextSettings.weather_latitude || prevLon !== nextSettings.weather_longitude
  const enabledNow = nextSettings.weather_enabled && typeof nextSettings.weather_latitude === 'number'
  if (locationChanged) {
    clearWeatherCache()
    if (enabledNow) {
      // Fire-and-forget refresh so new location shows up quickly
      refreshWeather({ force: true }).catch(err => console.error('[Weather] Post-save refresh failed:', err.message))
    }
  } else if (enabledNow && !prevSettings?.weather_enabled) {
    refreshWeather({ force: true }).catch(err => console.error('[Weather] Post-enable refresh failed:', err.message))
  }
}

app.put('/api/data', (req, res) => {
  if (guardStaleClient(req, res)) return
  const clientId = req.body._clientId
  const body = { ...req.body }
  delete body._clientId
  delete body._version
  const prevSettings = getData('settings')
  const newVersion = setAllData(body)
  if (body.settings) {
    resetTransporter()
    handleWeatherSettingsChange(prevSettings, body.settings)
  }
  broadcast(newVersion, clientId)
  res.json({ ok: true, version: newVersion })
})

// POST does the same as PUT — needed because navigator.sendBeacon only sends POST
app.post('/api/data', (req, res) => {
  if (guardStaleClient(req, res)) return
  const clientId = req.body._clientId
  const body = { ...req.body }
  delete body._clientId
  delete body._version
  const prevSettings = getData('settings')
  const newVersion = setAllData(body)
  if (body.settings) {
    resetTransporter()
    handleWeatherSettingsChange(prevSettings, body.settings)
  }
  broadcast(newVersion, clientId)
  res.json({ ok: true, version: newVersion })
})

app.patch('/api/data/:collection', (req, res) => {
  setData(req.params.collection, req.body)
  const newVersion = bumpVersion()
  broadcast(newVersion, null)
  res.json({ ok: true, version: newVersion })
})

app.delete('/api/data', (req, res) => {
  clearAllData()
  const newVersion = bumpVersion()
  broadcast(newVersion, null)
  res.json({ ok: true, version: newVersion })
})

// --- Analytics ---
app.get('/api/analytics', (req, res) => {
  // Read settings from app_data for streak/vacation logic
  const settings = getData('settings') || {}
  res.json(getAnalytics(settings))
})

app.get('/api/analytics/history', (req, res) => {
  const days = req.query.days ? parseInt(req.query.days, 10) : null
  res.json(getAnalyticsHistory(days))
})

// --- Per-record Task API ---
app.get('/api/tasks', (req, res) => {
  const tasks = queryTasks(req.query)
  res.json(tasks)
})

app.get('/api/tasks/:id', (req, res) => {
  const task = getTask(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  res.json(task)
})

app.post('/api/tasks', (req, res) => {
  const task = req.body
  if (!task.id) return res.status(400).json({ error: 'Task must have an id' })
  upsertTask(task)
  const newVersion = bumpVersion()
  broadcast(newVersion, req.body._clientId || null)
  res.json({ task: getTask(task.id), version: newVersion })
})

app.patch('/api/tasks/:id', (req, res) => {
  const clientId = req.body._clientId
  const updates = { ...req.body }
  delete updates._clientId
  const task = updateTaskPartial(req.params.id, updates)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  const newVersion = bumpVersion()
  broadcast(newVersion, clientId || null)
  res.json({ task, version: newVersion })
})

app.delete('/api/tasks/:id', (req, res) => {
  deleteTask(req.params.id)
  const newVersion = bumpVersion()
  broadcast(newVersion, null)
  res.json({ ok: true, version: newVersion })
})

// --- Per-record Routine API ---
app.get('/api/routines', (req, res) => {
  const routines = getAllRoutines()
  res.json(routines)
})

app.get('/api/routines/:id', (req, res) => {
  const routine = getRoutine(req.params.id)
  if (!routine) return res.status(404).json({ error: 'Routine not found' })
  res.json(routine)
})

app.post('/api/routines', (req, res) => {
  const routine = req.body
  if (!routine.id) return res.status(400).json({ error: 'Routine must have an id' })
  upsertRoutine(routine)
  const newVersion = bumpVersion()
  broadcast(newVersion, req.body._clientId || null)
  res.json({ routine: getRoutine(routine.id), version: newVersion })
})

app.patch('/api/routines/:id', (req, res) => {
  const clientId = req.body._clientId
  const updates = { ...req.body }
  delete updates._clientId
  const routine = updateRoutinePartial(req.params.id, updates)
  if (!routine) return res.status(404).json({ error: 'Routine not found' })
  const newVersion = bumpVersion()
  broadcast(newVersion, clientId || null)
  res.json({ routine, version: newVersion })
})

app.delete('/api/routines/:id', (req, res) => {
  deleteRoutine(req.params.id)
  const newVersion = bumpVersion()
  broadcast(newVersion, null)
  res.json({ ok: true, version: newVersion })
})

// --- Claude API proxy ---
app.post('/api/messages', async (req, res) => {
  const key = getAnthropicKey(req)
  if (!key) return res.status(400).json({ error: 'No Anthropic API key configured. Add one in Settings or set ANTHROPIC_API_KEY env var.' })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    })
    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Notion API proxy ---
const NOTION_BASE = 'https://api.notion.com/v1'

function makeNotionHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  }
}

function richText(str) {
  // Parse **bold** segments into Notion rich text with annotations
  const parts = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) parts.push({ type: 'text', text: { content: str.slice(last, m.index) } })
    parts.push({ type: 'text', text: { content: m[1] }, annotations: { bold: true } })
    last = re.lastIndex
  }
  if (last < str.length) parts.push({ type: 'text', text: { content: str.slice(last) } })
  return parts.length > 0 ? parts : [{ type: 'text', text: { content: str } }]
}

function parseContentToBlocks(content) {
  return content.split('\n').filter(Boolean).map(line => {
    if (line.match(/^---+$/)) {
      return { object: 'block', type: 'divider', divider: {} }
    }
    if (line.startsWith('### ')) {
      return { object: 'block', type: 'heading_3', heading_3: { rich_text: richText(line.slice(4)) } }
    }
    if (line.startsWith('## ')) {
      return { object: 'block', type: 'heading_2', heading_2: { rich_text: richText(line.slice(3)) } }
    }
    if (line.startsWith('# ')) {
      return { object: 'block', type: 'heading_1', heading_1: { rich_text: richText(line.slice(2)) } }
    }
    if (line.match(/^- \[[ x]\] /)) {
      const checked = line[3] === 'x'
      return { object: 'block', type: 'to_do', to_do: { rich_text: richText(line.slice(6)), checked } }
    }
    if (line.startsWith('> ')) {
      return { object: 'block', type: 'callout', callout: { rich_text: richText(line.slice(2)), icon: { type: 'emoji', emoji: '💡' } } }
    }
    if (line.match(/^\d+\. /)) {
      const text = line.replace(/^\d+\. /, '')
      return { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(text) } }
    }
    if (line.startsWith('- ')) {
      return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(line.slice(2)) } }
    }
    return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(line) } }
  })
}

app.post('/api/notion/search', async (req, res) => {
  const token = await getNotionAccessToken(req)
  if (!token) return res.status(400).json({ error: 'No Notion token configured. Add one in Settings or set NOTION_INTEGRATION_TOKEN env var.' })
  try {
    const response = await fetch(`${NOTION_BASE}/search`, {
      method: 'POST',
      headers: makeNotionHeaders(token),
      body: JSON.stringify({
        query: req.body.query || '',
        filter: { property: 'object', value: 'page' },
        page_size: req.body.limit || 5,
      }),
    })
    const data = await response.json()
    const pages = (data.results || []).map(page => ({
      id: page.id,
      title: extractTitle(page),
      url: page.url,
      last_edited: page.last_edited_time,
    }))
    res.json({ pages })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/notion/pages/:id', async (req, res) => {
  const token = await getNotionAccessToken(req)
  if (!token) return res.status(400).json({ error: 'Notion not configured' })
  try {
    const response = await fetch(`${NOTION_BASE}/pages/${req.params.id}`, { headers: makeNotionHeaders(token) })
    const data = await response.json()
    res.json({ id: data.id, title: extractTitle(data), url: data.url })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/notion/pages', async (req, res) => {
  const token = await getNotionAccessToken(req)
  if (!token) return res.status(400).json({ error: 'Notion not configured' })
  try {
    const { title, content, parentPageId } = req.body
    const headers = makeNotionHeaders(token)
    const children = parseContentToBlocks(content || '')

    const body = {
      properties: { title: { title: [{ text: { content: title } }] } },
      children,
    }

    if (parentPageId) {
      body.parent = { page_id: parentPageId }
    } else {
      const searchRes = await fetch(`${NOTION_BASE}/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ page_size: 1, filter: { property: 'object', value: 'page' } }),
      })
      const searchData = await searchRes.json()
      if (searchData.results?.length > 0) {
        body.parent = { page_id: searchData.results[0].id }
      } else {
        return res.status(400).json({ error: 'No accessible Notion pages found.' })
      }
    }

    const response = await fetch(`${NOTION_BASE}/pages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = await response.json()
    if (data.object === 'error') return res.status(400).json({ error: data.message })
    res.json({ id: data.id, title: extractTitle(data), url: data.url })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/notion/pages/:id', async (req, res) => {
  const token = await getNotionAccessToken(req)
  if (!token) return res.status(400).json({ error: 'Notion not configured' })
  const { title, content } = req.body
  const headers = makeNotionHeaders(token)
  console.log(`[NotionSync] PATCH page ${req.params.id}`, { hasTitle: !!title, hasContent: !!content })
  try {
    // Update title if provided
    if (title) {
      const titleRes = await fetch(`${NOTION_BASE}/pages/${req.params.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: { title: { title: [{ text: { content: title } }] } } }),
      })
      if (!titleRes.ok) {
        const err = await titleRes.json()
        console.log(`[NotionSync] title update FAILED:`, err)
        return res.status(titleRes.status).json(err)
      }
      console.log(`[NotionSync] title updated OK`)
    }

    // Replace content if provided: delete existing blocks then append new ones
    if (content) {
      // Fetch existing blocks to delete
      const blocksRes = await fetch(`${NOTION_BASE}/blocks/${req.params.id}/children?page_size=100`, { headers })
      const blocksData = await blocksRes.json()
      if (blocksRes.ok && blocksData.results) {
        for (const block of blocksData.results) {
          await fetch(`${NOTION_BASE}/blocks/${block.id}`, { method: 'DELETE', headers })
        }
        console.log(`[NotionSync] deleted ${blocksData.results.length} old blocks`)
      }

      // Append new blocks
      const children = parseContentToBlocks(content)
      if (children.length > 0) {
        const appendRes = await fetch(`${NOTION_BASE}/blocks/${req.params.id}/children`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ children }),
        })
        const appendData = await appendRes.json()
        if (!appendRes.ok) {
          console.log(`[NotionSync] content append FAILED:`, appendData)
          return res.status(appendRes.status).json(appendData)
        }
        console.log(`[NotionSync] appended ${children.length} new blocks`)
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.log(`[NotionSync] PATCH page ERROR:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/notion/status', async (req, res) => {
  // Reports whether *any* Notion auth path resolves to a working token — used by Settings UI
  // as a quick "is there anything working at all" indicator. MCP connection status has its
  // own dedicated endpoint at /api/notion/mcp/status.
  const mcpActive = !!getData('notion_mcp_tokens')?.access_token
  const legacyActive = !!getLegacyNotionToken(req)
  const token = await getNotionAccessToken(req)
  if (!token) return res.json({ connected: false, auth: null, mcp: false, legacy: false })
  try {
    const response = await fetch(`${NOTION_BASE}/users/me`, { headers: makeNotionHeaders(token) })
    const data = await response.json()
    res.json({
      connected: response.ok,
      auth: mcpActive ? 'mcp' : 'legacy',
      mcp: mcpActive,
      legacy: legacyActive,
      bot: data.name || data.bot?.owner?.user?.name,
    })
  } catch {
    res.json({ connected: false, auth: null, mcp: mcpActive, legacy: legacyActive })
  }
})

// Get all blocks (content) from a Notion page — paginated, returns structured + plaintext
app.get('/api/notion/blocks/:id', async (req, res) => {
  const token = await getNotionAccessToken(req)
  if (!token) return res.status(400).json({ error: 'Notion not configured' })
  try {
    let allBlocks = []
    let cursor = undefined
    // Paginate through all blocks (Notion returns max 100 per request)
    do {
      const url = `${NOTION_BASE}/blocks/${req.params.id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
      const response = await fetch(url, { headers: makeNotionHeaders(token) })
      const data = await response.json()
      if (!response.ok) return res.status(response.status).json({ error: data.message || 'Failed to fetch blocks' })
      allBlocks = allBlocks.concat(data.results || [])
      cursor = data.has_more ? data.next_cursor : null
    } while (cursor)

    // Flatten blocks to plain text for AI consumption
    const plainText = allBlocks.map(block => {
      const type = block.type
      const content = block[type]
      if (!content) return ''
      // Extract text from rich_text arrays
      if (content.rich_text) {
        const text = content.rich_text.map(rt => rt.plain_text).join('')
        if (type === 'heading_1') return `# ${text}`
        if (type === 'heading_2') return `## ${text}`
        if (type === 'heading_3') return `### ${text}`
        if (type === 'bulleted_list_item') return `- ${text}`
        if (type === 'numbered_list_item') return `1. ${text}`
        if (type === 'to_do') return `[${content.checked ? 'x' : ' '}] ${text}`
        return text
      }
      return ''
    }).filter(Boolean).join('\n')

    res.json({ blocks: allBlocks, plainText })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get child pages of a parent page (for sync: discover pages under a parent)
app.get('/api/notion/children/:id', async (req, res) => {
  const token = await getNotionAccessToken(req)
  if (!token) return res.status(400).json({ error: 'Notion not configured' })
  try {
    let allChildren = []
    let cursor = undefined
    do {
      const url = `${NOTION_BASE}/blocks/${req.params.id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
      const response = await fetch(url, { headers: makeNotionHeaders(token) })
      const data = await response.json()
      if (!response.ok) return res.status(response.status).json({ error: data.message || 'Failed to fetch children' })
      allChildren = allChildren.concat(data.results || [])
      cursor = data.has_more ? data.next_cursor : null
    } while (cursor)

    // Filter to child_page blocks and fetch their page details for title/url
    const childPages = allChildren.filter(b => b.type === 'child_page')
    const pages = await Promise.all(childPages.map(async (block) => {
      try {
        const pageRes = await fetch(`${NOTION_BASE}/pages/${block.id}`, { headers: makeNotionHeaders(token) })
        const pageData = await pageRes.json()
        return {
          id: block.id,
          title: block.child_page?.title || extractTitle(pageData),
          url: pageData.url,
          last_edited: pageData.last_edited_time,
        }
      } catch {
        return { id: block.id, title: block.child_page?.title || 'Untitled', url: null, last_edited: null }
      }
    }))

    res.json({ pages })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Query a Notion database. Returns pages with flattened properties so callers (Quokka,
// sync hooks) can filter/display rows without re-interpreting Notion's property schema.
app.post('/api/notion/databases/:id/query', async (req, res) => {
  const token = await getNotionAccessToken(req)
  if (!token) return res.status(400).json({ error: 'Notion not configured' })
  try {
    const response = await fetch(`${NOTION_BASE}/databases/${req.params.id}/query`, {
      method: 'POST',
      headers: makeNotionHeaders(token),
      body: JSON.stringify(req.body || {}),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Database query failed' })
    const pages = (data.results || []).map(page => ({
      id: page.id,
      title: extractTitle(page),
      url: page.url,
      last_edited: page.last_edited_time,
      properties: flattenNotionProperties(page.properties || {}),
    }))
    res.json({ pages, has_more: data.has_more, next_cursor: data.next_cursor })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function extractTitle(page) {
  const props = page.properties || {}
  for (const val of Object.values(props)) {
    if (val.type === 'title' && val.title?.length > 0) {
      return val.title.map(t => t.plain_text).join('')
    }
  }
  return 'Untitled'
}

// Flatten Notion property objects to plain values for callers (AI tools, UI) to use directly.
// Unsupported/complex types fall through as null.
function flattenNotionProperties(props) {
  const out = {}
  for (const [name, val] of Object.entries(props || {})) {
    switch (val.type) {
      case 'title':
      case 'rich_text':
        out[name] = (val[val.type] || []).map(t => t.plain_text).join('')
        break
      case 'number':
        out[name] = val.number
        break
      case 'select':
        out[name] = val.select?.name ?? null
        break
      case 'multi_select':
        out[name] = (val.multi_select || []).map(s => s.name)
        break
      case 'status':
        out[name] = val.status?.name ?? null
        break
      case 'date':
        out[name] = val.date ? { start: val.date.start, end: val.date.end || null } : null
        break
      case 'checkbox':
        out[name] = !!val.checkbox
        break
      case 'url':
      case 'email':
      case 'phone_number':
        out[name] = val[val.type] ?? null
        break
      case 'people':
        out[name] = (val.people || []).map(p => p.name || p.id)
        break
      case 'files':
        out[name] = (val.files || []).map(f => f.name)
        break
      case 'relation':
        out[name] = (val.relation || []).map(r => r.id)
        break
      case 'formula':
        out[name] = val.formula?.[val.formula?.type] ?? null
        break
      case 'rollup':
        out[name] = val.rollup?.[val.rollup?.type] ?? null
        break
      case 'created_time':
      case 'last_edited_time':
        out[name] = val[val.type] ?? null
        break
      case 'created_by':
      case 'last_edited_by':
        out[name] = val[val.type]?.name || val[val.type]?.id || null
        break
      default:
        out[name] = null
    }
  }
  return out
}

// Notion file upload (requires newer API version)
app.post('/api/notion/file-uploads', async (req, res) => {
  const token = await getNotionAccessToken(req)
  if (!token) return res.status(400).json({ error: 'Notion not configured' })
  try {
    const { filename, content_type } = req.body
    const response = await fetch(`${NOTION_BASE}/file_uploads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filename, content_type }),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Send file to a Notion file upload
app.post('/api/notion/file-uploads/:id/send', async (req, res) => {
  const token = await getNotionAccessToken(req)
  if (!token) return res.status(400).json({ error: 'Notion not configured' })
  try {
    const { data, filename, content_type } = req.body
    const buffer = Buffer.from(data, 'base64')
    const formData = new FormData()
    formData.append('file', new Blob([buffer], { type: content_type }), filename)
    const response = await fetch(`${NOTION_BASE}/file_uploads/${req.params.id}/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
      body: formData,
    })
    const result = await response.json()
    if (!response.ok) return res.status(response.status).json(result)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Append blocks to a Notion page (used for attaching uploaded files)
app.post('/api/notion/blocks/:id/children', async (req, res) => {
  const token = await getNotionAccessToken(req)
  if (!token) return res.status(400).json({ error: 'Notion not configured' })
  try {
    const response = await fetch(`${NOTION_BASE}/blocks/${req.params.id}/children`, {
      method: 'PATCH',
      headers: makeNotionHeaders(token),
      body: JSON.stringify(req.body),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Trello API proxy ---
const TRELLO_BASE = 'https://api.trello.com/1'

app.get('/api/trello/status', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.json({ connected: false })
  try {
    const response = await fetch(`${TRELLO_BASE}/members/me?key=${key}&token=${token}`)
    const data = await response.json()
    res.json({ connected: response.ok, username: data.username || null })
  } catch {
    res.json({ connected: false })
  }
})

app.get('/api/trello/boards', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'No Trello credentials configured. Add them in Settings or set TRELLO_API_KEY and TRELLO_SECRET env vars.' })
  try {
    const response = await fetch(`${TRELLO_BASE}/members/me/boards?fields=name,url,closed&key=${key}&token=${token}`)
    const data = await response.json()
    const boards = (data || []).filter(b => !b.closed)
    res.json(boards)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/trello/boards/:id/lists', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  try {
    const response = await fetch(`${TRELLO_BASE}/boards/${req.params.id}/lists?fields=name,closed&key=${key}&token=${token}`)
    const data = await response.json()
    const lists = (data || []).filter(l => !l.closed)
    res.json(lists)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/trello/cards', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  try {
    const { name, desc, idList, pos } = req.body
    const response = await fetch(`${TRELLO_BASE}/cards?key=${key}&token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, desc, idList, pos }),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/trello/cards/:id', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  console.log(`[TrelloSync] PATCH card ${req.params.id}`, Object.keys(req.body))
  try {
    const response = await fetch(`${TRELLO_BASE}/cards/${req.params.id}?key=${key}&token=${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    })
    const data = await response.json()
    if (!response.ok) {
      console.log(`[TrelloSync] PATCH card FAILED ${response.status}:`, data)
      return res.status(response.status).json(data)
    }
    console.log(`[TrelloSync] PATCH card OK`)
    res.json(data)
  } catch (err) {
    console.log(`[TrelloSync] PATCH card ERROR:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/trello/cards/:id', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  try {
    const response = await fetch(`${TRELLO_BASE}/cards/${req.params.id}?key=${key}&token=${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closed: true }),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/trello/cards/:id', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  try {
    const response = await fetch(`${TRELLO_BASE}/cards/${req.params.id}?key=${key}&token=${token}`)
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create a checklist on a card
app.post('/api/trello/cards/:id/checklists', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  console.log(`[TrelloSync] CREATE checklist on card ${req.params.id}:`, req.body.name)
  try {
    const { name } = req.body
    const response = await fetch(`${TRELLO_BASE}/cards/${req.params.id}/checklists?key=${key}&token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await response.json()
    if (!response.ok) { console.log(`[TrelloSync] CREATE checklist FAILED:`, data); return res.status(response.status).json(data) }
    console.log(`[TrelloSync] CREATE checklist OK:`, data.id)
    res.json(data)
  } catch (err) {
    console.log(`[TrelloSync] CREATE checklist ERROR:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// Add an item to a checklist
app.post('/api/trello/checklists/:id/checkItems', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  try {
    const { name, checked } = req.body
    const response = await fetch(`${TRELLO_BASE}/checklists/${req.params.id}/checkItems?key=${key}&token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, checked: checked ? 'true' : 'false' }),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Fetch checklists for a card
app.get('/api/trello/cards/:id/checklists', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  console.log(`[TrelloSync] GET checklists for card ${req.params.id}`)
  try {
    const response = await fetch(`${TRELLO_BASE}/cards/${req.params.id}/checklists?key=${key}&token=${token}`)
    const data = await response.json()
    if (!response.ok) { console.log(`[TrelloSync] GET checklists FAILED:`, data); return res.status(response.status).json(data) }
    console.log(`[TrelloSync] GET checklists OK: ${data.length} found`)
    res.json(data)
  } catch (err) {
    console.log(`[TrelloSync] GET checklists ERROR:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// Update a check item on a card
app.put('/api/trello/cards/:cardId/checkItem/:itemId', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  try {
    const { name, state } = req.body
    const response = await fetch(`${TRELLO_BASE}/cards/${req.params.cardId}/checkItem/${req.params.itemId}?key=${key}&token=${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, state }),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete a checklist
app.delete('/api/trello/checklists/:id', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  try {
    const response = await fetch(`${TRELLO_BASE}/checklists/${req.params.id}?key=${key}&token=${token}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      const data = await response.json()
      return res.status(response.status).json(data)
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Upload an attachment to a card (base64)
app.post('/api/trello/cards/:id/attachments', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  try {
    const { name, mimeType, data } = req.body
    const buffer = Buffer.from(data, 'base64')
    const formData = new FormData()
    formData.append('name', name)
    formData.append('file', new Blob([buffer], { type: mimeType }), name)
    const response = await fetch(`${TRELLO_BASE}/cards/${req.params.id}/attachments?key=${key}&token=${token}`, {
      method: 'POST',
      body: formData,
    })
    const result = await response.json()
    if (!response.ok) return res.status(response.status).json(result)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/trello/sync', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  try {
    const { idList } = req.body
    if (!idList) return res.status(400).json({ error: 'idList is required' })
    const response = await fetch(`${TRELLO_BASE}/lists/${idList}/cards?fields=name,desc,closed,idList,pos,due,labels,url&key=${key}&token=${token}`)
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/trello/sync-all-lists', async (req, res) => {
  const { key, token } = getTrelloAuth(req)
  if (!key || !token) return res.status(400).json({ error: 'Trello not configured' })
  try {
    const { listIds } = req.body
    if (!Array.isArray(listIds) || listIds.length === 0) return res.status(400).json({ error: 'listIds array is required' })
    const result = {}
    await Promise.all(listIds.map(async (listId) => {
      const response = await fetch(`${TRELLO_BASE}/lists/${listId}/cards?fields=name,desc,closed,idList,pos,due,labels,url&key=${key}&token=${token}`)
      if (response.ok) {
        result[listId] = await response.json()
      } else {
        result[listId] = []
      }
    }))
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================================
// Google Calendar
// ============================================================

const GCAL_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'

app.get('/api/gcal/auth-url', (req, res) => {
  const clientId = getGoogleClientId(req)
  if (!clientId) return res.status(400).json({ error: 'Google Client ID not configured' })

  const redirectUri = `${req.protocol}://${req.get('host')}/api/gcal/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GCAL_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  })
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
})

app.get('/api/gcal/callback', async (req, res) => {
  const { code } = req.query
  if (!code) return res.status(400).send('Missing authorization code')

  const clientId = envGoogleClientId
  const clientSecret = envGoogleClientSecret
  if (!clientId || !clientSecret) return res.status(500).send('Google credentials not configured on server')

  const redirectUri = `${req.protocol}://${req.get('host')}/api/gcal/callback`

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenRes.ok) {
      console.error('[GCal] Token exchange failed:', tokenData)
      return res.status(400).send(`OAuth error: ${tokenData.error_description || tokenData.error}`)
    }

    // Fetch user email for display
    let email = null
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      if (profileRes.ok) {
        const profile = await profileRes.json()
        email = profile.email
      }
    } catch { /* non-critical */ }

    // Store tokens server-side
    setData(GCAL_TOKENS_KEY, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date: Date.now() + tokenData.expires_in * 1000,
      email,
    })

    res.send(`<!DOCTYPE html><html><body><script>
      window.opener?.postMessage({ type: 'gcal-connected' }, '*');
      document.body.textContent = 'Connected to Google Calendar! You can close this window.';
    </script></body></html>`)
  } catch (err) {
    console.error('[GCal] Callback error:', err)
    res.status(500).send('Failed to complete OAuth flow')
  }
})

app.get('/api/gcal/status', (req, res) => {
  const tokens = getData(GCAL_TOKENS_KEY)
  if (tokens?.refresh_token) {
    res.json({ connected: true, email: tokens.email || null })
  } else {
    res.json({ connected: false })
  }
})

app.post('/api/gcal/disconnect', (req, res) => {
  setData(GCAL_TOKENS_KEY, null)
  res.json({ ok: true })
})

// --- Notion MCP endpoints ---
// Connect to Notion's hosted MCP server via OAuth 2.0 + PKCE + Dynamic Client Registration.
// No pre-registered Notion integration needed; user-scoped access.
app.post('/api/notion/mcp/connect', async (req, res) => {
  try {
    const redirectBase = `${req.protocol}://${req.get('host')}`
    const out = await notionMCP.startAuth(redirectBase)
    if (out.alreadyAuthorized) {
      return res.json({ alreadyAuthorized: true, status: notionMCP.getStatus() })
    }
    res.json({ authUrl: out.authUrl })
  } catch (err) {
    console.error('[NotionMCP] connect failed:', err)
    res.status(500).json({ error: err?.message || 'Failed to start MCP auth' })
  }
})

app.get('/api/notion/mcp/callback', async (req, res) => {
  const { code, error } = req.query
  if (error) return res.status(400).send(`OAuth error: ${error}`)
  if (!code) return res.status(400).send('Missing authorization code')
  try {
    await notionMCP.finishAuth(code)
    res.send(`<!DOCTYPE html><html><body><script>
      window.opener?.postMessage({ type: 'notion-mcp-connected' }, '*');
      document.body.textContent = 'Connected to Notion via MCP! You can close this window.';
    </script></body></html>`)
  } catch (err) {
    console.error('[NotionMCP] callback failed:', err)
    res.status(500).send(`Failed to complete MCP auth: ${err?.message || err}`)
  }
})

app.get('/api/notion/mcp/status', (req, res) => {
  res.json(notionMCP.getStatus())
})

app.post('/api/notion/mcp/disconnect', async (req, res) => {
  try {
    await notionMCP.disconnect()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to disconnect' })
  }
})

app.get('/api/notion/mcp/tools', async (req, res) => {
  try {
    const tools = await notionMCP.listTools()
    res.json({ tools: tools.map(t => ({ name: t.name, description: t.description })) })
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to list tools' })
  }
})

app.get('/api/gcal/calendars', async (req, res) => {
  try {
    const accessToken = await getGCalAccessToken()
    if (!accessToken) return res.status(401).json({ error: 'Not connected to Google Calendar' })

    const response = await fetch(`${GCAL_BASE}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)

    const calendars = (data.items || []).map(c => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary || false,
    }))
    res.json(calendars)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/gcal/events', async (req, res) => {
  try {
    const accessToken = await getGCalAccessToken()
    if (!accessToken) return res.status(401).json({ error: 'Not connected to Google Calendar' })

    const { calendarId, event } = req.body
    const calId = encodeURIComponent(calendarId || 'primary')
    const response = await fetch(`${GCAL_BASE}/calendars/${calId}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json({ eventId: data.id, htmlLink: data.htmlLink })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/gcal/events/:eventId', async (req, res) => {
  try {
    const accessToken = await getGCalAccessToken()
    if (!accessToken) return res.status(401).json({ error: 'Not connected to Google Calendar' })

    const { calendarId, event } = req.body
    const calId = encodeURIComponent(calendarId || 'primary')
    const eventId = encodeURIComponent(req.params.eventId)
    const response = await fetch(`${GCAL_BASE}/calendars/${calId}/events/${eventId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json({ eventId: data.id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/gcal/events/:eventId', async (req, res) => {
  try {
    const accessToken = await getGCalAccessToken()
    if (!accessToken) return res.status(401).json({ error: 'Not connected to Google Calendar' })

    const calendarId = req.query.calendarId || 'primary'
    const calId = encodeURIComponent(calendarId)
    const eventId = encodeURIComponent(req.params.eventId)
    const response = await fetch(`${GCAL_BASE}/calendars/${calId}/events/${eventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (response.status === 204 || response.status === 200) {
      return res.json({ ok: true })
    }
    const data = await response.json().catch(() => ({}))
    res.status(response.status).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/gcal/events/bulk-delete', async (req, res) => {
  try {
    const accessToken = await getGCalAccessToken()
    if (!accessToken) return res.status(401).json({ error: 'Not connected to Google Calendar' })

    const calendarId = req.body.calendarId || 'primary'
    const calId = encodeURIComponent(calendarId)

    // Fetch events using q= search for "Managed by Boomerang"
    let allEvents = []
    let pageToken = null
    do {
      const params = new URLSearchParams({
        q: 'Managed by Boomerang',
        singleEvents: 'true',
        maxResults: '250',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const listRes = await fetch(`${GCAL_BASE}/calendars/${calId}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const listData = await listRes.json()
      if (!listRes.ok) return res.status(listRes.status).json(listData)
      const items = (listData.items || []).filter(e =>
        e.description && e.description.includes('Managed by Boomerang')
      )
      allEvents.push(...items)
      pageToken = listData.nextPageToken
    } while (pageToken)

    if (allEvents.length === 0) {
      return res.json({ deleted: 0, failed: 0 })
    }

    // Delete each event with 100ms delay to avoid rate limits
    let deleted = 0
    let failed = 0
    for (const event of allEvents) {
      try {
        const eid = encodeURIComponent(event.id)
        const delRes = await fetch(`${GCAL_BASE}/calendars/${calId}/events/${eid}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (delRes.status === 204 || delRes.status === 200) deleted++
        else failed++
      } catch {
        failed++
      }
      if (allEvents.length > 10) await new Promise(r => setTimeout(r, 100))
    }

    console.log(`[GCal] Bulk delete: ${deleted} deleted, ${failed} failed out of ${allEvents.length}`)
    res.json({ deleted, failed, total: allEvents.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/gcal/events', async (req, res) => {
  try {
    const accessToken = await getGCalAccessToken()
    if (!accessToken) return res.status(401).json({ error: 'Not connected to Google Calendar' })

    const calendarId = req.query.calendarId || 'primary'
    const calId = encodeURIComponent(calendarId)
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    })
    if (req.query.timeMin) params.set('timeMin', req.query.timeMin)
    if (req.query.timeMax) params.set('timeMax', req.query.timeMax)

    const response = await fetch(`${GCAL_BASE}/calendars/${calId}/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)

    const events = (data.items || []).map(e => ({
      id: e.id,
      summary: e.summary || '',
      description: e.description || '',
      start: e.start,
      end: e.end,
      htmlLink: e.htmlLink,
      recurringEventId: e.recurringEventId || null,
    }))
    res.json(events)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Gmail Integration ---
// ============================================================

const GMAIL_TOKENS_KEY = 'gmail_tokens'
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly'

app.get('/api/gmail/auth-url', (req, res) => {
  const clientId = getGoogleClientId(req)
  if (!clientId) return res.status(400).json({ error: 'Google Client ID not configured' })

  const redirectUri = `${req.protocol}://${req.get('host')}/api/gmail/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  })
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
})

app.get('/api/gmail/callback', async (req, res) => {
  const { code } = req.query
  if (!code) return res.status(400).send('Missing authorization code')

  const clientId = envGoogleClientId
  const clientSecret = envGoogleClientSecret
  if (!clientId || !clientSecret) return res.status(500).send('Google credentials not configured on server')

  const redirectUri = `${req.protocol}://${req.get('host')}/api/gmail/callback`

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenRes.ok) {
      console.error('[Gmail] Token exchange failed:', tokenData)
      return res.status(400).send(`OAuth error: ${tokenData.error_description || tokenData.error}`)
    }

    let email = null
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      if (profileRes.ok) {
        const profile = await profileRes.json()
        email = profile.email
      }
    } catch { /* non-critical */ }

    setData(GMAIL_TOKENS_KEY, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date: Date.now() + tokenData.expires_in * 1000,
      email,
    })

    res.send(`<!DOCTYPE html><html><body><script>
      window.opener?.postMessage({ type: 'gmail-connected' }, '*');
      document.body.textContent = 'Connected to Gmail! You can close this window.';
    </script></body></html>`)
  } catch (err) {
    console.error('[Gmail] Callback error:', err)
    res.status(500).send('Failed to complete OAuth flow')
  }
})

app.get('/api/gmail/status', (req, res) => {
  const tokens = getData(GMAIL_TOKENS_KEY)
  const processedCount = getGmailProcessedCount()
  const lastSync = getData('gmail_last_sync')
  if (tokens?.refresh_token) {
    res.json({ connected: true, email: tokens.email || null, processedCount, lastSync })
  } else {
    res.json({ connected: false, processedCount: 0, lastSync: null })
  }
})

app.post('/api/gmail/disconnect', (req, res) => {
  setData(GMAIL_TOKENS_KEY, null)
  clearGmailProcessed()
  setData('gmail_last_sync', null)
  res.json({ ok: true })
})

app.post('/api/gmail/sync', async (req, res) => {
  const daysBack = req.body?.daysBack || 7
  try {
    const result = await syncGmail(daysBack)
    res.json(result)
  } catch (err) {
    console.error('[Gmail] Sync error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/gmail/approve/:id', (req, res) => {
  const task = getTask(req.params.id)
  if (task) {
    updateTaskPartial(req.params.id, { gmail_pending: 0 })
    const newVersion = bumpVersion()
    broadcast(newVersion, null)
    return res.json({ ok: true, type: 'task', version: newVersion })
  }
  const pkg = getPackage(req.params.id)
  if (pkg) {
    updatePackagePartial(req.params.id, { gmail_pending: 0 })
    const newVersion = bumpVersion()
    broadcast(newVersion, null)
    return res.json({ ok: true, type: 'package', version: newVersion })
  }
  res.status(404).json({ error: 'Item not found' })
})

app.post('/api/gmail/dismiss/:id', (req, res) => {
  const task = getTask(req.params.id)
  if (task) {
    deleteTask(req.params.id)
    const newVersion = bumpVersion()
    broadcast(newVersion, null)
    return res.json({ ok: true, type: 'task', version: newVersion })
  }
  const pkg = getPackage(req.params.id)
  if (pkg) {
    deletePackage(req.params.id)
    const newVersion = bumpVersion()
    broadcast(newVersion, null)
    return res.json({ ok: true, type: 'package', version: newVersion })
  }
  res.status(404).json({ error: 'Item not found' })
})

app.post('/api/gmail/reset', (req, res) => {
  clearGmailProcessed()
  setData('gmail_last_sync', null)
  res.json({ ok: true })
})

// --- Package Tracking ---

function getTrackingApiKey(req) {
  if (req?.headers['x-tracking-key']) return req.headers['x-tracking-key']
  if (envTrackingApiKey) return envTrackingApiKey
  // Fall back to UI-provided key stored in settings
  const settings = getData('settings')
  return settings?.tracking_api_key || null
}

// 17track API quota state (in-memory)
let trackingQuota = { exhausted: false, reset_at: null, daily_used: 0 }

// Carrier detection (server-side duplicate of client utility for when we need it server-side)
const CARRIER_PATTERNS = [
  { code: 'usps', name: 'USPS', patterns: [/^9[2345]\d{20,26}$/, /^[A-Z]{2}\d{9}US$/, /^(420\d{5,9})?9[2345]\d{20,26}$/] },
  { code: 'ups', name: 'UPS', patterns: [/^1Z[A-Z0-9]{16}$/i, /^T\d{10}$/] },
  { code: 'fedex', name: 'FedEx', patterns: [/^\d{12}$/, /^\d{15}$/, /^\d{20}$/, /^\d{22}$/] },
  { code: 'amazon', name: 'Amazon', patterns: [/^TBA\d{12,}$/i] },
  { code: 'dhl', name: 'DHL', patterns: [/^\d{10}$/, /^\d{11}$/, /^[A-Z]{3}\d{7,}$/] },
  { code: 'ontrac', name: 'OnTrac', patterns: [/^C\d{14}$/] },
  { code: 'lasership', name: 'LaserShip', patterns: [/^L[A-Z]\d{8,}$/i] },
]

function detectCarrierServer(trackingNumber) {
  if (!trackingNumber) return null
  const cleaned = trackingNumber.trim().replace(/\s/g, '')
  for (const carrier of CARRIER_PATTERNS) {
    for (const pattern of carrier.patterns) {
      if (pattern.test(cleaned)) return { code: carrier.code, name: carrier.name }
    }
  }
  return null
}

// Determine adaptive poll interval based on package status and ETA
function calcPollInterval(pkg) {
  if (pkg.status === 'delivered' || pkg.status === 'expired') return null
  if (pkg.status === 'out_for_delivery') return 15
  if (pkg.status === 'exception') return 60

  // Newly added packages with no real data yet — poll aggressively
  if (pkg.status === 'pending' && (!pkg.events || pkg.events.length === 0 || (typeof pkg.events === 'string' && pkg.events === '[]'))) return 5

  if (pkg.status === 'pending') return 30

  // in_transit — check ETA proximity
  if (pkg.eta) {
    const daysUntilEta = (new Date(pkg.eta) - new Date()) / 86400000
    if (daysUntilEta <= 1) return 30
    if (daysUntilEta <= 2) return 60
  }

  // Check staleness
  if (pkg.last_polled) {
    const daysSinceUpdate = (new Date() - new Date(pkg.last_polled)) / 86400000
    if (daysSinceUpdate > 30) return 1440
  }

  return 240 // default: 4 hours
}

// Map 17track status to our status
// 17track v2.4 statuses: NotFound, InfoReceived, InTransit, Expired,
// AvailableForPickup, OutForDelivery, Delivered, Undelivered, Exception
function map17trackStatus(trackInfo) {
  if (!trackInfo) return { status: 'pending', detail: '' }
  const latestStatus = trackInfo.latest_status?.status || ''
  const eventDesc = trackInfo.latest_event?.description || ''

  switch (latestStatus) {
    case 'Delivered':
      return { status: 'delivered', detail: eventDesc || 'Delivered' }
    case 'Exception':
    case 'Undelivered':
      return { status: 'exception', detail: eventDesc || 'Exception' }
    case 'OutForDelivery':
      return { status: 'out_for_delivery', detail: eventDesc || 'Out for delivery' }
    case 'InTransit':
    case 'AvailableForPickup':
      return { status: 'in_transit', detail: eventDesc || 'In transit' }
    case 'InfoReceived':
      return { status: 'in_transit', detail: eventDesc || 'Shipment info received' }
    case 'NotFound':
      return { status: 'pending', detail: eventDesc || 'Not found yet' }
    case 'Expired':
      return { status: 'expired', detail: eventDesc || 'Tracking expired' }
    default: {
      // Fallback: check description text
      const desc = (latestStatus + ' ' + eventDesc).toLowerCase()
      if (desc.includes('delivered')) return { status: 'delivered', detail: eventDesc }
      if (desc.includes('out for delivery')) return { status: 'out_for_delivery', detail: eventDesc }
      if (desc.includes('exception') || desc.includes('undelivered')) return { status: 'exception', detail: eventDesc }
      if (desc.includes('transit') || desc.includes('accepted') || desc.includes('pickup')) return { status: 'in_transit', detail: eventDesc }
      return { status: 'pending', detail: eventDesc }
    }
  }
}

// Check if signature is required from tracking events
function checkSignatureRequired(events) {
  const sigKeywords = ['signature', 'adult signature', 'direct signature', 'indirect signature']
  for (const evt of events) {
    const desc = (evt.description || evt.Details || '').toLowerCase()
    if (sigKeywords.some(kw => desc.includes(kw))) return true
  }
  return false
}

// Strip USPS 420+ZIP prefix — 17track can't handle it, but the 93xx number inside works fine
function normalize17trackNumber(trackingNumber) {
  const match = trackingNumber.match(/^420\d{5,9}(9[2345]\d{20,26})$/)
  return match ? match[1] : trackingNumber
}

// 17track carrier codes (numeric IDs required for registration)
const CARRIER_17TRACK = {
  usps: 21051,
  ups: 100002,
  fedex: 100003,
  dhl: 100001,
  amazon: 100143,
  ontrac: 100049,
  lasership: 100042,
}

// Register tracking numbers with 17track (required before gettrackinfo)
// Accepts array of { number, carrier } objects or plain tracking number strings
async function register17track(items, apiKey) {
  if (!apiKey || items.length === 0) return

  const payload = items.map(item => {
    if (typeof item === 'string') return { number: normalize17trackNumber(item) }
    const rawNum = item.number || item.tracking_number || item
    const entry = { number: normalize17trackNumber(String(rawNum)) }
    const carrierCode = CARRIER_17TRACK[item.carrier]
    if (carrierCode) entry.carrier = carrierCode
    return entry
  })

  // Deduplicate by tracking number
  const seen = new Set()
  const deduped = payload.filter(p => {
    if (seen.has(p.number)) return false
    seen.add(p.number)
    return true
  })

  try {
    const res = await fetch('https://api.17track.net/track/v2.4/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        '17token': apiKey,
      },
      body: JSON.stringify(deduped),
    })
    const data = await res.json()
    console.log('[Packages] 17track register:', res.status, 'accepted:', data.data?.accepted?.length || 0, 'rejected:', data.data?.rejected?.length || 0)

    // For already-registered packages, fix carrier via changecarrier if we have one
    if (data.data?.rejected?.length > 0) {
      for (const r of data.data.rejected) {
        console.log('[Packages] 17track register rejected:', r.number, 'error:', r.error?.code, r.error?.message)
        // -18019901 = already registered — update carrier if we have one
        if (r.error?.code === -18019901) {
          const item = deduped.find(p => p.number === r.number)
          if (item?.carrier) {
            await changeCarrier17track(r.number, item.carrier, apiKey)
          }
        }
      }
    }
  } catch (err) {
    console.error('[Packages] 17track register error:', err.message)
  }
}

// Change carrier for an already-registered tracking number
async function changeCarrier17track(trackingNumber, carrierCode, apiKey) {
  try {
    const res = await fetch('https://api.17track.net/track/v2.4/changecarrier', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        '17token': apiKey,
      },
      body: JSON.stringify([{ number: normalize17trackNumber(trackingNumber), carrier: carrierCode }]),
    })
    const data = await res.json()
    console.log('[Packages] 17track changecarrier:', normalize17trackNumber(trackingNumber), '→', carrierCode, 'status:', res.status, 'accepted:', data.data?.accepted?.length || 0)
  } catch (err) {
    console.error('[Packages] 17track changecarrier error:', err.message)
  }
}

// Poll 17track API for a batch of tracking numbers
async function poll17track(trackingNumbers, apiKey) {
  if (!apiKey || trackingNumbers.length === 0) return []

  try {
    const res = await fetch('https://api.17track.net/track/v2.4/gettrackinfo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        '17token': apiKey,
      },
      body: JSON.stringify(
        trackingNumbers.map(tn => ({ number: normalize17trackNumber(tn) }))
      ),
    })

    if (res.status === 429) {
      const resetAt = new Date()
      resetAt.setUTCHours(24, 0, 0, 0) // midnight UTC
      trackingQuota = { exhausted: true, reset_at: resetAt.toISOString(), daily_used: trackingQuota.daily_used }
      console.log('[Packages] 17track API quota exhausted, pausing until', resetAt.toISOString())
      return []
    }

    const data = await res.json()
    console.log('[Packages] 17track gettrackinfo response:', JSON.stringify(data).slice(0, 1000))
    if (!res.ok) {
      console.error('[Packages] 17track API error:', JSON.stringify(data).slice(0, 500))
      return []
    }

    trackingQuota.daily_used += trackingNumbers.length

    // 17track v2.4 returns { data: { accepted: [...], rejected: [...] } }
    const accepted = data.data?.accepted || []
    const rejected = data.data?.rejected || []
    if (rejected.length > 0) {
      console.log('[Packages] 17track rejected:', JSON.stringify(rejected).slice(0, 500))
    }
    console.log('[Packages] 17track accepted:', accepted.length, 'rejected:', rejected.length)
    return accepted
  } catch (err) {
    console.error('[Packages] 17track poll error:', err.message)
    return []
  }
}

// Main polling loop — runs every 5 minutes
async function pollActivePackages() {
  // Check quota reset
  if (trackingQuota.exhausted && trackingQuota.reset_at) {
    if (new Date() >= new Date(trackingQuota.reset_at)) {
      trackingQuota = { exhausted: false, reset_at: null, daily_used: 0 }
      console.log('[Packages] 17track quota reset')
    } else {
      return // still exhausted
    }
  }

  const apiKey = getTrackingApiKey()
  if (!apiKey) return

  const packages = getAllPackages('active')
  if (packages.length === 0) return

  const now = new Date()
  const eligible = packages.filter(pkg => {
    if (!pkg.last_polled) return true
    const minsSinceLastPoll = (now - new Date(pkg.last_polled)) / 60000
    return minsSinceLastPoll >= (pkg.poll_interval_minutes || 120)
  })

  if (eligible.length === 0) return

  let anyUpdated = false
  const settings = getData('settings') || {}

  // Batch into groups of 40
  const batches = []
  for (let i = 0; i < eligible.length; i += 40) {
    batches.push(eligible.slice(i, i + 40))
  }

  for (let bi = 0; bi < batches.length; bi++) {
    if (bi > 0) await new Promise(r => setTimeout(r, 1000))
    const batch = batches[bi]
    const trackingNumbers = batch.map(p => p.tracking_number)

    // Register any never-polled packages first (with carrier codes)
    const unpolled = batch.filter(p => !p.last_polled)
    if (unpolled.length > 0) {
      await register17track(unpolled, apiKey)
      await new Promise(r => setTimeout(r, 1000)) // brief delay after register
    }

    const results = await poll17track(trackingNumbers, apiKey)

    if (trackingQuota.exhausted) break

    for (const result of results) {
      const trackInfo = result.track_info || result.track || {}
      const events = (trackInfo.tracking?.providers?.[0]?.events || []).map(e => ({
        timestamp: e.time_iso || e.time_utc || '',
        location: e.location || '',
        description: e.description || '',
        status: e.stage || '',
      }))

      const { status: newStatus, detail } = map17trackStatus(trackInfo)
      const sigRequired = checkSignatureRequired(events)

      let eta = null
      if (trackInfo.time_metrics) {
        const tm = trackInfo.time_metrics
        eta = tm.estimated_delivery_date?.from || tm.estimated_delivery_date?.to || tm.scheduled_delivery_date || null
        if (!eta) {
          console.log('[Packages] No ETA for', result.number, 'time_metrics:', JSON.stringify(tm).slice(0, 300))
        }
      }

      // Update ALL packages with this tracking number (handles duplicates + 420-prefix normalization)
      const matching = batch.filter(p => p.tracking_number === result.number || normalize17trackNumber(p.tracking_number) === result.number)
      for (const pkg of matching) {
        // Never downgrade a package that already has real tracking data
        const STATUS_RANK = { delivered: 5, out_for_delivery: 4, in_transit: 3, exception: 2, pending: 1, expired: 0 }
        const oldRank = STATUS_RANK[pkg.status] ?? 1
        const newRank = STATUS_RANK[newStatus] ?? 1
        if (newRank < oldRank && oldRank >= 2) {
          updatePackagePartial(pkg.id, { last_polled: now.toISOString() })
          continue
        }

        const updates = {
          status: newStatus,
          status_detail: detail,
          events: events.length > 0 ? events : pkg.events,
          last_polled: now.toISOString(),
          updated_at: now.toISOString(),
          poll_interval_minutes: calcPollInterval({ ...pkg, status: newStatus }),
          last_location: events[0]?.location || pkg.last_location,
          signature_required: sigRequired,
        }

        if (eta) updates.eta = eta

        // Handle delivery
        if (newStatus === 'delivered' && pkg.status !== 'delivered') {
          updates.delivered_at = now.toISOString()
          const retentionDays = settings.package_retention_days ?? 3
          const cleanupDate = new Date(now.getTime() + retentionDays * 86400000)
          updates.auto_cleanup_at = cleanupDate.toISOString()
          console.log(`[Packages] ${pkg.label || pkg.tracking_number} delivered`)
          sendPackageEmail(pkg, 'delivered')
          sendPackagePush(pkg, 'delivered')
          sendPackagePushover(pkg, 'delivered')

          if (pkg.signature_task_id) {
            const task = getTask(pkg.signature_task_id)
            if (task && task.status !== 'done') {
              updateTaskPartial(pkg.signature_task_id, { status: 'done', completed_at: now.toISOString() })
            }
          }
        }

        // Handle signature required
        if (sigRequired && !pkg.signature_required && !pkg.signature_task_id) {
          if (settings.package_auto_task_signature !== false) {
            const taskId = `pkg-sig-${pkg.id}-${Date.now()}`
            upsertTask({
              id: taskId,
              title: `Be home to sign for: ${pkg.label || pkg.tracking_number}`,
              status: 'not_started',
              notes: `Package: ${pkg.tracking_number}\nCarrier: ${pkg.carrier_name || pkg.carrier || 'Unknown'}\nTracking requires signature.`,
              high_priority: true, energy: 'errand', energy_level: 2,
              due_date: pkg.eta || new Date().toISOString().split('T')[0],
              created_at: now.toISOString(), last_touched: now.toISOString(),
              tags: [], attachments: [], checklist: [], checklists: [], comments: [],
            })
            updates.signature_task_id = taskId
            console.log(`[Packages] Created signature task for ${pkg.label || pkg.tracking_number}`)
          }
        }

        // Notifications for status changes
        if (newStatus === 'exception' && pkg.status !== 'exception') {
          sendPackageEmail(pkg, 'exception')
          sendPackagePush(pkg, 'exception')
          sendPackagePushover(pkg, 'exception')
        }
        if (newStatus === 'out_for_delivery' && pkg.status !== 'out_for_delivery') {
          sendPackageEmail(pkg, 'out_for_delivery')
          sendPackagePush(pkg, 'out_for_delivery')
          sendPackagePushover(pkg, 'out_for_delivery')
        }
        if (sigRequired && !pkg.signature_required) {
          sendPackageEmail(pkg, 'signature_required')
          sendPackagePush(pkg, 'signature_required')
          sendPackagePushover(pkg, 'signature_required')
        }

        updatePackagePartial(pkg.id, updates)
        anyUpdated = true
      }
    }

    // Mark packages that weren't in results as polled too (to avoid re-polling immediately)
    for (const pkg of batch) {
      if (!results.find(r => r.number === pkg.tracking_number)) {
        updatePackagePartial(pkg.id, { last_polled: now.toISOString() })
      }
    }
  }

  // Auto-cleanup delivered packages past retention
  const allPkgs = getAllPackages()
  for (const pkg of allPkgs) {
    if (pkg.auto_cleanup_at && new Date(pkg.auto_cleanup_at) <= now) {
      console.log(`[Packages] Auto-cleaning ${pkg.label || pkg.tracking_number}`)
      deletePackage(pkg.id)
      anyUpdated = true
    }
  }

  if (anyUpdated) {
    const newVersion = bumpVersion()
    broadcast(newVersion, 'server-package-poll')
  }
}

// Package CRUD endpoints
app.get('/api/packages', (req, res) => {
  const packages = getAllPackages(req.query.status)
  res.json(packages)
})

app.get('/api/packages/:id', (req, res) => {
  const pkg = getPackage(req.params.id)
  if (!pkg) return res.status(404).json({ error: 'Package not found' })
  res.json(pkg)
})

app.post('/api/packages', async (req, res) => {
  const { tracking_number, label, carrier } = req.body
  if (!tracking_number) return res.status(400).json({ error: 'tracking_number required' })

  const normalizedNumber = normalize17trackNumber(tracking_number.trim())

  // Duplicate check
  const existing = getAllPackages().find(p => p.tracking_number.toLowerCase() === normalizedNumber.toLowerCase())
  if (existing) return res.status(409).json({ error: 'Tracking number already exists', existing_id: existing.id, label: existing.label })

  const detected = carrier ? { code: carrier, name: carrier } : detectCarrierServer(normalizedNumber)
  const now = new Date().toISOString()
  const id = `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const pkg = {
    id,
    tracking_number: normalizedNumber,
    carrier: detected?.code || 'other',
    carrier_name: detected?.name || 'Unknown',
    label: label || '',
    status: 'pending',
    status_detail: '',
    eta: null,
    delivered_at: null,
    signature_required: false,
    signature_task_id: null,
    last_location: '',
    events: [],
    last_polled: null,
    poll_interval_minutes: 30,
    auto_cleanup_at: null,
    created_at: now,
    updated_at: now,
  }

  upsertPackage(pkg)

  // Register + immediate poll so the card shows real data right away
  const apiKey = getTrackingApiKey(req)
  if (apiKey) {
    try {
      await register17track([pkg], apiKey)
      await new Promise(r => setTimeout(r, 1500))
      const results = await poll17track([pkg.tracking_number], apiKey)
      if (results.length > 0) {
        const trackInfo = results[0].track_info || {}
        const events = (trackInfo.tracking?.providers?.[0]?.events || []).map(e => ({
          timestamp: e.time_iso || e.time_utc || '', location: e.location || '',
          description: e.description || '', status: e.stage || '',
        }))
        const { status: newStatus, detail } = map17trackStatus(trackInfo)
        const updates = {
          status: newStatus, status_detail: detail,
          events: events.length > 0 ? events : [],
          last_polled: new Date().toISOString(), updated_at: new Date().toISOString(),
          poll_interval_minutes: calcPollInterval({ ...pkg, status: newStatus }),
          last_location: events[0]?.location || '', signature_required: checkSignatureRequired(events),
        }
        if (trackInfo.time_metrics) {
          updates.eta = trackInfo.time_metrics.estimated_delivery_date?.from || trackInfo.time_metrics.estimated_delivery_date?.to || trackInfo.time_metrics.scheduled_delivery_date || null
        }
        updatePackagePartial(pkg.id, updates)
        Object.assign(pkg, updates)
      }
    } catch (err) {
      console.error('[Packages] Initial poll failed:', err.message)
    }
  }

  const newVersion = bumpVersion()
  const clientId = req.body._clientId || req.headers['x-client-id']
  broadcast(newVersion, clientId)
  res.json(getPackage(pkg.id) || pkg)
})

app.patch('/api/packages/:id', (req, res) => {
  const pkg = updatePackagePartial(req.params.id, req.body)
  if (!pkg) return res.status(404).json({ error: 'Package not found' })
  const newVersion = bumpVersion()
  const clientId = req.body._clientId || req.headers['x-client-id']
  broadcast(newVersion, clientId)
  res.json(pkg)
})

app.delete('/api/packages/:id', (req, res) => {
  const pkg = getPackage(req.params.id)
  if (!pkg) return res.status(404).json({ error: 'Package not found' })
  deletePackage(req.params.id)
  const newVersion = bumpVersion()
  broadcast(newVersion, req.headers['x-client-id'])
  res.json({ ok: true })
})

app.post('/api/packages/:id/refresh', async (req, res) => {
  const pkg = getPackage(req.params.id)
  if (!pkg) return res.status(404).json({ error: 'Package not found' })

  // Throttle: 5 minutes per package (skip for pending packages — user is waiting for data)
  if (pkg.last_polled && pkg.status !== 'pending') {
    const minsSince = (Date.now() - new Date(pkg.last_polled)) / 60000
    if (minsSince < 5) {
      return res.json({ ...pkg, cached: true, next_refresh_at: new Date(new Date(pkg.last_polled).getTime() + 5 * 60000).toISOString() })
    }
  }

  const apiKey = getTrackingApiKey(req)
  if (!apiKey) return res.json({ ...pkg, error: 'No tracking API key configured' })

  if (trackingQuota.exhausted) {
    return res.json({ ...pkg, error: 'API quota exhausted', reset_at: trackingQuota.reset_at })
  }

  await register17track([pkg], apiKey)
  await new Promise(r => setTimeout(r, 1000))

  const results = await poll17track([pkg.tracking_number], apiKey)
  console.log(`[Packages] refresh ${pkg.tracking_number}: ${results.length} result(s)`)
  if (results.length > 0) {
    const result = results[0]
    const trackInfo = result.track_info || result.track || {}
    const events = (trackInfo.tracking?.providers?.[0]?.events || trackInfo.tracking_detail || []).map(e => ({
      timestamp: e.time_iso || e.Date || e.time || '',
      location: e.location || '',
      description: e.description || e.Details || e.event || '',
      status: e.status || '',
    }))
    const { status: newStatus, detail } = map17trackStatus(trackInfo)
    const now = new Date().toISOString()

    const updates = {
      status: newStatus,
      status_detail: detail,
      events: events.length > 0 ? events : pkg.events,
      last_polled: now,
      updated_at: now,
      poll_interval_minutes: calcPollInterval({ ...pkg, status: newStatus }),
      last_location: events[0]?.location || pkg.last_location,
      signature_required: checkSignatureRequired(events),
    }

    if (trackInfo.time_metrics) {
      updates.eta = trackInfo.time_metrics.estimated_delivery_date?.from || trackInfo.time_metrics.estimated_delivery_date?.to || trackInfo.time_metrics.scheduled_delivery_date || null
    }

    const updated = updatePackagePartial(pkg.id, updates)
    const newVersion = bumpVersion()
    broadcast(newVersion, req.headers['x-client-id'])
    return res.json(updated)
  }

  updatePackagePartial(pkg.id, { last_polled: new Date().toISOString() })
  res.json(getPackage(pkg.id))
})

app.post('/api/packages/refresh-all', async (req, res) => {
  const apiKey = getTrackingApiKey(req)
  if (!apiKey) return res.json({ error: 'No tracking API key configured', updated: 0 })
  if (trackingQuota.exhausted) return res.json({ error: 'API quota exhausted', updated: 0 })

  const packages = getAllPackages('active')
  if (packages.length === 0) return res.json({ updated: 0 })

  await register17track(packages, apiKey)

  const batches = []
  for (let i = 0; i < packages.length; i += 40) {
    batches.push(packages.slice(i, i + 40))
  }

  let totalUpdated = 0
  const now = new Date().toISOString()
  const settings = getData('settings') || {}

  for (let bi = 0; bi < batches.length; bi++) {
    if (bi > 0) await new Promise(r => setTimeout(r, 1000))
    const batch = batches[bi]
    const results = await poll17track(batch.map(p => p.tracking_number), apiKey)

    for (const result of results) {
      const trackInfo = result.track_info || {}
      const events = (trackInfo.tracking?.providers?.[0]?.events || []).map(e => ({
        timestamp: e.time_iso || e.time_utc || '',
        location: e.location || '',
        description: e.description || '',
        status: e.stage || '',
      }))

      const { status: newStatus, detail } = map17trackStatus(trackInfo)

      const updates = {
        status: newStatus,
        status_detail: detail,
        events: events.length > 0 ? events : undefined,
        last_polled: now,
        updated_at: now,
        poll_interval_minutes: calcPollInterval({ status: newStatus }),
        last_location: events[0]?.location || undefined,
        signature_required: checkSignatureRequired(events),
      }

      if (trackInfo.time_metrics) {
        updates.eta = trackInfo.time_metrics.estimated_delivery_date?.from || trackInfo.time_metrics.estimated_delivery_date?.to || trackInfo.time_metrics.scheduled_delivery_date || null
      }

      // Update ALL packages with this tracking number (handles duplicates + 420-prefix normalization)
      const matching = batch.filter(p => p.tracking_number === result.number || normalize17trackNumber(p.tracking_number) === result.number)
      for (const pkg of matching) {
        // Never downgrade a package that already has real tracking data
        // 17track intermittently returns NotFound even for packages with valid data
        const STATUS_RANK = { delivered: 5, out_for_delivery: 4, in_transit: 3, exception: 2, pending: 1, expired: 0 }
        const oldRank = STATUS_RANK[pkg.status] ?? 1
        const newRank = STATUS_RANK[newStatus] ?? 1
        if (newRank < oldRank && oldRank >= 2) {
          // Only update last_polled so we don't re-poll immediately
          updatePackagePartial(pkg.id, { last_polled: now })
          continue
        }

        const pkgUpdates = { ...updates }
        if (!pkgUpdates.events) pkgUpdates.events = pkg.events
        if (!pkgUpdates.last_location) pkgUpdates.last_location = pkg.last_location

        if (newStatus === 'delivered' && pkg.status !== 'delivered') {
          pkgUpdates.delivered_at = now
          const retentionDays = settings.package_retention_days ?? 3
          pkgUpdates.auto_cleanup_at = new Date(Date.now() + retentionDays * 86400000).toISOString()
        }

        updatePackagePartial(pkg.id, pkgUpdates)
        totalUpdated++
      }
    }

    // Mark packages not in results as polled
    for (const pkg of batch) {
      if (!results.find(r => r.number === pkg.tracking_number)) {
        updatePackagePartial(pkg.id, { last_polled: now })
      }
    }
  }

  if (totalUpdated > 0) {
    const newVersion = bumpVersion()
    broadcast(newVersion, req.headers['x-client-id'])
  }

  res.json({ updated: totalUpdated, total: packages.length })
})

app.get('/api/packages/api-status', (req, res) => {
  res.json({
    available: !trackingQuota.exhausted && !!getTrackingApiKey(req),
    configured: !!getTrackingApiKey(req),
    exhausted: trackingQuota.exhausted,
    reset_at: trackingQuota.reset_at,
    daily_used: trackingQuota.daily_used,
  })
})

app.post('/api/packages/test-connection', async (req, res) => {
  const apiKey = getTrackingApiKey(req)
  if (!apiKey) return res.json({ connected: false, error: 'No API key configured' })

  try {
    // Use the quota endpoint — free, doesn't consume a tracking query
    const testRes = await fetch('https://api.17track.net/track/v2.4/getquota', {
      method: 'GET',
      headers: { '17token': apiKey },
    })
    if (testRes.status === 401 || testRes.status === 403) {
      return res.json({ connected: false, error: 'Invalid API key' })
    }
    const data = await testRes.json()
    if (data.code === 0 || testRes.ok) {
      return res.json({ connected: true, quota: data.data })
    }
    return res.json({ connected: false, error: data.message || 'Unknown error' })
  } catch (err) {
    return res.json({ connected: false, error: err.message })
  }
})

app.post('/api/packages/detect-carrier', (req, res) => {
  const { tracking_number } = req.body
  const normalized = normalize17trackNumber((tracking_number || '').trim())
  const result = detectCarrierServer(normalized)
  res.json(result || { code: 'other', name: 'Unknown' })
})

// --- Email notification endpoints ---
app.get('/api/email/status', (req, res) => {
  res.json(getEmailStatus())
})

app.post('/api/email/test', async (req, res) => {
  const result = await sendTestEmail()
  res.json(result)
})

// --- Weather endpoints ---
app.get('/api/weather', (req, res) => {
  const cache = getWeatherCache()
  const status = getWeatherStatus()
  res.json({ ...status, cache })
})

app.post('/api/weather/refresh', async (req, res) => {
  const force = req.body?.force === true
  const result = await refreshWeather({ force })
  res.json(result)
})

app.post('/api/weather/geocode', async (req, res) => {
  const query = (req.body?.query || '').trim()
  if (!query) return res.status(400).json({ error: 'Missing query' })
  try {
    const results = await geocodeLocation(query)
    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/weather/clear-cache', (req, res) => {
  clearWeatherCache()
  res.json({ ok: true })
})

// --- Push notification endpoints ---
app.get('/api/push/status', (req, res) => {
  res.json(getPushStatus())
})

app.get('/api/push/vapid-key', (req, res) => {
  const key = getVapidPublicKey()
  if (!key) return res.status(404).json({ error: 'VAPID not configured' })
  res.json({ publicKey: key })
})

app.post('/api/push/subscribe', (req, res) => {
  const { endpoint, keys } = req.body || {}
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' })
  }
  const id = crypto.randomUUID()
  upsertPushSubscription(id, endpoint, keys.p256dh, keys.auth)
  console.log(`[Push] New subscription registered: ...${endpoint.slice(-30)}`)
  res.json({ ok: true })
})

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {}
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' })
  deletePushSubscription(endpoint)
  console.log(`[Push] Subscription removed: ...${endpoint.slice(-30)}`)
  res.json({ ok: true })
})

app.post('/api/push/test', async (req, res) => {
  const result = await sendTestPush()
  res.json(result)
})

// --- Pushover notification endpoints ---
app.get('/api/pushover/status', (req, res) => {
  res.json(getPushoverStatus())
})

app.post('/api/pushover/test', async (req, res) => {
  const result = await sendTestPushover()
  res.json(result)
})

app.post('/api/pushover/test-emergency', async (req, res) => {
  const result = await sendTestPushoverEmergency()
  res.json(result)
})

// --- Daily digest test (sends via every enabled channel right now) ---
app.post('/api/digest/test', async (req, res) => {
  try {
    const result = await sendDigestNow()
    res.json(result)
  } catch (err) {
    console.error('[Digest] Test failed:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// --- Notification engagement tracking ---

// Inline web-push action handlers — Snooze 1h / Done. The push notification's
// action buttons hit these, letting the user resolve without opening the app
// for low-stakes pings. Stamps tap + completion on the underlying notification
// log so engagement analytics still credit the channel.
app.post('/api/notifications/action/snooze', (req, res) => {
  const { taskId, hours = 1 } = req.body || {}
  if (!taskId) return res.status(400).json({ error: 'Missing taskId' })
  const task = getTask(taskId)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  const until = new Date(Date.now() + Math.max(1, hours) * 3600 * 1000).toISOString()
  updateTaskPartial(taskId, {
    snoozed_until: until,
    snooze_count: (task.snooze_count || 0) + 1,
    last_touched: new Date().toISOString(),
  })
  markNotificationTapped(taskId, 'push')
  bumpVersion()
  res.json({ ok: true })
})

app.post('/api/notifications/action/done', (req, res) => {
  const { taskId } = req.body || {}
  if (!taskId) return res.status(400).json({ error: 'Missing taskId' })
  const task = getTask(taskId)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  updateTaskPartial(taskId, {
    status: 'done',
    completed_at: new Date().toISOString(),
    last_touched: new Date().toISOString(),
  })
  markNotificationTapped(taskId, 'push')
  bumpVersion()
  res.json({ ok: true })
})

app.post('/api/notifications/tap', (req, res) => {
  const { taskId, channel } = req.body || {}
  if (!taskId) return res.status(400).json({ error: 'Missing taskId' })
  // Try to mark as tapped on each channel — the tap happened, but we don't
  // know which channel the user came from unless the client passed it. Default
  // is to try all three and return whichever stamped.
  const channels = channel ? [channel] : ['pushover', 'push', 'email']
  let stamped = null
  for (const c of channels) {
    if (markNotificationTapped(taskId, c)) {
      stamped = c
      break
    }
  }
  // Side-effect: cancel any outstanding Pushover Emergency receipt for this
  // task. The user has engaged; the alarm has done its job.
  const task = getTask(taskId)
  if (task && task.pushover_receipt) {
    cancelPushoverEmergencyForTask(taskId).catch(() => {})
  }
  res.json({ ok: true, channel: stamped })
})

app.get('/api/analytics/throttle-decisions', (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days || '30', 10)))
  res.json({ decisions: listThrottleDecisions(days) })
})

app.post('/api/analytics/throttle-decisions/:id/feedback', (req, res) => {
  const { feedback } = req.body || {}
  if (!['up', 'down'].includes(feedback)) return res.status(400).json({ error: 'feedback must be up|down' })
  const ok = markThrottleDecisionFeedback(req.params.id, feedback)
  res.json({ ok })
})

app.get('/api/analytics/notifications', (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days || '30', 10)))
  const rows = getNotificationAnalytics(days)
  // Aggregate into the shape the dashboard needs.
  const byChannel = {}
  const byType = {}
  for (const r of rows) {
    byChannel[r.channel] = byChannel[r.channel] || { sent: 0, tapped: 0, completed: 0 }
    byChannel[r.channel].sent += r.sent
    byChannel[r.channel].tapped += r.tapped
    byChannel[r.channel].completed += r.completed
    byType[r.type] = byType[r.type] || { sent: 0, tapped: 0, completed: 0 }
    byType[r.type].sent += r.sent
    byType[r.type].tapped += r.tapped
    byType[r.type].completed += r.completed
  }
  // Add rate fields
  const addRates = obj => {
    for (const k of Object.keys(obj)) {
      const o = obj[k]
      o.tap_rate = o.sent > 0 ? Math.round((o.tapped / o.sent) * 1000) / 10 : 0
      o.completion_rate = o.sent > 0 ? Math.round((o.completed / o.sent) * 1000) / 10 : 0
    }
  }
  addRates(byChannel)
  addRates(byType)
  res.json({ days, byChannel, byType, raw: rows })
})

// Diagnostic: SW push handler fires this to confirm it ran
app.post('/api/push/log', (req, res) => {
  console.log(`[Push] SW handler fired:`, req.body)
  res.json({ ok: true })
})

// ============================================================
// AI Adviser
// ============================================================

const ADVISER_MODEL = 'claude-sonnet-4-20250514'
const ADVISER_MAX_TURNS = 15
const adviserAbortMap = new Map() // sessionId -> AbortController

function adviserDeps(req) {
  return {
    anthropicKey: getAnthropicKey(req),
    notionToken: getLegacyNotionToken(req), // sync fallback; OAuth token populated after via getNotionAccessToken
    trello: getTrelloAuth(req),
    gcalToken: null, // filled in async before tools that need it
    syncGmail,
    getWeatherCache,
    getWeatherStatus,
    refreshWeatherFn: refreshWeather,
    geocodeLocationFn: geocodeLocation,
    createPackageFn: async ({ tracking_number, label, carrier }) => {
      // Synthetic request matching /api/packages POST shape
      const apiKey = getTrackingApiKey(req)
      const normalizedNumber = normalize17trackNumber(tracking_number.trim())
      const existing = getAllPackages().find(p => p.tracking_number.toLowerCase() === normalizedNumber.toLowerCase())
      if (existing) throw new Error(`Tracking number already exists: ${existing.label || existing.tracking_number}`)
      const detected = carrier ? { code: carrier, name: carrier } : detectCarrierServer(normalizedNumber)
      const now = new Date().toISOString()
      const id = `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const pkg = {
        id, tracking_number: normalizedNumber,
        carrier: detected?.code || 'other', carrier_name: detected?.name || 'Unknown',
        label: label || '', status: 'pending', status_detail: '',
        eta: null, delivered_at: null, signature_required: false, signature_task_id: null,
        last_location: '', events: [], last_polled: null, poll_interval_minutes: 30,
        auto_cleanup_at: null, created_at: now, updated_at: now,
      }
      upsertPackage(pkg)
      if (apiKey) {
        try {
          await register17track([pkg], apiKey)
          await new Promise(r => setTimeout(r, 1500))
        } catch { /* non-fatal */ }
      }
      return getPackage(id) || pkg
    },
    refreshAllPackagesFn: async () => {
      const apiKey = getTrackingApiKey(req)
      if (!apiKey) return { updated: 0, error: 'No tracking API key' }
      if (trackingQuota.exhausted) return { updated: 0, error: 'API quota exhausted' }
      // Just schedule a poll cycle; pollActivePackages is defined below.
      await pollActivePackages()
      return { scheduled: true }
    },
  }
}

function adviserSystemPrompt() {
  const today = new Date().toISOString().split('T')[0]
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const gcalConnected = !!getData(GCAL_TOKENS_KEY)?.refresh_token
  const gmailConnected = !!getData(GMAIL_TOKENS_KEY)?.refresh_token
  const notionConnected = !!(getData('notion_mcp_tokens')?.access_token || envNotionToken)
  const trelloConnected = !!(envTrelloKey && envTrelloToken)
  const trackingConnected = !!getTrackingApiKey()
  return `You are Quokka, the cheerful AI adviser for Boomerang — an ADHD task manager PWA. Today is ${today} (${dayOfWeek}). You are named after the quokka (a small, smiley Australian marsupial that looks like it's always having a good day); lean into a warm, upbeat, down-to-earth tone without being cloying. The very occasional Aussie flavor ("no worries", "on ya") is fine but don't overdo it.

The user will describe something they want done ("I've rescheduled my FAA exam to May 12 — adjust everything", "move all my lawn-care tasks to next weekend since it'll rain", etc.). You have tools that mirror every capability of the app: tasks, routines, Google Calendar, Notion, Trello, Gmail, packages, weather, settings.

Behavior rules:
1. ALWAYS use search/list tools first to find the right records before acting. Never guess IDs.
2. For multi-step work, stage ALL the changes in one plan, then explain what you'll do in a single final message. Do NOT execute — mutations are automatically staged for user confirmation.
3. Prefer batch tools (search_tasks with filters) over many individual get_task calls.
4. If an integration is not connected, note that in your final message and skip its tools rather than failing.
5. Be concise. Your final message should read like a brief handoff note: "Found 3 tasks tied to your FAA exam. I'll push them to May 12, update the study routine anchor, and move the GCal event."
6. When calling update/delete/archive tools for EXTERNAL resources (gcal_update_event, gcal_delete_event, notion_update_page, trello_update_card, trello_archive_card, trello_add_checklist), ALWAYS populate the \`*_hint\` field (summary_hint / title_hint / name_hint / card_name_hint) with the human-readable title you saw in the corresponding list/search tool. The hint only appears in the plan preview the user reads; it is never sent to the external API. Without it, the preview shows a raw ID and the user can't tell what you're about to change. For local tasks/routines this is handled automatically.
7. BATCH tool calls in parallel whenever possible. You can emit multiple \`tool_use\` blocks in a SINGLE assistant turn and they will all be executed before the next turn. For large bulk operations (e.g. "move 20 tasks to backlog", "update due_date on 12 tasks"), emit all 20 \`update_task\`/\`move_to_backlog\` calls in ONE turn — do NOT serialize them across 20 separate turns. Serial tool-use loops can take minutes and the user's mobile connection may drop before you finish.
8. Web search is available. Use the \`web_search\` tool (Anthropic server-side) when the user asks for current information (prices, news, reviews, current best-practices, etc.) or when your training data would be stale. After searching, you can stage \`create_task\` / \`update_task\` calls with the researched info in the notes. For task-specific research — e.g. "research my FAA exam prep" where the goal is to enrich an existing task's notes with current sources — prefer the \`research_task\` tool; it stages a previewable, revertable note-append that the user explicitly approves.
9. Multi-part tasks: when the user wants "a plan for X" or "break this down," prefer ONE task with a populated \`checklist_items\` array over many separate tasks. The UI renders a single card with a progress bar — that's a better ADHD-friendly surface than 8 bouncing independent tasks. Only create multiple top-level tasks when they have genuinely independent due dates, energies, or tags.

Integration status:
- Google Calendar: ${gcalConnected ? 'connected' : 'NOT connected'}
- Gmail: ${gmailConnected ? 'connected' : 'NOT connected'}
- Notion: ${notionConnected ? 'connected' : 'NOT connected'}
- Trello: ${trelloConnected ? 'connected' : 'NOT connected'}
- Package tracking: ${trackingConnected ? 'connected' : 'NOT connected'}

Important: ALL mutation tools are STAGED, not executed. Tell the user what you've queued in your final message. They will review and approve the plan separately. Do not ask them to confirm inside your message — the UI handles that.`
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  // Force Node to flush the chunk instead of waiting for a bigger buffer —
  // matters on slow connections and with some proxy setups where SSE events
  // would otherwise batch up and the client looks hung.
  if (typeof res.flush === 'function') res.flush()
}

const ADVISER_TURN_TIMEOUT_MS = 90000

async function callAdviserModel(apiKey, body, outerSignal) {
  // Wrap the outer abort signal with a per-turn timeout so a hung upstream
  // never leaves the user staring at a "thinking…" dot forever.
  const timeoutCtl = new AbortController()
  const timer = setTimeout(() => timeoutCtl.abort(new Error('turn timeout')), ADVISER_TURN_TIMEOUT_MS)
  const onOuter = () => timeoutCtl.abort(outerSignal.reason)
  if (outerSignal.aborted) timeoutCtl.abort(outerSignal.reason)
  else outerSignal.addEventListener('abort', onOuter, { once: true })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: timeoutCtl.signal,
    })
    const text = await response.text()
    let data
    try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
    if (!response.ok) {
      const msg = data.error?.message || data.error || data.raw || `Claude ${response.status}`
      throw new Error(msg)
    }
    return data
  } finally {
    clearTimeout(timer)
    outerSignal.removeEventListener?.('abort', onOuter)
  }
}

app.post('/api/adviser/chat', async (req, res) => {
  const apiKey = getAnthropicKey(req)
  if (!apiKey) return res.status(400).json({ error: 'No Anthropic API key configured' })

  const { message, history, sessionId: clientSessionId } = req.body || {}
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message is required' })

  const sessionId = clientSessionId && getSession(clientSessionId) ? clientSessionId : newSession()
  const logTag = `[Adviser ${sessionId.slice(0, 8)}]`
  console.log(`${logTag} chat start — message="${message.slice(0, 80).replace(/\n/g, ' ')}${message.length > 80 ? '…' : ''}" historyLen=${Array.isArray(history) ? history.length : 0}`)

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  // Prime the connection so any intermediate proxy/buffer commits the chunked
  // response immediately instead of waiting for ~1 KB of body. Matters on iOS
  // Safari behind some CDNs where the client would otherwise block on the
  // initial event.
  res.write(': connected\n\n')
  if (typeof res.flush === 'function') res.flush()
  sseWrite(res, 'session', { sessionId })

  // Heartbeat so the browser doesn't silently drop the long-lived connection
  // while we're waiting on a slow Claude turn.
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n')
      if (typeof res.flush === 'function') res.flush()
    } catch { /* client gone */ }
  }, 15000)
  req.on('close', () => {
    clearInterval(heartbeat)
    console.log(`${logTag} client closed connection`)
  })

  // Build conversation: prior history (user+assistant turns) + new user message.
  const messages = Array.isArray(history) ? history.slice(-20) : []
  messages.push({ role: 'user', content: message })

  // Client tools (executed by us) + Anthropic's server-side web_search (executed
  // by Anthropic during the same API call; results come back inline in the
  // response content — we don't handle them, just surface them to the UI).
  const tools = [
    ...listToolSchemas(),
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
  ]
  const deps = adviserDeps(req)
  try {
    deps.gcalToken = await getGCalAccessToken()
  } catch { /* non-fatal */ }
  try {
    const oauth = await getNotionAccessToken(req)
    if (oauth) deps.notionToken = oauth
  } catch { /* non-fatal */ }

  const abortController = new AbortController()
  adviserAbortMap.set(sessionId, abortController)

  try {
    for (let turn = 0; turn < ADVISER_MAX_TURNS; turn++) {
      const session = getSession(sessionId)
      if (!session || session.aborted) {
        console.log(`${logTag} aborted before turn ${turn + 1}`)
        sseWrite(res, 'error', { message: 'Session aborted' })
        break
      }
      console.log(`${logTag} turn ${turn + 1}/${ADVISER_MAX_TURNS} — calling model, messages=${messages.length}`)
      sseWrite(res, 'turn', { n: turn + 1 })

      const t0 = Date.now()
      let response
      try {
        response = await callAdviserModel(apiKey, {
          model: ADVISER_MODEL,
          max_tokens: 2048,
          system: adviserSystemPrompt(),
          tools,
          messages,
        }, abortController.signal)
      } catch (err) {
        console.error(`${logTag} model call failed after ${Date.now() - t0}ms:`, err.message)
        throw err
      }
      console.log(`${logTag} turn ${turn + 1} response — stop_reason=${response.stop_reason} content_blocks=${response.content?.length || 0} (${Date.now() - t0}ms)`)

      // Emit any text blocks + surface server-side tool activity (web_search)
      // so the user sees what Quokka is doing instead of a silent pause.
      for (const block of response.content || []) {
        if (block.type === 'text' && block.text?.trim()) {
          sseWrite(res, 'message', { text: block.text })
        } else if (block.type === 'server_tool_use' && block.name === 'web_search') {
          sseWrite(res, 'tool_call', {
            id: block.id, name: 'web_search', input: block.input,
          })
        } else if (block.type === 'web_search_tool_result') {
          const r = block.content
          const count = Array.isArray(r) ? r.length : 0
          sseWrite(res, 'tool_result', {
            id: block.tool_use_id, name: 'web_search',
            result: { ok: true, data: { results: count } },
          })
        }
      }

      // Collect client-executed tool_use blocks (server_tool_use is handled by
      // Anthropic and doesn't come through our handleToolCall path).
      const toolUses = (response.content || []).filter(b => b.type === 'tool_use')
      if (toolUses.length === 0) {
        console.log(`${logTag} turn ${turn + 1} ended — no tool_use blocks`)
        break
      }

      // Add assistant's turn to messages
      messages.push({ role: 'assistant', content: response.content })

      // Execute each tool, collect results
      const toolResults = []
      for (const tu of toolUses) {
        console.log(`${logTag} tool_call: ${tu.name}(${JSON.stringify(tu.input).slice(0, 120)})`)
        sseWrite(res, 'tool_call', { id: tu.id, name: tu.name, input: tu.input })
        const tt0 = Date.now()
        const result = await handleToolCall(sessionId, tu.name, tu.input, deps)
        console.log(`${logTag} tool_result: ${tu.name} ${result.error ? 'ERROR: ' + result.error : (result.staged ? 'staged' : 'ok')} (${Date.now() - tt0}ms)`)
        sseWrite(res, 'tool_result', { id: tu.id, name: tu.name, result })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result).slice(0, 4000),
          is_error: !!result.error,
        })
      }

      // Add tool results as next user message
      messages.push({ role: 'user', content: toolResults })

      if (response.stop_reason === 'end_turn') { console.log(`${logTag} stop_reason end_turn, breaking`); break }
      if (response.stop_reason !== 'tool_use') { console.log(`${logTag} unexpected stop_reason ${response.stop_reason}, breaking`); break }
    }

    const session = getSession(sessionId)
    const plan = session ? session.plan : []
    console.log(`${logTag} chat done — staged ${plan.length} step(s)`)
    sseWrite(res, 'plan', {
      sessionId,
      steps: plan.map(p => ({ stepId: p.stepId, toolName: p.toolName, preview: p.preview })),
    })
    sseWrite(res, 'done', { sessionId })
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`${logTag} aborted: ${err.message || ''}`)
      sseWrite(res, 'error', { message: err.message || 'Aborted' })
    } else {
      console.error(`${logTag} chat error:`, err.message)
      sseWrite(res, 'error', { message: err.message })
    }
  } finally {
    clearInterval(heartbeat)
    adviserAbortMap.delete(sessionId)
    res.end()
  }
})

app.post('/api/adviser/commit', async (req, res) => {
  const { sessionId } = req.body || {}
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  const session = getSession(sessionId)
  if (!session) return res.status(404).json({ error: 'Session expired or already committed' })

  const deps = adviserDeps(req)
  try { deps.gcalToken = await getGCalAccessToken() } catch { /* non-fatal */ }
  try {
    const oauth = await getNotionAccessToken(req)
    if (oauth) deps.notionToken = oauth
  } catch { /* non-fatal */ }

  const outcome = await commitPlan(sessionId, deps)
  if (outcome.broadcastNeeded) {
    const newVersion = bumpVersion()
    broadcast(newVersion, 'adviser')
    outcome.version = newVersion
  }
  res.json(outcome)
})

app.post('/api/adviser/abort', (req, res) => {
  const { sessionId } = req.body || {}
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })
  abortSession(sessionId)
  const ctrl = adviserAbortMap.get(sessionId)
  if (ctrl) ctrl.abort()
  clearSession(sessionId)
  res.json({ ok: true })
})

app.get('/api/adviser/tools', (_req, res) => {
  // Diagnostic: list registered tool names
  res.json({ tools: listToolSchemas().map(t => ({ name: t.name, description: t.description })) })
})

// Thread persistence — iOS evicts PWA localStorage aggressively, so the adviser
// conversation is stored server-side in app_data so it survives tab freezes,
// app switches, and device restarts. Single-user self-hosted app = one CURRENT
// thread plus a rolling archive of past threads accessible via the history UI.
// --- Quokka chats: multi-thread storage with 30-day rolling TTL + star-to-keep ---
//
// Each chat is an independent, switchable conversation. Non-starred chats expire 30 days
// after last activity; starring clears the expiry; unstarring starts a 7-day grace period
// so the user sees a warning banner and can re-star before deletion. A sweep runs on every
// list request.
//
// Replaces the older single-thread + rolling-archive model (`adviser_thread`/`adviser_archive`).
// Legacy data is migrated in-place on first access.

const CHATS_KEY = 'adviser_chats'
const ACTIVE_CHAT_KEY = 'adviser_active_chat_id'
const CHAT_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days rolling from last activity
const UNSTAR_GRACE_MS = 7 * 24 * 60 * 60 * 1000 // 7-day grace after unstar
const MAX_MESSAGES_PER_CHAT = 40 // same as old single-thread cap

function titleForChat(messages) {
  const firstUser = (messages || []).find(m => m.role === 'user' && typeof m.content === 'string')
  if (!firstUser) return 'New chat'
  const t = firstUser.content.trim().replace(/\s+/g, ' ')
  return t.length > 60 ? t.slice(0, 57) + '…' : t
}

function newChatId() {
  return `chat-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
}

// One-shot migration from the old single-thread + archive model. Runs lazily the first
// time we access chats after an upgrade.
function migrateLegacyChatsIfNeeded() {
  if (getData(CHATS_KEY) !== null && getData(CHATS_KEY) !== undefined) return
  const chats = []
  const legacyThread = getData('adviser_thread')
  const legacyArchive = getData('adviser_archive') || []
  const now = Date.now()
  if (legacyThread?.messages?.length) {
    chats.push({
      id: newChatId(),
      title: titleForChat(legacyThread.messages),
      messages: legacyThread.messages,
      sessionId: null, // server-side session long gone by now
      starred: true, // star the pre-upgrade thread so the user can't lose it to TTL
      createdAt: legacyThread.createdAt || legacyThread.updatedAt || now,
      updatedAt: legacyThread.updatedAt || now,
      expiresAt: null,
    })
  }
  for (const entry of legacyArchive) {
    if (!entry?.messages?.length) continue
    chats.push({
      id: entry.id || newChatId(),
      title: entry.title || titleForChat(entry.messages),
      messages: entry.messages,
      sessionId: null,
      starred: false,
      createdAt: entry.createdAt || entry.archivedAt || now,
      updatedAt: entry.archivedAt || entry.createdAt || now,
      expiresAt: now + CHAT_TTL_MS, // fresh 30d clock on migrated archives
    })
  }
  setData(CHATS_KEY, chats)
  // Active chat = the first one (the migrated current thread, if any)
  if (chats.length > 0) setData(ACTIVE_CHAT_KEY, chats[0].id)
  // Clear legacy keys so this migration only runs once.
  setData('adviser_thread', null)
  setData('adviser_archive', null)
}

function sweepExpiredChats() {
  const chats = getData(CHATS_KEY) || []
  const now = Date.now()
  const alive = chats.filter(c => c.starred || c.expiresAt == null || now < c.expiresAt)
  if (alive.length !== chats.length) {
    setData(CHATS_KEY, alive)
    const activeId = getData(ACTIVE_CHAT_KEY)
    if (activeId && !alive.find(c => c.id === activeId)) {
      setData(ACTIVE_CHAT_KEY, null)
    }
  }
  return alive
}

function loadChats() {
  migrateLegacyChatsIfNeeded()
  return sweepExpiredChats()
}

// --- Weekly cross-task pattern review ---
//
// Once a week (Sunday morning), look at tasks the user has been silently
// pushing past — snoozed/dismissed 3+ times in the last 14 days without
// resolving them. These are signals of avoidance, not laziness. Adaptive
// throttling reduces frequency on those notifications, but that's still
// "lower-frequency spam." A meaningful conversation is the right move.
//
// Creates a Quokka chat with a seeded prompt asking the user whether the
// tasks are worth keeping, reframing, or removing. Pushes a single ping
// (priority 0) saying "Weekly pattern review ready in Quokka." Skipped
// silently if no qualifying tasks.
async function runWeeklyPatternReview() {
  try {
    const now = new Date()
    // Sunday only, between 10:00 and 11:00 local time
    if (now.getDay() !== 0) return
    if (now.getHours() !== 10) return
    // Throttle: 6.5-day TTL ensures it only fires once per week
    const THROTTLE_KEY = 'weekly_pattern_review'
    const last = getNotifThrottle(THROTTLE_KEY)
    if (last && Date.now() - new Date(last).getTime() < 6.5 * 24 * 60 * 60 * 1000) return

    const settings = getData('settings') || {}
    const allTasks = queryTasks({})
    const ACTIVE = ['not_started', 'doing', 'waiting']
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000

    // Qualifying: active task, snooze_count >= 3, last_touched within 14d
    const qualifying = allTasks.filter(t =>
      ACTIVE.includes(t.status) &&
      !t.gmail_pending &&
      (t.snooze_count || 0) >= 3 &&
      new Date(t.last_touched).getTime() >= fourteenDaysAgo
    )

    if (qualifying.length < 2) return // need at least 2 patterns to be worth a chat

    // Top 5 by snooze_count, ties broken by oldest last_touched
    const top = [...qualifying]
      .sort((a, b) => (b.snooze_count - a.snooze_count) || (new Date(a.last_touched) - new Date(b.last_touched)))
      .slice(0, 5)

    const taskList = top.map(t => `- "${t.title}" (snoozed ${t.snooze_count}× in last 14 days)`).join('\n')
    const seededMessage = {
      role: 'user',
      content: `Quokka, I've been pushing these past me — snoozed 3+ times in the last 14 days without resolving:\n\n${taskList}\n\nCan we look at each one and figure out: are they worth keeping on my list, do they need reframing, or should they go?`,
    }

    const chats = loadChats()
    const newId = newChatId()
    const newChat = {
      id: newId,
      title: 'Weekly pattern review',
      messages: [seededMessage],
      sessionId: null,
      starred: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + CHAT_TTL_MS,
    }
    setData(CHATS_KEY, [newChat, ...chats])
    bumpVersion()
    setNotifThrottle(THROTTLE_KEY, new Date().toISOString())
    console.log(`[WeeklyPatternReview] Created chat ${newId} with ${top.length} avoidance pattern(s)`)

    // Surface the chat via Pushover priority 0 if configured
    try {
      const { userKey, appToken } = (() => {
        const uk = settings.pushover_user_key
        const at = settings.pushover_app_token || process.env.PUSHOVER_DEFAULT_APP_TOKEN
        return { userKey: uk || null, appToken: at || null }
      })()
      if (settings.pushover_notifications_enabled && userKey && appToken) {
        const { sendPushover } = await import('./pushoverNotifications.js')
        const base = (settings.public_app_url || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '')
        await sendPushover({
          userKey, appToken,
          title: '[BOOMERANG] Weekly pattern review',
          message: `${top.length} task${top.length > 1 ? 's' : ''} you've been pushing past — let's talk about them in Quokka when you have a minute.`,
          priority: 0,
          url: base || undefined,
          urlTitle: base ? 'Open Quokka' : undefined,
        })
      }
    } catch (err) {
      console.error('[WeeklyPatternReview] ping failed:', err.message)
    }
  } catch (err) {
    console.error('[WeeklyPatternReview] failed:', err.message)
  }
}

let weeklyPatternTimer = null
function startWeeklyPatternReview() {
  if (weeklyPatternTimer) return
  // Check every hour — the date+hour gate inside runWeeklyPatternReview
  // ensures it only actually fires once per week.
  weeklyPatternTimer = setInterval(runWeeklyPatternReview, 60 * 60 * 1000)
  // First check after 30s so a Sunday-morning restart still catches the window.
  setTimeout(runWeeklyPatternReview, 30 * 1000)
  console.log('Weekly pattern review: lifecycle started (Sunday 10am window)')
}

function chatSummary(c, activeId) {
  return {
    id: c.id,
    title: c.title,
    starred: !!c.starred,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    expiresAt: c.expiresAt ?? null,
    messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
    isActive: c.id === activeId,
  }
}

// Touch a chat: bump updatedAt and roll the 30-day TTL forward (unless starred).
function touchChat(chat) {
  chat.updatedAt = Date.now()
  if (!chat.starred) chat.expiresAt = Date.now() + CHAT_TTL_MS
}

app.get('/api/adviser/chats', (_req, res) => {
  const chats = loadChats()
  const activeId = getData(ACTIVE_CHAT_KEY)
  // Newest activity first.
  const sorted = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  res.json({
    chats: sorted.map(c => chatSummary(c, activeId)),
    activeId: activeId || null,
  })
})

app.get('/api/adviser/chats/active', (_req, res) => {
  const chats = loadChats()
  const activeId = getData(ACTIVE_CHAT_KEY)
  if (!activeId) return res.json({ chat: null })
  const chat = chats.find(c => c.id === activeId)
  if (!chat) return res.json({ chat: null })
  res.json({ chat })
})

app.get('/api/adviser/chats/:id', (req, res) => {
  const chats = loadChats()
  const chat = chats.find(c => c.id === req.params.id)
  if (!chat) return res.status(404).json({ error: 'Chat not found' })
  res.json({ chat })
})

app.post('/api/adviser/chats', (_req, res) => {
  const chats = loadChats()
  const now = Date.now()
  const chat = {
    id: newChatId(),
    title: 'New chat',
    messages: [],
    sessionId: null,
    starred: false,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + CHAT_TTL_MS,
  }
  chats.unshift(chat)
  setData(CHATS_KEY, chats)
  setData(ACTIVE_CHAT_KEY, chat.id)
  res.json({ chat })
})

app.patch('/api/adviser/chats/:id', (req, res) => {
  const chats = loadChats()
  const idx = chats.findIndex(c => c.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Chat not found' })
  const chat = chats[idx]
  const { messages, sessionId, title } = req.body || {}
  if (Array.isArray(messages)) chat.messages = messages.slice(-MAX_MESSAGES_PER_CHAT)
  if (sessionId !== undefined) chat.sessionId = sessionId || null
  if (typeof title === 'string' && title.trim()) {
    chat.title = title.trim().slice(0, 80)
  } else if (Array.isArray(messages) && (chat.title === 'New chat' || !chat.title)) {
    // Auto-title from first user message once we have one
    chat.title = titleForChat(messages)
  }
  touchChat(chat)
  chats[idx] = chat
  setData(CHATS_KEY, chats)
  res.json({ chat: chatSummary(chat, getData(ACTIVE_CHAT_KEY)) })
})

app.delete('/api/adviser/chats/:id', (req, res) => {
  const chats = loadChats()
  const next = chats.filter(c => c.id !== req.params.id)
  setData(CHATS_KEY, next)
  if (getData(ACTIVE_CHAT_KEY) === req.params.id) setData(ACTIVE_CHAT_KEY, null)
  res.json({ ok: true })
})

app.post('/api/adviser/chats/:id/activate', (req, res) => {
  const chats = loadChats()
  const chat = chats.find(c => c.id === req.params.id)
  if (!chat) return res.status(404).json({ error: 'Chat not found' })
  setData(ACTIVE_CHAT_KEY, chat.id)
  res.json({ ok: true, activeId: chat.id })
})

app.post('/api/adviser/chats/:id/star', (req, res) => {
  const chats = loadChats()
  const chat = chats.find(c => c.id === req.params.id)
  if (!chat) return res.status(404).json({ error: 'Chat not found' })
  chat.starred = true
  chat.expiresAt = null
  setData(CHATS_KEY, chats)
  res.json({ chat: chatSummary(chat, getData(ACTIVE_CHAT_KEY)) })
})

app.post('/api/adviser/chats/:id/unstar', (req, res) => {
  const chats = loadChats()
  const chat = chats.find(c => c.id === req.params.id)
  if (!chat) return res.status(404).json({ error: 'Chat not found' })
  chat.starred = false
  chat.expiresAt = Date.now() + UNSTAR_GRACE_MS
  setData(CHATS_KEY, chats)
  res.json({ chat: chatSummary(chat, getData(ACTIVE_CHAT_KEY)) })
})

// --- Dev seed endpoint ---
app.post('/api/dev/seed', async (req, res) => {
  try {
    await seedDatabase()
    res.json({ ok: true, message: 'Database seeded' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Static file serving (production) ---
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distPath = path.join(__dirname, 'dist')

if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('{*path}', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

// --- Start ---
const PORT = process.env.PORT || 3001
const dbPath = process.env.DB_PATH || './boomerang.db'

initDb(dbPath).then(async () => {
  console.log(`Database: ${dbPath}`)

  // Dev seed: SEED_DB=1 wipes the DB and loads test data (API-generated or static fallback)
  if (process.env.SEED_DB === '1') {
    await seedDatabase()
  }

  app.listen(PORT, () => {
    console.log(`Boomerang running on http://localhost:${PORT}`)
    console.log(`Anthropic API key: ${envApiKey ? 'from env' : 'user-provided via UI'}`)
    console.log(`Notion token: ${envNotionToken ? 'from env' : 'user-provided via UI'}`)
    console.log(`Trello: ${envTrelloKey && envTrelloToken ? 'from env' : 'user-provided via UI'}`)
    console.log(`Google Calendar: ${envGoogleClientId && envGoogleClientSecret ? 'from env' : 'user-provided via UI'}`)
    console.log(`Gmail: ${getData(GMAIL_TOKENS_KEY)?.refresh_token ? 'connected' : 'not connected'}`)
    console.log(`17track: ${envTrackingApiKey ? 'from env' : 'user-provided via UI'}`)
    console.log(`SMTP: ${envSmtpHost ? 'from env' : 'not configured'}`)

    // Initialize Notion MCP client (auto-reconnects if tokens exist from a previous session)
    notionMCP.initNotionMCP({ getData, setData })
    notionMCP.autoReconnect().then(ok => {
      console.log(`Notion MCP: ${ok ? 'connected' : 'not connected'}`)
    })

    // Start notification loops
    startEmailNotifications()
    startPushNotifications()
    startPushoverNotifications()
    startWeatherSync()
    startWeeklyPatternReview()

    // Initialize Gmail sync
    initGmailSync({
      clientId: envGoogleClientId,
      clientSecret: envGoogleClientSecret,
      anthropicKey: envApiKey,
      broadcast,
    })
    const gmailTokens = getData(GMAIL_TOKENS_KEY)
    if (gmailTokens?.refresh_token) {
      startGmailPolling(5 * 60 * 1000)
    }

    // Normalize any existing USPS 420-prefix tracking numbers + reset stuck USPS packages
    const allPkgs = getAllPackages()
    let normalized = 0
    let reset = 0
    for (const pkg of allPkgs) {
      const clean = normalize17trackNumber(pkg.tracking_number)
      if (clean !== pkg.tracking_number) {
        updatePackagePartial(pkg.id, { tracking_number: clean, last_polled: null })
        normalized++
      } else if (pkg.carrier === 'usps' && pkg.status === 'pending' && pkg.last_polled) {
        // Reset stuck USPS packages so they re-register without explicit carrier code
        updatePackagePartial(pkg.id, { last_polled: null })
        reset++
      }
    }
    if (normalized > 0) console.log(`[Packages] Normalized ${normalized} USPS tracking number(s)`)
    if (reset > 0) console.log(`[Packages] Reset ${reset} stuck USPS package(s) for re-registration`)

    // Start package polling loop (every 5 minutes)
    setInterval(pollActivePackages, 5 * 60 * 1000)
    // Run once after a short delay to catch up on any pending polls
    setTimeout(pollActivePackages, 10000)
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})

// --- Graceful shutdown: flush DB to disk ---
function shutdown(signal) {
  console.log(`\n[DB] ${signal} received, flushing database...`)
  flushNow()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
