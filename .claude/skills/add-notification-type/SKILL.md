---
name: add-notification-type
description: Checklist for adding, changing, or removing any notification/background send in Boomerang. Load before touching pushNotifications.js, emailNotifications.js, pushoverNotifications.js, apnsNotifications.js, digestBuilder.js, or adding any server-side send.
---

# Adding or changing a notification

Full architecture and history: `wiki/Claude-Notes-Notifications.md`; manual test procedure: `wiki/Testing-Notification-Stack.md`.

## First question: should this exist?

Since the 2026-07-24 reshape ("The Great Alert Deletion") the product is **one morning digest + intentionally rare, high-value pings**. The complete surviving list: the digest; Critical-tag cadence + Pushover Emergency; escalation-ladder nudges; per-task Remind-me (`nag_allowed`, one gentle line/day); event pings (package delivered/exception/signature, Quokka plan-ready); test endpoints. Anything informational folds into the digest instead of becoming a new send. A new ambient send needs explicit user buy-in.

## Checklist for a new/changed send

- [ ] **Muzzle**: every background send path checks `notifsMuzzled` (dev servers never background-send; direct test endpoints stay live).
- [ ] **Eligibility**: task-driven sends go through `isNotifiable()` in `server/db.js` (due_date || nag_allowed || active escalation; crisis is its own opt-in; `snooze_indefinite` and gmail-pending excluded).
- [ ] **All transports**: the three engines (`pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`) are independent loops — a type usually needs parallel treatment in each. APNs is NOT a fourth engine: it's the native leg inside `sendPush()`, the single choke point; Apple web-push endpoints are skipped when a native send lands (arbitration), non-Apple endpoints always receive.
- [ ] **Toggles**: per-type toggle per channel (`push_notif_*` / `email_notif_*` / `pushover_notif_*`), riding the channel master. Display-gate the toggle by its channel master — a toggle must never LOOK on when nothing will send.
- [ ] **Throttle/dedup**: use the server-side `notification_throttle` table (channel-prefixed keys). Web push re-sends that should replace, not stack, carry a `tag` (and APNs `apns-collapse-id`).
- [ ] **Quiet hours**: default is silence; the `wake-me` bypass label is the per-task exception. Pushover priority 1/2 bypass by design.
- [ ] **Copy**: no punishment language (the banned-words rule); crisis copy uses "due Nd ago".
- [ ] **Deep link**: carry `?task=<id>` so engagement analytics (`tapped_at`/`completed_after`) keep working; log to `notification_log`.
- [ ] **Digest interaction**: if the info is daily-shaped, put it in `digestBuilder.js` instead — the digest builder is fully synchronous (cache-only reads, never a live AI call).
- [ ] **Docs**: update `wiki/Claude-Notes-Notifications.md` + Version-History entry.
