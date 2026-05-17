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

import crypto from 'crypto'

const SESSION_TTL_MS = 10 * 60 * 1000

const tools = new Map() // name -> tool def
const sessions = new Map() // sessionId -> { plan, createdAt, aborted }

// Periodic cleanup of stale sessions
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id)
  }
}, 60 * 1000).unref?.()

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

export function newSession() {
  const id = crypto.randomUUID()
  sessions.set(id, { plan: [], createdAt: Date.now(), aborted: false })
  return id
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
    // Roll back prior successful steps (LIFO)
    for (let i = compensations.length - 1; i >= 0; i--) {
      try { await compensations[i]() } catch (err) {
        console.error('[Adviser] Compensation failed:', err.message)
      }
    }
    sessions.delete(sessionId)
    return { ok: false, error: failureError, results, broadcastNeeded: true }
  }

  sessions.delete(sessionId)
  const broadcastNeeded = session.plan.some(s => !tools.get(s.toolName)?.readOnly)
  return { ok: true, results, broadcastNeeded }
}

export function sessionStats() {
  return { active: sessions.size, toolCount: tools.size }
}
