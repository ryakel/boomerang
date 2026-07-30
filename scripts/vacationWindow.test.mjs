// Unit tests for server/vacationWindow.js — the away window's date logic.
//
// The dangerous failure for this feature is suppression you cannot see, so the
// tests care most about windows that must NOT suppress: inactive, not started
// yet, already ended, malformed. Run via `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWindow, isAway, isExpired, windowDays } from '../server/vacationWindow.js'

// ---- normalization ----

test('a well-formed window round-trips', () => {
  const w = normalizeWindow({ active: true, started_at: '2026-03-03', ends_at: '2026-03-07', note: 'Wisconsin' })
  assert.deepEqual(w, { active: true, started_at: '2026-03-03', ends_at: '2026-03-07', note: 'Wisconsin' })
})

test('garbage dates become null rather than throwing or half-parsing', () => {
  for (const bad of ['march 3', '2026-3-3', '', null, undefined, 42, {}]) {
    const w = normalizeWindow({ active: true, started_at: bad, ends_at: bad })
    assert.equal(w.started_at, null)
    assert.equal(w.ends_at, null)
  }
})

test('an end before the start drops the end instead of inverting the window', () => {
  // Inverting would silently suppress a range nobody asked for.
  const w = normalizeWindow({ active: true, started_at: '2026-03-07', ends_at: '2026-03-03' })
  assert.equal(w.started_at, '2026-03-07')
  assert.equal(w.ends_at, null)
})

test('malformed input is inert, never a crash', () => {
  for (const v of [null, undefined, 'nope', 7, []]) {
    const w = normalizeWindow(v)
    assert.equal(w.active, false)
    assert.equal(w.started_at, null)
  }
})

test('the note is bounded so a paste cannot bloat app_data', () => {
  const w = normalizeWindow({ note: 'x'.repeat(500) })
  assert.equal(w.note.length, 120)
})

// ---- the suppressions that MUST NOT happen ----

const WIN = { active: true, started_at: '2026-03-03', ends_at: '2026-03-07' }

test('inactive never suppresses, whatever the dates say', () => {
  assert.equal(isAway({ ...WIN, active: false }, '2026-03-05'), false)
})

test('a future window does not suppress today', () => {
  assert.equal(isAway(WIN, '2026-03-02'), false)
})

test('a past window does not suppress today', () => {
  // The one that would silently mute forever if it were wrong.
  assert.equal(isAway(WIN, '2026-03-08'), false)
})

test('an unparseable today never suppresses', () => {
  for (const t of ['', null, undefined, 'today', 20260305]) {
    assert.equal(isAway(WIN, t), false)
  }
})

test('an unset start means from-now, not forever-backwards', () => {
  const w = { active: true, started_at: null, ends_at: null }
  // No start recorded, so it cannot claim history it was never told about —
  // but it does suppress today, which is what "I'm away now" means.
  assert.equal(isAway(w, '2026-03-05'), true)
})

// ---- the suppressions that MUST happen ----

test('both boundary days are inclusive', () => {
  assert.equal(isAway(WIN, '2026-03-03'), true)
  assert.equal(isAway(WIN, '2026-03-07'), true)
})

test('a day inside the window suppresses', () => {
  assert.equal(isAway(WIN, '2026-03-05'), true)
})

test('an open-ended window suppresses indefinitely', () => {
  const w = { active: true, started_at: '2026-03-03', ends_at: null }
  assert.equal(isAway(w, '2026-03-05'), true)
  assert.equal(isAway(w, '2027-01-01'), true)
})

// ---- expiry, which is what stops silent forever-mute ----

test('a dated window past its end reports expired', () => {
  assert.equal(isExpired(WIN, '2026-03-08'), true)
})

test('a window still running is not expired', () => {
  assert.equal(isExpired(WIN, '2026-03-05'), false)
  assert.equal(isExpired(WIN, '2026-03-07'), false)
})

test('an open-ended window is never expired — only a human closes it', () => {
  const w = { active: true, started_at: '2026-03-03', ends_at: null }
  assert.equal(isExpired(w, '2030-01-01'), false)
})

test('an inactive window is not expired, it is just off', () => {
  assert.equal(isExpired({ ...WIN, active: false }, '2026-03-08'), false)
})

// ---- the day list the repair pass will consume ----

test('windowDays is inclusive of both ends', () => {
  assert.deepEqual(windowDays(WIN), [
    '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07',
  ])
})

test('an open-ended window runs to today, not forever', () => {
  const w = { active: true, started_at: '2026-03-03', ends_at: null }
  assert.deepEqual(windowDays(w, { todayYMD: '2026-03-05' }), [
    '2026-03-03', '2026-03-04', '2026-03-05',
  ])
})

test('a month boundary and a leap day are not dropped', () => {
  const w = { active: true, started_at: '2028-02-27', ends_at: '2028-03-02' }
  assert.deepEqual(windowDays(w), ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02'])
})

test('a typo cannot ask for hundreds of thousands of days', () => {
  const w = { active: true, started_at: '0202-01-01', ends_at: '2026-01-01' }
  assert.equal(windowDays(w).length, 400)
})

test('no start means no days, rather than guessing one', () => {
  assert.deepEqual(windowDays({ active: true, started_at: null }), [])
  assert.deepEqual(windowDays({ active: true, started_at: null, ends_at: null }, { todayYMD: '2026-03-05' }), [])
})

test('an open-ended window with no today resolves to no days', () => {
  const w = { active: true, started_at: '2026-03-03', ends_at: null }
  assert.deepEqual(windowDays(w), [])
})
