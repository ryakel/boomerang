# Activity Prompts — Comprehensive Testing Plan

Covers PR 1 (auto-roll + pills), PR 2 (habit mode + workouts), PR 3 (pattern detection + suggestions) plus the bundled snooze-leak fix. Updated 2026-05-16.

**Important context:** notifications can't be tested in `dev` (boomerang-dev container has no SMTP, no Pushover credentials, no push subscription registered). Every notification check below must be run against the prod container (`boomerang-app` on port 3001) after the merge to `main`. The non-notification checks all work in `dev`.

---

## Symbols used below

| Sym | Meaning |
|---|---|
| `dev` | Can be tested in the boomerang-dev container |
| `prod` | Requires production deployment + real notification channels |
| `db` | Verify in SQLite directly (`sqlite3 /data/boomerang.db ...`) |
| `ai` | Requires `anthropic_api_key` configured |

---

## Setup

- [ ] `git pull origin main` (or test on `dev` branch deploy first)
- [ ] Verify migrations 025 + 026 + 027 ran on boot. Check server logs for the three `[DB] Running migration 0XX_...sql` lines on a fresh DB, or query `_migrations` to confirm:
  ```sql
  SELECT id FROM _migrations WHERE id IN (25, 26, 27);  -- expect three rows
  ```
- [ ] Open the v2 UI (default since 2026-05-03 cutover). If on terminal-dark theme, confirm Settings → Beta → Use v2 interface is on.

---

## PR 1 — Auto-roll on routines

### Schema & defaults

- [ ] `db`: `PRAGMA table_info(routines);` shows `auto_roll INTEGER DEFAULT 0`.
- [ ] `db`: All existing routines have `auto_roll = 0`.

### Create + toggle

- [ ] `dev`: Settings → ⋯ → Routines → New routine. Title "Pills (test)", Frequency daily.
- [ ] `dev`: Scroll the form — confirm "Auto-roll" section appears below End date / Priority.
- [ ] `dev`: Hint text reads: "If a previous task is still active when the next one is due, roll its date forward instead of stacking a duplicate. Useful for medication or anything you can't double up on."
- [ ] `dev`: Tap "Off" button → toggles to "On" with accent-color outline (NOT priority orange).
- [ ] `dev`: Save. Routine card shows `daily` (no auto-roll-specific UI on the card — it's a behavior flag, not a status).
- [ ] `db`: `SELECT auto_roll FROM routines WHERE title = 'Pills (test)';` → `1`.

### Spawn behavior — no existing instance

- [ ] `dev`: Wait for the next scheduled spawn (or open the Routines screen and tap `Spawn now` to test). A new task appears on the list with title "Pills (test)" and due_date = today.

### Spawn behavior — auto-roll engages

- [ ] `dev`: With the Pills (test) task on the list, leave it un-done overnight (or fake-age it by editing `due_date` to yesterday via the edit modal).
- [ ] `dev`: Refresh / let the next routine-spawn check fire (happens on every render).
- [ ] **Expected:** No new "Pills (test)" task appears; the existing task's `due_date` updates to today.
- [ ] `dev`: Check the original task's edit modal — `due_date` is today.

### Auto-roll respects forward-looking snoozes

- [ ] `dev`: Snooze the Pills task to "8pm today."
- [ ] `dev`: Trigger another routine spawn check.
- [ ] **Expected:** The task's `snoozed_until` is still 8pm today; `due_date` may have updated but the snooze isn't cleared.

### Auto-roll clears stale (past) snoozes

- [ ] `dev`: Edit the Pills task's `snoozed_until` to yesterday (you'd have to do this via the DB since the UI won't snooze backwards; or seed a stale snooze via Quokka). Or skip this check if not easily reproducible.
- [ ] **Expected:** When the auto-roll runs, `snoozed_until` becomes `null`.

### Legacy (non-auto-roll) routine behavior unchanged

- [ ] `dev`: Create another routine "Weekly check (test)", auto-roll **off**, frequency weekly.
- [ ] `dev`: Spawn it manually. Wait a week (or fast-forward via `completed_history`).
- [ ] **Expected:** If the previous instance is still on the list (status not done), the next spawn is **skipped** (legacy behavior). No new task; no roll-forward. This is the pre-PR1 behavior, intentionally preserved.

---

## Snooze-leak fix (bundled with PR 1)

The fix touched 4 dispatchers + the legacy counts digest. Most can't be tested without notifications, but the core "snoozed task not surfaced as quick-win" can be eyeballed via the client.

### Client-side `useNotifications` (works in dev IF browser notifications are granted)

- [ ] `dev`: Create a task "Snoozed test (XS)", set size XS, snooze it to 24h in the future.
- [ ] `dev`: Confirm `notifications_enabled` is on. Open DevTools console.
- [ ] `dev`: Wait for the client-side nudge interval (or force it by setting `notif_freq_nudge` to a small value).
- [ ] **Expected:** When a "Quick win" nudge fires, it does NOT reference "Snoozed test." If "Snoozed test" is the only XS/S task, no "Quick win" nudge should fire at all.

### Server-side dispatchers (prod only)

- [ ] `prod`: Same scenario above but with `push_notifications_enabled` + a registered push subscription. Verify the snoozed task doesn't appear in the push body.
- [ ] `prod`: Same for `email_notifications_enabled` + a configured SMTP.
- [ ] `prod`: Same for Pushover.

### Counts digest

- [ ] `prod`: Set `digest_style = 'counts'` (legacy). Snooze one of the open tasks. Trigger digest via `POST /api/digest/test`.
- [ ] **Expected:** The "N open" / overdue / stale numbers reflect only non-snoozed tasks.

---

## PR 2 — Habit mode + Workouts

### Schema & defaults

- [ ] `db`: `PRAGMA table_info(routines);` shows `spawn_mode TEXT DEFAULT 'auto'`, `target_count INTEGER`, `target_period TEXT`.
- [ ] `db`: All existing routines have `spawn_mode = 'auto'`, `target_count IS NULL`, `target_period IS NULL`.

### Form mode picker

- [ ] `dev`: Routines → New routine. Confirm a segmented control appears right after Title: `[ Auto (cadence) | Habit (target frequency) ]`. Auto is selected by default.
- [ ] `dev`: Click "Habit (target frequency)" → segmented switches; Frequency / On day / End date / Auto-roll all disappear.
- [ ] `dev`: A new row appears: Target count [number input] / Per [Week | Month] dropdown.
- [ ] `dev`: Switch back to Auto → habit fields disappear, cadence inputs reappear.

### Create habit routine

- [ ] `dev`: Title "Workout (test)", segmented to Habit, Target 2, Per Week, Save.
- [ ] `db`: `SELECT spawn_mode, target_count, target_period FROM routines WHERE title = 'Workout (test)';` → `('habit', 2, 'week')`.

### Habit card rendering

- [ ] `dev`: Routines screen shows "Workout (test)" with the meta line: `habit · 2× / week · 0/2 this week`. No streak chip on first appearance.
- [ ] `dev`: Tap-to-expand. Confirm action row shows **"+ Log it"** instead of "Spawn now" + no "Skip cycle" button.

### "+ Log it" creates a done task

- [ ] `dev`: Tap "+ Log it". Button briefly shows "✓ Logged" with a check icon.
- [ ] `dev`: Card meta updates immediately: `0/2 this week` → `1/2 this week`.
- [ ] `dev`: Open Done list / Activity log — a new entry "Workout (test)" with status `done`, completed_at ≈ now.
- [ ] `db`: `SELECT status, completed_at, routine_id FROM tasks WHERE title = 'Workout (test)' ORDER BY created_at DESC LIMIT 1;` → status `done`, completed_at set, routine_id matches the habit.

### Habit no-spawn

- [ ] `dev`: Leave the habit alone for an hour. Refresh.
- [ ] **Expected:** No new "Workout (test)" task appears on the active list. Habit routines never auto-spawn.
- [ ] `dev`: Edit the routine, switch to Auto → switch back to Habit → confirm still no spawn happens.

### Behind-pace detection

Setup: it's Thursday afternoon, target 2/week, completions 0.

- [ ] `db`: Verify `computeHabitStats` (server inline mirror) would mark behind-pace: `elapsedRatio` past 0.3 + `completions < target × ratio`.
- [ ] `dev`: Card shows `0/2 this week` with the count in **alert color** (red/orange depending on theme). On theme: terminal-dark = magenta-red; light = `--v2-alert-high-pri` orange.

### Hit target, see streak

- [ ] `dev`: Tap "+ Log it" twice (or once if already at 1/2). Card meta: `2/2 this week`.
- [ ] `dev`: Next week (or shift the week artificially via DB / system clock), card should show `0/2 this week · 🔥1`.

### Edit existing habit routine

- [ ] `dev`: Open the habit's edit form. Verify the Habit mode segmented stays selected, target_count + target_period fields are populated.
- [ ] `dev`: Change target from 2 to 3 → Save. Card meta now: `(current completions)/3 this week`.

### Behind-pace push nudge (prod)

- [ ] `prod`: Set Settings → Notifications → Habit nudges → Push **ON**. Email + Pushover behavior verified separately.
- [ ] `prod`: Create a "Workout (test)" habit with target 2/week. Do NOT log anything Mon–Wed.
- [ ] `prod`: Wait for Thursday morning's dispatcher tick (or force via `setNotifThrottle('push_habit:<id>', '2026-01-01T00:00:00Z')` to clear throttle and trigger immediately).
- [ ] **Expected:** A push arrives with title "Workout (test)" and body `0/2 this week — want to log one today?`. Two action buttons: **Log it** and **Not today**.
- [ ] `prod`: Tap "Log it" without opening the app. Verify a done task appears (after next SSE poke) and the routine's card shows 1/2.
- [ ] `prod`: Set up another habit. Tap "Not today" on its nudge. Verify no nudge for the same routine for 24h (throttle).
- [ ] `prod`: Confirm habit nudges do NOT route to Pushover even if `pushover_notifications_enabled` is on (this is a hard skip in the dispatcher).

### Bare-tap deep link

- [ ] `prod`: Tap the body (not an action button) of the habit push. App opens at `/?routine=<id>`.
- [ ] `prod`: AppV2's deep-link handler currently doesn't open Routines from `?routine=` — confirmed; the URL strips silently. Acceptable for v1; defer Routines-prefill follow-up.

---

## PR 3 — Pattern detection + Suggestions

### Schema

- [ ] `db`: `PRAGMA table_info(pattern_suggestions);` returns 12 columns including `snooze_until INTEGER`.
- [ ] `db`: Two indices exist: `idx_pattern_suggestions_status`, `idx_pattern_suggestions_normalized`.

### Empty state

- [ ] `dev`: Open ⋯ → Suggestions. Empty state shows lightbulb icon + "No suggestions right now" + "Run scan now" CTA.
- [ ] `dev`: Tap "Run scan now". With a fresh DB or one with no clear patterns, scan completes silently — no error, modal stays in empty state.

### Seed a detectable pattern (manual)

To test detection without waiting weeks, seed historic completed tasks:

```sql
-- Run via sqlite3 /data/boomerang.db. 5 weekly completions of "Mow lawn" over the past 5 weeks.
INSERT INTO tasks (id, title, status, completed_at, created_at, last_touched)
VALUES
  ('test-mow-1', 'Mow lawn', 'done', '2026-04-12T16:00:00Z', '2026-04-12T15:00:00Z', '2026-04-12T16:00:00Z'),
  ('test-mow-2', 'Mow lawn', 'done', '2026-04-19T16:00:00Z', '2026-04-19T15:00:00Z', '2026-04-19T16:00:00Z'),
  ('test-mow-3', 'Mow lawn', 'done', '2026-04-26T16:00:00Z', '2026-04-26T15:00:00Z', '2026-04-26T16:00:00Z'),
  ('test-mow-4', 'Mow lawn', 'done', '2026-05-03T16:00:00Z', '2026-05-03T15:00:00Z', '2026-05-03T16:00:00Z'),
  ('test-mow-5', 'Mow lawn', 'done', '2026-05-10T16:00:00Z', '2026-05-10T15:00:00Z', '2026-05-10T16:00:00Z');
```

- [ ] `dev`: Restart the server (so it picks up the seeded data).
- [ ] `dev`: ⋯ → Suggestions → "Run scan now."
- [ ] **Expected:** A new suggestion card appears: "Mow lawn" with `weekly` cadence chip, `5× in past 12mo · last <N>d ago · ~80%+ match`.

### Sample-titles disclosure

- [ ] `dev`: Update one of the seed rows to have a variant title (e.g., `UPDATE tasks SET title = 'Mow the grass' WHERE id = 'test-mow-3';`). Without AI clustering, this becomes a separate single-completion cluster (no suggestion). With AI clustering and an API key, it should fold into the Mow lawn suggestion.
- [ ] `ai` `dev`: Run scan again with API key configured. Inspect the Mow lawn suggestion card — if AI merged, "and 1 similar" disclosure appears. Tap → reveals "Mow lawn" + "Mow the grass."

### Cadence-aware accept defaults

- [ ] `dev`: Tap **Make it a routine** on the Mow lawn suggestion. Toast confirms creation.
- [ ] `db`: New routine exists: `SELECT title, cadence, auto_roll FROM routines WHERE title = 'Mow lawn';` → `('Mow lawn', 'weekly', 1)`. The auto-roll defaults to true for daily/weekly suggestions.
- [ ] `db`: Suggestion is marked accepted: `SELECT status FROM pattern_suggestions WHERE display_title = 'Mow lawn';` → `accepted`.
- [ ] `dev`: Run scan again. The Mow lawn pattern doesn't re-surface (accepted rows are left alone by `upsertPatternSuggestion`).

### Quarterly cadence acceptance defaults

Seed another pattern: 4 completions of "Replace air filter" over the past 12 months (~quarterly).

```sql
INSERT INTO tasks (id, title, status, completed_at, created_at, last_touched)
VALUES
  ('test-fltr-1', 'Replace air filter', 'done', '2025-08-15T10:00:00Z', '2025-08-15T09:00:00Z', '2025-08-15T10:00:00Z'),
  ('test-fltr-2', 'Replace air filter', 'done', '2025-11-15T10:00:00Z', '2025-11-15T09:00:00Z', '2025-11-15T10:00:00Z'),
  ('test-fltr-3', 'Replace air filter', 'done', '2026-02-15T10:00:00Z', '2026-02-15T09:00:00Z', '2026-02-15T10:00:00Z'),
  ('test-fltr-4', 'Replace air filter', 'done', '2026-05-15T10:00:00Z', '2026-05-15T09:00:00Z', '2026-05-15T10:00:00Z');
```

- [ ] `dev`: Run scan → "Replace air filter" appears with cadence chip `quarterly`.
- [ ] `dev`: Accept → confirm the new routine has `cadence='quarterly'` AND `auto_roll=0` (quarterly + longer cadences skip auto-roll by default).

### Dismiss permanent

- [ ] `dev`: Seed a third pattern. Tap **Dismiss** on it.
- [ ] `db`: `SELECT status, decided_at FROM pattern_suggestions WHERE id = <id>;` → `dismissed`, decided_at set.
- [ ] `dev`: Run scan again → the dismissed pattern does NOT re-surface.

### Snooze (Not yet)

- [ ] `dev`: Seed a fourth pattern. Tap **Not yet (14d)**.
- [ ] `db`: `SELECT snooze_until FROM pattern_suggestions WHERE id = <id>;` → epoch ms ~14 days in the future.
- [ ] `dev`: Refresh the modal → snoozed suggestion is hidden.
- [ ] `dev`: Run scan again — the cluster gets `upsertPatternSuggestion`'d (because status='pending' isn't 'dismissed' or 'accepted'), but `listPendingSuggestions` still filters it out via the `snooze_until > now` check.
- [ ] `dev`: Edit `snooze_until` to a past timestamp via DB. Open the modal → suggestion reappears.

### Existing routines blocked from re-suggestion

- [ ] `dev`: Confirm the "Mow lawn" pattern, now-routinized, doesn't re-suggest even after additional completions get seeded.

### Routine-suggestion push (prod)

- [ ] `prod`: Settings → Notifications → "Routine suggestions" → Push **ON**.
- [ ] `prod`: With ≥1 pending suggestion, force the weekly throttle to expire: `UPDATE notification_throttle SET last_sent = '2024-01-01' WHERE key = 'push_routine_suggestion';`
- [ ] `prod`: Wait for the next dispatcher tick.
- [ ] **Expected:** A push arrives: title `N routine suggestion(s) waiting`, body "Boomerang noticed patterns in your completed history. Tap to review."
- [ ] `prod`: Tap the push body. App opens at `/?suggestions=1`. The Suggestions modal opens automatically.

### Routine-suggestion email (prod)

- [ ] `prod`: Set `email_notifications_enabled=1`, `email_notif_routine_suggestion=1`. Reset throttle. Trigger dispatcher tick.
- [ ] **Expected:** Email arrives with subject "Boomerang: N routine suggestion(s)" and the body text.

### Routine-suggestion pushover (prod, opt-in)

- [ ] `prod`: Set `pushover_notifications_enabled=1` AND `pushover_notif_routine_suggestion=1`. Reset throttle. Trigger.
- [ ] **Expected:** Pushover priority-0 message arrives.
- [ ] `prod`: With `pushover_notif_routine_suggestion=false` (default), confirm Pushover does NOT fire for routine suggestions.

### Weekly scheduler (Sunday 3am local)

- [ ] `db`: After Sunday 3am rolls past in the user's timezone, `SELECT * FROM app_data WHERE key = 'pattern_last_scan';` → ISO date matching today (Sunday).
- [ ] `dev`: Re-trigger 1 hour later — the scan tick gates on `pattern_last_scan === today` and skips. Verify no duplicate scan runs.
- [ ] `dev`: Restart the server mid-Sunday. The scheduler picks up where it left off (the `pattern_last_scan` marker survives).

### AI clustering pass

- [ ] `ai` `dev`: With `anthropic_api_key` set, seed 3 single-completion variants ("Mow lawn", "Mow the grass", "Cut grass") and run scan.
- [ ] **Expected:** Server logs show no errors. The Suggestions list shows ONE suggestion with the three titles in the "and N similar" disclosure (if cluster confidence cleared the floor), OR no suggestion (if confidence too low). Either is acceptable behavior — the AI is opt-in and best-effort.
- [ ] `dev`: Without `anthropic_api_key`, seed the same and run scan → confirm only the most-frequent normalized title gets clustered (no cross-variant merging).

### Quokka tools

- [ ] `dev` `ai`: Open Quokka. "What routine suggestions are pending?"
- [ ] **Expected:** Quokka calls `list_suggestions`, returns the list of pending suggestions in chat.
- [ ] `dev` `ai`: "Dismiss the one about [title]."
- [ ] **Expected:** Quokka stages `dismiss_suggestion`, shows a preview "Dismiss suggestion #<id>", Apply → DB updates. Rollback restores prior status (test by aborting the Apply step).
- [ ] `dev` `ai`: "Snooze the [title] suggestion for 30 days."
- [ ] **Expected:** Quokka stages `snooze_suggestion`, Apply → `snooze_until` shifts ~30 days forward.

---

## Cross-cutting integration

### Snooze respect across all activity-prompt features

- [ ] PR 1 auto-roll: ✓ tested above (forward snoozes preserved, past snoozes cleared)
- [ ] PR 2 habit: the "Not today" action stores a 24h throttle bump — verify via `getNotifThrottle('push_habit:<id>')` showing a future ISO timestamp.
- [ ] PR 3 suggestion: ✓ tested above (snooze_until column)

### Bulk-PUT durability for pattern_suggestions

- [ ] `db`: Confirm `pattern_suggestions` is NOT in the bulk-PUT path of `/api/data`.
  ```bash
  curl -X PUT -H "Content-Type: application/json" -d '{"tasks":[]}' http://localhost:3001/api/data
  # Should return 409 with "shrink protection" wording — and pattern_suggestions remains untouched.
  ```
- [ ] `db`: After the above, `SELECT COUNT(*) FROM pattern_suggestions;` is unchanged.

### Existing routines unaffected

- [ ] `dev`: Open a pre-existing routine (created before any of these PRs). Confirm:
  - Spawn mode is implicitly "Auto" (no UI confusion)
  - Auto-roll toggle defaults to Off
  - Form behaves as before
  - Routine card meta line uses the old `weekly · Fri` style, not the habit format

---

## Smoke test that must still pass

- [ ] `npm test` (the `scripts/smoke-test.sh` smoke test) — green
- [ ] `npm run lint` — 0 errors (9 pre-existing warnings unrelated)
- [ ] `npm run check:terminal-titles` — all v2 ModalShell calls have `terminalTitle` props
- [ ] `node patternDetection.js`-style direct invocation isn't supported; `POST /api/suggestions/scan` is the manual hook
