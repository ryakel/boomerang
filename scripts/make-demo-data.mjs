#!/usr/bin/env node
/**
 * Generates scripts/demo-data.json — the dataset behind the screenshots in the
 * README and the wiki.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE DEV SEED: `scripts/seed-data.json` is
 * modelled on the actual user's life. It is fine for a dev database and wrong
 * for a public README — those shots are published, indexed, and permanent. This
 * file is deliberately fictional: a composite of ordinary household/office
 * errands that demonstrates every surface without disclosing anything.
 *
 * Dates are emitted RELATIVE TO NOW at generation time, so a regenerated file
 * always looks current, and the seed loader's rebasing pass has nothing to fix.
 *
 *   node scripts/make-demo-data.mjs
 *   SEED_FILE=scripts/demo-data.json SEED_DB=1 npm start
 */
import { writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const DAY = 86400000
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)
const at = (dayOffset, hour, minute = 0) => {
  const d = new Date(now + dayOffset * DAY)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

// ── Labels ────────────────────────────────────────────────────────────────
const L = {}
const labels = [
  ['work', '#4A9EFF'],
  ['home', '#FFB347'],
  ['health', '#52C97F'],
  ['errands', '#34D399'],
  ['admin', '#FF6240'],
  ['learning', '#A78BFA'],
  ['family', '#F472B6'],
  ['quick-win', '#34D399'],
  ['phone-call', '#FB923C'],
  ['urgent', '#FF6240'],
].map(([name, color]) => {
  const id = randomUUID()
  L[name] = id
  return { id, name, color }
})

// ── Tasks ─────────────────────────────────────────────────────────────────
// Shaped to fill every section a reader will see: a couple genuinely overdue,
// a today row with a reminder on it, some upcoming, one waiting, one project
// with subs, and a handful done today so the points arc isn't at zero.
const T = (o) => ({
  id: randomUUID(),
  title: o.title,
  status: o.status || 'not_started',
  notes: o.notes || '',
  due_date: o.due ?? null,
  remind_at: o.remind ?? null,
  snoozed_until: null,
  snooze_count: o.snoozes || 0,
  staleness_days: 2,
  last_touched: iso(now - (o.touched ?? 1) * DAY),
  created_at: iso(now - (o.age ?? 6) * DAY),
  completed_at: o.completedAt ?? null,
  reframe_notes: null,
  notion_page_id: null,
  notion_url: null,
  trello_card_id: null,
  trello_card_url: null,
  gcal_event_id: null,
  gcal_duration: null,
  routine_id: null,
  parent_id: o.parent ?? null,
  child_visibility: o.parent ? 'active' : null,
  high_priority: !!o.high,
  low_priority: !!o.low,
  size: o.size || 'M',
  size_inferred: true,
  energy: o.energy || 'desk',
  energyLevel: o.level || 2,
  impact: o.impact ?? null,
  attachments: [],
  checklist: [],
  checklists: o.checklists || [],
  comments: [],
  toast_messages: null,
  trello_sync_enabled: null,
  tags: (o.tags || []).map(t => L[t]),
})

const kitchenProject = T({
  title: 'Get the spare room usable again',
  status: 'project',
  age: 40, touched: 2,
  size: 'XL', energy: 'physical', level: 3,
  tags: ['home'],
  notes: 'One shelf at a time. It does not have to be finished this month.',
})

const tasks = [
  // ── Overdue: the two that make the list feel honest ──────────────────────
  T({
    title: 'Renew the car registration',
    due: ymd(now - 3 * DAY), age: 21, touched: 5, snoozes: 3,
    size: 'S', energy: 'desk', level: 2, high: true,
    tags: ['admin', 'urgent'],
    notes: 'Reference number is on the letter in the kitchen drawer.',
  }),
  T({
    title: 'Call the dentist to reschedule',
    due: ymd(now - 1 * DAY), age: 12, touched: 4, snoozes: 5,
    size: 'S', energy: 'confrontation', level: 3,
    tags: ['health', 'phone-call'],
  }),

  // ── Today, including a reminder so the ⏰ badge shows ─────────────────────
  T({
    title: 'Pick up the parcel before the depot closes',
    due: ymd(now), remind: at(0, 17, 30), age: 2, touched: 0,
    size: 'S', energy: 'errand', level: 1,
    tags: ['errands', 'quick-win'],
  }),
  T({
    title: 'Draft the Q3 summary for the team',
    due: ymd(now), age: 5, touched: 0,
    size: 'L', energy: 'desk', level: 3, impact: 4,
    tags: ['work'],
    notes: 'Three slides is plenty. Numbers first, story second.',
    checklists: [{
      id: randomUUID(), name: 'Checklist',
      items: [
        { id: randomUUID(), text: 'Pull the revenue numbers', completed: true },
        { id: randomUUID(), text: 'Write the one-line takeaway', completed: false },
        { id: randomUUID(), text: 'Send to Priya for a read', completed: false },
      ],
    }],
  }),
  T({
    title: 'Book the annual eye test',
    due: ymd(now), remind: at(0, 11, 0), age: 9, touched: 3,
    size: 'XS', energy: 'confrontation', level: 2,
    tags: ['health', 'phone-call'],
  }),
  T({
    title: 'Water the plants',
    due: ymd(now), age: 1, touched: 0,
    size: 'XS', energy: 'physical', level: 1, low: true,
    tags: ['home', 'quick-win'],
  }),

  // ── Doing / waiting ──────────────────────────────────────────────────────
  T({
    title: 'Read two chapters of the Rust book',
    status: 'doing', age: 30, touched: 0,
    size: 'M', energy: 'creative', level: 2,
    tags: ['learning'],
  }),
  T({
    title: 'Waiting on the quote from the printer',
    status: 'waiting', age: 8, touched: 3,
    size: 'S', energy: 'desk', level: 1,
    tags: ['work'],
    notes: 'Chased once on Tuesday. Give it until Friday, then call.',
  }),

  // ── Upcoming ─────────────────────────────────────────────────────────────
  T({ title: 'Send Mum the photos from the weekend', due: ymd(now + 1 * DAY), age: 3, size: 'XS', energy: 'people', level: 1, tags: ['family', 'quick-win'] }),
  T({ title: 'Swap the smoke alarm batteries', due: ymd(now + 2 * DAY), age: 14, size: 'S', energy: 'physical', level: 1, tags: ['home'] }),
  T({ title: 'Compare broadband deals before the contract rolls over', due: ymd(now + 4 * DAY), age: 11, size: 'M', energy: 'desk', level: 2, impact: 3, tags: ['admin'] }),
  T({ title: 'Book the car in for its service', due: ymd(now + 6 * DAY), remind: at(6, 9, 0), age: 7, size: 'S', energy: 'confrontation', level: 2, tags: ['errands', 'phone-call'] }),
  T({ title: 'Plan the route for the coast walk', due: ymd(now + 9 * DAY), age: 4, size: 'M', energy: 'creative', level: 1, tags: ['family'] }),
  T({ title: 'Back up the photo library to the external drive', due: ymd(now + 12 * DAY), age: 25, size: 'M', energy: 'desk', level: 1, tags: ['admin'] }),

  // ── No date — the long tail that makes the Anytime section real ──────────
  T({ title: 'Sort the loft boxes into keep / donate', age: 60, touched: 20, size: 'XL', energy: 'physical', level: 3, tags: ['home'] }),
  T({ title: 'Find a decent recipe for the sourdough starter', age: 18, touched: 9, size: 'S', energy: 'creative', level: 1, tags: ['home'] }),
  T({ title: 'Write up the onboarding notes for the new starter', age: 15, touched: 6, size: 'L', energy: 'desk', level: 3, impact: 3, tags: ['work'] }),
  T({ title: 'Ask the neighbour about the shared fence', age: 22, touched: 11, snoozes: 4, size: 'S', energy: 'confrontation', level: 3, tags: ['home'] }),
  T({ title: 'Try the new bouldering gym', age: 34, touched: 14, size: 'M', energy: 'physical', level: 2, tags: ['health'] }),

  // ── Project + its subs ───────────────────────────────────────────────────
  kitchenProject,
  T({ title: 'Clear the desk and the two chairs', parent: kitchenProject.id, age: 40, size: 'M', energy: 'physical', level: 2, tags: ['home'] }),
  T({ title: 'Take the old monitor to the recycling centre', parent: kitchenProject.id, age: 40, size: 'S', energy: 'errand', level: 2, tags: ['home', 'errands'] }),
  T({ title: 'Order a shelf that actually fits the alcove', parent: kitchenProject.id, age: 38, size: 'S', energy: 'desk', level: 1, tags: ['home'] }),

  // ── Done today, so the points arc and the streak read as alive ───────────
  T({ title: 'Empty the dishwasher', status: 'done', completedAt: at(0, 7, 40), age: 1, touched: 0, size: 'XS', energy: 'physical', level: 1, tags: ['home', 'quick-win'] }),
  T({ title: 'Reply to the venue about the October booking', status: 'done', completedAt: at(0, 9, 15), age: 4, touched: 0, size: 'S', energy: 'desk', level: 2, tags: ['work'] }),
  T({ title: 'Move the standing order to the new account', status: 'done', completedAt: at(0, 10, 5), age: 6, touched: 0, size: 'S', energy: 'desk', level: 2, tags: ['admin'] }),
  // ── Done earlier in the week, for the analytics/history surfaces ─────────
  T({ title: 'Return the library books', status: 'done', completedAt: at(-1, 16, 20), age: 9, size: 'XS', energy: 'errand', level: 1, tags: ['errands'] }),
  T({ title: 'Update the household budget sheet', status: 'done', completedAt: at(-2, 20, 10), age: 12, size: 'M', energy: 'desk', level: 2, tags: ['admin'] }),
  T({ title: 'Fix the wobbly shelf in the hall', status: 'done', completedAt: at(-3, 11, 0), age: 20, size: 'S', energy: 'physical', level: 2, tags: ['home'] }),
  T({ title: 'Send the invoice for last month', status: 'done', completedAt: at(-4, 9, 30), age: 10, size: 'S', energy: 'desk', level: 1, tags: ['work'] }),
]

// ── Loops ─────────────────────────────────────────────────────────────────
// completed_history is synthesised by the seed loader (rich, cadence-aware,
// ~250 days), so it is left empty here on purpose.
const R = (o) => ({
  id: randomUUID(),
  title: o.title,
  cadence: o.cadence,
  custom_days: o.customDays ?? null,
  custom_unit: 'days',
  notes: o.notes || '',
  tags: (o.tags || []).map(t => L[t]),
  energy: o.energy || 'desk',
  energyLevel: o.level || 1,
  high_priority: !!o.high,
  paused: o.paused ? 1 : 0,
  end_date: null,
  schedule_day_of_week: o.dow ?? null,
  trigger_time: o.triggerTime ?? null,
  remind: !!o.remind,
  created_at: iso(now - 260 * DAY),
  completed_history: [],
})

const routines = [
  R({ title: 'Morning stretch', cadence: 'daily', energy: 'physical', level: 1, tags: ['health'] }),
  R({ title: 'Take vitamins', cadence: 'daily', energy: 'desk', level: 1, high: true, tags: ['health'], triggerTime: '08:00', remind: true }),
  R({ title: 'Ten minutes of Rust', cadence: 'daily', energy: 'creative', level: 2, tags: ['learning'] }),
  R({ title: 'Tidy the kitchen before bed', cadence: 'daily', energy: 'physical', level: 1, tags: ['home'] }),
  R({ title: 'Weekly review', cadence: 'weekly', dow: 0, energy: 'desk', level: 2, tags: ['work'], notes: 'Twenty minutes. What moved, what stalled, what is next.' }),
  R({ title: 'Change the bed sheets', cadence: 'weekly', dow: 6, energy: 'physical', level: 2, tags: ['home'] }),
  R({ title: 'Water the garden', cadence: 'custom', customDays: 3, energy: 'physical', level: 1, tags: ['home'] }),
  R({ title: 'Pay the credit card', cadence: 'monthly', energy: 'desk', level: 1, high: true, tags: ['admin'], triggerTime: '19:00', remind: true }),
  R({ title: 'Deep clean the bathroom', cadence: 'weekly', dow: 3, energy: 'physical', level: 3, paused: true, tags: ['home'] }),
]

// ── Settings ──────────────────────────────────────────────────────────────
const settings = {
  staleness_days: 7,
  reframe_threshold: 3,
  default_due_days: 7,
  max_open_tasks: 10,
  sort_by: 'age',
  daily_task_goal: 3,
  daily_points_goal: 15,
  vacation_mode: false,
  free_days: [],
  digest_time: '07:00',
  notifications_enabled: false,
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '08:00',
  theme: 'kept',
  theme_mode: 'light',
  show_week_strip: true,
  week_strip_open: true,
  custom_instructions: 'Demo profile. Phone calls take more out of me than they should; errands are easier if they are quick.',
}

// Adherence for the synthesised loop history (see server/seed.js). High
// enough that the trails read as habits being kept, low enough to still show
// the gap/"to fix" affordances doing their job.
const out = { seed_adherence: 0.93, labels, settings, tasks, routines }
const path = new URL('./demo-data.json', import.meta.url).pathname
writeFileSync(path, JSON.stringify(out, null, 1) + '\n')
console.log(`Wrote ${path}: ${tasks.length} tasks, ${routines.length} loops, ${labels.length} labels`)
