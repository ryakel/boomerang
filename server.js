import express from 'express'
import cors from 'cors'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { initDb, getAllData, setAllData, setData, clearAllData, getVersion, bumpVersion, flushNow,
  upsertTask, getTask, deleteTask, queryTasks, updateTaskPartial,
  upsertRoutine, getRoutine, getAllRoutines, deleteRoutine, updateRoutinePartial,
  getAnalytics, getData } from './db.js'

// --- App version ---
const appVersion = process.env.APP_VERSION || 'dev'

// --- Environment (fallback keys — user can override via UI) ---
let envApiKey = process.env.ANTHROPIC_API_KEY
let envNotionToken = process.env.NOTION_INTEGRATION_TOKEN
let envTrelloKey = process.env.TRELLO_API_KEY
let envTrelloToken = process.env.TRELLO_SECRET

if (existsSync('.env')) {
  const envFile = readFileSync('.env', 'utf-8')
  envApiKey = envApiKey || envFile.match(/(?:VITE_)?ANTHROPIC_API_KEY="?([^"\n]+)"?/)?.[1]
  envNotionToken = envNotionToken || envFile.match(/NOTION_INTEGRATION_TOKEN="?([^"\n]+)"?/)?.[1]
  envTrelloKey = envTrelloKey || envFile.match(/TRELLO_API_KEY="?([^"\n]+)"?/)?.[1]
  envTrelloToken = envTrelloToken || envFile.match(/TRELLO_SECRET="?([^"\n]+)"?/)?.[1]
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

// --- Express ---
const app = express()
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
  try {
    const children = (req.body.content || '').split('\n').filter(Boolean).map(line => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: line.replace(/^- /, '') } }] },
    }))
    const response = await fetch(`${NOTION_BASE}/blocks/${req.params.id}/children`, {
      method: 'PATCH',
      headers: makeNotionHeaders(token),
      body: JSON.stringify({ children }),
    })
    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
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
  try {
    const response = await fetch(`${TRELLO_BASE}/cards/${req.params.id}?key=${key}&token=${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    })
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json(data)
  } catch (err) {
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

initDb(dbPath).then(() => {
  console.log(`Database: ${dbPath}`)
  app.listen(PORT, () => {
    console.log(`Boomerang running on http://localhost:${PORT}`)
    console.log(`Anthropic API key: ${envApiKey ? 'from env' : 'user-provided via UI'}`)
    console.log(`Notion token: ${envNotionToken ? 'from env' : 'user-provided via UI'}`)
    console.log(`Trello: ${envTrelloKey && envTrelloToken ? 'from env' : 'user-provided via UI'}`)
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
