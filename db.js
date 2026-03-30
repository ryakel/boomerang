import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'

let db
let dbPath

export async function initDb(filePath) {
  dbPath = filePath

  // Ensure directory exists
  const dir = path.dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const SQL = await initSqlJs()

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS app_data (
      collection TEXT PRIMARY KEY,
      data_json TEXT NOT NULL
    )
  `)

  persist()
  return db
}

function persist() {
  const data = db.export()
  writeFileSync(dbPath, Buffer.from(data))
}

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
  persist()
}

export function getAllData() {
  const result = {}
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
    if (collection === '_clientId') continue // strip client metadata
    db.run(
      `INSERT INTO app_data (collection, data_json) VALUES (?, ?)
       ON CONFLICT(collection) DO UPDATE SET data_json = excluded.data_json`,
      [collection, JSON.stringify(value)]
    )
  }
  const newVersion = bumpVersion()
  persist()
  return newVersion
}

export function clearAllData() {
  db.run('DELETE FROM app_data')
  persist()
}
