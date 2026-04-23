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
                          ├── /api/weather/*     → Weather forecast cache, refresh, geocode (Open-Meteo)
                          └── /api/keys/status   → Reports which API keys are set via env vars
```

## Component Architecture

**TaskActionsContext** (`src/contexts/TaskActionsContext.jsx`): All task action callbacks (`onComplete`, `onSnooze`, `onEdit`, `onExtend`, `onStatusChange`, `onUpdate`, `onDelete`, `onGmailApprove`, `onGmailDismiss`) plus `isDesktop` are provided via React Context. TaskCard only receives `task`, `expanded`, and `onToggleExpand` as props. KanbanBoard and ProjectsView consume actions from context rather than prop drilling.

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
| `PUT` | `/api/data` | Replace all data in SQLite (requires `_clientId`) |
| `POST` | `/api/data` | Same as PUT — for `navigator.sendBeacon` (requires `_clientId`) |
| `PATCH` | `/api/data/:collection` | Update a single collection |
| `DELETE` | `/api/data` | Clear all data |
| `POST` | `/api/log` | Client log relay (diagnostics to server terminal) |
| `POST` | `/api/messages` | Proxy to Anthropic Claude API |
| `POST` | `/api/adviser/chat` | SSE stream — runs the Claude tool-use loop for the AI Adviser |
| `POST` | `/api/adviser/commit` | Execute the staged plan atomically with LIFO rollback on failure |
| `POST` | `/api/adviser/abort` | Abort in-flight adviser stream + clear session |
| `GET` | `/api/adviser/tools` | Diagnostic — lists all 50 registered adviser tool names |
| `GET` | `/api/adviser/thread` | Current Quokka conversation (messages + sessionId) |
| `POST` | `/api/adviser/thread` | Persist current thread (client saves debounced on every change) |
| `DELETE` | `/api/adviser/thread` | Archive-then-clear the current thread ("Start over") |
| `GET` | `/api/adviser/archive` | List archived thread summaries (id, title, archivedAt, messageCount) |
| `GET` | `/api/adviser/archive/:id` | Full archived thread by id |
| `DELETE` | `/api/adviser/archive/:id` | Remove an archived thread |
| `POST` | `/api/adviser/archive/:id/rehydrate` | Archive current thread, restore the archived one as current |
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
| `POST` | `/api/trello/sync` | Pull cards from a Trello list |
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
| `POST` | `/api/weather/clear-cache` | Clear the cached forecast |

## AI Adviser

`adviserTools.js` is the engine. `adviserToolsTasks.js`, `adviserToolsIntegrations.js`, and `adviserToolsMisc.js` register 49 tools via `registerTool({ name, description, schema, readOnly, preview, execute })`.

**Staged execution.** During `/api/adviser/chat`, read-only tools run immediately and return data; mutation tools do nothing except return a `preview` string and push a staged step into the session's plan. When the user confirms, `/api/adviser/commit` runs every staged step in order via `commitPlan()`.

**Rollback compensation.** Each `execute()` returns `{ result, compensation }`. Compensations are collected LIFO during the commit. If step N fails, compensations 1..N-1 are invoked in reverse. Local DB mutations capture the pre-state (full record) so the compensation can upsert it back verbatim. External API mutations (GCal, Notion, Trello) capture the pre-state via GET, then call the inverse operation (delete created resources, PATCH back updated ones). External deletes cannot be rolled back and the compensation just logs a warning.

**Coalesced SSE broadcast.** Individual mutation handlers normally call `bumpVersion() + broadcast(version, clientId)` on every write. During `commitPlan()`, `deps.suppressBroadcast = true` is passed through to the handlers (which currently operate through the db layer directly, sidestepping the per-route broadcast). A single `bumpVersion() + broadcast(newVersion, 'adviser')` fires at the end of a successful commit.

**Session lifecycle.** Sessions are in-memory only (`sessions` Map in `adviserTools.js`). Keyed by `crypto.randomUUID()`, 10-minute TTL, 1-minute sweep. Abort via `POST /api/adviser/abort` with sessionId — the `AbortController` for the in-flight Claude stream is aborted, the `aborted` flag is set, and the session is cleared. Successful commit also clears the session.

**Max-turn guard.** The tool-use loop inside `/api/adviser/chat` caps at 15 iterations. Each iteration is one round-trip to Claude (with all 49 tool schemas in the request). If the model hits the cap without `stop_reason === 'end_turn'`, whatever plan is staged so far is returned to the client.

**Security.** Secret keys (`anthropic_api_key`, `notion_token`, `trello_api_key`, `trello_secret`, `gcal_client_secret`, `tracking_api_key`) are redacted in `get_settings` output and blocked from `update_settings` writes. Auth tokens flow through a per-request `deps` object constructed by `adviserDeps(req)` — Claude never sees them; tool handlers receive them as closure values.

**SSE resilience.** `/api/adviser/chat` primes the stream with a `: connected\n\n` comment + explicit `res.flush()` so iOS Safari / CDN proxies commit the chunked response immediately instead of buffering the first KB. A 15-second heartbeat comment keeps long-lived connections alive through idle-connection killers. Each Claude API call inside the tool-use loop is wrapped in a nested `AbortController` with a 90-second timeout — if the upstream hangs, the loop surfaces a clean `error` event rather than leaving the client on an infinite spinner. Verbose per-turn logging (`[Adviser <8char>] turn N/15 — calling model…`, tool calls + timing, `chat done — staged N step(s)`) is written to the container log for post-hoc diagnosis.

**Thread persistence + archive.** Current conversation stored in `app_data.adviser_thread` (JSON blob). Client hydrates on mount, persists on every `messages`/`sessionId` change with a 400ms debounce. 24-hour idle TTL triggers auto-archive on the next GET. "Start over" (`DELETE /api/adviser/thread`) archives the current thread into `app_data.adviser_archive` — a rolling list, newest first, capped at 30 entries. `POST /api/adviser/archive/:id/rehydrate` archives whatever is currently active, restores the selected archived thread as current (dropping it from archive so there are no duplicates), and clears the sessionId so the next `/chat` call mints a fresh server session. Thread titles are auto-generated from the first user message, 60-char truncation.

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
