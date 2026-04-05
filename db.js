import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

let db
let dbPath

// --- Batched persistence ---
let persistTimer = null
const PERSIST_INTERVAL_MS = 3000

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

// Post-migration data seeding: populate tasks/routines tables from JSON blobs
function seedFromJsonBlobs() {
  // Check that tables exist before seeding (migrations must have run first)
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks','routines')")
  const tableNames = new Set((tables[0]?.values || []).map(r => r[0]))
  if (!tableNames.has('tasks') || !tableNames.has('routines')) return

  // Seed tasks table from app_data JSON blob if tasks table is empty
  const taskCount = db.exec('SELECT COUNT(*) FROM tasks')
  if (taskCount[0]?.values[0]?.[0] === 0) {
    const blob = getData('tasks')
    if (Array.isArray(blob) && blob.length > 0) {
      console.log(`[DB] Seeding ${blob.length} tasks from JSON blob into tasks table`)
      db.run('BEGIN TRANSACTION')
      for (const task of blob) runUpsertTask(task)
      db.run('COMMIT')
    }
  }

  // Seed routines table from app_data JSON blob if routines table is empty
  const routineCount = db.exec('SELECT COUNT(*) FROM routines')
  if (routineCount[0]?.values[0]?.[0] === 0) {
    const blob = getData('routines')
    if (Array.isArray(blob) && blob.length > 0) {
      console.log(`[DB] Seeding ${blob.length} routines from JSON blob into routines table`)
      db.run('BEGIN TRANSACTION')
      for (const routine of blob) runUpsertRoutine(routine)
      db.run('COMMIT')
    }
  }
}

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
  seedFromJsonBlobs()

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

  // Read settings, labels from app_data
  const stmt = db.prepare('SELECT collection, data_json FROM app_data')
  while (stmt.step()) {
    const row = stmt.getAsObject()
    if (row.collection === 'tasks' || row.collection === 'routines') continue // skip legacy blobs
    try {
      result[row.collection] = JSON.parse(row.data_json)
    } catch {
      result[row.collection] = null
    }
  }
  stmt.free()

  // Read tasks and routines from proper SQL tables
  result.tasks = getAllTasks()
  result.routines = getAllRoutines()

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

export function setAllData(data) {
  for (const [collection, value] of Object.entries(data)) {
    if (collection === '_clientId') continue
    if (collection === 'tasks') {
      syncTasksFromArray(value)
      continue
    }
    if (collection === 'routines') {
      syncRoutinesFromArray(value)
      continue
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
    size: task.size || null,
    energy: task.energy || null,
    energy_level: task.energyLevel ?? task.energy_level ?? null,
    tags_json: JSON.stringify(task.tags || []),
    attachments_json: JSON.stringify(task.attachments || []),
    checklist_json: JSON.stringify(task.checklist || []),
    checklists_json: JSON.stringify(task.checklists || []),
    comments_json: JSON.stringify(task.comments || []),
    toast_messages_json: task.toast_messages ? JSON.stringify(task.toast_messages) : null,
    trello_sync_enabled: task.trello_sync_enabled == null ? null : task.trello_sync_enabled ? 1 : 0,
    gcal_event_id: task.gcal_event_id || null,
    gcal_duration: task.gcal_duration ?? null,
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
    size: row.size || null,
    energy: row.energy || null,
    energyLevel: row.energy_level ?? null,
    tags: safeJsonParse(row.tags_json, []),
    attachments: safeJsonParse(row.attachments_json, []),
    checklist: safeJsonParse(row.checklist_json, []),
    checklists: safeJsonParse(row.checklists_json, []),
    comments: safeJsonParse(row.comments_json, []),
    toast_messages: safeJsonParse(row.toast_messages_json, null),
    trello_sync_enabled: row.trello_sync_enabled == null ? undefined : !!row.trello_sync_enabled,
    gcal_event_id: row.gcal_event_id || null,
    gcal_duration: row.gcal_duration ?? null,
  }
}

function safeJsonParse(str, fallback) {
  if (!str) return fallback
  try { return JSON.parse(str) } catch { return fallback }
}

// ============================================================
// Task CRUD operations
// ============================================================

const UPSERT_TASK_SQL = `
  INSERT INTO tasks (id, title, status, notes, due_date, snoozed_until, snooze_count,
    staleness_days, last_touched, created_at, completed_at, reframe_notes,
    notion_page_id, notion_url, trello_card_id, trello_card_url, routine_id,
    high_priority, size, energy, energy_level, tags_json, attachments_json,
    checklist_json, checklists_json, comments_json, toast_messages_json, trello_sync_enabled,
    gcal_event_id, gcal_duration)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, status=excluded.status, notes=excluded.notes,
    due_date=excluded.due_date, snoozed_until=excluded.snoozed_until,
    snooze_count=excluded.snooze_count, staleness_days=excluded.staleness_days,
    last_touched=excluded.last_touched, created_at=excluded.created_at,
    completed_at=excluded.completed_at, reframe_notes=excluded.reframe_notes,
    notion_page_id=excluded.notion_page_id, notion_url=excluded.notion_url,
    trello_card_id=excluded.trello_card_id, trello_card_url=excluded.trello_card_url,
    routine_id=excluded.routine_id, high_priority=excluded.high_priority,
    size=excluded.size, energy=excluded.energy, energy_level=excluded.energy_level,
    tags_json=excluded.tags_json, attachments_json=excluded.attachments_json,
    checklist_json=excluded.checklist_json, checklists_json=excluded.checklists_json,
    comments_json=excluded.comments_json, toast_messages_json=excluded.toast_messages_json,
    trello_sync_enabled=excluded.trello_sync_enabled,
    gcal_event_id=excluded.gcal_event_id,
    gcal_duration=excluded.gcal_duration`

function runUpsertTask(task) {
  const r = taskToRow(task)
  db.run(UPSERT_TASK_SQL, [
    r.id, r.title, r.status, r.notes, r.due_date, r.snoozed_until, r.snooze_count,
    r.staleness_days, r.last_touched, r.created_at, r.completed_at, r.reframe_notes,
    r.notion_page_id, r.notion_url, r.trello_card_id, r.trello_card_url, r.routine_id,
    r.high_priority, r.size, r.energy, r.energy_level, r.tags_json, r.attachments_json,
    r.checklist_json, r.checklists_json, r.comments_json, r.toast_messages_json,
    r.trello_sync_enabled, r.gcal_event_id, r.gcal_duration,
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
  upsertTask(merged)
  return getTask(id)
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

// Sync the full tasks array — used by setAllData (bulk sync from client)
// Wrapped in a transaction for performance (single commit instead of N)
function syncTasksFromArray(tasksArray) {
  if (!Array.isArray(tasksArray)) return

  db.run('BEGIN TRANSACTION')
  try {
    const existingIds = new Set()
    const stmt = db.prepare('SELECT id FROM tasks')
    while (stmt.step()) {
      existingIds.add(stmt.getAsObject().id)
    }
    stmt.free()

    const incomingIds = new Set()
    for (const task of tasksArray) {
      if (!task.id) continue
      incomingIds.add(task.id)
      runUpsertTask(task)
    }

    for (const id of existingIds) {
      if (!incomingIds.has(id)) {
        db.run('DELETE FROM tasks WHERE id = ?', [id])
      }
    }
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

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
  }
}

// ============================================================
// Routine CRUD operations
// ============================================================

const UPSERT_ROUTINE_SQL = `
  INSERT INTO routines (id, title, cadence, custom_days, notes, high_priority,
    energy, energy_level, notion_page_id, notion_url, created_at, paused,
    tags_json, completed_history_json, end_date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, cadence=excluded.cadence, custom_days=excluded.custom_days,
    notes=excluded.notes, high_priority=excluded.high_priority, energy=excluded.energy,
    energy_level=excluded.energy_level, notion_page_id=excluded.notion_page_id,
    notion_url=excluded.notion_url, created_at=excluded.created_at, paused=excluded.paused,
    tags_json=excluded.tags_json, completed_history_json=excluded.completed_history_json,
    end_date=excluded.end_date`

function runUpsertRoutine(routine) {
  const r = routineToRow(routine)
  db.run(UPSERT_ROUTINE_SQL, [
    r.id, r.title, r.cadence, r.custom_days, r.notes, r.high_priority,
    r.energy, r.energy_level, r.notion_page_id, r.notion_url, r.created_at, r.paused,
    r.tags_json, r.completed_history_json, r.end_date,
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

// Sync the full routines array — used by setAllData (bulk sync from client)
function syncRoutinesFromArray(routinesArray) {
  if (!Array.isArray(routinesArray)) return

  db.run('BEGIN TRANSACTION')
  try {
    const existingIds = new Set()
    const stmt = db.prepare('SELECT id FROM routines')
    while (stmt.step()) {
      existingIds.add(stmt.getAsObject().id)
    }
    stmt.free()

    const incomingIds = new Set()
    for (const routine of routinesArray) {
      if (!routine.id) continue
      incomingIds.add(routine.id)
      runUpsertRoutine(routine)
    }

    for (const id of existingIds) {
      if (!incomingIds.has(id)) {
        db.run('DELETE FROM routines WHERE id = ?', [id])
      }
    }
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}
