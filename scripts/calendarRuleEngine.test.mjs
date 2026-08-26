// Integration test for the calendar-rule engine — the half that writes.
//
// calendarRules.test.mjs pins whether an event matches; this pins what reaches
// the database when it does, with Google stubbed at the listEvents dep. The
// properties below are the ones that turn a useful rule into a task flood if
// they break, so they get a real db rather than a mock.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeRule, shiftDate } from '../server/calendarRules.js'
import { ymdInTz, DEFAULT_TIMEZONE } from '../server/taskModel.js'

const dir = mkdtempSync(join(tmpdir(), 'boom-calrules-'))
let db, engine
let calendar = []          // what the stubbed Google returns
let failNextFetch = false

before(async () => {
  db = await import('../server/db.js')
  engine = await import('../server/calendarRuleEngine.js')
  await db.initDb(join(dir, 'calrules.db'))
  engine.initCalendarRules({
    listEvents: async () => {
      if (failNextFetch) throw new Error('calendar unreachable')
      return calendar
    },
    isConnected: () => true,
    broadcast: () => {},
  })
})

after(() => {
  try { db.flushNow() } catch { /* nothing pending */ }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
})

let ruleSeq = 0
function saveRule(overrides = {}) {
  const rule = normalizeRule({
    name: `Flight rule ${++ruleSeq}`,
    conditions: [{ field: 'title', op: 'matches', value: 'N(\\d{4}[A-Z])' }],
    template: { title: 'Update the flight budget spreadsheet', due_offset_days: 1 },
    ...overrides,
  })
  rule.id = `rule-${ruleSeq}`
  rule.created_at = new Date().toISOString()
  return db.upsertGCalRule(rule)
}

const flight = (id, date = '2026-09-10') => ({
  id,
  summary: 'Ryan Kelch in N5274S with Marty Kemp',
  location: "Hap's Air Service, Ames, IA",
  description: '',
  status: 'confirmed',
  start: { dateTime: `${date}T09:00:00-05:00` },
  end: { dateTime: `${date}T11:00:00-05:00` },
})

const rulesTasks = () => db.getAllTasks().filter(t => t.capture_source === 'gcal_rule')

// --- baselining ------------------------------------------------------------

test('saving a rule baselines what is already on the calendar and creates nothing', async () => {
  calendar = [flight('evt-a'), flight('evt-b', '2026-09-17')]
  const rule = saveRule()
  const baselined = await engine.baselineRule(rule)

  assert.equal(baselined, 2)
  assert.equal(rulesTasks().length, 0, 'a new rule must never backfill')
  assert.equal(db.countGCalRuleBaselined(rule.id), 2)
})

test('the poll leaves baselined events alone', async () => {
  const before = rulesTasks().length
  await engine.runCalendarRules('manual')
  assert.equal(rulesTasks().length, before)
})

test('applying to existing creates exactly the baselined tasks, once', async () => {
  const rule = db.listGCalRules()[0]
  const { created } = await engine.applyRuleToExisting(rule.id)
  assert.equal(created, 2)
  assert.equal(rulesTasks().length, 2)

  const again = await engine.applyRuleToExisting(rule.id)
  assert.equal(again.created, 0, 'the baseline is spent')
  assert.equal(db.countGCalRuleBaselined(rule.id), 0)
})

// --- firing ----------------------------------------------------------------

test('a newly-appeared event fires the rule exactly once', async () => {
  calendar = [...calendar, flight('evt-new', '2026-09-24')]
  await engine.runCalendarRules('manual')
  assert.equal(rulesTasks().length, 3)

  await engine.runCalendarRules('manual')
  assert.equal(rulesTasks().length, 3, 'a second poll must not create a duplicate')
})

test('editing the event does not buy it a second task', async () => {
  calendar = calendar.map(e => (e.id === 'evt-new' ? { ...e, summary: `${e.summary} (moved)` } : e))
  await engine.runCalendarRules('manual')
  assert.equal(rulesTasks().length, 3)
})

test('the task is what the template says, and carries no calendar ownership', async () => {
  const task = rulesTasks().find(t => t.due_date === '2026-09-25')
  assert.ok(task, 'the event on the 24th produced a task due the 25th')
  assert.equal(task.title, 'Update the flight budget spreadsheet')
  assert.equal(task.status, 'not_started')
  // The one that would delete a real flight off the calendar on completion.
  assert.equal(task.gcal_event_id, null)
})

test('each instance of a recurring series gets its own task', async () => {
  const rule = saveRule({ template: { title: 'Log flight hours', due_offset_days: 0 } })
  const series = [
    { ...flight('inst-1', '2026-10-01'), recurringEventId: 'series-1' },
    { ...flight('inst-2', '2026-10-08'), recurringEventId: 'series-1' },
    { ...flight('inst-3', '2026-10-15'), recurringEventId: 'series-1' },
  ]
  calendar = series
  await engine.baselineRule(db.getGCalRule(rule.id))
  assert.equal(db.countGCalRuleBaselined(rule.id), 3)
  const { created } = await engine.applyRuleToExisting(rule.id)
  assert.equal(created, 3, 'a weekly flight is a weekly task, not one task for the series')
})

test('a cancelled instance does not fire', async () => {
  const rule = saveRule({ template: { title: 'Should not exist', due_offset_days: 0 } })
  calendar = [{ ...flight('evt-cancelled', '2026-11-01'), status: 'cancelled' }]
  await engine.baselineRule(db.getGCalRule(rule.id))
  assert.equal(db.countGCalRuleBaselined(rule.id), 0)
  await engine.runCalendarRules('manual')
  assert.equal(rulesTasks().filter(t => t.title === 'Should not exist').length, 0)
})

test('a disabled rule fires nothing', async () => {
  const rule = saveRule({ enabled: false, template: { title: 'Disabled rule task', due_offset_days: 0 } })
  calendar = [flight('evt-disabled', '2026-11-05')]
  await engine.runCalendarRules('manual')
  assert.equal(rulesTasks().filter(t => t.title === 'Disabled rule task').length, 0)
  assert.equal(db.getGCalRule(rule.id).enabled, false)
})

// --- the failure that matters ----------------------------------------------

test('baselining REJECTS when the calendar cannot be read', async () => {
  const rule = saveRule({ template: { title: 'Unbaselined', due_offset_days: 0 } })
  failNextFetch = true
  await assert.rejects(() => engine.baselineRule(db.getGCalRule(rule.id)), /unreachable/)
  failNextFetch = false
  // Baselining zero events on a failed read is what would hand the next poll
  // the entire calendar — an empty answer must never be mistaken for a real one.
  assert.equal(db.countGCalRuleBaselined(rule.id), 0)
})

// --- suppression -----------------------------------------------------------

test('a suppressing rule claims its events so the pull sync skips them', () => {
  saveRule({ suppress_event_import: true, template: { title: 'Budget', due_offset_days: 1 } })
  const events = [flight('evt-supp'), { ...flight('evt-other'), summary: 'Dentist' }]
  assert.deepEqual(engine.suppressedEventIds(events), ['evt-supp'])
})

test('suppression is answered from the rules, not the fire ledger — it holds before the poll runs', () => {
  // The race this exists to close: the app pulls a minute before the poller
  // fires. Nothing has been recorded for this event yet, and the answer must
  // still be "a rule owns it".
  const unseen = flight('evt-never-seen', '2027-01-01')
  assert.deepEqual(engine.suppressedEventIds([unseen]), ['evt-never-seen'])
})

test('a rule that does not suppress leaves the event importable', () => {
  assert.deepEqual(engine.suppressedEventIds([{ ...flight('evt-x'), summary: 'Dentist' }]), [])
})

// --- only events that haven't started yet ----------------------------------
//
// Relative to the real clock, because the engine reads it: a rule with
// future_only on has to make the same call the poller would make right now.

const hoursFromNow = (h) => new Date(Date.now() + h * 3600_000).toISOString()

const timedFlight = (id, hours) => ({
  id,
  summary: 'Ryan Kelch in N5274S with Marty Kemp',
  location: "Hap's Air Service, Ames, IA",
  description: '',
  status: 'confirmed',
  start: { dateTime: hoursFromNow(hours) },
  end: { dateTime: hoursFromNow(hours + 2) },
})

const titled = (title) => rulesTasks().filter(t => t.title === title)

// The due date a +1-day rule produces for an event `hours` from now, read the
// way the engine reads it: the event's own date, then shifted.
const dueFor = (hours) => shiftDate(hoursFromNow(hours).split('T')[0], 1)

test('a future_only rule does not fire on an event already under way', async () => {
  const rule = saveRule({ future_only: true, template: { title: 'Future-only budget', due_offset_days: 1 } })
  // Under way: started an hour ago, ends in an hour. The Calendar API still
  // returns it, because timeMin filters on the event's END.
  calendar = [timedFlight('evt-underway', -1)]
  await engine.baselineRule(db.getGCalRule(rule.id))
  assert.equal(db.countGCalRuleBaselined(rule.id), 0, 'nothing reserved that can never fire')
  await engine.runCalendarRules('manual')
  assert.equal(titled('Future-only budget').length, 0)
})

test('the same rule fires as soon as the event is one that has not started', async () => {
  calendar = [timedFlight('evt-underway', -1), timedFlight('evt-upcoming', 48)]
  await engine.runCalendarRules('manual')
  assert.equal(titled('Future-only budget').length, 1, 'the upcoming one, and only the upcoming one')
})

test('an all-day event covering today does not fire; tomorrow’s does', async () => {
  const rule = saveRule({ future_only: true, template: { title: 'All-day budget', due_offset_days: 0 } })
  // In the SAME timezone the engine judges all-day events by, or this test
  // would pass or fail depending on what time of day it ran.
  const ymd = (d) => ymdInTz(new Date(Date.now() + d * 86400_000), DEFAULT_TIMEZONE)
  calendar = [
    { ...timedFlight('evt-allday-today', 0), start: { date: ymd(0) }, end: { date: ymd(1) } },
    { ...timedFlight('evt-allday-later', 0), start: { date: ymd(3) }, end: { date: ymd(4) } },
  ]
  await engine.runCalendarRules('manual')
  assert.equal(titled('All-day budget').length, 1)
  assert.equal(db.getGCalRuleFires(rule.id).has('evt-allday-today'), false, 'today’s is left unrecorded, not baselined')
})

// THE regression. Suppression must not follow the future check: an event that
// stopped being suppressed the moment it started would drop the flight a rule
// exists to REPLACE into the task list halfway through the flight.
test('a future_only rule STILL suppresses an event already under way', () => {
  saveRule({
    future_only: true,
    suppress_event_import: true,
    template: { title: 'Suppressing budget', due_offset_days: 1 },
  })
  const underway = timedFlight('evt-supp-underway', -1)
  assert.deepEqual(engine.suppressedEventIds([underway]), ['evt-supp-underway'],
    'the rule will not fire on it, but it still owns it')
})

test('turning future_only on for an existing rule withholds its already-baselined past events', async () => {
  const rule = saveRule({ template: { title: 'Retro budget', due_offset_days: 0 } })
  calendar = [timedFlight('evt-retro-past', -3), timedFlight('evt-retro-future', 72)]
  await engine.baselineRule(db.getGCalRule(rule.id))
  assert.equal(db.countGCalRuleBaselined(rule.id), 2, 'baselined both while future_only was off')

  db.upsertGCalRule({ ...db.getGCalRule(rule.id), future_only: true })
  const { created } = await engine.applyRuleToExisting(rule.id)
  assert.equal(created, 1, 'apply honours the option too, not just the poll')
  assert.equal(titled('Retro budget').length, 1)
})

test('future_only survives a round-trip through the database', () => {
  const rule = saveRule({ future_only: true, template: { title: 'Round trip', due_offset_days: 0 } })
  assert.equal(db.getGCalRule(rule.id).future_only, true)
  assert.equal(db.listGCalRules().find(r => r.id === rule.id).future_only, true)
})

// --- stack vs update -------------------------------------------------------

test('stack (the default) gives every event its own task', async () => {
  const rule = saveRule({ template: { title: 'Stacked budget', due_offset_days: 1 } })
  calendar = [timedFlight('evt-stack-1', 24), timedFlight('evt-stack-2', 192)]
  await engine.applyRuleToExisting(rule.id) // nothing baselined yet
  await engine.runCalendarRules('manual')
  assert.equal(titled('Stacked budget').length, 2)
})

test('update folds the second event into the first task instead of adding a card', async () => {
  const rule = saveRule({ on_repeat: 'update', template: { title: 'One budget task', due_offset_days: 1 } })
  calendar = [timedFlight('evt-upd-1', 24)]
  await engine.runCalendarRules('manual')
  assert.equal(titled('One budget task').length, 1)
  const first = titled('One budget task')[0]

  calendar = [...calendar, timedFlight('evt-upd-2', 192)]
  await engine.runCalendarRules('manual')
  const tasks = titled('One budget task')
  assert.equal(tasks.length, 1, 'still one card')
  assert.equal(tasks[0].id, first.id, 'the same card')
  assert.equal(db.getGCalRuleFires(rule.id).get('evt-upd-2'), first.id,
    'the ledger records the second event as handled, by that task')
})

test('a later event does not push the due date out', () => {
  // evt-upd-1 is a day out, evt-upd-2 eight days out, +1 day offset on each. The
  // task must still be due for the SOONER one — otherwise every new flight walks
  // it to the far edge of the window and it never comes due at all.
  const task = titled('One budget task')[0]
  assert.equal(task.due_date, dueFor(24), `due ${task.due_date} drifted off the nearer event`)
})

test('a SOONER event pulls the due date in, and stamps why', async () => {
  saveRule({ on_repeat: 'update', template: { title: 'Pulled-in budget', due_offset_days: 1 } })
  calendar = [timedFlight('evt-pull-far', 192)]
  await engine.runCalendarRules('manual')
  const task = titled('Pulled-in budget')[0]
  assert.equal(task.due_date, dueFor(192))

  calendar = [...calendar, timedFlight('evt-pull-near', 24)]
  await engine.runCalendarRules('manual')

  const after = db.getTask(task.id)
  assert.equal(after.due_date, dueFor(24), 'pulled in to the nearer flight')
  // Provenance on the row: "did I set this date or did the system?" has to stay
  // answerable without the rule that moved it.
  assert.match(after.due_shifted_reason, /calendar rule "Flight rule/)
  assert.equal(after.due_date_original, dueFor(192), 'the pre-shift date is preserved')
  assert.ok(after.due_shifted_at)
})

test('update leaves the title, status and the user’s own notes alone', async () => {
  saveRule({ on_repeat: 'update', template: { title: 'Editable budget', due_offset_days: 1 } })
  calendar = [timedFlight('evt-edit-1', 24)]
  await engine.runCalendarRules('manual')
  const created = titled('Editable budget')[0]

  // The user renames it, starts it, and writes their own notes.
  db.updateTaskPartial(created.id, {
    title: 'Budget spreadsheet — Q3 tab',
    status: 'doing',
    notes: 'Ask Marty for the Hobbs reading first',
  })

  calendar = [...calendar, timedFlight('evt-edit-2', 192)]
  await engine.runCalendarRules('manual')

  const after = db.getTask(created.id)
  assert.equal(after.title, 'Budget spreadsheet — Q3 tab', 'the rule does not rewrite the user’s title')
  assert.equal(after.status, 'doing', 'and does not reset progress')
  assert.match(after.notes, /Ask Marty for the Hobbs reading first/, 'the user’s notes survive')
  assert.match(after.notes, /Also covers:/, 'with the absorbed event appended, so the date move is explicable')
})

test('update does NOT refresh last_touched — a rule must not hide a task going stale', async () => {
  saveRule({ on_repeat: 'update', template: { title: 'Stale-proof budget', due_offset_days: 1 } })
  calendar = [timedFlight('evt-stale-1', 24)]
  await engine.runCalendarRules('manual')
  const created = titled('Stale-proof budget')[0]
  db.updateTaskPartial(created.id, { last_touched: '2026-01-01T00:00:00Z' })

  calendar = [...calendar, timedFlight('evt-stale-2', 192)]
  await engine.runCalendarRules('manual')
  assert.equal(db.getTask(created.id).last_touched, '2026-01-01T00:00:00Z')
})

test('once the task is done, the next event starts a fresh one rather than reopening it', async () => {
  saveRule({ on_repeat: 'update', template: { title: 'Recurring budget', due_offset_days: 1 } })
  calendar = [timedFlight('evt-done-1', 24)]
  await engine.runCalendarRules('manual')
  const first = titled('Recurring budget')[0]
  db.updateTaskPartial(first.id, { status: 'done', completed_at: new Date().toISOString() })

  calendar = [...calendar, timedFlight('evt-done-2', 192)]
  await engine.runCalendarRules('manual')
  const live = db.getAllTasks().filter(t => t.title === 'Recurring budget' && t.status !== 'done')
  assert.equal(live.length, 1, 'a new task, not a resurrected one')
  assert.equal(db.getTask(first.id).status, 'done', 'the finished one stays finished')
})

test('deleting the shared task does not disable the rule', async () => {
  saveRule({ on_repeat: 'update', template: { title: 'Deletable budget', due_offset_days: 1 } })
  calendar = [timedFlight('evt-del-1', 24)]
  await engine.runCalendarRules('manual')
  const created = titled('Deletable budget')[0]
  db.deleteTask(created.id)

  calendar = [...calendar, timedFlight('evt-del-2', 192)]
  await engine.runCalendarRules('manual')
  assert.equal(titled('Deletable budget').length, 1, 'the next event starts a new one')
})

test('on_repeat survives a round-trip through the database', () => {
  const rule = saveRule({ on_repeat: 'update', template: { title: 'Round trip repeat', due_offset_days: 0 } })
  assert.equal(db.getGCalRule(rule.id).on_repeat, 'update')
  assert.equal(db.listGCalRules().find(r => r.id === rule.id).on_repeat, 'update')
})
