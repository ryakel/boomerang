# Upcoming Features

## Parked 2026-08-01 — next pickup

Four items identified during the watch-connectivity / away-mode session, with verified current state, the decision each one blocks on, and its failure mode: `wiki/Parked-20260801.md`. Two overlap the 2026-07-25 recs below (rec 1 and rec 5) — the parked page carries what's since been verified in the tree.

1. **Pin to today** — `committed_on` has no writer in the web app; the server verbs (`/commit`, `/uncommit`) are merged and tested and Siri already calls them. **S, ready to build**, only the row-affordance placement to decide. Minimal slice of rec 1.
2. **Packages drive due dates** — a task blocked on a delivery. `packages.eta`/`delivered_at` exist and `signature_task_id` is a working task-link precedent; needs a general link, poll-path logic, and the migration-049 provenance columns. M.
3. **Arrival reminders / geofencing** — deliver on the stored-but-dead `location_json`; local notifications, requires a Mac build session. Same feature as rec 5.
4. **Calendar-based away detection** — infer the travel window from GCal. The away mechanism shipped 2026-08-01; only the inference is missing. **Propose, never auto-apply** — it gates both notification suppression and bulk date shifting.

## Feature recs (researched 2026-07-25)

Ten recommendations from a full-codebase research pass — detail, file references, and build sketches in `wiki/Feature-Recs-20260725.md`. Theme: light up dark-but-shipped infrastructure (the migration-046 pick-three layer, `location_json`, `timer`, `/api/today`, discarded GCal event data, unsurfaced analytics).

Batch 1:
1. **Pick Three commit ritual** — Today-view UI + Quokka tools for the dormant migration-046 layer (`/commit`, intentions, `first_step`); unlocks the digest's dead commitment sections
2. **Calendar-aware capacity** — today/tomorrow GCal snapshot folded into digest, `/api/today` free-hours math, and What Now
3. **Quokka vision capture** — photo/PDF → staged task plan via the existing `/api/messages` vision path + staged execution
4. **Gmail-aware escalation ladders** — inbound "looks like they replied" detection + sent-mail attempt auto-logging
5. **Geofenced errand recall** — native region monitoring delivering on the stored-but-dead `location_json` (local notifications)

Batch 2:
6. **Ten-minute focus timer** — makes the digest's ten-minutes nudge actionable; fills the `timer: null` placeholder in `todayPayload()`
7. **Home/Lock Screen widgets** over `/api/today` — supersedes the "Widget support" line under Mobile Native below; the interactive-complete AppIntent builds the task-title AppEntity the Siri expansion is blocked on
8. **Suggestions Inbox** — one triage surface for gmail-pending, pattern/tag suggestions, `spawn_mode: 'prompt'`, and voice-capture triage; persists the Gmail classifier's `reason`
9. **Stuck-task radar** — weekly pass routing stuck tasks to existing interventions (shrink / ladder / shelve / reframe / hire); the concrete form of "pattern recognition" under Advanced AI below
10. **Flight Log** — in-app week wrap over records/badges/escalation/session evidence + the Kept §13c achievements expansion

Suggested spine: 1 → 6 → 7; 8 → 9 pair naturally; the rest are independent.

## Near-term

### Critical Tag + Impact — remaining follow-ups (core SHIPPED 2026-07-14)
- Spec + shipped-state notes: `wiki/Crisis-Tag-And-Impact-Ranking.md`
- Parked from v1: impact points multiplier (D3 — revisit after real use), GCal-derived impact dates, critical-specific web-push inline actions ("On it" snooze), weekly impact recap notification, 🚨 section + impact dots on the legacy standard-theme list

### Per-type Notification Frequencies
- Per-type frequency settings (e.g. overdue checks every 15m, nudges every 2h)
- Notification sound/vibration toggle
- Per-type enable/disable already exists; needs per-type frequency

### Push Notification Batching
- Push notifications still send individually (email batch mode is done)
- Digest mode for push: batch multiple into a single notification

## Medium-term

### Multi-User Auth
- Simple session-based auth (JWT cookie, bcrypt passwords)
- First user becomes Admin on initial setup
- Admin: add/remove users, set roles (admin/user), delete all data
- User: manage own tasks, delete own data
- Per-user data segmentation in SQLite
- Login/register screen on first visit

### Enhanced Trello Sync
- Webhook-based real-time sync (currently polling)
- Conflict resolution improvements
- Trello label ↔ Boomerang label mapping
- Comment sync between Trello and Boomerang

## Long-term

### Additional Integrations
- Slack notifications (in addition to browser push)

### Advanced AI
- Task dependency detection ("do X before Y")
- Workload balancing across the week
- Pattern recognition ("you always snooze this type of task")
- Natural language task creation ("remind me to call the dentist next Thursday")

### Mobile Native
- iOS/Android native app wrapper (Capacitor or similar)
- Native push notifications (background, even when app is closed)
- Widget support (iOS/Android home screen widgets)

## Siri / App Intents expansion (queued 2026-07-16 — CORE SET SHIPPED 2026-07-26)

Shipped (see `wiki/iOS-Native-App.md` → Phase 3): the dynamic
`BoomerangTaskEntity` (server-side lookup `GET /api/intents/tasks`) plus
**Complete a task**, **Commit to a task** (task-model verb; server relays the
three-task-ceiling answer), **Snooze a task** (defaults to tomorrow 5am),
and **Today summary** (reads `/api/today`) — alongside the original capture
intent.

Still queued from the original candidate list:

- **What now?** — surface the What Now pick as a Siri answer/dialog (needs the
  scorer reachable server-side as one endpoint).
- **Log a loop / habit** — "log IFR studying in Boomerang" (spawn-and-complete
  or logHabit path).
- **Log an escalation attempt** — "log an attempt on the insurance call".

## Voice capture Phase 2 (queued 2026-07-19 — SHIPPED same day)

Phase 1 (the `/api/capture` endpoint + "Boomerang Capture" dictation
Shortcut, `wiki/Capture-Shortcut.md`) shipped, and the native Phase 2
followed the same day (see `wiki/iOS-Native-App.md` → Phase 3):

- ~~Point the native intent at `/api/capture`~~ **DONE** — native captures
  carry `capture_source: 'siri'` + the server-side long-dictation split.
- ~~Offline queue-and-sync~~ **DONE** — `CaptureQueue` in
  `BoomerangIntents.swift`: App-Group-persisted, drains on next intent run +
  app foreground, 10s request timeout so Siri answers fast.
- **Parameterized one-utterance phrase** ("Add X to Boomerang" with no
  dictation pause) — NOT POSSIBLE as specced: App Shortcuts phrases may only
  embed AppEnum/AppEntity parameters, never a free-form String. The upgrade
  path is the task-title AppEntity work in the "Siri / App Intents expansion"
  section above (entities can appear in phrases; free text cannot).

Still pending: the Mac build session to compile + on-device test the updated
intent (no Xcode in the dev environment — Swift changes are code-reviewed,
not compiled).
