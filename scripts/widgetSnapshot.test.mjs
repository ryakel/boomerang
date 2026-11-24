// The iOS widget's snapshot and its day-rollover view (BOOM-61).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { widgetSnapshot, widgetView } from '../src/widgetSnapshot.js'

process.env.TZ = 'America/Chicago'
const NOW = new Date(2026, 10, 24, 8, 0) // Tue Nov 24, 8:00
const t = (id, over = {}) => ({ id, title: id, status: 'not_started', ...over })
const tasks = [
  t('due-today', { due_date: '2026-11-24' }),
  t('slipped', { due_date: '2026-11-20' }),
  t('kept', { pinned_to_today: true }),
  t('kept-dated', { pinned_to_today: true, due_date: '2026-11-27' }),
  t('loop-today', { due_date: '2026-11-24', routine_id: 'r1' }),
  t('wed', { due_date: '2026-11-25' }),
  t('loop-wed', { due_date: '2026-11-25', routine_id: 'r1' }),
  t('far', { due_date: '2026-12-20' }),
  t('done', { due_date: '2026-11-24', status: 'done' }),
  t('pending', { due_date: '2026-11-24', gmail_pending: true }),
  t('prio', { week_priority: '2026-11-23' }),
]
const routines = [{ id: 'r1', title: 'Loop' }]

test('the snapshot holds Today as the Tasks screen groups it, the week ahead and the week’s priorities', () => {
  const s = widgetSnapshot({ tasks, routines, now: NOW })
  assert.equal(s.day, '2026-11-24')
  assert.deepEqual(s.today.map(x => x.title).sort(), ['due-today', 'kept', 'kept-dated', 'loop-today'])
  assert.equal(s.todayCount, 4)
  assert.deepEqual(s.upcoming.map(x => x.title), ['loop-wed', 'wed'])
  assert.deepEqual(s.priorities.map(x => x.title), ['prio'])
  assert.equal(JSON.parse(JSON.stringify(s)).v, 1, 'plain JSON')
})

test('the same day reads the snapshot as it is', () => {
  const v = widgetView(widgetSnapshot({ tasks, routines, now: NOW }), '2026-11-24')
  assert.equal(v.stale, false)
  assert.equal(v.count, 4)
})

test('a day later with the app unopened: undated, kept and loop items stay, dated ones slip, the next day’s arrive', () => {
  const v = widgetView(widgetSnapshot({ tasks, routines, now: NOW }), '2026-11-25')
  assert.equal(v.stale, true)
  assert.deepEqual(v.titles.sort(), ['kept', 'kept-dated', 'loop-today', 'loop-wed', 'wed'])
  // Three days on, the kept-with-a-date task is simply due that day; Wednesday's plain task has slipped.
  assert.deepEqual(widgetView(widgetSnapshot({ tasks, routines, now: NOW }), '2026-11-28').titles.sort(), ['kept', 'loop-today', 'loop-wed'])
})

test('a missing or unknown snapshot reads as empty and stale', () => {
  assert.deepEqual(widgetView(null, '2026-11-24'), { count: 0, titles: [], stale: true, priorities: [] })
  assert.equal(widgetView({ v: 99 }, '2026-11-24').stale, true)
})
