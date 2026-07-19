// Tests for the POST /api/capture endpoint (wiki/Capture-Shortcut.md).
// Two layers:
//   1. Unit tests for the pure helpers in server/capture.js (validation,
//      title/notes split, rate limiter) — no server needed.
//   2. HTTP tests against a real spawned server with auth ENABLED, covering
//      the contract the Siri shortcut depends on: 401 without/with a bad
//      token, 201 happy path, 400 on empty text.
// Run via `npm test` (node --test).

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeCapture, createRateLimiter, CAPTURE_TEXT_MAX, CAPTURE_TITLE_MAX } from '../server/capture.js'

// ---------- normalizeCapture ----------

test('normalizeCapture: trims and passes through short text', () => {
  const r = normalizeCapture({ text: '  order more PETG  ', source: 'siri' })
  assert.equal(r.error, undefined)
  assert.equal(r.title, 'order more PETG')
  assert.equal(r.notes, '')
  assert.equal(r.source, 'siri')
})

test('normalizeCapture: rejects empty and whitespace-only text', () => {
  assert.ok(normalizeCapture({ text: '' }).error)
  assert.ok(normalizeCapture({ text: '   \n\t ' }).error)
  assert.ok(normalizeCapture({}).error)
  assert.ok(normalizeCapture(null).error)
})

test('normalizeCapture: defaults source to api and sanitizes junk', () => {
  assert.equal(normalizeCapture({ text: 'x' }).source, 'api')
  assert.equal(normalizeCapture({ text: 'x', source: 'SIRI' }).source, 'siri')
  assert.equal(normalizeCapture({ text: 'x', source: '<script>' }).source, 'api')
  assert.equal(normalizeCapture({ text: 'x', source: 'has spaces' }).source, 'api')
})

test('normalizeCapture: caps text and preserves long dictation in notes', () => {
  const long = 'a'.repeat(CAPTURE_TEXT_MAX + 500)
  const r = normalizeCapture({ text: long })
  assert.equal(r.title.length, CAPTURE_TITLE_MAX)
  assert.equal(r.notes.length, CAPTURE_TEXT_MAX) // capped, but nothing inside the cap is lost
  const medium = 'b'.repeat(CAPTURE_TITLE_MAX + 10)
  const r2 = normalizeCapture({ text: medium })
  assert.equal(r2.title, 'b'.repeat(CAPTURE_TITLE_MAX))
  assert.equal(r2.notes, medium) // full text kept
})

// ---------- rate limiter ----------

test('rate limiter: allows up to limit inside the window, then blocks', () => {
  const rl = createRateLimiter({ limit: 3, windowMs: 60_000 })
  const t0 = 1_000_000
  assert.ok(rl.allow(t0))
  assert.ok(rl.allow(t0 + 1))
  assert.ok(rl.allow(t0 + 2))
  assert.equal(rl.allow(t0 + 3), false)
  // window slides: exactly at t0 + windowMs the first hit ages out, freeing
  // one slot — and only one, so the next call inside the window blocks again
  assert.ok(rl.allow(t0 + 60_000))
  assert.equal(rl.allow(t0 + 60_000), false)
})

// ---------- HTTP contract against a real server ----------

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3177
const BASE = `http://127.0.0.1:${PORT}`
const TOKEN = 'test-capture-token-0123456789abcdef0123456789abcdef'

let serverProc
let dbDir

async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('server did not become healthy in time')
}

before(async () => {
  dbDir = mkdtempSync(path.join(tmpdir(), 'boom-capture-test-'))
  serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: path.join(dbDir, 'test.db'),
      AUTH_PASSWORD: 'test-only-password',
      API_TOKEN: TOKEN,
      SEED_DB: '',
    },
    stdio: 'ignore',
  })
  await waitForHealth()
})

after(() => {
  if (serverProc) serverProc.kill()
  if (dbDir) rmSync(dbDir, { recursive: true, force: true })
})

function capture(body, token = TOKEN) {
  return fetch(`${BASE}/api/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

test('POST /api/capture: 401 without a token', async () => {
  const res = await capture({ text: 'should not land' }, null)
  assert.equal(res.status, 401)
})

test('POST /api/capture: 401 with a bad token', async () => {
  const res = await capture({ text: 'should not land' }, 'wrong-token')
  assert.equal(res.status, 401)
})

test('POST /api/capture: 201 creates an inbox task with source stamped', async () => {
  const res = await capture({ text: '  order more PETG ', source: 'siri' })
  assert.equal(res.status, 201)
  const data = await res.json()
  assert.ok(data.task?.id)
  assert.equal(data.task.title, 'order more PETG')
  assert.equal(data.task.status, 'not_started')
  assert.equal(data.task.due_date, null)
  assert.equal(data.task.high_priority, false)
  assert.equal(data.task.capture_source, 'siri')
  assert.equal(data.task.size_inferred, false) // background auto-sizer picks it up
})

test('POST /api/capture: 400 on empty text', async () => {
  const res = await capture({ text: '   ' })
  assert.equal(res.status, 400)
})
