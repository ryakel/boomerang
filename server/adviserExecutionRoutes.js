import { commitPlan, getPlanApproval } from './adviserTools.js'
import { executionKey, getExecution, listExecutions } from './executionJournal.js'
import { applyLocalUndo, previewLocalUndo } from './localRecovery.js'

// Mounted behind the application's existing authGate. Inject only request-
// scoped integration dependencies and the existing coalesced broadcast/queue.
export function registerExecutionRoutes(app, { dependencies, afterCommit }) {
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
    if (outcome.ok && !outcome.replayed) await afterCommit(req, { ...outcome, broadcastNeeded: true }, {})
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
