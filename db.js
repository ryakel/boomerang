import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

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

  const migDir = path.join(__dirname, 'migrations')
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
    pushover_receipt, follow_ups_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    follow_ups_json=excluded.follow_ups_json`

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
    r.pushover_receipt, r.follow_ups_json,
  ])
}

export function upsertTask(task) {
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
  const offsetMs = Math.max(0, (step.offset_minutes || 0) * 60000)
  const triggerAt = Date.now() + offsetMs
  const triggerDate = new Date(triggerAt)
  const todayUTC = new Date(); todayUTC.setHours(0, 0, 0, 0)
  const sameDay = offsetMs < 24 * 60 * 60 * 1000
    && triggerDate.toDateString() === todayUTC.toDateString()
  const dueDate = sameDay
    ? `${todayUTC.getFullYear()}-${String(todayUTC.getMonth() + 1).padStart(2, '0')}-${String(todayUTC.getDate()).padStart(2, '0')}`
    : `${triggerDate.getFullYear()}-${String(triggerDate.getMonth() + 1).padStart(2, '0')}-${String(triggerDate.getDate()).padStart(2, '0')}`

  const newTask = {
    id: crypto.randomUUID(),
    title: step.title,
    status: 'not_started',
    notes: step.notes || '',
    due_date: dueDate,
    snoozed_until: offsetMs > 0 && sameDay ? new Date(triggerAt).toISOString() : null,
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

// True when `updates` represents a user-driven resolution of the task.
function isResolutionUpdate(existing, updates) {
  if (updates.status && updates.status !== existing.status) {
    if (['done', 'completed', 'cancelled', 'project', 'backlog'].includes(updates.status)) return true
  }
  if (updates.completed_at && !existing.completed_at) return true
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

export function deleteTask(id) {
  // Cancel any outstanding Pushover Emergency receipt before removing the task.
  const existing = getTask(id)
  if (existing && existing.pushover_receipt) {
    triggerEmergencyCancel(id, existing.pushover_receipt)
  }
  db.run('DELETE FROM tasks WHERE id = ?', [id])
  schedulePersist()
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

    // Day of week
    const dow = new Date(row.completed_at).getDay()
    byDayOfWeek[dow].tasks++
    byDayOfWeek[dow].points += points
  }
  stmt.free()

  // Sort daily entries chronologically
  const dailyArr = Object.values(daily).sort((a, b) => a.day.localeCompare(b.day))

  return { daily: dailyArr, byTag, byEnergy, bySize, byDayOfWeek, totalTasks, totalPoints }
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
    follow_ups_json: JSON.stringify(routine.follow_ups || []),
  }
}

function rowToRoutine(row) {
  return {
    id: row.id,
    title: row.title,
    cadence: row.cadence,
    custom_days: row.custom_days ?? null,
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
    follow_ups: safeJsonParse(row.follow_ups_json, []),
  }
}

// ============================================================
// Routine CRUD operations
// ============================================================

const UPSERT_ROUTINE_SQL = `
  INSERT INTO routines (id, title, cadence, custom_days, notes, high_priority,
    energy, energy_level, notion_page_id, notion_url, created_at, paused,
    tags_json, completed_history_json, end_date, schedule_day_of_week, follow_ups_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, cadence=excluded.cadence, custom_days=excluded.custom_days,
    notes=excluded.notes, high_priority=excluded.high_priority, energy=excluded.energy,
    energy_level=excluded.energy_level, notion_page_id=excluded.notion_page_id,
    notion_url=excluded.notion_url, created_at=excluded.created_at, paused=excluded.paused,
    tags_json=excluded.tags_json, completed_history_json=excluded.completed_history_json,
    end_date=excluded.end_date, schedule_day_of_week=excluded.schedule_day_of_week,
    follow_ups_json=excluded.follow_ups_json`

function runUpsertRoutine(routine) {
  const r = routineToRow(routine)
  db.run(UPSERT_ROUTINE_SQL, [
    r.id, r.title, r.cadence, r.custom_days, r.notes, r.high_priority,
    r.energy, r.energy_level, r.notion_page_id, r.notion_url, r.created_at, r.paused,
    r.tags_json, r.completed_history_json, r.end_date, r.schedule_day_of_week,
    r.follow_ups_json,
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
    `SELECT id, type, task_id, title, body, channel, sent_at, tapped_at, completed_after
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
