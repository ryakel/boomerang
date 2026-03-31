# Upcoming Features

## Near-term

### Morning Digest Notification
- Scheduled notification at a configurable time (default 7:00 AM)
- Summary: "You have X open tasks, Y are stale, Z are due today"
- Uses `digest_time` setting (already exists in store, not wired up)
- AI-generated summary when custom instructions are set
- Only fires if there are open tasks

### Customizable Notifications
- Per-type frequency settings (e.g. overdue checks every 15m, nudges every 2h)
- Quiet hours (no notifications between e.g. 10pm-7am)
- Notification sound/vibration toggle
- Notification preview in Settings (test button)
- Per-type enable/disable already exists; needs per-type frequency

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
- Checklist sync between Trello and Boomerang
- Comment sync between Trello and Boomerang
- Multiple board support (currently single board)

## Long-term

### Additional Integrations
- Google Calendar sync (due dates ↔ calendar events)
- Slack notifications (in addition to browser push)
- Email digest (alternative to browser notification)

### Advanced AI
- Task dependency detection ("do X before Y")
- Workload balancing across the week
- Pattern recognition ("you always snooze this type of task")
- Natural language task creation ("remind me to call the dentist next Thursday")

### Mobile Native
- iOS/Android native app wrapper (Capacitor or similar)
- Native push notifications (background, even when app is closed)
- Widget support (iOS/Android home screen widgets)
