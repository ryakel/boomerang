import express from 'express'
import cors from 'cors'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { initDb, getAllData, setAllData, setData, clearAllData } from './db.js'

// --- Environment (fallback keys — user can override via UI) ---
let envApiKey = process.env.ANTHROPIC_API_KEY
let envNotionToken = process.env.NOTION_INTEGRATION_TOKEN

if (existsSync('.env')) {
  const envFile = readFileSync('.env', 'utf-8')
  envApiKey = envApiKey || envFile.match(/(?:VITE_)?ANTHROPIC_API_KEY="?([^"\n]+)"?/)?.[1]
  envNotionToken = envNotionToken || envFile.match(/NOTION_INTEGRATION_TOKEN="?([^"\n]+)"?/)?.[1]
}

// Helper: resolve API key from request header or env var
function getAnthropicKey(req) {
  return req.headers['x-anthropic-key'] || envApiKey || null
}

function getNotionToken(req) {
  return req.headers['x-notion-token'] || envNotionToken || null
}

// --- Express ---
const app = express()
app.use(cors())
app.use(express.json())

// --- Key status route (tells frontend what's configured via env) ---
app.get('/api/keys/status', (req, res) => {
  res.json({
    anthropic: !!envApiKey,
    notion: !!envNotionToken,
  })
})

// --- Data routes ---
app.get('/api/data', (req, res) => {
  res.json(getAllData())
})

app.put('/api/data', (req, res) => {
  setAllData(req.body)
  res.json({ ok: true })
})

app.patch('/api/data/:collection', (req, res) => {
  setData(req.params.collection, req.body)
  res.json({ ok: true })
})

app.delete('/api/data', (req, res) => {
  clearAllData()
  res.json({ ok: true })
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
    const children = (content || '').split('\n').filter(Boolean).map(line => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: line.replace(/^- /, '') } }] },
    }))

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

function extractTitle(page) {
  const props = page.properties || {}
  for (const val of Object.values(props)) {
    if (val.type === 'title' && val.title?.length > 0) {
      return val.title.map(t => t.plain_text).join('')
    }
  }
  return 'Untitled'
}

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
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
