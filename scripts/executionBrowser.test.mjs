// Optional local browser run: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
// node --test scripts/executionBrowser.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import express from 'express'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { sandbox, fence, engine, db } from './helpers/quokkaSandbox.mjs'
import { registerExecutionRoutes } from '../server/adviserExecutionRoutes.js'
import { authGate } from '../server/auth.js'

after(() => fence.restore())
test('E1 browser recovery with synthetic HTTP server and no live application integrations', { timeout: 60000 }, async t => {
  const s = await sandbox(t)
  process.env.AUTH_PASSWORD = 'synthetic-browser-password'
  process.env.API_TOKEN = 'synthetic-browser-token'
  t.after(() => { delete process.env.AUTH_PASSWORD; delete process.env.API_TOKEN })
  const id = s.session()
  await s.stage(id, 'update_task', { id: 'exam', title: 'Browser applied' })
  const approval = engine.getPlanApproval(id)
  const steps = engine.getSession(id).plan.map(step => ({ stepId: step.stepId, toolName: step.toolName, preview: step.preview }))
  const chat = { id: 'synthetic-chat', sessionId: id, messages: [{ role: 'assistant', content: 'Synthetic plan', plan: steps, planRevision: approval.revision }] }
  const app = express()
  app.use(express.json())
  app.use(authGate)
  registerExecutionRoutes(app, { dependencies: () => s.deps, afterCommit: () => {} })
  app.get('/api/adviser/chats', (_req, res) => res.json({ chats: [chat], archived: [], activeId: chat.id }))
  app.get('/api/adviser/chats/active', (_req, res) => res.json({ chat }))
  app.patch('/api/adviser/chats/:id', (_req, res) => res.json({ ok: true }))
  app.post('/api/adviser/chat', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.end([
      ['session', { sessionId: id }],
      ['plan', { revision: approval.revision, steps }],
      ['done', {}],
      ['runner_state', { state: 'awaiting_confirm' }],
    ].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''))
  })
  app.post('/api/log', (_req, res) => res.json({ ok: true }))
  app.get('/api/tasks/exam', (_req, res) => res.json(db.getTask('exam')))
  app.post('/__simulate_unknown', async (_req, res) => {
    const next = s.session()
    await s.stage(next, 'gcal_create_event', { summary: 'Synthetic browser event', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } })
    s.external.loseResponse('POST', '/calendar/v3/calendars/primary/events')
    res.json(await engine.commitPlan(next, s.deps))
  })
  let stopGate, stopRun
  app.post('/__start_stop', async (_req, res) => {
    const next = s.session()
    await s.stage(next, 'update_task', { id: 'exam', title: 'Before Stop' })
    await s.stage(next, 'gcal_create_event', { summary: 'Synthetic stopped event', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } })
    await s.stage(next, 'update_task', { id: 'exam', notes: 'Continued after Stop' })
    stopGate = s.external.pause('POST', '/calendar/v3/calendars/primary/events')
    t.after(stopGate.release)
    stopRun = engine.commitPlan(next, s.deps)
    await stopGate.entered
    res.json({ ok: true })
  })
  app.post('/__release_stop', async (_req, res) => { stopGate.release(); res.json(await stopRun) })
  let vite
  const html = `<!doctype html><html data-ui="v2" data-theme="kept-light"><body><div id="root" class="v2-app"></div><script type="module">
    import '/src/index.css';
    import '/src/AppV2.css';
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { useAdviser } from '/src/hooks/useAdviser.js';
    import AdviserModal from '/src/components/AdviserModal.jsx';
    function Test() { const adviser=useAdviser(); return React.createElement(AdviserModal,{open:true,adviser,onClose:()=>{}}); }
    createRoot(document.getElementById('root')).render(React.createElement(Test));
    </script></body></html>`
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react(), {
    name: 'synthetic-execution-fixture', configureServer(server) {
      server.middlewares.use(app)
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__e1') return next()
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml('/__e1', html))
      })
    },
  }], server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { include: ['react', 'react-dom/client'] } })
  t.after(() => vite.close())
  await vite.listen()
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`
  const driver = spawn(process.execPath, [new URL('./helpers/executionBrowserDriver.mjs', import.meta.url).pathname, base], {
    env: { PATH: process.env.PATH, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  driver.stdout.on('data', data => { output += data })
  driver.stderr.on('data', data => { output += data })
  t.after(() => driver.kill())
  const code = await new Promise((resolve, reject) => { driver.once('error', reject); driver.once('exit', resolve) })
  assert.equal(code, 0, output)
  assert.equal(db.getTask('exam').title, 'Prepare exam')
  assert.equal(s.external.calls.filter(c => c.method === 'POST').length, 3)
  console.log(output.trim())
})
