// Knowledge-base sync: Notion database <-> local index cache.
//
// All Notion operations go through the MCP proxy (notionMCPProxy.js).
// No direct REST calls to api.notion.com.

import { replaceKnowledgeIndex, upsertKnowledgeItem, getKnowledgeItem, deleteKnowledgeItem } from './db.js'
import * as notion from './notionMCPProxy.js'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

const NOTION_BASE = 'https://api.notion.com/v1'

const KNOWLEDGE_DB_KEY = 'notion_knowledge_db_id'
const KNOWLEDGE_DB_URL_KEY = 'notion_knowledge_db_url'
const KNOWLEDGE_LAST_SYNC_KEY = 'notion_knowledge_last_sync'

const KB_SCHEMA = `CREATE TABLE (
  "Name" TITLE,
  "Type" SELECT('Location':blue, 'How-to':green, 'Decision':purple, 'Person':pink),
  "Tags" RICH_TEXT,
  "Related tasks" RICH_TEXT,
  "Confidence" SELECT('Certain':green, 'Fuzzy':yellow)
)`

// Parse a knowledge item from enhanced markdown text returned by MCP.
// The MCP fetch response for a database page contains property values
// in a structured format — we extract what we can.
function parseKnowledgeItemFromMarkdown(pageId, raw) {
  const titleMatch = raw.match(/(?:Name|Title)[:\s]+(.+?)(?:\n|$)/i)
  const typeMatch = raw.match(/Type[:\s]+(.+?)(?:\n|$)/i)
  const tagsMatch = raw.match(/Tags[:\s]+(.+?)(?:\n|$)/i)
  const confMatch = raw.match(/Confidence[:\s]+(.+?)(?:\n|$)/i)
  const relatedMatch = raw.match(/Related\s+tasks?[:\s]+(.+?)(?:\n|$)/i)
  const urlMatch = raw.match(/notion\.so\/(?:[^/]*\/)?([a-f0-9]{32})/)
  return {
    notion_page_id: pageId,
    title: titleMatch?.[1]?.trim() || 'Untitled',
    type: typeMatch?.[1]?.trim() || null,
    tags: tagsMatch?.[1]?.split(',').map(s => s.trim()).filter(Boolean) || [],
    summary: '',
    confidence: confMatch?.[1]?.trim() || null,
    related_task_ids: relatedMatch?.[1]?.split(/[,\s]+/).map(s => s.trim()).filter(Boolean) || [],
    notion_url: urlMatch ? `https://www.notion.so/${urlMatch[1]}` : null,
    last_edited_time: null,
    last_synced_at: new Date().toISOString(),
    archived: false,
  }
}

// Verify the REST integration token can access an MCP-created resource.
// MCP OAuth has full workspace access, but the integration token only
// sees pages shared via Connections. If the parent page isn't shared,
// REST operations (query, block reads) will silently fail.
async function verifyRestAccess(databaseId) {
  const token = process.env.NOTION_INTEGRATION_TOKEN
  if (!token) {
    console.warn('[Knowledge] No NOTION_INTEGRATION_TOKEN — REST operations (query, block reads) will use MCP fallback only')
    return
  }
  try {
    const res = await fetch(`${NOTION_BASE}/databases/${databaseId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    })
    if (res.ok) {
      console.log('[Knowledge] REST access verified — integration token can reach the KB database')
    } else if (res.status === 404 || res.status === 403) {
      console.warn(
        `[Knowledge] WARNING: REST integration token CANNOT access the KB database (${res.status}). ` +
        'The parent page likely needs to be shared with the integration via Notion → "..." → Connections. ' +
        'Without this, database queries and block reads will fall back to MCP (no pagination, no structured blocks).'
      )
    } else {
      console.warn(`[Knowledge] REST access check returned ${res.status} — may work, may not`)
    }
  } catch (err) {
    console.warn('[Knowledge] REST access check failed:', err.message)
  }
}

// Auto-create the knowledge database under a parent page.
export async function ensureKnowledgeDatabase({ parentPageId, getData, setData }) {
  const existing = getData(KNOWLEDGE_DB_KEY)
  if (existing) {
    try {
      const db = await notion.getDatabase(existing)
      if (db && !db.archived) {
        if (!getData('knowledge_tags_migrated')) {
          try {
            await notion.updateDataSource({ dataSourceId: existing, statements: 'ALTER COLUMN "Tags" SET RICH_TEXT' })
            setData('knowledge_tags_migrated', true)
            console.log('[Knowledge] Migrated Tags from MULTI_SELECT to RICH_TEXT')
          } catch (e) { console.warn('[Knowledge] Tags migration skipped:', e.message) }
        }
        return { database_id: existing, url: db.url || getData(KNOWLEDGE_DB_URL_KEY), created: false }
      }
    } catch {
      // DB id is stale — fall through and re-create.
    }
  }
  if (!parentPageId) throw new Error('parent_page_id required to create the knowledge database')

  const result = await notion.createDatabase({
    parentPageId,
    title: 'Boomerang Knowledge',
    schema: KB_SCHEMA,
  })
  setData(KNOWLEDGE_DB_KEY, result.id)
  setData(KNOWLEDGE_DB_URL_KEY, result.url || null)
  console.log(`[Knowledge] Created Notion database ${result.id}`)

  // Verify REST can access the new database. If it can't, the user
  // hasn't shared the parent page with the integration — REST-backed
  // operations (query, block reads) will silently fail.
  await verifyRestAccess(result.id)

  return { database_id: result.id, url: result.url, created: true }
}

// Query the DB and replace the local cache.
export async function refreshKnowledgeIndex({ getData, setData }) {
  const dbId = getData(KNOWLEDGE_DB_KEY)
  if (!dbId) return { ok: false, error: 'Knowledge database not configured', count: 0 }
  if (!notion.isConnected()) return { ok: false, error: 'Notion not connected', count: 0 }

  if (!getData('knowledge_tags_migrated')) {
    try {
      await notion.updateDataSource({ dataSourceId: dbId, statements: 'ALTER COLUMN "Tags" SET RICH_TEXT' })
      setData('knowledge_tags_migrated', true)
      console.log('[Knowledge] Migrated Tags from MULTI_SELECT to RICH_TEXT')
    } catch (e) { console.warn('[Knowledge] Tags migration skipped:', e.message) }
  }

  const { raw } = await notion.queryDatabase(dbId)
  console.log('[Knowledge] queryDatabase response type:', typeof raw, 'length:', raw?.length, 'preview:', String(raw).slice(0, 500))
  const items = []
  let json
  try { json = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { json = null }
  if (json?.results) {
    for (const page of json.results) {
      if (page.archived) continue
      items.push({
        notion_page_id: page.id,
        title: page.properties?.Name?.title?.map(t => t.plain_text).join('') || 'Untitled',
        type: page.properties?.Type?.select?.name || null,
        tags: (page.properties?.Tags?.rich_text?.map(t => t.plain_text).join('') || '')
          .split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
        summary: '',
        confidence: page.properties?.Confidence?.select?.name || null,
        related_task_ids: (page.properties?.['Related tasks']?.rich_text?.map(t => t.plain_text).join('') || '')
          .split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
        notion_url: page.url || null,
        last_edited_time: page.last_edited_time || null,
        last_synced_at: new Date().toISOString(),
        archived: false,
      })
    }
  }

  // Fallback: if JSON parsing found nothing, try to extract pages from
  // the enhanced markdown response (MCP notion-fetch returns this format).
  if (items.length === 0 && typeof raw === 'string' && raw.length > 0) {
    // MCP database fetch lists pages as markdown sections with page IDs.
    const pageIdRegex = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32})/gi
    const pageIds = [...new Set((raw.match(pageIdRegex) || []).filter(id => id !== dbId))]
    for (const pid of pageIds) {
      const item = parseKnowledgeItemFromMarkdown(pid, raw)
      if (item.title !== 'Untitled') items.push(item)
    }
    console.log(`[Knowledge] Parsed ${items.length} items from MCP markdown (${pageIds.length} candidate IDs)`)
  }

  replaceKnowledgeIndex(items)
  setData(KNOWLEDGE_LAST_SYNC_KEY, new Date().toISOString())
  console.log(`[Knowledge] Refreshed index — ${items.length} items`)
  return { ok: true, count: items.length }
}

// Fetch full page body as text.
export async function fetchKnowledgeBody({ pageId }) {
  if (!notion.isConnected()) throw new Error('Notion not connected')
  const { raw } = await notion.getBlockChildren(pageId)
  return raw || ''
}

// Create a new knowledge item.
export async function createKnowledgeItem({ getData, title, type, tags = [], body = '', confidence, relatedTaskIds = [] }) {
  const dbId = getData(KNOWLEDGE_DB_KEY)
  if (!dbId) throw new Error('Knowledge database not configured')
  if (!title?.trim()) throw new Error('title required')

  const props = [`Name: ${title}`]
  if (type) props.push(`Type: ${type}`)
  if (tags?.length) props.push(`Tags: ${tags.join(', ')}`)
  if (confidence) props.push(`Confidence: ${confidence}`)
  if (relatedTaskIds?.length) props.push(`Related tasks: ${relatedTaskIds.join(', ')}`)

  const result = await notion.createPageInDatabase({
    databaseId: dbId,
    properties: props.join('\n'),
    content: body,
  })

  const item = {
    notion_page_id: result.id,
    title,
    type: type || null,
    tags: tags || [],
    summary: (body || '').slice(0, 200),
    confidence: confidence || null,
    related_task_ids: relatedTaskIds || [],
    notion_url: result.url || null,
    last_edited_time: null,
    last_synced_at: new Date().toISOString(),
    archived: false,
  }
  upsertKnowledgeItem(item)
  return { id: result.id, url: result.url, item }
}

// Update an existing knowledge item.
export async function updateKnowledgeItem({ pageId, title, type, tags, body, confidence, relatedTaskIds }) {
  if (!notion.isConnected()) throw new Error('Notion not connected')
  const before = getKnowledgeItem(pageId)

  const props = []
  if (title !== undefined) props.push(`Name: ${title}`)
  if (type !== undefined) props.push(`Type: ${type || ''}`)
  if (tags !== undefined) props.push(`Tags: ${(tags || []).join(', ')}`)
  if (confidence !== undefined) props.push(`Confidence: ${confidence || ''}`)
  if (relatedTaskIds !== undefined) props.push(`Related tasks: ${(relatedTaskIds || []).join(', ')}`)

  if (props.length > 0) {
    await notion.updatePage({ pageId, properties: props.join('\n') })
  }
  if (body !== undefined) {
    await notion.updatePageContent(pageId, body || '')
  }

  const item = {
    notion_page_id: pageId,
    title: title !== undefined ? title : (before?.title || 'Untitled'),
    type: type !== undefined ? (type || null) : (before?.type || null),
    tags: tags !== undefined ? (tags || []) : (before?.tags || []),
    summary: body !== undefined ? (body || '').slice(0, 200) : (before?.summary || ''),
    confidence: confidence !== undefined ? (confidence || null) : (before?.confidence || null),
    related_task_ids: relatedTaskIds !== undefined ? (relatedTaskIds || []) : (before?.related_task_ids || []),
    notion_url: before?.notion_url || null,
    last_edited_time: null,
    last_synced_at: new Date().toISOString(),
    archived: false,
  }
  upsertKnowledgeItem(item)
  return { before, after: item }
}

// Archive (soft-delete) a knowledge item.
export async function archiveKnowledgeItem({ pageId }) {
  if (!notion.isConnected()) throw new Error('Notion not connected')
  const before = getKnowledgeItem(pageId)
  await notion.archivePage(pageId)
  deleteKnowledgeItem(pageId)
  return { before }
}

// Restore (un-archive) a previously archived item.
export async function restoreKnowledgeItem({ pageId }) {
  if (!notion.isConnected()) return
  await notion.restorePage(pageId).catch(() => {})
}

// Background refresh loop.
let refreshTimer = null
export function startKnowledgeRefreshLoop({ getData, setData }) {
  if (refreshTimer) return
  const tick = async () => {
    try {
      const dbId = getData(KNOWLEDGE_DB_KEY)
      if (!notion.isConnected() || !dbId) return
      await refreshKnowledgeIndex({ getData, setData })
    } catch (err) {
      console.warn('[Knowledge] refresh failed:', err.message)
    }
  }
  refreshTimer = setInterval(tick, REFRESH_INTERVAL_MS)
  refreshTimer.unref?.()
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
