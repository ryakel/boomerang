// adviserToolsKnowledge.js — Knowledge-base tools for Quokka.
//
// The knowledge base is a Notion database the user owns; Boomerang keeps a
// local metadata index so search is instant. Writes go through Notion (the
// source of truth) and update the local cache on success.
//
// Conventions match other tool families:
//   - Read tools are readOnly (run inline during the chat loop)
//   - Mutation tools stage for user confirmation; compensations roll back
//     the Notion write AND the local cache row on plan failure
//   - Tools require deps.notionToken (resolved by /api/adviser/chat from
//     the MCP-issued OAuth token); error message tells the user how to fix
//     when missing

import { registerTool } from './adviserTools.js'
import {
  searchKnowledgeItems, getKnowledgeItem, getAllKnowledgeItems,
  getTask, updateTaskPartial,
} from './db.js'
import {
  createKnowledgeItem, updateKnowledgeItem, archiveKnowledgeItem,
  restoreKnowledgeItem, refreshKnowledgeIndex, fetchKnowledgeBody,
} from './knowledgeSync.js'

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

export function registerKnowledgeTools() {
  // --- READ ---
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
        if (deps?.notionToken) {
          body = await fetchKnowledgeBody({ token: deps.notionToken, pageId: notion_page_id })
        }
      } catch (err) {
        console.warn('[Adviser] fetchKnowledgeBody failed:', err.message)
      }
      return { result: { ...summarizeItem(item), body } }
    },
  })

  registerTool({
    name: 'refresh_knowledge_index',
    description: 'Force a refresh of the local knowledge cache from Notion. Use when the user says they just added something in Notion and you don\'t see it. Background refresh runs every 5 minutes so this is rarely needed.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async (_args, deps) => {
      ensureKbConfigured(deps)
      if (!deps.notionToken) throw new Error('Notion not connected')
      const outcome = await refreshKnowledgeIndex({ token: deps.notionToken, getData: deps.kbGetData, setData: deps.kbSetData })
      return { result: outcome }
    },
  })

  // --- CREATE ---
  registerTool({
    name: 'create_knowledge',
    description: 'Create a new knowledge item in the user\'s Notion knowledge base. ALWAYS call search_knowledge first with the proposed title (or key keywords) — if any matches return, ASK the user whether to append/update an existing item before staging a new one. Knowledge items are durable facts: locations of physical things, decisions and their reasoning, how-tos, people and their context. Body is markdown-ish (supports #, ##, -, - [ ]).',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, searchable name. E.g. "Construction paper" or "Cat food brand".' },
        type: { type: 'string', enum: TYPE_VALUES, description: 'Required for clean filtering.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Freeform tags for cross-cutting search. Lowercase preferred.' },
        body: { type: 'string', description: 'Full content. Markdown-ish.' },
        confidence: { type: 'string', enum: CONFIDENCE_VALUES, description: 'Use "Fuzzy" when the user expressed uncertainty ("I think it\'s in the…").' },
        related_task_ids: { type: 'array', items: { type: 'string' }, description: 'Boomerang task IDs this knowledge relates to. Pass an empty array if none.' },
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
      if (!deps.notionToken) throw new Error('Notion not connected')
      const created = await createKnowledgeItem({
        token: deps.notionToken,
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
          try {
            await archiveKnowledgeItem({ token: deps.notionToken, pageId: created.id })
          } catch (err) {
            console.warn('[Adviser] knowledge create rollback failed:', err.message)
          }
        },
      }
    },
  })

  // --- UPDATE ---
  registerTool({
    name: 'update_knowledge',
    description: 'Update an existing knowledge item. Any of title/type/tags/body/confidence/related_task_ids may be provided — only supplied fields change. When the user says "actually the lampshade is in the basement", LOOK UP the existing item with search_knowledge / get_knowledge first, then call this — don\'t create a duplicate.',
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
        title_hint: { type: 'string', description: 'Human-readable item title for the plan preview (not sent to Notion). Pass the title you saw in search_knowledge.' },
      },
      required: ['notion_page_id'],
    },
    preview: (a) => {
      const changed = Object.keys(a).filter(k => !['notion_page_id', 'title_hint'].includes(k))
      return `Update knowledge "${a.title_hint || a.title || a.notion_page_id.slice(0, 8)}": ${changed.join(', ') || '(no changes)'}`
    },
    execute: async (args, deps) => {
      ensureKbConfigured(deps)
      if (!deps.notionToken) throw new Error('Notion not connected')
      const { before, beforePage } = await updateKnowledgeItem({
        token: deps.notionToken,
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
          // Restore the property-level state from the captured pre-state.
          if (!before) return
          try {
            await updateKnowledgeItem({
              token: deps.notionToken,
              pageId: args.notion_page_id,
              title: before.title,
              type: before.type,
              tags: before.tags,
              confidence: before.confidence,
              relatedTaskIds: before.related_task_ids,
              // Body restore is best-effort — Notion's PATCH-children API replaces
              // blocks, so we'd need the full original body to restore exactly.
              // The metadata restore is the important part.
            })
          } catch (err) {
            console.warn('[Adviser] knowledge update rollback failed:', err.message)
          }
        },
      }
    },
  })

  // --- DELETE ---
  registerTool({
    name: 'delete_knowledge',
    description: 'Archive a knowledge item (Notion soft-delete). The user can restore from Notion\'s Trash for 30 days, but treat this as a destructive action — confirm with the user before staging. Use sparingly; out-of-date items are usually better off being updated.',
    schema: {
      type: 'object',
      properties: {
        notion_page_id: { type: 'string' },
        title_hint: { type: 'string', description: 'Human-readable item title for the plan preview.' },
      },
      required: ['notion_page_id'],
    },
    preview: (a) => `Archive knowledge "${a.title_hint || a.notion_page_id.slice(0, 8)}"`,
    execute: async ({ notion_page_id }, deps) => {
      ensureKbConfigured(deps)
      if (!deps.notionToken) throw new Error('Notion not connected')
      const { before } = await archiveKnowledgeItem({ token: deps.notionToken, pageId: notion_page_id })
      return {
        result: { notion_page_id, archived: true },
        compensation: async () => {
          try {
            await restoreKnowledgeItem({ token: deps.notionToken, pageId: notion_page_id })
            // Best-effort: re-insert the local cache row so it shows up in
            // searches again. Won't recover any properties that changed
            // between the original and the restore point.
            if (before) {
              const { upsertKnowledgeItem } = await import('./db.js')
              upsertKnowledgeItem(before)
            }
          } catch (err) {
            console.warn('[Adviser] knowledge delete rollback failed:', err.message)
          }
        },
      }
    },
  })

  // --- LINK / UNLINK to tasks ---
  registerTool({
    name: 'link_knowledge_to_task',
    description: 'Attach a knowledge item to a task. Both sides remember the link — Quokka can ask "what tasks reference this knowledge?" later. Idempotent: already-linked is a no-op.',
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

      // Mirror the link on the Notion side: append the task id to the
      // Related tasks property if Notion is reachable. Best-effort —
      // failure to update Notion doesn't fail the link locally; the
      // background refresh will eventually reconcile.
      if (deps.notionToken) {
        const beforeRelated = item.related_task_ids || []
        if (!beforeRelated.includes(task_id)) {
          try {
            await updateKnowledgeItem({
              token: deps.notionToken,
              pageId: notion_page_id,
              relatedTaskIds: [...beforeRelated, task_id],
            })
          } catch (err) {
            console.warn('[Adviser] knowledge backlink update failed:', err.message)
          }
        }
      }

      return {
        result: { task_id, notion_page_id, linked: true },
        compensation: async () => {
          const t = getTask(task_id)
          if (t) updateTaskPartial(task_id, { knowledge_page_ids: beforeIds, updated_at: new Date().toISOString() })
          // Notion backlink revert is best-effort.
          if (deps.notionToken && item) {
            try {
              await updateKnowledgeItem({
                token: deps.notionToken,
                pageId: notion_page_id,
                relatedTaskIds: item.related_task_ids || [],
              })
            } catch (err) {
              console.warn('[Adviser] knowledge backlink revert failed:', err.message)
            }
          }
        },
      }
    },
  })

  registerTool({
    name: 'unlink_knowledge_from_task',
    description: 'Remove a knowledge link from a task. Idempotent: already-unlinked is a no-op.',
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
      if (deps.notionToken && item) {
        const beforeRelated = item.related_task_ids || []
        if (beforeRelated.includes(task_id)) {
          try {
            await updateKnowledgeItem({
              token: deps.notionToken,
              pageId: notion_page_id,
              relatedTaskIds: beforeRelated.filter(id => id !== task_id),
            })
          } catch (err) {
            console.warn('[Adviser] knowledge backlink remove failed:', err.message)
          }
        }
      }

      return {
        result: { task_id, notion_page_id, unlinked: true },
        compensation: async () => {
          updateTaskPartial(task_id, { knowledge_page_ids: beforeIds, updated_at: new Date().toISOString() })
          if (deps.notionToken && item) {
            try {
              await updateKnowledgeItem({
                token: deps.notionToken,
                pageId: notion_page_id,
                relatedTaskIds: item.related_task_ids || [],
              })
            } catch (err) {
              console.warn('[Adviser] knowledge backlink revert failed:', err.message)
            }
          }
        },
      }
    },
  })

  // Diagnostic helper for the adviser/tools listing — surfaces total cached
  // items so the model can decide whether to ask the user to refresh.
  registerTool({
    name: 'list_knowledge',
    description: 'List ALL knowledge items (no query). Use sparingly — search_knowledge is preferred for any specific question. Useful when the user asks "show me everything in my knowledge base".',
    readOnly: true,
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: TYPE_VALUES },
        limit: { type: 'integer', default: 50 },
      },
    },
    execute: async ({ type, limit = 50 }, deps) => {
      ensureKbConfigured(deps)
      const items = getAllKnowledgeItems()
        .filter(it => !type || it.type === type)
        .slice(0, limit)
      return { result: { count: items.length, items: items.map(summarizeItem) } }
    },
  })
}
