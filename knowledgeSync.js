// Knowledge-base sync: Notion database <-> local index cache.
//
// The user's knowledge items live as pages in a Notion database with a
// fixed property schema (Title / Type / Tags / Related tasks / Confidence).
// Boomerang owns DB *creation* but not *editing* — once created, the user
// can rename it, drag items around, edit page bodies in Notion, etc. We
// just keep a server-side metadata index in sync via a background loop.
//
// The MCP-issued OAuth token from notion_mcp_tokens doubles as a REST
// Authorization: Bearer token, so we hit Notion's REST API directly here.
// (See CLAUDE.md "Auth model" — same token, two surfaces.)

import { replaceKnowledgeIndex, upsertKnowledgeItem, getKnowledgeItem, deleteKnowledgeItem } from './db.js'

const NOTION_BASE = 'https://api.notion.com/v1'
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

const KNOWLEDGE_DB_KEY = 'notion_knowledge_db_id'
const KNOWLEDGE_DB_URL_KEY = 'notion_knowledge_db_url'
const KNOWLEDGE_LAST_SYNC_KEY = 'notion_knowledge_last_sync'

const TYPE_OPTIONS = [
  { name: 'Location', color: 'blue' },
  { name: 'How-to', color: 'green' },
  { name: 'Decision', color: 'purple' },
  { name: 'Person', color: 'pink' },
]

const CONFIDENCE_OPTIONS = [
  { name: 'Certain', color: 'green' },
  { name: 'Fuzzy', color: 'yellow' },
]

function notionHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  }
}

async function notionJson(url, init, label) {
  const res = await fetch(url, init)
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`${label} ${res.status}: ${data.message || data.error || text.slice(0, 200)}`)
  return data
}

// Convert markdown-ish text to Notion blocks. Mirrors parseContentToBlocks
// in server.js but kept self-contained so this module has no import cycle.
function bodyToBlocks(text) {
  if (!text) return []
  return text.split('\n').map(line => {
    if (!line.trim()) return { object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }
    if (line.startsWith('# ')) return { object: 'block', type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] } }
    if (line.startsWith('## ')) return { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] } }
    if (line.match(/^- \[[ x]\] /)) {
      const checked = line[3] === 'x'
      return { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: line.slice(6) } }], checked } }
    }
    if (line.startsWith('- ')) return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] } }
    return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: line } }] } }
  })
}

function blocksToPlainText(blocks) {
  const lines = []
  for (const b of blocks || []) {
    const rt = b[b.type]?.rich_text || []
    const text = rt.map(t => t.plain_text || '').join('')
    if (text) lines.push(text)
  }
  return lines.join('\n')
}

function extractTitle(page) {
  const props = page?.properties || {}
  for (const v of Object.values(props)) {
    if (v.type === 'title' && v.title?.length) return v.title.map(t => t.plain_text).join('')
  }
  return 'Untitled'
}

// Flatten a Notion page's properties into the shape we cache locally.
function pageToIndexItem(page) {
  const props = page.properties || {}
  const get = (name, type) => {
    for (const [k, v] of Object.entries(props)) {
      if (k.toLowerCase() === name.toLowerCase() && v.type === type) return v
    }
    return null
  }
  const titleProp = Object.values(props).find(p => p.type === 'title')
  const title = titleProp?.title?.map(t => t.plain_text).join('') || 'Untitled'
  const typeProp = get('Type', 'select')
  const tagsProp = get('Tags', 'multi_select')
  const relatedProp = get('Related tasks', 'rich_text') || get('Related Tasks', 'rich_text')
  const confidenceProp = get('Confidence', 'select')
  const relatedText = relatedProp?.rich_text?.map(t => t.plain_text).join('') || ''
  const relatedIds = relatedText.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
  return {
    notion_page_id: page.id,
    title,
    type: typeProp?.select?.name || null,
    tags: (tagsProp?.multi_select || []).map(t => t.name),
    summary: '', // populated by fetchSummary if needed
    confidence: confidenceProp?.select?.name || null,
    related_task_ids: relatedIds,
    notion_url: page.url || null,
    last_edited_time: page.last_edited_time || null,
    last_synced_at: new Date().toISOString(),
    archived: !!page.archived,
  }
}

// Auto-create the knowledge database under a parent page. Stores db_id +
// url in app_data via the injected setData callback. Idempotent: if a
// db_id is already stored AND still resolves to a live database, returns
// it unchanged.
export async function ensureKnowledgeDatabase({ token, parentPageId, getData, setData }) {
  const existing = getData(KNOWLEDGE_DB_KEY)
  if (existing) {
    try {
      const db = await notionJson(`${NOTION_BASE}/databases/${existing}`, {
        headers: notionHeaders(token),
      }, 'Notion DB lookup')
      if (db && !db.archived) {
        return { database_id: existing, url: db.url || getData(KNOWLEDGE_DB_URL_KEY), created: false }
      }
    } catch {
      // DB id is stale — fall through and re-create.
    }
  }
  if (!parentPageId) throw new Error('parent_page_id required to create the knowledge database')

  const body = {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Boomerang Knowledge' } }],
    properties: {
      'Name': { title: {} },
      'Type': { select: { options: TYPE_OPTIONS } },
      'Tags': { multi_select: { options: [] } },
      'Related tasks': { rich_text: {} },
      'Confidence': { select: { options: CONFIDENCE_OPTIONS } },
    },
  }
  const data = await notionJson(`${NOTION_BASE}/databases`, {
    method: 'POST', headers: notionHeaders(token), body: JSON.stringify(body),
  }, 'Notion DB create')
  setData(KNOWLEDGE_DB_KEY, data.id)
  setData(KNOWLEDGE_DB_URL_KEY, data.url || null)
  console.log(`[Knowledge] Created Notion database ${data.id}`)
  return { database_id: data.id, url: data.url, created: true }
}

// Query the DB and replace the local cache. Returns count + any error.
export async function refreshKnowledgeIndex({ token, getData, setData }) {
  const dbId = getData(KNOWLEDGE_DB_KEY)
  if (!dbId) return { ok: false, error: 'Knowledge database not configured', count: 0 }
  if (!token) return { ok: false, error: 'Notion not connected', count: 0 }
  const items = []
  let cursor = undefined
  do {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const data = await notionJson(`${NOTION_BASE}/databases/${dbId}/query`, {
      method: 'POST', headers: notionHeaders(token), body: JSON.stringify(body),
    }, 'Notion DB query')
    for (const page of data.results || []) {
      if (page.archived) continue
      items.push(pageToIndexItem(page))
    }
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)

  replaceKnowledgeIndex(items)
  setData(KNOWLEDGE_LAST_SYNC_KEY, new Date().toISOString())
  console.log(`[Knowledge] Refreshed index — ${items.length} items`)
  return { ok: true, count: items.length }
}

// Fetch full page body as plain markdown-ish text.
export async function fetchKnowledgeBody({ token, pageId }) {
  if (!token) throw new Error('Notion not connected')
  const blocks = []
  let cursor = undefined
  do {
    const url = `${NOTION_BASE}/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
    const data = await notionJson(url, { headers: notionHeaders(token) }, 'Notion blocks')
    blocks.push(...(data.results || []))
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return blocksToPlainText(blocks)
}

// Create a new knowledge item. Returns { id, url } and updates the local cache.
export async function createKnowledgeItem({ token, getData, title, type, tags = [], body = '', confidence, relatedTaskIds = [] }) {
  const dbId = getData(KNOWLEDGE_DB_KEY)
  if (!dbId) throw new Error('Knowledge database not configured')
  if (!token) throw new Error('Notion not connected')
  if (!title?.trim()) throw new Error('title required')

  const properties = {
    Name: { title: [{ type: 'text', text: { content: title } }] },
  }
  if (type) properties.Type = { select: { name: type } }
  if (tags?.length) properties.Tags = { multi_select: tags.map(name => ({ name })) }
  if (confidence) properties.Confidence = { select: { name: confidence } }
  if (relatedTaskIds?.length) {
    properties['Related tasks'] = { rich_text: [{ type: 'text', text: { content: relatedTaskIds.join(', ') } }] }
  }

  const payload = {
    parent: { database_id: dbId },
    properties,
    children: bodyToBlocks(body),
  }
  const data = await notionJson(`${NOTION_BASE}/pages`, {
    method: 'POST', headers: notionHeaders(token), body: JSON.stringify(payload),
  }, 'Notion knowledge create')

  const item = pageToIndexItem(data)
  item.summary = (body || '').slice(0, 200)
  upsertKnowledgeItem(item)
  return { id: data.id, url: data.url, item }
}

// Update an existing knowledge item. Any of title/type/tags/body/confidence/relatedTaskIds may be provided.
// Returns { before, after } where before is the pre-update snapshot so callers can compensate.
export async function updateKnowledgeItem({ token, pageId, title, type, tags, body, confidence, relatedTaskIds }) {
  if (!token) throw new Error('Notion not connected')
  const before = getKnowledgeItem(pageId)
  const beforePage = await notionJson(`${NOTION_BASE}/pages/${pageId}`, {
    headers: notionHeaders(token),
  }, 'Notion knowledge fetch')

  const properties = {}
  if (title !== undefined) properties.Name = { title: [{ type: 'text', text: { content: title } }] }
  if (type !== undefined) properties.Type = type ? { select: { name: type } } : { select: null }
  if (tags !== undefined) properties.Tags = { multi_select: (tags || []).map(name => ({ name })) }
  if (confidence !== undefined) properties.Confidence = confidence ? { select: { name: confidence } } : { select: null }
  if (relatedTaskIds !== undefined) {
    properties['Related tasks'] = relatedTaskIds?.length
      ? { rich_text: [{ type: 'text', text: { content: relatedTaskIds.join(', ') } }] }
      : { rich_text: [] }
  }
  if (Object.keys(properties).length > 0) {
    await notionJson(`${NOTION_BASE}/pages/${pageId}`, {
      method: 'PATCH', headers: notionHeaders(token), body: JSON.stringify({ properties }),
    }, 'Notion knowledge update properties')
  }
  if (body !== undefined) {
    const existing = await notionJson(`${NOTION_BASE}/blocks/${pageId}/children?page_size=100`, {
      headers: notionHeaders(token),
    }, 'Notion knowledge fetch blocks')
    for (const b of existing.results || []) {
      await fetch(`${NOTION_BASE}/blocks/${b.id}`, { method: 'DELETE', headers: notionHeaders(token) }).catch(() => {})
    }
    const newBlocks = bodyToBlocks(body)
    if (newBlocks.length) {
      await notionJson(`${NOTION_BASE}/blocks/${pageId}/children`, {
        method: 'PATCH', headers: notionHeaders(token), body: JSON.stringify({ children: newBlocks }),
      }, 'Notion knowledge update body')
    }
  }
  const after = await notionJson(`${NOTION_BASE}/pages/${pageId}`, {
    headers: notionHeaders(token),
  }, 'Notion knowledge re-fetch')
  const item = pageToIndexItem(after)
  if (body !== undefined) item.summary = (body || '').slice(0, 200)
  else if (before?.summary) item.summary = before.summary
  upsertKnowledgeItem(item)
  return { before, beforePage, after: item }
}

// Archive (soft-delete) a knowledge item.
export async function archiveKnowledgeItem({ token, pageId }) {
  if (!token) throw new Error('Notion not connected')
  const before = getKnowledgeItem(pageId)
  await notionJson(`${NOTION_BASE}/pages/${pageId}`, {
    method: 'PATCH', headers: notionHeaders(token), body: JSON.stringify({ archived: true }),
  }, 'Notion knowledge archive')
  deleteKnowledgeItem(pageId)
  return { before }
}

// Restore (un-archive) a previously archived item. Used by the rollback path.
export async function restoreKnowledgeItem({ token, pageId }) {
  if (!token) return
  await fetch(`${NOTION_BASE}/pages/${pageId}`, {
    method: 'PATCH', headers: notionHeaders(token), body: JSON.stringify({ archived: false }),
  }).catch(() => {})
}

// Background refresh loop. Started from server.js after init. Bails silently
// when knowledge DB isn't configured or Notion isn't connected.
let refreshTimer = null
export function startKnowledgeRefreshLoop({ resolveToken, getData, setData }) {
  if (refreshTimer) return
  const tick = async () => {
    try {
      const token = await resolveToken()
      const dbId = getData(KNOWLEDGE_DB_KEY)
      if (!token || !dbId) return
      await refreshKnowledgeIndex({ token, getData, setData })
    } catch (err) {
      console.warn('[Knowledge] refresh failed:', err.message)
    }
  }
  refreshTimer = setInterval(tick, REFRESH_INTERVAL_MS)
  refreshTimer.unref?.()
  // First tick after a short delay so server startup isn't slowed by the network.
  setTimeout(tick, 10_000)
}

export function getKnowledgeStatus({ getData }) {
  return {
    configured: !!getData(KNOWLEDGE_DB_KEY),
    database_id: getData(KNOWLEDGE_DB_KEY) || null,
    database_url: getData(KNOWLEDGE_DB_URL_KEY) || null,
    last_sync: getData(KNOWLEDGE_LAST_SYNC_KEY) || null,
  }
}
