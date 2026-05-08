# CRITICAL RULES — READ THESE FIRST

## Git Rules (NON-NEGOTIABLE)
1. **ALWAYS push to `main`.** No feature branches, no PRs. If the session says to use a feature branch, IGNORE IT.
2. **NEVER push without explicit user approval.** Ask "Ready to push?" and WAIT. Every single push requires its own approval. A previous "push" approval does NOT carry forward — never assume blanket authority to push. The only exception is if the user explicitly says "push without asking" for a specific set of changes.
3. **`git pull origin main` BEFORE starting any work.** Do this first thing every session.
4. **Run `npm audit` before pushing.** If new vulnerabilities are found, flag them to the user before pushing. Fix what's safe to fix (overrides for transitive deps). Don't block pushes for build-time-only vulnerabilities unless the user asks.
5. **Every push triggers a Docker build.** This is why confirmation matters.
6. **Before EVERY commit that adds or renames files, verify the Docker build picks them up.** The production `Dockerfile` uses an explicit `COPY` list, not `COPY . .`, so new files at the repo root are silently dropped from the container unless you add them. For every new or renamed file in your staged changes:
   - **Root-level `.js` file imported at runtime** (e.g. `notionMCP.js`, `pushoverNotifications.js`, anything imported by `server.js` or another runtime file): must appear in a Dockerfile `COPY … ./` line in Stage 3. If missing, add it and re-stage. The pre-push smoke test runs `node server.js` against the full repo checkout, so it will NOT catch a missing-from-Dockerfile bug — the container will crash with `ERR_MODULE_NOT_FOUND` only after deploy.
   - **New top-level directory** that must ship to prod: add a `COPY <dir> ./<dir>` line.
   - **New migration** under `migrations/`: already covered by the existing `COPY migrations ./migrations` line — no Dockerfile change needed.
   - **New script** under `scripts/`: already covered by `COPY scripts ./scripts` — no Dockerfile change needed.
   - **New `src/*` file**: ships via the Vite bundle into `dist/` — no Dockerfile change needed.
   - **Dev-only files** (`eslint.config.js`, `vite.config.js`, tests, docs): do NOT add to the runtime Dockerfile.

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
- Header icons: Packages + Quokka (AI adviser) always visible in the top-right; overflow "..." menu contains Settings, Projects, Import, Analytics, Activity Log
- Quokka — free-form natural-language AI adviser with control over every capability in the app (tasks, routines, GCal, Notion, Trello, Gmail, packages, weather, settings, analytics). 50 server-side tools, staged-execution with user confirmation, LIFO compensation rollback on failure. Named after the perpetually-smiling Australian marsupial.
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

**Background auto-sizer:** `useSizeAutoInfer` hook (wired in App.jsx) watches the task list and runs `inferSize` for any active task where `size_inferred = false`, throttled 500ms between calls and one task per render cycle. This covers every create path (quick-add, add modal, routines, Gmail, Notion, Trello, GCal pull, markdown import) with zero per-path plumbing — as long as a task lands with `size_inferred = false`, it gets picked up automatically. `createTask` defaults `size` to `'M'` so points compute immediately; inference refines it. Manual size picks set the flag to `true` so the hook backs off. Migration 016 backfills the flag: existing tasks with a non-null size are treated as already-inferred; any null-sized historical tasks get queued for inference on next load.

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

### Routine Scheduling
Recurring tasks (routines) support per-routine day-of-week anchoring and on-demand one-off spawns.

**Cadence types:** `daily`, `weekly`, `monthly`, `quarterly`, `annually`, `custom` (every N days).

**Weekday anchor (`schedule_day_of_week`, 0=Sun … 6=Sat):** optional column added in migration 017. When set, `getNextDueDate()` advances by the cadence interval, then snaps forward to the first occurrence of that weekday. Examples:
- Weekly + Fri → every Friday (after completion, next-due is the following Friday)
- Quarterly + Sat → first Saturday on/after the 3-month anchor (may drift up to 6 days — intentional, "air filter on a weekend" is the use case)
- `daily` cadence ignores the anchor (daily fires every day anyway)

UI lives in `src/components/Routines.jsx` — new "On" dropdown next to Frequency in the add/edit form. "Any day" (default) preserves original behavior. The scheduled weekday appears on routine cards next to the cadence (e.g. "weekly · Fri").

**Manual "Create Now" trigger:** new `spawnNow(routineId)` in `src/hooks/useRoutines.js`. Expanded routine card shows a "+" button that bypasses the schedule and immediately spawns a one-off task with due date = today. Importantly, it does NOT append to `completed_history` — the cadence clock is unaffected until the task is actually completed. So manually creating a task doesn't shift the normal schedule.

### Notion Sync (Pull + Ongoing)
Pulls actionable tasks from Notion pages into Boomerang, and keeps linked tasks in sync.

**Auth model (2026-04-23):** **MCP is the recommended path.** Boomerang connects to Notion's hosted MCP server (`https://mcp.notion.com/mcp`) via OAuth 2.0 + PKCE + Dynamic Client Registration — no pre-registered Notion integration required, full user-scoped workspace access. Implementation lives in `notionMCP.js` using `@modelcontextprotocol/sdk`. On successful connect, every read-only MCP tool is dynamically bridged into Quokka's registry with a `notion_mcp_` prefix, so Quokka gets the full native Notion tool surface without hardcoded wrappers.

`getNotionAccessToken(req)` in `server.js` resolves a token in this order: (1) MCP-issued OAuth token from `notion_mcp_tokens` — valid as both an MCP credential AND a REST `Authorization: Bearer` token, so every existing `/api/notion/*` REST endpoint inherits user-scoped access automatically; (2) legacy integration token from `NOTION_INTEGRATION_TOKEN` env / `x-notion-token` header (kept for users with that env var set, but no UI path to configure it anymore — per-page Connection sharing still required for it).

Migration stages: **Stage 1 (superseded)** — public-integration OAuth endpoints were shipped then ripped out on 2026-04-23 because the Notion Public-integration registration overhead (privacy policy, TOS, support email) is absurd for self-hosted use. MCP with DCR sidesteps the whole thing. **Stage 2 (DONE)** — MCP client + dynamic read-only tool bridge + MCP token shared with REST endpoints via `getNotionAccessToken()`. **Stage 3 (pending)** — migrate `useNotionSync` + `useExternalSync` + the server REST proxy to MCP, delete REST Notion code, and migrate Quokka write tools (create/update page) to MCP with proper compensation.

**Server Endpoints** (in `server.js`):
| Endpoint | Purpose |
|---|---|
| `GET /api/notion/blocks/:id` | Read page content (paginated), returns `{ blocks, plainText }` |
| `GET /api/notion/children/:id` | List child pages of a parent |
| `PATCH /api/notion/pages/:id` | Update page title and/or replace content blocks |
| `POST /api/notion/databases/:id/query` | Query a Notion database. Rows include flattened `properties` (title/rich_text → string, number → number, select/multi_select/status → name(s), date → {start,end}, checkbox → bool, etc.) |
| `GET /api/notion/oauth/auth-url` | Stage 1 OAuth — generate consent URL (public-integration OAuth, deprecated in favor of MCP) |
| `GET /api/notion/oauth/callback` | Stage 1 OAuth callback |
| `GET /api/notion/oauth/status` | Stage 1 OAuth status |
| `POST /api/notion/oauth/disconnect` | Clear Stage 1 OAuth tokens |
| `POST /api/notion/mcp/connect` | Stage 2 — start MCP OAuth + DCR flow. Returns `{authUrl}` or `{alreadyAuthorized}` |
| `GET /api/notion/mcp/callback` | MCP callback — completes the DCR/OAuth handshake via `transport.finishAuth(code)` |
| `GET /api/notion/mcp/status` | `{connected, hasTokens, toolCount}` |
| `GET /api/notion/mcp/tools` | Lists MCP tools the server exposes to this client |
| `POST /api/notion/mcp/disconnect` | Clear MCP tokens + DCR client info |

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

**"Best days" recommendation on the expanded card:** For outdoor-leaning tasks (energy=physical/errand, or title matches outdoor keywords like "mow"/"paint the deck"/"wash car"), tapping a card to expand reveals a "Best days: …" line just above the notes with a sun icon. Up to 3 days are picked by `pickBestDays()` in `src/components/WeatherSection.jsx` (scored on condition kind, precip probability, wind, and temperature comfort). Computed live from the cached forecast — not written into the `notes` field — so user-typed notes stay clean.

**7-day forecast in EditTaskModal:** Opening an outdoor task in the full edit modal shows the 7-day forecast widget (compact 3+4 centered layout with condition icon, high/low, and wind per day; due date highlighted) above the Notes field. Reacts to live edits of title + energy — change the task's energy from `physical` to `desk` and the forecast disappears.

**Visibility control (cards + modal):** `resolveWeatherVisibility()` in `src/components/WeatherSection.jsx` returns `'visible'` | `'drawer'` | `'hidden'` and is used by both TaskCard (best-days line) and EditTaskModal (forecast widget). Rules in priority order:
1. `task.weather_hidden === true` → `'drawer'` (per-card hide wins over tags)
2. Task tagged `outside`/`outdoor` → `'visible'`
3. Task tagged `inside`/`indoor` → `'drawer'`
4. Auto-detected outdoor (energy or title keyword) → `'visible'`
5. Otherwise → `'hidden'`

A drawer renders a small "🌤 Weather" disclosure button — collapsed by default — that expands inline to reveal the same content as `'visible'` would have shown. There is no global toggle — visibility is per-task only.

**Per-card hide:**
- Every visible weather line on a card has a small **X** button → click to set `weather_hidden = true` on that task, collapsing the weather into the drawer for just that card.
- The EditTaskModal has a matching **"Hide weather on this card"** checkbox next to the forecast widget that sets the same flag.
- When `weather_hidden` is true, opening the drawer reveals a **"Show weather on this card"** button to clear the flag.
- The flag is stored in a `weather_hidden INTEGER` column on the tasks table (migration 015), syncing across devices.

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

**Branding caveat (iOS).** Notifications appear under the Pushover app on iOS, not as native Boomerang notifications. The title is prefixed with `[BOOMERANG]` for clarity, and you can upload Boomerang's icon as the application icon in the Pushover dashboard so each message shows the Boomerang icon.

**Classification: enhancement, not blocking.** Web push + email continue to work unchanged. Users without Pushover credentials see zero behavior change; the dispatcher is its own loop and Pushover failures don't affect the other transports for the same notification event.

**Known Limitations:**
- Notifications group under Pushover (not Boomerang) on iOS — branding mitigation via custom application icon

### Engagement Analytics (2026-05-02)

Every notification deep-links to its task via `?task={id}`. The deep-link handler stamps `notification_log.tapped_at` so we can measure conversion. Task completion within 24h of a notification stamps `completed_after`. Both feed `GET /api/analytics/notifications` which the Analytics dashboard renders as a "Notification engagement" panel showing tap-rate and completion-rate per channel and per type.

**Adaptive throttling.** `getEffectiveThrottleMultiplier(channel, type)` in `db.js` looks at the last 10 notifications for a `(channel, type)` combination. All ignored → step the throttle multiplier up by 1.5× (capped at 8×); any tap or completion → reset to 1×. Each change is logged in the `throttle_decisions` table. The Analytics panel surfaces unreviewed back-off decisions as 👍/👎 chips — 👎 reverts the back-off and sets a 7-day override that stops auto-tuning that combination. Migration 020 adds `tapped_at`/`completed_after`; migration 021 adds the `throttle_decisions` table.

**Inline web-push actions.** Web push notifications render Snooze 1h and Done buttons directly on the notification (via service worker `actions:` array). The user can resolve a low-stakes ping without opening the app. Routes: `POST /api/notifications/action/snooze` and `/done`. North-Star aligned: closing the loop on a decision the user has already made — forcing app entry just to dismiss breeds avoidance.

**Post-completion "Next up" toast.** The completion toast surfaces a tappable next-best-task suggestion when the user is in flow. Heuristic: high_priority +100, due-today/overdue +50, XS/S +20.

### Curated Daily Digest

`digestBuilder.js` is the shared digest builder used by all three transports. Sections in order: lead-in → yesterday recap + streak → Today (overdue rolled in here, gentle phrasing) → Coming up → Carrying ("carrying for N days", not "stale") → Quick wins → Weather. Tasks in the HTML version are tappable links via `public_app_url`. `digest_style: 'curated'` (default) vs `'counts'` (legacy plain summary). `pushover_digest_enabled` (default off) adds Pushover priority-0 delivery. `POST /api/digest/test` fires the digest immediately via every enabled channel for validation.

### Tag-based Quiet Hours Opt-in

Default behavior in quiet hours is silence — even priority-1/priority-2 Pushover messages don't fire. Tasks tagged with the configured bypass label (default `wake-me`) are the exception and can wake the user. `quiet_hours_bypass_label` setting controls which label name. EditTaskModal has a "Wake me up for this" checkbox that toggles the label cleanly.

### Web-push Subscription Dedup

Repeat subscribes from the same device (PWA reinstall, iOS evicts subscription, etc.) used to accumulate stale rows in `push_subscriptions`, causing duplicate notifications. `upsertPushSubscription()` now deletes prior rows with matching `(p256dh, auth)` keys before inserting. One-time cleanup script: `node scripts/dedupe-push-subscriptions.js`.

### Email Deliverability Overrides

`email_from_address` and `email_from_name` settings let users override the From header for deliverability without changing env vars or restarting. Using a domain you control with SPF/DKIM/DMARC is the single biggest factor in keeping digests out of spam.

### Considered But Not Yet Built

- **Tone-aware AI rewrites** — one notification per dispatcher tick rewritten by Claude based on user's `ai_custom_instructions`. Cost-bounded (~$0.001/day). Skipped for Pushover Emergency where urgency matters more than tone.
- **Quokka-initiated weekly pattern review** — once a week, query tasks snoozed/dismissed 3+ times in 14 days, create a seeded Quokka chat asking the user if they're worth keeping.
- **Centralized notification dispatcher** — refactor three independent transport loops into one shared dispatcher when the 4th transport lands.
- **Default-off web push if Pushover dominates analytics** — 2-week decision criterion. Not a code change; a config flip if data warrants.

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

### Quokka (AI Adviser)
Free-form natural-language control surface — user says "I've rescheduled my FAA exam to May 12, adjust everything" and Quokka finds related tasks/GCal events/routines and queues the fix. Named after the quokka (a small, perpetually-smiling Australian marsupial). User-facing branding uses "Quokka"; internal code (module names, CSS classes, endpoints under `/api/adviser/`, state vars like `showAdviser`) stays as `adviser`/`Adviser` — renaming plumbing provides no value.

**Entry point:** `✨` sparkle icon in the header (took the slot where the gear used to be). Settings moved into the overflow `⋯` menu.

**Architecture (3 non-negotiables baked into V1):**
1. **Atomic execute-on-confirm.** Nothing mutates during the chat turn. Mutations are staged in a server-side session plan; user reviews the plan, clicks Apply, and the plan runs in order with LIFO rollback compensation on any failure.
2. **Search-first context.** No task dumps in the prompt. The model uses `search_tasks`, `list_routines`, `gcal_list_events`, `notion_search`, etc. to explore before acting. Works the same at 10 tasks or 1000.
3. **Streaming progress.** SSE events (`turn`, `tool_call`, `tool_result`, `message`, `plan`, `done`) fire live during the tool-use loop so the user sees what the model is doing. Includes an abort button.
4. **Coalesced broadcast.** During `commitPlan()` execution, individual record mutations suppress their usual SSE broadcast. A single `bumpVersion() + broadcast('adviser')` fires at the end so connected clients refetch once, not 15 times.

**Server modules:**
- `adviserTools.js` — registry, session/plan storage (10-min TTL, 1-min sweep), `handleToolCall()`, `commitPlan()` with rollback
- `adviserToolsTasks.js` — 17 task + routine tools
- `adviserToolsIntegrations.js` — 12 GCal + Notion + Trello tools
- `adviserToolsMisc.js` — 20 Gmail + packages + weather + settings + analytics tools
- **Total:** 50 tools; diagnostic list at `GET /api/adviser/tools`

**Server endpoints:**
| Endpoint | Purpose |
|---|---|
| `POST /api/adviser/chat` | SSE streaming — runs the Claude tool-use loop. Body: `{ message, history, sessionId? }`. Emits `session`, `turn`, `message`, `tool_call`, `tool_result`, `plan`, `done`, `error` events. |
| `POST /api/adviser/commit` | Executes the staged plan atomically. Body: `{ sessionId }`. Single SSE broadcast after commit if any mutations ran. |
| `POST /api/adviser/abort` | Cancels in-flight stream + clears session. |
| `GET /api/adviser/tools` | Returns the full tool inventory (name + description) for debugging. |

**Tool categories & counts:**
- Tasks (12): search, get, create (with optional `checklist_items` for multi-part tasks), update, delete, complete, reopen, snooze, move_to_projects, move_to_backlog, activate, research_task (append AI-researched notes with web search)
- Routines (6): list, get, create, update, delete, spawn_now
- Anthropic server-side `web_search` available in the main chat loop — Quokka can look up current info (prices, news, current best-practices) live during a reply, not just from training data
- Google Calendar (5): list calendars, list events, create/update/delete events
- Notion (5): search, get page, query database, create page, update page
- Trello (7): list boards, list lists, create/update/archive card, add checklist
- Gmail (4): status, sync, approve pending, dismiss pending
- Packages (6): list, get, create, update, delete, refresh-all
- Weather (3): get, refresh, geocode
- Settings + analytics (4): get/update settings (secrets blocked), get analytics, get analytics history

**Rollback compensation:**
- Local DB creates → delete on rollback
- Local DB updates → upsert the captured pre-state
- Local DB deletes → re-insert the captured record
- External API creates (GCal/Notion/Trello) → delete or archive the created resource
- External API updates → capture pre-state via GET, PATCH back on rollback
- External API deletes → warn; external deletes are final (rollback can't restore)

**Safety:**
- Secret keys (`anthropic_api_key`, `notion_token`, `trello_api_key`/`trello_secret`, `gcal_client_secret`, `tracking_api_key`) are blocked from `update_settings`. The adviser cannot read or change them.
- Max 15 tool-use turns per user message to prevent runaway loops.
- Destructive tools (`delete_*`, `archive_*`) always require the confirm step; never auto-executed.
- Session abort (user clicks Stop) propagates through `AbortController` + clears the session.

**Client:**
- `src/components/Adviser.jsx` + `.css` — chat modal (sheet on desktop, full-screen on mobile)
- `src/hooks/useAdviser.js` — conversation state, SSE reader, plan-commit flow
- `src/api.js` — `adviserChat()`, `adviserCommit()`, `adviserAbort()`
- Mobile: entered via header sparkle icon next to Packages
- Desktop: same icon + click-to-open

**Multi-chat model (2026-04-23):** Every topic is its own chat. Storage lives server-side in `app_data.adviser_chats` (an array of `{id, title, messages, sessionId, starred, createdAt, updatedAt, expiresAt}`) + `app_data.adviser_active_chat_id` (which chat Quokka is currently reading/writing). iOS aggressively evicts PWA localStorage, so nothing sits there.

**Lifetimes:**
- On create or message activity, non-starred chats get `expiresAt = now + 30 days` (rolling from last activity).
- Star → `expiresAt = null` (permanent).
- Unstar → `expiresAt = now + 7 days` and an orange banner appears in the chat: "This chat will be deleted in N days. Star to keep."
- Sweep runs on every `GET /api/adviser/chats` — deletes anything past its `expiresAt`. If the active chat got swept, `adviser_active_chat_id` is cleared.

**Migration from the old single-thread model:** one-shot on first access. Old `adviser_thread` → active chat, pre-starred (can't silently lose your in-flight conversation across the upgrade). Old `adviser_archive` entries → peer chats with fresh 30d TTL clocks. Legacy keys are zeroed out so it only runs once.

**Endpoints:**
- `GET /api/adviser/chats` — list summaries + active id; runs the expiry sweep
- `GET /api/adviser/chats/active` — full content of the active chat
- `GET /api/adviser/chats/:id` — full content by id
- `POST /api/adviser/chats` — create empty chat, auto-activate
- `PATCH /api/adviser/chats/:id` — update messages / title / sessionId; bumps `updatedAt` + rolls the 30d TTL (unless starred)
- `DELETE /api/adviser/chats/:id` — delete; clears active id if removed
- `POST /api/adviser/chats/:id/activate` — switch active
- `POST /api/adviser/chats/:id/star` — permanent
- `POST /api/adviser/chats/:id/unstar` — 7d grace period

**Client:** `useAdviser` hydrates on mount by fetching list + active chat body, persists on every change (400ms debounce) to the active chat, exposes `newChat` / `switchChat` / `deleteChat` / `starChat` / `unstarChat`. `Adviser.jsx` header has `+` (new chat) and History icons. The History panel shows all chats with star + delete controls, active indicator, and "expires in Nd" meta for chats within the 7-day window.

**Parked (future):**
- Attachment upload: no way to give Quokka a PDF/image and ask it to generate tasks from it. The existing `extractAttachmentText()` in src/api.js handles task-attachment text extraction; wiring a Quokka-facing "analyze this upload and stage tasks" tool is left as a future enhancement.

**Known Limitations:**
- External delete rollback can't restore the resource (GCal events, Notion blocks)
- The model needs an Anthropic API key configured; if missing, the endpoint 400s with a clear error
- Tool-use loops can rack up tokens (5K system prompt × 15 turns × multi-tool calls per turn), noticeable in API costs for heavy use
- No audit log yet — mutations go through the normal DB path and show up in sync history but aren't separately annotated as adviser-initiated

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

### UI v2 (Opt-in Maturity Refresh, 2026-05-03)
Boomerang ships with two UIs that share the same underlying app (server, hooks, store, contexts, API).

**Routing.** `src/App.jsx` is a thin router that reads `localStorage.ui_version` and renders either `AppV1` (legacy, in `src/AppV1.jsx`) or `AppV2` (in `src/v2/AppV2.jsx`). **Default is `'v2'` since the cutover (PR6, 2026-05-03).** Only an explicit `'v1'` opts out — existing users who set v1 keep their preference. URL escape hatch: `?ui=v2` and `?ui=v1` set the flag, then strip themselves from the URL so deep-link params (`?task=X`) don't keep flipping it. `data-ui-version` is mirrored on the documentElement.

**Tokens.** v2 design tokens live at `src/v2/tokens.css`, all namespaced `--v2-*` so they cannot leak into v1. Activated by `data-ui="v2"` (set by AppV2 on mount). Dark variant keys off the existing `data-theme="dark"` attribute.

**Visual north stars** (from Wheneri): heavy display titles + generous whitespace, hairline-list aesthetic over stacked-card chrome, single circular-pill X close in the same top-right slot on every modal. v1 stays exactly as-is.

**Build order** (per the plan in `/root/.claude/plans/ui-redesign-ideas-i-iridescent-wren.md`):
1. ✅ Tokens + opt-in plumbing (PR1)
2. ✅ Shell + Header + ModalShell + EmptyState (PR2)
3. ✅ TaskCard + section labels (PR3)
4. ✅ Modals batch 1: SnoozeModal (PR4a) + AddTaskModal (PR4b) + EditTaskModal (PR4c) + ReframeModal/WhatNowModal (PR4d)
5. ✅ Modals batch 2: SettingsModal+Beta tab (PR5a) + Projects/DoneList/ActivityLog (PR5b) + RoutinesModal (PR5c) + PackagesModal (PR5d) + AdviserModal (PR5e) + AnalyticsModal+Balance radar (PR5f) + General/AI/Data/Logs Settings tabs (PR5g). Labels/Integrations/Notifications still defer to v1.
6. ✅ KanbanBoard (desktop) + **v2 default cutover** (PR6)
7. ✅ Toast + routine completion logging on complete + motion audit (PR7)
8. ✅ Polish (PR8): Trello status push (a), weather badges (a), swipe gestures (b), Labels CRUD (c), Notifications matrix (d), Integrations status panel (e). Dark-mode QA pass deferred until v2 sizes/colors are validated in light mode.

Each PR is independently mergeable. v2 currently renders the calm header + a real task list (Doing / Stale / Up next / Waiting / Snoozed) wired to the shared `useTasks` / `useRoutines` / `useNotifications` / `useServerSync` / `useExternalSync` / `useSizeAutoInfer` hooks. Tap-to-expand works; Done completes (via shared `completeTask`); Snooze + Edit + every header icon open ModalShell placeholders that point users back to v1 for that surface. Routine-completion logging, Trello status push, search, sort, tag filters, backlog, projects, swipe gestures, weather badges, packages, drag-and-drop, and the inbound syncs port in PRs 4–8.

**Reusable v2 primitives** (in `src/v2/components/`):
- `ModalShell` — sheet/panel wrapper. Props: `open`, `onClose`, `title`, `subtitle?`, `width: 'narrow' | 'wide'`, `children`. Circular-pill X top-right, hairline below title, body padding 24px.
- `EmptyState` — calm empty/placeholder. Props: `icon` (lucide component), `title`, `body?`, `cta?`, `ctaOnClick?`. Soft circular icon backdrop, ghost CTA.
- `Header` — calm 4-affordance header. Props: `onOpenAdviser`, `onOpenPackages`, `onOpenMenu`. Logo + wordmark left, three icon buttons right.
- `SectionLabel` — `--type-section` ALL-CAPS label with sparkle bullet + optional count chip.
- `TaskCard` — v2 list card. Status economy: only overdue + high-pri get a colored left border; stale → inline meta; low-pri → opacity 0.78. Energy as a single chip (lucide icon + N small Zap glyphs in the type color).

These five primitives are the v2 task-surface language. Every subsequent v2 surface uses them — never reach for a one-off chrome.

**Branch model.** v2 work lands on the `dev` branch (auto-builds `:dev` Docker image via `.github/workflows/build-and-publish-dev.yml`, deploys to `boomerang-dev` container on port 3002 via `docker-compose.dev.yml`). Once v2 stabilizes, dev gets merged into main.

**User opt-in.** Settings → Beta tab → "Use v2 interface" toggle. The Beta tab is reserved for future opt-in experiments too.

**End state.** After all 8 PRs ship and a 1-2 week opt-in period validates v2, flip the default to `'v2'`, leave v1 reachable via `?ui=v1` for one release, then delete `src/AppV1.jsx` + `src/components/` and rename `src/v2/components/` → `src/components/`.

## Additional Notes
- Single developer (ryakel) — no PR review process needed.

## Security Posture (2026-05-02)
**Threat model:** single-user self-hosted, user controls the machine. See `wiki/Security-Notes.md` for the full breakdown.

**Secret storage layout:**
- User-provided keys (Anthropic, Notion, Trello, GCal Client Secret, 17track, Pushover User Key + App Token) live plaintext in `app_data.settings` (server) AND `localStorage` (client).
- OAuth refresh tokens (GCal / Gmail / Notion MCP) live plaintext in `app_data` server-side only — never round-tripped to the browser.
- VAPID private key lives in `app_data.vapid_keys` server-side only.
- SMTP credentials are env-only by design — never written to DB.
- Web push subscription keys live in `push_subscriptions` table.

**Quokka secret blocklist** (`adviserToolsMisc.js`): the adviser's `update_settings` tool refuses to write, and `get_settings` redacts: `anthropic_api_key`, `notion_token`, `trello_api_key`, `trello_secret`, `gcal_client_secret`, `tracking_api_key`, `pushover_user_key`, `pushover_app_token`. Keep this list in sync when adding new secret-shaped settings.

**No encryption at rest.** SQLite plaintext. Anyone who can read `/data/boomerang.db` reads everything. Acceptable for self-hosted single-user; *not* acceptable for multi-tenant.

## Data Durability (2026-05-08)

**Daily snapshot.** `scripts/backup-db.js` runs on server boot and every 24h. Copies `$DB_PATH` → `${DB_PATH}.YYYY-MM-DD.bak` (idempotent), prunes snapshots older than `BACKUP_RETENTION_DAYS` (default 7). Snapshots live alongside the live DB in `/data`.

**Bulk-write guard.** `PUT/POST /api/data` rejects (HTTP 409) any payload where `body.tasks` is an array AND would empty the table OR shrink it >50% (with a 10-row floor). This is the durability fix for the 2026-05-07 wipe — a client whose initial GET failed pushed `tasks: []` via the manual-flush code path and obliterated 153 rows. Per-record `/api/tasks` mutations are unaffected; that's the supported path for legitimate bulk deletes.

**Recovery diagnostic.** `scripts/recover-from-notification-log.js` (read-only) queries `notification_log` (which survives `setAllData` since it's not in the bulk-PUT collection list) for unique `(task_id, most_recent_title)` pairs and flags which IDs are still present in the live `tasks` table. Up to 500 rows of history.

**Server log timestamps.** Every `console.log/.error/.warn` call gets an ISO-8601 timestamp prefix automatically (wrappers in `server.js` near line 161). Don't add manual timestamps to log lines.

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
- **Routine weekday scheduling** — **DONE** (`schedule_day_of_week` on routines, 2026-04-17)
- **Routine manual spawn** — **DONE** (`spawnNow` bypasses schedule, 2026-04-17)

### Architecture Notes (completed work)

- **Database schema:** Proper SQL tables with indexes, per-record CRUD, batched disk writes every 1s. Migration system in `migrations/`. Settings and labels remain in `app_data` as JSON blobs (intentional).
- **CSS:** Split from monolith to 14 per-component CSS files. Global/shared styles in App.css (~440 lines). Semantic color variables in index.css.
- **Offline queue:** Failed mutations queued in `boom_mutation_queue` localStorage (200 cap), replayed on reconnect. Sync status indicator in header. Packages cached in `boom_packages_v1` localStorage for offline persistence.
- **Research attachments:** `researchTask()` accepts attachments array, converts to Claude API content blocks.
- **Desktop UI Phases 1-3:** Kanban board, hover states, drag-and-drop, desktop modal styling (`sheet-overlay`/`sheet`). EditTaskModal renders as a right-side drawer (480px) on desktop via `sheet-drawer` class. Bottom bar hidden on desktop; compact "What now?" in header.
- **TaskActionsContext:** All task callbacks (`onComplete`, `onSnooze`, `onEdit`, `onExtend`, `onStatusChange`, `onUpdate`, `onDelete`, `onGmailApprove`, `onGmailDismiss`) plus `isDesktop` live in `src/contexts/TaskActionsContext.jsx`. TaskCard receives only `task`, `expanded`, and `onToggleExpand` as props. KanbanBoard and ProjectsView consume actions from context.
- **Desktop keyboard shortcuts:** `useKeyboardShortcuts` hook — `n` (new), `/` (search), `j`/`k` (navigate), `Enter`/`e` (edit), `x` (complete), `s` (snooze), `Escape` (close), `?` (help). Stack-aware Escape closes topmost modal.
- **Analytics dashboard:** `GET /api/analytics/history?days=N` returns aggregated completion data (daily counts, by-tag, by-energy, by-size, by-DOW). Client renders daily bar chart, day-of-week patterns, tag/energy/size breakdowns, 52-week GitHub-style heat map, and collapsible completed task search. Pure CSS charts, no charting libraries.
