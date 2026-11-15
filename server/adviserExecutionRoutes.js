import { captureExplicit } from './explicitCapture.js'
import { commitPlan, getPlanApproval, recoverExecution, stopExecution, sessionSnapshot, recoverSession, settleUndoneSession } from './adviserTools.js'
import { executionKey, getExecution, listExecutions } from './executionJournal.js'
import { reconcileExternal, previewExternalUndo, applyExternalUndo } from './externalRecovery.js'
import { applyLocalUndo, previewLocalUndo } from './localRecovery.js'

// Mounted behind the application's existing authGate. Inject only request-
// scoped integration dependencies and the existing coalesced broadcast/queue.
export function registerExecutionRoutes(app, { dependencies, afterCommit, onStop = () => {} }) {
  app.post('/api/adviser/capture', async (req, res) => {
    try {
      const result = await captureExplicit(req.body || {})
      if (result.handled && !result.outcome.replayed) await afterCommit(req, result.outcome, {})
      res.json(result)
    } catch (error) {
      res.status(error.status || 409).json({ error: error.status === 429 ? error.message : 'Capture could not be confirmed. Check recent actions before retrying.' })
    }
  })
  app.post('/api/adviser/executions/:id/steps/:step/check', async (req, res) => {
    const outcome = await reconcileExternal(req.params.id, req.params.step, await dependencies(req))
    res.json(outcome)
  })
  app.get('/api/adviser/executions/:id/steps/:step/undo', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const preview = await previewExternalUndo(req.params.id, req.params.step, await dependencies(req))
    if (!preview) return res.status(404).json({ error: 'No supported external recovery record.' })
    res.json(preview)
  })
  app.post('/api/adviser/executions/:id/steps/:step/undo', async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.body?.revision || '')) return res.status(409).json({ error: 'Review Undo before confirming.' })
    const outcome = await applyExternalUndo(req.params.id, req.params.step, req.body.revision, await dependencies(req))
    if (outcome.ok && !outcome.replayed) {
      settleUndoneSession(req.params.id)
      await afterCommit(req, { ...outcome, broadcastNeeded: true }, {})
    }
    res.status(outcome.state === 'conflict' ? 409 : 200).json(outcome)
  })
  app.post('/api/adviser/abort', (req, res) => {
    const outcome = stopExecution(req.body?.sessionId)
    onStop(req.body?.sessionId)
    res.json(outcome)
  })
  app.post('/api/adviser/session/:id/recover', (req, res) => res.json(recoverSession(req.params.id, req.body?.choice)))
  app.get('/api/adviser/session/:id', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const snapshot = sessionSnapshot(req.params.id, Number(req.query.cursor) || 0)
    if (!snapshot) return res.status(404).json({ error: 'Session not found' })
    res.json(snapshot)
  })
  app.post('/api/adviser/executions/:id/recover', async (req, res) => {
    const { sequence, choice } = req.body || {}
    if (!Number.isSafeInteger(sequence) || !['continue','modify'].includes(choice)) return res.status(409).json({ error: 'Review the current recovery choices.' })
    const deps = choice === 'continue' ? await dependencies(req) : {}
    const outcome = await recoverExecution(req.params.id, sequence, choice, deps)
    if (choice === 'continue' && !outcome.replayed) await afterCommit(req, outcome, deps)
    res.status(outcome.state === 'conflict' ? 409 : 200).json(outcome)
  })
  app.get('/api/adviser/executions/:id/undo', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const preview = previewLocalUndo(req.params.id)
    if (!preview) return res.status(404).json({ error: 'Execution not found' })
    res.json(preview)
  })
  app.post('/api/adviser/executions/:id/undo', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const revision = req.body?.revision
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) return res.status(409).json({ error: 'Review Undo before confirming it.' })
    const outcome = applyLocalUndo(req.params.id, revision)
    if (outcome.ok && !outcome.replayed) {
      settleUndoneSession(req.params.id)
      await afterCommit(req, { ...outcome, broadcastNeeded: true }, {})
    }
    res.status(outcome.state === 'conflict' ? 409 : 200).json(outcome)
  })
  app.get('/api/adviser/executions', (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (!req.query.chatId) return res.status(400).json({ error: 'chatId required' })
    res.json({ executions: listExecutions({ chatId: String(req.query.chatId) }) })
  })
  app.get('/api/adviser/executions/:id', (req, res) => {
    res.set('Cache-Control', 'no-store')
    const execution = getExecution(req.params.id)
    if (!execution) return res.status(404).json({ error: 'Execution not found' })
    res.json(execution)
  })
  app.post('/api/adviser/commit', async (req, res) => {
    const { sessionId, revision } = req.body || {}
    if (typeof sessionId !== 'string' || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
      return res.status(409).json({ error: 'Review a fresh plan before applying. The approved plan revision is required.' })
    }
    const existing = getExecution(executionKey(sessionId, revision))
    if (!existing && getPlanApproval(sessionId)?.revision !== revision) {
      return res.status(409).json({ error: 'No matching reviewed plan is available. Review a fresh plan before applying.' })
    }
    // Reading a receipt never refreshes tokens or touches external services.
    const deps = existing ? {} : await dependencies(req)
    const outcome = await commitPlan(sessionId, deps, revision)
    if (!outcome.replayed) await afterCommit(req, outcome, deps)
    res.json(outcome)
  })
}
