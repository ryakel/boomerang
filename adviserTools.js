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

  // Mutation → stage it, return a preview string to the model
  const stepId = crypto.randomUUID()
  let previewText
  try {
    previewText = tool.preview(input)
  } catch {
    previewText = `Will run ${toolName}`
  }
  session.plan.push({ stepId, toolName, input, preview: previewText, status: 'staged' })
  return {
    ok: true,
    staged: true,
    stepId,
    preview: previewText,
    note: 'This action is STAGED and will execute only after user confirmation. Do not call this tool again for the same action.',
  }
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
