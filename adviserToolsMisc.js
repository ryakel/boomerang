// adviserToolsMisc.js — Gmail, packages, weather, settings, analytics tools.

import {
  getTask, deleteTask, updateTaskPartial,
  getPackage, getAllPackages, upsertPackage, deletePackage, updatePackagePartial,
  getData, setData, getAnalytics, getAnalyticsHistory, getGmailProcessedCount,
  listPendingSuggestions, getPatternSuggestion, updateSuggestionStatus, snoozeSuggestion,
} from './db.js'
import { registerTool } from './adviserTools.js'

function ensure(cond, msg) { if (!cond) throw new Error(msg) }

function summarizePackage(p) {
  if (!p) return null
  return {
    id: p.id,
    tracking_number: p.tracking_number,
    carrier: p.carrier,
    carrier_name: p.carrier_name,
    label: p.label,
    status: p.status,
    status_detail: p.status_detail,
    eta: p.eta || null,
    delivered_at: p.delivered_at || null,
    last_location: p.last_location || null,
    last_polled: p.last_polled || null,
  }
}

// ============================================================
// Gmail
// ============================================================

export function registerGmailTools() {
  registerTool({
    name: 'gmail_status',
    description: 'Check Gmail integration status — connected, email address, processed count, last sync timestamp.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async () => {
      const tokens = getData('gmail_tokens')
      return {
        result: {
          connected: !!tokens?.refresh_token,
          email: tokens?.email || null,
          processedCount: getGmailProcessedCount(),
          lastSync: getData('gmail_last_sync') || null,
        },
      }
    },
  })

  registerTool({
    name: 'gmail_sync',
    description: 'Trigger a Gmail scan now. Looks back `days_back` days (default 7) for actionable tasks + tracking numbers. Items land as pending (gmail_pending=1) for user review.',
    schema: {
      type: 'object',
      properties: { days_back: { type: 'integer', default: 7, minimum: 1, maximum: 30 } },
    },
    preview: (a) => `Trigger Gmail sync (past ${a.days_back || 7} days)`,
    execute: async (args, deps) => {
      ensure(deps.syncGmail, 'Gmail sync unavailable')
      const result = await deps.syncGmail(args.days_back || 7)
      return {
        result: { synced: true, ...result },
        compensation: async () => {
          console.warn('[Adviser] Rollback cannot reverse Gmail sync — newly-created pending items remain but are harmless.')
        },
      }
    },
  })

  registerTool({
    name: 'gmail_approve_pending',
    description: 'Approve a Gmail-imported pending task or package (flips gmail_pending=0 so it shows up normally).',
    schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Task or package id' } },
      required: ['id'],
    },
    preview: (a) => `Approve Gmail pending ${a.id}`,
    execute: async ({ id }) => {
      const task = getTask(id)
      if (task) {
        const before = { ...task }
        updateTaskPartial(id, { gmail_pending: 0 })
        return {
          result: { id, type: 'task', approved: true },
          compensation: async () => { updateTaskPartial(id, { gmail_pending: before.gmail_pending }) },
        }
      }
      const pkg = getPackage(id)
      if (pkg) {
        const before = { ...pkg }
        updatePackagePartial(id, { gmail_pending: 0 })
        return {
          result: { id, type: 'package', approved: true },
          compensation: async () => { updatePackagePartial(id, { gmail_pending: before.gmail_pending }) },
        }
      }
      throw new Error(`Pending item not found: ${id}`)
    },
  })

  registerTool({
    name: 'gmail_dismiss_pending',
    description: 'Dismiss (delete) a Gmail-imported pending task or package.',
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    preview: (a) => `Dismiss Gmail pending ${a.id}`,
    execute: async ({ id }) => {
      const task = getTask(id)
      if (task) {
        deleteTask(id)
        return {
          result: { id, type: 'task', dismissed: true },
          compensation: async () => { upsertTaskLike(task) },
        }
      }
      const pkg = getPackage(id)
      if (pkg) {
        deletePackage(id)
        return {
          result: { id, type: 'package', dismissed: true },
          compensation: async () => { upsertPackage(pkg) },
        }
      }
      throw new Error(`Pending item not found: ${id}`)
    },
  })
}

// Shim — task compensation for dismiss needs upsert; use the imported one
function upsertTaskLike(task) {
  // Re-insert via updateTaskPartial won't work (record gone). Use upsertTask from db.
  // Deferred import to avoid circular concern during module load.
  import('./db.js').then(mod => mod.upsertTask(task)).catch(() => {})
}

// ============================================================
// Packages
// ============================================================

export function registerPackageTools() {
  registerTool({
    name: 'list_packages',
    description: 'List packages. status filter: active|delivered|all (default active — pending/in_transit/out_for_delivery/exception).',
    readOnly: true,
    schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['active', 'delivered', 'all'] } },
    },
    execute: async (args) => {
      const status = args.status === 'all' ? undefined : (args.status || 'active')
      const pkgs = getAllPackages(status)
      return { result: { count: pkgs.length, packages: pkgs.map(summarizePackage) } }
    },
  })

  registerTool({
    name: 'get_package',
    description: 'Fetch full package details including tracking events history.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    execute: async ({ id }) => {
      const p = getPackage(id)
      if (!p) throw new Error(`Package not found: ${id}`)
      return { result: p }
    },
  })

  registerTool({
    name: 'create_package',
    description: 'Add a package by tracking number. Carrier auto-detected from the number format if not provided.',
    schema: {
      type: 'object',
      properties: {
        tracking_number: { type: 'string' },
        label: { type: 'string' },
        carrier: { type: 'string', enum: ['usps', 'ups', 'fedex', 'amazon', 'dhl', 'ontrac', 'lasership', 'other'] },
      },
      required: ['tracking_number'],
    },
    preview: (a) => `Add package ${a.tracking_number}${a.label ? ` (${a.label})` : ''}`,
    execute: async (args, deps) => {
      ensure(deps.createPackageFn, 'Package handler unavailable')
      const pkg = await deps.createPackageFn({
        tracking_number: args.tracking_number,
        label: args.label || '',
        carrier: args.carrier,
      })
      return {
        result: { id: pkg.id, package: summarizePackage(pkg) },
        compensation: async () => { deletePackage(pkg.id) },
      }
    },
  })

  registerTool({
    name: 'update_package',
    description: 'Update a package\'s label, notes, or notification prefs.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        label: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
    preview: (a) => `Update package ${a.id}`,
    execute: async (args) => {
      const before = getPackage(args.id)
      if (!before) throw new Error(`Package not found: ${args.id}`)
      const updates = {}
      for (const k of ['label', 'notes']) if (args[k] !== undefined) updates[k] = args[k]
      updatePackagePartial(args.id, updates)
      return {
        result: { id: args.id, package: summarizePackage(getPackage(args.id)) },
        compensation: async () => { upsertPackage(before) },
      }
    },
  })

  registerTool({
    name: 'delete_package',
    description: 'Remove a package from tracking.',
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    preview: (a) => `Delete package ${a.id}`,
    execute: async ({ id }) => {
      const before = getPackage(id)
      if (!before) throw new Error(`Package not found: ${id}`)
      deletePackage(id)
      return {
        result: { id, deleted: true },
        compensation: async () => { upsertPackage(before) },
      }
    },
  })

  registerTool({
    name: 'refresh_all_packages',
    description: 'Force-refresh all active packages via 17track. Batched. Respects quota.',
    schema: { type: 'object', properties: {} },
    preview: () => `Refresh all active packages`,
    execute: async (_args, deps) => {
      ensure(deps.refreshAllPackagesFn, 'Package refresh unavailable')
      const result = await deps.refreshAllPackagesFn()
      return {
        result,
        compensation: async () => {
          console.warn('[Adviser] Cannot reverse package refresh — external data updates are informational only.')
        },
      }
    },
  })
}

// ============================================================
// Weather
// ============================================================

export function registerWeatherTools() {
  registerTool({
    name: 'get_weather',
    description: 'Fetch the cached 7-day weather forecast + status.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async (_args, deps) => {
      const cache = deps.getWeatherCache?.()
      const status = deps.getWeatherStatus?.()
      return { result: { ...status, cache } }
    },
  })

  registerTool({
    name: 'refresh_weather',
    description: 'Force-refresh the weather cache from Open-Meteo.',
    schema: {
      type: 'object',
      properties: { force: { type: 'boolean' } },
    },
    preview: () => `Refresh weather cache`,
    execute: async (args, deps) => {
      ensure(deps.refreshWeatherFn, 'Weather refresh unavailable')
      const result = await deps.refreshWeatherFn({ force: !!args.force })
      return {
        result,
        compensation: async () => {
          console.warn('[Adviser] Cannot reverse weather refresh — cache is informational only.')
        },
      }
    },
  })

  registerTool({
    name: 'geocode_location',
    description: 'Look up candidate lat/lon coordinates for a city or zip. Use before update_settings to set weather_latitude/weather_longitude.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    execute: async ({ query }, deps) => {
      ensure(deps.geocodeLocationFn, 'Geocode unavailable')
      const results = await deps.geocodeLocationFn(query)
      return { result: { results } }
    },
  })
}

// ============================================================
// Settings + analytics
// ============================================================

export function registerSettingsTools() {
  registerTool({
    name: 'get_settings',
    description: 'Fetch the user\'s settings blob (preferences, integration flags, notification toggles, weather location, etc.). Sensitive keys (anthropic_api_key, notion_token, trello tokens) are redacted.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async () => {
      const s = getData('settings') || {}
      const redacted = { ...s }
      for (const k of ['anthropic_api_key', 'notion_token', 'trello_api_key', 'trello_secret', 'gcal_client_secret', 'tracking_api_key', 'pushover_user_key', 'pushover_app_token']) {
        if (redacted[k]) redacted[k] = '***redacted***'
      }
      return { result: redacted }
    },
  })

  registerTool({
    name: 'update_settings',
    description: 'Partially update settings (merge, not replace). Refuses to write secret keys (anthropic_api_key, tokens, secrets) — those are env-var or UI-only.',
    schema: {
      type: 'object',
      description: 'Any setting keys to change',
      additionalProperties: true,
    },
    preview: (args) => `Update settings: ${Object.keys(args).join(', ')}`,
    execute: async (args) => {
      const BLOCKED = new Set(['anthropic_api_key', 'notion_token', 'trello_api_key', 'trello_secret', 'gcal_client_secret', 'tracking_api_key', 'pushover_user_key', 'pushover_app_token'])
      const safe = {}
      for (const [k, v] of Object.entries(args)) {
        if (BLOCKED.has(k)) continue
        safe[k] = v
      }
      if (Object.keys(safe).length === 0) throw new Error('No writable settings in payload (secrets are blocked from adviser)')
      const before = getData('settings') || {}
      const merged = { ...before, ...safe }
      setData('settings', merged)
      return {
        result: { updated: Object.keys(safe) },
        compensation: async () => { setData('settings', before) },
      }
    },
  })

  registerTool({
    name: 'get_analytics',
    description: 'Fetch analytics summary: today\'s tasks + points, streak, completion rate, distributions.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async () => {
      const settings = getData('settings') || {}
      return { result: getAnalytics(settings) }
    },
  })

  registerTool({
    name: 'get_analytics_history',
    description: 'Fetch historical daily completion + points data for charting. Default 30 days.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: { days: { type: 'integer', default: 30 } },
    },
    execute: async (args) => {
      return { result: getAnalyticsHistory(args.days || 30) }
    },
  })
}

// ============================================================
// Pattern-suggestion tools (Activity Prompts PR 3)
// ============================================================

export function registerSuggestionTools() {
  registerTool({
    name: 'list_suggestions',
    description: 'List pending routine suggestions detected from completed-task history. These are patterns the user has completed at a regular cadence but not yet routinized. Each suggestion can be accepted (creates a routine), dismissed (hidden permanently), or snoozed (resurfaces after N days).',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async () => {
      const suggestions = listPendingSuggestions()
      return { result: { count: suggestions.length, suggestions } }
    },
  })

  registerTool({
    name: 'dismiss_suggestion',
    description: 'Permanently dismiss a routine suggestion. Future scans will skip this normalized title forever. Use when the user explicitly says "no, I don\'t want this as a routine."',
    schema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    preview: (a) => `Dismiss suggestion #${a.id}`,
    execute: async (args) => {
      const sug = getPatternSuggestion(args.id)
      ensure(sug, `Suggestion ${args.id} not found`)
      const prevStatus = sug.status
      const prevDecidedAt = sug.decided_at
      updateSuggestionStatus(args.id, 'dismissed')
      return {
        result: { dismissed: true, suggestion: sug },
        compensation: async () => updateSuggestionStatus(args.id, prevStatus, prevDecidedAt),
      }
    },
  })

  registerTool({
    name: 'snooze_suggestion',
    description: 'Snooze a routine suggestion so it doesn\'t re-surface for N days (default 14, max 180). The suggestion stays in pending but won\'t appear in scans / notifications until past the snooze. Use when the user says "not now" or "maybe later."',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        days: { type: 'integer', minimum: 1, maximum: 180, default: 14 },
      },
      required: ['id'],
    },
    preview: (a) => `Snooze suggestion #${a.id} for ${a.days || 14}d`,
    execute: async (args) => {
      const sug = getPatternSuggestion(args.id)
      ensure(sug, `Suggestion ${args.id} not found`)
      const prevSnooze = sug.snooze_until
      const days = Math.max(1, Math.min(180, args.days || 14))
      const snoozeUntil = Date.now() + days * 24 * 60 * 60 * 1000
      snoozeSuggestion(args.id, snoozeUntil)
      return {
        result: { snoozed_until: snoozeUntil, days },
        compensation: async () => snoozeSuggestion(args.id, prevSnooze),
      }
    },
  })
}

// ============================================================
// Register all misc tools
// ============================================================

export function registerMiscTools() {
  registerGmailTools()
  registerPackageTools()
  registerWeatherTools()
  registerSettingsTools()
  registerSuggestionTools()
}
