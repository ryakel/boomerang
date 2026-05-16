# Activity Prompts (auto-roll, habits, historic suggestions)

Three related features that share one shape: **the routine knows when something might happen, but the user decides per-instance whether a task actually gets created.** Today, routines spawn every cycle whether you wanted one or not. The three needs below all want softer behavior.

## Motivation

1. **Pills (high-stakes, daily, can't double up).** You can't take two sets of pills to make up for the one you missed. Missing a day should not pile up tasks — yesterday's pill task should roll forward, not coexist with today's.
2. **Workouts (habit-shaped, not routine-shaped).** "I want to work out a couple times a week. I'm not ready for it to be a strict routine." Target frequency without a cadence-locked schedule. Gentle prompts when behind pace.
3. **Historic activity prompts.** The app should notice patterns in completed-task history and suggest routines for them — "you've completed 'oil change' every ~5 months, want a routine?" — instead of waiting for the user to create routines manually.

## The unifying shape

All three split **scheduling** from **spawning**:

| Feature | Schedule says... | Spawn behavior |
|---|---|---|
| Pills (auto + auto-roll) | "spawn daily" | Spawn or roll-forward — never more than one active instance |
| Workouts (habit) | "no schedule, target 2/week" | No auto-spawn; nudge when behind pace; user proactively logs |
| Historic prompts | "scan completed history weekly" | Don't spawn anything; surface as a suggestion notification |

These are three independently useful mechanisms that compose. Each ships in its own PR.

---

## Mechanism 1: `auto_roll` flag on routines

A new boolean column on `routines`. When `true`:

- The cadence-driven spawn check (`spawnDueTasks` in `useRoutines.js`) first looks for any non-terminal task with this `routine_id` (status not in `done`/`cancelled`/`completed`).
- If one exists: update its `due_date` to today via `updateTaskPartial` (which inherits the existing receipt-cancellation + sync plumbing). Don't spawn a duplicate.
- If none exists: spawn as today.

When `false` (default): existing behavior — every due cycle spawns a new task, even if a prior instance is still active.

**Pills uses `auto_roll: true`.** Most routines stay `false` because plenty of routines legitimately want multiple instances stacking (clean floors weekly: if last week's task is still pending, that's a signal something's wrong, not a reason to suppress this week's).

### Edge cases

- **Existing task is snoozed past today.** Treat as still-pending — un-snooze it (clear `snoozed_until`) and set `due_date = today`. The whole point is "this is overdue, bring it forward."
- **Existing task is snoozed within today.** Leave alone. It's already today's task.
- **Existing task is in `backlog` or `project`.** Treat as terminal-for-this-purpose. Spawn a new active one.
- **Pushover priority-2 receipt cancellation.** Already handled by `cancelEmergencyReceipt` in `updateTaskPartial` when `due_date` changes — auto-roll inherits this for free.

### UI

`RoutinesModal` form gets one new toggle:

> ☐ **Auto-roll** — if I miss a day, just roll yesterday's task forward instead of stacking. (For things you can't double up on, like medication.)

Default off. Visible only when `spawn_mode = 'auto'` (habit-mode routines don't auto-spawn at all, so auto-roll is meaningless there).

---

## Mechanism 2: `spawn_mode: 'habit'` on routines

A new `spawn_mode` column with values `'auto'` (default, today's behavior) | `'habit'`. Sets up target-frequency tracking with no cadence-locked schedule.

Habit routines add two more columns: `target_count INTEGER` and `target_period TEXT` (`'week'` | `'month'`). Cadence + `schedule_day_of_week` + `auto_roll` are all ignored in habit mode (the form hides them).

### Behavior

- **No auto-spawn.** Habit routines never automatically create tasks.
- **Always-visible card on the Routines screen.** Shows `Workout · 2x/week · 1/2 this week 🔥3` (current period progress + streak of consecutive periods hitting target).
- **"+ Log it" button on the card.** Tap creates a task with `routine_id = <habit>` and immediately marks it `done` with `completed_at = now`. Counts toward the period total. After-the-fact logging — the simplest case.
- **Behind-pace nudge** (server-side, runs in the existing notification dispatcher loop):
  - Compute behind-pace as `target_count - completions_this_period > days_remaining_in_period × (target_count / period_length_days)`.
  - If behind, fire a web-push notification: `"It's Thursday — 0/2 workouts this week. Want to log one today?"` with inline actions:
    - **"Log it"** → POST `/api/routines/:id/log` (creates + completes a task in one step)
    - **"Not today"** → suppresses further nudges for 24h
  - Push priority-0 only. Never Pushover. Habit nudges are encouragement, not alarms.
  - Throttle: max 1 nudge per habit per day. Suppress entirely on the user's quiet hours.

### Period & streak semantics

- Period starts on the user's `week_starts_on` setting (default Monday).
- Completions counted by `completed_at` falling inside the current period.
- Streak: count consecutive prior periods where `completions ≥ target_count`. Reset on the first period that didn't hit target. Periods with `target_count = 0` (paused) are treated as no-fault and skipped in the streak walk (same logic as `computeStreak`'s no-fault day handling).

### Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/routines/:id/log` | Create + complete a task linked to a habit routine in one round-trip. Returns the created task. |
| `GET /api/routines/:id/habit-stats` | Return `{ period_start, period_end, completions, target, streak, behind_pace }` for the current period. The card and notification copy use this. |

The existing `POST /api/routines` and `PATCH /api/routines/:id` accept `spawn_mode`, `target_count`, `target_period`.

### Future habit shapes

- Per-day-of-week targets (e.g., "every weekday but not weekends")
- Per-period escalation (e.g., "soft for week 1, firmer for week 2")

Out of scope for the first PR. The columns + endpoints are designed so adding these later is additive (new `target_*` columns), not a rewrite.

---

## Mechanism 3: Pattern detection → suggestion notifications

A weekly server job scans completed-task history, detects recurring patterns, and stores them in `pattern_suggestions` for the user to triage.

### Detection algorithm

1. **Source data.** All `tasks` rows where `status IN ('done','completed')` AND `completed_at >= now - 12 months` AND `routine_id IS NULL` (don't re-detect already-routinized work).
2. **Normalize titles.** Lowercase, strip leading articles ("a "/"an "/"the "), trim, collapse whitespace, strip trailing punctuation.
3. **Group by normalized title.** Drop groups with fewer than 3 occurrences (annual special case: keep groups with ≥ 2 occurrences if average interval > 200 days).
4. **Compute interval distribution.** For each group, compute deltas between successive `completed_at`s. Classify the cadence:
   - `daily` if mean delta is 1-2 days, stddev < 1
   - `weekly` if mean is 6-10 days, stddev < 3
   - `monthly` if mean is 26-35 days, stddev < 7
   - `quarterly` if mean is 85-100 days, stddev < 15
   - `annually` if mean is 350-380 days
   - Otherwise: no detected cadence (skip)
5. **Confidence score.** `min(1.0, occurrence_count / 6) × (1 - stddev / mean)`. Discard suggestions with confidence < 0.45.
6. **AI clustering (optional second pass).** For titles that don't group cleanly but have semantic similarity ("mow lawn" / "mow the grass" / "cut grass"), run an AI call to merge near-duplicates *before* step 3. Bounded to ~50 candidates per run to cap cost. Skip the AI step if `anthropic_api_key` is unset.
7. **Dedup against existing.** If a `pattern_suggestions` row already exists with the same `normalized_title` and `status != 'dismissed'`, update its `occurrence_count` / `last_seen_at` instead of creating a new row.

### Storage

```sql
-- migration 026
CREATE TABLE pattern_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_title TEXT NOT NULL,
  display_title TEXT NOT NULL,        -- best human-readable title from the cluster
  sample_titles TEXT,                 -- JSON array of all titles in the cluster
  detected_cadence TEXT NOT NULL,     -- 'daily'|'weekly'|'monthly'|'quarterly'|'annually'
  occurrence_count INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,      -- epoch ms of most recent completion in cluster
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'accepted'|'dismissed'
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX idx_pattern_suggestions_status ON pattern_suggestions(status);
```

**Durability note:** this table lives server-side only. It is NOT in the bulk-PUT path used by `/api/data`. A wipe like the one on 2026-05-07 cannot take it out. (Lesson from "the great database wipe of May 2026" — `notification_log` survived for the same reason. Same posture applies here.)

### Run cadence

- Server scheduler runs the scan **weekly, at 3am local time on Sunday** (configurable via `pattern_scan_day` / `pattern_scan_hour` settings, but defaults are sufficient for v1).
- On run completion, count pending suggestions. If `≥ 1 new` (rows created or count-bumped this run) AND `pattern_suggestion_notifications` is enabled (default: on), fire one batched notification: `"3 routine suggestions waiting"` deep-linking to the review screen.

### Review UI

A new screen accessed via:

1. **Notification deep-link** (tapping the push)
2. **Quokka chat seed** — once a week, when new suggestions exist, the auto-message "Found N patterns in your completed history this week. Want to review?" creates a chat with a button linking to the review UI.
3. **Routines screen header** — small badge "N suggestions" if any are pending.

The review screen is a stack of suggestion cards. Each card shows:

- Title (with sample titles in a "and N similar" disclosure)
- Detected cadence + last N occurrences (mini timeline)
- Confidence as a soft chip
- Three actions:
  - **Make it a routine** — opens RoutinesModal pre-filled with title, cadence, `spawn_mode: 'prompt'` (planned future mode; until prompt mode ships, default to `'auto'` with `auto_roll: true`). On save: mark suggestion `accepted`.
  - **Dismiss** — mark suggestion `dismissed`. Future scans skip this `normalized_title` permanently.
  - **Not yet** — leave as `pending`; resurfaces next scan if pattern persists.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/suggestions` | List pending suggestions sorted by confidence DESC |
| `POST /api/suggestions/:id/accept` | Body includes the routine config the user chose; creates the routine + marks accepted |
| `POST /api/suggestions/:id/dismiss` | Mark dismissed |
| `POST /api/suggestions/scan` | Manual trigger (debug + Quokka tool) |

### Notification type

New entry in the notifications matrix: **`routine_suggestion`**.

- Default channels: web push ON, email OFF, Pushover OFF.
- Settings keys: `push_notif_routine_suggestion`, `email_notif_routine_suggestion`, `pushover_notif_routine_suggestion`.
- Throttle key: `routine_suggestion`. One per scan run, max.

### Quokka integration

Two new tools in `adviserToolsMisc.js`:

- `list_suggestions(status?)` — read pending suggestions
- `dismiss_suggestion(id, reason?)` — let Quokka dismiss on the user's behalf via natural language

Quokka can answer "what's new in suggestions this week?" and "ignore the oil-change one, it's irregular by design."

---

## Schema summary

```sql
-- migration 025: routine shapes (auto-roll + habit mode)
ALTER TABLE routines ADD COLUMN auto_roll INTEGER DEFAULT 0;
ALTER TABLE routines ADD COLUMN spawn_mode TEXT DEFAULT 'auto';   -- 'auto'|'habit'
ALTER TABLE routines ADD COLUMN target_count INTEGER;             -- habit mode
ALTER TABLE routines ADD COLUMN target_period TEXT;               -- 'week'|'month'

-- migration 026: pattern suggestions
-- (see DDL above)
```

## Notification settings summary

| Key | Default | Notes |
|---|---|---|
| `push_notif_routine_suggestion` | `true` | Weekly batched ping when new suggestions exist |
| `email_notif_routine_suggestion` | `false` | Opt-in; email channel optional |
| `pushover_notif_routine_suggestion` | `false` | Soft signal — never an alarm |
| `habit_nudge_enabled` | `true` | Master toggle for behind-pace habit nudges |
| `pattern_scan_enabled` | `true` | Master toggle for the weekly scan |
| `pattern_scan_lookback_months` | `12` | Configurable; users can shorten if performance ever matters |

---

## Build order

Three PRs, each independently mergeable on `dev`:

### PR 1 — Auto-roll + Pills (S)

- Migration 025 (just `auto_roll`; `spawn_mode` + habit columns added in PR 2 for cleaner staging)
- `spawnDueTasks` checks `auto_roll`; rolls forward instead of spawning when a non-terminal instance exists
- RoutinesModal form: auto-roll toggle
- Wiki: this doc + Version-History entry
- Manual test: create a Pills routine with `auto_roll: true`, simulate missing a day, verify the existing task's due_date bumps to today instead of a second task appearing

### PR 2 — Habit mode + Workouts (M)

- Migration 025 amendment OR migration 025a (decide at PR time)
- `spawn_mode: 'habit'` plumbing through `useRoutines`, RoutinesModal, routine card
- Always-visible card with "+ Log it" button + period progress + streak
- `POST /api/routines/:id/log` endpoint
- `GET /api/routines/:id/habit-stats` endpoint
- Behind-pace nudge in the notification dispatcher loop
- Inline web-push actions: Log it / Not today

### PR 3 — Pattern detection + suggestion inbox (L)

- Migration 026 (`pattern_suggestions` table)
- `patternDetection.js` server module + weekly scheduler
- AI clustering pass (gated on API key)
- `routine_suggestion` notification type + settings keys
- Review UI screen
- Quokka chat seed + 2 new Quokka tools
- Manual test: backfill 12 months of completed tasks with a known pattern, run the scan, verify the suggestion + notification + review flow

---

## Open questions deferred to PR time

- **Cadence inference for "accept suggestion → create routine"** — should the new routine default to `prompt` mode (when that ships) or `auto + auto_roll`? Probably `auto + auto_roll` for short cadences (daily/weekly), `prompt` for longer ones (quarterly/annually) where the user is more likely to want a sanity check before adding a task.
- **Annual cadence detection with only 2 occurrences** — confidence math punishes this. Either special-case the floor (occurrence_count ≥ 2 + interval-in-window is enough for `annually`) or accept that 2-shot annuals need a 3rd cycle before surfacing.
- **"Not yet" debounce** — if the user picks "Not yet" three weeks in a row, should the suggestion auto-dismiss? Probably yes after 3 "not yet"s — silent dismiss avoids nag fatigue.
- **Habit log retroactivity** — should "+ Log it" support "actually I did this yesterday"? Adds a date picker on the log button. Useful but not v1.
- **Habit + sequences** — can a habit routine carry `follow_ups`? Probably yes (logging a workout could chain "stretch", "log weight"), but ensure `spawnNextChainStep` works the same when the parent task is created via the habit-log path.

---

## Future work (not in the current 3 PRs)

- **`spawn_mode: 'prompt'`** — the third spawn mode. Cadence-driven, but instead of auto-spawning, sends a notification with Add/Skip actions. Useful for irregular things you want to be reminded of without auto-loading the list. Deferred because none of the three current needs strictly require it.
- **Pattern detection signal sources beyond `tasks`** — using GCal event history, Notion page-creation patterns, or package-delivery cycles as additional signal. Cool but heavyweight.
- **Habit "soft-due" date** — let a habit be tied to a calendar (e.g., "workout on Mon/Wed/Fri") without forcing a routine cadence. Hybrid shape.
- **Cross-period habit goals** — "20 workouts/quarter" with internal week-by-week pacing. The 1-period model in PR 2 covers the user's stated need; multi-period waits for demand.
