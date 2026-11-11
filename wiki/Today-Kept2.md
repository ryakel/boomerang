# Today, Kept 2.0

> **Status (2026-11-11): first usable version built, waiting on the user.**
> Ticket BOOM-32. Built on `claude/today-kept2`; re-landed from a patch on
> `claude/determined-sagan-9hyzlh` (cut from `dev`) after the original branch
> was never pushed. The user is living with it before any further aesthetic or
> behavioural change. Do not refine, restyle or extend it until he reports what
> needs to change. When he does: change `src/todayModel.js` first with a test,
> then the UI.

This page is the handoff for the redesign: why it exists, what was decided,
what was built, how it was verified, what is still open. Design artifacts
(claude.ai, private to the user): the mockup canvas "Boomerang Today, Kept 2.0"
and the doc "Today, Kept 2.0: section spec and reuse map". The doc's plan and
type sections lag the code; this page and the code win.

---

## 1. Why

The user, Nov 2026: Boomerang stopped keeping him engaged ("stuff goes there to
die"). Features were frozen for over a month while dev work chased engagement.
An audit of the live DB (2,392 tasks, scrubbed snapshot) found:

- **Routines die in tracking, not in life.** "It's getting done. Just not
  tracked." He built routine tracking to learn the routine and make sure it got
  done; the routine is learned, the tracking became a chore.
- **Completions are batch logging.** 80% of completions since Oct 1 came within
  60 seconds of the previous one, peaking at 7am and 11pm: he opens Today,
  clears what he did, bounces out.
- **Points are dead weight.** He wants points gone. The Day Arc, rally, catches
  and loop trails were the most prominent things on Today.
- **The morning digest is ignored.** 129 sent, 0 taps.
- **Gmail import needs its review gate.** 120 found, 65 kept: 46% dismissed.
  The Review step is what keeps junk and guesses off the list.
- **Apple Reminders does the ringing.** He keeps alarmed, one-off and routine
  reminders in Reminders. Boomerang's sync only reads one hard-coded list
  (`BoomerangReminders.swift`, `listName = "Boomerang"`), and he never trusted
  the extra step of filing into it. Wants one app to track his life.
- **Zero-use features exist** (pick-three has no UI; intentions, escalation
  ladder, reframe, notes, GCal task sync barely used). Nothing gets deleted:
  every feature's plan is preserved, only Today's surface changes.

His brief: *"Throw it into Boomerang. It'll come back when it matters."* An
evolution of Kept, not a new design system. Priorities in order:

1. Don't let me forget.
2. Tell me what to do next.
3. Fit tasks into calendar time.
4. Effortless capture.

## 2. Locked decisions

1. **Unapproved suggestions stay behind the review row.** Pending Gmail/Notion
   items (`gmail_pending`) never appear in Needs attention, Worth doing next,
   Coming up, Anytime or calendar scheduling. The row is compact but
   discoverable; it opens a Keep/Dismiss sheet.
2. **"Open task", not "Start this".** It opens the task's details and writes
   nothing: no status change, timer, calendar hold or notification.
3. **"Not now"** dismisses the current recommendation for the day without
   snoozing or modifying the task, and must not resurface the same pick on the
   next render.
4. **No placeholder controls.** "Find time" is a future feature, not a dead
   button.
5. **Navigation, header and Throw stay exactly production.**
6. **Analytics survives.** Points and streaks leave Today, not the app. No
   streak-preservation pressure via Today notifications, warnings or copy.
7. **Morning/daytime/evening are examples, not layouts.** The screen is driven
   by data and relevance. An urgent task stays above a bedtime checklist.
   Nothing is manufactured to fill a section. Empty sections disappear.
8. **All clear is a legitimate outcome:** "Nothing needs you right now."
9. **The recommendation must not become another chore.**
10. **Durations come only from a task's own size; free time only from real
    calendar events.** No invented buffers or estimates.
11. **Don't rewrite** persistence, notifications, calendar sync, the scoring
    engine or routine accounting. Don't redesign Tasks, Loops or other screens.

## 3. What was built

| File | Role |
|---|---|
| `src/todayModel.js` | Pure rules: tasks, routines, settings, events, `now` in; sections out. No storage, network or React. |
| `scripts/todayModel.test.mjs` | 34 tests pinning those rules (in `npm test`). Pass in UTC and America/Chicago. |
| `src/kept/TodayKept2.jsx` | Renders the model, wires existing handlers. |
| `src/kept/today2.css` | Styles scoped to `.bm-t2`; nothing outside Today changes. |
| `src/kept/KeptShell.jsx`, `KeptDesktop.jsx` | Pick `TodayKept2` or the classic `TodayView` from `settings.today_classic`. Same props. |
| `src/store.js` | `today_classic: false` default. |
| `src/components/SettingsModal.jsx` | Settings → General → Home screen → **Classic Today screen** toggle. |
| `server/server.js` | The GCal events mapping gained `transparency` (busy vs free). Nothing else server-side. |
| `package.json` | `@fontsource-variable/fraunces` and `@fontsource-variable/dm-sans` (5.3.0, OFL), bundled so iOS renders offline. |

**Revert path:** the toggle. Classic Today is untouched and fully working; the
setting is an ordinary blob preference (add-setting tree, branch 4).

### Sections, top to bottom

Each appears only when it has something to say.

- **Pinned notes** (existing).
- **Date:** weekday in Fraunces, short date in DM Sans.
- **All clear** when nothing needs you: no attention items, no relevant
  routines, no recommendation, nothing to review, no Last night rows.
- **Needs attention** (card). Accepted, open, unsnoozed, non-routine tasks with
  a concrete reason, in this order: critical (`isCrisisTask`), overdue
  ("Overdue 3 days"), due today, reminder passed, back from snooze today.
  Then by `impactRank`. Max 5, then "N more in Tasks". Swipe to catch/delete
  (existing `RowSwipe`).
- **Last night** (existing BOOM-23 behaviour, restyled). While it shows, its
  rows are not listed again as checklist or loop rows. Its own Not now is the
  shared `boom_lastnight_hidden_on` key.
- **Checklists (stacks)** at one of three prominence tiers, from evidence:
  - *Full section* (open members, "n of total", tap the title to edit the
    loop): trigger passed today, members open, inside its window, no
    commitment starting within 20 min, a member caught in the last 14 days.
  - *One line* ("Morning · 1 left from this morning", tap expands it in
    place): window passed, a commitment within 20 min, dormant (nothing caught
    in 14 days, so it stays visible but doesn't nag), or a cycle left from
    yesterday.
  - *Hidden:* before its trigger (then it's a Coming up row), all done,
    paused, ended, `resume_at` in the future, skipped today, away day.
  - The window needs no new field: `trigger_time` until the next checklist's
    trigger or 6 hours, whichever is first.
  - One line is a display level, not a state. Nothing is marked, skipped or
    excused.
- **Loops:** plain-loop task instances due today or carried over, completed
  through the normal task path. Never in Needs attention or Worth doing next.
- **Worth doing next** (card). One pick, or nothing.
  - Candidates: open, unsnoozed, not in Needs attention, not a routine task,
    not waiting, not pending, not critical.
  - The bar: due within 7 days, or impact 3, or high priority.
  - Ranked by the existing `impactRank`, ties by due date then id
    (deterministic).
  - If a busy, timed calendar event is ahead today and the task has a size,
    the size must fit before the event's start. Unsized tasks are offered with
    no time claim. Free (transparent) events never shorten the window.
  - The reason line comes from the ranking factors ("due Thursday", "high
    impact", "marked high priority", "good weather before it turns") plus
    "About 1 hr" only when sized, and "Fits before X at 8:30a" only when that
    was checked.
  - Absent during quiet hours (`quiet_hours_enabled`, which defaults OFF).
  - **Open task:** `onOpenTask`, no write. **Not now:** stores
    `{date, entries: {taskId: reasonKey}}` in localStorage
    `boom_today_notnow` (per device, per day). The pick returns early only if
    its evidence (due date, impact, priority) changes. After 2 dismissals the
    section rests until tomorrow.
- **One-line checklists** sit here, after the recommendation.
- **Coming up** (open). Things still ahead today, in time order, max 6:
  calendar events (timed, not cancelled, not ended), tasks with a reminder later
  today, checklists that start later (from members snoozed until their
  trigger), loop instances starting later, tasks returning from snooze later.
  Becomes **Tomorrow** when nothing is ahead today, or during quiet hours with
  nothing left tonight: tomorrow's events, reminders and due tasks (excluding
  what's already shown).
- **Pinned arcs** (existing `pinned_to_today`), with Log session.
- **Review row:** "3 suggestions from Gmail to review" → sheet with Keep and
  Dismiss (existing `onGmailKeep` / `onGmailDismiss`) and tap to open.
- **Quiet extras:** "Anytime · N" (expands in place, remembered in
  `boom_today_anytime_open`), "What now?", "Today's nudge" (the growth area).

**Gone from Today only:** Day Arc, points goal, rally and catches, the week
breakdown, loop mini trails, the What now hero button. Their data, scoring and
the Analytics screen are untouched.

### Calendar

`useCalendarEvents` calls the existing `gcalStatus()` once; if connected, it
reads today and tomorrow via the existing read-only `GET /api/gcal/events`
for `primary` and `settings.gcal_calendar_id` (deduped), every 10 minutes and
on return to the app. Not connected, offline or slow: no events, no error. An
event imported as a task (`gcal_event_id`) is dropped so it isn't listed
twice. All-day events are ignored for now.

## 4. Visual spec (Kept dark; light derives the same proportions)

Fonts are `'Fraunces Variable'` and `'DM Sans Variable'` from Fontsource, a
different family name from the Google-loaded `Fraunces`/`DM Sans` the rest of
the app uses, so only Today changes. The wordmark, header and nav keep the
production fonts.

| Role | Current production | Kept 2.0 Today |
|---|---|---|
| Wordmark | Fraunces 700, 18px | unchanged |
| Day title | Fraunces 700, 21px | Fraunces 460, 28px/1.1, −0.015em, SOFT 100 |
| Date | DM Sans 400, 12.5px, 56% | DM Sans 400, 14px, 60% |
| Section heading | Fraunces 700, 14.5px | DM Sans 600, 13px, +0.005em, 78% |
| Count | DM Sans 600, 12px | DM Sans 500, 12.5px, tabular |
| Task row | DM Sans 550 (renders 600), 15px | DM Sans 500, 15px/1.32 |
| Row meta | DM Sans 400, 12px | DM Sans 400, 12.5px |
| Reason (due/urgent) | DM Sans 650 (renders 600) | DM Sans 500, ember; overdue/critical in danger |
| Recommendation title | DM Sans 600, 16px | Fraunces 500, 19px/1.2, SOFT 100 |
| Clock time / title | 650 / 550 (render 600) | 500, 13.5px tabular / 500, 14.5px |
| Buttons | DM Sans 700 (renders 600) | 600 primary, 500 secondary, 14px, 44px tall |
| All clear | Fraunces 700, 21px | Fraunces 440, 23px/1.2, SOFT 100 |

Production only loads DM Sans at 400/500/600, so CSS asking for 550, 650 or 700
renders as 600. That flattening was most of the old heaviness.

| Surface | Current | Kept 2.0 |
|---|---|---|
| Canvas | #16140F | #16140F |
| Card | #1F1C16, border 9%, 2-layer shadow, radius 16 | #1C1914, border rgba(238,231,219,.055), no shadow, radius 18 |
| Cards used for | every section | Needs attention and Worth doing next only |
| Dividers | 9% | rgba(238,231,219,.06) |
| Text / label / meta / faint | #F3EEE5 / — / 56% / 34% | #EEE7DB / 78% / 60% / 32% |
| Checkbox ring | 22px, 2px | 22px, 1.6px |
| Ember tonal / gold tonal | 14% / 14% | 12% / 11% |

Contrast on the card: body above 14:1, meta 5.9:1 (was 5.5:1).

| Spacing (px) | Current | Kept 2.0 |
|---|---|---|
| Gutter (open sections, date) | 16 | 20 |
| Card inset / padding | 16 / 12·14·4 | 16 / 14·16·4 |
| Date top padding | 18 | 20 |
| Date → first section | 12 | 18 |
| Between sections | 12 | 24 |
| Heading → first row | 4 | 6 |
| Row padding: card / open / clock | 11 / 10 / 10 | 12 / 10 / 11 |
| Review row: margin · height · radius | 12 · 46 · 12 | 24 · 48 · 14 |

Measured on the Morning mockup, content was 785px current vs 845px Kept 2.0
(the visible area on a 390×844 phone is about 658px). The same sections are
above the fold in both.

## 5. Verification done

- `npm test`: 637 pass (34 new), smoke test passes. `npm run lint`: 0 errors,
  18 warnings, none new. `npm run build` passes. Re-run 2026-11-11 after
  re-landing from the patch: same results; `npm audit` unchanged from `main`
  (the font packages add no advisories).
- Ran the built app against a scrubbed copy of the live DB (390×844 Kept dark,
  1280×860 desktop, and Kept light):
  - Completing a Needs attention task wrote `done` to the server and the row left.
  - Not now: the task was untouched on the server, the next pick appeared, and the dismissal held across a reload.
  - Open task: the editor opened and nothing changed on the server.
  - Review sheet: listed the 3 pending Gmail items, each with Keep and Dismiss.
  - Classic toggle via Settings: classic Today returned and held across a reload.
- On that data at 7am the recommendation was "Sabbatical, about 4 hr, high
  impact". It follows the rules; whether it's a good pick is the user's call.

**Running locally against real data:** start the server with
`APP_VERSION=$(git describe --tags --always)` or the update banner blocks data
loading. The scrubbed snapshot (`boom-audit-snapshot.sh`) drops `app_data` and
`push_subscriptions`; recreate the latter from
`migrations/011_create_push_subscriptions_table.sql` or the server exits.
Settings come from the server blob, so set `today_classic` through the UI, not
localStorage.

## 6. Known gaps and open questions

- Quiet hours default off, so Worth doing next shows at night. Options: tell
  him to turn quiet hours on, or a fallback window (his call).
- Coming up reads only `primary` and `gcal_calendar_id`; other calendars (Skulid
  synced or not) need a picker. No travel/prep buffer: "fits" is measured to
  the event start (a configurable buffer was discussed and parked).
- Everyday Reminders lists (TV off, meds) don't appear: the iOS sync reads one
  hard-coded list. Widening it is its own track.
- Last night can be long (5 rows on the test data) and sits high.
- Not now dismissals are per device (like Last night). Syncing them needs a
  stored field.
- Anytime, What now and the nudge are buttons at the bottom; check whether he
  uses them.
- The desktop `TodayRail` (shown on other tabs) still uses the classic rules.
- All-day events are ignored.

## 7. Future tracks (not this release)

Kept here so the plans aren't lost:

- **Find time:** whole-day gap finding and holding, using sizes and calendar.
- **Routine modes:** checklist (today), autopilot (never fabricates
  completion; it simply doesn't ask), practice.
- **Reminders sync on his real lists**, retiring the one-list step.
- **Calendar picker** for which calendars count as commitments; busy/free is
  already mapped.
- **Kept 2.0 skin on other surfaces:** the tokens are scoped to `.bm-t2` on
  purpose; the skin should follow to every surface in its own pass.
- **Clean full DB export in Settings → Data** (requested earlier): session
  only, `app_data` secrets and `push_subscriptions` stripped, allowlist
  redaction that fails closed.
- Auth hardening before any public exposure stays BOOM-25.

## 8. Rules for whoever picks this up

- Follow CLAUDE.md's git model: work on a branch from `origin/dev`, PR to
  `dev` with rebase merge, never merge without the user's explicit approval.
  A push to `dev` deploys `boomerang-dev` (port 3002), which is where he can
  try this before it goes near `main`.
- Commit convention and a `wiki/Version-History.md` entry for every commit.
- The model is the spec. Any behaviour change: test in
  `scripts/todayModel.test.mjs` first.
- Keep `today_classic` working until he says the classic screen can go.
- The user asked: no new focus timer, no AI recommendation engine, no new
  notification behaviour, no scoring or routine-engine rewrites, no redesign
  of Tasks or Loops, no more mockup cycles. Stop after each version and let him
  use it.
