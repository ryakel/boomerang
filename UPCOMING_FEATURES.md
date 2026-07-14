# Upcoming Features

## Near-term

### Crisis Tag + Impact — remaining follow-ups (core SHIPPED 2026-07-14)
- Spec + shipped-state notes: `wiki/Crisis-Tag-And-Impact-Ranking.md`
- Parked from v1: impact points multiplier (D3 — revisit after real use), GCal-derived impact dates, crisis-specific web-push inline actions ("On it" snooze), weekly impact recap notification, 🚨 section + impact dots on the legacy standard-theme list

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
