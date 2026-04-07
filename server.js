import express from 'express'
import cors from 'cors'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { initDb, getAllData, setAllData, setData, clearAllData, getVersion, bumpVersion, flushNow,
  upsertTask, getTask, deleteTask, queryTasks, updateTaskPartial,
  upsertRoutine, getRoutine, getAllRoutines, deleteRoutine, updateRoutinePartial,
  getAnalytics, getData,
  upsertPackage, getPackage, getAllPackages, deletePackage, updatePackagePartial } from './db.js'
import { seedDatabase } from './seed.js'

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

if (existsSync('.env')) {
  const envFile = readFileSync('.env', 'utf-8')
  envApiKey = envApiKey || envFile.match(/(?:VITE_)?ANTHROPIC_API_KEY="?([^"\n]+)"?/)?.[1]
  envNotionToken = envNotionToken || envFile.match(/NOTION_INTEGRATION_TOKEN="?([^"\n]+)"?/)?.[1]
  envTrelloKey = envTrelloKey || envFile.match(/TRELLO_API_KEY="?([^"\n]+)"?/)?.[1]
  envTrelloToken = envTrelloToken || envFile.match(/TRELLO_SECRET="?([^"\n]+)"?/)?.[1]
  envGoogleClientId = envGoogleClientId || envFile.match(/GOOGLE_CLIENT_ID="?([^"\n]+)"?/)?.[1]
  envGoogleClientSecret = envGoogleClientSecret || envFile.match(/GOOGLE_CLIENT_SECRET="?([^"\n]+)"?/)?.[1]
  envTrackingApiKey = envTrackingApiKey || envFile.match(/TRACKING_API_KEY="?([^"\n]+)"?/)?.[1]
}

// Helper: resolve API key from request header or env var
function getAnthropicKey(req) {
  return req.headers['x-anthropic-key'] || envApiKey || null
}

function getNotionToken(req) {
  return req.headers['x-notion-token'] || envNotionToken || null
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

// --- Express ---
const app = express()
app.set('trust proxy', 1)
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', appVersion })
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
  return false
}

app.put('/api/data', (req, res) => {
  if (guardStaleClient(req, res)) return
  const clientId = req.body._clientId
  const body = { ...req.body }
  delete body._clientId
  delete body._version
  const newVersion = setAllData(body)
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
  const newVersion = setAllData(body)
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
  const token = getNotionToken(req)
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
  const token = getNotionToken(req)
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
  const token = getNotionToken(req)
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
  const token = getNotionToken(req)
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
  const token = getNotionToken(req)
  if (!token) return res.json({ connected: false })
  try {
    const response = await fetch(`${NOTION_BASE}/users/me`, { headers: makeNotionHeaders(token) })
    const data = await response.json()
    res.json({ connected: response.ok, bot: data.name || data.bot?.owner?.user?.name })
  } catch {
    res.json({ connected: false })
  }
})

// Get all blocks (content) from a Notion page — paginated, returns structured + plaintext
app.get('/api/notion/blocks/:id', async (req, res) => {
  const token = getNotionToken(req)
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
  const token = getNotionToken(req)
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

// Query a Notion database (future-proofing for database-based sync)
app.post('/api/notion/databases/:id/query', async (req, res) => {
  const token = getNotionToken(req)
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

// Notion file upload (requires newer API version)
app.post('/api/notion/file-uploads', async (req, res) => {
  const token = getNotionToken(req)
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
  const token = getNotionToken(req)
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
  const token = getNotionToken(req)
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
    }))
    res.json(events)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
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
// 17track v2.2 statuses: NotFound, InfoReceived, InTransit, Expired,
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

// Register tracking numbers with 17track (required before gettrackinfo)
async function register17track(trackingNumbers, apiKey) {
  if (!apiKey || trackingNumbers.length === 0) return

  try {
    const res = await fetch('https://api.17track.net/track/v2.2/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        '17token': apiKey,
      },
      body: JSON.stringify(
        trackingNumbers.map(tn => ({ number: tn }))
      ),
    })
    const data = await res.json()
    console.log('[Packages] 17track register:', res.status, 'accepted:', data.data?.accepted?.length || 0, 'rejected:', data.data?.rejected?.length || 0)
    if (data.data?.rejected?.length > 0) {
      for (const r of data.data.rejected) {
        console.log('[Packages] 17track register rejected:', r.number, 'error:', r.error?.code, r.error?.message)
      }
    }
  } catch (err) {
    console.error('[Packages] 17track register error:', err.message)
  }
}

// Poll 17track API for a batch of tracking numbers
async function poll17track(trackingNumbers, apiKey) {
  if (!apiKey || trackingNumbers.length === 0) return []

  try {
    const res = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        '17token': apiKey,
      },
      body: JSON.stringify(
        trackingNumbers.map(tn => ({ number: tn }))
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
    console.log('[Packages] 17track response status:', res.status, 'code:', data.code, 'data keys:', Object.keys(data.data || {}))
    if (!res.ok) {
      console.error('[Packages] 17track API error:', JSON.stringify(data).slice(0, 500))
      return []
    }

    trackingQuota.daily_used += trackingNumbers.length

    // 17track v2.2 returns { data: { accepted: [...], rejected: [...] } }
    // Each accepted item has: { number, track_info: { ... } }
    const accepted = data.data?.accepted || data.data || []
    if (Array.isArray(accepted)) {
      console.log('[Packages] 17track accepted:', accepted.length, 'items')
      if (accepted.length > 0) {
        console.log('[Packages] 17track first result keys:', JSON.stringify(Object.keys(accepted[0])).slice(0, 200))
        const ti = accepted[0].track_info || accepted[0].track || accepted[0]
        console.log('[Packages] 17track track_info keys:', JSON.stringify(Object.keys(ti)).slice(0, 200))
      }
    }
    return Array.isArray(accepted) ? accepted : []
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

  // Batch into groups of 40
  const batches = []
  for (let i = 0; i < eligible.length; i += 40) {
    batches.push(eligible.slice(i, i + 40))
  }

  let anyUpdated = false
  const settings = getData('settings') || {}

  for (let bi = 0; bi < batches.length; bi++) {
    if (bi > 0) await new Promise(r => setTimeout(r, 1000))
    const batch = batches[bi]
    const trackingNumbers = batch.map(p => p.tracking_number)

    // Register any never-polled packages first
    const unpolled = batch.filter(p => !p.last_polled).map(p => p.tracking_number)
    if (unpolled.length > 0) {
      await register17track(unpolled, apiKey)
      await new Promise(r => setTimeout(r, 1000)) // brief delay after register
    }

    const results = await poll17track(trackingNumbers, apiKey)

    if (trackingQuota.exhausted) break

    for (const result of results) {
      const pkg = batch.find(p => p.tracking_number === result.number)
      if (!pkg) continue

      const trackInfo = result.track_info || result.track || {}
      const events = (trackInfo.tracking?.providers?.[0]?.events || trackInfo.tracking_detail || []).map(e => ({
        timestamp: e.time_iso || e.Date || e.time || '',
        location: e.location || e.Details?.split(',').pop()?.trim() || '',
        description: e.description || e.Details || e.event || '',
        status: e.status || '',
      }))

      const { status: newStatus, detail } = map17trackStatus(trackInfo)
      const prevStatus = pkg.status
      const sigRequired = checkSignatureRequired(events)

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

      // Extract ETA if available
      if (trackInfo.time_metrics?.estimated_delivery_date) {
        updates.eta = trackInfo.time_metrics.estimated_delivery_date.from || updates.eta
      }

      // Handle delivery
      if (newStatus === 'delivered' && prevStatus !== 'delivered') {
        updates.delivered_at = now.toISOString()
        const retentionDays = settings.package_retention_days ?? 3
        const cleanupDate = new Date(now.getTime() + retentionDays * 86400000)
        updates.auto_cleanup_at = cleanupDate.toISOString()
        console.log(`[Packages] ${pkg.label || pkg.tracking_number} delivered`)

        // Auto-complete signature task if exists
        if (pkg.signature_task_id) {
          const task = getTask(pkg.signature_task_id)
          if (task && task.status !== 'done') {
            updateTaskPartial(pkg.signature_task_id, {
              status: 'done',
              completed_at: now.toISOString(),
            })
          }
        }
      }

      // Handle signature required — create task if not already created
      if (sigRequired && !pkg.signature_required && !pkg.signature_task_id) {
        if (settings.package_auto_task_signature !== false) {
          const taskId = `pkg-sig-${pkg.id}-${Date.now()}`
          const sigTask = {
            id: taskId,
            title: `Be home to sign for: ${pkg.label || pkg.tracking_number}`,
            status: 'not_started',
            notes: `Package: ${pkg.tracking_number}\nCarrier: ${pkg.carrier_name || pkg.carrier || 'Unknown'}\nTracking requires signature.`,
            high_priority: true,
            energy: 'errand',
            energy_level: 2,
            due_date: pkg.eta || new Date().toISOString().split('T')[0],
            created_at: now.toISOString(),
            last_touched: now.toISOString(),
            tags: [],
            attachments: [],
            checklist: [],
            checklists: [],
            comments: [],
          }
          upsertTask(sigTask)
          updates.signature_task_id = taskId
          console.log(`[Packages] Created signature task for ${pkg.label || pkg.tracking_number}`)
        }
      }

      updatePackagePartial(pkg.id, updates)
      anyUpdated = true
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

app.post('/api/packages', (req, res) => {
  const { tracking_number, label, carrier } = req.body
  if (!tracking_number) return res.status(400).json({ error: 'tracking_number required' })

  // Duplicate check
  const existing = getAllPackages().find(p => p.tracking_number.toLowerCase() === tracking_number.trim().toLowerCase())
  if (existing) return res.status(409).json({ error: 'Tracking number already exists', existing_id: existing.id, label: existing.label })

  const detected = carrier ? { code: carrier, name: carrier } : detectCarrierServer(tracking_number)
  const now = new Date().toISOString()
  const id = `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const pkg = {
    id,
    tracking_number: tracking_number.trim(),
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

  // Register with 17track so tracking data becomes available
  const apiKey = getTrackingApiKey(req)
  if (apiKey) {
    register17track([pkg.tracking_number], apiKey).catch(() => {})
  }

  const newVersion = bumpVersion()
  const clientId = req.body._clientId || req.headers['x-client-id']
  broadcast(newVersion, clientId)
  res.json(pkg)
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

  // Throttle: 5 minutes per package
  if (pkg.last_polled) {
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

  // Register first (idempotent — 17track ignores if already registered)
  await register17track([pkg.tracking_number], apiKey)

  const results = await poll17track([pkg.tracking_number], apiKey)
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

    if (trackInfo.time_metrics?.estimated_delivery_date) {
      updates.eta = trackInfo.time_metrics.estimated_delivery_date.from
    }

    const updated = updatePackagePartial(pkg.id, updates)
    const newVersion = bumpVersion()
    broadcast(newVersion, req.headers['x-client-id'])
    return res.json(updated)
  }

  updatePackagePartial(pkg.id, { last_polled: new Date().toISOString() })
  res.json(getPackage(pkg.id))
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
    const testRes = await fetch('https://api.17track.net/track/v2.2/getquota', {
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
  const result = detectCarrierServer(tracking_number)
  res.json(result || { code: 'other', name: 'Unknown' })
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
    console.log(`17track: ${envTrackingApiKey ? 'from env' : 'user-provided via UI'}`)

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
