// adviserTools.js — AI Adviser tool registry + staged-execution engine.
//
// Design:
// - Tools are registered via `registerTool({ name, description, schema, readOnly, preview, execute })`.
// - readOnly tools run immediately during the model's reasoning loop and return data.
// - Mutation tools (readOnly: false) are STAGED: the model sees a confirmation string,
//   but nothing actually mutates until the user calls /api/adviser/commit.
// - On commit, a durable revision/receipt prevents duplicate dispatch. Steps
//   run in order; compensation remains best effort and is never verified Undo.
// - One coalesced SSE broadcast fires after the whole plan commits (prevents storm).
//
// Chat-runner sessions remain in memory with a 10-minute TTL. Execution receipts
// persist separately and survive session expiry, abort and process restart.
//
// Background-runner support (2026-05-17, "F" branch):
// - The chat tool-use loop runs as a detached async task tied to the session
//   (`session.runnerState` + `session.runnerPromise`). Closing the HTTP
//   connection doesn't abort it.
// - Events fan out via `appendEvent`: pushed onto `session.events` AND
//   streamed to every connected subscriber (SSE response object).
// - New SSE connections SUBSCRIBE via `subscribeSession` which replays the
//   buffered events first, then pipes live events as they happen.
// - TTL extends to whichever of (a) idle 10 min from last activity, (b) the
//   runner is running, or (c) the runner is awaiting_confirm and < 30 min
//   since plan staged. Stale `awaiting_confirm` plans get auto-aborted so
//   compensation can't bring back data from hours ago.
// - Queued messages: while `runnerState in ('running', 'awaiting_confirm')`,
//   a new message arriving is appended to `session.queue` instead of
//   starting a new turn. The queue advances after the runner returns to
//   `idle` (no plan staged) or after the user commits/aborts a plan.

import crypto from 'crypto'
import { stageLocalGuard, checkLocalGuard, runLocalStep, trackLocalWrite } from './localRecovery.js'
import { executionIdentity, executionKey, executionJournalReady, getExecution, listExecutions, saveExecution, saveRecoveryState, getRecoveryState } from './executionJournal.js'

const SESSION_IDLE_TTL_MS = 10 * 60 * 1000     // idle session timeout
const SESSION_AWAITING_TTL_MS = 30 * 60 * 1000 // max time a staged plan can wait before auto-abort
const EVENT_BUFFER_CAP = 500                    // per-session event cap so a runaway loop doesn't blow memory

const tools = new Map() // name -> tool def
// session = {
//   plan, createdAt, aborted, lastActivityAt,
//   events: [{type, data}], subscribers: Set<{res, lastSent}>,
//   runnerState: 'idle' | 'running' | 'awaiting_confirm' | 'committed' | 'errored' | 'aborted',
//   queue: [{message, history, deps}],
//   chatId, runnerPromise,
// }
const sessions = new Map() // sessionId -> session
// Module-level subscription to plan-ready events. The push-notification
// dispatcher in server.js sets this to fire a notification when a plan
// transitions to awaiting_confirm with no live subscribers. Keeping the
// callback module-local instead of a circular import.
let planReadyHandler = null
export function onPlanReady(handler) { planReadyHandler = handler }

// Periodic cleanup of stale sessions. Honors three TTLs:
// - idle (10 min since last activity): default — runner is idle
// - awaiting (30 min cap on a staged plan): force-abort to prevent the
//   compensation system from reverting hours-old state
// - running: never expire; the runner manages its own progress
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (s.runnerState === 'running' || s.committing || s.runnerState === 'stopped') continue
    const idleFor = now - (s.lastActivityAt || s.createdAt)
    if (s.runnerState === 'awaiting_confirm') {
      if (idleFor > SESSION_AWAITING_TTL_MS) {
        s.aborted = true
        appendEvent(id, { type: 'error', data: { message: 'Staged plan expired (30-min cap). Re-prompt to try again.' } })
        setRunnerState(id, 'aborted')
        sessions.delete(id)
      }
      continue
    }
    if (idleFor > SESSION_IDLE_TTL_MS) sessions.delete(id)
  }
}, 60 * 1000).unref?.()

// --- Event buffer + subscriber fan-out --------------------------------

export function appendEvent(sessionId, event) {
  const session = sessions.get(sessionId)
  if (!session) return
  event = { ...event, sequence: ++session.eventSequence }
  session.events.push(event)
  // Snapshot accumulates the current turn independently of the bounded log.
  if (event.type === 'turn' && event.data.n === 1) session.turnEvents = []
  if (['message','tool_call','tool_result','plan','done'].includes(event.type)) session.turnEvents.push(event)
  // Keep response text and the authoritative plan; tool chatter can be dropped.
  if (session.turnEvents.length > 500) session.turnEvents = session.turnEvents.filter(e => e.type !== 'tool_call' && e.type !== 'tool_result')
  if (session.events.length > EVENT_BUFFER_CAP) {
    // Drop oldest events; subscribers may miss some on late reconnect.
    // 500-event cap is generous (a 15-turn loop with 10 tool calls per
    // turn = ~150 events; the cap covers ~3x that).
    session.events.shift()
  }
  session.lastActivityAt = Date.now()
  persistSession(sessionId, session)
  for (const sub of session.subscribers) {
    try {
      writeSSE(sub.res, event.type, { ...event.data, sequence: event.sequence })
      sub.lastSent = session.events.length
    } catch {
      session.subscribers.delete(sub)
    }
  }
}

function writeSSE(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  if (typeof res.flush === 'function') res.flush()
}

// Subscribe an SSE response to a session's event stream. Replays the
// buffered events first so the client catches up from any backgrounding,
// then continues live as new events arrive. Returns the subscriber
// handle so the caller can unsubscribe on disconnect.
export function subscribeSession(sessionId, res, cursor = 0, forceSnapshot = false) {
  const session = sessions.get(sessionId)
  if (!session) return null
  const sub = { res, lastSent: 0 }
  // Replay everything we have so far. Sub is registered AFTER replay so
  // it doesn't double-receive any events appended mid-replay (impossible
  // here since this is synchronous, but defensive).
  const delivery = sessionSnapshot(sessionId, cursor)
  if (delivery.gap || forceSnapshot) writeSSE(res, 'snapshot', delivery)
  for (const event of delivery.gap || forceSnapshot ? [] : delivery.events) {
    try { writeSSE(res, event.type, { ...event.data, sequence: event.sequence }) } catch { return null }
    sub.lastSent = session.events.length
  }
  session.subscribers.add(sub)
  return sub
}

export function unsubscribeSession(sessionId, sub) {
  const session = sessions.get(sessionId)
  if (session && sub) session.subscribers.delete(sub)
}

// State transition for the runner. Emits a `runner_state` event so
// subscribers (and the replay buffer) can show "thinking…", "plan
// ready", etc. Also triggers the push-notification handler when a plan
// becomes ready with no live subscribers.
export function setRunnerState(sessionId, state) {
  const session = sessions.get(sessionId)
  if (!session) return
  const previous = session.runnerState
  if (previous === state) return
  session.runnerState = state
  appendEvent(sessionId, { type: 'runner_state', data: { state, previous } })

  if (state === 'awaiting_confirm' && session.subscribers.size === 0 && planReadyHandler) {
    Promise.resolve()
      .then(() => planReadyHandler(sessionId, session))
      .catch(err => console.error('[Adviser] planReady handler failed:', err?.message))
  }
}

export function getSubscriberCount(sessionId) {
  const session = sessions.get(sessionId)
  return session ? session.subscribers.size : 0
}

export function registerTool(def) {
  if (!def?.name) throw new Error('Tool requires a name')
  if (tools.has(def.name)) throw new Error(`Tool already registered: ${def.name}`)
  tools.set(def.name, {
    name: def.name,
    description: def.description || '',
    schema: def.schema || { type: 'object', properties: {} },
    readOnly: !!def.readOnly,
    preview: def.preview || (() => `Will run ${def.name}`),
    execute: def.execute || (async () => ({ result: null })),
    // Optional preStage(input) hook: mutation tools that create a new
    // resource can use this to pre-stamp a real id at stage time and
    // return it to the model. Without pre-stamping, chained creates
    // (e.g. create_task project, then create_task sub with parent_id=X)
    // have no real id to reference — the model would otherwise hallucinate
    // ids or use stepId fragments, leading to commit failures.
    // Return shape: { id, input } where input is the augmented version
    // with the id stamped in.
    preStage: def.preStage || null,
    // Optional stagedValidate(input, session) hook: returns null if the
    // staging is valid, or an error string. Useful for "parent_id must
    // refer to a real task OR an earlier staged create" checks that
    // need to surface to the model during the chat loop rather than
    // blow up the whole plan at commit time.
    stagedValidate: def.stagedValidate || null,
  })
}

export function getTool(name) {
  return tools.get(name)
}

export function listToolSchemas() {
  // Shape for Anthropic tool-use: { name, description, input_schema }
  return Array.from(tools.values()).map(t => ({
    name: t.name,
    description: t.description + (t.readOnly ? '' : ' [MUTATION — staged for user approval]'),
    input_schema: t.schema,
  }))
}

// --- Session / plan management ---

export function newSession(opts = {}) {
  const id = crypto.randomUUID()
  sessions.set(id, {
    plan: [],
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    aborted: false,
    events: [], eventSequence: 0, turnEvents: [],
    subscribers: new Set(),
    runnerState: 'idle',
    runnerPromise: null,
    queue: [],
    chatId: opts.chatId || null,
  })
  persistSession(id, sessions.get(id))
  return id
}

export function attachChatId(sessionId, chatId) {
  const session = sessions.get(sessionId)
  if (session) session.chatId = chatId
}

// Enqueue a follow-up message arriving while the runner is busy. Returns
// the queue length so the API can report it back.
export function enqueueMessage(sessionId, payload) {
  const session = sessions.get(sessionId)
  if (!session) return -1
  session.queue.push(payload)
  appendEvent(sessionId, { type: 'queue_update', data: { length: session.queue.length, queued: { preview: (payload.message || '').slice(0, 80) } } })
  return session.queue.length
}

export function dequeueMessage(sessionId) {
  const session = sessions.get(sessionId)
  if (!session || session.queue.length === 0) return null
  const next = session.queue.shift()
  appendEvent(sessionId, { type: 'queue_update', data: { length: session.queue.length } })
  return next
}

export function getSession(sessionId) {
  let session = sessions.get(sessionId)
  if (!session) {
    const saved = getRecoveryState(`session:${sessionId}`)
    if (!saved) return undefined
    session = { ...saved, subscribers: new Set(), runnerPromise: null, committing: false }
    if (session.runnerState === 'running') { session.runnerState = 'stopped'; session.aborted = true }
    if (session.runnerState === 'awaiting_confirm' && Date.now() - session.lastActivityAt > SESSION_AWAITING_TTL_MS) {
      session.plan = []; session.runnerState = 'stopped'; session.aborted = true
    }
    sessions.set(sessionId, session)
  }
  return session
}

function persistSession(id, session) {
  if (!session) return
  const { plan, createdAt, lastActivityAt, aborted, runnerState, queue, chatId, events, eventSequence, turnEvents, modificationContext, executionBlocked, queueHeld } = session
  saveRecoveryState(`session:${id}`, { plan, createdAt, lastActivityAt, aborted, runnerState, queue, chatId, events, eventSequence, turnEvents, modificationContext, executionBlocked, queueHeld })
}

export function sessionSnapshot(id, cursor = 0) {
  const s = getSession(id)
  if (!s) return null
  const gap = cursor < (s.events[0]?.sequence || 1) - 1 || cursor > s.eventSequence
  return { runnerState: s.runnerState, cursor: s.eventSequence, gap,
    events: s.events.filter(e => e.sequence > cursor),
    hasRecovery: listExecutions({ sessionId: id, limit: 100 }).some(r => ['stopped','stopping','partial','needs_checking'].includes(r.state)),
    snapshotEvents: s.turnEvents, plan: s.plan.map(p => ({ stepId: p.stepId, toolName: p.toolName, preview: p.preview })),
    approval: getPlanApproval(id), queue: s.queue.map(q => ({ message: q.message })), modificationContext: s.modificationContext ? { remaining: s.modificationContext.remaining.map(p => p.preview) } : null }
}

export function abortSession(sessionId) {
  const s = sessions.get(sessionId)
  if (s) { s.aborted = true; persistSession(sessionId, s) }
}

export function clearSession(sessionId) {
  sessions.delete(sessionId)
}

// Called by the chat loop when the model invokes a tool.
// Returns the string/JSON to feed back to the model as the tool_result.
export async function handleToolCall(sessionId, toolName, input, deps) {
  const tool = tools.get(toolName)
  if (!tool) return { error: `Unknown tool: ${toolName}` }

  const session = sessions.get(sessionId)
  if (!session) return { error: 'Session expired' }
  if (session.aborted) return { error: 'Session aborted' }

  if (tool.readOnly) {
    try {
      const result = await tool.execute(input, deps)
      return { ok: true, data: result?.result ?? result }
    } catch (err) {
      return { error: err.message || String(err) }
    }
  }

  if (session.executionBlocked || session.committing) return { error: 'Execution must be checked before staging more changes. Start a new conversation for new work.' }

  // Mutation → stage it.
  // 1. Stage-time validation. Lets tools reject obviously-broken inputs
  //    (e.g. parent_id pointing nowhere) BEFORE the plan reaches commit
  //    so the model can self-correct in the chat loop instead of having
  //    the whole plan roll back atomically.
  if (tool.stagedValidate) {
    try {
      const err = tool.stagedValidate(input, session)
      if (err) return { error: err }
    } catch (e) {
      return { error: e.message || String(e) }
    }
  }

  // 2. Pre-stamp a real id at stage time for "creates a new resource"
  //    tools that opt in via preStage. The id is returned to the model
  //    AND stamped into the staged step's input, so chained creates
  //    (project then subs with parent_id) work without hallucination.
  let stagedInput = input
  let preStampedId = null
  if (tool.preStage) {
    try {
      const out = tool.preStage(input, session)
      if (out?.id) preStampedId = out.id
      if (out?.input) stagedInput = out.input
    } catch (e) {
      return { error: e.message || String(e) }
    }
  }

  const stepId = crypto.randomUUID()
  let previewText
  try {
    previewText = tool.preview(stagedInput, session)
  } catch {
    previewText = `Will run ${toolName}`
  }
  session.plan.push({ stepId, toolName, input: stagedInput, preview: previewText, status: 'staged', localGuard: stageLocalGuard(toolName, stagedInput, session) })
  const response = {
    ok: true,
    staged: true,
    stepId,
    preview: previewText,
    note: 'This action is STAGED and will execute only after user confirmation. Do not call this tool again for the same action.',
  }
  if (preStampedId) response.id = preStampedId
  return response
}

// Find a staged create_task / create_routine / etc. step whose pre-stamped
// id matches. Used by preview formatters and stagedValidate hooks to
// resolve forward references (e.g. a sub's parent_id pointing at a not-
// yet-committed project earlier in the same plan).
export function findStagedCreate(session, id) {
  if (!session?.plan || !id) return null
  for (const step of session.plan) {
    if (step.input?.id === id) return step
  }
  return null
}

// A revision names the exact plan shown for approval, never a moving session.
export function getPlanApproval(sessionId) {
  const session = sessions.get(sessionId)
  return session?.plan.length ? executionIdentity(sessionId, session.plan) : null
}

function publicOutcome(record, replayed = false) {
  return { ...record, replayed, broadcastNeeded: !replayed && record.results.some(r => r.state !== 'not_started') }
}

export async function commitPlan(sessionId, deps, revision, resume) {
  const session = getSession(sessionId)
  const approval = getPlanApproval(sessionId)
  const requestedRevision = revision || approval?.revision
  const existing = requestedRevision
    ? getExecution(executionKey(sessionId, requestedRevision))
    : listExecutions({ sessionId, limit: 1 })[0]
  if (existing && !resume) return publicOutcome(existing, true)
  if (!session) return { ok: false, error: 'Session expired or already committed' }
  if (!approval && !resume) return revision
    ? { ok: false, error: 'No matching reviewed plan is available. Review a fresh plan before applying.' }
    : { ok: true, results: [], broadcastNeeded: false }
  if (!resume && (requestedRevision !== approval.revision || session.runnerState === 'running' || session.committing || session.executionBlocked)) {
    return { ok: false, error: 'The plan changed or is busy. Review the current plan before applying.' }
  }
  // Snapshot before the first await. Approved commands are kept in private recovery storage;
  // public receipts contain hashes/identities and safe per-step evidence.
  const plan = resume?.plan || structuredClone(session.plan)
  const record = resume?.record || {
    ...approval, sessionId, chatId: session.chatId, state: 'running', ok: false,
    createdAt: new Date().toISOString(),
    results: plan.map(s => ({ stepId: s.stepId, toolName: s.toolName, state: 'not_started', ok: false })),
  }
  session.committing = true
  const compensations = []
  const owned = new Map(resume?.owned || [])
  try {
    executionJournalReady()
    try {
      for (let i = 0; i < plan.length; i++) if (record.results[i].state === 'not_started') checkLocalGuard(plan[i].localGuard, owned)
    } catch {
      record.state = 'conflict'
      record.error = 'A task or note changed. Review a fresh plan before applying.'
      session.executionBlocked = true
      saveExecution(record)
      return publicOutcome(record)
    }
    saveExecution(record)
    saveRecoveryState(record.executionId, { plan, owned: [...owned] })
    session.activeExecutionId = record.executionId
    for (let index = 0; index < plan.length; index++) {
      const step = plan[index]
      const result = record.results[index]
      if (result.state !== 'not_started') continue
      if (getExecution(record.executionId)?.stopRequested || session.aborted) {
        record.stopRequested = true
        record.state = 'stopped'
        saveExecution(record)
        setRunnerState(sessionId, 'stopped')
        return publicOutcome(record)
      }
      let outcome
      try {
        const tool = tools.get(step.toolName)
        if (!tool) throw new Error('Unknown tool')
        checkLocalGuard(step.localGuard, owned)
        result.state = 'executing'
        saveExecution(record) // durable dispatch intent BEFORE invoking the tool
        if (step.localGuard?.supported) outcome = runLocalStep(record, index, step, tool, owned)
        else if (step.localGuard) {
          // The four guarded task/note operations are synchronous, even when
          // Undo is unsupported. Track only our writes, before any async gap.
          outcome = tool.execute(step.input, { ...deps, suppressBroadcast: true })
          trackLocalWrite(step.localGuard, owned)
        } else outcome = await tool.execute(step.input, { ...deps, suppressBroadcast: true })
      } catch (error) {
        result.state = error.code === 'STALE_PLAN' ? 'not_started' : 'unknown' // errors do not establish absence of side effects
        record.error = error.code === 'STALE_PLAN' ? 'A task or note changed. Review a fresh plan before applying.' : 'An action could not be verified. Check what happened before taking further action.'
        if (getExecution(record.executionId)?.stopRequested) {
          record.stopRequested = true
          record.state = 'needs_checking'
          session.executionBlocked = true
          saveExecution(record)
          setRunnerState(sessionId, 'stopped')
          return publicOutcome(record)
        }
        // Local inverses check field versions and read back restoration. Other
        // compensation remains best effort until its own recovery adapter exists.
        for (let i = compensations.length - 1; i >= 0; i--) {
          if (getExecution(record.executionId)?.stopRequested) { record.stopRequested = true; break }
          const prior = compensations[i]
          record.results[prior.index].state = 'compensating'
          saveExecution(record)
          let verified = false
          try { verified = (await prior.run())?.verified === true } catch { /* preserve later edits */ }
          record.results[prior.index].state = verified ? 'verified_undone' : 'compensation_unverified'
          record.results[prior.index].ok = false
          saveExecution(record)
        }
        record.state = index > 0 ? 'partial' : error.code === 'STALE_PLAN' ? 'conflict' : 'needs_checking'
        session.executionBlocked = true
        session.runnerState = 'errored'
        saveExecution(record)
        return publicOutcome(record)
      }
      result.state = 'reported_applied'
      result.ok = true
      // Do not retain task content, credentials, raw settings or provider errors.
      const value = outcome?.result
      result.result = Object.fromEntries(['id', 'event_id', 'deleted', 'created', 'updated']
        .filter(key => ['string', 'boolean'].includes(typeof value?.[key]))
        .map(key => [key, value[key]]))
      if (outcome?.compensation) compensations.push({ index, run: outcome.compensation })
      // Supported local adapters already checkpointed effects, inverse and
      // receipt together. Other tools need their result checkpoint here.
      record.stopRequested ||= getExecution(record.executionId)?.stopRequested || false
      saveRecoveryState(record.executionId, { plan, owned: [...owned] })
      saveExecution(record)
      // Yield between synchronous local steps so Stop can be acknowledged.
      await new Promise(resolve => setImmediate(resolve))
    }
    record.stopRequested ||= getExecution(record.executionId)?.stopRequested || false
    record.state = record.stopRequested ? 'stopped' : 'completed'
    record.ok = !record.stopRequested
    saveExecution(record)
    if (record.stopRequested) { setRunnerState(sessionId, 'stopped'); return publicOutcome(record) }
    session.plan = []
    session.runnerState = 'idle'
    session.lastActivityAt = Date.now()
    appendEvent(sessionId, { type: 'committed', data: { ...record } })
    return publicOutcome(record)
  } catch {
    session.executionBlocked = true
    session.runnerState = 'errored'
    for (const result of record.results) {
      if (['executing', 'compensating'].includes(result.state)) { result.state = 'unknown'; result.ok = false }
    }
    return {
      ...record, ok: false, state: 'needs_checking', broadcastNeeded: true,
      error: 'Execution records could not be saved. No further actions will run. Check the outcome before trying again.',
    }
  } finally {
    session.committing = false
  }
}

export function sessionStats() {
  return { active: sessions.size, toolCount: tools.size }
}

// Stop is an intent, never a claim that a remote request was cancelled.
export function stopExecution(sessionId) {
  const s = getSession(sessionId)
  if (!s) return { ok: false, error: 'Session unavailable. Check recent execution records.' }
  s.aborted = true
  s.queueHeld = true
  const record = listExecutions({ sessionId, limit: 100 }).find(r => ['running','stopping'].includes(r.state))
  if (record) { record.stopRequested = true; record.state = 'stopping'; saveExecution(record) }
  const state = record || s.runnerActive ? 'stopping' : 'stopped'
  setRunnerState(sessionId, state)
  return { ok: true, executionId: record?.executionId, state }
}

export async function recoverExecution(id, sequence, choice, deps) {
  const record = getExecution(id)
  if (record?.lastRecoverySequence === sequence && record.lastRecoveryChoice === choice) {
    return { ...publicOutcome(record, true), ...(record.replacementSessionId ? { sessionId: record.replacementSessionId } : {}) }
  }
  if (!record || record.sequence !== sequence || record.state !== 'stopped' || record.undoApplied) return { ok: false, state: 'conflict', error: 'Recovery changed. Refresh its status before choosing.' }
  if (record.results.some(r => !['not_started','reported_applied','verified_applied','verified_no_effect'].includes(r.state))) return { ok: false, state: 'conflict', error: 'Check uncertain outcomes before continuing.' }
  const saved = getRecoveryState(id)
  const s = getSession(record.sessionId)
  if (!saved || !s || s.committing) return { ok: false, state: 'conflict', error: 'Recovery commands are unavailable.' }
  record.lastRecoverySequence = sequence
  record.lastRecoveryChoice = choice
  if (choice === 'modify') {
    const replacement = newSession({ chatId: record.chatId })
    const next = getSession(replacement)
    next.modificationContext = { remaining: saved.plan.filter((_, i) => record.results[i].state === 'not_started'), completed: record.results.filter(r => r.state !== 'not_started'), queue: s.queue }
    persistSession(replacement, next)
    record.state = 'modified'
    record.replacementSessionId = replacement
    saveExecution(record)
    s.plan = []
    persistSession(record.sessionId, s)
    return { ...publicOutcome(record), sessionId: replacement, context: next.modificationContext.remaining.map(s => s.preview) }
  }
  if (choice !== 'continue') return { ok: false, state: 'conflict', error: 'Choose Continue or Modify.' }
  record.stopRequested = false
  record.state = 'running'
  record.error = undefined
  saveExecution(record) // synchronous compare-and-set before first awaited dispatch
  s.plan = saved.plan
  s.aborted = false
  s.executionBlocked = false
  setRunnerState(record.sessionId, 'running')
  return commitPlan(record.sessionId, deps, record.revision, { record, ...saved })
}

export function recoverSession(sessionId, choice) {
  const session = getSession(sessionId)
  if (!session || session.runnerState !== 'stopped' || session.runnerActive || session.committing || listExecutions({ sessionId, limit: 100 }).some(r => ['stopped','stopping','needs_checking','partial'].includes(r.state))) return { ok: false, error: 'Use the recorded execution recovery choices below.' }
  if (choice === 'continue' && session.plan.length) {
    session.aborted = false
    setRunnerState(sessionId, 'awaiting_confirm')
    return { ok: true, sessionId, ...sessionSnapshot(sessionId) }
  }
  if (choice !== 'modify') return { ok: false, error: 'Describe what to do next; no approved actions are waiting.' }
  const id = newSession({ chatId: session.chatId })
  const next = getSession(id)
  next.modificationContext = { remaining: session.plan, queue: session.queue, completed: [] }
  persistSession(id, next)
  session.plan = []
  setRunnerState(sessionId, 'modified')
  return { ok: true, sessionId: id, ...sessionSnapshot(id) }
}
