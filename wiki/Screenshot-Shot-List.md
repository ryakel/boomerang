# Screenshot Shot List (for a separate capture-capable agent)

This session's sandbox can reach the dev server over plain HTTP (`curl` works) but
Chromium/Playwright cannot navigate to `localhost` here, so screenshots have to be
captured by a different agent/environment that can actually drive a browser. This
file is a self-contained handoff: setup steps, then the exact list of shots needed,
each with viewport/theme/state and where it lands in the docs.

**Status (2026-07-12):** Batches A, B, AND C below are all captured and embedded
(see the "real UI screenshots" entries in `wiki/Version-History.md`). Batch C's
retakes replaced the four stale Settings shots in place and added the new
`settings-tasks.png`. The only outstanding shot is
`kept-mobile-today-loop-weather.png` (Batch A), which needs a capture environment
with the Weather integration configured plus an outdoor-tagged seeded loop.

**Note on Batch B (Settings) — historical, already resolved:** a Settings reorg was
in progress when this file was first written (moving/renaming a few fields so
related settings live together). Batch B was captured once that landed. Left here
for context; no action needed.

## Setup

1. `git clone` / `git pull` the repo, checkout `main` (prod) unless told otherwise.
2. `npm install`
3. Seed realistic-looking data so screenshots don't show an empty app:
   ```
   SEED_DB=1 npm run dev
   ```
   This wipes the dev DB and populates it with AI-generated (or static-fallback)
   ADHD-realistic test data — tasks across all statuses, a few routines/loops,
   labels, some overdue/high-priority/energy-tagged tasks. Server runs on
   `http://localhost:3001` (or check console output for the actual port).
4. If you need to re-seed mid-session without restarting: `POST /api/dev/seed`
   (also wipes + reloads). Both paths are hard-gated to dev builds only.
5. Weather/GCal/Notion/Trello badges won't show unless those integrations are
   configured — that's fine, skip anything gated behind an integration unless a
   shot below specifically asks for it.

## Capture conventions

- **Mobile viewport:** 390×844 (iPhone 13/14 size), device-pixel-ratio 2-3 if your
  tool supports it, portrait only.
- **Desktop viewport:** 1440×900.
- **Theme:** capture in **light** mode (`kept-light`) by default. Only capture a
  dark-mode variant where a shot explicitly says so.
- Settings: `localStorage.theme` or the in-app Settings → General → Mode picker
  controls this; default installs already resolve to `kept-light` under normal
  daylight OS settings.
- Crop to the visible app viewport only — no browser chrome, no OS status bar
  bezel (the iOS status bar showing time/battery IS fine to leave in, that's
  how this session's own reference screenshots looked).
- Save as PNG, filenames exactly as given below (kebab-case, no spaces).
- Output directory: `wiki/images/` (create it if it doesn't exist).

## Batch A — capture now

### Mobile (Kept mobile IA: Today / Loops / Tasks / More, center Throw button)

| Filename | Screen / state | Notes |
|---|---|---|
| `kept-mobile-today.png` | Today tab, default scroll position | Should show the Day Arc hero, "What now?" button, a "Today" section with 2-3 tasks, an "Anytime" section, and a "Loops" section with at least one routine card. Seed data should provide this. |
| `kept-mobile-today-loop-weather.png` | Today tab, scrolled to the Loops section | Only useful if weather is configured (Settings → Integrations → Weather) AND a seeded routine is tagged outdoor-relevant (e.g. "Mow"). If weather isn't configured, skip this one — note in your summary that it needs a follow-up pass once weather is set up. |
| `kept-mobile-tasks.png` | Tasks tab, "Upcoming" sub-tab, default view | Should show grouped sections (Overdue / Today / Tomorrow / Up next / Anytime) with hairline rows, gold circle checks, colored tag dots. |
| `kept-mobile-tasks-sheet.png` | Tasks tab, tap a task row to open its action sheet | Shows the bottom sheet with reschedule chips (Today/Tomorrow/Next week/No date) + Edit/Delete/Close rows. |
| `kept-mobile-loops.png` | Loops tab | Shows loop cards with the cycle-chip trail visualization, rally streak badges. |
| `kept-mobile-loop-detail.png` | Loops tab → tap into one loop | Shows the stat row (rally/best/lifetime), cycle-chip trail, month calendar. |
| `kept-mobile-throw.png` | Tap the center Throw button (bottom nav) | Shows the quick-capture bottom sheet — title input + smart date chips (Today/Tomorrow/Weekend/No date). |
| `kept-mobile-more.png` | More tab | Shows the row list (What now?, Arcs, Analytics, Caught, Packages, Growth areas, Activity log, Settings). |
| `kept-mobile-whatnow.png` | Tap "What now?" (bottom nav or Today hero button) | Shows the step 1 screen (how much time do you have). If it's multi-step, one screenshot of the first step is enough. |
| `kept-mobile-edit-task.png` | Tap "Edit" on any task from its action sheet, or long-press → full edit | Shows the quick task editor. |

### Desktop (Kept command center: sidebar + work surface + Today rail)

| Filename | Screen / state | Notes |
|---|---|---|
| `kept-desktop-today.png` | Today tab (main pane fills with TodayView, no rail) | Full window screenshot. |
| `kept-desktop-tasks-list.png` | Tasks tab, List view mode | Shows the sidebar, the Tasks list in the main pane, and the Today rail on the right showing "Due today" + "Anytime" sections. |
| `kept-desktop-tasks-board.png` | Tasks tab, Board view mode (toggle top-right of the Tasks pane) | Shows the Kanban-style columns (Up next / Doing / Waiting / Done). |
| `kept-desktop-loops.png` | Loops tab | Sidebar + loop cards in main pane + Today rail. |
| `kept-desktop-throw.png` | Press ⌘K or click "Throw a task" in the sidebar | Shows the Throw sheet overlay on the desktop layout. |
| `kept-desktop-quokka.png` | Click the Quokka button in the sidebar | Shows the Quokka chat panel — if there's no API key configured, just show the empty/welcome state, that's fine. |

## Batch B — capture after the Settings reorg lands (ask before shooting)

| Filename | Screen / state | Notes |
|---|---|---|
| `settings-general.png` | Settings → General tab | Desktop or mobile, whichever renders more cleanly full-screen. |
| `settings-notifications.png` | Settings → Notifications tab, scrolled to show "Pile-up thresholds" + the label-exemption picker together | This is the specific area that was just reorganized — a good "after" reference shot. |
| `settings-integrations.png` | Settings → Integrations tab, top of the list | Shows the integration cards (Notion/Trello/GCal/Gmail/17track/Weather/Pushover). |
| `settings-labels.png` | Settings → Labels tab | Shows the label list with color pickers. |

## Batch C — retakes after the 2026-07-11 Settings tab-structure reorg (DONE 2026-07-12)

The four Settings screenshots in `wiki/images/` (`settings-general.png`,
`settings-notifications.png`, `settings-integrations.png`, `settings-labels.png`)
all show the **old 7-tab bar** (`General, AI, Labels, Integrations, Notifications,
Data, Logs`). The reorg changed this to **6 tabs**
(`General, Tasks, Labels, Integrations, Notifications, Data`) — see `CLAUDE.md`'s
"Settings IA Rethink" section for the full change. Two of the four are also
*content*-stale, not just tab-bar-stale:

| Filename | Why it's stale | Priority |
|---|---|---|
| `settings-general.png` | Shows "Default due date", "Staleness threshold", "Reframe trigger", and "Max open tasks" — all four have **moved out of General** (the first three to the new Tasks tab, the fourth into the Notifications → Pile-up card). Retaken General tab should show only Theme, Mode, and Home screen (7-day strip toggles, daily goal) + Build. | High — content is actively wrong, not just a stale tab bar. |
| `settings-notifications.png` | Missing the "Max open tasks" field, which now lives in the *same card* as "Pile-up thresholds" and "Exempt from pile-up count" (previously two separate cards). Retake should show all three together in one "Pile-up" card. | High — the whole point of the reorg was consolidating this card; the current shot undersells it. |
| `settings-integrations.png` | Tab bar only (card content — Anthropic/Notion/Trello/GCal — is unchanged). | Low — cosmetic (stale tab bar visible at top), retake opportunistically. |
| `settings-labels.png` | Tab bar only (label list content is unchanged). | Low — same as above. |

**New shot worth adding** (didn't exist before, since the tab itself is new):

| Filename | Screen / state | Notes |
|---|---|---|
| `settings-tasks.png` | Settings → Tasks tab | Shows Default due date / Staleness threshold / Reframe trigger, then an "AI tone" sub-head with the custom-instructions textarea + a one-line pointer to Integrations for the Anthropic key. |

Suggested placement for `settings-tasks.png`: `wiki/Configuration.md`, in the new
"Tasks" subsection of "Settings (in-app)".

Once retaken, replace the four files in `wiki/images/` in place (same filenames —
no doc changes needed beyond removing the "Screenshot note" callout directly under
the General shot in `wiki/Configuration.md`, which exists only to flag this
staleness) and add the `settings-tasks.png` embed.

## Where these go in the docs

Once captured, embed with standard markdown image syntax and a one-line caption,
e.g.:

```markdown
![Kept mobile Today view](images/kept-mobile-today.png)
*Today: Day Arc hero, "What now?" prompt, dated tasks, and today's loops.*
```

Suggested placements (a wiki rewrite is happening in parallel in this repo — check
`wiki/Features.md` and `wiki/Home.md` for their current state before inserting,
section headings may have shifted):

- `wiki/Home.md` — one hero shot near the top (`kept-mobile-today.png` or
  `kept-desktop-today.png`).
- `wiki/Features.md` — `kept-mobile-today.png`/`kept-mobile-tasks.png`/
  `kept-mobile-loops.png` near the top "Themes"/intro section (which is being
  rewritten to describe Kept as the current UI); `kept-desktop-tasks-board.png`
  near any "Desktop UI" section.
- `wiki/Kept-Design-Language.md` — any/all of the mobile + desktop shots as real
  reference alongside the existing HTML prototypes.
- `wiki/Getting-Started.md` — `kept-mobile-throw.png` or `kept-mobile-today.png`
  near the "first task" walkthrough step.

If a target file's structure has changed by the time you're inserting these,
use your judgment on the nearest sensible heading — exact line numbers aren't
guaranteed to still match.

## Report back

When done, list: which filenames you captured, which you skipped and why
(e.g. "weather not configured"), and the actual output paths if different from
`wiki/images/`.
