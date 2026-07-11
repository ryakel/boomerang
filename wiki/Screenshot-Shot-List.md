# Screenshot Shot List (for a separate capture-capable agent)

This session's sandbox can reach the dev server over plain HTTP (`curl` works) but
Chromium/Playwright cannot navigate to `localhost` here, so screenshots have to be
captured by a different agent/environment that can actually drive a browser. This
file is a self-contained handoff: setup steps, then the exact list of shots needed,
each with viewport/theme/state and where it lands in the docs.

**Note on Batch B (Settings):** a Settings reorg is in progress in this same repo
(moving/renaming a few fields so related settings live together — see
`wiki/Version-History.md`'s latest entries for what changed). If Batch A is done
before that lands, fine — do it now. Batch B should wait until that reorg is merged,
otherwise the screenshots will show a layout that's about to change. Check
`git log --oneline -20` on `main`/`dev` for anything mentioning "settings" reorg
before shooting Batch B, or just ask.

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
