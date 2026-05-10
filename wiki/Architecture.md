# Architecture

## Overview

```
Browser (React PWA)
  ├── localStorage (offline cache)
  ├── EventSource /api/events ──> SSE (real-time sync)
  └── fetch /api/* ──> Express Server
                          ├── /api/health       → Health check (returns {status: "ok"})
                          ├── /api/events       → Server-Sent Events for cross-client sync
                          ├── /api/data          → SQLite (GET all, PUT all, POST all, PATCH collection, DELETE all)
                          ├── /api/log           → Client log relay (diagnostics in server terminal)
                          ├── /api/messages      → Anthropic Claude API proxy
                          ├── /api/notion/*      → Notion API proxy (search, pages, status)
                          ├── /api/trello/*      → Trello API proxy (boards, lists, cards, sync)
                          ├── /api/gcal/*        → Google Calendar API proxy (OAuth, events, calendars)
                          ��── /api/packages/*    → Package tracking (CRUD, polling, 17track v2.4 API)
                          ├── /api/email/*       → Email notification status and test
                          ├── /api/push/*        → Web push notification status, subscribe, test
                          ├── /api/pushover/*    → Pushover notification status, test, test-emergency
                          ├── /api/weather/*     → Weather forecast cache, refresh, geocode (Open-Meteo)
                          └── /api/keys/status   → Reports which API keys are set via env vars
```

## Component Architecture

**TaskActionsContext** (`src/contexts/TaskActionsContext.jsx`): All task action callbacks (`onComplete`, `onSnooze`, `onEdit`, `onExtend`, `onStatusChange`, `onUpdate`, `onDelete`, `onGmailApprove`, `onGmailDismiss`) plus `isDesktop` are provided via React Context. TaskCard only receives `task`, `expanded`, and `onToggleExpand` as props. KanbanBoard and ProjectsView consume actions from context rather than prop drilling.

**v1/v2 routing** (`src/App.jsx`): Thin router that reads `localStorage.ui_version` (default `'v1'`) and renders either `AppV1` (`src/AppV1.jsx` — the existing component) or `AppV2` (`src/v2/AppV2.jsx` — the in-progress redesign). URL escape hatch: `?ui=v2` and `?ui=v1` set the flag and strip themselves from the URL so deep-link params (`?task=X`) survive. `data-ui-version` is mirrored on the documentElement; v2 also sets `data-ui="v2"` so its namespaced design tokens (`src/v2/tokens.css`, all `--v2-*`) activate without leaking into v1. v2 reuses every server endpoint, every hook, every context, `api.js`, `store.js`, `db.js` — only the React component tree and CSS fork. Users opt in via Settings → Beta tab.

## Data Flow

1. **On app load**: React renders immediately from localStorage (fast first paint). An SSE connection opens to `/api/events`, which returns the current server version. The client then fetches `GET /api/data` and hydrates React state and localStorage from SQLite. If the server is empty, the client pushes its localStorage state up.
2. **During use**: All writes go to React state → localStorage (instant) → debounced (300ms) `PUT /api/data` to SQLite. The server bumps a version counter and broadcasts the new version to all SSE clients.
3. **Cross-client sync**: When a client receives an SSE update from a *different* client (identified by `_clientId`), it fetches the latest data from the server and hydrates. Updates from the client's own writes are acknowledged without refetching.
4. **Visibility resume**: When the app becomes visible (tab switch, phone unlock), the client fetches the latest server state as a safety net — covers SSE connections killed by iOS background throttling or proxy timeouts.
5. **Page unload**: Any pending changes are flushed via `navigator.sendBeacon` (POST) before the page closes.
6. **Offline**: If the server is unreachable, the app continues to work from localStorage. SSE auto-reconnects when connectivity returns, and the client syncs on reconnect.

## SSE (Server-Sent Events)

The server maintains a set of active SSE connections. Each data write (PUT, POST, PATCH, DELETE) bumps a monotonic version counter and broadcasts a message to all connected clients:

```json
{ "type": "update", "version": 42, "sourceClientId": "cafbe117-..." }
```

On initial connection, the server sends:

```json
{ "type": "connected", "version": 42 }
```

A keep-alive ping (`: ping\n\n`) is sent every 30 seconds to prevent proxy/load-balancer timeouts.

### Stale Client Guard

Writes to `PUT /api/data` or `POST /api/data` that do not include a `_clientId` in the request body are silently rejected (200 response, no data written). This prevents stale PWA service worker caches — which may still be running old JavaScript — from overwriting current data.

### Bulk-Write Path Is Settings/Labels Only

`PUT /api/data` and `POST /api/data` write app_data JSON blobs (settings, labels, etc) only. They reject (HTTP 400) any payload that includes `tasks`, `routines`, or `packages` keys, with `bulk_path_does_not_accept_arrays` and a hint pointing at the per-record APIs. `setAllData()` in `db.js` throws on the same keys as belt-and-suspenders for any internal caller.

The `syncTasksFromArray` / `syncRoutinesFromArray` / `syncPackagesFromArray` helpers were deleted on 2026-05-08. They were the wipe vector that destroyed 153 tasks on 2026-05-07 (a client whose initial GET failed pushed `tasks: []` via the manual-flush code path; the helpers dutifully deleted every existing row whose id was missing from the empty incoming array).

The client side was hardened in the same change: `buildPayload()` in `src/hooks/useServerSync.js` no longer includes `tasks` or `routines` — only `settings` and `labels`. `pushChanges` refuses to push when `prevTasks`/`prevRoutines` are unset (hydrate hasn't completed). Local state is not treated as authoritative until at least one successful round-trip with the server.

### Restore From Backup

`POST /api/data/restore` is the explicit replace-tasks-and-routines endpoint, used by the Settings → Import Data flow. Requires `confirm: "wipe-and-replace"` in the body. Replaces tasks and routines per-record (delete current rows, upsert from backup), and overwrites settings and labels blobs. Intentionally narrower than the legacy `clearAllData()`-based flow — does NOT touch OAuth tokens, push subscriptions, notification logs, weather cache, adviser chats, or VAPID keys, so a bad backup file can't take out integrations or subscriptions.

### Daily DB Snapshot

`scripts/backup-db.js` runs once on server boot and every 24h thereafter. Copies `$DB_PATH` to `${DB_PATH}.YYYY-MM-DD.bak`, prunes snapshots older than `BACKUP_RETENTION_DAYS` (default 7). Idempotent — re-running the same day is a no-op. Lives alongside the live DB in the same `/data` Docker volume.

### Recovery From notification_log

When the live `tasks` table is lost, `scripts/recover-from-notification-log.js` (read-only) queries `notification_log` (which survives `setAllData` because it's not in the bulk-PUT collection list) and emits each unique `(task_id, most_recent_title, channels, count, in_live_db)`. Up to 500 rows of history available, covering most active+done tasks that have triggered any notification.

There is intentionally **no** auto-seed-from-blob path. Earlier server versions had `seedFromJsonBlobs()` in `db.js` that re-populated empty `tasks`/`routines` tables from legacy `app_data.tasks` / `app_data.routines` JSON blobs at boot. The blob hadn't been written to since migrations 002 + 003 landed, but the read path was still active — meaning any future "tasks table emptied" event would silently re-hydrate from months-stale data instead of surfacing the failure. Removed 2026-05-08 along with migration 022 which drops the orphan rows from `app_data`.

## Storage

- **localStorage** (`boom_tasks_v1`, `boom_routines_v1`, `boom_settings_v1`, `boom_labels_v1`) — browser-side cache for fast initial render and offline fallback
- **SQLite** (`/data/boomerang.db`) — single table `app_data` with collection name (text) as primary key and JSON blob as value. **Source of truth.** Uses sql.js (SQLite compiled to WebAssembly, running in-process in Node.js).

### SQLite Schema

Tasks and routines have proper SQL tables with individual columns, indexes, and per-record CRUD. Settings and labels remain as JSON blobs in `app_data` (intentional — small, rarely updated).

```sql
-- Tasks table (migration 002 + 004 + 005)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  notes TEXT DEFAULT '',
  due_date TEXT, snoozed_until TEXT, snooze_count INTEGER DEFAULT 0,
  staleness_days INTEGER DEFAULT 2,
  last_touched TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
  reframe_notes TEXT,
  notion_page_id TEXT, notion_url TEXT,
  trello_card_id TEXT, trello_card_url TEXT, trello_sync_enabled INTEGER,
  routine_id TEXT, high_priority INTEGER DEFAULT 0,
  size TEXT, energy TEXT, energy_level INTEGER,
  tags_json TEXT, attachments_json TEXT,
  checklist_json TEXT, checklists_json TEXT, comments_json TEXT,
  toast_messages_json TEXT,
  gcal_event_id TEXT, gcal_duration INTEGER
);

-- Indexes on status, due_date, energy, created_at, routine_id, completed_at

-- Key-value store for settings, labels, version
CREATE TABLE app_data (
  collection TEXT PRIMARY KEY,
  data_json TEXT NOT NULL
);
```

```sql
-- Packages table (migration 009)
CREATE TABLE packages (
  id TEXT PRIMARY KEY,
  tracking_number TEXT NOT NULL,
  carrier TEXT, carrier_name TEXT DEFAULT '',
  label TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|in_transit|out_for_delivery|delivered|exception|expired
  status_detail TEXT DEFAULT '', eta TEXT, delivered_at TEXT,
  signature_required INTEGER DEFAULT 0, signature_task_id TEXT,
  last_location TEXT DEFAULT '',
  events_json TEXT DEFAULT '[]',
  last_polled TEXT, poll_interval_minutes INTEGER DEFAULT 120,
  auto_cleanup_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Indexes on status, tracking_number, auto_cleanup_at
```

Migrations are in `migrations/001-009.sql` and run automatically on startup.

### Task Data Model — Attachments

Each task object may include an `attachments` array. Each attachment entry contains a file name, MIME type, and base64-encoded file data. Attachments are stored inline in the task JSON. The maximum file size per attachment is 5 MB. Attachments are included as content blocks in Research API calls and uploaded to Trello/Notion when syncing.

### Toast Message Prefetch

Pre-generated AI toast messages are stored on each task as `toast_messages`:
```json
{
  "complete_quick":  { "message": "...", "subtitle": "..." },
  "complete_normal": { "message": "...", "subtitle": "..." },
  "complete_long":   { "message": "...", "subtitle": "..." },
  "reopen":          { "message": "...", "subtitle": "..." }
}
```
Generated on task create/update (title or energy change), backfilled on load for existing tasks. Toast component reads synchronously — no async, no swaps.

### External Sync Architecture

`useExternalSync` hook watches all tasks for changes to user-facing fields (title, notes, due_date, checklists). When a change is detected on a Trello- or Notion-linked task:
1. 5-second per-task debounce prevents rapid-fire API calls
2. Diff-based sync: only changed fields are sent
3. Trello: field updates, checklist create/update/delete, ID hydration for pre-existing tasks
4. Notion: title via properties API, content via block replacement (delete old, append new)
5. GCal: creates/updates events with AI-inferred timing. Routine-spawned tasks create recurring events with RRULE based on routine cadence (`cadenceToRRule()`). Recurring event ID stored on routine (`gcal_recurring_event_id`) — subsequent spawns link to it.
6. Failed syncs queued in `boom_external_sync_queue` (200 cap), replayed on `online` event

### Smart Recurrence Flow

When a routine spawns a new task instance, the app can invoke the AI (via `/api/messages`) to suggest an appropriate due date. The AI considers:
- The routine's notes and title
- The configured cadence (daily, weekly, monthly, etc.)
- Recent completion history for prior instances

If the AI returns a suggested date, it is applied to the newly spawned task. This runs only when an Anthropic API key is configured; otherwise the default due date setting is used.

## API Key Resolution

```
Request arrives at /api/messages or /api/notion/*
  → Check x-anthropic-key / x-notion-token / x-trello-key+x-trello-token header (user-provided via UI)
  → Fall back to ANTHROPIC_API_KEY / NOTION_INTEGRATION_TOKEN / TRELLO_API_KEY+TRELLO_SECRET env var
  → Also checks .env file for the same keys
  → If neither: return 400 with helpful error message
```

Keys set in the UI are stored in localStorage settings and sent as custom request headers (`x-anthropic-key`, `x-notion-token`, `x-trello-key`, `x-trello-token`). They never touch the server's filesystem or database — the server only forwards them to the external API in the appropriate format (Anthropic uses `x-api-key` header, Notion uses `Authorization: Bearer` header).

### Notion Auth (MCP + legacy fallbacks)

Primary path is **Notion MCP** — the hosted MCP server at `https://mcp.notion.com/mcp` supports OAuth 2.0 + PKCE + Dynamic Client Registration, so there's no Notion integration app to register. Implementation in `notionMCP.js` uses `@modelcontextprotocol/sdk`'s `Client` + `StreamableHTTPClientTransport` with a custom `OAuthClientProvider` that persists state in `app_data` (`notion_mcp_client`, `notion_mcp_tokens`, `notion_mcp_pkce`).

Connection flow: `POST /api/notion/mcp/connect` kicks off a fresh auth attempt. The provider's `redirectToAuthorization(url)` hook captures the URL during the aborted `client.connect()` and the endpoint returns it for the browser popup. `GET /api/notion/mcp/callback` receives `code`, calls `transport.finishAuth(code)`, reconnects the client, and enumerates tools. Connected clients get every read-only MCP tool registered into Quokka's registry dynamically, prefixed `notion_mcp_`, results normalized (text JSON → parsed, multi-text → joined, errors thrown).

Stage-1 and legacy auth paths remain for REST sync:

`getNotionAccessToken(req)` is the async resolver used by all 13 legacy `/api/notion/*` endpoints. Precedence:
1. OAuth access token from `app_data.notion_oauth_tokens` (Stage 1's public-integration OAuth — requires `NOTION_OAUTH_CLIENT_ID` + `NOTION_OAUTH_CLIENT_SECRET`, user registers a Notion Public integration). Refreshed with 5-min buffer via HTTP Basic auth against `https://api.notion.com/v1/oauth/token`.
2. Legacy integration token — `x-notion-token` header or `NOTION_INTEGRATION_TOKEN` env. Limited to pages shared with the integration via Connections.

Stage 3 will migrate `useNotionSync` + `useExternalSync` + the REST proxy to MCP and remove both fallback paths.

### Key Status Endpoint

`GET /api/keys/status` returns `{ anthropic, notion, notion_oauth, trello, gcal, tracking, usps, smtp }` booleans indicating whether each credential is configured via environment variable. The frontend uses this to decide whether to show the API key input fields, the OAuth Connect button (when `notion_oauth` is true), or a "set by environment variable" notice in Settings.

## Health Endpoint

`GET /api/health` returns `{ status: "ok" }`. Used by the Docker healthcheck (wget-based, every 30 seconds) to monitor container health.

## Server Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/keys/status` | Reports env var key availability |
| `GET` | `/api/events` | SSE endpoint for real-time cross-client sync |
| `GET` | `/api/data` | Get all data from SQLite (includes `_version`) |
| `PUT` | `/api/data` | Write app_data blobs (settings, labels). Rejects `tasks`/`routines`/`packages` keys with HTTP 400. Requires `_clientId`. |
| `POST` | `/api/data` | Same as PUT — for `navigator.sendBeacon` (requires `_clientId`) |
| `POST` | `/api/data/restore` | Restore tasks + routines + settings + labels from a backup file. Requires `{"confirm": "wipe-and-replace"}` in body. |
| `POST` | `/api/log` | Client log relay (diagnostics to server terminal) |
| `POST` | `/api/messages` | Proxy to Anthropic Claude API |
| `POST` | `/api/adviser/chat` | SSE stream — runs the Claude tool-use loop for the AI Adviser |
| `POST` | `/api/adviser/commit` | Execute the staged plan atomically with LIFO rollback on failure |
| `POST` | `/api/adviser/abort` | Abort in-flight adviser stream + clear session |
| `GET` | `/api/adviser/tools` | Diagnostic — lists all 50 registered adviser tool names |
| `GET` | `/api/adviser/chats` | List all chat summaries + activeId. Runs expiry sweep. |
| `GET` | `/api/adviser/chats/active` | Full content of the active chat |
| `GET` | `/api/adviser/chats/:id` | Full chat by id |
| `POST` | `/api/adviser/chats` | Create new empty chat, auto-activate |
| `PATCH` | `/api/adviser/chats/:id` | Update messages/title/sessionId; rolls 30d TTL |
| `DELETE` | `/api/adviser/chats/:id` | Delete chat; clears active if removed |
| `POST` | `/api/adviser/chats/:id/activate` | Switch which chat is active |
| `POST` | `/api/adviser/chats/:id/star` | Star (permanent — expiresAt nulled) |
| `POST` | `/api/adviser/chats/:id/unstar` | Unstar (expiresAt = now + 7 days) |
| `POST` | `/api/notion/search` | Search Notion pages |
| `GET` | `/api/notion/pages/:id` | Get a Notion page |
| `POST` | `/api/notion/pages` | Create a Notion page |
| `PATCH` | `/api/notion/pages/:id` | Update page title and/or replace content blocks |
| `GET` | `/api/notion/status` | Check Notion connection status (reports `{connected, auth: 'oauth'\|'legacy', workspace_name}`) |
| `GET` | `/api/notion/blocks/:id` | Read page content (paginated), returns blocks + plainText |
| `GET` | `/api/notion/children/:id` | List child pages of a parent |
| `POST` | `/api/notion/blocks/:id/children` | Append blocks to a page |
| `POST` | `/api/notion/file-uploads` | Create a Notion file upload |
| `POST` | `/api/notion/file-uploads/:id/send` | Send file data to Notion |
| `POST` | `/api/notion/databases/:id/query` | Query a Notion database (returns flattened `properties` map on each row) |
| `GET` | `/api/notion/oauth/auth-url` | Stage 1 OAuth — generate consent URL (deprecated in favor of MCP) |
| `GET` | `/api/notion/oauth/callback` | Stage 1 OAuth callback |
| `GET` | `/api/notion/oauth/status` | Stage 1 OAuth status |
| `POST` | `/api/notion/oauth/disconnect` | Clear Stage 1 OAuth tokens |
| `POST` | `/api/notion/mcp/connect` | Start MCP OAuth + DCR flow; returns auth URL or `alreadyAuthorized` |
| `GET` | `/api/notion/mcp/callback` | MCP callback — finishes DCR/OAuth handshake |
| `GET` | `/api/notion/mcp/status` | `{connected, hasTokens, toolCount}` |
| `GET` | `/api/notion/mcp/tools` | Enumerate tools the MCP server exposes |
| `POST` | `/api/notion/mcp/disconnect` | Clear MCP tokens + DCR client info |
| `GET` | `/api/trello/status` | Check Trello connection status |
| `GET` | `/api/trello/boards` | List user's Trello boards |
| `GET` | `/api/trello/boards/:id/lists` | Get lists in a Trello board |
| `POST` | `/api/trello/cards` | Create a Trello card |
| `PATCH` | `/api/trello/cards/:id` | Update a Trello card |
| `DELETE` | `/api/trello/cards/:id` | Archive a Trello card |
| `GET` | `/api/trello/cards/:id` | Get a single Trello card |
| `POST` | `/api/trello/cards/:id/checklists` | Create a checklist on a card |
| `GET` | `/api/trello/cards/:id/checklists` | Fetch checklists for a card |
| `POST` | `/api/trello/checklists/:id/checkItems` | Add item to a checklist |
| `PUT` | `/api/trello/cards/:cardId/checkItem/:itemId` | Update a check item |
| `DELETE` | `/api/trello/checklists/:id` | Delete a checklist |
| `POST` | `/api/trello/cards/:id/attachments` | Upload attachment to card |
| `POST` | `/api/trello/sync-all-lists` | Pull cards from multiple Trello lists at once |
| `GET` | `/api/gcal/auth-url` | Generate Google OAuth authorization URL |
| `GET` | `/api/gcal/callback` | OAuth callback — exchanges code for tokens |
| `GET` | `/api/gcal/status` | Check Google Calendar connection status |
| `POST` | `/api/gcal/disconnect` | Clear stored OAuth tokens |
| `GET` | `/api/gcal/calendars` | List user's Google Calendars |
| `POST` | `/api/gcal/events` | Create a Google Calendar event |
| `PATCH` | `/api/gcal/events/:eventId` | Update a Google Calendar event |
| `DELETE` | `/api/gcal/events/:eventId` | Delete a Google Calendar event |
| `POST` | `/api/gcal/events/bulk-delete` | Delete all Boomerang-managed events from calendar |
| `GET` | `/api/gcal/events` | List events in a time range (for pull sync) |
| `GET` | `/api/tasks` | Get tasks (with optional filters) |
| `POST` | `/api/tasks` | Create a task |
| `PATCH` | `/api/tasks/:id` | Update a task |
| `DELETE` | `/api/tasks/:id` | Delete a task |
| `GET` | `/api/analytics` | Get today's stats, streaks, all-time records |
| `GET` | `/api/analytics/history` | Aggregated completion history (daily, by-tag, by-energy, by-size, by-DOW). Accepts `?days=N` param. |
| `POST` | `/api/dev/seed` | Wipe DB and reload seed data on demand |
| `GET` | `/api/weather` | Get cached forecast + status |
| `POST` | `/api/weather/refresh` | Force-refresh forecast (respects 30-min freshness unless `{ force: true }`) |
| `POST` | `/api/weather/geocode` | Geocode a location query via Open-Meteo |

## AI Adviser

`adviserTools.js` is the engine. `adviserToolsTasks.js`, `adviserToolsIntegrations.js`, and `adviserToolsMisc.js` register 49 tools via `registerTool({ name, description, schema, readOnly, preview, execute })`.

**Staged execution.** During `/api/adviser/chat`, read-only tools run immediately and return data; mutation tools do nothing except return a `preview` string and push a staged step into the session's plan. When the user confirms, `/api/adviser/commit` runs every staged step in order via `commitPlan()`.

**Rollback compensation.** Each `execute()` returns `{ result, compensation }`. Compensations are collected LIFO during the commit. If step N fails, compensations 1..N-1 are invoked in reverse. Local DB mutations capture the pre-state (full record) so the compensation can upsert it back verbatim. External API mutations (GCal, Notion, Trello) capture the pre-state via GET, then call the inverse operation (delete created resources, PATCH back updated ones). External deletes cannot be rolled back and the compensation just logs a warning.

**Coalesced SSE broadcast.** Individual mutation handlers normally call `bumpVersion() + broadcast(version, clientId)` on every write. During `commitPlan()`, `deps.suppressBroadcast = true` is passed through to the handlers (which currently operate through the db layer directly, sidestepping the per-route broadcast). A single `bumpVersion() + broadcast(newVersion, 'adviser')` fires at the end of a successful commit.

**Session lifecycle.** Sessions are in-memory only (`sessions` Map in `adviserTools.js`). Keyed by `crypto.randomUUID()`, 10-minute TTL, 1-minute sweep. Abort via `POST /api/adviser/abort` with sessionId — the `AbortController` for the in-flight Claude stream is aborted, the `aborted` flag is set, and the session is cleared. Successful commit also clears the session.

**Max-turn guard.** The tool-use loop inside `/api/adviser/chat` caps at 15 iterations. Each iteration is one round-trip to Claude (with all 49 tool schemas in the request). If the model hits the cap without `stop_reason === 'end_turn'`, whatever plan is staged so far is returned to the client.

**Security.** Secret keys (`anthropic_api_key`, `notion_token`, `trello_api_key`, `trello_secret`, `gcal_client_secret`, `tracking_api_key`) are redacted in `get_settings` output and blocked from `update_settings` writes. Auth tokens flow through a per-request `deps` object constructed by `adviserDeps(req)` — Claude never sees them; tool handlers receive them as closure values.

**SSE resilience.** `/api/adviser/chat` primes the stream with a `: connected\n\n` comment + explicit `res.flush()` so iOS Safari / CDN proxies commit the chunked response immediately instead of buffering the first KB. A 15-second heartbeat comment keeps long-lived connections alive through idle-connection killers. Each Claude API call inside the tool-use loop is wrapped in a nested `AbortController` with a 90-second timeout — if the upstream hangs, the loop surfaces a clean `error` event rather than leaving the client on an infinite spinner. Verbose per-turn logging (`[Adviser <8char>] turn N/15 — calling model…`, tool calls + timing, `chat done — staged N step(s)`) is written to the container log for post-hoc diagnosis.

**Multi-chat storage.** Chats live as an array in `app_data.adviser_chats`; the currently-focused one is named by `app_data.adviser_active_chat_id`. Each chat: `{id, title, messages, sessionId, starred, createdAt, updatedAt, expiresAt}`. Client hydrates on mount by fetching the list and the active chat's body. Non-starred chats roll a 30-day TTL on every activity; star clears it; unstar sets a 7-day grace. A sweep runs on every `GET /api/adviser/chats` — deletes anything past `expiresAt` and clears the active pointer if it got swept. Legacy `adviser_thread`/`adviser_archive` data is migrated to the new model on first access (thread becomes active + starred, archive entries become peer chats with fresh 30d clocks). Titles auto-generated from the first user message, 60-char truncation.

## Weather Sync

`weatherSync.js` runs a 30-minute `setInterval` that fetches a 7-day forecast from Open-Meteo (no API key) and caches it in `app_data.weather_cache`. After every successful fetch it evaluates three notification events — `nice_day`, `bad_weekend`, `nice_window` — and sends push/email alerts for any that aren't already throttled. Each event carries a stable id (e.g. `weather:bad_weekend:2026-04-19:rain`) with an 18-hour dedup TTL via the `notification_throttle` table, so the same weekend-rain warning never repeats. There is no daily cap — multiple distinct weather events in a day can all fire. Changing the configured location in Settings invalidates the cache and triggers an immediate refresh on the next PUT `/api/data`.

The `getWhatNow()` prompt is enriched with a weather summary string when available, and the morning digest (push + email) appends the same summary. Task cards render a small forecast badge for tasks whose `due_date` falls inside the 7-day forecast window; the badge is driven by the `useWeather` hook which polls `GET /api/weather` every 30 min (plus on tab visibility change).

## Dev Seed System

The `SEED_DB=1` environment variable triggers database seeding on server startup (after `initDb()`). This is intended for development only.

**Flow:**
1. `server.js` detects `SEED_DB=1` after DB initialization
2. `seed.js` is called with the Anthropic API key (if available)
3. If API key exists: calls Claude API to generate fresh, randomized test data
4. If no API key: loads static fallback from `scripts/seed-data.json`
5. Calls `clearAllData()` + `setAllData()` + `flushNow()` to wipe and reload

**Files:**
- `seed.js` — startup seeder (imported by server.js)
- `scripts/seed-data.json` — static fallback with 53 tasks, 7 routines, 12 labels
- `scripts/generate-seed-data.js` — standalone script to regenerate the static JSON via API

**Usage:** `SEED_DB=1 docker compose -f docker-compose.dev.yml up`

The production `docker-compose.yml` does not expose `SEED_DB`, making accidental seeding impossible.

## PWA

The app is a Progressive Web App:
- Service worker (generated by vite-plugin-pwa) precaches all static assets
- `skipWaiting` and `clientsClaim` ensure new versions activate immediately
- `navigateFallbackDenylist: [/^\/api/]` prevents the service worker from intercepting API routes (including SSE)
- Installable to mobile home screen
- Works offline for viewing/editing tasks (API features require connectivity)
- Auto-updates when new versions are deployed (`registerType: 'autoUpdate'`)

## Version Injection

The app version is determined at build time:
1. `git describe --tags --always` (preferred, from vite.config.js)
2. `APP_VERSION` environment variable (fallback, used in Docker builds)
3. `"dev"` (final fallback)

The version is injected as `__APP_VERSION__` via Vite's `define` config and displayed in the Settings header.

## Notification Transports

Three independent notification transports run alongside each other in `server.js`:

- **Email** (`emailNotifications.js`) — SMTP-based, configured via env vars (`SMTP_HOST`, `SMTP_USER`, etc.)
- **Web Push** (`pushNotifications.js`) — VAPID keys auto-generated, browser push subscriptions in `push_subscriptions` table
- **Pushover** (`pushoverNotifications.js`) — HTTP API at `api.pushover.net`, native iOS/Android app delivery, supports priority-2 (Emergency) for bypass-DND alarms

Each transport is its own module with its own 60-second `setInterval` loop. They share helpers (frequency math, quiet hours check, avoidance boost, throttling via the `notification_throttle` table) by duplication — one copy per module — for simplicity. A 4th transport landing later (Twilio, ntfy, etc.) is the right time to refactor these into a shared dispatcher; today's three-copy structure is intentional tech debt.

**Failure isolation.** A failure in any one transport (network timeout, API outage) is caught and logged at the transport boundary; the other two continue working for the same notification event. Test endpoints exist for all three: `/api/email/test`, `/api/push/test`, `/api/pushover/test` (plus `/api/pushover/test-emergency` for the priority-2 alarm).

**Pushover-specific:**
- Credentials stored as JSON-blob settings keys (`pushover_user_key`, `pushover_app_token`) in `app_data` like all other settings — not in dedicated columns
- Optional `PUSHOVER_DEFAULT_APP_TOKEN` env var provides an app-token fallback (user key is always per-user)
- Priority-2 (Emergency) sends store the receipt id in `tasks.pushover_receipt`. When `db.js` `updateTaskPartial` or `deleteTask` detects a user-driven resolution event, it cancels the receipt via Pushover's `/receipts/{id}/cancel.json` endpoint. Single insertion in those two helpers catches both HTTP routes and Quokka adviser tools.
- Quiet hours behavior differs from email/push: priority-0 honors quiet hours, priority 1+2 bypass them. The bypass is per-priority within the dispatcher loop rather than a global early-exit.

**Considered but not yet built:** centralized dispatcher refactor (pay down when 4th transport lands), tag-based per-task quiet-hours bypass, curated daily digest with positive reinforcement, deep-link landing pad for tap-tracking, engagement analytics, adaptive throttling, inline web-push actions.
