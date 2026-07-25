# Claude Dev Notes — Notifications

> Moved out of `CLAUDE.md` (2026-07-25) in the context-engineering restructure: `CLAUDE.md` now holds only invariants and gotchas, and deep implementation notes live here, loaded on demand. Content below is preserved from the former CLAUDE.md "Development Notes" and stays maintained — update it the same way CLAUDE.md used to be updated.

### Notifications System (RESHAPED 2026-07-24 — "The Great Alert Deletion")
**One calm morning digest push, plus a small set of intentionally rare, high-value pings.** The ambient alert flood was DELETED (not disabled) per the digest-reshape spec + two locked scope decisions. Anything informational folds into the digest.

**What survives (the complete list — any new background send must justify itself against this):**
- **The morning digest** — THE one scheduled notification (see Morning Digest Pipeline below).
- **Critical tag** (per-task opt-in): per-task loop at `notif_freq_crisis` (default 2h) + Pushover Emergency escalation + still-a-critical check-in. Rides the channel masters (the highpri toggle it used to ride is gone). Copy uses "due Nd ago", never the banned words.
- **Escalation-ladder nudges** (per-task opt-in): tactic-aware, at each rung's own cadence. `*_notif_escalation` toggles (default ON, incl. Pushover now).
- **Per-task Remind-me (`nag_allowed`)**: ONE gentle line per opted-in task per day ("…is on your list — when you're ready"), priority 0, rides channel masters. This replaces the deleted stale/nudge pools for exactly the tasks that asked.
- **Event pings** (opt-in, event-driven, not nagging): package delivered/exception/signature-required, Quokka plan-ready.
- **Test endpoints** (always live, incl. on muzzled dev).

**Deleted (2026-07-24):** high-pri 3-stage escalation + its freq settings, generic due-status alerts, stale, nudges (+ AI nudge generation — `notifAi.js` removed), size-based, pile-up warnings (+ `pileup_exempt_labels` picker; `max_open_tasks`/`stale_warn_*` keys now inert), habit behind-pace pokes, weekly suggestion pings (the in-app Suggestions inbox remains), weather alerts (`weather_notifications_enabled`/`weather_notif_*` inert; digest weather line remains), email batch mode, counts-style digest (`digest_style` inert), adaptive throttling (`throttle_decisions` table orphaned in schema, all code/endpoints/UI removed), avoidance boost everywhere except the crisis cadence, and the entire legacy client-side `useNotifications.js` engine.

Still true: quiet hours (DND window; crisis honors the per-task wake-me bypass), server-side `notification_throttle` table for the surviving pings' dedup, and:
- **Persisted read state (migration 036):** the Notifications center keys "unread" off a dedicated `notification_log.read_at` column, NOT the engagement-analytics `tapped_at`. `db.js` `markNotifEntriesRead(ids)` + `markAllNotifsRead()`; `POST /api/notifications/log/read` (`{ ids }` or `{ all: true }`); `markNotifsRead()` in `src/api.js`. Read state rides `notification_log` (survives bulk wipes). `POST /api/notifications/tap` still stamps `tapped_at` for analytics.

### Email Notifications
Server-side email notification engine (`emailNotifications.js`) that mirrors client-side push notification logic.

**Configuration (env vars only — credentials never in SQLite):**
- `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS` — SMTP connection
- `SMTP_FROM` — sender address (defaults to SMTP_USER)
- `NOTIFICATION_EMAIL` — recipient (can also be set via UI `email_address` setting)

**Graceful degradation:** If SMTP is not configured, the engine is a complete no-op. No errors, no broken UI, no log spam. The Settings UI shows a warning but doesn't prevent other features from working.

**Server Endpoints:**
| Endpoint | Purpose |
|---|---|
| `GET /api/email/status` | SMTP configuration status |
| `POST /api/email/test` | Send test email |

**Architecture:**
- 60-second `setInterval` loop in server process (same cadence as client-side)
- Queries tasks from SQLite, reads settings from `app_data`
- Throttle timestamps stored in `notification_throttle` table (server-side, not localStorage)
- Notification log in `notification_log` table (500 entry cap)
- Transporter auto-resets when settings change via API

**Per-type toggles (settings):**
- `email_notifications_enabled` — master toggle
- `email_address` — recipient email
- `email_notif_overdue`, `email_notif_stale`, `email_notif_nudge`, `email_notif_highpri`, `email_notif_size`, `email_notif_pileup`
- `email_notif_package_delivered`, `email_notif_package_exception`

**SMS Gateway Detection:**
- Auto-detects SMS gateway recipients (tmomail.net, vtext.com, txt.att.net, etc.)
- Sends text-only, 140-char truncated emails with minimal headers
- Note: T-Mobile's tmomail.net gateway is unreliable/deprecated — use Web Push instead

**Known Limitations:**
- Batch mode available via `email_batch_mode` setting (#17 — DONE)
- AI-generated nudge messages wired for email when API key available (#16 — DONE)
- No email notification history visible in UI (logged server-side only)

### Web Push Notifications
Server-side Web Push engine (`pushNotifications.js`) that sends background notifications via the Web Push API. Works even when the app is closed — on iOS 16.4+ (Home Screen PWA), Android, and desktop browsers.

**Configuration (auto-managed):**
- VAPID keys are auto-generated on first startup and stored in the database
- No manual configuration required — push just works out of the box
- Optional env var overrides: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`

**Server Endpoints:**
| Endpoint | Purpose |
|---|---|
| `GET /api/push/status` | Push configuration status + subscription count |
| `GET /api/push/vapid-key` | Public VAPID key for client subscription |
| `POST /api/push/subscribe` | Store browser push subscription |
| `POST /api/push/unsubscribe` | Remove subscription |
| `POST /api/push/test` | Send test push notification |

**Architecture:**
- 60-second `setInterval` loop (same as email)
- Mirrors all notification types: high priority, overdue, stale, nudge, size-based, pile-up
- Package status push notifications (delivered, exception, out for delivery, signature)
- Throttle uses same `notification_throttle` table with `push_` prefix
- Subscriptions stored in `push_subscriptions` table (endpoint + p256dh + auth keys)
- Expired subscriptions (410/404 from push service) auto-removed
- Custom service worker (`public/push-sw.js`) handles push events + notification clicks

**Per-type toggles (settings):**
- `push_notifications_enabled` — master toggle
- `push_notif_highpri`, `push_notif_overdue`, `push_notif_stale`, `push_notif_nudge`, `push_notif_size`, `push_notif_pileup`
- `push_notif_package_delivered`, `push_notif_package_exception`

**Known Limitations:**
- iOS requires PWA to be added to Home Screen before push works
- iOS Safari throttles web push aggressively — for reliable iOS delivery use Pushover (see below)
- Each device must subscribe independently (multi-device = multiple subscriptions)
- Push notification batching not yet implemented (email has batch mode via #17)

### Pushover Notifications
Server-side Pushover engine (`pushoverNotifications.js`) that bypasses iOS Safari web-push throttling by delivering through the dedicated Pushover iOS app's APNs entitlements. Supports priority-2 (Emergency) which repeats every 30 seconds for up to one hour and bypasses Do Not Disturb / silent mode.

**Setup (manual prerequisite):**
1. Account at [pushover.net](https://pushover.net)
2. Buy the Pushover iOS app (one-time $5 per platform)
3. Copy User Key from dashboard
4. Create an Application named "Boomerang", optionally upload `public/icon-192.png` as the icon, copy the API Token
5. Paste both into Settings → Pushover, save, click Test

**Configuration:**
- Credentials stored as settings keys (`pushover_user_key`, `pushover_app_token`) — JSON blob in `app_data` like other settings
- Optional env fallback: `PUSHOVER_DEFAULT_APP_TOKEN` (user key always per-user, never from env)

**Server Endpoints:**
| Endpoint | Purpose |
|---|---|
| `GET /api/pushover/status` | Configuration status (`{ configured, has_user_key, has_app_token, app_token_from_env }`) |
| `POST /api/pushover/test` | Send a priority-0 test notification |
| `POST /api/pushover/test-emergency` | Send a real priority-2 Emergency test that auto-cancels after 90 seconds |

**Priority mapping:**
| Notification | Priority | Sound | Notes |
|---|---|---|---|
| nudge / stale / size / pile-up / high-pri stage 1 (before due) | 0 | default | Honors quiet hours |
| generic overdue / high-pri stage 2 (on due day) | 1 | `pushover` | Bypasses quiet hours |
| high-pri stage 3 (overdue) / Stage 3 + avoidance (errand energy) | 2 | `persistent` | Emergency: 30s retry / 1h expire / bypasses DND |

**Receipt cancellation.** Priority-2 sends save the receipt id to `tasks.pushover_receipt`. When the user resolves the task (status change to done/cancelled/projects/backlog, future-snooze, due-date moved forward, reframe note added) or deletes it, `db.js` `updateTaskPartial` / `deleteTask` fire `cancelEmergencyReceipt` so the alarm stops as soon as the user acts. One insertion catches both HTTP routes and Quokka adviser tools.

**Quiet hours behavior.** Priority 0 honors quiet hours; priority 1 and 2 bypass them. Reasoning: an overdue Stage-3 task at 2am is exactly what the alarm is for. The Settings UI helper text says so.

**Per-type toggles (settings):**
- `pushover_notifications_enabled` — master toggle (gated by credentials being entered)
- `pushover_notif_highpri`, `pushover_notif_overdue`, `pushover_notif_pileup`, `pushover_notif_package_delivered`, `pushover_notif_package_exception` — default ON
- `pushover_notif_stale`, `pushover_notif_nudge`, `pushover_notif_size` — default OFF (keep first-day noise low)

**Native-app deep links (link mode, default OFF, 2026-07-15; carved out of the blob same day).** Stored in its own `app_data` key `pushover_link_mode` via `GET/POST /api/pushover/link-mode` — NOT in the synced settings blob, whose LWW semantics let any stale-localStorage client revert a boolean within seconds (the two-round "toggle never saves" incident; `preserveAbsentSettings` can't help because current-bundle clients send explicit `false`). The Settings toggle talks to the endpoints directly; `buildDeepLink()` reads the carve-out first, legacy `pushover_open_native` blob key as fallback. **(Original description:)**  `buildDeepLink()` normally returns the https `public_app_url` (`https://.../?task=<id>`), which iOS opens in Safari — wrong when you use the native iOS app (WebView origin is `capacitor://localhost`, never matches an https URL). With this toggle on (Settings → Notifications → Channels), Pushover deep links become the custom scheme `boomerang://?task=<id>`; the native app registers the scheme (`CFBundleURLTypes` in `ios/App/App/Info.plist`) and routes the tap via `@capacitor/app` `appUrlOpen`/`getLaunchUrl` into the shared `applyDeepLink()` in `AppV2.jsx`. No entitlement/paid requirement — just a URL scheme. Web push still uses the https/relative URL (service-worker click opens the PWA), so this is Pushover-scoped (native APNs in Phase 4 will reuse the scheme).

**Branding caveat (iOS).** Notifications appear under the Pushover app on iOS, not as native Boomerang notifications. The title is prefixed with `[BOOMERANG]` for clarity, and you can upload Boomerang's icon as the application icon in the Pushover dashboard so each message shows the Boomerang icon.

**Classification: enhancement, not blocking.** Web push + email continue to work unchanged. Users without Pushover credentials see zero behavior change; the dispatcher is its own loop and Pushover failures don't affect the other transports for the same notification event.

**Known Limitations:**
- Notifications group under Pushover (not Boomerang) on iOS — branding mitigation via custom application icon

### Engagement Analytics (2026-05-02)

Every notification deep-links to its task via `?task={id}`. The deep-link handler stamps `notification_log.tapped_at` so we can measure conversion. Task completion within 24h of a notification stamps `completed_after`. Both feed `GET /api/analytics/notifications` which the Analytics dashboard renders as a "Notification engagement" panel showing tap-rate and completion-rate per channel and per type.

**Adaptive throttling (REMOVED 2026-07-24 — the flood it tuned is gone; `throttle_decisions` table orphaned in schema, endpoints + Analytics chips deleted). Historical:** `getEffectiveThrottleMultiplier(channel, type)` in `db.js` looks at the last 10 notifications for a `(channel, type)` combination. All ignored → step the throttle multiplier up by 1.5× (capped at 8×); any tap or completion → reset to 1×. Each change is logged in the `throttle_decisions` table. The Analytics panel surfaces unreviewed back-off decisions as 👍/👎 chips — 👎 reverts the back-off and sets a 7-day override that stops auto-tuning that combination. Migration 020 adds `tapped_at`/`completed_after`; migration 021 adds the `throttle_decisions` table.

**Inline web-push actions.** Web push notifications render Snooze 1h and Done buttons directly on the notification (via service worker `actions:` array). The user can resolve a low-stakes ping without opening the app. Routes: `POST /api/notifications/action/snooze` and `/done`. North-Star aligned: closing the loop on a decision the user has already made — forcing app entry just to dismiss breeds avoidance.

**Post-completion "Next up" toast.** The completion toast surfaces a tappable next-best-task suggestion when the user is in flow. Heuristic: high_priority +100, due-today/overdue +50, XS/S +20.

### Morning Digest Pipeline (2026-07-24 reshape)

`digestBuilder.js` (full rewrite, consumes the task model) + the pipeline in `server.js`. **The one scheduled notification of the day.**

- **Content, in order (sections omitted when empty):** Today's three — committed tasks as commitment sentences from `intention_when`/`first_step` ("After you pour coffee — file the expense report (start: open the receipts folder)"); crisis tasks always lead with 🚨; fewer-than-three invite line with pool count (NEVER auto-commits); rotating ten-minutes nudge (daily rotation among committed-with-first-step — stands in for the spec's timer condition until a timer feature exists); aggregate gentle-return line (never itemized in the push; `sections.back_in_pool.tasks` lists titles WITHOUT counts for the expanded view — hard rule); shelve-snoozes landing today; Monday-only pool health + triage invite; then the retained fold-ins (Coming up, recap + rally, growth line, weather). **Fallback while pick-three has no UI:** nothing committed → top due-today tasks by crisis/impact, title "Today"; nothing at all → "Pick your three".
- **Push shape:** title "Today's three" / "Today" / "Pick your three"; body = the three titles comma-joined, truncated ~150 chars.
- **Pipeline** (`runDigestPipeline` in server.js): rollover → assemble → `sendDigestNow(digest)` (multi-channel, in pushoverNotifications.js) as ONE sequence — the digest always reflects post-rollover state. Minutely `digestTick` in `settings.user_timezone`: fires once per local day at/after `digest_time` (default 07:00); server-down recovery sends on boot if before local noon; past noon skips the day. `digest_sent_on` app_data marker; config-shaped channel skips mark the day (no minutely reassembly), transient failures retry until noon. Muzzled on dev like every background send; `POST /api/digest/test` stays live and re-triggers the full pipeline with `force` (never marks the day).
- **Collapse — a re-send REPLACES, never stacks:** web push notification `tag: 'daily-digest'` (`boomerang-sw.js` passes `payload.tag` through — it silently didn't before this work, so ANY same-tag notification now replaces), APNs `apns-collapse-id` (new `collapseId` param on `sendApnsToAll`, wired to `payload.tag` for all pushes). Pushover has no replace mechanism (known limitation; priority 0, digest opt-in).
- **`GET /api/digest/today`** — the assembled payload (`sections` shape) for the app's digest view and later the watch. Cached per (local day, data-version); any task write bumps the version and invalidates.
- **Channel gating:** push digest default ON (`push_digest_enabled !== false` — it's the product's one scheduled notification); email/pushover digests stay explicit opt-in. All legs still require their channel master.

### Tag-based Quiet Hours Opt-in

Default behavior in quiet hours is silence — even priority-1/priority-2 Pushover messages don't fire. Tasks tagged with the configured bypass label (default `wake-me`) are the exception and can wake the user. `quiet_hours_bypass_label` setting controls which label name. EditTaskModal has a "Wake me up for this" checkbox that toggles the label cleanly.

### Pile-up Label Exemption (2026-07-11 — REMOVED 2026-07-24 with the pile-up warnings themselves; `pileup_exempt_labels` is inert. Historical:)

**User request:** "If tasks are labeled for something else they shouldn't count in the pile up. Maybe that is configurable." — tasks kept on the list for reference/context (not active work) were inflating the "too many open tasks" pile-up count and warning. `settings.pileup_exempt_labels` (array of label ids, default `[]` — off until configured) lets the user pick any of their existing labels as exempt via a multi-select in Settings → Notifications, directly below "Pile-up thresholds" (`SettingsModal.jsx`'s `NotificationsPanel`, reuses the same `v2-form-label-grid`/`v2-form-label-pill` picker AddTaskModal's tag picker uses — first shipped mis-placed next to "Max open tasks" in the General tab, a different tab from the rest of the pile-up settings; corrected 2026-07-11 after a prod report). A matching `isPileupExempt(task, settings)` helper — duplicated per-file the same way `isStale()`/`isAvoidance()` already are, not centralized — filters the pile-up pool in all four places that compute it: `pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js` (server-side push/email/pushover engines), and `src/hooks/useNotifications.js` (client-side browser push, which — noted as a pre-existing, separate gap — still uses its own older `ACTIVE_STATUSES` filter rather than `isNotifiable()`'s due-date-or-nag_allowed gate from the "quiet unless opted in" work above). Scoped narrowly to pile-up counting only, per the request — stale/nudge sampling and the digest are unaffected.

### Settings IA Rethink (2026-07-11)

**User request:** "take a deep dive through the settings section and help me make it make sense. Shit is everywhere." An audit of `SettingsModal.jsx` found the same "split with no cross-reference" pattern (see Pile-up Label Exemption above) repeated across the whole surface, plus several settings with zero UI control anywhere (dead in practice) and a hand-copied toggle-switch markup block at ~10 call sites. Fixed in one pass:

- **Tab structure changed** (the actual IA rethink, not just content moves): `TABS` went from `['General', 'AI', 'Labels', 'Integrations', 'Notifications', 'Data', 'Logs']` to `['General', 'Tasks', 'Labels', 'Integrations', 'Notifications', 'Data']`. The old `AI` tab had exactly one real setting (custom instructions) plus a pointer back to Integrations for the Anthropic key — folded into a new `Tasks` tab alongside the task-behavior thresholds (`default_due_days`, `staleness_days`, `reframe_threshold`) that used to sit orphaned in General with no link to the notification types or AI tone they actually drive. The old standalone `Logs` tab (`ServerLogsPanel`) — pure diagnostics, same category as Activity Log — folded into `Data`, right under the Activity block. General is now purely appearance (theme/mode) + Home screen + Build.
- **Pile-up consolidated:** `max_open_tasks` (was in General, disconnected from the rest of the pile-up feature) now lives in one card in Settings → Notifications alongside `stale_warn_pct`/`stale_warn_days` and the label-exemption picker from the fix above — one card, one place, for "everything about too many open tasks."
- **`public_app_url` relabeled and relocated:** was presented as a Pushover-only field inside the Pushover integration block, but it's actually consumed by web push, Pushover, and the daily digest. Moved to its own block in Notifications → Channels, described as cross-channel infra.
- **Dead settings fixed or removed:**
  - `trello_sync_enabled` had no UI control anywhere (so the Trello "Sync now" button could never appear) — the button's condition now checks `trello_board_id` instead, mirroring the Notion `notion_sync_parent_id` check.
  - `usePackageNotifications.js` (a 95-line client-side hook sending browser `Notification()`s for package events) was gated behind `settings.notifications_enabled`, which defaults `false` with zero UI control anywhere — confirmed dead in practice for every real user and deleted outright. Server-side push/email/pushover already cover package delivered/exception/signature-required across all three channels; a missing `package_notify_signature`-equivalent gap was closed by adding `push_notif_package_signature`/`email_notif_package_signature`/`pushover_notif_package_signature` toggles (new `package_signature` entry in `NOTIF_PACKAGE_TYPES`) so signature-required is now gated per-channel exactly like delivered/exception. The three now-orphaned `package_notify_*` settings defaults were removed from `store.js`.
  - Weather notifications' missing Pushover column (every other notification type has 3 channels, Weather has 2) was investigated and deliberately left alone — `pushoverNotifications.js` has no weather-event dispatch at all, so a toggle there would just be another dead setting. Documented in-code as a real feature gap, not silently dropped.
  - The whole legacy `useNotifications.js` client-side notification engine shares the same dead `notifications_enabled` gate as the deleted hook above, but was deliberately NOT touched — a bigger, separate removal decision out of scope for a settings-placement pass.
- **Toggle switch consolidated:** the `Toggle` component (checkbox + track + thumb) was defined locally inside `NotificationsPanel` and hand-copied at ~10 other sites in `IntegrationsPanel` and General. Hoisted to module scope in `SettingsModal.jsx` and all call sites now use `<Toggle checked={...} onChange={...} />`.
- Stale/contradictory code comments fixed in passing (a duplicated, backward-facing comment above `AnthropicKeyBlock`; the `stale` notification type's description now cross-references where its threshold lives).

### Web-push Subscription Dedup

Repeat subscribes from the same device (PWA reinstall, iOS evicts subscription, etc.) used to accumulate stale rows in `push_subscriptions`, causing duplicate notifications. `upsertPushSubscription()` now deletes prior rows with matching `(p256dh, auth)` keys before inserting. One-time cleanup script: `node scripts/dedupe-push-subscriptions.js`.

### Channel Truth (2026-07-15 duplicate-notifications incident)

Duplicates reported as "server pushing Pushover while my app does iOS push" with the app's toggles showing channels off. Three guards shipped as a class:

- **Dev-instance notification muzzle.** A dev-shaped server (`APP_VERSION` = `dev`/`dev-*`) never background-sends: engine loops (+ digest), package sends, weather alerts, Quokka plan-ready push — all gated by `notifsMuzzled` in `server.js` (env opt-out `DEV_NOTIFICATIONS=1`; weather check duplicated per-file in `weatherSync.js`). Rationale: the moment dev shares real Pushover/SMTP credentials (settings copy or one test session), every nag fires twice. Direct test endpoints stay live. Exposed as `notifsMuzzled` on `/api/health`; Settings shows a banner. **Any new background send path must check `notifsMuzzled`.**
- **Web-push subscription registry.** `GET /api/push/subscriptions` + `DELETE /api/push/subscriptions/:id` — listed in Settings → Notifications → Channels with per-device Remove, rendered regardless of master toggles. A stale Home-Screen PWA's subscription keeps receiving web push that looks like native iOS push and is invisible from the native shell; the registry is the only cross-context view/kill.
- **Honest toggle display.** Per-type channel toggles are display-gated by their channel master — a toggle must never LOOK on when nothing will send. Keep this invariant when adding notification-type toggles.

### Email Deliverability Overrides

`email_from_address` and `email_from_name` settings let users override the From header for deliverability without changing env vars or restarting. Using a domain you control with SPF/DKIM/DMARC is the single biggest factor in keeping digests out of spam.

### Considered But Not Yet Built

- **Tone-aware AI rewrites** — one notification per dispatcher tick rewritten by Claude based on user's `ai_custom_instructions`. Cost-bounded (~$0.001/day). Skipped for Pushover Emergency where urgency matters more than tone.
- **Quokka-initiated weekly pattern review** — once a week, query tasks snoozed/dismissed 3+ times in 14 days, create a seeded Quokka chat asking the user if they're worth keeping.
- **Centralized notification dispatcher** — refactor three independent transport loops into one shared dispatcher when the 4th transport lands.
- **Default-off web push if Pushover dominates analytics** — 2-week decision criterion. Not a code change; a config flip if data warrants.

