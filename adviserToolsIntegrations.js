// adviserToolsIntegrations.js — Google Calendar, Notion, Trello tools for the Adviser.
//
// These tools hit external APIs. Compensations do best-effort rollback:
// - create → delete/archive the created resource
// - update → restore the pre-update body (captured via GET before mutating)
// - delete → cannot perfectly restore (logs a warning; external deletes are final)

import { registerTool } from './adviserTools.js'

const GCAL_BASE = 'https://www.googleapis.com/calendar/v3'
const TRELLO_BASE = 'https://api.trello.com/1'

function ensure(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function httpJson(url, init, label) {
  const res = await fetch(url, init)
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`${label} ${res.status}: ${data.error?.message || data.message || data.error || text.slice(0, 200)}`)
  return data
}

// ============================================================
// Google Calendar
// ============================================================

export function registerGCalTools() {
  registerTool({
    name: 'gcal_list_calendars',
    description: 'List the user\'s Google calendars (id + summary + primary flag). Use before create/update to know which calendar_id to target.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async (_args, deps) => {
      ensure(deps.gcalToken, 'Google Calendar not connected')
      const data = await httpJson(`${GCAL_BASE}/users/me/calendarList`, {
        headers: { Authorization: `Bearer ${deps.gcalToken}` },
      }, 'GCal list')
      const calendars = (data.items || []).map(c => ({
        id: c.id, summary: c.summary, primary: !!c.primary,
      }))
      return { result: { calendars } }
    },
  })

  registerTool({
    name: 'gcal_list_events',
    description: 'List events in a calendar within a time range. Useful to find an event before updating or deleting it.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', default: 'primary' },
        time_min: { type: 'string', description: 'ISO datetime lower bound' },
        time_max: { type: 'string', description: 'ISO datetime upper bound' },
        q: { type: 'string', description: 'Text search' },
      },
    },
    execute: async (args, deps) => {
      ensure(deps.gcalToken, 'Google Calendar not connected')
      const calId = encodeURIComponent(args.calendar_id || 'primary')
      const params = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '100' })
      if (args.time_min) params.set('timeMin', args.time_min)
      if (args.time_max) params.set('timeMax', args.time_max)
      if (args.q) params.set('q', args.q)
      const data = await httpJson(`${GCAL_BASE}/calendars/${calId}/events?${params}`, {
        headers: { Authorization: `Bearer ${deps.gcalToken}` },
      }, 'GCal events')
      const events = (data.items || []).map(e => ({
        id: e.id, summary: e.summary || '', description: e.description || '',
        start: e.start, end: e.end, htmlLink: e.htmlLink,
      }))
      return { result: { count: events.length, events } }
    },
  })

  registerTool({
    name: 'gcal_create_event',
    description: 'Create a calendar event. start/end accept either { dateTime, timeZone } for timed or { date } for all-day.',
    schema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', default: 'primary' },
        summary: { type: 'string' },
        description: { type: 'string' },
        start: { type: 'object' },
        end: { type: 'object' },
      },
      required: ['summary', 'start', 'end'],
    },
    preview: (a) => `Create GCal event "${a.summary}"`,
    execute: async (args, deps) => {
      ensure(deps.gcalToken, 'Google Calendar not connected')
      const calId = encodeURIComponent(args.calendar_id || 'primary')
      const event = {
        summary: args.summary,
        description: args.description || '',
        start: args.start,
        end: args.end,
      }
      const data = await httpJson(`${GCAL_BASE}/calendars/${calId}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${deps.gcalToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }, 'GCal create')
      return {
        result: { event_id: data.id, htmlLink: data.htmlLink },
        compensation: async () => {
          await fetch(`${GCAL_BASE}/calendars/${calId}/events/${encodeURIComponent(data.id)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${deps.gcalToken}` },
          }).catch(() => {})
        },
      }
    },
  })

  registerTool({
    name: 'gcal_update_event',
    description: 'Patch an existing calendar event. Only provided fields change. Captures the event body first so rollback can restore it. Always include summary_hint (the event title you saw in gcal_list_events) so the plan preview reads as a human name, not an opaque ID.',
    schema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', default: 'primary' },
        event_id: { type: 'string' },
        summary: { type: 'string' },
        description: { type: 'string' },
        start: { type: 'object' },
        end: { type: 'object' },
        summary_hint: { type: 'string', description: 'Human-readable event title for the plan preview (not sent to Google). Pass the summary you saw in gcal_list_events.' },
      },
      required: ['event_id'],
    },
    preview: (a) => `Update GCal event "${a.summary_hint || a.summary || a.event_id.slice(0, 8)}"`,
    execute: async (args, deps) => {
      ensure(deps.gcalToken, 'Google Calendar not connected')
      const calId = encodeURIComponent(args.calendar_id || 'primary')
      const evId = encodeURIComponent(args.event_id)
      const before = await httpJson(`${GCAL_BASE}/calendars/${calId}/events/${evId}`, {
        headers: { Authorization: `Bearer ${deps.gcalToken}` },
      }, 'GCal fetch')
      const patch = {}
      for (const k of ['summary', 'description', 'start', 'end']) if (args[k] !== undefined) patch[k] = args[k]
      await httpJson(`${GCAL_BASE}/calendars/${calId}/events/${evId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${deps.gcalToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }, 'GCal update')
      return {
        result: { event_id: args.event_id, updated: Object.keys(patch) },
        compensation: async () => {
          const restore = {
            summary: before.summary, description: before.description,
            start: before.start, end: before.end,
          }
          await fetch(`${GCAL_BASE}/calendars/${calId}/events/${evId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${deps.gcalToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(restore),
          }).catch(() => {})
        },
      }
    },
  })

  registerTool({
    name: 'gcal_delete_event',
    description: 'Delete a calendar event. External deletes are final — rollback logs a warning but cannot restore the event. Always include summary_hint so the preview shows the event name.',
    schema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', default: 'primary' },
        event_id: { type: 'string' },
        summary_hint: { type: 'string', description: 'Human-readable event title for the plan preview (not sent to Google).' },
      },
      required: ['event_id'],
    },
    preview: (a) => `Delete GCal event "${a.summary_hint || a.event_id.slice(0, 8)}"`,
    execute: async (args, deps) => {
      ensure(deps.gcalToken, 'Google Calendar not connected')
      const calId = encodeURIComponent(args.calendar_id || 'primary')
      const evId = encodeURIComponent(args.event_id)
      const res = await fetch(`${GCAL_BASE}/calendars/${calId}/events/${evId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${deps.gcalToken}` },
      })
      if (!(res.ok || res.status === 204 || res.status === 410)) {
        const t = await res.text()
        throw new Error(`GCal delete ${res.status}: ${t.slice(0, 200)}`)
      }
      return {
        result: { event_id: args.event_id, deleted: true },
        compensation: async () => {
          console.warn(`[Adviser] Rollback cannot restore deleted GCal event ${args.event_id}`)
        },
      }
    },
  })
}

// ============================================================
// Notion
// ============================================================


export async function registerNotionTools() {
  const notionProxy = await import('./notionMCPProxy.js')

  registerTool({
    name: 'notion_query_database',
    description: 'Query a Notion database. Returns rows with properties.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: {
        database_id: { type: 'string' },
      },
      required: ['database_id'],
    },
    execute: async (args) => {
      ensure(notionProxy.isConnected(), 'Notion not connected')
      const { raw, json } = await notionProxy.queryDatabase(args.database_id)
      if (json?.results) {
        const rows = json.results.map(page => ({
          id: page.id, url: page.url, last_edited: page.last_edited_time,
        }))
        return { result: { count: rows.length, rows } }
      }
      return { result: { raw } }
    },
  })

  registerTool({
    name: 'notion_create_page',
    description: 'Create a new Notion page under a parent page. Content is markdown.',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        parent_page_id: { type: 'string' },
      },
      required: ['title', 'parent_page_id'],
    },
    preview: (a) => `Create Notion page "${a.title}"`,
    execute: async (args) => {
      ensure(notionProxy.isConnected(), 'Notion not connected')
      const result = await notionProxy.createPage({
        parentId: args.parent_page_id,
        title: args.title,
        content: args.content || '',
      })
      return {
        result: { page_id: result.id, url: result.url },
        compensation: async () => {
          await notionProxy.archivePage(result.id).catch(() => {})
        },
      }
    },
  })

  registerTool({
    name: 'notion_update_page',
    description: 'Update a Notion page title and/or replace its content.',
    schema: {
      type: 'object',
      properties: {
        page_id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string', description: 'If set, REPLACES all existing content.' },
        title_hint: { type: 'string' },
      },
      required: ['page_id'],
    },
    preview: (a) => `Update Notion page "${a.title_hint || a.title || a.page_id.slice(0, 8)}"`,
    execute: async (args) => {
      ensure(notionProxy.isConnected(), 'Notion not connected')
      const props = args.title ? `Name: ${args.title}` : undefined
      await notionProxy.updatePage({ pageId: args.page_id, properties: props, content: args.content })
      return {
        result: { page_id: args.page_id, updated: ['title', 'content'].filter(k => args[k]) },
        compensation: async () => {
          console.warn(`[Adviser] Rollback of Notion page ${args.page_id} is best-effort via MCP`)
        },
      }
    },
  })
}

// ============================================================
// Trello
// ============================================================

function trelloQs(auth) {
  return `key=${auth.key}&token=${auth.token}`
}

export function registerTrelloTools() {
  registerTool({
    name: 'trello_list_boards',
    description: 'List the user\'s Trello boards (open, not archived).',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async (_args, deps) => {
      ensure(deps.trello?.key && deps.trello?.token, 'Trello not connected')
      const data = await httpJson(`${TRELLO_BASE}/members/me/boards?fields=name,url,closed&${trelloQs(deps.trello)}`, {}, 'Trello boards')
      return { result: { boards: (data || []).filter(b => !b.closed).map(b => ({ id: b.id, name: b.name, url: b.url })) } }
    },
  })

  registerTool({
    name: 'trello_list_lists',
    description: 'List the lists (columns) on a given Trello board.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: { board_id: { type: 'string' } },
      required: ['board_id'],
    },
    execute: async ({ board_id }, deps) => {
      ensure(deps.trello?.key && deps.trello?.token, 'Trello not connected')
      const data = await httpJson(`${TRELLO_BASE}/boards/${board_id}/lists?fields=name,closed&${trelloQs(deps.trello)}`, {}, 'Trello lists')
      return { result: { lists: (data || []).filter(l => !l.closed).map(l => ({ id: l.id, name: l.name })) } }
    },
  })

  registerTool({
    name: 'trello_create_card',
    description: 'Create a new Trello card in a list.',
    schema: {
      type: 'object',
      properties: {
        list_id: { type: 'string' },
        name: { type: 'string' },
        desc: { type: 'string' },
        due: { type: 'string', description: 'ISO datetime' },
      },
      required: ['list_id', 'name'],
    },
    preview: (a) => `Create Trello card "${a.name}"`,
    execute: async (args, deps) => {
      ensure(deps.trello?.key && deps.trello?.token, 'Trello not connected')
      const data = await httpJson(`${TRELLO_BASE}/cards?${trelloQs(deps.trello)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: args.name, desc: args.desc || '', idList: args.list_id, due: args.due || null }),
      }, 'Trello create')
      return {
        result: { card_id: data.id, url: data.url },
        compensation: async () => {
          await fetch(`${TRELLO_BASE}/cards/${data.id}?${trelloQs(deps.trello)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ closed: true }),
          }).catch(() => {})
        },
      }
    },
  })

  registerTool({
    name: 'trello_update_card',
    description: 'Update Trello card fields. Captures the card\'s prior state so rollback can restore it.',
    schema: {
      type: 'object',
      properties: {
        card_id: { type: 'string' },
        name: { type: 'string' },
        desc: { type: 'string' },
        due: { type: ['string', 'null'] },
        idList: { type: 'string' },
        closed: { type: 'boolean' },
        name_hint: { type: 'string', description: 'Human-readable card name for the plan preview (not sent to Trello).' },
      },
      required: ['card_id'],
    },
    preview: (a) => `Update Trello card "${a.name_hint || a.name || a.card_id.slice(0, 8)}"`,
    execute: async (args, deps) => {
      ensure(deps.trello?.key && deps.trello?.token, 'Trello not connected')
      const before = await httpJson(`${TRELLO_BASE}/cards/${args.card_id}?${trelloQs(deps.trello)}`, {}, 'Trello fetch')
      const patch = {}
      for (const k of ['name', 'desc', 'due', 'idList', 'closed']) if (args[k] !== undefined) patch[k] = args[k]
      await httpJson(`${TRELLO_BASE}/cards/${args.card_id}?${trelloQs(deps.trello)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }, 'Trello update')
      return {
        result: { card_id: args.card_id, updated: Object.keys(patch) },
        compensation: async () => {
          const restore = {
            name: before.name, desc: before.desc,
            due: before.due, idList: before.idList, closed: before.closed,
          }
          await fetch(`${TRELLO_BASE}/cards/${args.card_id}?${trelloQs(deps.trello)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(restore),
          }).catch(() => {})
        },
      }
    },
  })

  registerTool({
    name: 'trello_archive_card',
    description: 'Archive (soft-delete) a Trello card. Rollback un-archives. Always include name_hint so the preview shows the card name.',
    schema: {
      type: 'object',
      properties: {
        card_id: { type: 'string' },
        name_hint: { type: 'string', description: 'Human-readable card name for the plan preview (not sent to Trello).' },
      },
      required: ['card_id'],
    },
    preview: (a) => `Archive Trello card "${a.name_hint || a.card_id.slice(0, 8)}"`,
    execute: async ({ card_id }, deps) => {
      ensure(deps.trello?.key && deps.trello?.token, 'Trello not connected')
      await httpJson(`${TRELLO_BASE}/cards/${card_id}?${trelloQs(deps.trello)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closed: true }),
      }, 'Trello archive')
      return {
        result: { card_id, archived: true },
        compensation: async () => {
          await fetch(`${TRELLO_BASE}/cards/${card_id}?${trelloQs(deps.trello)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ closed: false }),
          }).catch(() => {})
        },
      }
    },
  })

  registerTool({
    name: 'trello_add_checklist',
    description: 'Create a checklist on a Trello card with optional starter items.',
    schema: {
      type: 'object',
      properties: {
        card_id: { type: 'string' },
        name: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
        card_name_hint: { type: 'string', description: 'Human-readable card name for the plan preview (not sent to Trello).' },
      },
      required: ['card_id', 'name'],
    },
    preview: (a) => `Add checklist "${a.name}" to Trello card "${a.card_name_hint || a.card_id.slice(0, 8)}"`,
    execute: async (args, deps) => {
      ensure(deps.trello?.key && deps.trello?.token, 'Trello not connected')
      const cl = await httpJson(`${TRELLO_BASE}/cards/${args.card_id}/checklists?${trelloQs(deps.trello)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: args.name }),
      }, 'Trello checklist create')
      const itemIds = []
      for (const item of args.items || []) {
        const ci = await httpJson(`${TRELLO_BASE}/checklists/${cl.id}/checkItems?${trelloQs(deps.trello)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: item, checked: 'false' }),
        }, 'Trello item')
        itemIds.push(ci.id)
      }
      return {
        result: { checklist_id: cl.id, item_ids: itemIds },
        compensation: async () => {
          await fetch(`${TRELLO_BASE}/checklists/${cl.id}?${trelloQs(deps.trello)}`, { method: 'DELETE' }).catch(() => {})
        },
      }
    },
  })
}
