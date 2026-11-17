import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeNotNow, normalizeNotNow, sameNotNow } from '../server/notNowMerge.js'

// "Not now" synced across devices (BOOM-43): a dismissal on the phone must
// hold on the desktop, and yesterday's skips must not come back.

const phone = { date: '2026-11-17', entries: { a: 'due-soon' } }
const desk = { date: '2026-11-17', entries: { b: 'quick' } }

test('same day: both devices\' dismissals count', () => {
  assert.deepEqual(mergeNotNow(phone, desk), { date: '2026-11-17', entries: { a: 'due-soon', b: 'quick' } })
  assert.deepEqual(mergeNotNow(desk, phone).entries, { a: 'due-soon', b: 'quick' })
})

test('different days: the later day wins outright', () => {
  const yesterday = { date: '2026-11-16', entries: { old: 'x' } }
  assert.deepEqual(mergeNotNow(yesterday, phone), phone)
  assert.deepEqual(mergeNotNow(phone, yesterday), phone)
})

test('nothing or junk on one side keeps the other', () => {
  assert.deepEqual(mergeNotNow(null, phone), phone)
  assert.deepEqual(mergeNotNow(phone, { date: 'tuesday' }), phone)
  assert.equal(normalizeNotNow({ entries: {} }), null)
  assert.equal(mergeNotNow(null, undefined), null)
})

test('a merge that adds nothing is the same state (no write, no re-render)', () => {
  assert.equal(sameNotNow(mergeNotNow(phone, { date: '2026-11-17', entries: { a: 'due-soon' } }), phone), true)
  assert.equal(sameNotNow(phone, desk), false)
})
