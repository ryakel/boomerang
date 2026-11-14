// Durable evidence, never executable closures or automatic restart replay.
import crypto from 'node:crypto'

let connection
let persist
let poisoned = false
let transactionActive = false

export function configureExecutionJournal(db, flush) {
  connection = db
  persist = flush
  poisoned = false
  // A dispatch/compensation interrupted by process exit has an unknown outcome.
  const interrupted = connection.exec("SELECT receipt_json FROM adviser_executions WHERE state IN ('running','stopping')")
  for (const [json] of interrupted[0]?.values || []) {
    const record = JSON.parse(json)
    if (!['running', 'stopping'].includes(record.state)) continue
    record.state = record.results.some(s => ['executing', 'compensating'].includes(s.state)) ? 'needs_checking' : 'stopped'
    record.ok = false
    record.error = 'Execution was interrupted. Check the outcome before taking further action.'
    for (const step of record.results) {
      if (step.state === 'executing' || step.state === 'compensating') step.state = 'unknown'
    }
    saveExecution(record)
  }
}

export function executionIdentity(sessionId, plan) {
  const revision = crypto.createHash('sha256').update(JSON.stringify(plan.map(s => ({
    stepId: s.stepId, toolName: s.toolName, input: s.input, localGuard: s.localGuard,
  })))).digest('hex')
  return { revision, executionId: executionKey(sessionId, revision) }
}

export function executionKey(sessionId, revision) {
  return crypto.createHash('sha256').update(`${sessionId}:${revision}`).digest('hex')
}

function readable(record) {
  return poisoned ? {
    ...record, ok: false, state: 'needs_checking',
    results: record.results.map(step => ['executing', 'compensating'].includes(step.state) ? { ...step, state: 'unknown', ok: false } : step),
    error: 'Execution storage is unavailable. Check the outcome before taking further action.',
  } : record
}

export function executionJournalReady() {
  if (!connection || poisoned) throw new Error('Execution records are unavailable. No new action can start.')
}

export function saveExecution(record) {
  executionJournalReady()
  if (transactionActive) throw new Error('Use updateExecution during a local transaction')
  try {
    writeRecord(record)
    persist()
  } catch (error) {
    poisoned = true
    throw error
  }
}

function writeRecord(record) {
  record.sequence = (record.sequence || 0) + 1
  record.updatedAt = new Date().toISOString()
  connection.run(`INSERT INTO adviser_executions
      (id, session_id, chat_id, revision, state, receipt_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,
        receipt_json=excluded.receipt_json, updated_at=excluded.updated_at`,
    [record.executionId, record.sessionId, record.chatId, record.revision, record.state,
      JSON.stringify(record), record.createdAt, record.updatedAt])
}

export function updateExecution(record) {
  if (!transactionActive) throw new Error('A local transaction is required')
  writeRecord(record)
}

// Only synchronous local operations may share this transaction. No awaited
// tool/network work can capture another request's writes on the shared DB.
export function executionTransaction(record, mutate) {
  executionJournalReady()
  if (transactionActive) throw new Error('Nested execution transaction')
  connection.run('BEGIN')
  transactionActive = true
  let committed = false
  try {
    const result = mutate()
    if (result?.then) throw new Error('Local recovery must be synchronous')
    writeRecord(record)
    connection.run('COMMIT')
    committed = true
    persist()
    return result
  } catch (error) {
    if (!committed) connection.run('ROLLBACK')
    else poisoned = true
    throw error
  } finally { transactionActive = false }
}

export function getExecution(id) {
  if (!connection) return null
  const stmt = connection.prepare('SELECT receipt_json FROM adviser_executions WHERE id = ?')
  try {
    stmt.bind([id])
    return stmt.step() ? readable(JSON.parse(stmt.getAsObject().receipt_json)) : null
  } finally { stmt.free() }
}

export function listExecutions({ chatId, sessionId, limit = 50 } = {}) {
  if (!connection) return []
  const clauses = []
  const args = []
  if (chatId) { clauses.push('chat_id = ?'); args.push(chatId) }
  if (sessionId) { clauses.push('session_id = ?'); args.push(sessionId) }
  const stmt = connection.prepare(`SELECT receipt_json FROM adviser_executions
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY ${chatId ? "CASE WHEN state IN ('running','needs_checking','partial','conflict') THEN 0 ELSE 1 END," : ''} rowid DESC LIMIT ?`)
  try {
    stmt.bind([...args, Math.min(Math.max(Number(limit) || 50, 1), 10000)])
    const records = []
    while (stmt.step()) records.push(readable(JSON.parse(stmt.getAsObject().receipt_json)))
    return records
  } finally { stmt.free() }
}

// Private state shares the journal's fail-closed checkpoint policy. Never store
// dependency bags (tokens, clients or request objects) or executable closures.
export function saveRecoveryState(id, value) {
  executionJournalReady()
  try {
    connection.run('INSERT INTO adviser_recovery_state(id,data_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json', [id, JSON.stringify(value)])
    persist()
  } catch (error) { poisoned = true; throw error }
}
export function getRecoveryState(id) {
  if (!connection) return null
  const stmt = connection.prepare('SELECT data_json FROM adviser_recovery_state WHERE id=?')
  try { stmt.bind([id]); return stmt.step() ? JSON.parse(stmt.getAsObject().data_json) : null }
  finally { stmt.free() }
}
