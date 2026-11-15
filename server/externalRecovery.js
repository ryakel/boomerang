// Operation-specific evidence. No credentials or raw provider responses persist.
import { createHash, randomBytes } from 'node:crypto'
import { executionKey, getExecution, saveExecution, getRecoveryState, saveRecoveryState } from './executionJournal.js'

const calendarBase = 'https://www.googleapis.com/calendar/v3/calendars'
const trelloBase = 'https://api.trello.com/1'
const fields = ['summary', 'description', 'start', 'end']
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const key = (id, step) => `external:${id}:${step}`
const noEffect = message => Object.assign(new Error(message), { code: 'NO_EFFECT' })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const pick = (value, names) => Object.fromEntries(names.map(name => [name, value[name] ?? null]))
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, k === 'dateTime' && Number.isFinite(Date.parse(value[k])) ? new Date(value[k]).toISOString() : normalized(value[k])]))
  return value ?? null
}
function matches(value, expected) {
  return Object.entries(expected).every(([name, wanted]) => {
    const actual = value?.[name]
    if (name === 'dateTime') return Number.isFinite(Date.parse(actual)) && Date.parse(actual) === Date.parse(wanted)
    if (wanted && typeof wanted === 'object') return matches(actual, wanted)
    return same(normalized(actual), normalized(wanted)) || (name === 'description' && !actual && !wanted)
  })
}
function calendarUrl(desc) { return `${calendarBase}/${encodeURIComponent(desc.calendarId)}/events/${encodeURIComponent(desc.eventId)}` }
function auth(deps) {
  if (!deps.gcalToken) throw noEffect('Google Calendar is not connected.')
  return { Authorization: `Bearer ${deps.gcalToken}`, 'Content-Type': 'application/json' }
}
async function jsonRequest(url, init = {}) {
  const res = await fetch(url, { ...init, signal: init.signal || AbortSignal.timeout(15000) })
  let data = null
  try { data = await res.json() } catch { /* 204 or provider non-JSON */ }
  return { status: res.status, ok: res.ok, data }
}
async function readCalendar(desc, deps) {
  const response = await jsonRequest(calendarUrl(desc), { headers: auth(deps) })
  if ([404, 410].includes(response.status)) return null
  if (!response.ok || !response.data?.id) throw new Error('Calendar readback unavailable')
  return response.data
}
function stored(ctx, desc) {
  saveRecoveryState(key(ctx.record.executionId, ctx.step.stepId), desc)
}
function publish(ctx, desc) {
  stored(ctx, desc)
  const result = ctx.record.results[ctx.index]
  result.evidence = desc.kind === 'trello_checklist'
    ? { service: 'Trello', checklistId: desc.checklistId || null, itemIds: desc.itemIds, phase: desc.phase, cleanup: desc.cleanup || null, uncertainItem: desc.uncertainItem ?? null }
    : { service: 'Calendar', eventId: desc.eventId, calendarId: desc.calendarId, phase: desc.phase }
  result.undoAvailable = ['calendar_create','calendar_update'].includes(desc.kind) && desc.phase === 'applied' && !!desc.afterEtag
  ctx.record.stopRequested ||= getExecution(ctx.record.executionId)?.stopRequested || false
  saveExecution(ctx.record)
}
function context(deps) {
  if (!deps.execution) throw noEffect('A recorded execution is required.')
  return deps.execution
}
export function stampCalendarCreate(input) {
  const id = `b${randomBytes(20).toString('hex')}` // Google base32hex-compatible ID
  return { id, input: { ...input, event_id: id } }
}
export async function stageCalendarUpdate(input, deps, session) {
  const created = session.plan.find(s => s.toolName === 'gcal_create_event' && s.input.event_id === input.event_id)
  if (created) return { createdByStep: created.stepId }
  const desc = { calendarId: input.calendar_id || 'primary', eventId: input.event_id }
  try {
    const before = await readCalendar(desc, deps)
    return { etag: before?.etag || null }
  } catch { return { etag: null } }
}
function marker(ctx) { return hash([ctx.record.executionId, ctx.step.stepId]) }

export async function createCalendar(input, deps) {
  const headers = auth(deps)
  const ctx = context(deps)
  const desc = { kind: 'calendar_create', calendarId: input.calendar_id || 'primary', eventId: input.event_id,
    marker: marker(ctx), expected: { summary: input.summary, description: input.description || '', start: input.start, end: input.end }, phase: 'dispatching' }
  if (!/^b[0-9a-f]{40}$/.test(desc.eventId || '')) throw noEffect('Review a fresh Calendar create plan.')
  publish(ctx, desc) // identity and intent before POST
  try {
    const response = await jsonRequest(`${calendarBase}/${encodeURIComponent(desc.calendarId)}/events`, {
      method: 'POST', headers, body: JSON.stringify({ id: desc.eventId, ...desc.expected,
        extendedProperties: { private: { boomerangOrigin: desc.marker } } }),
    })
    if (!response.ok) throw new Error('Calendar create outcome needs checking')
    desc.writeEtag = response.data?.etag || null
    publish(ctx, desc)
    const after = await readCalendar(desc, deps)
    if (!after || after.extendedProperties?.private?.boomerangOrigin !== desc.marker || !matches(after, desc.expected) || !desc.writeEtag || after.etag !== desc.writeEtag) throw new Error('Calendar create readback did not match')
    desc.afterEtag = after.etag
    desc.phase = 'applied'
    publish(ctx, desc)
    return { result: { event_id: desc.eventId }, verified: true, compensation: () => compensateCalendar(ctx, deps) }
  } catch { throw new Error('Calendar create outcome needs checking') }
}

export async function updateCalendar(input, deps) {
  const ctx = context(deps)
  const desc = { kind: 'calendar_update', calendarId: input.calendar_id || 'primary', eventId: input.event_id, marker: marker(ctx), phase: 'prepared' }
  let before
  try { before = await readCalendar(desc, deps) } catch { throw noEffect('Calendar could not be checked before update.') }
  let expectedEtag = ctx.step.externalGuard?.etag
  if (ctx.step.externalGuard?.createdByStep) expectedEtag = getRecoveryState(key(ctx.record.executionId, ctx.step.externalGuard.createdByStep))?.afterEtag
  if (!before?.etag || expectedEtag !== before.etag) throw noEffect('Calendar changed or lacks a safe revision. Review a fresh plan.')
  desc.expected = Object.fromEntries(fields.filter(name => input[name] !== undefined).map(name => [name, input[name]]))
  if (!Object.keys(desc.expected).length) throw noEffect('No Calendar fields were requested.')
  desc.before = pick(before, Object.keys(desc.expected))
  desc.beforeEtag = before.etag
  desc.beforeOperation = before.extendedProperties?.private?.boomerangOperation || null
  desc.phase = 'dispatching'
  publish(ctx, desc)
  const patch = { ...desc.expected, extendedProperties: { private: { ...before.extendedProperties?.private, boomerangOperation: desc.marker } } }
  let response
  try { response = await jsonRequest(calendarUrl(desc), { method: 'PATCH', headers: { ...auth(deps), 'If-Match': before.etag }, body: JSON.stringify(patch) }) }
  catch { throw new Error('Calendar update outcome needs checking') }
  if (response.status === 412) {
    desc.phase = 'no_effect'
    publish(ctx, desc)
    throw noEffect('Calendar changed before the update. Review it again.')
  }
  if (!response.ok) throw new Error('Calendar update outcome needs checking')
  desc.writeEtag = response.data?.etag || null
  publish(ctx, desc)
  const after = await readCalendar(desc, deps)
  if (!desc.writeEtag || after?.etag !== desc.writeEtag || after.extendedProperties?.private?.boomerangOperation !== desc.marker || !matches(after, desc.expected)) throw new Error('Calendar update could not be verified')
  desc.afterEtag = after.etag
  desc.phase = 'applied'
  publish(ctx, desc)
  return { result: { event_id: desc.eventId, updated: true }, verified: true, compensation: () => compensateCalendar(ctx, deps) }
}

async function calendarUndo(desc, deps, checkpoint) {
  const current = await readCalendar(desc, deps)
  if (!current || current.etag !== desc.afterEtag || !matches(current, desc.expected)) throw new Error('Calendar Undo conflicts with a later change.')
  desc.phase = 'undoing'
  desc.undoMarker = hash([desc.marker, 'undo'])
  checkpoint()
  const creating = desc.kind === 'calendar_create'
  const patch = creating ? undefined : { ...desc.before, extendedProperties: { private: {
    ...current.extendedProperties?.private, boomerangOperation: desc.beforeOperation, boomerangUndo: desc.undoMarker,
  } } }
  // A lost acknowledgement is reconciled by readback, never by replaying PATCH.
  let response
  try { response = await jsonRequest(calendarUrl(desc), { method: creating ? 'DELETE' : 'PATCH', headers: { ...auth(deps), 'If-Match': current.etag }, ...(patch ? { body: JSON.stringify(patch) } : {}) }) }
  catch { /* request may have applied */ }
  if (response?.status === 412) { desc.phase = 'applied'; checkpoint(); throw new Error('Calendar changed before Undo.') }
  const after = await readCalendar(desc, deps)
  const verified = creating ? after === null : after?.extendedProperties?.private?.boomerangUndo === desc.undoMarker && matches(after, desc.before)
  if (!verified) throw new Error('Calendar Undo outcome could not be verified.')
  desc.phase = 'undone'
  checkpoint()
  return { verified: true }
}
async function compensateCalendar(ctx, deps) {
  const desc = getRecoveryState(key(ctx.record.executionId, ctx.step.stepId))
  return calendarUndo(desc, deps, () => publish(ctx, desc))
}

export async function reconcileExternal(executionId, stepId, deps) {
  let record = getExecution(executionId)
  const desc = getRecoveryState(key(executionId, stepId))
  if (!record || !desc || ['running','stopping','checking','undoing'].includes(record.state)) return { ok: false, error: 'Wait for the current request to settle.' }
  const priorState = record.state
  record.state = 'checking'
  saveExecution(record)
  const index = record.results.findIndex(s => s.stepId === stepId)
  const ctx = { record, step: { stepId }, index }
  try {
    if (desc.kind === 'trello_checklist') {
      await inspectChecklist(desc, deps)
      if (desc.phase === 'undone') Object.assign(record.results[index], { state: 'verified_undone', ok: false })
    } else {
      const current = await readCalendar(desc, deps)
      const undo = ['undoing','undone'].includes(desc.phase)
      if (undo && (desc.kind === 'calendar_create' ? !current : current?.extendedProperties?.private?.boomerangUndo === desc.undoMarker && matches(current, desc.before))) {
        desc.phase = 'undone'
        Object.assign(record.results[index], { state: 'verified_undone', ok: false })
      } else if (!undo && current?.etag && matches(current, desc.expected) &&
        current.extendedProperties?.private?.[desc.kind === 'calendar_create' ? 'boomerangOrigin' : 'boomerangOperation'] === desc.marker) {
        desc.phase = 'applied'
        if (desc.writeEtag && desc.writeEtag === current.etag) desc.afterEtag = desc.writeEtag
        Object.assign(record.results[index], { state: 'verified_applied', ok: true, result: { event_id: desc.eventId } })
      }
    }
    const unresolved = record.results.some(s => ['unknown','compensation_unverified','executing','compensating'].includes(s.state))
    record.state = unresolved ? 'needs_checking' : record.results.every(s => ['verified_undone','not_started'].includes(s.state)) ? 'undone' : record.results.some(s => s.state === 'verified_undone') ? 'partial' : record.results.every(s => ['verified_applied','reported_applied'].includes(s.state)) && !record.stopRequested ? 'completed' : 'stopped'
    record.ok = record.state === 'completed'
    record.error = unresolved ? 'Some effects remain uncertain. Check the service; no action will be retried automatically.' : undefined
    publish(ctx, desc)
    if (record.externalUndoId && desc.phase === 'undone') {
      const undoRecord = getExecution(record.externalUndoId)
      if (undoRecord?.results[0]?.stepId === stepId) {
        undoRecord.state = 'completed'; undoRecord.ok = true; undoRecord.error = undefined
        Object.assign(undoRecord.results[0], { state: 'verified_undone', ok: true })
        saveExecution(undoRecord)
      }
    }
    return record
  } catch {
    record.state = priorState
    saveExecution(record)
    return { ...record, error: 'Readback unavailable. The previous outcome remains unchanged; no mutation was retried.' }
  }
}

export async function previewExternalUndo(executionId, stepId, deps) {
  const record = getExecution(executionId)
  const desc = getRecoveryState(key(executionId, stepId))
  if (!record || !desc) return null
  let available = ['completed','stopped','modified','partial'].includes(record.state) && !record.results.some(s => ['unknown','executing','compensating','compensation_unverified'].includes(s.state)) && desc.phase === 'applied' && desc.kind.startsWith('calendar_') && !!desc.afterEtag
  let reason = available ? null : desc.phase === 'applied' && !desc.afterEtag ? 'The initial write revision could not be verified. Preserve possible later edits; use a new reviewed action for further changes.' : 'Check unresolved outcomes first. This operation may not support Undo.'
  let current = null
  if (available) {
    try { current = await readCalendar(desc, deps) } catch { reason = 'Calendar readback is unavailable.'; available = false }
    if (!current || current.etag !== desc.afterEtag || !matches(current, desc.expected)) { available = false; reason ||= 'Calendar changed after the action. Undo will preserve that change.' }
  }
  return { executionId, stepId, kind: desc.kind, target: desc.eventId, calendarId: desc.calendarId,
    label: desc.expected?.summary || desc.before?.summary || desc.eventId,
    action: desc.kind === 'calendar_create' ? 'Remove the created event' : 'Restore changed event fields',
    fields: Object.entries(desc.before || {}).map(([field, to]) => ({ field, from: desc.expected[field], to })),
    available, reason, revision: hash([executionId, stepId, record.sequence, desc.phase, current?.etag]),
    warning: 'Undo cannot retract notifications or copies already delivered. Other actions in this plan remain unchanged.' }
}

export async function applyExternalUndo(executionId, stepId, revision, deps) {
  const sessionId = `external-undo:${executionId}:${stepId}`
  const existing = getExecution(executionKey(sessionId, revision))
  if (existing) return { ...existing, replayed: true }
  const preview = await previewExternalUndo(executionId, stepId, deps)
  if (!preview?.available || preview.revision !== revision) return { ok: false, state: 'conflict', error: 'Undo changed. Review it again.' }
  const original = getExecution(executionId)
  // Compare again after the asynchronous read. A competing transition wins once.
  const currentPreviewRevision = hash([executionId, stepId, original.sequence, 'applied', getRecoveryState(key(executionId, stepId))?.afterEtag])
  if (currentPreviewRevision !== revision || !['completed','stopped','modified','partial'].includes(original.state)) return { ok: false, state: 'conflict', error: 'Recovery changed. Review again.' }
  const undo = { executionId: executionKey(sessionId, revision), sessionId, revision, chatId: original.chatId, undoOf: executionId,
    state: 'running', ok: false, createdAt: new Date().toISOString(), results: [{ stepId, toolName: 'undo_calendar_event', state: 'executing', ok: false }] }
  const previousState = original.state
  const previouslyUndone = original.undoApplied
  original.results.find(s => s.stepId === stepId).state = 'compensating'
  original.state = 'undoing'
  original.undoApplied = true
  original.externalUndoId = undo.executionId
  saveExecution(undo)
  saveExecution(original)
  const index = original.results.findIndex(s => s.stepId === stepId)
  const ctx = { record: original, index, step: { stepId } }
  const desc = getRecoveryState(key(executionId, stepId))
  try {
    await calendarUndo(desc, deps, () => publish(ctx, desc))
    Object.assign(original.results[index], { state: 'verified_undone', ok: false, undoAvailable: false })
    original.state = original.results.every(s => ['verified_undone','not_started'].includes(s.state)) ? 'undone' : 'partial'
    original.ok = false
    Object.assign(undo.results[0], { state: 'verified_undone', ok: true })
    undo.state = 'completed'; undo.ok = true
  } catch {
    const notDispatched = desc.phase === 'applied'
    original.state = notDispatched ? previousState : 'needs_checking'
    original.ok = notDispatched && previousState === 'completed'
    original.undoApplied = notDispatched ? !!previouslyUndone : true
    original.results[index].state = notDispatched ? 'verified_applied' : 'unknown'
    undo.state = notDispatched ? 'conflict' : 'needs_checking'
    undo.results[0].state = notDispatched ? 'verified_no_effect' : 'unknown'
    undo.error = notDispatched ? 'Calendar changed or could not be checked before Undo. No inverse was applied; review again.' : 'Calendar Undo could not be verified. Check the outcome before acting again.'
  }
  publish(ctx, desc)
  saveExecution(undo)
  return undo
}

function trelloUrl(desc, deps, suffix = '') {
  if (!deps.trello?.key || !deps.trello?.token) throw noEffect('Trello is not connected.')
  return `${trelloBase}/checklists/${encodeURIComponent(desc.checklistId)}${suffix}?${new URLSearchParams(deps.trello)}`
}
async function inspectChecklist(desc, deps) {
  if (!desc.checklistId) throw new Error('Checklist identity was not returned; inspect the card manually.')
  const response = await jsonRequest(trelloUrl(desc, deps) + '&checkItems=all')
  if (response.status === 404) { desc.cleanup = 'verified_absent'; desc.phase = 'undone'; return null }
  if (!response.ok) throw new Error('Checklist readback unavailable')
  desc.cleanup = 'residual_present'
  return response.data
}
async function cleanupChecklist(ctx, desc, deps) {
  const current = await inspectChecklist(desc, deps)
  if (!current) { publish(ctx, desc); return { verified: true } }
  // Trello has no conditional DELETE. Do not offer durable Undo: this narrowly
  // bounds immediate failure cleanup to our unchanged just-created checklist.
  const items = current.checkItems || []
  if (current.name !== desc.name || items.length !== desc.itemIds.length || items.some((item, i) => item.id !== desc.itemIds[i] || item.name !== desc.items[i] || item.state === 'complete')) {
    desc.cleanup = 'conflict'; publish(ctx, desc); throw new Error('Checklist has unrecognized changes; preserve it.')
  }
  desc.phase = 'undoing'; publish(ctx, desc)
  const response = await jsonRequest(trelloUrl(desc, deps), { method: 'DELETE' })
  if (!response.ok && response.status !== 404) { desc.cleanup = 'delete_rejected'; publish(ctx, desc); throw new Error('Checklist cleanup rejected') }
  if (await inspectChecklist(desc, deps)) { publish(ctx, desc); throw new Error('Checklist remains after cleanup') }
  publish(ctx, desc)
  return { verified: true }
}
export async function createChecklist(input, deps) {
  const ctx = context(deps)
  if (!deps.trello?.key || !deps.trello?.token) throw noEffect('Trello is not connected.')
  const desc = { kind: 'trello_checklist', phase: 'dispatching', name: input.name, items: input.items || [], itemIds: [], checklistId: null }
  publish(ctx, desc)
  try {
    const response = await jsonRequest(`${trelloBase}/cards/${encodeURIComponent(input.card_id)}/checklists?${new URLSearchParams(deps.trello)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.name }),
    })
    if (!response.ok || !response.data?.id) throw new Error('Checklist identity unverified')
    desc.checklistId = response.data.id
    desc.phase = 'adding_items'; publish(ctx, desc)
    for (let index = 0; index < desc.items.length; index++) {
      if (getExecution(ctx.record.executionId)?.stopRequested) { desc.phase = 'stopped'; publish(ctx, desc); throw new Error('Checklist stopped between requests') }
      desc.uncertainItem = index; publish(ctx, desc)
      const response = await jsonRequest(trelloUrl(desc, deps, '/checkItems'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: desc.items[index], checked: 'false' }) })
      if (!response.ok || !response.data?.id) throw new Error('Checklist item outcome unverified')
      desc.itemIds.push(response.data.id); desc.uncertainItem = null; publish(ctx, desc)
    }
    desc.phase = 'applied'; publish(ctx, desc)
    return { result: { id: desc.checklistId, created: true }, compensation: () => cleanupChecklist(ctx, desc, deps) }
  } catch {
    if (desc.checklistId && !getExecution(ctx.record.executionId)?.stopRequested) {
      try { await cleanupChecklist(ctx, desc, deps) } catch { /* safe evidence includes residual */ }
    }
    publish(ctx, desc)
    throw Object.assign(new Error('Checklist did not finish; inspect recorded partial effects.'), { code: desc.phase === 'undone' ? 'VERIFIED_UNDONE' : undefined })
  }
}
