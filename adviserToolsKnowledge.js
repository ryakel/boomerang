// adviserToolsKnowledge.js — Knowledge-base tools for Quokka.
//
// All Notion operations go through MCP (via knowledgeSync.js which uses
// notionMCPProxy.js). No direct REST calls, no deps.notionToken needed.

import { registerTool } from './adviserTools.js'
import {
  searchKnowledgeItems, getKnowledgeItem, getAllKnowledgeItems,
  getTask, updateTaskPartial,
} from './db.js'
import {
  createKnowledgeItem, updateKnowledgeItem, archiveKnowledgeItem,
  restoreKnowledgeItem, refreshKnowledgeIndex, fetchKnowledgeBody,
  adoptKnowledgeDatabase,
} from './knowledgeSync.js'
import { isConnected } from './notionMCPProxy.js'

const TYPE_VALUES = ['Location', 'How-to', 'Decision', 'Person']
const CONFIDENCE_VALUES = ['Certain', 'Fuzzy']

function summarizeItem(item) {
  if (!item) return null
  return {
    notion_page_id: item.notion_page_id,
    title: item.title,
    type: item.type || null,
    tags: item.tags || [],
    confidence: item.confidence || null,
    summary: item.summary || '',
    notion_url: item.notion_url || null,
    related_task_ids: item.related_task_ids || [],
  }
}

function ensureKbConfigured(deps) {
  if (!deps?.knowledgeDbConfigured) {
    throw new Error('Knowledge base not set up. Ask the user to open Settings → Integrations → Notion → "Set up Knowledge Base".')
  }
}

function ensureNotionConnected() {
  if (!isConnected()) throw new Error('Notion MCP not connected. Connect in Settings → Integrations → Notion.')
}

export function registerKnowledgeTools() {
  // --- READ ---
  registerTool({
    name: 'connect_knowledge_database',
    description: 'Connect an EXISTING Notion database as the knowledge base (when the user already has one, instead of auto-creating). Accepts the database URL or its 32-character ID. Verifies access, stores the connection, and runs the first index sync. Use this when knowledgeDbConfigured is false and the user points at an existing database — do NOT tell them to paste it into Settings.',
    schema: {
      type: 'object',
      properties: {
        database_url_or_id: { type: 'string', description: 'Notion database URL (notion.so / app.notion.com links fine) or bare ID.' },
      },
      required: ['database_url_or_id'],
    },
    preview: (args) => `Connect existing Notion database as the knowledge base: ${args.database_url_or_id}`,
    execute: async (args, deps) => {
      const result = await adoptKnowledgeDatabase({
        databaseId: args.database_url_or_id,
        getData: deps.kbGetData,
        setData: deps.kbSetData,
      })
      const refresh = await refreshKnowledgeIndex({ getData: deps.kbGetData, setData: deps.kbSetData })
        .catch(err => ({ ok: false, error: err.message, count: 0 }))
      return {
        result: { ...result, indexed: refresh?.count ?? 0 },
        compensation: async () => {
          deps.kbSetData('notion_knowledge_db_id', null)
          deps.kbSetData('notion_knowledge_db_url', null)
        },
      }
    },
  })

  registerTool({
    name: 'search_knowledge',
    description: 'Search the user\'s personal knowledge base (Notion-backed). Matches against title, tags, and a short summary. Use BEFORE create_knowledge to dedup — the user dislikes duplicates. Returns up to `limit` items, highest-relevance first.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword query. Optional; leave blank to list everything.' },
        type: { type: 'string', enum: TYPE_VALUES, description: 'Filter by knowledge type.' },
        limit: { type: 'integer', default: 20 },
      },
    },
    execute: async (args, deps) => {
      ensureKbConfigured(deps)
      const items = searchKnowledgeItems(args.q || '', { limit: args.limit || 20, type: args.type || null })
      return { result: { count: items.length, items: items.map(summarizeItem) } }
    },
  })

  registerTool({
    name: 'get_knowledge',
    description: 'Fetch a single knowledge item including its full Notion body (markdown-ish plaintext).',
    readOnly: true,
    schema: {
      type: 'object',
      properties: { notion_page_id: { type: 'string' } },
      required: ['notion_page_id'],
    },
    execute: async ({ notion_page_id }, deps) => {
      ensureKbConfigured(deps)
      const item = getKnowledgeItem(notion_page_id)
      if (!item) throw new Error(`Knowledge item not found: ${notion_page_id}`)
      let body = ''
      try {
        body = await fetchKnowledgeBody({ pageId: notion_page_id })
      } catch (err) {
        console.warn('[Adviser] fetchKnowledgeBody failed:', err.message)
      }
      return { result: { ...summarizeItem(item), body } }
    },
  })

  registerTool({
    name: 'refresh_knowledge_index',
    description: 'Force a refresh of the local knowledge cache from Notion. Use when the user says they just added something in Notion and you don\'t see it.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async (_args, deps) => {
      ensureKbConfigured(deps)
      ensureNotionConnected()
      const outcome = await refreshKnowledgeIndex({ getData: deps.kbGetData, setData: deps.kbSetData })
      return { result: outcome }
    },
  })

  // --- CREATE ---
  registerTool({
    name: 'create_knowledge',
    description: 'Create a new knowledge item in the user\'s Notion knowledge base. ALWAYS call search_knowledge first with the proposed title (or key keywords) — if any matches return, ASK the user whether to append/update an existing item before staging a new one.',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, searchable name.' },
        type: { type: 'string', enum: TYPE_VALUES, description: 'Required for clean filtering.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Freeform tags for cross-cutting search.' },
        body: { type: 'string', description: 'Full content. Markdown-ish.' },
        confidence: { type: 'string', enum: CONFIDENCE_VALUES },
        related_task_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
    preview: (a) => {
      const parts = [`Create knowledge: "${a.title}"`]
      if (a.type) parts.push(a.type)
      if (a.tags?.length) parts.push(`tagged ${a.tags.join(', ')}`)
      return parts.join(' · ')
    },
    execute: async (args, deps) => {
      ensureKbConfigured(deps)
      ensureNotionConnected()
      const created = await createKnowledgeItem({
        getData: deps.kbGetData,
        title: args.title,
        type: args.type,
        tags: args.tags || [],
        body: args.body || '',
        confidence: args.confidence,
        relatedTaskIds: args.related_task_ids || [],
      })
      return {
        result: { notion_page_id: created.id, url: created.url, item: summarizeItem(created.item) },
        compensation: async () => {
          try { await archiveKnowledgeItem({ pageId: created.id }) }
          catch (err) { console.warn('[Adviser] knowledge create rollback failed:', err.message) }
        },
      }
    },
  })

  // --- UPDATE ---
  registerTool({
    name: 'update_knowledge',
    description: 'Update an existing knowledge item. Any of title/type/tags/body/confidence/related_task_ids may be provided — only supplied fields change.',
    schema: {
      type: 'object',
      properties: {
        notion_page_id: { type: 'string' },
        title: { type: 'string' },
        type: { type: 'string', enum: TYPE_VALUES },
        tags: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
        confidence: { type: 'string', enum: CONFIDENCE_VALUES },
        related_task_ids: { type: 'array', items: { type: 'string' } },
        title_hint: { type: 'string', description: 'Human-readable item title for the plan preview.' },
      },
      required: ['notion_page_id'],
    },
    preview: (a) => {
      const changed = Object.keys(a).filter(k => !['notion_page_id', 'title_hint'].includes(k))
      return `Update knowledge "${a.title_hint || a.title || a.notion_page_id.slice(0, 8)}": ${changed.join(', ') || '(no changes)'}`
    },
    execute: async (args, deps) => {
      ensureKbConfigured(deps)
      ensureNotionConnected()
      const { before } = await updateKnowledgeItem({
        pageId: args.notion_page_id,
        title: args.title,
        type: args.type,
        tags: args.tags,
        body: args.body,
        confidence: args.confidence,
        relatedTaskIds: args.related_task_ids,
      })
      return {
        result: { notion_page_id: args.notion_page_id, updated: Object.keys(args).filter(k => !['notion_page_id', 'title_hint'].includes(k)) },
        compensation: async () => {
          if (!before) return
          try {
            await updateKnowledgeItem({
              pageId: args.notion_page_id,
              title: before.title,
              type: before.type,
              tags: before.tags,
              confidence: before.confidence,
              relatedTaskIds: before.related_task_ids,
            })
          } catch (err) { console.warn('[Adviser] knowledge update rollback failed:', err.message) }
        },
      }
    },
  })

  // --- DELETE ---
  registerTool({
    name: 'delete_knowledge',
    description: 'Archive a knowledge item (Notion soft-delete). Confirm with the user before staging.',
    schema: {
      type: 'object',
      properties: {
        notion_page_id: { type: 'string' },
        title_hint: { type: 'string' },
      },
      required: ['notion_page_id'],
    },
    preview: (a) => `Archive knowledge "${a.title_hint || a.notion_page_id.slice(0, 8)}"`,
    execute: async ({ notion_page_id }, deps) => {
      ensureKbConfigured(deps)
      ensureNotionConnected()
      const { before } = await archiveKnowledgeItem({ pageId: notion_page_id })
      return {
        result: { notion_page_id, archived: true },
        compensation: async () => {
          try {
            await restoreKnowledgeItem({ pageId: notion_page_id })
            if (before) {
              const { upsertKnowledgeItem } = await import('./db.js')
              upsertKnowledgeItem(before)
            }
          } catch (err) { console.warn('[Adviser] knowledge delete rollback failed:', err.message) }
        },
      }
    },
  })

  // --- LINK / UNLINK ---
  registerTool({
    name: 'link_knowledge_to_task',
    description: 'Attach a knowledge item to a task. Both sides remember the link.',
    schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        notion_page_id: { type: 'string' },
        task_title_hint: { type: 'string' },
        knowledge_title_hint: { type: 'string' },
      },
      required: ['task_id', 'notion_page_id'],
    },
    preview: (a) => `Link knowledge "${a.knowledge_title_hint || a.notion_page_id.slice(0, 8)}" to task "${a.task_title_hint || a.task_id.slice(0, 8)}"`,
    execute: async ({ task_id, notion_page_id }, deps) => {
      ensureKbConfigured(deps)
      const task = getTask(task_id)
      if (!task) throw new Error(`Task not found: ${task_id}`)
      const item = getKnowledgeItem(notion_page_id)
      if (!item) throw new Error(`Knowledge item not found: ${notion_page_id}`)
      const beforeIds = Array.isArray(task.knowledge_page_ids) ? task.knowledge_page_ids : []
      if (beforeIds.includes(notion_page_id)) {
        return { result: { task_id, notion_page_id, already_linked: true } }
      }
      const nextIds = [...beforeIds, notion_page_id]
      updateTaskPartial(task_id, { knowledge_page_ids: nextIds, updated_at: new Date().toISOString() })

      // Mirror the link on the Notion side — best-effort
      if (isConnected()) {
        const beforeRelated = item.related_task_ids || []
        if (!beforeRelated.includes(task_id)) {
          try {
            await updateKnowledgeItem({ pageId: notion_page_id, relatedTaskIds: [...beforeRelated, task_id] })
          } catch (err) { console.warn('[Adviser] knowledge backlink update failed:', err.message) }
        }
      }

      return {
        result: { task_id, notion_page_id, linked: true },
        compensation: async () => {
          const t = getTask(task_id)
          if (t) updateTaskPartial(task_id, { knowledge_page_ids: beforeIds, updated_at: new Date().toISOString() })
          if (isConnected() && item) {
            try {
              await updateKnowledgeItem({ pageId: notion_page_id, relatedTaskIds: item.related_task_ids || [] })
            } catch (err) { console.warn('[Adviser] knowledge backlink revert failed:', err.message) }
          }
        },
      }
    },
  })

  registerTool({
    name: 'unlink_knowledge_from_task',
    description: 'Remove a knowledge link from a task.',
    schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        notion_page_id: { type: 'string' },
        task_title_hint: { type: 'string' },
        knowledge_title_hint: { type: 'string' },
      },
      required: ['task_id', 'notion_page_id'],
    },
    preview: (a) => `Unlink knowledge "${a.knowledge_title_hint || a.notion_page_id.slice(0, 8)}" from task "${a.task_title_hint || a.task_id.slice(0, 8)}"`,
    execute: async ({ task_id, notion_page_id }, deps) => {
      ensureKbConfigured(deps)
      const task = getTask(task_id)
      if (!task) throw new Error(`Task not found: ${task_id}`)
      const beforeIds = Array.isArray(task.knowledge_page_ids) ? task.knowledge_page_ids : []
      if (!beforeIds.includes(notion_page_id)) {
        return { result: { task_id, notion_page_id, already_unlinked: true } }
      }
      const nextIds = beforeIds.filter(id => id !== notion_page_id)
      updateTaskPartial(task_id, { knowledge_page_ids: nextIds, updated_at: new Date().toISOString() })

      const item = getKnowledgeItem(notion_page_id)
      if (isConnected() && item) {
        const beforeRelated = item.related_task_ids || []
        if (beforeRelated.includes(task_id)) {
          try {
            await updateKnowledgeItem({ pageId: notion_page_id, relatedTaskIds: beforeRelated.filter(id => id !== task_id) })
          } catch (err) { console.warn('[Adviser] knowledge backlink remove failed:', err.message) }
        }
      }

      return {
        result: { task_id, notion_page_id, unlinked: true },
        compensation: async () => {
          updateTaskPartial(task_id, { knowledge_page_ids: beforeIds, updated_at: new Date().toISOString() })
          if (isConnected() && item) {
            try {
              await updateKnowledgeItem({ pageId: notion_page_id, relatedTaskIds: item.related_task_ids || [] })
            } catch (err) { console.warn('[Adviser] knowledge backlink revert failed:', err.message) }
          }
        },
      }
    },
  })

  registerTool({
    name: 'list_knowledge',
    description: 'List ALL knowledge items (no query). Use sparingly — search_knowledge is preferred.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: { limit: { type: 'integer', default: 50 } },
    },
    execute: async (args, deps) => {
      ensureKbConfigured(deps)
      const items = getAllKnowledgeItems(args.limit || 50)
      return { result: { count: items.length, items: items.map(summarizeItem) } }
    },
  })
}
