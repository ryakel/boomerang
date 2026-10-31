import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScanResponse, nextWeekday, entryToTask, scanSystemPrompt } from '../src/scheduleScan.js'

const TODAY = '2026-10-31' // a Saturday

test('nextWeekday resolves on-or-after today', () => {
  assert.equal(nextWeekday(TODAY, 'saturday'), '2026-10-31')
  assert.equal(nextWeekday(TODAY, 'Monday'), '2026-11-02')
  assert.equal(nextWeekday(TODAY, 'friday'), '2026-11-06')
  assert.equal(nextWeekday(TODAY, 'someday'), null)
})

test('weekday-only timetable becomes dated entries, sorted', () => {
  const raw = 'Here you go:\n{"entries":[{"title":"Maths","date":null,"weekday":"wednesday","start":"9:00","end":"10:00","location":"Room 4"},{"title":"Maths","weekday":"monday","start":"09:00"}]}'
  const out = parseScanResponse(raw, TODAY)
  assert.deepEqual(out.map(e => [e.date, e.start, e.end, e.location]), [
    ['2026-11-02', '09:00', null, null],
    ['2026-11-04', '09:00', '10:00', 'Room 4'],
  ])
})

test('drops untitled and undated rows, rejects bad dates and times', () => {
  const raw = JSON.stringify({ entries: [
    { title: '', date: '2026-11-01' },
    { title: 'No date' },
    { title: 'Bad date', date: '2026-02-30' },
    { title: 'Shift', date: '2026-11-03', start: '25:00', end: '26:00' },
  ] })
  const out = parseScanResponse(raw, TODAY)
  assert.equal(out.length, 1)
  assert.equal(out[0].title, 'Shift')
  assert.equal(out[0].start, null)
  assert.equal(out[0].end, null)
})

test('past entries are flagged, not dropped', () => {
  const out = parseScanResponse('{"entries":[{"title":"Old","date":"2026-10-01"}]}', TODAY)
  assert.equal(out[0].past, true)
})

test('unparseable output throws a readable error', () => {
  assert.throws(() => parseScanResponse('sorry, no', TODAY), /Could not read a schedule/)
  assert.deepEqual(parseScanResponse('{"entries":[]}', TODAY), [])
})

test('entryToTask carries time/place in notes and reminds only when asked', () => {
  const e = { title: 'Lunch with Maya', date: '2026-11-02', start: '12:00', end: '13:00', location: 'Corner Cafe' }
  const t = entryToTask(e)
  assert.equal(t.dueDate, '2026-11-02')
  assert.match(t.notes, /^12:00–13:00 · Corner Cafe/)
  assert.equal(t.remindAt, null)
  assert.equal(entryToTask(e, { remind: true }).remindAt, '2026-11-02T12:00')
  assert.equal(entryToTask({ ...e, start: null }, { remind: true }).remindAt, null)
})

test('prompt names today and its weekday', () => {
  assert.match(scanSystemPrompt(TODAY), /saturday 2026-10-31/)
})
