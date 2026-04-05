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
                          └── /api/keys/status   → Reports which API keys are set via env vars
```

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
  toast_messages_json TEXT
);

-- Indexes on status, due_date, energy, created_at, routine_id, completed_at

-- Key-value store for settings, labels, version
CREATE TABLE app_data (
  collection TEXT PRIMARY KEY,
  data_json TEXT NOT NULL
);
```

Migrations are in `migrations/001-006.sql` and run automatically on startup.

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
5. Failed syncs queued in `boom_external_sync_queue` (200 cap), replayed on `online` event

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

### Key Status Endpoint

`GET /api/keys/status` returns `{ anthropic: boolean, notion: boolean, trello: boolean }` indicating whether each key is configured via environment variable. The frontend uses this to decide whether to show the API key input fields or a "set by environment variable" notice in Settings.

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
| `POST` | `/api/notion/search` | Search Notion pages |
| `GET` | `/api/notion/pages/:id` | Get a Notion page |
| `POST` | `/api/notion/pages` | Create a Notion page |
| `PATCH` | `/api/notion/pages/:id` | Update page title and/or replace content blocks |
| `GET` | `/api/notion/status` | Check Notion connection status |
| `GET` | `/api/notion/blocks/:id` | Read page content (paginated), returns blocks + plainText |
| `GET` | `/api/notion/children/:id` | List child pages of a parent |
| `POST` | `/api/notion/blocks/:id/children` | Append blocks to a page |
| `POST` | `/api/notion/file-uploads` | Create a Notion file upload |
| `POST` | `/api/notion/file-uploads/:id/send` | Send file data to Notion |
| `POST` | `/api/notion/databases/:id/query` | Query a Notion database |
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
| `GET` | `/api/gcal/events` | List events in a time range (for pull sync) |
| `GET` | `/api/tasks` | Get tasks (with optional filters) |
| `POST` | `/api/tasks` | Create a task |
| `PATCH` | `/api/tasks/:id` | Update a task |
| `DELETE` | `/api/tasks/:id` | Delete a task |
| `GET` | `/api/analytics` | Get analytics data |

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
