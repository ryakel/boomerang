# Upcoming Features

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

## Siri / App Intents expansion (queued 2026-07-16)

v1 shipped one intent ("Add Boomerang task" — dictated title → /api/intake).
The user wants a real action set. Candidates, roughly by value:

- **Complete a task** — "mark X done in Boomerang" (needs a task-title
  AppEntity query against /api — first dynamic-entity intent).
- **What now?** — surface the What Now pick as a Siri answer/dialog.
- **Log a loop / habit** — "log IFR studying in Boomerang" (spawn-and-complete
  or logHabit path).
- **Log an escalation attempt** — "log an attempt on the insurance call".
- **Today summary** — "what's on Boomerang today" → counts + top items dialog
  (read-only, great for CarPlay/HomePod).
- **Snooze a task** — "snooze X until tomorrow".

Notes: title-matching intents need an AppEntity with an EntityQuery hitting
the API (App Group creds, same pattern as the add intent); phrases can then
embed the entity (that's the AppEnum/AppEntity rule that free-text titles
can't satisfy). Read-only intents (summary/what-now) are the easy wins.
