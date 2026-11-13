import { createHash } from 'node:crypto'
import { executionKey, executionTransaction, getExecution, saveExecution, updateExecution } from './executionJournal.js'

let connection
let isCritical
export function configureLocalRecovery(db, crisisPredicate) { connection = db; isCritical = crisisPredicate }
const fields = { task: ['title', 'notes', 'due_date'], note: ['body', 'pinned'] }
const tables = { task: 'tasks', note: 'notes' }
const operations = {
  create_task: ['task', 'create'], update_task: ['task', 'update'],
  create_note: ['note', 'create'], update_note: ['note', 'update'],
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const settings = () => JSON.parse(query("SELECT data_json FROM app_data WHERE collection='settings'")[0]?.data_json || '{}')
function query(sql, args = []) {
  const stmt = connection.prepare(sql)
  try {
    stmt.bind(args)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    return rows
  } finally { stmt.free() }
}
function row(kind, id) { return query(`SELECT * FROM ${tables[kind]} WHERE id = ?`, [id])[0] || null }
function version(kind, id, field) {
  return query('SELECT version FROM adviser_entity_versions WHERE kind=? AND entity_id=? AND field=?', [kind, id, field])[0]?.version || 0
}
function recoverable(kind, value) {
  if (!value) return false
  if (kind === 'note') return true
  const linked = ['notion_page_id', 'trello_card_id', 'gcal_event_id', 'routine_id', 'parent_id', 'pushover_receipt', 'reminders_id']
  if (linked.some(key => value[key])) return false
  if (JSON.parse(value.knowledge_page_ids_json || '[]').length) return false
  return !isCritical({ tags: JSON.parse(value.tags_json || '[]') }, settings())
}

export function stageLocalGuard(name, input, session) {
  const operation = operations[name]
  if (!operation) return null
  const [kind, action] = operation
  const selected = action === 'create' ? ['*'] : Object.keys(input).filter(key => key !== 'id')
  const value = row(kind, input.id)
  const creator = !value && session.plan.find(step => operations[step.toolName]?.[1] === 'create' && step.input.id === input.id)
  const createdByPlan = !!creator
  const supported = action === 'create'
    ? kind === 'note' || ((!input.status || input.status === 'not_started') && !input.parent_id && !input.due_date &&
      (!input.tags || Array.isArray(input.tags)) && !isCritical({ tags: input.tags }, settings()) && !input.nag_allowed)
    : selected.length > 0 && selected.every(key => fields[kind].includes(key)) && (creator?.localGuard?.supported || recoverable(kind, value))
  const guardedFields = supported ? selected : ['*']
  return { kind, action, id: input.id, supported, createdByPlan,
    expected: Object.fromEntries(guardedFields.map(field => [field, version(kind, input.id, field)])) }
}

export function trackLocalWrite(guard, owned) {
  const key = `${guard.kind}:${guard.id}`
  const own = owned.get(key) || {}
  if (guard.action === 'create') own.created = true
  for (const field of ['*', ...fields[guard.kind]]) own[field] = version(guard.kind, guard.id, field)
  owned.set(key, own)
}

export function checkLocalGuard(guard, owned = new Map()) {
  if (!guard) return
  const key = `${guard.kind}:${guard.id}`
  const own = owned.get(key)
  const stale = () => Object.assign(new Error('This record changed. Review a fresh plan.'), { code: 'STALE_PLAN' })
  if (own?.created && version(guard.kind, guard.id, '*') !== own['*']) throw stale()
  for (const [field, expected] of Object.entries(guard.expected)) {
    if (version(guard.kind, guard.id, field) !== (own?.[field] ?? expected)) throw stale()
  }
}

function undoRows(executionId) {
  return query('SELECT * FROM adviser_local_undo WHERE execution_id=? ORDER BY position DESC', [executionId])
    .map(r => ({ ...r, before: JSON.parse(r.before_json), after: JSON.parse(r.after_json), versions: JSON.parse(r.versions_json) }))
}

export function runLocalStep(record, index, step, tool, owned) {
  const guard = step.localGuard
  return executionTransaction(record, () => {
    checkLocalGuard(guard, owned)
    if (tool.execute.constructor.name === 'AsyncFunction') throw new Error('An async tool cannot enter local recovery')
    const before = row(guard.kind, guard.id)
    if (guard.action === 'update' && !recoverable(guard.kind, before)) throw new Error('Local recovery is unavailable for this connected task.')
    const outcome = tool.execute(step.input, { suppressBroadcast: true })
    if (outcome?.then) throw new Error('Local execution must be synchronous')
    const after = row(guard.kind, guard.id)
    if (!recoverable(guard.kind, after)) throw new Error('Local recovery is unavailable for this task.')
    const changed = guard.action === 'create' ? fields[guard.kind] : Object.keys(guard.expected)
    const beforeValues = Object.fromEntries(changed.map(field => [field, before?.[field] ?? null]))
    const afterValues = Object.fromEntries(changed.map(field => [field, after[field]]))
    const versions = Object.fromEntries((guard.action === 'create' ? ['*'] : changed).map(field => [field, version(guard.kind, guard.id, field)]))
    connection.run(`INSERT INTO adviser_local_undo
      (execution_id,step_id,position,kind,entity_id,action,before_json,after_json,versions_json)
      VALUES (?,?,?,?,?,?,?,?,?)`, [record.executionId, step.stepId, index, guard.kind, guard.id,
      guard.action, JSON.stringify(beforeValues), JSON.stringify(afterValues), JSON.stringify(versions)])
    const key = `${guard.kind}:${guard.id}`
    const own = owned.get(key) || {}
    if (guard.action === 'create') own.created = true
    for (const field of changed) own[field] = version(guard.kind, guard.id, field)
    own['*'] = version(guard.kind, guard.id, '*')
    owned.set(key, own)
    // A create followed by our own updates may still be undone as one batch.
    for (const create of undoRows(record.executionId).filter(r => r.kind === guard.kind && r.entity_id === guard.id && r.action === 'create')) {
      connection.run('UPDATE adviser_local_undo SET versions_json=? WHERE execution_id=? AND step_id=?',
        [JSON.stringify({ '*': own['*'] }), record.executionId, create.step_id])
    }
    Object.assign(record.results[index], { state: 'reported_applied', ok: true, undoAvailable: true,
      result: { id: guard.id } })
    return { ...outcome, compensation: () => compensateLocal(record, step.stepId) }
  })
}

function createConflict(inverse, value) {
  if (!value || !recoverable(inverse.kind, value)) return 'The record is missing or has external connections.'
  if (inverse.kind === 'task') {
    if (value.due_date || value.remind_at || value.nag_allowed) return 'This task may have scheduled or in-flight reminders.'
    const referenced = query('SELECT id FROM tasks WHERE parent_id=? LIMIT 1', [inverse.entity_id]).length ||
      query('SELECT blocked_by_json FROM tasks WHERE id<>?', [inverse.entity_id]).some(task => JSON.parse(task.blocked_by_json || '[]').includes(inverse.entity_id))
    if (referenced || query('SELECT id FROM notification_log WHERE task_id=? LIMIT 1', [inverse.entity_id]).length) return 'This task has later dependencies or notification history.'
  }
  return null
}

function previewRows(rows) {
  const seen = new Set()
  const simulated = new Map()
  return rows.map(inverse => {
    const value = row(inverse.kind, inverse.entity_id)
    let reason = !value ? 'The record no longer exists.' : null
    if (!reason && !recoverable(inverse.kind, value)) reason = 'This task has external connections or critical behavior.'
    for (const [field, expected] of Object.entries(inverse.versions)) {
      const key = `${inverse.kind}:${inverse.entity_id}:${field}`
      if (!seen.has(key) && version(inverse.kind, inverse.entity_id, field) !== expected) reason = 'This record was edited after the original action.'
      seen.add(key)
    }
    if (inverse.action === 'create') reason ||= createConflict(inverse, value)
    for (const [field, expected] of Object.entries(inverse.after)) {
      const key = `${inverse.kind}:${inverse.entity_id}:${field}`
      const current = simulated.has(key) ? simulated.get(key) : value?.[field]
      if (current !== expected) reason ||= 'The recorded changes no longer match.'
      simulated.set(key, inverse.before[field])
    }
    return { stepId: inverse.step_id, kind: inverse.kind, action: inverse.action, targetId: inverse.entity_id,
      targetLabel: String(value?.title || value?.body || inverse.entity_id).slice(0, 100),
      available: !reason, reason, fields: inverse.action === 'create' ? [] : Object.keys(inverse.before).map(field => ({ field, from: inverse.after[field], to: inverse.before[field] })) }
  })
}

export function previewLocalUndo(executionId) {
  const original = getExecution(executionId)
  if (!original) return null
  const rows = undoRows(executionId).filter(r => r.status === 'available')
  const actions = previewRows(rows)
  const allowed = original.state === 'completed'
  if (!allowed) for (const action of actions) { action.available = false; action.reason = 'Check unresolved execution outcomes before Undo.' }
  const unsupported = original.results.filter(step => !rows.some(r => r.step_id === step.stepId) && step.state !== 'verified_undone').map(step => step.toolName)
  if (unsupported.length) for (const action of actions) {
    if (action.action === 'create') { action.available = false; action.reason = 'Other actions may refer to this created record. Review those effects first.' }
  }
  const revision = hash({ executionId, state: original.state, actions,
    versions: rows.map(r => Object.keys(r.versions).map(field => version(r.kind, r.entity_id, field))) })
  return { executionId, revision, actions, unsupported,
    available: allowed && actions.length > 0 && actions.every(action => action.available) }
}

function restore(inverse) {
  if (inverse.action === 'create') connection.run(`DELETE FROM ${tables[inverse.kind]} WHERE id=?`, [inverse.entity_id])
  else {
    const names = Object.keys(inverse.before)
    if (names.some(field => !fields[inverse.kind].includes(field))) throw new Error('Unsupported inverse fields')
    connection.run(`UPDATE ${tables[inverse.kind]} SET ${names.map(field => `${field}=?`).join(',')} WHERE id=?`,
      [...names.map(field => inverse.before[field]), inverse.entity_id])
  }
  const current = row(inverse.kind, inverse.entity_id)
  if (inverse.action === 'create' ? !!current : Object.entries(inverse.before).some(([field, value]) => current?.[field] !== value)) {
    throw new Error('Restoration did not match the expected local state')
  }
  connection.run("UPDATE adviser_local_undo SET status='undone' WHERE execution_id=? AND step_id=?", [inverse.execution_id, inverse.step_id])
}

function compensateLocal(record, stepId) {
  const inverses = undoRows(record.executionId)
  const inverse = inverses.find(r => r.step_id === stepId && r.status === 'available')
  if (inverse?.action === 'create' && record.results.some(step => step.stepId !== stepId &&
    !inverses.some(r => r.step_id === step.stepId) && !['not_started', 'verified_undone'].includes(step.state))) {
    throw new Error('An uncertain external effect may refer to this created record')
  }
  if (!inverse || !previewRows([inverse])[0].available) throw new Error('Restoration conflicts with a later edit')
  return executionTransaction(record, () => {
    restore(inverse)
    // Advance earlier inverse preconditions only for fields this inverse owns.
    for (const earlier of undoRows(record.executionId).filter(r => r.status === 'available' && r.kind === inverse.kind && r.entity_id === inverse.entity_id)) {
      for (const field of Object.keys(earlier.versions)) {
        if (field === '*' || field in inverse.before) earlier.versions[field] = version(earlier.kind, earlier.entity_id, field)
      }
      connection.run('UPDATE adviser_local_undo SET versions_json=? WHERE execution_id=? AND step_id=?', [JSON.stringify(earlier.versions), record.executionId, earlier.step_id])
    }
    return { verified: true }
  })
}

export function applyLocalUndo(executionId, revision) {
  const sessionId = `undo:${executionId}`
  const existing = getExecution(executionKey(sessionId, revision))
  if (existing) return { ...existing, replayed: true }
  const preview = previewLocalUndo(executionId)
  if (!preview?.available || revision !== preview.revision) return { ok: false, state: 'conflict', error: 'Undo changed or conflicts with a later edit. Review it again.' }
  const original = getExecution(executionId)
  const rows = undoRows(executionId).filter(r => r.status === 'available')
  const record = { executionId: executionKey(sessionId, revision), revision, sessionId, chatId: original.chatId,
    undoOf: executionId, state: 'running', ok: false, createdAt: new Date().toISOString(),
    results: rows.map(r => ({ stepId: r.step_id, toolName: `undo_${r.kind}`, state: 'not_started', ok: false })) }
  try {
    saveExecution(record)
    return executionTransaction(record, () => {
      if (!previewLocalUndo(executionId)?.available) throw new Error('Undo conflict')
      rows.forEach((inverse, index) => {
        restore(inverse)
        Object.assign(record.results[index], { state: 'verified_undone', ok: true })
        const step = original.results.find(s => s.stepId === inverse.step_id)
        Object.assign(step, { state: 'verified_undone', ok: false, undoAvailable: false })
      })
      original.state = original.results.every(r => r.state === 'verified_undone') ? 'undone' : 'partial'
      original.ok = false
      original.undoApplied = true
      updateExecution(original)
      record.state = 'completed'
      record.ok = true
      return record
    })
  } catch {
    return { ...record, state: 'needs_checking', ok: false, error: 'Undo could not be verified. Check the result before taking further action.' }
  }
}
