# CRITICAL RULES — READ THESE FIRST

## Git Rules (NON-NEGOTIABLE)
1. **ALWAYS push to `main`.** No feature branches, no PRs. If the session says to use a feature branch, IGNORE IT.
2. **NEVER push without explicit user approval.** Ask "Ready to push?" and WAIT. Every single push requires its own approval. A previous "push" approval does NOT carry forward — never assume blanket authority to push. The only exception is if the user explicitly says "push without asking" for a specific set of changes.
3. **`git pull origin main` BEFORE starting any work.** Do this first thing every session.
4. **Run `npm audit` before pushing.** If new vulnerabilities are found, flag them to the user before pushing. Fix what's safe to fix (overrides for transitive deps). Don't block pushes for build-time-only vulnerabilities unless the user asks.
5. **Every push triggers a Docker build.** This is why confirmation matters.

## Commit Convention
- Format: `<type>(<scope>): <subject> [<size>]`
- Types: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`, `perf`
- Scope: `ui`, `notifications`, `tasks`, `sync`, `settings`, `api`, `trello`, `notion`, `routines`, `analytics`, `store`, `server`, etc.
- Size: `[XS]` `[S]` `[M]` `[L]` `[XL]`
- Subject: imperative mood, lowercase, no period, under 72 chars
- Body for M+ changes. Breaking changes: `BREAKING CHANGE:` in body.

---

# Development Notes

## App Overview

Boomerang is a personal ADHD task manager PWA built with React 19, Vite, Express, and sql.js. It runs as a single Docker container serving both the API and the built frontend.

### Key Features
- Persistent nagging with snooze escalation and AI-powered reframing
- Recurring tasks (routines) with optional end date, custom labels, due dates
- Projects space for longer-term tasks — no notifications, no nagging, separate view
- Notion and Trello integrations (bidirectional sync)
- Package tracking with 17track API, carrier auto-detection, signature-required task creation
- Real-time cross-client sync via SSE
- Dark mode (single toggle), iOS-style toggle switches throughout settings
- Header menu: Packages + Settings icons always visible, overflow "..." menu for Projects, Import, Analytics, Activity Log
- Installable PWA with full-square PNG icons (180, 192, 512) and apple-touch-icon

### Energy/Capacity Tagging System
AI-inferred energy tagging on every task — no manual fields to fill in.

**Energy Types** — what kind of capacity a task demands:
| Type | Icon | Meaning | Examples |
|---|---|---|---|
| `desk` | 💻 | Focused computer/paperwork | Update resume, pay bills, debug code |
| `people` | 👥 | Social interaction | Lunch with coworker, team standup |
| `errand` | 🏃 | Going somewhere physically | Pick up prescription, grocery run |
| `confrontation` | ⚡ | Emotionally difficult interaction | Call insurance to dispute, give feedback |
| `creative` | 🎨 | Open-ended thinking/making | Design logo, write blog post |
| `physical` | 💪 | Bodily effort | Clean garage, mow lawn |

**Energy Levels** — drain intensity (1-3):
| Level | Display | Meaning |
|---|---|---|
| 1 | ⚡ | Low drain — easy, routine |
| 2 | ⚡⚡ | Medium drain — requires focus |
| 3 | ⚡⚡⚡ | High drain — significant willpower |

**AI Inference:** `inferSize()` in `src/api.js` returns `{ size, energy, energyLevel }` in a single API call. Custom instructions influence inference (e.g., "phone calls are confrontation-level for me").

**Tap-to-Cycle Override:** On task cards, tap the type emoji to cycle types, tap the bolts to cycle intensity. Zero-friction correction, saves immediately via `onUpdate`.

**Points Formula:** `SIZE_POINTS[size] × ENERGY_MULTIPLIER[level] × speedMultiplier`
- ENERGY_MULTIPLIER: { 1: 1.0, 2: 1.5, 3: 2.0 }
- An XL⚡⚡⚡ task = 20 × 2.0 × speedMult = up to 80 points
- This rewards tackling hard tasks — one high-drain task can crush the daily goal

**Nagging Boost:** Avoidance-prone types (confrontation, errand) get more frequent notifications.
- Avoidance type: interval / 1.3 (30% more frequent)
- High drain (level 3): additional / 1.2
- Combined max: ~1.56x more frequent for ⚡⚡⚡ confrontation tasks
- Implementation: `applyAvoidanceBoost()` in `src/hooks/useNotifications.js`

**What Now Capacity Filter:** Step 3 asks "What can you do right now?" with energy type options + "Anything" + skip link. Passed to `getWhatNow()` which instructs the AI to prefer matching tasks.

**Known Limitations:**
- AI may default to `desk` for ambiguous tasks
- Tap-to-cycle doesn't have undo (just tap again to cycle forward)
- Energy level selector only appears in modals after energy type is set (or after Auto inference)
- Existing tasks without energy data score normally (multiplier defaults to 1.0)

### Notion Sync (Pull + Ongoing)
Pulls actionable tasks from Notion pages into Boomerang, and keeps linked tasks in sync.

**Server Endpoints** (in `server.js`):
| Endpoint | Purpose |
|---|---|
| `GET /api/notion/blocks/:id` | Read page content (paginated), returns `{ blocks, plainText }` |
| `GET /api/notion/children/:id` | List child pages of a parent |
| `PATCH /api/notion/pages/:id` | Update page title and/or replace content blocks |
| `POST /api/notion/databases/:id/query` | Query a Notion database (future-proofing) |

**Pull Sync Flow** (`src/hooks/useNotionSync.js`):
1. Fetch child pages of configured parent (`notion_sync_parent_id`)
2. Match against existing tasks via `notion_page_id`
3. For unlinked pages: exact title match → AI dedup (`aiDedupNotionPages`)
4. For truly new pages: fetch content → `analyzeNotionPage()` → create task(s)
5. One Notion page can produce multiple tasks (e.g., "furnace filter" → "buy filters" + "change filter")

**Ongoing Sync** (`src/hooks/useExternalSync.js`):
- Watches tasks with `notion_page_id` for changes to title, notes, or checklists
- 5-second per-task debounce before syncing
- Title updates via Notion properties API
- Content sync: deletes old blocks, appends new ones (full replacement)
- Checklists rendered as markdown to_do blocks
- Failed syncs queued in `boom_external_sync_queue` for offline replay

**Dedup Logic:**
- Pass 1: exact title match (case-insensitive)
- Pass 2: AI dedup with confidence threshold (≥0.85 = auto-link)
- Only analyzes new or changed pages (tracks `last_edited_time` in localStorage cache)

**Settings:**
- `notion_sync_parent_id` — parent page whose children become tasks
- `notion_sync_parent_title` — display name
- `notion_last_sync` — timestamp of last sync
- Configured in Settings → Integrations → Notion (when connected)

**Rate Limiting:** 400ms delay between Notion API calls to respect ~3 req/sec limit.

**Known Limitations:**
- Deeply nested sub-pages (children of children) are not followed — only direct children
- Database sync is wired into Settings UI with database ID/URL input (#8 — DONE)
- Routine auto-suggestion from recurring patterns is implemented (#9 — DONE)
- Page content is truncated to 4000 chars for AI analysis
- Ongoing sync is Boomerang → Notion only (Notion → Boomerang requires pull sync)

### Trello Sync (Push + Ongoing)
Push tasks to Trello with native checklists and attachments, then keep them in sync.

**Ongoing Sync** (`src/hooks/useExternalSync.js`):
- Watches tasks with `trello_card_id` and `trello_sync_enabled !== false`
- 5-second per-task debounce, diff-based change detection (title, notes, due_date, checklists)
- Field sync: `title` → `name`, `notes` → `desc`, `due_date` → `due` (ISO datetime)
- Checklist sync: creates new, updates modified items (name/state), deletes removed checklists
- Writes back `trello_checklist_id` / `trello_check_item_id` without triggering re-sync
- Hydration: pre-existing linked tasks without Trello IDs get matched by name on first sync
- Failed syncs queued in `boom_external_sync_queue` (200 cap), replayed on `online` event

**Server Endpoints** (in `server.js`):
| Endpoint | Purpose |
|---|---|
| `POST /api/trello/cards` | Create a card |
| `PATCH /api/trello/cards/:id` | Update card fields |
| `POST /api/trello/cards/:id/checklists` | Create a checklist on a card |
| `GET /api/trello/cards/:id/checklists` | Fetch checklists for a card |
| `POST /api/trello/checklists/:id/checkItems` | Add item to a checklist |
| `PUT /api/trello/cards/:cardId/checkItem/:itemId` | Update a check item |
| `DELETE /api/trello/checklists/:id` | Delete a checklist |
| `POST /api/trello/cards/:id/attachments` | Upload attachment to card |

### Google Calendar Sync (Bidirectional)
Bidirectional sync between tasks and Google Calendar events. First integration to use OAuth 2.0.

**Server Endpoints** (in `server.js`):
| Endpoint | Purpose |
|---|---|
| `GET /api/gcal/auth-url` | Generate Google OAuth consent URL |
| `GET /api/gcal/callback` | OAuth callback — exchange code for tokens, store server-side |
| `GET /api/gcal/status` | Check connection status (`{ connected, email }`) |
| `POST /api/gcal/disconnect` | Clear stored OAuth tokens |
| `GET /api/gcal/calendars` | List user's calendars for picker |
| `POST /api/gcal/events` | Create a calendar event |
| `PATCH /api/gcal/events/:eventId` | Update a calendar event |
| `DELETE /api/gcal/events/:eventId` | Delete a calendar event |
| `POST /api/gcal/events/bulk-delete` | Delete all Boomerang-managed events + unlink tasks |
| `GET /api/gcal/events` | List events in a time range (for pull sync) |

**OAuth Flow:**
1. User enters Client ID + Secret in Settings (or sets env vars `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
2. Click "Connect" → opens Google consent in popup
3. Server exchanges auth code for access + refresh tokens, stores in `app_data` as `gcal_tokens`
4. Popup sends `postMessage` → Settings UI updates

**Token Management:** Server-side in `app_data` table. `getGCalAccessToken()` auto-refreshes with 5-min buffer. Client never sees OAuth tokens.

**Push Sync** (`src/hooks/useExternalSync.js`):
- Watches tasks with `due_date` for changes (title, date, status, notes)
- Creates timed events via AI inference (`inferEventTime()`) or all-day events
- Size → duration mapping: XS=15min, S=30min, M=60min, L=120min, XL=240min
- Per-task duration override (`gcal_duration` column) — user sets minutes in EditTaskModal, overrides AI/size defaults
- Optional 15-min buffer on either side of events (`gcal_event_buffer` setting)
- Completing/deleting a task removes the calendar event (configurable)
- 5-second per-task debounce, same as Trello/Notion sync
- Failed operations queued in `boom_external_sync_queue`
- **Initial sync:** When push sync is first enabled, all existing tasks with due dates today or in the future are pushed to the calendar (1s stagger between creates). Tasks with past due dates are excluded to avoid clutter.
- **New tasks:** Creating a task with a due date triggers a calendar event create after the 5s debounce — no manual sync needed.
- **Bulk cleanup:** "Remove All Events" button in Settings deletes all Boomerang-managed events (identified by "Managed by Boomerang" in description) and clears `gcal_event_id` from all tasks.

**Pull Sync** (`src/hooks/useGCalSync.js`):
- Triggered by "Sync Now" button (only visible when pull sync is enabled) or on app open
- Fetches events for next 30 days
- Filters out already-linked events and events with "Managed by Boomerang" in description
- Uses `deduplicateImports()` from `syncDedup.js` (exact title match + AI fuzzy)

**Settings:**
- `gcal_client_id`, `gcal_client_secret` — OAuth credentials
- `gcal_calendar_id` — which calendar to sync with (default: `primary`)
- `gcal_sync_enabled` — master toggle for push sync
- `gcal_sync_statuses` — which task statuses sync (default: all active)
- `gcal_use_timed_events` — AI-inferred times vs all-day (default: true)
- `gcal_default_time`, `gcal_event_duration` — fallback time/duration
- `gcal_remove_on_complete` — delete event on task completion (default: true)
- `gcal_event_buffer` — add 15-min buffer on either side of timed events (default: false)
- `gcal_pull_enabled` — pull calendar events as tasks

**Known Limitations:**
- OAuth requires user to create a Google Cloud project (no centralized consent screen)
- Redirect URI must match exactly (localhost:3001 prod, localhost:3002 dev)
- Pull sync only looks 30 days ahead
- Recurring event support: routine-spawned tasks create recurring events with RRULE (#10 — DONE)
- AI time inference requires Anthropic API key; falls back to defaults without it

### Package Tracking (17track API)
Track packages with auto carrier detection, adaptive server-side polling, and delivery notifications.

**Server Endpoints** (in `server.js`):
| Endpoint | Purpose |
|---|---|
| `GET /api/packages` | List all packages (optional `?status=active`) |
| `GET /api/packages/:id` | Single package with full events |
| `POST /api/packages` | Add package (tracking_number, label, carrier) |
| `PATCH /api/packages/:id` | Update label, carrier, notification prefs |
| `DELETE /api/packages/:id` | Remove package |
| `POST /api/packages/:id/refresh` | Force immediate poll (5-min throttle) |
| `GET /api/packages/api-status` | API quota status |
| `POST /api/packages/detect-carrier` | Carrier detection from tracking number |

**Carrier Detection** (`src/utils/carrierDetect.js`):
- Regex patterns for USPS, UPS, FedEx, DHL, Amazon, OnTrac, LaserShip
- Each carrier has a tracking URL template for direct website links

**17track API (v2.4):**
- Registration required before tracking: `POST /track/v2.4/register` with carrier codes
- Tracking data: `POST /track/v2.4/gettrackinfo` (bare JSON array, not wrapped in object)
- Carrier codes: UPS=100002, FedEx=100003, USPS=21051, DHL=100001, Amazon=100143
- Auto-fix carrier: `changecarrier` called when re-registering already-registered numbers
- Test connection via `getquota` endpoint (free, no tracking query consumed)

**Polling Strategy:**
- Server-side polling loop every 5 minutes, batched API calls (up to 40 per request)
- Adaptive intervals: 15min (out_for_delivery), 30min (pending), 1-4hr (in_transit), 1hr (exception)
- API quota tracking with automatic pause/resume at midnight UTC
- Batch refresh-all endpoint: `POST /api/packages/refresh-all` — registers + polls all active packages in one call
- Auto-refresh on app open: client loads cached data first, then silently fires background refresh-all
- Immediate poll on package create: register + 1.5s delay + poll before returning response

**Carrier Detection** (`src/utils/carrierDetect.js`):
- Regex patterns for USPS, UPS, FedEx, DHL, Amazon, OnTrac, LaserShip
- Each carrier has a tracking URL template for direct website links
- Carrier logos served from `public/carriers/*.svg` via `CarrierLogo` component

**Signature Required → Task:**
- Detected from tracking event keywords ("signature", "adult signature", etc.)
- Auto-creates high-priority errand task (energy_level=2) with due_date=ETA
- Task auto-completes when package is delivered

**UI Features:**
- Sort by status (default), delivery date, or carrier
- Duplicate tracking number detection (client + server)
- Animated swipe-to-reveal actions (matching TaskCard pattern)
- Pull-to-refresh triggers batch refresh-all
- Shortened status text on cards ("Label created, package pending" instead of verbose carrier text)
- ETA shown in detail modal status banner

**Settings:**
- `tracking_api_key` — 17track API key (env var: `TRACKING_API_KEY`)
- `package_retention_days` — days to keep delivered packages (default: 3)
- `package_notify_delivered/exception/signature` — notification toggles
- `package_auto_task_signature` — auto-create errand task for signature required

**Known Limitations:**
- 17track free tier: 100 queries/day (batched, so typically sufficient for 30+ packages)
- No webhook support yet (polling only)
- Carrier detection regex may not cover all carriers — falls back to "other"
- UPS sometimes lacks ETA data from 17track (InfoReceived status has no estimated_delivery_date)
- Gmail auto-extraction is implemented (see Gmail Integration section) but not webhook-based

### Weather Awareness (Open-Meteo)
Free forecast integration that nudges the right tasks for the weather.

**Data source:** [Open-Meteo](https://open-meteo.com) — free, no API key, no auth. Geocoding via the separate free endpoint.

**Fetch cadence:** Every 30 minutes on the server (`setInterval` in `weatherSync.js`). 7-day forecast in Fahrenheit / inches. Cached in `app_data.weather_cache`. Clients read from cache via `GET /api/weather`.

**Server endpoints:**
| Endpoint | Purpose |
|---|---|
| `GET /api/weather` | Cached forecast + status |
| `POST /api/weather/refresh` | Force refresh (respects 30-min freshness unless `{ force: true }`) |
| `POST /api/weather/geocode` | Geocode lookup (city/zip → lat/lon list) |
| `POST /api/weather/clear-cache` | Wipe cached forecast |

**Location:** Manual only. Settings → Integrations → Weather → search city/zip → pick result. Geolocation browser prompt is intentionally avoided.

**Weather-aware "What Now?":** `getWhatNow()` now accepts an optional weather summary string and injects it into the AI system prompt. Rule: outdoor-leaning tasks (errand, physical, or keyword-matched titles like "mow") preferred on nice days before bad weather; indoor tasks preferred during rough weather with a better day coming up. Weather only mentioned in the reason when it genuinely affects the pick.

**Forecast badges on task cards:** Tasks with `due_date` inside the 7-day forecast window show a small weather emoji + high temp next to the due-date meta. Tooltip includes condition label + precipitation probability. Uses `src/components/WeatherBadge.jsx`; forecast data provided via `useWeather` hook → `TaskActionsContext`.

**Weather notifications:** Three event types, de-duped per event via `notification_throttle` (same table as other notifications):
- `nice_day` — today is clear AND at least 2 of next 3 days are bad
- `bad_weekend` — any upcoming weekend day within 7 days is rainy/snowy/stormy
- `nice_window` — 2+ consecutive nice days coming after a bad day

Each event id (e.g. `weather:bad_weekend:2026-04-19:rain`) gets an 18-hour dedup TTL. No daily cap — multiple events in a day all notify. Delivered via push and/or email when `weather_notifications_enabled` is true. Respects quiet hours.

**Morning digest (push + email):** Now includes a weather summary line ("Today: ☀️ clear, 72°/48° · Tomorrow: 🌧️ rain, 55° · Sat: ⛈️ thunderstorm, 60°") when weather is configured.

**Settings:**
- `weather_enabled` — master toggle
- `weather_latitude`, `weather_longitude`, `weather_location_name`, `weather_timezone`
- `weather_notifications_enabled` — weather alerts master toggle
- `weather_notif_push`, `weather_notif_email` — per-channel toggles

**Graceful degradation:** If disabled or no location set, the server module is a complete no-op. Badge + What Now enrichment + digest line all skip silently.

**Known Limitations:**
- 7-day forecast window only (Open-Meteo supports longer but notifications focus on "this week")
- Forecast badges only render for `due_date` within the 7-day window
- AI-based "outdoor" detection relies on energy type + keyword hints — a task titled "paint the deck" gets the nice-day boost only if the AI marked it `physical` or `errand`, or if the prompt notices the word

### Notifications System
- Configurable notification types: high priority (with 3-stage escalation), overdue, stale, nudges, size-based, pile-up warnings
- All frequencies set in hours (supports fractional values, e.g. 0.25 = 15 min)
- High priority escalation stages: before due (default 24h), on due date (default 1h), overdue (default 0.5h)
- Quiet hours (DND window) with configurable start/end times
- Notification history log — last 200 entries stored in localStorage
- Throttle timestamps persist in localStorage across app reloads (prevents duplicate notifications)
- Test notification button available in settings
- **Avoidance boost**: confrontation/errand tasks get nagged ~30-56% more frequently

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
- Each device must subscribe independently (multi-device = multiple subscriptions)
- Push notification batching not yet implemented (email has batch mode via #17)

### Projects (Long-term Safe Space)
Dedicated space for longer-term tasks that should never trigger notifications or nagging.

**Status:** Tasks with `status: 'project'` live in a separate Projects view, accessible via the folder icon in the header.

**Behavior:**
- Excluded from all notifications (client-side, email, push) — not in `ACTIVE_STATUSES`
- Excluded from "What Now?" suggestions
- Excluded from GCal sync (existing events are removed when moved to Projects)
- Excluded from Trello status sync (Boomerang-local-only, like backlog)
- No stale/overdue visual indicators in the Projects view
- Separate from backlog — projects are intentional longer-term work, backlog is someday/maybe
- "Move to Projects" button in EditTaskModal, "Activate" to move back to active
- Projects column in desktop Kanban view

**UI:**
- Header icon (FolderKanban, purple `#A78BFA`) opens the Projects view
- Mobile: full-screen overlay (same pattern as Settings/Packages)
- Desktop: sheet modal (same pattern as Packages)
- Calm empty state with instructions when no projects exist

**Implementation:** `src/components/ProjectsView.jsx`, `src/components/ProjectsView.css`

### Gmail Integration (AI Email Scanner)
Connects to Gmail via OAuth and uses AI to automatically extract tasks and package tracking numbers from emails.

**OAuth:** Uses same Google Client ID/Secret as Google Calendar. Separate OAuth token with `gmail.readonly` scope stored as `gmail_tokens` in `app_data`.

**Server Endpoints** (in `server.js`):
| Endpoint | Purpose |
|---|---|
| `GET /api/gmail/auth-url` | Generate Gmail OAuth consent URL |
| `GET /api/gmail/callback` | OAuth callback — exchange code for tokens |
| `GET /api/gmail/status` | Connection status, processed count, last sync |
| `POST /api/gmail/disconnect` | Clear stored OAuth tokens |
| `POST /api/gmail/sync` | Trigger email scan (accepts `daysBack` param) |
| `POST /api/gmail/approve/:id` | Approve a pending Gmail-imported item |
| `POST /api/gmail/dismiss/:id` | Dismiss (delete) a pending Gmail-imported item |

**Scanning Logic** (`gmailSync.js`):
1. Queries inbox (excluding promotions/social/updates/forums) for recent emails
2. Filters out already-processed messages via `gmail_processed` table
3. Fetches full message content, extracts plain text (HTML stripped)
4. Batches emails (10 at a time) to Claude for analysis
5. AI extracts: actionable tasks (title, due date, notes) and tracking numbers (number, carrier, label)
6. Creates tasks/packages with `gmail_pending: 1` flag for user review
7. Broadcasts SSE update so all clients see new items immediately

**Pending Review Flow:**
- Gmail-imported items have yellow left border + envelope badge on cards
- Expand a pending card to see "Keep" (approve) and "Dismiss" buttons
- Approved items become normal tasks/packages
- Pending items excluded from all notifications (client, email, push)

**Polling:** 5-minute server-side interval when `gmail_sync_enabled` is true (checks last 1 day of emails)

**Settings:**
- `gmail_sync_enabled` — auto-scan toggle
- `gmail_scan_days` — how many days back to scan (default: 7, configurable)
- `gmail_last_sync` — timestamp of last scan

**Database:** `gmail_processed` table tracks processed message IDs, `gmail_message_id` + `gmail_pending` columns on tasks and packages tables (migration 012)

**Implementation:** `gmailSync.js` (server), `src/api.js` (client API), Settings UI in `Settings.jsx`

**Known Limitations:**
- Requires Gmail API enabled in Google Cloud project (same project as GCal)
- No webhook support (polling only)
- AI analysis costs Anthropic API tokens (~10 emails per batch)
- Email body truncated to 4000 chars for AI processing
- Only scans primary inbox (excludes promotions, social, updates, forums)

### Toast Messages (Completion/Reopen Feedback)
- AI-generated contextual one-liners via `generateToastMessage()` in `src/api.js`
- Context-aware: considers task title, days on list, energy type/level, reopen vs complete
- 3-second timeout — static fallback shows immediately, AI replaces if it arrives in time
- Static messages organized by speed (same-day, normal, long-overdue, reopen)
- Implementation: `src/components/Toast.jsx`

### Infrastructure
- Version check on every view/modal navigation via `/api/health`
- Docker multi-stage build with QEMU-safe arm64 support
- `sharp` as devDependency for icon generation
- Dev seed system: `SEED_DB=1` populates DB with realistic ADHD test data at startup (Claude API or static fallback)

## Additional Notes
- Single developer (ryakel) — no PR review process needed.

## Documentation Requirements (NON-NEGOTIABLE)
**Every commit must be reflected in docs before pushing.** This applies to ALL changes — features, fixes, refactors, cleanup, doc-only changes, everything.

1. **`wiki/Version-History.md`** — add an entry for every commit, every time. No exceptions.
2. **`CLAUDE.md`** — update if the change affects features, architecture, or known limitations
3. **`wiki/Features.md`** — update if user-facing behavior changed
4. **`wiki/Architecture.md`** — update if technical implementation, routes, or schema changed
5. **`README.md`** — update if a major feature was added or removed
6. Other wiki pages as needed (Configuration.md, Getting-Started.md, etc.)

Do NOT push without updating docs. Bundle doc updates into the same commit when possible, or add a follow-up doc commit before pushing.

## Technical Debt & Future Plans

Tracked in [GitHub Issues](https://github.com/ryakel/boomerang/issues). Key items:

- **#3** — ~~Prop drilling~~ **DONE** — TaskActionsContext eliminates callback prop drilling on TaskCard
- **#4** — ~~Desktop UI Phase 3 — side drawer~~ **DONE**
- **#5** — ~~Desktop UI Phase 4 — keyboard shortcuts~~ **DONE**
- **#6** — ~~Desktop UI Phase 5 — richer cards~~ **DONE**
- **#8** — ~~Notion database sync UI~~ **DONE**
- **#9** — ~~Notion recurring patterns~~ **DONE**
- **#10** — ~~GCal recurring events~~ **DONE**
- **#14** — ~~Markdown import~~ **DONE**
- **#15** — ~~Morning digest notification~~ **DONE**
- **#16** — ~~AI-generated nudge messages for email~~ **DONE**
- **#17** — ~~Notification grouping/batching~~ **DONE** (email batch mode)
- **#18** — ~~Trello multi-list sync UI~~ **DONE**

### Architecture Notes (completed work)

- **Database schema:** Proper SQL tables with indexes, per-record CRUD, batched disk writes every 1s. Migration system in `migrations/`. Settings and labels remain in `app_data` as JSON blobs (intentional).
- **CSS:** Split from monolith to 14 per-component CSS files. Global/shared styles in App.css (~440 lines). Semantic color variables in index.css.
- **Offline queue:** Failed mutations queued in `boom_mutation_queue` localStorage (200 cap), replayed on reconnect. Sync status indicator in header. Packages cached in `boom_packages_v1` localStorage for offline persistence.
- **Research attachments:** `researchTask()` accepts attachments array, converts to Claude API content blocks.
- **Desktop UI Phases 1-3:** Kanban board, hover states, drag-and-drop, desktop modal styling (`sheet-overlay`/`sheet`). EditTaskModal renders as a right-side drawer (480px) on desktop via `sheet-drawer` class. Bottom bar hidden on desktop; compact "What now?" in header.
- **TaskActionsContext:** All task callbacks (`onComplete`, `onSnooze`, `onEdit`, `onExtend`, `onStatusChange`, `onUpdate`, `onDelete`, `onGmailApprove`, `onGmailDismiss`) plus `isDesktop` live in `src/contexts/TaskActionsContext.jsx`. TaskCard receives only `task`, `expanded`, and `onToggleExpand` as props. KanbanBoard and ProjectsView consume actions from context.
- **Desktop keyboard shortcuts:** `useKeyboardShortcuts` hook — `n` (new), `/` (search), `j`/`k` (navigate), `Enter`/`e` (edit), `x` (complete), `s` (snooze), `Escape` (close), `?` (help). Stack-aware Escape closes topmost modal.
- **Analytics dashboard:** `GET /api/analytics/history?days=N` returns aggregated completion data (daily counts, by-tag, by-energy, by-size, by-DOW). Client renders daily bar chart, day-of-week patterns, tag/energy/size breakdowns, 52-week GitHub-style heat map, and collapsible completed task search. Pure CSS charts, no charting libraries.
