import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installNetworkFence } from './quokkaNetworkFence.mjs'

export const fixture = JSON.parse(readFileSync(new URL('../fixtures/quokka-p1.json', import.meta.url), 'utf8'))
export const fence = installNetworkFence()
// server.js is intentionally never imported: no jobs, OAuth, notifications or HTTP server.
export const db = await import('../../server/db.js')
export const engine = await import('../../server/adviserTools.js')
const { registerTaskTools } = await import('../../server/adviserToolsTasks.js')
const { registerGCalTools, registerTrelloTools } = await import('../../server/adviserToolsIntegrations.js')
const { default: initSqlJs } = await import('sql.js')
const SQL = await initSqlJs()
registerTaskTools()
registerGCalTools()
registerTrelloTools()

export function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

// Exact simulated endpoints used by real integration tools. Everything else fails closed.
export class FakeIntegrations {
  state = structuredClone(fixture.external)
  calls = []
  unexpected = []
  faults = []
  serial = 0

  fail(method, pathname, status = 503) {
    this.faults.push({ method, pathname, status })
  }

  loseResponse(method, pathname) {
    this.faults.push({ method, pathname, lostResponse: true })
  }

  // Hold real tool fetches at an explicit barrier, never timing-dependent sleeps.
  pause(method, pathname, arrivals = 1) {
    const entered = deferred()
    const release = deferred()
    this.faults.push({ method, pathname, entered, release, remaining: arrivals })
    return { entered: entered.promise, release: release.resolve }
  }

  async fetch(raw, init = {}) {
    const url = new URL(raw)
    const method = init.method || 'GET'
    const pathname = url.pathname
    this.calls.push({ method, pathname })
    const fault = this.faults.find(f => f.method === method && f.pathname === pathname)
    if (fault?.lostResponse) this.faults.splice(this.faults.indexOf(fault), 1)
    if (fault?.status) {
      this.faults.splice(this.faults.indexOf(fault), 1)
      return Response.json({ error: { message: 'injected failure' } }, { status: fault.status })
    }
    if (fault?.entered) {
      if (--fault.remaining === 0) {
        this.faults.splice(this.faults.indexOf(fault), 1)
        fault.entered.resolve()
      }
      await fault.release.promise
    }
    const body = init.body ? JSON.parse(init.body) : {}
    const calendar = pathname.match(/^\/calendar\/v3\/calendars\/primary\/events(?:\/([^/]+))?$/)
    if (url.origin === 'https://www.googleapis.com' && calendar) {
      const id = calendar[1]
      if (!id && method === 'POST') {
        const event = { id: `created-${++this.serial}`, ...body }
        this.state.events[event.id] = event
        if (fault?.lostResponse) throw new TypeError('injected lost response after remote write')
        return Response.json(event)
      }
      if (id && this.state.events[id]) {
        if (method === 'GET') return Response.json(this.state.events[id])
        if (method === 'PATCH') {
          Object.assign(this.state.events[id], body)
          return Response.json(this.state.events[id])
        }
        if (method === 'DELETE') {
          delete this.state.events[id]
          return new Response(null, { status: 204 })
        }
      }
      if (id && ['GET', 'PATCH', 'DELETE'].includes(method)) {
        return Response.json({ error: { message: 'fixture event not found' } }, { status: 404 })
      }
    }
    if (url.origin === 'https://api.trello.com') {
      if (method === 'POST' && pathname === '/1/cards/fixture-card/checklists') {
        const checklist = { id: `checklist-${++this.serial}`, name: body.name, items: [] }
        this.state.checklists[checklist.id] = checklist
        return Response.json(checklist)
      }
      const match = pathname.match(/^\/1\/checklists\/([^/]+)(\/checkItems)?$/)
      if (match && this.state.checklists[match[1]]) {
        if (method === 'POST' && match[2]) {
          const item = { id: `item-${++this.serial}`, name: body.name }
          this.state.checklists[match[1]].items.push(item)
          return Response.json(item)
        }
        if (method === 'DELETE' && !match[2]) {
          delete this.state.checklists[match[1]]
          return new Response(null, { status: 204 })
        }
      }
    }
    this.unexpected.push(`${method} ${url.origin}${pathname}`)
    throw new Error(`P1 unexpected outbound request: ${method} ${url.origin}${pathname}`)
  }
}

export async function sandbox(t) {
  await fence.verify() // filters/single-case runs must also prove isolation before commits
  t.mock.timers.enable({ apis: ['Date'], now: new Date(fixture.now) })
  const directory = mkdtempSync(path.join(tmpdir(), 'boom-quokka-p1-'))
  const dbPath = path.join(directory, 'synthetic.db')
  const connection = await db.initDb(dbPath)
  const reopenedConnections = []
  for (const task of fixture.tasks) db.upsertTask(task)
  db.setData('settings', { timezone: 'UTC' })
  const external = new FakeIntegrations()
  fence.route(external.fetch.bind(external))
  const notifications = []
  engine.onPlanReady((id) => { notifications.push({ type: 'plan-ready', id }) })
  const sessionIds = []
  const deps = { gcalToken: 'synthetic-not-a-token', trello: { key: 'fake', token: 'fake' } }

  // Independent reader: assert file bytes after an explicit flush, not just live DB getters.
  function persisted() {
    db.flushNow()
    const reader = new SQL.Database(readFileSync(dbPath))
    try {
      const query = sql => {
        const stmt = reader.prepare(sql)
        const rows = []
        try { while (stmt.step()) rows.push(stmt.getAsObject()) } finally { stmt.free() }
        return rows
      }
      return {
        tasks: query('SELECT * FROM tasks ORDER BY id'),
        data: query('SELECT * FROM app_data ORDER BY collection'),
      }
    } finally { reader.close() }
  }
  const initial = persisted()
  t.after(() => {
    try {
      const final = persisted()
      assert.deepEqual(final.tasks.find(r => r.id === 'unrelated'), initial.tasks.find(r => r.id === 'unrelated'))
      assert.deepEqual(external.state.events['unrelated-event'], fixture.external.events['unrelated-event'])
      assert.deepEqual(external.state.cards, fixture.external.cards)
      assert.deepEqual(external.unexpected, [], 'all outbound calls must match explicit fake routes')
      assert.deepEqual(fence.blocked, [], 'no hidden socket/provider attempts')
    } finally {
      for (const id of sessionIds) engine.clearSession(id)
      engine.onPlanReady(null)
      fence.route(null)
      db.flushNow()
      connection.close()
      for (const reopened of reopenedConnections) reopened.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
  return {
    dbPath, connection, deps, external, notifications, initial, persisted,
    async reopen() { reopenedConnections.push(await db.initDb(dbPath)) },
    session() {
      const id = engine.newSession({ chatId: 'synthetic-chat' })
      sessionIds.push(id)
      return id
    },
    async stage(id, name, input) {
      const result = await engine.handleToolCall(id, name, input, deps)
      assert.equal(result.staged, true, JSON.stringify(result))
      return result
    },
  }
}

export const restartWorker = fileURLToPath(new URL('./quokkaRestart.mjs', import.meta.url))
