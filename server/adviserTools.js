// adviserTools.js — AI Adviser tool registry + staged-execution engine.
//
// Design:
// - Tools are registered via `registerTool({ name, description, schema, readOnly, preview, execute })`.
// - readOnly tools run immediately during the model's reasoning loop and return data.
// - Mutation tools (readOnly: false) are STAGED: the model sees a confirmation string,
//   but nothing actually mutates until the user calls /api/adviser/commit.
// - On commit, all staged steps run in order. If any step fails, prior steps' compensations
//   are invoked in reverse (LIFO) to roll back local DB writes and best-effort external ones.
// - One coalesced SSE broadcast fires after the whole plan commits (prevents storm).
//
// Sessions are in-memory with a 10-minute TTL. No persistence.
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
    if (s.runnerState === 'running') continue
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
  session.events.push(event)
  if (session.events.length > EVENT_BUFFER_CAP) {
    // Drop oldest events; subscribers may miss some on late reconnect.
    // 500-event cap is generous (a 15-turn loop with 10 tool calls per
    // turn = ~150 events; the cap covers ~3x that).
    session.events.shift()
  }
  session.lastActivityAt = Date.now()
  for (const sub of session.subscribers) {
    try {
      writeSSE(sub.res, event.type, event.data)
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
export function subscribeSession(sessionId, res) {
  const session = sessions.get(sessionId)
  if (!session) return null
  const sub = { res, lastSent: 0 }
  // Replay everything we have so far. Sub is registered AFTER replay so
  // it doesn't double-receive any events appended mid-replay (impossible
  // here since this is synchronous, but defensive).
  for (const event of session.events) {
    try { writeSSE(res, event.type, event.data) } catch { return null }
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
    preview: def.preview || ((args) => `Will run ${def.name}`),
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
    events: [],
    subscribers: new Set(),
    runnerState: 'idle',
    runnerPromise: null,
    queue: [],
    chatId: opts.chatId || null,
  })
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
  return sessions.get(sessionId)
}

export function abortSession(sessionId) {
  const s = sessions.get(sessionId)
  if (s) s.aborted = true
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
  session.plan.push({ stepId, toolName, input: stagedInput, preview: previewText, status: 'staged' })
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

// Called by /api/adviser/commit. Executes all staged steps atomically.
// Returns { ok, results: [{stepId, ok, result?, error?}], broadcastNeeded }.
export async function commitPlan(sessionId, deps) {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, error: 'Session expired or already committed' }
  if (session.plan.length === 0) return { ok: true, results: [], broadcastNeeded: false }

  const results = []
  const compensations = [] // LIFO on failure
  let failed = false
  let failureError = null

  for (const step of session.plan) {
    const tool = tools.get(step.toolName)
    if (!tool) {
      failed = true
      failureError = `Unknown tool: ${step.toolName}`
      results.push({ stepId: step.stepId, toolName: step.toolName, ok: false, error: failureError })
      break
    }
    try {
      // Suppress SSE broadcasts during plan execution — coalesce at the end
      const batchedDeps = { ...deps, suppressBroadcast: true }
      const outcome = await tool.execute(step.input, batchedDeps)
      results.push({
        stepId: step.stepId,
        toolName: step.toolName,
        ok: true,
        result: outcome?.result ?? null,
      })
      if (outcome?.compensation) compensations.push(outcome.compensation)
    } catch (err) {
      failed = true
      failureError = err.message || String(err)
      results.push({ stepId: step.stepId, toolName: step.toolName, ok: false, error: failureError })
      break
    }
  }

  if (failed) {
    // Roll back prior successful steps (LIFO). Plan stays so the user
    // can see what happened; runner state moves to errored.
    for (let i = compensations.length - 1; i >= 0; i--) {
      try { await compensations[i]() } catch (err) {
        console.error('[Adviser] Compensation failed:', err.message)
      }
    }
    session.runnerState = 'errored'
    session.lastActivityAt = Date.now()
    return { ok: false, error: failureError, results, broadcastNeeded: true }
  }

  // Commit succeeded. Keep the session alive so its queued follow-ups
  // (if any) can advance. Reset the plan + runner state — the session
  // becomes "fresh" for the next turn within the same conversation.
  // TTL cleanup still applies (10 min idle → expire).
  const broadcastNeeded = session.plan.some(s => !tools.get(s.toolName)?.readOnly)
  session.plan = []
  session.runnerState = 'idle'
  session.lastActivityAt = Date.now()
  appendEvent(sessionId, { type: 'committed', data: { results: results.map(r => ({ stepId: r.stepId, toolName: r.toolName, ok: r.ok })) } })
  return { ok: true, results, broadcastNeeded }
}

export function sessionStats() {
  return { active: sessions.size, toolCount: tools.size }
}
