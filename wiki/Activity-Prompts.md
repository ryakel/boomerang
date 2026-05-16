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

## Snooze as the "not before" signal

Closely related to the design above: **snooze is the user's explicit "be quiet about this until time T" signal**, and every activity-prompt feature must respect it. Today a task's `snoozed_until` timestamp means "don't surface this in active lists and don't notify me about it until T." That semantic generalizes: anything we add to the system that fires notifications or pulls a task forward needs to honor a forward-looking snooze and ignore stale (past) ones.

Concretely:

- **Auto-roll (PR 1).** A forward-looking `snoozed_until` is left alone — auto-roll bumps `due_date` but doesn't override the user's "not before 8pm tonight." A past `snoozed_until` is cleared so the rolled task doesn't stay hidden forever. Comparison is done on timestamps, not date strings, so a snooze to "today at 8pm" survives the roll.
- **Habit mode (PR 2).** The behind-pace nudge needs an equivalent of "not now." The Quokka-style **"Not today"** action on the nudge stores a habit-level `next_nudge_after` timestamp on the routine (or in a per-day suppression map) so the user can dismiss without disabling the nudge entirely. The spawned tasks from `+ Log it` follow normal `snoozed_until` rules.
- **Pattern detection (PR 3).** The `pattern_suggestions` row gains an optional `snooze_until INTEGER` field. **"Not yet"** sets `snooze_until = now + 14 days` (or whatever the user picks) so the suggestion stops re-surfacing during scans until past that timestamp. **"Dismiss"** sets `status = 'dismissed'` (permanent). The two actions split the same way snooze and cancel split for tasks: temporary silence vs. permanent close.

**Notification dispatcher hygiene** (fixed bundled with PR 1): every notification type — overdue, stale, nudge, size-based, pile-up — must filter on the `nonSnoozed` task set, not the raw `activeTasks` set. The high-priority loop already does this; the rest used to leak snoozed items into the count and the body text. All four dispatchers (`pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, `src/hooks/useNotifications.js`) plus the legacy counts-style digest now flow through `nonSnoozed`. New notification types added by PRs 2 and 3 must follow this convention.

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
  snooze_until INTEGER,               -- epoch ms; "Not yet" sets this so the
                                      -- suggestion doesn't re-surface in scans
                                      -- until past this point. NULL = no snooze.
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
  - **Not yet (N days)** — set `snooze_until = now + N days` (default 14, configurable). Scans don't re-surface the suggestion until past that timestamp. Distinguishes "I might want this later" from a permanent Dismiss.

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

### PR 1 — Auto-roll + Pills (S) ✅ SHIPPED 2026-05-16

- Migration 025 added `auto_roll INTEGER DEFAULT 0` to `routines` (`spawn_mode` + habit columns deferred to PR 2 for cleaner staging)
- `spawnDueTasks` in `src/hooks/useRoutines.js` now returns `{ spawned, rolled }`. The `rolled` list carries `{ taskId, updates }` instructions for auto-roll routines whose active instance needs its `due_date` bumped to today (and `snoozed_until` cleared if it was past). Callers in `AppV1.jsx` + `AppV2.jsx` apply rolls via `updateTask` before processing spawned tasks.
- Active-instance check for auto-roll uses a stricter "TERMINAL_FOR_ROLL" set (`done`/`completed`/`cancelled`/`backlog`/`project`) — a cancelled/back-burnered instance shouldn't block a roll. The legacy non-auto-roll path keeps its original `!== 'done'` check unchanged to avoid scope-creeping a behavior change.
- v2 `RoutinesModal` form gained an "Auto-roll" section below End date / Priority. Generic `.v2-form-toggle` style (not the priority orange) to keep the visual semantics clean.
- Manual test: create a daily routine with `auto_roll: true`, observe yesterday's lingering instance rolling forward instead of stacking a new task today.

### PR 2 — Habit mode + Workouts (M) ✅ SHIPPED 2026-05-16

- Migration 026 added `spawn_mode TEXT DEFAULT 'auto'`, `target_count INTEGER`, `target_period TEXT` to `routines`.
- `createRoutine` defaults the new fields; db.js round-trips them. `addRoutine` in `useRoutines.js` accepts new positional args for habit-mode.
- `computeHabitStats(routine, tasks, weekStartsOn)` in `src/store.js` returns `{ period_start, period_end, completions, target, streak, behind_pace, elapsed_ratio }`. Behind-pace fires only past the 30% elapsed mark to avoid early-period nags.
- `isRoutineDue` short-circuits to `false` for habit-mode routines so they never enter the cadence-driven spawn loop.
- v2 RoutinesModal:
  - Form: segmented Auto / Habit picker after Title. Habit mode shows target_count + target_period inputs and hides cadence / day-of-week / end-date / auto-roll.
  - List: habit cards render `habit · 2× / week · 1/2 this week · 🔥3` meta. Behind-pace shows the progress in alert color. Expanded actions show "+ Log it" instead of "Spawn now" / "Skip cycle"; the Log button creates a task with `status='done'` linked to the routine in one tap.
- Server-side behind-pace nudge:
  - `pushNotifications.js` — habit nudge block fires push priority-0, throttled 24h per routine, per spec. Inline web-push actions Log it / Not today.
  - `emailNotifications.js` — habit nudge default-OFF (opt-in via `email_notif_habit_nudge`); same 24h throttle.
  - `pushoverNotifications.js` — intentionally NOT wired. Habits are encouragement, never alarms.
- Inline web-push actions:
  - `public/boomerang-sw.js` — when `payload.data.habitAction` is set, surfaces Log it / Not today action buttons. Bare tap on a habit nudge deep-links to `/?routine=<id>`.
  - `POST /api/notifications/action/log-habit` — creates a `status='done'` task linked to the routine.
  - `POST /api/notifications/action/not-today` — bumps the push/email throttle keys 24h forward.
- Settings UI: `habit_nudge` row added to the v2 Notifications matrix; toggles map to `push_notif_habit_nudge` / `email_notif_habit_nudge` / `pushover_notif_habit_nudge`. (Pushover toggle is rendered but the dispatcher ignores it.)
- Manual test: create a habit routine "Workout 2× / week", verify the card shows 0/2 this week, tap "+ Log it" twice, verify card shows 2/2 + streak chip appears next period.

### PR 3 — Pattern detection + suggestion inbox (L) ✅ SHIPPED 2026-05-16

- **Migration 027** created `pattern_suggestions` table with `id, normalized_title, display_title, sample_titles_json, detected_cadence, occurrence_count, last_seen_at, confidence, status, snooze_until, created_at, decided_at` columns + two indices (status, normalized_title).
- **`patternDetection.js`** server module:
  - Title normalization (lowercase, strip articles like "the/a/an/my/our", collapse whitespace, drop trailing punctuation)
  - Cadence classification by interval mean+stddev windows — `daily` (1–2d/σ<1), `weekly` (6–10d/σ<3), `monthly` (26–35d/σ<7), `quarterly` (85–100d/σ<15), `annually` (320–400d/σ<60)
  - Confidence = `min(1.0, count/6) × (1 - stddev/mean)`, floor at 0.45 (annual pair exempted)
  - **AI clustering pass** (optional, gated on `anthropic_api_key`) merges near-duplicates like "mow lawn" / "mow the grass" / "cut grass" via Claude. Bounded to 50 candidate titles per run to cap cost.
  - Skips clusters with `normalized_title` matching an existing routine's title (no double-suggesting).
  - Weekly scheduler runs **Sunday 3am local time** (timezone from `settings.user_timezone`). One-shot per Sunday via `app_data.pattern_last_scan` marker, survives restarts.
- **Server endpoints:**
  - `GET /api/suggestions` — list pending (filters out snoozed by timestamp)
  - `POST /api/suggestions/:id/accept` — body `{ routineConfig }`; creates the routine + marks accepted. Cadence-aware defaults: daily/weekly → `auto_roll: true`; longer cadences → plain auto.
  - `POST /api/suggestions/:id/dismiss` — permanent close
  - `POST /api/suggestions/:id/snooze` — body `{ days }`, default 14, max 180
  - `POST /api/suggestions/scan` — manual trigger for tests / Quokka
- **db.js** CRUD: `upsertPatternSuggestion` (idempotent on `normalized_title`, dismissed/accepted rows are left alone), `listPendingSuggestions`, `countPendingSuggestions`, `getPatternSuggestion`, `updateSuggestionStatus`, `snoozeSuggestion`. Server-only table — outside `/api/data` bulk PUT path.
- **Notification type `routine_suggestion`:**
  - Push: weekly throttle, default ON. Payload carries `data.suggestionsView: true`.
  - Email: weekly throttle, default ON.
  - Pushover: weekly throttle, opt-in only (`=== true` gate).
  - Settings UI: added to the v2 Notifications matrix.
- **Service worker** opens `/?suggestions=1` when payload has `suggestionsView` and no taskId.
- **`SuggestionsModal.jsx` + .css** in `src/v2/components/`:
  - List of suggestion cards with title, cadence chip, sample titles (collapsible if multiple), "5× in past 12mo · last 3d ago · 67% match" meta
  - Three actions per card: **Make it a routine** (accepts inline with cadence-aware defaults; user can refine on Routines screen afterward), **Not yet (14d)** (snooze), **Dismiss** (permanent)
  - Empty state with "Run scan now" CTA
  - Toast confirmation after accept
- **`AppV2`:**
  - New `showSuggestions` state, modal render call, Escape-handler entry
  - Lightbulb-icon row added to the overflow menu under Routines
  - Deep-link handler reads `?task=X` (already wanted but absent) AND `?suggestions=1`; strips the query after handling
- **Quokka tools** (`adviserToolsMisc.js`): `list_suggestions` (read), `dismiss_suggestion`, `snooze_suggestion` (with rollback compensation that restores prior status / snooze).
- Dockerfile: `patternDetection.js` added to the Stage 3 COPY list so the runtime container actually ships it.
- Manual test: see `wiki/Activity-Prompts-Testing.md`.

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
