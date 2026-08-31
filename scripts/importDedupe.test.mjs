// The cross-client duplicate guard for IMPORTED items, against a real database.
//
// Background: every inbound pull (Google Calendar, Notion, Trello) runs on the
// CLIENT, on mount and on every visibilitychange, and mints a fresh uuid for
// each item it decides is new — deciding that against its own hydrated task
// list alone. A desktop left open and a phone picked up therefore import the
// same remote item twice, one uuid each, and both reach POST /api/tasks. Only
// routine spawns used to be guarded there.
//
// These properties are the ones that turn the guard into either a leaky sieve
// or a data-loss bug, so they get a real db rather than a mock.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'boom-importdedupe-'))
let db

before(async () => {
  db = await import('../server/db.js')
  await db.initDb(join(dir, 'importdedupe.db'))
})

after(() => {
  try { db.flushNow() } catch { /* nothing pending */ }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
})

let seq = 0
function makeTask(overrides = {}) {
  return {
    id: `task-${++seq}`,
    title: 'Untitled',
    status: 'not_started',
    created_at: new Date(2026, 0, 1 + seq).toISOString(),
    tags: [],
    ...overrides,
  }
}

// Insert straight through upsertTask — the route's guard runs BEFORE this, so
// seeding this way is how an already-synced task got there.
function seed(overrides = {}) {
  const t = makeTask(overrides)
  db.upsertTask(t)
  return t
}

test('a second client importing the same calendar event is deduped', () => {
  const first = seed({ title: 'Dentist', gcal_event_id: 'evt-1' })
  const second = makeTask({ title: 'Dentist', gcal_event_id: 'evt-1' })
  assert.equal(db.findImportTwin(second), first.id)
})

test('a different calendar event is not deduped', () => {
  seed({ title: 'Dentist', gcal_event_id: 'evt-2' })
  assert.equal(db.findImportTwin(makeTask({ title: 'Dentist', gcal_event_id: 'evt-3' })), null)
})

test('a DONE twin still blocks a re-import', () => {
  // The pulls' own rule is "block reimport for an item linked to ANY task,
  // including done". Re-creating a task for an event you already finished is
  // the "why do these keep coming back" bug, not a legitimate second task.
  const done = seed({ title: 'Standup', gcal_event_id: 'evt-4', status: 'done' })
  assert.equal(db.findImportTwin(makeTask({ title: 'Standup', gcal_event_id: 'evt-4' })), done.id)
})

test('a second client importing the same Trello card is deduped', () => {
  const first = seed({ title: 'Fix the gate', trello_card_id: 'card-1' })
  assert.equal(db.findImportTwin(makeTask({ title: 'Fix the gate', trello_card_id: 'card-1' })), first.id)
})

test('the guard never fires on a task carrying no remote id', () => {
  seed({ title: 'Sweep garage' })
  assert.equal(db.findImportTwin(makeTask({ title: 'Sweep garage' })), null)
})

test('one Notion page legitimately proposes several DIFFERENT tasks', () => {
  // The page analyzer extracts up to five tasks from one prose page; they all
  // share notion_page_id and differ only by title. Keying on the page id alone
  // would swallow four of them.
  seed({ title: 'Book the rental car', notion_page_id: 'page-1' })
  assert.equal(db.findImportTwin(makeTask({ title: 'Pack the cooler', notion_page_id: 'page-1' })), null)
})

test('the SAME Notion-derived task from a second client is deduped', () => {
  const first = seed({ title: 'Book the rental car', notion_page_id: 'page-2' })
  assert.equal(
    db.findImportTwin(makeTask({ title: 'Book the rental car', notion_page_id: 'page-2' })),
    first.id,
  )
})

test('a routine spawn is never deduped by the page id it inherits', () => {
  // A routine stamps its own notion_page_id onto EVERY task it spawns, so a
  // page id is shared by an unbounded number of legitimate tasks. If this
  // regressed, a loop would spawn once and then never again.
  seed({ title: 'Water the plants', notion_page_id: 'page-3', routine_id: 'r-1', status: 'done' })
  const nextCycle = makeTask({ title: 'Water the plants', notion_page_id: 'page-3', routine_id: 'r-1' })
  assert.equal(db.findImportTwin(nextCycle), null)
})

test('a routine-spawned task is not a twin candidate for a real import', () => {
  // Same page id, but the existing row belongs to a loop. An inbound Notion
  // row with that id is a different thing and must still import.
  seed({ title: 'Weekly review', notion_page_id: 'page-4', routine_id: 'r-2' })
  assert.equal(db.findImportTwin(makeTask({ title: 'Weekly review', notion_page_id: 'page-4' })), null)
})

test('the guard ignores the task re-pushing itself', () => {
  const t = seed({ title: 'Renew passport', gcal_event_id: 'evt-5' })
  assert.equal(db.findImportTwin(t), null)
})

test('sweep removes existing duplicates, keeping the touched copy', () => {
  const untouched = seed({ title: 'Oil change', gcal_event_id: 'evt-6' })
  const touched = seed({ title: 'Oil change', gcal_event_id: 'evt-6', status: 'doing' })
  const preview = db.dedupeImportedTasks({ dryRun: true })
  assert.ok(preview.details.some(d => d.id === untouched.id))
  assert.ok(db.getTask(untouched.id), 'dry run must not delete')

  db.dedupeImportedTasks({})
  assert.equal(db.getTask(untouched.id), null)
  assert.ok(db.getTask(touched.id), 'the copy the user has worked on survives')
})

test('sweep leaves a live copy alone when its twin is done', () => {
  // Deleting the done copy would destroy the completion; deleting the live one
  // would drop work the user still has to do. Neither is a duplicate to sweep.
  const finished = seed({ title: 'File taxes', trello_card_id: 'card-9', status: 'done' })
  const live = seed({ title: 'File taxes', trello_card_id: 'card-9' })
  db.dedupeImportedTasks({})
  assert.ok(db.getTask(finished.id))
  assert.ok(db.getTask(live.id))
})

test('sweep never touches tasks with no remote id', () => {
  const a = seed({ title: 'Identical chore' })
  const b = seed({ title: 'Identical chore' })
  db.dedupeImportedTasks({})
  assert.ok(db.getTask(a.id))
  assert.ok(db.getTask(b.id))
})
