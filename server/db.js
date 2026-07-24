import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { estimateAiCost } from './aiModels.js'

let db
let dbPath

// --- Batched persistence ---
let persistTimer = null
const PERSIST_INTERVAL_MS = 1000

function schedulePersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const data = db.export()
    writeFileSync(dbPath, Buffer.from(data))
  }, PERSIST_INTERVAL_MS)
}

export function flushNow() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  if (db) {
    const data = db.export()
    writeFileSync(dbPath, Buffer.from(data))
  }
}

// --- Migration runner ---
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function runMigrations() {
  // Ensure _migrations table exists (bootstrap)
  db.run(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)`)

  const migDir = path.join(__dirname, '..', 'migrations')
  if (!existsSync(migDir)) return

  const files = readdirSync(migDir)
    .filter(f => f.match(/^\d{3}_.*\.sql$/))
    .sort()

  for (const file of files) {
    const id = parseInt(file.slice(0, 3), 10)
    const check = db.prepare('SELECT id FROM _migrations WHERE id = ?')
    check.bind([id])
    const applied = check.step()
    check.free()
    if (applied) continue

    console.log(`[DB] Running migration ${file}`)
    const sql = readFileSync(path.join(migDir, file), 'utf-8')
    db.run(sql)
    db.run('INSERT INTO _migrations (id) VALUES (?)', [id])
  }
}

// (seedFromJsonBlobs removed 2026-05-08 — was a one-time migration helper that
//  re-populated the SQL tables/routines tables from legacy app_data.tasks /
//  app_data.routines JSON blobs. The blobs hadn't been written to since
//  migrations 002+003 landed months ago. Keeping the helper alive made it a
//  ghost-revive vector: any event that emptied the SQL table would silently
//  restore a months-stale snapshot instead of surfacing the obvious empty
//  state. Migration 022 deletes the legacy rows from app_data.)

// --- Init ---
export async function initDb(filePath) {
  dbPath = filePath

  const dir = path.dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const SQL = await initSqlJs()

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // Legacy table — kept for settings, labels, and _version
  db.run(`
    CREATE TABLE IF NOT EXISTS app_data (
      collection TEXT PRIMARY KEY,
      data_json TEXT NOT NULL
    )
  `)

  runMigrations()

  flushNow()
  return db
}

// ============================================================
// Legacy app_data operations (settings, labels, _version)
// ============================================================

export function getData(collection) {
  const stmt = db.prepare('SELECT data_json FROM app_data WHERE collection = ?')
  stmt.bind([collection])
  if (stmt.step()) {
    const row = stmt.getAsObject()
    stmt.free()
    try {
      return JSON.parse(row.data_json)
    } catch {
      return null
    }
  }
  stmt.free()
  return null
}

export function setData(collection, data) {
  db.run(
    `INSERT INTO app_data (collection, data_json) VALUES (?, ?)
     ON CONFLICT(collection) DO UPDATE SET data_json = excluded.data_json`,
    [collection, JSON.stringify(data)]
  )
  schedulePersist()
}

export function getAllData() {
  const result = {}

  // Read app_data JSON blobs (settings, labels, oauth tokens, vapid keys, etc).
  const stmt = db.prepare('SELECT collection, data_json FROM app_data')
  while (stmt.step()) {
    const row = stmt.getAsObject()
    try {
      result[row.collection] = JSON.parse(row.data_json)
    } catch {
      result[row.collection] = null
    }
  }
  stmt.free()

  // Read tasks, routines, and packages from proper SQL tables
  result.tasks = getAllTasks()
  result.routines = getAllRoutines()
  result.packages = getAllPackages()

  return result
}

export function getVersion() {
  const stmt = db.prepare("SELECT data_json FROM app_data WHERE collection = '_version'")
  let v = 0
  if (stmt.step()) {
    try { v = JSON.parse(stmt.getAsObject().data_json) } catch { /* */ }
  }
  stmt.free()
  return v
}

export function bumpVersion() {
  const v = getVersion() + 1
  db.run(
    `INSERT INTO app_data (collection, data_json) VALUES ('_version', ?)
     ON CONFLICT(collection) DO UPDATE SET data_json = excluded.data_json`,
    [JSON.stringify(v)]
  )
  return v
}

// Bulk write for app_data JSON blobs (settings, labels, etc).
// Tasks, routines, and packages are NOT accepted here — they have proper SQL
// tables with per-record APIs (upsertTask, upsertRoutine, upsertPackage). The
// server-side guard rejects those keys before they reach this function; this
// throw is belt-and-suspenders for any internal caller. Closes the wipe class
// of bug after the 2026-05-07 incident where setAllData({tasks: []}) deleted
// every task whose id was missing from the (empty) incoming array.
export function setAllData(data) {
  for (const [collection, value] of Object.entries(data)) {
    if (collection === '_clientId') continue
    if (collection === 'tasks' || collection === 'routines' || collection === 'packages') {
      throw new Error(`setAllData() does not accept '${collection}' — use the per-record API`)
    }
    db.run(
      `INSERT INTO app_data (collection, data_json) VALUES (?, ?)
       ON CONFLICT(collection) DO UPDATE SET data_json = excluded.data_json`,
      [collection, JSON.stringify(value)]
    )
  }
  const newVersion = bumpVersion()
  schedulePersist()
  return newVersion
}

export function clearAllData() {
  db.run('DELETE FROM app_data')
  db.run('DELETE FROM tasks')
  db.run('DELETE FROM routines')
  db.run('DELETE FROM packages')
  schedulePersist()
}

// ============================================================
// Task row <-> object mapping
// ============================================================

function taskToRow(task) {
  return {
    id: task.id,
    title: task.title || '',
    status: task.status || 'not_started',
    notes: task.notes || '',
    due_date: task.due_date || null,
    snoozed_until: task.snoozed_until || null,
    snooze_count: task.snooze_count || 0,
    staleness_days: task.staleness_days ?? 2,
    last_touched: task.last_touched || new Date().toISOString(),
    created_at: task.created_at || new Date().toISOString(),
    completed_at: task.completed_at || null,
    reframe_notes: task.reframe_notes || null,
    notion_page_id: task.notion_page_id || null,
    notion_url: task.notion_url || null,
    trello_card_id: task.trello_card_id || null,
    trello_card_url: task.trello_card_url || null,
    routine_id: task.routine_id || null,
    high_priority: task.high_priority ? 1 : 0,
    low_priority: task.low_priority ? 1 : 0,
    size: task.size || null,
    energy: task.energy || null,
    energy_level: task.energyLevel ?? task.energy_level ?? null,
    tags_json: JSON.stringify(task.tags || []),
    attachments_json: JSON.stringify(task.attachments || []),
    checklists_json: JSON.stringify(task.checklists || []),
    comments_json: JSON.stringify(task.comments || []),
    toast_messages_json: task.toast_messages ? JSON.stringify(task.toast_messages) : null,
    trello_sync_enabled: task.trello_sync_enabled == null ? null : task.trello_sync_enabled ? 1 : 0,
    gcal_event_id: task.gcal_event_id || null,
    gcal_duration: task.gcal_duration ?? null,
    gmail_message_id: task.gmail_message_id || null,
    gmail_pending: task.gmail_pending ? 1 : 0,
    weather_hidden: task.weather_hidden ? 1 : 0,
    size_inferred: task.size_inferred ? 1 : 0,
    pushover_receipt: task.pushover_receipt || null,
    follow_ups_json: JSON.stringify(task.follow_ups || []),
    skipped: task.skipped ? 1 : 0,
    parent_id: task.parent_id || null,
    pinned_to_today: task.pinned_to_today ? 1 : 0,
    nag_allowed: task.nag_allowed ? 1 : 0,
    session_count: task.session_count || 0,
    last_session_at: task.last_session_at || null,
    session_log_json: JSON.stringify(task.session_log || []),
    child_visibility: task.child_visibility || 'backstage',
    snooze_indefinite: task.snooze_indefinite ? 1 : 0,
    blocked_by_json: JSON.stringify(task.blocked_by || []),
    knowledge_page_ids_json: JSON.stringify(task.knowledge_page_ids || []),
    waiting_at: task.waiting_at || null,
    stack_bonus: task.stack_bonus ?? null,
    assignee: task.assignee || null,
    escalation_rungs_json: JSON.stringify(task.escalation_rungs || []),
    escalation_current_rung: task.escalation_current_rung ?? null,
    escalation_attempt_log_json: JSON.stringify(task.escalation_attempt_log || []),
    escalation_awaiting_advance: task.escalation_awaiting_advance ? 1 : 0,
    escalation_stuck: task.escalation_stuck ? 1 : 0,
    crisis_since: task.crisis_since || null,
    crisis_triage_done: task.crisis_triage_done ? 1 : 0,
    impact: task.impact ?? null,
    impact_inferred: task.impact_inferred ? 1 : 0,
    diy_assessed: task.diy_assessed ? 1 : 0,
    diy_verdict: task.diy_verdict || null,
    diy_reason: task.diy_reason || null,
    diy_first_move: task.diy_first_move || null,
    capture_source: task.capture_source || null,
    intention_when: task.intention_when || null,
    intention_where: task.intention_where || null,
    first_step: task.first_step || null,
    location_json: task.location ? JSON.stringify(task.location) : null,
    committed_on: task.committed_on || null,
    boomerang_count: task.boomerang_count || 0,
    last_boomeranged_at: task.last_boomeranged_at || null,
    released_at: task.released_at || null,
  }
}

function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    notes: row.notes || '',
    due_date: row.due_date || null,
    snoozed_until: row.snoozed_until || null,
    snooze_count: row.snooze_count || 0,
    staleness_days: row.staleness_days ?? 2,
    last_touched: row.last_touched,
    created_at: row.created_at,
    completed_at: row.completed_at || null,
    reframe_notes: row.reframe_notes || null,
    notion_page_id: row.notion_page_id || null,
    notion_url: row.notion_url || null,
    trello_card_id: row.trello_card_id || null,
    trello_card_url: row.trello_card_url || null,
    routine_id: row.routine_id || null,
    high_priority: !!row.high_priority,
    low_priority: !!row.low_priority,
    size: row.size || null,
    energy: row.energy || null,
    energyLevel: row.energy_level ?? null,
    tags: safeJsonParse(row.tags_json, []),
    attachments: safeJsonParse(row.attachments_json, []),
    checklists: safeJsonParse(row.checklists_json, []),
    comments: safeJsonParse(row.comments_json, []),
    toast_messages: safeJsonParse(row.toast_messages_json, null),
    trello_sync_enabled: row.trello_sync_enabled == null ? undefined : !!row.trello_sync_enabled,
    gcal_event_id: row.gcal_event_id || null,
    gcal_duration: row.gcal_duration ?? null,
    gmail_message_id: row.gmail_message_id || null,
    gmail_pending: !!row.gmail_pending,
    weather_hidden: !!row.weather_hidden,
    size_inferred: !!row.size_inferred,
    pushover_receipt: row.pushover_receipt || null,
    follow_ups: safeJsonParse(row.follow_ups_json, []),
    skipped: !!row.skipped,
    parent_id: row.parent_id || null,
    pinned_to_today: !!row.pinned_to_today,
    nag_allowed: !!row.nag_allowed,
    session_count: row.session_count || 0,
    last_session_at: row.last_session_at || null,
    session_log: safeJsonParse(row.session_log_json, []),
    child_visibility: row.child_visibility || 'backstage',
    snooze_indefinite: !!row.snooze_indefinite,
    blocked_by: safeJsonParse(row.blocked_by_json, []),
    knowledge_page_ids: safeJsonParse(row.knowledge_page_ids_json, []),
    waiting_at: row.waiting_at || null,
    stack_bonus: row.stack_bonus ?? null,
    assignee: row.assignee || null,
    escalation_rungs: safeJsonParse(row.escalation_rungs_json, []),
    escalation_current_rung: row.escalation_current_rung ?? null,
    escalation_attempt_log: safeJsonParse(row.escalation_attempt_log_json, []),
    escalation_awaiting_advance: !!row.escalation_awaiting_advance,
    escalation_stuck: !!row.escalation_stuck,
    crisis_since: row.crisis_since || null,
    crisis_triage_done: !!row.crisis_triage_done,
    impact: row.impact ?? null,
    impact_inferred: !!row.impact_inferred,
    diy_assessed: !!row.diy_assessed,
    diy_verdict: row.diy_verdict || null,
    diy_reason: row.diy_reason || null,
    diy_first_move: row.diy_first_move || null,
    capture_source: row.capture_source || null,
    intention_when: row.intention_when || null,
    intention_where: row.intention_where || null,
    first_step: row.first_step || null,
    location: safeJsonParse(row.location_json, null),
    committed_on: row.committed_on || null,
    boomerang_count: row.boomerang_count || 0,
    last_boomeranged_at: row.last_boomeranged_at || null,
    released_at: row.released_at || null,
  }
}

function safeJsonParse(str, fallback) {
  if (!str) return fallback
  try { return JSON.parse(str) } catch { return fallback }
}

// ============================================================
// Task CRUD operations
// ============================================================

// checklist_json column is kept in the schema (migration 018 emptied it; SQLite
// column drops are painful) but is no longer written or read. It will retain its
// existing '[]' value via the schema default for any rows touched here.
const UPSERT_TASK_SQL = `
  INSERT INTO tasks (id, title, status, notes, due_date, snoozed_until, snooze_count,
    staleness_days, last_touched, created_at, completed_at, reframe_notes,
    notion_page_id, notion_url, trello_card_id, trello_card_url, routine_id,
    high_priority, low_priority, size, energy, energy_level, tags_json, attachments_json,
    checklists_json, comments_json, toast_messages_json, trello_sync_enabled,
    gcal_event_id, gcal_duration, gmail_message_id, gmail_pending, weather_hidden, size_inferred,
    pushover_receipt, follow_ups_json, skipped,
    parent_id, pinned_to_today, nag_allowed, session_count, last_session_at,
    session_log_json, child_visibility, snooze_indefinite, blocked_by_json,
    knowledge_page_ids_json, stack_bonus, assignee,
    escalation_rungs_json, escalation_current_rung, escalation_attempt_log_json,
    escalation_awaiting_advance, escalation_stuck,
    crisis_since, crisis_triage_done, impact, impact_inferred,
    diy_assessed, diy_verdict, diy_reason, diy_first_move, capture_source,
    intention_when, intention_where, first_step, location_json,
    committed_on, boomerang_count, last_boomeranged_at, released_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, status=excluded.status, notes=excluded.notes,
    due_date=excluded.due_date, snoozed_until=excluded.snoozed_until,
    snooze_count=excluded.snooze_count, staleness_days=excluded.staleness_days,
    last_touched=excluded.last_touched, created_at=excluded.created_at,
    completed_at=excluded.completed_at, reframe_notes=excluded.reframe_notes,
    notion_page_id=excluded.notion_page_id, notion_url=excluded.notion_url,
    trello_card_id=excluded.trello_card_id, trello_card_url=excluded.trello_card_url,
    routine_id=excluded.routine_id, high_priority=excluded.high_priority,
    low_priority=excluded.low_priority,
    size=excluded.size, energy=excluded.energy, energy_level=excluded.energy_level,
    tags_json=excluded.tags_json, attachments_json=excluded.attachments_json,
    checklists_json=excluded.checklists_json,
    comments_json=excluded.comments_json, toast_messages_json=excluded.toast_messages_json,
    trello_sync_enabled=excluded.trello_sync_enabled,
    gcal_event_id=excluded.gcal_event_id, gcal_duration=excluded.gcal_duration,
    gmail_message_id=excluded.gmail_message_id, gmail_pending=excluded.gmail_pending,
    weather_hidden=excluded.weather_hidden, size_inferred=excluded.size_inferred,
    pushover_receipt=excluded.pushover_receipt,
    follow_ups_json=excluded.follow_ups_json,
    skipped=excluded.skipped,
    parent_id=excluded.parent_id, pinned_to_today=excluded.pinned_to_today,
    nag_allowed=excluded.nag_allowed, session_count=excluded.session_count,
    last_session_at=excluded.last_session_at, session_log_json=excluded.session_log_json,
    child_visibility=excluded.child_visibility, snooze_indefinite=excluded.snooze_indefinite,
    blocked_by_json=excluded.blocked_by_json,
    knowledge_page_ids_json=excluded.knowledge_page_ids_json,
    stack_bonus=excluded.stack_bonus,
    assignee=excluded.assignee,
    escalation_rungs_json=excluded.escalation_rungs_json,
    escalation_current_rung=excluded.escalation_current_rung,
    escalation_attempt_log_json=excluded.escalation_attempt_log_json,
    escalation_awaiting_advance=excluded.escalation_awaiting_advance,
    escalation_stuck=excluded.escalation_stuck,
    crisis_since=excluded.crisis_since,
    crisis_triage_done=excluded.crisis_triage_done,
    impact=excluded.impact,
    impact_inferred=excluded.impact_inferred,
    diy_assessed=excluded.diy_assessed,
    diy_verdict=excluded.diy_verdict,
    diy_reason=excluded.diy_reason,
    diy_first_move=excluded.diy_first_move,
    capture_source=excluded.capture_source,
    intention_when=excluded.intention_when,
    intention_where=excluded.intention_where,
    first_step=excluded.first_step,
    location_json=excluded.location_json,
    committed_on=excluded.committed_on,
    boomerang_count=excluded.boomerang_count,
    last_boomeranged_at=excluded.last_boomeranged_at,
    released_at=excluded.released_at`

function runUpsertTask(task) {
  const r = taskToRow(task)
  db.run(UPSERT_TASK_SQL, [
    r.id, r.title, r.status, r.notes, r.due_date, r.snoozed_until, r.snooze_count,
    r.staleness_days, r.last_touched, r.created_at, r.completed_at, r.reframe_notes,
    r.notion_page_id, r.notion_url, r.trello_card_id, r.trello_card_url, r.routine_id,
    r.high_priority, r.low_priority, r.size, r.energy, r.energy_level, r.tags_json, r.attachments_json,
    r.checklists_json, r.comments_json, r.toast_messages_json,
    r.trello_sync_enabled, r.gcal_event_id, r.gcal_duration,
    r.gmail_message_id, r.gmail_pending, r.weather_hidden, r.size_inferred,
    r.pushover_receipt, r.follow_ups_json, r.skipped,
    r.parent_id, r.pinned_to_today, r.nag_allowed, r.session_count, r.last_session_at,
    r.session_log_json, r.child_visibility, r.snooze_indefinite, r.blocked_by_json,
    r.knowledge_page_ids_json, r.stack_bonus, r.assignee,
    r.escalation_rungs_json, r.escalation_current_rung, r.escalation_attempt_log_json,
    r.escalation_awaiting_advance, r.escalation_stuck,
    r.crisis_since, r.crisis_triage_done, r.impact, r.impact_inferred,
    r.diy_assessed, r.diy_verdict, r.diy_reason, r.diy_first_move,
    r.capture_source,
    r.intention_when, r.intention_where, r.first_step, r.location_json,
    r.committed_on, r.boomerang_count, r.last_boomeranged_at, r.released_at,
  ])
}

// Stamp/clear the crisis-since timestamp as the crisis label transitions on
// or off a task. Lives here (not in a route handler) so every write path is
// covered — per-record create/update, bulk sync, and Quokka mutations all
// funnel through upsertTask. Mutates the task object in place before the row
// write. Never throws — a settings hiccup must not block a task write.
function applyCrisisTransition(task) {
  try {
    const settings = getData('settings') || {}
    const inCrisis = isCrisisTask(task, settings)
    if (inCrisis && !task.crisis_since) {
      task.crisis_since = new Date().toISOString()
    } else if (!inCrisis && task.crisis_since) {
      // Crisis over (label removed): clear the clock and reset the triage
      // flag so a re-declared crisis gets a fresh triage pass.
      task.crisis_since = null
      task.crisis_triage_done = false
    }
  } catch { /* never block a write */ }
}

export function upsertTask(task) {
  applyCrisisTransition(task)
  runUpsertTask(task)
  schedulePersist()
}

export function updateTaskPartial(id, updates) {
  // Fetch existing, merge, upsert
  const existing = getTask(id)
  if (!existing) return null
  const merged = { ...existing, ...updates }

  // Cancel any outstanding Pushover Emergency receipt when the user resolves
  // the task. Skip when the update is *setting* the receipt itself (dispatcher
  // write) or already explicitly clearing it.
  const isReceiptWrite = Object.prototype.hasOwnProperty.call(updates, 'pushover_receipt')
  const isResolution = isResolutionUpdate(existing, updates)
  if (existing.pushover_receipt && !isReceiptWrite && isResolution) {
    triggerEmergencyCancel(id, existing.pushover_receipt)
    merged.pushover_receipt = null
  }

  // Stamp recent notifications as converted when the task transitions to
  // done/completed — drives the engagement analytics conversion-rate metric.
  if (
    updates.status && updates.status !== existing.status &&
    ['done', 'completed'].includes(updates.status)
  ) {
    stampCompletionForRecentNotifs(id)
  }

  upsertTask(merged)

  // Sequence chain-spawn. If the task transitioned into done/completed AND has
  // a non-empty follow_ups chain, spawn the next step. The new task gets the
  // remaining chain (slice(1)) so each subsequent completion walks forward by
  // one step. routine_id is inherited so the chain stays grouped with its
  // source routine for completed_history + activity log.
  if (
    updates.status && updates.status !== existing.status &&
    ['done', 'completed'].includes(updates.status) &&
    Array.isArray(merged.follow_ups) && merged.follow_ups.length > 0
  ) {
    spawnNextChainStep(merged)
  }

  return getTask(id)
}

// Spawn the next step in a follow-ups chain. Sub-day offsets snooze the new
// task until its trigger time so it doesn't surface until then; ≥1-day offsets
// land on the future date directly. Auto energy/title fall back to step
// descriptor; missing energy gets re-inferred by the background sizer hook.
function spawnNextChainStep(parentTask) {
  const [step, ...remaining] = parentTask.follow_ups
  if (!step?.title) return
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  let dueDate, snoozeUntil
  if (step.at_time) {
    // Absolute clock-time step: schedule at this 'HH:MM' on today (or the
    // next day when at_next_day is set — e.g. "empty dishwasher at 6am next
    // morning"). Snooze until that instant unless it's already past, in which
    // case the task surfaces immediately. Computed in server-local time; see
    // the TZ note on routine trigger snooze in src/hooks/useRoutines.js.
    const [hh, mm] = String(step.at_time).split(':').map(Number)
    const at = new Date()
    if (step.at_next_day) at.setDate(at.getDate() + 1)
    at.setHours(hh || 0, mm || 0, 0, 0)
    dueDate = ymd(at)
    snoozeUntil = at.getTime() > Date.now() ? at.toISOString() : null
  } else {
    const offsetMs = Math.max(0, (step.offset_minutes || 0) * 60000)
    const triggerAt = Date.now() + offsetMs
    const triggerDate = new Date(triggerAt)
    const todayUTC = new Date(); todayUTC.setHours(0, 0, 0, 0)
    const sameDay = offsetMs < 24 * 60 * 60 * 1000
      && triggerDate.toDateString() === todayUTC.toDateString()
    dueDate = sameDay ? ymd(todayUTC) : ymd(triggerDate)
    snoozeUntil = offsetMs > 0 && sameDay ? new Date(triggerAt).toISOString() : null
  }

  const newTask = {
    id: crypto.randomUUID(),
    title: step.title,
    status: 'not_started',
    notes: step.notes || '',
    due_date: dueDate,
    snoozed_until: snoozeUntil,
    snooze_count: 0,
    staleness_days: 2,
    last_touched: new Date().toISOString(),
    created_at: new Date().toISOString(),
    routine_id: parentTask.routine_id || null,
    high_priority: false,
    low_priority: false,
    energy: step.energy_type || null,
    energyLevel: step.energy_level ?? null,
    size: step.energy_type ? 'M' : null,
    size_inferred: false,
    tags: [],
    attachments: [],
    checklists: [],
    comments: [],
    follow_ups: remaining,
  }
  upsertTask(newTask)
}

// Sequences PR 3: skip-and-advance. User wants to abandon this step but
// keep the chain walking — useful for the "I forgot to clean the mop, but
// the dirty-tank-empty step still needs to happen" case. Marks the task
// cancelled+skipped (so it stops appearing in active lists, distinguishable
// from a true cancellation in DoneList / activity log) and runs
// spawnNextChainStep regardless of the current status. Returns the new
// task that was spawned (or null if there was nothing to advance to).
export function skipAndAdvanceTask(id) {
  const existing = getTask(id)
  if (!existing) return null
  const merged = {
    ...existing,
    status: 'cancelled',
    skipped: true,
    completed_at: new Date().toISOString(),
    last_touched: new Date().toISOString(),
  }
  upsertTask(merged)
  if (Array.isArray(merged.follow_ups) && merged.follow_ups.length > 0) {
    spawnNextChainStep(merged)
  }
  return getTask(id)
}

// True when `updates` represents a user-driven resolution of the task.
function isResolutionUpdate(existing, updates) {
  if (updates.status && updates.status !== existing.status) {
    if (['done', 'completed', 'cancelled', 'project', 'backlog'].includes(updates.status)) return true
  }
  if (updates.completed_at && !existing.completed_at) return true
  // Removing the crisis label counts as a resolution — if a crisis-driven
  // Pushover Emergency is still ringing, un-crisising the task should stop
  // the alarm just like completing it would.
  if (Array.isArray(updates.tags)) {
    try {
      const settings = getData('settings') || {}
      if (isCrisisTask(existing, settings) && !isCrisisTask({ ...existing, tags: updates.tags }, settings)) return true
    } catch { /* settings hiccup — skip the check */ }
  }
  if (updates.snoozed_until) {
    const newSnooze = new Date(updates.snoozed_until).getTime()
    if (newSnooze > Date.now()) return true
  }
  if (updates.due_date && updates.due_date !== existing.due_date) {
    // Moved due date forward beyond today
    const newDue = new Date(updates.due_date + 'T00:00:00').getTime()
    if (newDue > Date.now()) return true
  }
  if (updates.reframe_notes && !existing.reframe_notes) return true
  return false
}

function triggerEmergencyCancel(taskId, receipt) {
  // Fire-and-forget. Lazy-import to avoid circular dep at module load.
  import('./pushoverNotifications.js').then(mod => {
    const settings = getData('settings') || {}
    const appToken = settings.pushover_app_token || process.env.PUSHOVER_DEFAULT_APP_TOKEN
    if (!appToken) return
    mod.cancelEmergencyReceipt(appToken, receipt).catch(() => {})
  }).catch(() => {})
}

// Duplicate-spawn guard (2026-07-17). Routine spawning is client-side
// (spawnDueTasks in useRoutines.js) and its "already has an instance" check
// only sees that client's own hydrated state — two clients opening inside
// the same sync window (phone + desktop in the morning) each spawn the same
// cycle, and per-record POST /api/tasks inserted both blindly. The server is
// the only serialization point, so the create route asks here before
// inserting: an incoming NEW task carrying a routine_id is a duplicate when
// an ACTIVE twin — same (routine_id, due_date, title), non-terminal status —
// already exists. Title is part of the key so stack members (which share
// routine_id + due_date but differ by title) never collide. Done/cancelled
// twins do NOT block: a manual "Spawn now" after completing today's instance
// is a legitimate second task. Returns the twin's id, or null.
// 2026-07-17 v2 (prod: "still seeing a shit ton of duplicates"): the v1 key
// included due_date, but a STALE client (offline since yesterday, old
// completed_history) computes an older next-due for the same cycle — the
// copies differ on due_date and both got through. The client-side legacy
// rule has always been "any non-done instance blocks a spawn", so the
// server now mirrors it: for a NON-STACK routine, ANY active task with the
// same (routine_id, title) blocks, regardless of due date. Title stays in
// the key so follow-up chain steps (which inherit routine_id but have
// their own titles) never collide with the parent cycle. STACK routines
// keep due_date in the key — a daily stack legitimately spawns today's
// member while yesterday's identical-title member lingers overdue.
function isStackRoutine(routineId) {
  try {
    const r = getRoutine(routineId)
    return Array.isArray(r?.members) && r.members.length > 0
  } catch { return false }
}

export function findActiveSpawnTwin(task) {
  if (!task?.routine_id || !task.title) return null
  const stack = isStackRoutine(task.routine_id)
  if (stack && !task.due_date) return null
  const stmt = db.prepare(
    `SELECT id FROM tasks
     WHERE routine_id = ? AND title = ? AND id != ?
       ${stack ? 'AND due_date = ?' : ''}
       AND status NOT IN ('done', 'completed', 'cancelled')
     LIMIT 1`,
  )
  stmt.bind(stack
    ? [task.routine_id, task.title, task.id || '', task.due_date]
    : [task.routine_id, task.title, task.id || ''])
  const twinId = stmt.step() ? stmt.getAsObject().id : null
  stmt.free()
  return twinId
}

// One-shot cleanup for duplicates that predate (or slipped past) the guard.
// Groups ACTIVE routine-spawned tasks by the same key the guard uses and
// deletes all but one per group. Survivor preference: a copy the user has
// touched (status beyond not_started) over an untouched one, then the
// OLDEST created_at (the original; later copies are the race artifacts).
// Runs at server boot + exposed via POST /api/tasks/dedupe-spawns.
export function dedupeSpawnedTasks({ dryRun = false } = {}) {
  const active = getAllTasks().filter(t =>
    t.routine_id && t.title &&
    !['done', 'completed', 'cancelled'].includes(t.status))
  const groups = new Map()
  for (const t of active) {
    const stack = isStackRoutine(t.routine_id)
    const key = stack
      ? `s|${t.routine_id}|${t.due_date || ''}|${t.title}`
      : `r|${t.routine_id}|${t.title}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  const removed = []
  for (const [key, tasks] of groups) {
    if (tasks.length < 2) continue
    const score = (t) => (t.status !== 'not_started' ? 2 : 0) + ((t.checklists?.length || t.notes) ? 1 : 0)
    const sorted = [...tasks].sort((a, b) =>
      score(b) - score(a) || new Date(a.created_at) - new Date(b.created_at))
    for (const extra of sorted.slice(1)) {
      removed.push({ id: extra.id, title: extra.title, due_date: extra.due_date, key })
      if (!dryRun) deleteTask(extra.id)
    }
  }
  if (removed.length > 0) {
    console.log(`[spawn-dedupe] ${dryRun ? 'would remove' : 'removed'} ${removed.length} duplicate spawn(s):`,
      removed.map(r => `"${r.title}" (${r.due_date || 'no due'})`).join(', '))
  }
  return { removed: removed.length, details: removed, dryRun }
}

export function getTask(id) {
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?')
  stmt.bind([id])
  if (stmt.step()) {
    const row = stmt.getAsObject()
    stmt.free()
    return rowToTask(row)
  }
  stmt.free()
  return null
}

export function getAllTasks() {
  const results = []
  const stmt = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC')
  while (stmt.step()) {
    results.push(rowToTask(stmt.getAsObject()))
  }
  stmt.free()
  return results
}

// Deleting a task destroys the evidence that its completion day "counted"
// toward the streak — the 2026-06-10 incident: dismissing an old import
// removed the only completion on May 14 and retroactively cut a 36-day
// rally to 27. Stamp the day into settings.completion_days (a compact,
// append-only 'YYYY-MM-DD' list) before the row dies so computeStreak can
// still credit it. Days are bucketed in the USER's timezone (computeStreak
// buckets locally on the client); fall back to server-local if the setting
// is absent or invalid. See Derived-Stat Durability Rules in CLAUDE.md.
function ymdInUserTimezone(iso, timeZone) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' }
  try {
    return new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: timeZone || undefined }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-CA', opts).format(d)
  }
}

function stampCompletionProvenance(task) {
  const ts = task.status === 'done' ? task.completed_at
    : task.status === 'waiting' ? task.waiting_at
    : null
  if (!ts) return
  const settings = getData('settings') || {}
  const day = ymdInUserTimezone(ts, settings.user_timezone)
  if (!day) return
  const days = Array.isArray(settings.completion_days) ? settings.completion_days : []
  if (days.includes(day)) return
  setData('settings', { ...settings, completion_days: [...days, day].sort() })
}

export function deleteTask(id) {
  // Cancel any outstanding Pushover Emergency receipt before removing the task.
  const existing = getTask(id)
  if (existing && existing.pushover_receipt) {
    triggerEmergencyCancel(id, existing.pushover_receipt)
  }
  if (existing) stampCompletionProvenance(existing)
  db.run('DELETE FROM tasks WHERE id = ?', [id])
  schedulePersist()
}

// Merge a duplicate task into a survivor: fold in the duplicate's content
// (notes under a provenance divider, tags/attachments/comments unioned,
// checklists appended unless every item already exists verbatim), keep the
// earliest due date, OR the opt-in flags, adopt any external links or
// enrichment the survivor lacks, then delete the duplicate through the
// normal evidence-preserving path (completion-day provenance + Pushover
// receipt cancellation). Returns { survivor, duplicate } — duplicate is the
// full pre-delete record so callers (Quokka rollback, GCal cleanup) can act
// on it.
export function mergeTasks(survivorId, duplicateId) {
  if (survivorId === duplicateId) throw new Error('Cannot merge a task into itself')
  const survivor = getTask(survivorId)
  const dupe = getTask(duplicateId)
  if (!survivor) throw new Error(`Task not found: ${survivorId}`)
  if (!dupe) throw new Error(`Task not found: ${duplicateId}`)

  const now = new Date().toISOString()

  let notes = (survivor.notes || '').trim()
  if ((dupe.notes || '').trim()) {
    notes = [notes, `— merged from "${dupe.title}" (${now.slice(0, 10)}) —`, dupe.notes.trim()]
      .filter(Boolean).join('\n\n')
  }

  const survivorItems = new Set(
    (survivor.checklists || []).flatMap(c => (c.items || []).map(i => (i.text || '').trim().toLowerCase())),
  )
  const extraChecklists = (dupe.checklists || []).filter(c =>
    (c.items || []).some(i => !survivorItems.has((i.text || '').trim().toLowerCase())),
  )

  const pickEarlier = (a, b) => {
    if (!a) return b || null
    if (!b) return a
    return a <= b ? a : b
  }

  const updates = {
    notes,
    tags: [...new Set([...(survivor.tags || []), ...(dupe.tags || [])])],
    checklists: [...(survivor.checklists || []), ...extraChecklists],
    attachments: [...(survivor.attachments || []), ...(dupe.attachments || [])],
    comments: [...(survivor.comments || []), ...(dupe.comments || [])],
    due_date: pickEarlier(survivor.due_date, dupe.due_date),
    high_priority: !!(survivor.high_priority || dupe.high_priority),
    nag_allowed: !!(survivor.nag_allowed || dupe.nag_allowed),
    updated_at: now,
    last_touched: now,
  }

  // Adopt-if-missing scalars: external links + enrichment the survivor lacks.
  const ADOPT = ['notion_page_id', 'notion_url', 'trello_card_id', 'trello_card_url',
    'gcal_event_id', 'gcal_duration', 'gmail_message_id', 'routine_id',
    'energy', 'energy_level', 'size', 'impact', 'assignee']
  for (const k of ADOPT) {
    if ((survivor[k] == null || survivor[k] === '') && dupe[k] != null && dupe[k] !== '') {
      updates[k] = dupe[k]
    }
  }

  // Whole-group adoptions — never interleave two ladders/chains.
  if (!(survivor.follow_ups || []).length && (dupe.follow_ups || []).length) {
    updates.follow_ups = dupe.follow_ups
  }
  if (!(survivor.escalation_rungs || []).length && (dupe.escalation_rungs || []).length) {
    updates.escalation_rungs = dupe.escalation_rungs
    updates.escalation_current_rung = dupe.escalation_current_rung
    updates.escalation_attempt_log = dupe.escalation_attempt_log
    updates.escalation_awaiting_advance = dupe.escalation_awaiting_advance
    updates.escalation_stuck = dupe.escalation_stuck
  }
  const kIds = [...new Set([...(survivor.knowledge_page_ids || []), ...(dupe.knowledge_page_ids || [])])]
  if (kIds.length) updates.knowledge_page_ids = kIds

  updateTaskPartial(survivorId, updates)
  deleteTask(duplicateId)
  return { survivor: getTask(survivorId), duplicate: dupe }
}

export function queryTasks(filters = {}) {
  const clauses = []
  const params = []

  if (filters.status) {
    const statuses = filters.status.split(',').map(s => s.trim())
    clauses.push(`status IN (${statuses.map(() => '?').join(',')})`)
    params.push(...statuses)
  }
  if (filters.energy) {
    clauses.push('energy = ?')
    params.push(filters.energy)
  }
  if (filters.completed_after) {
    clauses.push('completed_at >= ?')
    params.push(filters.completed_after)
  }
  if (filters.routine_id) {
    clauses.push('routine_id = ?')
    params.push(filters.routine_id)
  }
  if (filters.high_priority) {
    clauses.push('high_priority = 1')
  }
  if (filters.tag) {
    clauses.push(`tags_json LIKE ?`)
    params.push(`%"${filters.tag}"%`)
  }
  if (filters.size) {
    clauses.push('size = ?')
    params.push(filters.size)
  }
  if (filters.q) {
    clauses.push(`(title LIKE ? OR notes LIKE ?)`)
    const term = `%${filters.q}%`
    params.push(term, term)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

  // Sort
  const sortMap = {
    due_date: 'due_date ASC',
    created_at: 'created_at DESC',
    size: 'size DESC',
    title: 'title ASC',
    completed_at: 'completed_at DESC',
  }
  const order = sortMap[filters.sort] || 'created_at DESC'

  // Pagination
  let limitClause = ''
  if (filters.limit) {
    limitClause = ` LIMIT ${parseInt(filters.limit, 10)}`
    if (filters.offset) {
      limitClause += ` OFFSET ${parseInt(filters.offset, 10)}`
    }
  }

  const sql = `SELECT * FROM tasks ${where} ORDER BY ${order}${limitClause}`
  const results = []
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params)
  while (stmt.step()) {
    results.push(rowToTask(stmt.getAsObject()))
  }
  stmt.free()
  return results
}

// ============================================================
// Project helpers — child queries, budget/session math
// ============================================================

// Session model: each "I worked on this" log awards SESSION_PCT of the
// project's effort budget, capped at SESSION_CAP sessions total. After cap,
// the user has to either complete a child task or the project itself to
// keep earning credit. The cap exists to prevent gaming — without it you
// could log infinite sessions and never finish anything.
const SESSION_PCT = 0.10
const SESSION_CAP = 10
const DEFAULT_PROJECT_BUDGET = 20

export function getChildTasks(parentId) {
  if (!parentId) return []
  const stmt = db.prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at ASC')
  stmt.bind([parentId])
  const out = []
  while (stmt.step()) out.push(rowToTask(stmt.getAsObject()))
  stmt.free()
  return out
}

// Effort budget for a project. Sum of all children's base (size × energy_level)
// points, with the project's own base as a floor and DEFAULT_PROJECT_BUDGET
// as a final fallback. No speed multiplier — sessions don't get the
// same-day bonus that completions do. Budget grows as children are added,
// which lets a project that started small accrue more session credit if it
// turns out to be bigger than anticipated.
export function computeProjectBudget(project) {
  if (!project) return DEFAULT_PROJECT_BUDGET
  const SIZE = { XS: 1, S: 2, M: 5, L: 10, XL: 20 }
  const ENERGY = { 1: 1.0, 2: 1.5, 3: 2.0 }
  const basePts = (t) => (SIZE[t.size] || SIZE.M) * (ENERGY[t.energyLevel ?? t.energy_level] || 1.0)
  const own = basePts(project)
  const children = getChildTasks(project.id)
  const childSum = children.reduce((sum, c) => sum + basePts(c), 0)
  return Math.max(own, childSum, DEFAULT_PROJECT_BUDGET)
}

// Per-session credit. Floors at 1 so a tiny project still rewards a tap.
export function computeSessionPoints(project) {
  const budget = computeProjectBudget(project)
  return Math.max(1, Math.round(budget * SESSION_PCT))
}

// Log a "worked on this" session for a project. Returns the new session
// entry and updated counts so callers can surface a toast / update local
// state without re-fetching. Refuses past the cap.
export function logProjectSession(projectId) {
  const project = getTask(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  if (project.status !== 'project') throw new Error('logProjectSession requires a project task')
  if ((project.session_count || 0) >= SESSION_CAP) {
    return { capped: true, sessionCount: project.session_count, sessionCap: SESSION_CAP }
  }
  const points = computeSessionPoints(project)
  const now = new Date().toISOString()
  const log = Array.isArray(project.session_log) ? [...project.session_log] : []
  log.push({ timestamp: now, points })
  updateTaskPartial(projectId, {
    session_count: (project.session_count || 0) + 1,
    last_session_at: now,
    session_log: log,
  })
  return {
    capped: false,
    points,
    sessionCount: (project.session_count || 0) + 1,
    sessionCap: SESSION_CAP,
    timestamp: now,
  }
}

export const PROJECT_CONSTANTS = { SESSION_PCT, SESSION_CAP, DEFAULT_PROJECT_BUDGET }

// ============================================================
// Escalation Ladder — repeated-contact-attempt tracking on a single task.
// See wiki/Escalation-Ladder.md. Distinct from Sequences (follow_ups):
// this fires the next rung on ATTEMPT-THRESHOLD, not on completion.
// ============================================================

// Set/replace the rung list. `append: true` adds to the existing list
// (used by the Brainstorm-stages-new-rungs flow) instead of replacing it —
// and un-sticks the ladder, since there's now somewhere further to go.
export function setEscalationLadder(taskId, rungs, { append = false } = {}) {
  const task = getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  const incoming = Array.isArray(rungs) ? rungs : []
  const nextRungs = append ? [...(task.escalation_rungs || []), ...incoming] : incoming
  const wasInactive = task.escalation_current_rung == null
  const updates = { escalation_rungs: nextRungs }
  // Starting a ladder for the first time (or restarting a resolved one)
  // begins at rung 0. Appending onto an in-progress ladder just extends it.
  if (nextRungs.length > 0 && (wasInactive || !append)) {
    updates.escalation_current_rung = 0
    updates.escalation_awaiting_advance = false
  }
  if (append && task.escalation_stuck) updates.escalation_stuck = false
  updateTaskPartial(taskId, updates)
  return getTask(taskId)
}

// Log one contact attempt at the current rung. Awards 1 point (attempts are
// real effort, same "waiting = progress" principle as elsewhere in the app).
// Flips escalation_awaiting_advance (or escalation_stuck, on the last rung)
// once the rung's attempts_before_ready threshold is met — the app OFFERS
// to move on, it never advances silently.
export function logEscalationAttempt(taskId, note) {
  const task = getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  const rungs = task.escalation_rungs || []
  const currentIdx = task.escalation_current_rung
  if (currentIdx == null || !rungs[currentIdx]) throw new Error('No active escalation ladder on this task')
  const now = new Date().toISOString()
  const log = [...(task.escalation_attempt_log || []), {
    id: `esc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    at: now,
    rung_index: currentIdx,
    points: 1,
    note: note || undefined,
  }]
  const rung = rungs[currentIdx]
  const attemptsAtRung = log.filter(e => e.rung_index === currentIdx).length
  const isLastRung = currentIdx >= rungs.length - 1
  const thresholdMet = rung.attempts_before_ready != null && attemptsAtRung >= rung.attempts_before_ready
  const updates = { escalation_attempt_log: log }
  if (thresholdMet) {
    if (isLastRung) updates.escalation_stuck = true
    else updates.escalation_awaiting_advance = true
  }
  updateTaskPartial(taskId, updates)
  return { task: getTask(taskId), attemptsAtRung, thresholdMet }
}

// Manual "Move on" — also used to accept a prompted-advance ("Move on"
// button on the awaiting-advance nudge). Advances to the next rung; if
// there is no next rung, there's nowhere scripted left to go, so it flips
// escalation_stuck instead of advancing out of bounds.
export function advanceEscalationRung(taskId) {
  const task = getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  const rungs = task.escalation_rungs || []
  const currentIdx = task.escalation_current_rung
  if (currentIdx == null) throw new Error('No active escalation ladder on this task')
  const nextIdx = currentIdx + 1
  const updates = { escalation_awaiting_advance: false }
  if (nextIdx < rungs.length) updates.escalation_current_rung = nextIdx
  else updates.escalation_stuck = true
  updateTaskPartial(taskId, updates)
  return getTask(taskId)
}

// "One more try" on a prompted-advance nudge — stays on the current rung,
// just clears the prompt (the user's own threshold was too eager this time).
export function dismissEscalationAdvancePrompt(taskId) {
  const task = getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  updateTaskPartial(taskId, { escalation_awaiting_advance: false })
  return getTask(taskId)
}

// "Got a response" — success path. Clears the ACTIVE ladder state but keeps
// escalation_rungs + escalation_attempt_log as a record (so the celebration
// toast / history can reference how many rungs it took).
export function resolveEscalation(taskId) {
  const task = getTask(taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  updateTaskPartial(taskId, {
    escalation_current_rung: null,
    escalation_awaiting_advance: false,
    escalation_stuck: false,
  })
  return getTask(taskId)
}

// Notification content override for a task with an active ladder — used by
// push/email/pushover in place of the generic stale/nudge copy, and to
// override that notification's cadence with the current rung's own tempo.
// Returns null when there's no active ladder to override with.
export function escalationNudgeOverride(task) {
  if (!task || task.escalation_current_rung == null) return null
  const rungs = task.escalation_rungs || []
  const rung = rungs[task.escalation_current_rung]
  if (!rung) return null
  const attemptsAtRung = (task.escalation_attempt_log || []).filter(e => e.rung_index === task.escalation_current_rung).length
  if (task.escalation_awaiting_advance) {
    const nextRung = rungs[task.escalation_current_rung + 1]
    return {
      text: `${rung.label} has had ${attemptsAtRung} tr${attemptsAtRung === 1 ? 'y' : 'ies'} with no response. Ready to switch to ${nextRung?.label || 'the next approach'}?`,
      cadenceDays: rung.nudge_every_days || null,
    }
  }
  return {
    text: `${rung.suggestion || rung.label}${rung.script ? ` — try: "${rung.script}"` : ''} (attempt ${attemptsAtRung + 1})`,
    cadenceDays: rung.nudge_every_days || null,
  }
}

// Single source of truth for "should this task trigger any notification?".
// Used by push/email/pushover engines + digest builder. The rules:
//   - gmail_pending tasks are inbox suggestions, never notified
//   - snooze_indefinite ("Until I come back") bypasses everything
//   - the usual active-status set qualifies when it has a due date, has
//     an active escalation ladder (that ladder is its own explicit
//     per-task opt-in — see Escalation Ladder), or the user opted the
//     task into undated nags via nag_allowed. (2026-07-11: previously ANY
//     active task nagged regardless of due date, so a "someday, no
//     deadline" task counted toward the pile-up count and got sampled
//     for stale/nudge pings exactly as loudly as something due today —
//     reported in prod as "getting yelled at" about tasks that don't even
//     show up in Today. Undated tasks are quiet by default now, same as
//     projects always were — set nag_allowed on a specific one if you
//     want reminders on it anyway.)
//   - projects qualify only when they have a due date (escalation rules
//     apply normally) OR the user opted them into nags via nag_allowed
export function isNotifiable(task, settings = null) {
  if (!task) return false
  if (task.gmail_pending) return false
  if (task.snooze_indefinite) return false
  if (task.notifications_muted) return false
  if (task.status === 'project') return !!(task.due_date || task.nag_allowed)
  if (['not_started', 'doing', 'waiting'].includes(task.status)) {
    // The crisis label is its own explicit opt-in, same as nag_allowed and an
    // active escalation ladder — an UNDATED crisis task must still nag
    // (nobody sets a due date mid-crisis; the washing-machine case).
    const s = settings || getData('settings') || {}
    return !!(task.due_date || task.nag_allowed || task.escalation_current_rung != null || isCrisisTask(task, s))
  }
  return false
}

// Critical tag: does this task carry the user-configured critical label?
// (User-facing term is "Critical"; internal crisis_* identifiers keep their
// names.) Matches against tag id (strings stored in task.tags),
// case-insensitive — same matching rule as the quiet-hours bypass label.
// Shared export (like filterNotifiableTasks/escalationNudgeOverride) so all
// three notification engines, the digest builder, and isNotifiable agree on
// one definition. See wiki/Crisis-Tag-And-Impact-Ranking.md.
export function isCrisisTask(task, settings) {
  const target = String((settings && settings.crisis_label) || 'critical').toLowerCase()
  if (!target || !task || !Array.isArray(task.tags)) return false
  return task.tags.some(t => {
    const v = typeof t === 'string' ? t : (t?.id || t?.name || '')
    return String(v).toLowerCase() === target
  })
}

// Full notification-eligibility filter. Combines isNotifiable() with the
// project-aware filters that previously only lived on the client:
//   - Backstage subs of projects (child_visibility='backstage', parent
//     is a project): never notify — they only show in the Projects
//     drill-down, the user can't act on them from the main list.
//   - Blocked subs (any task in `blocked_by` not yet completed): never
//     notify — the task isn't actionable yet, surfacing it on a lock
//     screen is just noise.
// Returns an array containing only the tasks that should be considered
// for notifications. Pass the full task list; the function builds an
// internal id→task map for blocker/parent resolution.
export function filterNotifiableTasks(allTasks) {
  if (!Array.isArray(allTasks)) return []
  const byId = new Map(allTasks.map(t => [t.id, t]))
  const settings = getData('settings') || {}
  return allTasks.filter(t => {
    if (!isNotifiable(t, settings)) return false
    // Backstage sub of a project
    if (t.parent_id && t.child_visibility === 'backstage') {
      const parent = byId.get(t.parent_id)
      if (parent?.status === 'project') return false
    }
    // Blocked by an incomplete sibling
    if (Array.isArray(t.blocked_by) && t.blocked_by.length > 0) {
      const someoneBlocking = t.blocked_by.some(id => {
        const b = byId.get(id)
        return b && b.status !== 'done'
      })
      if (someoneBlocking) return false
    }
    return true
  })
}

// ============================================================
// Analytics queries
// ============================================================

const SIZE_POINTS = { XS: 1, S: 2, M: 5, L: 10, XL: 20 }
const ENERGY_MULTIPLIER = { 1: 1.0, 2: 1.5, 3: 2.0 }

function calcPoints(row) {
  const base = SIZE_POINTS[row.size] || 1
  const energyMult = ENERGY_MULTIPLIER[row.energy_level] || 1.0
  const completedAt = row.completed_at ? new Date(row.completed_at) : new Date()
  const daysOnList = Math.max(0, Math.floor((completedAt.getTime() - new Date(row.created_at).getTime()) / 86400000))
  const speedMult = daysOnList === 0 ? 2 : daysOnList <= 2 ? 1.5 : 1
  return Math.round(base * energyMult * speedMult)
}

export function getAnalytics(settings = {}) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStr = todayStart.toISOString()

  // Today's stats
  let tasksToday = 0
  let pointsToday = 0
  const stmt1 = db.prepare('SELECT * FROM tasks WHERE status = ? AND completed_at >= ?')
  stmt1.bind(['done', todayStr])
  while (stmt1.step()) {
    tasksToday++
    pointsToday += calcPoints(stmt1.getAsObject())
  }
  stmt1.free()

  // All-time records: best day tasks, best day points, longest streak
  const byDay = {}
  const stmt2 = db.prepare('SELECT * FROM tasks WHERE status = ? AND completed_at IS NOT NULL')
  stmt2.bind(['done'])
  while (stmt2.step()) {
    const row = stmt2.getAsObject()
    const dayStr = new Date(row.completed_at).toDateString()
    if (!byDay[dayStr]) byDay[dayStr] = { tasks: 0, points: 0 }
    byDay[dayStr].tasks++
    byDay[dayStr].points += calcPoints(row)
  }
  stmt2.free()

  let bestTasks = 0, bestPoints = 0, longestStreak = 0
  for (const day of Object.values(byDay)) {
    if (day.tasks > bestTasks) bestTasks = day.tasks
    if (day.points > bestPoints) bestPoints = day.points
  }

  // Longest streak from sorted dates
  const dates = Object.keys(byDay).map(d => new Date(d)).sort((a, b) => a - b)
  let current = 1
  for (let i = 1; i < dates.length; i++) {
    const diff = (dates[i] - dates[i - 1]) / 86400000
    if (Math.round(diff) === 1) {
      current++
      if (current > longestStreak) longestStreak = current
    } else {
      current = 1
    }
  }
  if (dates.length > 0 && current > longestStreak) longestStreak = current

  // Current streak (consecutive days working backward from today)
  const freeDays = new Set(settings.free_days || [])
  let streak = 0
  const d = new Date()
  const todayDate = d.toDateString()
  const todayISO = d.toISOString().split('T')[0]
  if (!byDay[todayDate] && !freeDays.has(todayISO)) {
    d.setDate(d.getDate() - 1)
    if (!byDay[d.toDateString()] && !freeDays.has(d.toISOString().split('T')[0])) {
      // No completions today or yesterday — streak is 0
      streak = 0
    } else {
      while (byDay[d.toDateString()] || freeDays.has(d.toISOString().split('T')[0])) {
        streak++
        d.setDate(d.getDate() - 1)
      }
    }
  } else {
    while (byDay[d.toDateString()] || freeDays.has(d.toISOString().split('T')[0])) {
      streak++
      d.setDate(d.getDate() - 1)
    }
  }

  if (settings.vacation_mode) {
    if (settings.vacation_end && new Date() >= new Date(settings.vacation_end)) {
      // Vacation expired — use calculated streak
    } else {
      streak = settings.streak_current || 0
    }
  }

  return { tasksToday, pointsToday, bestTasks, bestPoints, longestStreak, streak }
}

export function getAnalyticsHistory(days) {
  const sinceDate = days
    ? new Date(Date.now() - days * 86400000).toISOString()
    : '1970-01-01T00:00:00.000Z'

  const stmt = db.prepare('SELECT * FROM tasks WHERE status = ? AND completed_at IS NOT NULL AND completed_at >= ?')
  stmt.bind(['done', sinceDate])

  const daily = {}
  const byTag = {}
  const byEnergy = {}
  const bySize = {}
  const byImpact = {}
  const byDayOfWeek = Array.from({ length: 7 }, () => ({ tasks: 0, points: 0 }))
  let totalTasks = 0, totalPoints = 0

  while (stmt.step()) {
    const row = stmt.getAsObject()
    const points = calcPoints(row)
    totalTasks++
    totalPoints += points

    // Daily (group by week for all-time to avoid hundreds of bars)
    const dayKey = days
      ? row.completed_at.split('T')[0]
      : (() => {
          const d = new Date(row.completed_at)
          const weekStart = new Date(d)
          weekStart.setDate(d.getDate() - d.getDay())
          return weekStart.toISOString().split('T')[0]
        })()
    if (!daily[dayKey]) daily[dayKey] = { day: dayKey, tasks: 0, points: 0 }
    daily[dayKey].tasks++
    daily[dayKey].points += points

    // Tags
    try {
      const tags = JSON.parse(row.tags_json || '[]')
      for (const tagId of tags) {
        if (!byTag[tagId]) byTag[tagId] = { tasks: 0, points: 0 }
        byTag[tagId].tasks++
        byTag[tagId].points += points
      }
    } catch { /* malformed tags_json */ }

    // Energy
    if (row.energy) {
      if (!byEnergy[row.energy]) byEnergy[row.energy] = { tasks: 0, points: 0 }
      byEnergy[row.energy].tasks++
      byEnergy[row.energy].points += points
    }

    // Size
    if (row.size) {
      if (!bySize[row.size]) bySize[row.size] = { tasks: 0, points: 0 }
      bySize[row.size].tasks++
      bySize[row.size].points += points
    }

    // Impact (1-3; tasks never inferred bucket under 2 — the display default)
    const impactKey = String(row.impact ?? 2)
    if (!byImpact[impactKey]) byImpact[impactKey] = { tasks: 0, points: 0 }
    byImpact[impactKey].tasks++
    byImpact[impactKey].points += points

    // Day of week
    const dow = new Date(row.completed_at).getDay()
    byDayOfWeek[dow].tasks++
    byDayOfWeek[dow].points += points
  }
  stmt.free()

  // Sort daily entries chronologically
  const dailyArr = Object.values(daily).sort((a, b) => a.day.localeCompare(b.day))

  return { daily: dailyArr, byTag, byEnergy, bySize, byImpact, byDayOfWeek, totalTasks, totalPoints }
}

// (syncTasksFromArray removed 2026-05-08 — bulk-replace was the wipe vector.
//  Use upsertTask + deleteTask per record. Restore-from-backup goes through
//  POST /api/data/restore.)

// ============================================================
// Routine row <-> object mapping
// ============================================================

function routineToRow(routine) {
  return {
    id: routine.id,
    title: routine.title || '',
    cadence: routine.cadence || 'weekly',
    custom_days: routine.custom_days ?? null,
    custom_unit: routine.custom_unit || 'days',
    notes: routine.notes || '',
    high_priority: routine.high_priority ? 1 : 0,
    energy: routine.energy || null,
    energy_level: routine.energyLevel ?? routine.energy_level ?? null,
    notion_page_id: routine.notion_page_id || null,
    notion_url: routine.notion_url || null,
    created_at: routine.created_at || new Date().toISOString(),
    paused: routine.paused ? 1 : 0,
    tags_json: JSON.stringify(routine.tags || []),
    completed_history_json: JSON.stringify(routine.completed_history || []),
    end_date: routine.end_date || null,
    schedule_day_of_week: routine.schedule_day_of_week ?? null,
    schedule_day_of_month: routine.schedule_day_of_month ?? null,
    schedule_week_of_month: routine.schedule_week_of_month ?? null,
    trigger_time: routine.trigger_time || null,
    auto_roll: routine.auto_roll ? 1 : 0,
    spawn_mode: routine.spawn_mode || 'auto',
    target_count: routine.target_count ?? null,
    target_period: routine.target_period || null,
    follow_ups_json: JSON.stringify(routine.follow_ups || []),
    members_json: JSON.stringify(routine.members || []),
    skipped_days_json: JSON.stringify(routine.skipped_days || []),
    assignee: routine.assignee || null,
    impact: routine.impact ?? null,
  }
}

function rowToRoutine(row) {
  return {
    id: row.id,
    title: row.title,
    cadence: row.cadence,
    custom_days: row.custom_days ?? null,
    custom_unit: row.custom_unit || 'days',
    notes: row.notes || '',
    high_priority: !!row.high_priority,
    energy: row.energy || null,
    energyLevel: row.energy_level ?? null,
    notion_page_id: row.notion_page_id || null,
    notion_url: row.notion_url || null,
    created_at: row.created_at,
    paused: !!row.paused,
    tags: safeJsonParse(row.tags_json, []),
    completed_history: safeJsonParse(row.completed_history_json, []),
    end_date: row.end_date || null,
    schedule_day_of_week: row.schedule_day_of_week ?? null,
    schedule_day_of_month: row.schedule_day_of_month ?? null,
    schedule_week_of_month: row.schedule_week_of_month ?? null,
    trigger_time: row.trigger_time || null,
    auto_roll: !!row.auto_roll,
    spawn_mode: row.spawn_mode || 'auto',
    target_count: row.target_count ?? null,
    target_period: row.target_period || null,
    follow_ups: safeJsonParse(row.follow_ups_json, []),
    members: safeJsonParse(row.members_json, []),
    skipped_days: safeJsonParse(row.skipped_days_json, []),
    assignee: row.assignee || null,
    impact: row.impact ?? null,
  }
}

// ============================================================
// Routine CRUD operations
// ============================================================

const UPSERT_ROUTINE_SQL = `
  INSERT INTO routines (id, title, cadence, custom_days, custom_unit, notes, high_priority,
    energy, energy_level, notion_page_id, notion_url, created_at, paused,
    tags_json, completed_history_json, end_date, schedule_day_of_week,
    schedule_day_of_month, schedule_week_of_month, trigger_time, auto_roll,
    spawn_mode, target_count, target_period, follow_ups_json, members_json, skipped_days_json,
    assignee, impact)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, cadence=excluded.cadence, custom_days=excluded.custom_days,
    custom_unit=excluded.custom_unit,
    notes=excluded.notes, high_priority=excluded.high_priority, energy=excluded.energy,
    energy_level=excluded.energy_level, notion_page_id=excluded.notion_page_id,
    notion_url=excluded.notion_url, created_at=excluded.created_at, paused=excluded.paused,
    tags_json=excluded.tags_json, completed_history_json=excluded.completed_history_json,
    end_date=excluded.end_date, schedule_day_of_week=excluded.schedule_day_of_week,
    schedule_day_of_month=excluded.schedule_day_of_month,
    schedule_week_of_month=excluded.schedule_week_of_month,
    trigger_time=excluded.trigger_time,
    auto_roll=excluded.auto_roll, spawn_mode=excluded.spawn_mode,
    target_count=excluded.target_count, target_period=excluded.target_period,
    follow_ups_json=excluded.follow_ups_json, members_json=excluded.members_json,
    skipped_days_json=excluded.skipped_days_json,
    assignee=excluded.assignee, impact=excluded.impact`

function runUpsertRoutine(routine) {
  const r = routineToRow(routine)
  db.run(UPSERT_ROUTINE_SQL, [
    r.id, r.title, r.cadence, r.custom_days, r.custom_unit, r.notes, r.high_priority,
    r.energy, r.energy_level, r.notion_page_id, r.notion_url, r.created_at, r.paused,
    r.tags_json, r.completed_history_json, r.end_date, r.schedule_day_of_week,
    r.schedule_day_of_month, r.schedule_week_of_month,
    r.trigger_time, r.auto_roll, r.spawn_mode, r.target_count, r.target_period,
    r.follow_ups_json, r.members_json, r.skipped_days_json, r.assignee, r.impact,
  ])
}

export function upsertRoutine(routine) {
  runUpsertRoutine(routine)
  schedulePersist()
}

export function updateRoutinePartial(id, updates) {
  const existing = getRoutine(id)
  if (!existing) return null
  const merged = { ...existing, ...updates }
  upsertRoutine(merged)
  return getRoutine(id)
}

export function getRoutine(id) {
  const stmt = db.prepare('SELECT * FROM routines WHERE id = ?')
  stmt.bind([id])
  if (stmt.step()) {
    const row = stmt.getAsObject()
    stmt.free()
    return rowToRoutine(row)
  }
  stmt.free()
  return null
}

export function getAllRoutines() {
  const results = []
  const stmt = db.prepare('SELECT * FROM routines ORDER BY created_at DESC')
  while (stmt.step()) {
    results.push(rowToRoutine(stmt.getAsObject()))
  }
  stmt.free()
  return results
}

export function deleteRoutine(id) {
  db.run('DELETE FROM routines WHERE id = ?', [id])
  schedulePersist()
}

// Server-side mirror of the client reconcileRoutineHistory (useRoutines.js):
// close loops left stuck OPEN — a routine whose spawned task was completed but
// whose completed_history never got the matching stamp (task completed before
// the stamping path existed, via a non-stamping path, or surviving a history
// wipe). For each ordinary cadence routine, append a completed_history stamp
// for every done-task completion-day missing from the history. Days are
// bucketed in the user's timezone (same as the durability completion_days
// path) so they line up with computeStreak's local bucketing. Idempotent —
// only adds genuine done-task evidence, so re-running is a no-op.
//
// Habit loops are excluded (multi-per-day logs make day-set matching lossy,
// and they have no cadence to "close"). STACKS are handled by their own
// per-(due_date) cycle rule: a cycle whose every member is done but whose
// closing completed_history stamp never landed gets stamped (the last-member-
// clear stamp can fail to land — completed from the main list, a refetch race,
// or pre-fix completions — leaving the day blank despite all members done).
//
// `dryRun: true` reports what WOULD change without writing — used so the
// Quokka tool can stage an accurate preview before the user commits.
// Returns { repaired: [{ id, title, before, after, addedDays }] }.
export function reconcileRoutineHistory({ dryRun = false } = {}) {
  const settings = getData('settings') || {}
  const tz = settings.user_timezone
  const today = ymdInUserTimezone(new Date().toISOString(), tz)
  const repaired = []
  for (const r of getAllRoutines()) {
    if (r.spawn_mode === 'habit') continue
    const isStack = Array.isArray(r.members) && r.members.length > 0
    const hist = Array.isArray(r.completed_history) ? r.completed_history.slice() : []
    const histDays = new Set(hist.map(ts => ymdInUserTimezone(ts, tz)))
    // Days the user explicitly skipped ("never did it, move on") must not be
    // re-stamped by a blanket reconcile.
    const skipped = new Set(Array.isArray(r.skipped_days) ? r.skipped_days : [])
    const additions = []
    const addedDays = []
    if (isStack) {
      // Group the stack's tasks into (due_date) cycles; stamp any past cycle
      // that's fully done but unrecorded. The stamp buckets to the due day.
      const byCycle = new Map()
      for (const t of queryTasks({ routine_id: r.id })) {
        const due = String(t.due_date || '').slice(0, 10)
        if (!due || due >= today) continue
        if (['cancelled', 'backlog', 'project'].includes(t.status)) continue
        if (!byCycle.has(due)) byCycle.set(due, { due, total: 0, done: 0 })
        const c = byCycle.get(due)
        c.total++
        if (t.status === 'done') c.done++
      }
      for (const c of byCycle.values()) {
        if (c.total === 0 || c.done < c.total) continue
        if (histDays.has(c.due) || skipped.has(c.due)) continue
        histDays.add(c.due)
        additions.push(`${c.due}T12:00:00.000Z`)
        addedDays.push(c.due)
      }
    } else {
      for (const t of queryTasks({ status: 'done', routine_id: r.id })) {
        const stampIso = t.completed_at || (t.due_date ? `${String(t.due_date).slice(0, 10)}T12:00:00.000Z` : null)
        if (!stampIso) continue
        const day = ymdInUserTimezone(stampIso, tz)
        if (!day || histDays.has(day) || skipped.has(day)) continue
        histDays.add(day)
        additions.push(new Date(stampIso).toISOString())
        addedDays.push(day)
      }
    }
    if (additions.length === 0) continue
    const after = [...hist, ...additions].sort()
    if (!dryRun) updateRoutinePartial(r.id, { completed_history: after })
    repaired.push({ id: r.id, title: r.title, before: hist, after, addedDays })
  }
  return { repaired }
}


// ============================================================
// Package row <-> object mapping
// ============================================================

function packageToRow(pkg) {
  return {
    id: pkg.id,
    tracking_number: pkg.tracking_number || pkg.trackingNumber || '',
    carrier: pkg.carrier || null,
    carrier_name: pkg.carrier_name || pkg.carrierName || '',
    label: pkg.label || '',
    status: pkg.status || 'pending',
    status_detail: pkg.status_detail || pkg.statusDetail || '',
    eta: pkg.eta || null,
    delivered_at: pkg.delivered_at || pkg.deliveredAt || null,
    signature_required: pkg.signature_required || pkg.signatureRequired ? 1 : 0,
    signature_task_id: pkg.signature_task_id || pkg.signatureTaskId || null,
    last_location: pkg.last_location || pkg.lastLocation || '',
    events_json: JSON.stringify(pkg.events || []),
    last_polled: pkg.last_polled || pkg.lastPolled || null,
    poll_interval_minutes: pkg.poll_interval_minutes || pkg.pollIntervalMinutes || 120,
    auto_cleanup_at: pkg.auto_cleanup_at || pkg.autoCleanupAt || null,
    created_at: pkg.created_at || pkg.createdAt || new Date().toISOString(),
    updated_at: pkg.updated_at || pkg.updatedAt || new Date().toISOString(),
    gmail_message_id: pkg.gmail_message_id || null,
    gmail_pending: pkg.gmail_pending ? 1 : 0,
  }
}

function rowToPackage(row) {
  return {
    id: row.id,
    tracking_number: row.tracking_number,
    carrier: row.carrier || null,
    carrier_name: row.carrier_name || '',
    label: row.label || '',
    status: row.status,
    status_detail: row.status_detail || '',
    eta: row.eta || null,
    delivered_at: row.delivered_at || null,
    signature_required: !!row.signature_required,
    signature_task_id: row.signature_task_id || null,
    last_location: row.last_location || '',
    events: safeJsonParse(row.events_json, []),
    last_polled: row.last_polled || null,
    poll_interval_minutes: row.poll_interval_minutes || 120,
    auto_cleanup_at: row.auto_cleanup_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    gmail_message_id: row.gmail_message_id || null,
    gmail_pending: !!row.gmail_pending,
  }
}

// ============================================================
// Package CRUD operations
// ============================================================

const UPSERT_PACKAGE_SQL = `
  INSERT INTO packages (id, tracking_number, carrier, carrier_name, label, status,
    status_detail, eta, delivered_at, signature_required, signature_task_id,
    last_location, events_json, last_polled, poll_interval_minutes,
    auto_cleanup_at, created_at, updated_at, gmail_message_id, gmail_pending)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    tracking_number=excluded.tracking_number, carrier=excluded.carrier,
    carrier_name=excluded.carrier_name, label=excluded.label, status=excluded.status,
    status_detail=excluded.status_detail, eta=excluded.eta, delivered_at=excluded.delivered_at,
    signature_required=excluded.signature_required, signature_task_id=excluded.signature_task_id,
    last_location=excluded.last_location, events_json=excluded.events_json,
    last_polled=excluded.last_polled, poll_interval_minutes=excluded.poll_interval_minutes,
    auto_cleanup_at=excluded.auto_cleanup_at, updated_at=excluded.updated_at,
    gmail_message_id=excluded.gmail_message_id, gmail_pending=excluded.gmail_pending`

function runUpsertPackage(pkg) {
  const r = packageToRow(pkg)
  db.run(UPSERT_PACKAGE_SQL, [
    r.id, r.tracking_number, r.carrier, r.carrier_name, r.label, r.status,
    r.status_detail, r.eta, r.delivered_at, r.signature_required, r.signature_task_id,
    r.last_location, r.events_json, r.last_polled, r.poll_interval_minutes,
    r.auto_cleanup_at, r.created_at, r.updated_at,
    r.gmail_message_id, r.gmail_pending,
  ])
}

export function upsertPackage(pkg) {
  runUpsertPackage(pkg)
  schedulePersist()
}

export function updatePackagePartial(id, updates) {
  const existing = getPackage(id)
  if (!existing) return null
  const merged = { ...existing, ...updates, updated_at: new Date().toISOString() }
  upsertPackage(merged)
  return getPackage(id)
}

export function getPackage(id) {
  const stmt = db.prepare('SELECT * FROM packages WHERE id = ?')
  stmt.bind([id])
  if (stmt.step()) {
    const row = stmt.getAsObject()
    stmt.free()
    return rowToPackage(row)
  }
  stmt.free()
  return null
}

export function getAllPackages(statusFilter) {
  let sql = 'SELECT * FROM packages'
  const params = []
  if (statusFilter === 'active') {
    sql += " WHERE status NOT IN ('delivered', 'expired')"
  } else if (statusFilter) {
    sql += ' WHERE status = ?'
    params.push(statusFilter)
  }
  sql += ' ORDER BY created_at DESC'
  const results = []
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params)
  while (stmt.step()) {
    results.push(rowToPackage(stmt.getAsObject()))
  }
  stmt.free()
  return results
}

export function deletePackage(id) {
  db.run('DELETE FROM packages WHERE id = ?', [id])
  schedulePersist()
}

// ============================================================
// Notes CRUD operations (migration 044) — free-floating notes, no task
// semantics. Dedicated table + per-record endpoints, never part of the
// bulk /api/data blob (same carve-out reasoning as packages).
// ============================================================

function rowToNote(row) {
  return {
    id: row.id,
    body: row.body,
    pinned: !!row.pinned,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function upsertNote(note) {
  db.run(
    `INSERT INTO notes (id, body, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       body=excluded.body, pinned=excluded.pinned, updated_at=excluded.updated_at`,
    [note.id, note.body, note.pinned ? 1 : 0, note.created_at, note.updated_at],
  )
  schedulePersist()
}

export function getNote(id) {
  const stmt = db.prepare('SELECT * FROM notes WHERE id = ?')
  stmt.bind([id])
  if (stmt.step()) {
    const row = stmt.getAsObject()
    stmt.free()
    return rowToNote(row)
  }
  stmt.free()
  return null
}

export function getAllNotes() {
  // Pinned first, then most-recently-touched — same order every surface shows.
  const results = []
  const stmt = db.prepare('SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC')
  while (stmt.step()) results.push(rowToNote(stmt.getAsObject()))
  stmt.free()
  return results
}

export function updateNotePartial(id, updates) {
  const existing = getNote(id)
  if (!existing) return null
  const merged = { ...existing, ...updates, updated_at: new Date().toISOString() }
  upsertNote(merged)
  return getNote(id)
}

export function deleteNote(id) {
  db.run('DELETE FROM notes WHERE id = ?', [id])
  schedulePersist()
}

// --- Gmail processed messages ---

export function isGmailProcessed(messageId) {
  const stmt = db.prepare('SELECT message_id FROM gmail_processed WHERE message_id = ?')
  stmt.bind([messageId])
  const found = stmt.step()
  stmt.free()
  return found
}

export function markGmailProcessed(messageId, threadId, subject, fromEmail, resultType, resultId) {
  db.run(
    `INSERT OR REPLACE INTO gmail_processed (message_id, thread_id, subject, from_email, result_type, result_id, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [messageId, threadId, subject, fromEmail, resultType, resultId, new Date().toISOString()]
  )
  schedulePersist()
}

export function getGmailProcessedCount() {
  const result = db.exec('SELECT COUNT(*) FROM gmail_processed')
  return result[0]?.values[0]?.[0] || 0
}

export function clearGmailProcessed() {
  db.run('DELETE FROM gmail_processed')
  schedulePersist()
}

// (syncRoutinesFromArray + syncPackagesFromArray removed 2026-05-08 alongside
//  syncTasksFromArray. Same reason — bulk-replace was the wipe vector.)

// ============================================================
// Notification throttle & log (server-side email notifications)
// ============================================================

export function getNotifThrottle(key) {
  const stmt = db.prepare('SELECT last_sent FROM notification_throttle WHERE key = ?')
  stmt.bind([key])
  if (stmt.step()) {
    const row = stmt.getAsObject()
    stmt.free()
    return row.last_sent
  }
  stmt.free()
  return null
}

export function setNotifThrottle(key, timestamp) {
  db.run(
    `INSERT INTO notification_throttle (key, last_sent) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET last_sent = excluded.last_sent`,
    [key, timestamp]
  )
  schedulePersist()
}

export function logNotifEmail(id, type, taskId, title, body) {
  db.run(
    `INSERT INTO notification_log (id, type, task_id, title, body, channel, sent_at)
     VALUES (?, ?, ?, ?, ?, 'email', ?)`,
    [id, type, taskId, title, body, new Date().toISOString()]
  )
  db.run(`DELETE FROM notification_log WHERE id NOT IN (SELECT id FROM notification_log ORDER BY sent_at DESC LIMIT 500)`)
  schedulePersist()
}

// --- Push subscriptions ---

export function getAllPushSubscriptions() {
  const stmt = db.prepare('SELECT * FROM push_subscriptions')
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

export function upsertPushSubscription(id, endpoint, p256dh, auth) {
  // Dedup: a re-subscription on the same device produces the same (p256dh, auth)
  // keypair but a different endpoint. Without this, we accumulate stale rows
  // each time iOS evicts the subscription or the user reinstalls the PWA, and
  // every notification ends up firing N times. Delete prior rows with matching
  // keys before the upsert.
  db.run(
    'DELETE FROM push_subscriptions WHERE p256dh = ? AND auth = ? AND endpoint != ?',
    [p256dh, auth, endpoint]
  )
  db.run(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, updated_at = datetime('now')`,
    [id, endpoint, p256dh, auth]
  )
  schedulePersist()
}

export function deletePushSubscription(endpoint) {
  db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint])
  schedulePersist()
}

export function deletePushSubscriptionById(id) {
  db.run('DELETE FROM push_subscriptions WHERE id = ?', [id])
  schedulePersist()
}

// One-time cleanup utility: remove duplicate subscriptions, keeping the most
// recently updated row for each (p256dh, auth) keypair. Exposed as a script.
export function dedupePushSubscriptions() {
  const stmt = db.prepare(
    `SELECT p256dh, auth, COUNT(*) as cnt FROM push_subscriptions
     GROUP BY p256dh, auth HAVING cnt > 1`
  )
  const dupes = []
  while (stmt.step()) dupes.push(stmt.getAsObject())
  stmt.free()

  let removed = 0
  for (const d of dupes) {
    // Keep the most recently updated row, delete the rest
    const all = db.prepare(
      `SELECT id, updated_at FROM push_subscriptions
       WHERE p256dh = ? AND auth = ? ORDER BY updated_at DESC`
    )
    all.bind([d.p256dh, d.auth])
    const rows = []
    while (all.step()) rows.push(all.getAsObject())
    all.free()
    for (let i = 1; i < rows.length; i++) {
      db.run('DELETE FROM push_subscriptions WHERE id = ?', [rows[i].id])
      removed++
    }
  }
  if (removed > 0) schedulePersist()
  return { duplicateGroups: dupes.length, removed }
}

export function logNotifPush(id, type, taskId, title, body, channel = 'push') {
  db.run(
    `INSERT INTO notification_log (id, type, task_id, title, body, channel, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, type, taskId, title, body, channel, new Date().toISOString()]
  )
  db.run(`DELETE FROM notification_log WHERE id NOT IN (SELECT id FROM notification_log ORDER BY sent_at DESC LIMIT 500)`)
  schedulePersist()
}

export function listNotifLog(limit = 200) {
  const stmt = db.prepare(
    `SELECT id, type, task_id, title, body, channel, sent_at, tapped_at, completed_after, read_at
     FROM notification_log ORDER BY sent_at DESC LIMIT ?`
  )
  stmt.bind([limit])
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

export function clearNotifLog() {
  db.run('DELETE FROM notification_log')
  schedulePersist()
}

// --- Persisted read state (migration 036) ---
// Distinct from `tapped_at` (engagement analytics): `read_at` is the UI read
// flag the Notifications center keys "unread" off of. Marking read here does
// NOT touch engagement analytics, and works for task-less rows too.

// Stamp read_at on a specific set of log-entry ids. Returns the number marked.
export function markNotifEntriesRead(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const now = new Date().toISOString()
  let n = 0
  for (const id of ids) {
    db.run('UPDATE notification_log SET read_at = ? WHERE id = ? AND read_at IS NULL', [now, id])
    n++
  }
  schedulePersist()
  return n
}

// Stamp read_at on every currently-unread log entry. Returns the count.
export function markAllNotifsRead() {
  const now = new Date().toISOString()
  db.run('UPDATE notification_log SET read_at = ? WHERE read_at IS NULL', [now])
  schedulePersist()
  // sql.js doesn't surface changes() conveniently here; the caller doesn't
  // need an exact count, just success.
  return true
}

// --- Engagement tracking (tap-through and completion-after-notification) ---

// Mark the most recent notification for (taskId, channel) within the last 10
// minutes as tapped. Idempotent — returns true if a row was updated.
export function markNotificationTapped(taskId, channel) {
  if (!taskId) return false
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const stmt = db.prepare(
    `SELECT id FROM notification_log
     WHERE task_id = ? AND channel = ? AND sent_at >= ? AND tapped_at IS NULL
     ORDER BY sent_at DESC LIMIT 1`
  )
  stmt.bind([taskId, channel, cutoff])
  let id = null
  if (stmt.step()) id = stmt.getAsObject().id
  stmt.free()
  if (!id) return false
  db.run('UPDATE notification_log SET tapped_at = ? WHERE id = ?', [new Date().toISOString(), id])
  schedulePersist()
  return true
}

// When a task is completed, mark any recent (last 24h) notifications for it
// across all channels as "converted" — completed_after stamped with the
// completion time. Used by analytics to measure conversion rate.
export function stampCompletionForRecentNotifs(taskId) {
  if (!taskId) return
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  db.run(
    `UPDATE notification_log SET completed_after = ?
     WHERE task_id = ? AND sent_at >= ? AND completed_after IS NULL`,
    [new Date().toISOString(), taskId, cutoff]
  )
  schedulePersist()
}

// --- Adaptive throttling ---
//
// For each (channel, type) we look at the last N notifications. If none were
// tapped or led to completion within 24h, we back off — multiply the throttle
// interval to reduce volume. As soon as one converts, we reset to 1x. This
// protects channel credibility: the system stops shouting into a void.
//
// A user thumbs-down on a back-off decision sets user_overridden_until so the
// system stops auto-tuning that (channel, type) for a 7-day grace period.

const ADAPTIVE_LOOKBACK = 10
const ADAPTIVE_BACKOFF_STEP = 1.5
const ADAPTIVE_MAX = 8.0

export function getEffectiveThrottleMultiplier(channel, type) {
  // Honor user override window
  const override = db.prepare(
    `SELECT user_overridden_until FROM throttle_decisions
     WHERE channel = ? AND type = ? AND user_overridden_until IS NOT NULL
     ORDER BY decided_at DESC LIMIT 1`
  )
  override.bind([channel, type])
  let overrideUntil = null
  if (override.step()) overrideUntil = override.getAsObject().user_overridden_until
  override.free()
  if (overrideUntil && new Date(overrideUntil) > new Date()) return 1.0

  const stmt = db.prepare(
    `SELECT tapped_at, completed_after FROM notification_log
     WHERE channel = ? AND type = ?
     ORDER BY sent_at DESC LIMIT ?`
  )
  stmt.bind([channel, type, ADAPTIVE_LOOKBACK])
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()

  if (rows.length < ADAPTIVE_LOOKBACK) return 1.0
  const anyConverted = rows.some(r => r.tapped_at || r.completed_after)
  if (anyConverted) return 1.0

  // All ignored — count how many consecutive ignored windows we've already
  // backed off, multiply by step each time, capped at MAX.
  const recentDecisions = db.prepare(
    `SELECT multiplier_new FROM throttle_decisions
     WHERE channel = ? AND type = ? AND feedback != 'down' OR feedback IS NULL
     ORDER BY decided_at DESC LIMIT 1`
  )
  recentDecisions.bind([channel, type])
  let last = 1.0
  if (recentDecisions.step()) last = recentDecisions.getAsObject().multiplier_new
  recentDecisions.free()

  const next = Math.min(ADAPTIVE_MAX, Math.max(1.0, last * ADAPTIVE_BACKOFF_STEP))
  if (next !== last) {
    db.run(
      `INSERT INTO throttle_decisions (id, channel, type, multiplier_old, multiplier_new, decided_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), channel, type, last, next, new Date().toISOString()]
    )
    schedulePersist()
  }
  return next
}

export function listThrottleDecisions(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const stmt = db.prepare(
    `SELECT * FROM throttle_decisions WHERE decided_at >= ? ORDER BY decided_at DESC`
  )
  stmt.bind([cutoff])
  const out = []
  while (stmt.step()) out.push(stmt.getAsObject())
  stmt.free()
  return out
}

export function markThrottleDecisionFeedback(id, feedback) {
  if (!['up', 'down'].includes(feedback)) return false
  const stmt = db.prepare('SELECT * FROM throttle_decisions WHERE id = ?')
  stmt.bind([id])
  if (!stmt.step()) { stmt.free(); return false }
  const row = stmt.getAsObject()
  stmt.free()
  const now = new Date().toISOString()
  if (feedback === 'down') {
    // Revert: insert a synthetic decision back to multiplier_old, and set the
    // 7-day override on this (channel, type) so the auto-tuning stops.
    const overrideUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    db.run(
      `UPDATE throttle_decisions SET feedback = ?, feedback_at = ?, user_overridden_until = ? WHERE id = ?`,
      [feedback, now, overrideUntil, id]
    )
    db.run(
      `INSERT INTO throttle_decisions (id, channel, type, multiplier_old, multiplier_new, decided_at, feedback, feedback_at)
       VALUES (?, ?, ?, ?, ?, ?, 'down', ?)`,
      [crypto.randomUUID(), row.channel, row.type, row.multiplier_new, row.multiplier_old, now, now]
    )
  } else {
    db.run(`UPDATE throttle_decisions SET feedback = ?, feedback_at = ? WHERE id = ?`, [feedback, now, id])
  }
  schedulePersist()
  return true
}

// ============================================================
// Pattern suggestions (Activity Prompts PR 3)
// ============================================================
// Server-only table — never round-tripped through /api/data bulk PUT.
// Same posture as notification_log post-2026-05-08 wipe guard.

function rowToSuggestion(row) {
  return {
    id: row.id,
    normalized_title: row.normalized_title,
    display_title: row.display_title,
    sample_titles: safeJsonParse(row.sample_titles_json, []),
    detected_cadence: row.detected_cadence,
    occurrence_count: row.occurrence_count,
    last_seen_at: row.last_seen_at,
    confidence: row.confidence,
    status: row.status,
    snooze_until: row.snooze_until ?? null,
    created_at: row.created_at,
    decided_at: row.decided_at ?? null,
  }
}

// Surface a suggestion (insert new or update count + last_seen on an existing
// pending row with the same normalized_title). Permanently dismissed or
// accepted rows are left alone — once the user has decided, the scanner
// shouldn't re-surface the same pattern.
export function upsertPatternSuggestion(suggestion) {
  const stmt = db.prepare('SELECT id, status FROM pattern_suggestions WHERE normalized_title = ?')
  stmt.bind([suggestion.normalized_title])
  let existingId = null
  let existingStatus = null
  if (stmt.step()) {
    const row = stmt.getAsObject()
    existingId = row.id
    existingStatus = row.status
  }
  stmt.free()

  if (existingStatus === 'dismissed' || existingStatus === 'accepted') return existingId

  if (existingId) {
    db.run(
      `UPDATE pattern_suggestions SET
        display_title = ?, sample_titles_json = ?, detected_cadence = ?,
        occurrence_count = ?, last_seen_at = ?, confidence = ?
       WHERE id = ?`,
      [
        suggestion.display_title,
        JSON.stringify(suggestion.sample_titles || []),
        suggestion.detected_cadence,
        suggestion.occurrence_count,
        suggestion.last_seen_at,
        suggestion.confidence,
        existingId,
      ]
    )
    schedulePersist()
    return existingId
  }
  db.run(
    `INSERT INTO pattern_suggestions
       (normalized_title, display_title, sample_titles_json, detected_cadence,
        occurrence_count, last_seen_at, confidence, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      suggestion.normalized_title,
      suggestion.display_title,
      JSON.stringify(suggestion.sample_titles || []),
      suggestion.detected_cadence,
      suggestion.occurrence_count,
      suggestion.last_seen_at,
      suggestion.confidence,
      Date.now(),
    ]
  )
  schedulePersist()
  return null
}

// Pending = status='pending' AND (snooze_until is null OR snooze_until <= now).
// Sorted by confidence DESC so the highest-signal suggestions surface first.
export function listPendingSuggestions() {
  const now = Date.now()
  const stmt = db.prepare(
    `SELECT * FROM pattern_suggestions
     WHERE status = 'pending' AND (snooze_until IS NULL OR snooze_until <= ?)
     ORDER BY confidence DESC, last_seen_at DESC`
  )
  stmt.bind([now])
  const results = []
  while (stmt.step()) results.push(rowToSuggestion(stmt.getAsObject()))
  stmt.free()
  return results
}

// Count of currently-actionable pending suggestions. Drives the
// routine_suggestion notification + UI badge.
export function countPendingSuggestions() {
  return listPendingSuggestions().length
}

export function getPatternSuggestion(id) {
  const stmt = db.prepare('SELECT * FROM pattern_suggestions WHERE id = ?')
  stmt.bind([id])
  if (stmt.step()) {
    const row = stmt.getAsObject()
    stmt.free()
    return rowToSuggestion(row)
  }
  stmt.free()
  return null
}

export function updateSuggestionStatus(id, status, decidedAt = Date.now()) {
  db.run(
    `UPDATE pattern_suggestions SET status = ?, decided_at = ? WHERE id = ?`,
    [status, decidedAt, id]
  )
  schedulePersist()
}

export function snoozeSuggestion(id, snoozeUntil) {
  db.run(`UPDATE pattern_suggestions SET snooze_until = ? WHERE id = ?`, [snoozeUntil, id])
  schedulePersist()
}

// ============================================================

// Aggregated engagement summary for the analytics endpoint.
// Returns rows of { channel, type, sent, tapped, completed } over `days` days.
export function getNotificationAnalytics(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const stmt = db.prepare(
    `SELECT channel, type,
            COUNT(*) as sent,
            SUM(CASE WHEN tapped_at IS NOT NULL THEN 1 ELSE 0 END) as tapped,
            SUM(CASE WHEN completed_after IS NOT NULL THEN 1 ELSE 0 END) as completed
     FROM notification_log
     WHERE sent_at >= ? AND task_id IS NOT NULL
     GROUP BY channel, type`
  )
  stmt.bind([cutoff])
  const results = []
  while (stmt.step()) results.push(stmt.getAsObject())
  stmt.free()
  return results
}

// ============================================================
// AI usage tracking (migration 043) — one row per AI call, logged at the
// gateway/proxy choke points. Cost estimated at insert time from the
// aiModels.js pricing table (snapshot; NULL for unpriced models). NEVER
// throws — usage telemetry must not break the call it's recording.

export function logAiUsage({ provider, model, feature, input_tokens = 0, output_tokens = 0 }) {
  try {
    const cost = estimateAiCost(model, input_tokens, output_tokens)
    db.run(
      `INSERT INTO ai_usage (id, ts, provider, model, feature, input_tokens, output_tokens, cost_estimate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), new Date().toISOString(), provider || 'anthropic', model || 'unknown',
        feature || null, input_tokens | 0, output_tokens | 0, cost]
    )
    schedulePersist()
  } catch (e) {
    console.error('[AiUsage] log failed:', e?.message)
  }
}

export function getAiUsageSummary(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const query = (sql) => {
    const stmt = db.prepare(sql)
    stmt.bind([cutoff])
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return rows
  }
  const totals = query(
    `SELECT COUNT(*) as calls, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
            SUM(cost_estimate) as cost, SUM(CASE WHEN cost_estimate IS NULL THEN 1 ELSE 0 END) as unpriced_calls
     FROM ai_usage WHERE ts >= ?`
  )[0] || {}
  const byProvider = query(
    `SELECT provider, COUNT(*) as calls, SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens, SUM(cost_estimate) as cost
     FROM ai_usage WHERE ts >= ? GROUP BY provider ORDER BY cost DESC`
  )
  const byModel = query(
    `SELECT provider, model, COUNT(*) as calls, SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens, SUM(cost_estimate) as cost
     FROM ai_usage WHERE ts >= ? GROUP BY provider, model ORDER BY cost DESC`
  )
  const byFeature = query(
    `SELECT feature, COUNT(*) as calls, SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens, SUM(cost_estimate) as cost
     FROM ai_usage WHERE ts >= ? GROUP BY feature ORDER BY cost DESC`
  )
  const byDay = query(
    `SELECT substr(ts, 1, 10) as day, COUNT(*) as calls, SUM(cost_estimate) as cost
     FROM ai_usage WHERE ts >= ? GROUP BY day ORDER BY day`
  )
  return { days, totals, byProvider, byModel, byFeature, byDay }
}

// ============================================================
// Knowledge index — cached Notion knowledge-base metadata
// ============================================================
//
// The full knowledge body lives in Notion. This local index holds just
// the metadata (title, type, tags, ≤200-char summary) so Quokka can
// search instantly without round-tripping. Body fetched on demand via
// the Notion MCP. Refresh loop in knowledgeSync.js keeps it in step.

function knowledgeRowToItem(row) {
  return {
    notion_page_id: row.notion_page_id,
    title: row.title,
    type: row.type || null,
    tags: safeJsonParse(row.tags_json, []),
    summary: row.summary || '',
    confidence: row.confidence || null,
    related_task_ids: safeJsonParse(row.related_task_ids_json, []),
    notion_url: row.notion_url || null,
    last_edited_time: row.last_edited_time || null,
    last_synced_at: row.last_synced_at,
    archived: !!row.archived,
  }
}

export function upsertKnowledgeItem(item) {
  db.run(
    `INSERT INTO knowledge_index
       (notion_page_id, title, type, tags_json, summary, confidence,
        related_task_ids_json, notion_url, last_edited_time, last_synced_at, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(notion_page_id) DO UPDATE SET
       title=excluded.title, type=excluded.type, tags_json=excluded.tags_json,
       summary=excluded.summary, confidence=excluded.confidence,
       related_task_ids_json=excluded.related_task_ids_json,
       notion_url=excluded.notion_url, last_edited_time=excluded.last_edited_time,
       last_synced_at=excluded.last_synced_at, archived=excluded.archived`,
    [
      item.notion_page_id,
      item.title || 'Untitled',
      item.type || null,
      JSON.stringify(item.tags || []),
      (item.summary || '').slice(0, 200),
      item.confidence || null,
      JSON.stringify(item.related_task_ids || []),
      item.notion_url || null,
      item.last_edited_time || null,
      item.last_synced_at || new Date().toISOString(),
      item.archived ? 1 : 0,
    ]
  )
  schedulePersist()
}

export function getKnowledgeItem(notionPageId) {
  const stmt = db.prepare(`SELECT * FROM knowledge_index WHERE notion_page_id = ?`)
  stmt.bind([notionPageId])
  if (!stmt.step()) { stmt.free(); return null }
  const row = stmt.getAsObject()
  stmt.free()
  return knowledgeRowToItem(row)
}

export function deleteKnowledgeItem(notionPageId) {
  db.run(`DELETE FROM knowledge_index WHERE notion_page_id = ?`, [notionPageId])
  schedulePersist()
}

export function getAllKnowledgeItems({ includeArchived = false } = {}) {
  const sql = includeArchived
    ? `SELECT * FROM knowledge_index ORDER BY title COLLATE NOCASE`
    : `SELECT * FROM knowledge_index WHERE archived = 0 ORDER BY title COLLATE NOCASE`
  const stmt = db.prepare(sql)
  const results = []
  while (stmt.step()) results.push(knowledgeRowToItem(stmt.getAsObject()))
  stmt.free()
  return results
}

// Lightweight keyword search across title + tags + summary. Returns a
// scored list, highest first. Used by Quokka's search_knowledge tool.
export function searchKnowledgeItems(query, { limit = 20, type = null } = {}) {
  const q = (query || '').trim().toLowerCase()
  const all = getAllKnowledgeItems()
  if (!q) return type ? all.filter(i => i.type === type).slice(0, limit) : all.slice(0, limit)
  const terms = q.split(/\s+/).filter(Boolean)
  const scored = []
  for (const item of all) {
    if (type && item.type !== type) continue
    const hay = [
      item.title.toLowerCase(),
      (item.tags || []).join(' ').toLowerCase(),
      (item.summary || '').toLowerCase(),
    ].join(' \n ')
    let score = 0
    for (const term of terms) {
      if (item.title.toLowerCase().includes(term)) score += 3
      if ((item.tags || []).some(t => t.toLowerCase().includes(term))) score += 2
      if (hay.includes(term)) score += 1
    }
    if (score > 0) scored.push({ score, item })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(s => s.item)
}

// Replace the entire cache with a fresh snapshot from Notion. Used by the
// background refresh loop. Items missing from the new snapshot are removed
// so deletions made directly in Notion propagate locally.
export function replaceKnowledgeIndex(items) {
  db.run(`DELETE FROM knowledge_index`)
  for (const item of items) upsertKnowledgeItem(item)
  schedulePersist()
}

