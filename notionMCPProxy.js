// Notion MCP Proxy — hybrid MCP + REST approach.
//
// MCP for: search, create database (SQL DDL), create page, update page props, archive.
// REST for: database query (pagination + filters), block reads (structured JSON),
//           content updates (delete + append blocks), file uploads.
//
// Tool input schemas come from the Notion OpenAPI spec at:
//   @notionhq/notion-mcp-server/scripts/notion-openapi.json
// See CLAUDE.md "Notion MCP Rules" — never guess params.

import * as notionMCP from './notionMCP.js'

const NOTION_BASE = 'https://api.notion.com/v1'

function ensureConnected() {
  if (!notionMCP.getStatus().connected) {
    throw new Error('Notion MCP not connected. Connect in Settings → Integrations → Notion.')
  }
}

function getRestToken() {
  return process.env.NOTION_INTEGRATION_TOKEN || null
}

function restHeaders() {
  const token = getRestToken()
  if (!token) return null
  return {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2025-09-03',
    'Content-Type': 'application/json',
  }
}

async function restJson(url, init, label) {
  const headers = restHeaders()
  if (!headers) throw new Error('NOTION_INTEGRATION_TOKEN required for REST operations')
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers || {}) } })
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`${label} ${res.status}: ${data.message || data.code || text.slice(0, 200)}`)
  return data
}

async function callMCP(toolName, args) {
  ensureConnected()
  console.log(`[Notion:MCP] ${toolName}`, JSON.stringify(args).slice(0, 200))
  const result = await notionMCP.callTool(toolName, args)
  if (result?.isError) {
    const errText = (result.content || []).map(c => c.text || '').join(' ')
    console.error(`[Notion:MCP] ${toolName} ERROR:`, errText.slice(0, 300))
    throw new Error(`Notion MCP tool ${toolName} error: ${errText}`)
  }
  console.log(`[Notion:MCP] ${toolName} OK`)
  return result?.content?.[0]?.text || ''
}

function tryParseJSON(text) {
  try { return JSON.parse(text) } catch { return null }
}

function extractIdFromUrl(text) {
  const m = text.match(/notion\.so\/(?:[^/]*\/)?([a-f0-9]{32})/)
  if (!m) return null
  const h = m[1]
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

function extractUrlFromText(text) {
  const m = text.match(/https:\/\/www\.notion\.so\/[^\s"<>)]+/)
  return m ? m[0] : null
}

function extractTitleFromProperties(properties) {
  if (!properties) return null
  for (const [key, val] of Object.entries(properties)) {
    // Standard Notion API format
    if (val?.type === 'title' && val.title?.length) {
      return val.title.map(t => t.plain_text || t.text?.content || '').join('')
    }
    // 2025 API may nest differently
    if (val?.title?.length && Array.isArray(val.title)) {
      return val.title.map(t => t.plain_text || t.text?.content || '').join('')
    }
    // Simple string value for title-type properties
    if (key.toLowerCase() === 'title' && typeof val === 'string') return val
    if (key === 'Name' && typeof val === 'string') return val
  }
  return null
}

function extractTitleFromPage(page) {
  if (!page) return 'Untitled'
  // Try properties first
  const fromProps = extractTitleFromProperties(page.properties)
  if (fromProps) return fromProps
  // Direct title field (some API responses)
  if (page.title) {
    if (typeof page.title === 'string') return page.title
    if (Array.isArray(page.title)) return page.title.map(t => t.plain_text || t.text?.content || '').join('')
  }
  // child_page block format
  if (page.child_page?.title) return page.child_page.title
  return 'Untitled'
}

function extractPagesFromText(raw) {
  const pages = []
  const urlRegex = /notion\.so\/(?:[^/]*\/)?([a-f0-9]{32})/g
  let m
  while ((m = urlRegex.exec(raw)) !== null) {
    const h = m[1]
    const ctx = raw.slice(Math.max(0, m.index - 200), m.index + 100)
    const titleMatch = ctx.match(/title="([^"]*)"/)
    pages.push({
      id: `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`,
      title: titleMatch?.[1]?.trim() || 'Untitled',
      url: `https://www.notion.so/${h}`,
    })
  }
  return pages
}

// ============================================================
// MCP operations — search, create, update props, archive
// ============================================================

export async function search(query) {
  const raw = await callMCP('notion-search', { query })
  const json = tryParseJSON(raw)
  if (json?.results) {
    if (json.results[0]) console.log('[Notion:MCP] search result sample keys:', Object.keys(json.results[0]).join(', '))
    return json.results.map(p => ({
      id: p.id,
      title: extractTitleFromPage(p),
      url: p.url,
      last_edited: p.last_edited_time,
    }))
  }
  return extractPagesFromText(raw)
}

export async function createPage({ parentId, title, content }) {
  const args = {
    parent: { page_id: parentId, type: 'page_id' },
    pages: [{ properties: { title }, ...(content ? { content } : {}) }],
  }
  const raw = await callMCP('notion-create-pages', args)
  const json = tryParseJSON(raw)
  if (json?.id) return { id: json.id, url: json.url }
  const id = extractIdFromUrl(raw)
  if (!id) throw new Error('Could not parse page ID from response: ' + raw.slice(0, 300))
  return { id, url: extractUrlFromText(raw) }
}

export async function createPageInDatabase({ databaseId, properties, content }) {
  // Properties must be plain SQLite values (string | number | null).
  // Convert Notion API objects back to plain values if needed.
  let propsObj = properties
  if (typeof properties === 'string') propsObj = textToPlainProperties(properties)
  else if (typeof properties === 'object') propsObj = flattenToPlainValues(properties)
  const page = { properties: propsObj }
  if (content) page.content = content
  const args = {
    parent: { database_id: databaseId, type: 'database_id' },
    pages: [page],
  }
  const raw = await callMCP('notion-create-pages', args)
  const json = tryParseJSON(raw)
  if (json?.id) return { id: json.id, url: json.url }
  const id = extractIdFromUrl(raw)
  if (!id) throw new Error('Could not parse page ID from response: ' + raw.slice(0, 300))
  return { id, url: extractUrlFromText(raw) }
}

export async function updatePage({ pageId, properties, archived }) {
  const args = { page_id: pageId }
  if (properties) {
    if (typeof properties === 'string') args.properties = textToNotionProperties(properties)
    else if (properties.Name?.title || properties.title?.title) args.properties = properties
    else args.properties = simpleMapToNotionProperties(properties)
  }
  if (archived !== undefined) args.archived = archived
  const raw = await callMCP('notion-update-page', args)
  return { id: pageId, url: extractUrlFromText(raw), raw }
}

export async function archivePage(pageId) { return updatePage({ pageId, archived: true }) }
export async function restorePage(pageId) { return updatePage({ pageId, archived: false }) }

export async function createDatabase({ parentPageId, title, schema }) {
  const raw = await callMCP('notion-create-database', { parent: { page_id: parentPageId }, title, schema })
  const json = tryParseJSON(raw)
  if (json?.id) return { id: json.id, url: json.url }
  const id = extractIdFromUrl(raw)
  if (!id) throw new Error('Could not parse database ID from response: ' + raw.slice(0, 300))
  return { id, url: extractUrlFromText(raw) }
}

export function isConnected() { return notionMCP.getStatus().connected }

// ============================================================
// REST operations — queries, block reads, content updates
// REST requires NOTION_INTEGRATION_TOKEN env var.
// Falls back to MCP when no REST token is available.
// ============================================================

export async function getPage(pageId) {
  const headers = restHeaders()
  if (headers) {
    try {
      console.log(`[Notion:REST] GET pages/${pageId}`)
      const data = await restJson(`${NOTION_BASE}/pages/${pageId}`, {}, 'get page')
      return { id: data.id, title: extractTitleFromPage(data), url: data.url, properties: data.properties }
    } catch (err) { console.warn('[Notion:REST] get page failed:', err.message) }
  }
  const raw = await callMCP('notion-fetch', { id: pageId })
  const json = tryParseJSON(raw)
  if (json?.id) return { id: json.id, title: extractTitleFromPage(json), url: json.url, properties: json.properties }
  return { id: pageId, title: 'Untitled', url: extractUrlFromText(raw) }
}

export async function getBlockChildren(blockId) {
  const headers = restHeaders()
  if (headers) {
    try {
      console.log(`[Notion:REST] GET blocks/${blockId}/children`)
      const allBlocks = []
      let cursor = undefined
      do {
        const url = `${NOTION_BASE}/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
        const data = await restJson(url, {}, 'get blocks')
        allBlocks.push(...(data.results || []))
        cursor = data.has_more ? data.next_cursor : undefined
      } while (cursor)
      const plainText = allBlocks.map(block => {
        const content = block[block.type]
        if (!content?.rich_text) return ''
        const text = content.rich_text.map(rt => rt.plain_text).join('')
        if (block.type === 'heading_1') return `# ${text}`
        if (block.type === 'heading_2') return `## ${text}`
        if (block.type === 'heading_3') return `### ${text}`
        if (block.type === 'bulleted_list_item') return `- ${text}`
        if (block.type === 'numbered_list_item') return `1. ${text}`
        if (block.type === 'to_do') return `[${content.checked ? 'x' : ' '}] ${text}`
        return text
      }).filter(Boolean).join('\n')
      return { raw: plainText, blocks: allBlocks }
    } catch (err) { console.warn('[Notion:REST] get blocks failed:', err.message) }
  }
  const raw = await callMCP('notion-fetch', { id: blockId })
  return { raw, blocks: tryParseJSON(raw)?.results || [] }
}

export async function getChildPages(parentId) {
  const { blocks } = await getBlockChildren(parentId)
  const childPages = blocks.filter(b => b.type === 'child_page')
  if (childPages.length > 0) {
    return childPages.map(b => ({ id: b.id, title: b.child_page?.title || 'Untitled' }))
  }
  return extractPagesFromText(JSON.stringify(blocks))
}

export async function queryDatabase(databaseId) {
  const headers = restHeaders()
  if (headers) {
    try {
      console.log(`[Notion:REST] POST databases/${databaseId}/query`)
      const allResults = []
      let cursor = undefined
      do {
        const body = { page_size: 100 }
        if (cursor) body.start_cursor = cursor
        const data = await restJson(`${NOTION_BASE}/databases/${databaseId}/query`, {
          method: 'POST', body: JSON.stringify(body),
        }, 'query database')
        allResults.push(...(data.results || []))
        cursor = data.has_more ? data.next_cursor : undefined
      } while (cursor)
      return { raw: JSON.stringify({ results: allResults }), json: { results: allResults } }
    } catch (err) { console.warn('[Notion:REST] query database failed:', err.message) }
  }
  const raw = await callMCP('notion-fetch', { id: databaseId })
  return { raw, json: tryParseJSON(raw) }
}

export async function getDatabase(databaseId) {
  const headers = restHeaders()
  if (headers) {
    try {
      console.log(`[Notion:REST] GET databases/${databaseId}`)
      const data = await restJson(`${NOTION_BASE}/databases/${databaseId}`, {}, 'get database')
      return { id: data.id, archived: !!data.archived, url: data.url, raw: JSON.stringify(data) }
    } catch (err) { console.warn('[Notion:REST] get database failed:', err.message) }
  }
  const raw = await callMCP('notion-fetch', { id: databaseId })
  const json = tryParseJSON(raw)
  return { id: databaseId, archived: json?.archived || false, url: json?.url || extractUrlFromText(raw), raw }
}

export async function updatePageContent(pageId, markdownContent) {
  const headers = restHeaders()
  if (!headers) {
    console.warn('[Notion] updatePageContent skipped — no REST token for block operations')
    return
  }
  console.log(`[Notion:REST] update content for page ${pageId}`)
  const existing = await restJson(`${NOTION_BASE}/blocks/${pageId}/children?page_size=100`, {}, 'fetch blocks')
  for (const b of existing.results || []) {
    await fetch(`${NOTION_BASE}/blocks/${b.id}`, { method: 'DELETE', headers }).catch(() => {})
  }
  const children = markdownToBlocks(markdownContent || '')
  if (children.length > 0) {
    await restJson(`${NOTION_BASE}/blocks/${pageId}/children`, {
      method: 'PATCH', body: JSON.stringify({ children }),
    }, 'append blocks')
  }
}

// ============================================================
// Helpers
// ============================================================

function textToPlainProperties(text) {
  const props = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (!key || !val) continue
    props[key] = val
  }
  return props
}

function flattenToPlainValues(map) {
  const props = {}
  for (const [key, val] of Object.entries(map)) {
    if (val === undefined || val === null) continue
    if (typeof val === 'string' || typeof val === 'number') { props[key] = val; continue }
    if (val?.title?.[0]?.text?.content) { props[key] = val.title[0].text.content; continue }
    if (val?.select?.name) { props[key] = val.select.name; continue }
    if (val?.multi_select) { props[key] = val.multi_select.map(s => s.name).join(', '); continue }
    if (val?.rich_text?.[0]?.text?.content) { props[key] = val.rich_text[0].text.content; continue }
    props[key] = String(val)
  }
  return props
}

function markdownToBlocks(text) {
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
