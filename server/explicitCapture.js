// Narrow deterministic authority, evaluated before any model call. A refusal
// means ordinary reviewed conversation; it never means permission to guess.
import { createHash } from 'node:crypto'
import { normalizeCapture, createRateLimiter } from './capture.js'
import { classifyExplicitCapture } from './captureAuthority.js'
import { newSession, getSession, handleToolCall, getPlanApproval, commitPlan, appendEvent } from './adviserTools.js'
import { getRecoveryState, saveRecoveryState, listExecutions } from './executionJournal.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const pending = new Map()
const limiter = createRateLimiter()
export function explicitCapture(message) {
  const intent = classifyExplicitCapture(message)
  if (!intent) return null
  if (intent.kind === 'note') return { kind: 'note', toolName: 'create_note', input: { body: intent.content, pinned: false } }
  const parsed = normalizeCapture({ text: intent.content, source: 'quokka' })
  return { kind: 'task', toolName: 'create_task', input: { title: parsed.title, notes: parsed.notes } }
}

export async function captureExplicit({ message, chatId, requestId, sessionId }) {
  const parsed = explicitCapture(message)
  if (!parsed) return { handled: false }
  if (typeof chatId !== 'string' || !chatId || chatId.length > 200 || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId || '')) throw new Error('Capture requires a chat and stable request ID.')
  const requestKey = `capture:${hash([chatId, requestId])}`
  const fingerprint = hash(parsed)
  const existing = getRecoveryState(requestKey)
  if (existing && existing.fingerprint !== fingerprint) throw new Error('This capture request ID already refers to different content.')
  const active = pending.get(requestKey)
  if (active) {
    if (active.fingerprint !== fingerprint) throw new Error('This request ID refers to different content.')
    const result = await active.promise
    return { ...result, outcome: { ...result.outcome, replayed: true } }
  }
  if (!existing) {
    const session = getSession(sessionId)
    if (session && (session.committing || session.aborted || !['idle','modified'].includes(session.runnerState) || session.plan.length)) return { handled: false }
    if (listExecutions({ chatId }).some(r => ['running','stopping','checking','undoing','needs_checking'].includes(r.state) || (r.state === 'stopped' && !r.undoApplied) || (r.state === 'partial' && r.results.some(s => ['unknown','executing','compensating','compensation_unverified'].includes(s.state) || (s.state === 'not_started' && !r.undoApplied))))) return { handled: false }
    if (!limiter.allow()) throw Object.assign(new Error('Too many captures. Try again in a minute.'), { status: 429 })
  }
  const run = (async () => {
    let request = existing
    if (!request) {
      const id = newSession({ chatId })
      const staged = await handleToolCall(id, parsed.toolName, parsed.input, {})
      if (!staged.staged) throw new Error('Capture is unavailable. No alternative destination was used.')
      const approval = getPlanApproval(id)
      // Persist the exact original plan before the request-to-execution pointer.
      appendEvent(id, { type: 'plan', data: { ...approval, steps: getSession(id).plan.map(p => ({ stepId: p.stepId, toolName: p.toolName, preview: p.preview })) } })
      request = { fingerprint, sessionId: id, ...approval }
      saveRecoveryState(requestKey, request)
    }
    const outcome = await commitPlan(request.sessionId, {}, request.revision, undefined, 'explicit_capture')
    return { handled: true, kind: parsed.kind, sessionId: request.sessionId, outcome,
      message: outcome.state === 'undone' ? 'This capture was undone. The same request will not create it again.' : outcome.ok ? `Captured your ${parsed.kind}. You can review Undo in recent actions.` : 'Capture needs checking. Review recent actions before retrying.' }
  })()
  pending.set(requestKey, { promise: run, fingerprint })
  try { return await run } finally { pending.delete(requestKey) }
}
