// The iOS widget's snapshot (BOOM-61). Pure: tasks, routines and `now` in, a
// small JSON-able object out. The app writes it into the App Group whenever
// Today changes; the widget reads it and never touches the network or auth
// (the WebView owns token rotation, and an expired token is exactly the state
// the widget exists for: owner, 2026-11-24, "I am forgetting to open").
//
// It agrees with the Tasks screen's Today group (groupUpcoming): due today, a
// loop's open cycle, picked today, kept on Today. A task that slipped past its
// date is NOT "today" there (quiet slipped), so it isn't here either.
//
// The widget recomputes from dates when a day passes without the app being
// opened: everything due by that day from `upcoming` joins the list, and the
// widget says when the snapshot was taken. No score, no streak, no "you
// missed" copy: it says what's there.
import { groupUpcoming, ymd } from './tasksModel.js'
import { weekPriorities } from './weekPlan.js'

export const SNAPSHOT_VERSION = 1
const MAX_TODAY = 6
const MAX_UPCOMING = 12

export function widgetSnapshot({ tasks = [], routines = [], now = new Date(), isCrisis = () => false }) {
  const day = ymd(now)
  const g = groupUpcoming({ tasks, routines, now, isCrisis })
  const today = [...g.critical, ...g.today]
  const priorities = weekPriorities(tasks, day).slice(0, 3)
  return {
    v: SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    day,
    todayCount: today.length,
    today: today.slice(0, MAX_TODAY).map(({ task, due, routine }) => ({ title: task.title, due: due || null, loop: !!routine, kept: !!task.pinned_to_today })),
    priorities: priorities.map(t => ({ title: t.title })),
    upcoming: g.week.slice(0, MAX_UPCOMING).map(({ task, due, routine }) => ({ title: task.title, due, loop: !!routine })),
  }
}

// What the widget shows on `dayKey` from a snapshot. Mirrors
// TodayWidget.swift's `lines(for:)` so the rule is tested here; keep the two
// in step.
export function widgetView(snapshot, dayKey) {
  if (!snapshot || snapshot.v !== SNAPSHOT_VERSION) return { count: 0, titles: [], stale: true, priorities: [] }
  const stale = snapshot.day !== dayKey
  if (!stale) return { count: snapshot.todayCount, titles: snapshot.today.map(x => x.title), stale, priorities: snapshot.priorities.map(p => p.title) }
  // A later day, the app unopened since. The same rules as the Tasks screen:
  // undated items (kept on Today) and a loop's open cycle stay on Today
  // however late; a dated task whose day has passed slips quietly off it;
  // what is due on this exact day arrives, and so does a loop come due.
  // Kept on Today with a later date holds until that date, then it is simply due.
  const carried = snapshot.today.filter(x => !x.due || x.loop || (x.kept && x.due >= dayKey))
  const arrived = snapshot.upcoming.filter(x => x.due === dayKey || (x.loop && x.due <= dayKey))
  const titles = [...carried, ...arrived].map(x => x.title)
  return { count: titles.length, titles, stale, priorities: snapshot.priorities.map(p => p.title) }
}
