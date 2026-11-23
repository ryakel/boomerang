// The week (BOOM-59), calendar blocks (BOOM-57) and the retired calendar push
// (BOOM-58). Local clock times are pinned to one zone below.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { weekStart, reviewWeek, isReviewDay, weekPriorities, reviewState, priorityCandidates, priorityUpdates, dueInWeek, MAX_PRIORITIES } from '../src/weekPlan.js'
import { suggestSlots, blockEvent, blockFields, NO_BLOCK, defaultBlockMinutes, slotLabel, blockLabel } from '../src/blockModel.js'
import { normalizeEvents } from '../src/todayModel.js'
import { matchEvent } from '../server/calendarRules.js'

process.env.TZ = 'America/Chicago' // Node re-reads TZ, so local times below are fixed
const at = (s) => new Date(s).getTime()
const task = (over = {}) => ({ id: over.id || Math.random().toString(36).slice(2), title: 'T', status: 'not_started', ...over })

// ── the week ────────────────────────────────────────────────────────────────
// 2026-11-23 is a Monday; 11-27 a Friday; 11-29 a Sunday.
test('weeks run Monday to Sunday; Friday to Sunday plan the coming week', () => {
  assert.equal(weekStart('2026-11-23'), '2026-11-23')
  assert.equal(weekStart('2026-11-26'), '2026-11-23')
  assert.equal(weekStart('2026-11-29'), '2026-11-23')
  assert.equal(weekStart('2026-11-30'), '2026-11-30')
  assert.deepEqual(['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30'].map(isReviewDay), [false, true, true, true, false])
  assert.equal(reviewWeek('2026-11-27'), '2026-11-30')
  assert.equal(reviewWeek('2026-11-29'), '2026-11-30')
  assert.equal(reviewWeek('2026-11-24'), '2026-11-23')
})

test('the review is offered Friday through Sunday, goes quiet once planned or skipped, and is gone by Monday', () => {
  const tasks = [task({ id: 'a' })]
  assert.equal(reviewState({ tasks, dayKey: '2026-11-26' }).state, null, 'Thursday: no offer')
  assert.equal(reviewState({ tasks, dayKey: '2026-11-27' }).state, 'offer')
  assert.equal(reviewState({ tasks, dayKey: '2026-11-29' }).state, 'offer', 'still offered Sunday')
  assert.equal(reviewState({ tasks, dayKey: '2026-11-28', skippedWeek: '2026-11-30' }).state, null, 'skipped this weekend')
  const planned = reviewState({ tasks: [task({ id: 'a', week_priority: '2026-11-30' })], dayKey: '2026-11-27' })
  assert.equal(planned.state, 'planned')
  assert.deepEqual(planned.picked.map(t => t.id), ['a'])
  assert.equal(reviewState({ tasks, dayKey: '2026-11-30' }).state, null, 'Monday: gone')
})

test('this week shows its own priorities only; done, dismissed-pending and old weeks drop off', () => {
  const tasks = [
    task({ id: 'now', title: 'B now', week_priority: '2026-11-23' }),
    task({ id: 'now2', title: 'A now', week_priority: '2026-11-23' }),
    task({ id: 'done', week_priority: '2026-11-23', status: 'done' }),
    task({ id: 'old', week_priority: '2026-11-16' }),
    task({ id: 'next', week_priority: '2026-11-30' }),
    task({ id: 'pending', week_priority: '2026-11-23', gmail_pending: true }),
  ]
  assert.deepEqual(weekPriorities(tasks, '2026-11-25').map(t => t.id), ['now2', 'now'])
  assert.deepEqual(weekPriorities(tasks, '2026-11-30').map(t => t.id), ['next'])
})

test('candidates put picks and carry-overs first, then high priority, due that week, kept on Today, overdue', () => {
  const tasks = [
    task({ id: 'plain' }),
    task({ id: 'over', due_date: '2026-11-20' }),
    task({ id: 'kept', pinned_to_today: true }),
    task({ id: 'due', due_date: '2026-12-02' }),
    task({ id: 'high', high_priority: true }),
    task({ id: 'carry', week_priority: '2026-11-23' }),
    task({ id: 'picked', week_priority: '2026-11-30' }),
    task({ id: 'proj', status: 'project', high_priority: true }),
  ]
  const c = priorityCandidates(tasks, '2026-11-27')
  assert.deepEqual(c.map(x => x.task.id), ['picked', 'carry', 'high', 'due', 'kept', 'over'])
  assert.equal(c.find(x => x.task.id === 'due').why, 'due that week')
})

test('saving picks sets the week on the picked, clears it on the un-picked, and refuses a fourth', () => {
  const tasks = [task({ id: 'a', week_priority: '2026-11-30' }), task({ id: 'b' }), task({ id: 'c', week_priority: '2026-11-23' })]
  assert.deepEqual(priorityUpdates(tasks, '2026-11-30', ['b']), [['a', { week_priority: null }], ['b', { week_priority: '2026-11-30' }]])
  assert.deepEqual(priorityUpdates(tasks, '2026-11-30', ['a']), [], 'nothing changed, nothing written')
  assert.equal(MAX_PRIORITIES, 3)
  assert.throws(() => priorityUpdates(tasks, '2026-11-30', ['a', 'b', 'c', 'd']), /at most 3/)
})

test('due next week lists open tasks in that week by date', () => {
  const tasks = [task({ id: 'x', due_date: '2026-12-04' }), task({ id: 'y', due_date: '2026-11-30' }), task({ id: 'z', due_date: '2026-12-07' }), task({ id: 'd', due_date: '2026-12-01', status: 'done' })]
  assert.deepEqual(dueInWeek(tasks, '2026-11-30').map(t => t.id), ['y', 'x'])
})

// ── blocks ──────────────────────────────────────────────────────────────────
const ev = (id, start, end, extra = {}) => ({ id, busy: true, startMs: at(start), endMs: at(end), ...extra })

test('a block length starts from the task size', () => {
  assert.deepEqual(['XS', 'S', 'M', 'L', 'XL', undefined].map(size => defaultBlockMinutes({ size })), [30, 30, 60, 90, 90, 30])
})

test('suggested slots are free gaps today on the quarter hour, skipping busy events but not free ones', () => {
  const now = at('2026-11-23T13:07:00')
  const events = [
    ev('meet', '2026-11-23T13:30:00', '2026-11-23T14:30:00'),
    { id: 'free', busy: false, startMs: at('2026-11-23T14:30:00'), endMs: at('2026-11-23T18:00:00') },
  ]
  const slots = suggestSlots({ events, now, minutes: 60 })
  assert.deepEqual(slots.map(s => new Date(s.startMs).toTimeString().slice(0, 5)), ['14:30', '15:30', '16:30'])
})

test('a full day falls through to tomorrow morning, and moving a block may reuse its own time', () => {
  const now = at('2026-11-23T18:50:00')
  const slots = suggestSlots({ events: [], now, minutes: 60 })
  // Only one hour left before 8 PM (19:00-20:00), so tomorrow fills the rest.
  assert.deepEqual(slots.map(s => new Date(s.startMs).toString().slice(0, 21)), ['Mon Nov 23 2026 19:00', 'Tue Nov 24 2026 09:00', 'Tue Nov 24 2026 10:00'])
  const own = [ev('mine', '2026-11-24T09:00:00', '2026-11-24T10:00:00')]
  const late = at('2026-11-23T21:00:00')
  assert.equal(new Date(suggestSlots({ events: own, now: late, minutes: 60 })[0].startMs).getHours(), 10)
  assert.equal(new Date(suggestSlots({ events: own, now: late, minutes: 60, ignoreEventId: 'mine' })[0].startMs).getHours(), 9)
})

test('the block event is marked as Boomerang’s and tied to its task; its fields round-trip', () => {
  const t = task({ id: 't1', title: 'Write the report', notes: 'draft v2' })
  const e = blockEvent(t, { startMs: at('2026-11-24T09:00:00'), minutes: 90, timeZone: 'America/Chicago' })
  assert.equal(e.summary, 'Write the report')
  assert.match(e.description, /^draft v2\n\nFocus block for a Boomerang task\.\n---\nManaged by Boomerang$/)
  assert.equal(Date.parse(e.end.dateTime) - Date.parse(e.start.dateTime), 90 * 60000)
  assert.deepEqual(e.extendedProperties, { private: { boomerangBlock: 't1' } })
  const f = blockFields({ eventId: 'ev1', calendarId: 'cal', startMs: at('2026-11-24T09:00:00'), minutes: 90 })
  assert.equal(f.block_event_id, 'ev1')
  assert.equal(blockLabel({ ...t, ...f }, at('2026-11-23T12:00:00')), 'Tomorrow 9:00–10:30 AM')
  assert.equal(blockLabel({ ...t, ...f, ...NO_BLOCK }, at('2026-11-23T12:00:00')), null)
  assert.equal(slotLabel(at('2026-11-23T11:30:00'), 60, at('2026-11-23T08:00:00')), 'Today 11:30 AM–12:30 PM')
})

test('Today keeps a block on the schedule as its task’s focus time, but still hides an imported event', () => {
  const tasks = [task({ id: 'b', block_event_id: 'blk' }), task({ id: 'i', gcal_event_id: 'imp' })]
  const raw = [
    { id: 'blk', summary: 'Write', start: { dateTime: '2026-11-24T09:00:00-06:00' }, end: { dateTime: '2026-11-24T10:00:00-06:00' } },
    { id: 'imp', summary: 'Dentist', start: { dateTime: '2026-11-24T11:00:00-06:00' }, end: { dateTime: '2026-11-24T12:00:00-06:00' } },
  ]
  const out = normalizeEvents(raw, tasks)
  assert.deepEqual(out.map(e => e.id), ['blk'])
  assert.equal(out[0].blockTaskId, 'b')
  assert.equal(out[0].busy, true, 'a block claims its time')
})

test('a calendar rule never fires on Boomerang’s own events', () => {
  const rule = { enabled: true, conditions: [{ field: 'title', op: 'contains', value: 'report' }] }
  const own = { id: 'x', summary: 'Write the report', description: 'Focus block for a Boomerang task.\n---\nManaged by Boomerang' }
  assert.equal(matchEvent(rule, own).matched, false)
  assert.equal(matchEvent(rule, { ...own, description: 'Team sync' }).matched, true)
})

// ── calendar push retired (BOOM-58) ─────────────────────────────────────────
test('only a block creates a calendar event for a task: no other client code calls gcalCreateEvent', () => {
  const files = []
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(n) && files.push(p) } }
  walk('src')
  const callers = files.filter(f => f !== join('src', 'api.js') && /gcalCreateEvent\s*\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(callers, [join('src', 'blockActions.js')])
  const sync = readFileSync('src/hooks/useExternalSync.js', 'utf8')
  assert.doesNotMatch(sync, /gcal(Create|Update|Delete)Event\s*\(/, 'the external sync hook never writes to the calendar')
})

// ── storage ─────────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'boom-week-'))
let db
before(async () => { db = await import('../server/db.js'); await db.initDb(join(dir, 'week.db')) })
after(() => { try { db.flushNow() } catch { /* nothing pending */ } try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } })

test('block fields and week_priority persist on the task (migration 064)', () => {
  const t = { id: 'persist-1', title: 'Persist', status: 'not_started', created_at: new Date().toISOString(),
    block_event_id: 'ev9', block_calendar_id: 'primary', block_start: '2026-11-24T15:00:00.000Z', block_minutes: 60, week_priority: '2026-11-30' }
  db.upsertTask(t)
  const back = db.getTask('persist-1')
  assert.equal(back.block_event_id, 'ev9')
  assert.equal(back.block_calendar_id, 'primary')
  assert.equal(back.block_start, '2026-11-24T15:00:00.000Z')
  assert.equal(back.block_minutes, 60)
  assert.equal(back.week_priority, '2026-11-30')
  db.updateTaskPartial('persist-1', { block_event_id: null, block_calendar_id: null, block_start: null, block_minutes: null, week_priority: null })
  const cleared = db.getTask('persist-1')
  assert.equal(cleared.block_event_id, null)
  assert.equal(cleared.block_minutes, null)
  assert.equal(cleared.week_priority, null)
})
