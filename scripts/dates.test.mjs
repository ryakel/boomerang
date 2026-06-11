import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLocalDate, localYMD, addDays, weekStartMonday } from '../src/dates.js'

test('YMD strings are local days (the UTC-midnight trap)', () => {
  const d = parseLocalDate('2026-06-10')
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 5)
  assert.equal(d.getDate(), 10)        // bare new Date() gives 9 west of UTC
  assert.equal(d.getHours(), 0)
  assert.equal(localYMD('2026-06-10'), '2026-06-10')  // passthrough
})

test('localYMD handles Date, ISO timestamp, default', () => {
  assert.equal(localYMD(new Date(2026, 0, 5)), '2026-01-05')
  const iso = new Date(2026, 11, 31, 23, 30).toISOString()
  assert.equal(localYMD(iso), localYMD(new Date(2026, 11, 31, 23, 30)))
  assert.match(localYMD(), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(localYMD('garbage'), null)
})

test('addDays crosses month boundaries on local calendar', () => {
  assert.equal(localYMD(addDays('2026-01-31', 1)), '2026-02-01')
  assert.equal(localYMD(addDays('2026-03-01', -1)), '2026-02-28')
  assert.equal(localYMD(addDays('2024-02-28', 1)), '2024-02-29') // leap
})

test('streak chaining: consecutive YMD keys differ by exactly one addDays', () => {
  const days = ['2026-06-08', '2026-06-09', '2026-06-10']
  for (let i = 1; i < days.length; i++) {
    assert.equal(localYMD(addDays(days[i - 1], 1)), days[i])
  }
})

test('weekStartMonday anchors to Monday', () => {
  const ws = weekStartMonday('2026-06-10') // a Wednesday
  assert.equal(ws.getDay(), 1)
  assert.equal(localYMD(ws), '2026-06-08')
  assert.equal(localYMD(weekStartMonday('2026-06-08')), '2026-06-08') // Monday stays
})
