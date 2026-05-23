// Notion MCP Proxy — wraps MCP tool calls into clean async functions.
//
// Every Notion operation goes through the MCP tools instead of REST.
// The hosted MCP server at mcp.notion.com returns JSON (the open-source
// proxy does JSON.stringify(response.data)), but may include enhanced
// markdown in some responses. We try JSON.parse first, fall back to
// text parsing.
//
// Tool input schemas come from the Notion OpenAPI spec at:
//   @notionhq/notion-mcp-server/scripts/notion-openapi.json
// See CLAUDE.md "Notion MCP Rules" — never guess params.

import * as notionMCP from './notionMCP.js'

function ensureConnected() {
  if (!notionMCP.getStatus().connected) {
    throw new Error('Notion MCP not connected. Connect in Settings → Integrations → Notion.')
  }
}

async function call(toolName, args) {
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

// Extract a Notion page/database ID (32 hex chars) from a notion.so URL
// and format it as a dashed UUID.
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
  for (const val of Object.values(properties)) {
    if (val?.type === 'title' && val.title?.length) {
      return val.title.map(t => t.plain_text || t.text?.content || '').join('')
    }
  }
  return null
}

function extractPagesFromText(raw) {
  const pages = []
  const urlRegex = /notion\.so\/(?:[^/]*\/)?([a-f0-9]{32})/g
  let m
  while ((m = urlRegex.exec(raw)) !== null) {
    const h = m[1]
    const ctx = raw.slice(Math.max(0, m.index - 200), m.index + 100)
    const titleMatch = ctx.match(/title="([^"]*)"/) || ctx.match(/["']([^"'\n]{2,60})["']\s*$/)
    pages.push({
      id: `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`,
      title: titleMatch?.[1]?.trim() || 'Untitled',
      url: `https://www.notion.so/${h}`,
    })
  }
  return pages
}

// --- Search ---

// post-search: { query: string, sort?: object, filter?: object }
// Response: { results: [{ id, url, properties, last_edited_time }] }
export async function search(query) {
  const raw = await call('notion-search', { query })
  const json = tryParseJSON(raw)
  if (json?.results) {
    return json.results.map(p => ({
      id: p.id,
      title: extractTitleFromProperties(p.properties) || 'Untitled',
      url: p.url,
      last_edited: p.last_edited_time,
    }))
  }
  // Fallback: parse notion URLs from text response
  return extractPagesFromText(raw)
}

// --- Get page ---

// notion-fetch: custom tool, param name assumed { resource_uri }
// Response: page object or enhanced markdown
export async function getPage(pageId) {
  const raw = await call('notion-fetch', { resource_uri: `notion://page/${pageId}` })
  const json = tryParseJSON(raw)
  if (json?.id) return {
    id: json.id,
    title: extractTitleFromProperties(json.properties),
    url: json.url,
    properties: json.properties,
  }
  // Fallback for non-JSON responses
  const url = extractUrlFromText(raw)
  const titleMatch = raw.match(/title[= ]["']?([^"'\n<]+)/) || raw.match(/^#\s+(.+)/m)
  return { id: pageId, title: titleMatch?.[1]?.trim() || 'Untitled', url }
}

// --- Get block children (page content as text) ---

export async function getBlockChildren(blockId) {
  const raw = await call('notion-fetch', { resource_uri: `notion://block/${blockId}/children` })
  return { raw, blocks: tryParseJSON(raw)?.results || [] }
}

// --- Get child pages of a parent ---

export async function getChildPages(parentId) {
  const raw = await call('notion-fetch', { resource_uri: `notion://block/${parentId}/children` })
  const json = tryParseJSON(raw)
  if (json?.results) {
    return json.results
      .filter(b => b.type === 'child_page')
      .map(b => ({ id: b.id, title: b.child_page?.title || 'Untitled' }))
  }
  // Parse enhanced markdown for child pages
  const pages = []
  const urlRegex = /notion\.so\/(?:[^/]*\/)?([a-f0-9]{32})/g
  let m
  while ((m = urlRegex.exec(raw)) !== null) {
    const h = m[1]
    const id = `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
    if (id !== parentId) {
      const titleMatch = raw.slice(Math.max(0, m.index - 200), m.index + 100).match(/title="([^"]*)"/)
      pages.push({ id, title: titleMatch?.[1] || 'Untitled', url: `https://www.notion.so/${h}` })
    }
  }
  return pages
}

// post-page: { parent: { page_id }, properties: object, children?: string[] }
// parent.page_id: UUID string (required)
// properties: Notion API property-value objects (required) — at minimum { title: { title: [...] } }
// children: array of strings (enhanced markdown lines, NOT block objects)
// Response: created page object { id, url, properties, ... }
export async function createPage({ parentId, title, content }) {
  const properties = {
    title: { title: [{ text: { content: title } }] }
  }
  const args = {
    parent: { page_id: parentId },
    properties,
  }
  if (content) args.children = content.split('\n').filter(Boolean)
  const raw = await call('notion-create-pages', args)
  // Try JSON first (open-source proxy returns JSON.stringify(response.data))
  const json = tryParseJSON(raw)
  if (json?.id) return { id: json.id, url: json.url }
  // Fallback: extract from text/enhanced markdown
  const id = extractIdFromUrl(raw)
  const url = extractUrlFromText(raw)
  if (!id) throw new Error('Could not parse page ID from MCP response: ' + raw.slice(0, 300))
  return { id, url }
}

// --- Create page in a database ---

export async function createPageInDatabase({ databaseId, properties, content }) {
  // properties can be a Notion API property-values object OR a simple
  // { Name: 'title', Type: 'Location', ... } map that we convert
  let propsObj = properties
  if (typeof properties === 'string') {
    propsObj = textToNotionProperties(properties)
  } else if (properties && !properties.Name?.title && !properties.title?.title) {
    propsObj = simpleMapToNotionProperties(properties)
  }
  const args = {
    parent: { database_id: databaseId },
    properties: propsObj,
  }
  if (content) args.children = content.split('\n').filter(Boolean)
  const raw = await call('notion-create-pages', args)
  const json = tryParseJSON(raw)
  if (json?.id) return { id: json.id, url: json.url }
  const id = extractIdFromUrl(raw)
  const url = extractUrlFromText(raw)
  if (!id) throw new Error('Could not parse page ID from MCP response: ' + raw.slice(0, 300))
  return { id, url }
}

// --- Update page ---

export async function updatePage({ pageId, properties, content, archived }) {
  const args = { page_id: pageId }
  if (properties) {
    if (typeof properties === 'string') {
      args.properties = textToNotionProperties(properties)
    } else if (properties.Name?.title || properties.title?.title) {
      args.properties = properties
    } else {
      args.properties = simpleMapToNotionProperties(properties)
    }
  }
  if (archived !== undefined) args.archived = archived
  // Note: patch-page doesn't support children/content — that requires
  // separate block append. For now, content updates are best-effort.
  const raw = await call('notion-update-page', args)
  return { id: pageId, url: extractUrlFromText(raw), raw }
}

// --- Archive/restore page ---

export async function archivePage(pageId) {
  return updatePage({ pageId, archived: true })
}

export async function restorePage(pageId) {
  return updatePage({ pageId, archived: false })
}

// --- Create database ---

// notion-create-database: CUSTOM tool (not in OpenAPI spec)
// Hosted server accepts { parent: { page_id }, title: string, schema: SQL_DDL_string }
// Response: may be JSON or enhanced markdown (hosted server differs from open-source)
export async function createDatabase({ parentPageId, title, schema }) {
  const raw = await call('notion-create-database', {
    parent: { page_id: parentPageId },
    title,
    schema,
  })
  const json = tryParseJSON(raw)
  if (json?.id) return { id: json.id, url: json.url }
  const id = extractIdFromUrl(raw)
  const url = extractUrlFromText(raw)
  if (!id) throw new Error('Could not parse database ID from MCP response: ' + raw.slice(0, 300))
  return { id, url }
}

// --- Fetch database (verify it exists) ---

export async function getDatabase(databaseId) {
  const raw = await call('notion-fetch', { resource_uri: `notion://database/${databaseId}` })
  const json = tryParseJSON(raw)
  return {
    id: databaseId,
    archived: json?.archived || raw.includes('archived'),
    url: extractUrlFromText(raw),
    raw,
  }
}

// --- Query database ---

export async function queryDatabase(databaseId) {
  const raw = await call('notion-fetch', { resource_uri: `notion://database/${databaseId}` })
  return { raw, json: tryParseJSON(raw) }
}

// --- Get users (connection check) ---

export async function getUsers() {
  const raw = await call('notion-get-users', {})
  return { raw, json: tryParseJSON(raw) }
}

// --- Check if connected ---

export function isConnected() {
  return notionMCP.getStatus().connected
}

// --- Helpers: convert property formats to Notion API objects ---

// Convert "Name: value\nType: Location" text to Notion API properties
function textToNotionProperties(text) {
  const props = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (!key || !val) continue
    if (key === 'Name' || key === 'Title') {
      props[key] = { title: [{ text: { content: val } }] }
    } else if (['Type', 'Status', 'Confidence'].includes(key)) {
      props[key] = { select: { name: val } }
    } else if (key === 'Tags') {
      props[key] = { multi_select: val.split(',').map(s => ({ name: s.trim() })).filter(s => s.name) }
    } else {
      props[key] = { rich_text: [{ text: { content: val } }] }
    }
  }
  return props
}

// Convert { Name: 'title', Type: 'Location' } simple map to Notion API format
function simpleMapToNotionProperties(map) {
  const props = {}
  for (const [key, val] of Object.entries(map)) {
    if (val === undefined || val === null) continue
    if (key === 'Name' || key === 'Title') {
      props[key] = { title: [{ text: { content: String(val) } }] }
    } else if (['Type', 'Status', 'Confidence'].includes(key)) {
      props[key] = { select: { name: String(val) } }
    } else if (key === 'Tags' && Array.isArray(val)) {
      props[key] = { multi_select: val.map(s => ({ name: String(s) })) }
    } else if (typeof val === 'string') {
      props[key] = { rich_text: [{ text: { content: val } }] }
    }
  }
  return props
}

// Format Notion API properties to text (for update-page which may take text)
function formatProperties(props) {
  if (!props || typeof props !== 'object') return ''
  const lines = []
  for (const [key, val] of Object.entries(props)) {
    if (val?.title) {
      lines.push(`${key}: ${val.title.map(t => t.text?.content || t.plain_text || '').join('')}`)
    } else if (val?.select?.name) {
      lines.push(`${key}: ${val.select.name}`)
    } else if (val?.multi_select) {
      lines.push(`${key}: ${val.multi_select.map(s => s.name).join(', ')}`)
    } else if (val?.rich_text) {
      lines.push(`${key}: ${val.rich_text.map(t => t.text?.content || t.plain_text || '').join('')}`)
    }
  }
  return lines.join('\n')
}
