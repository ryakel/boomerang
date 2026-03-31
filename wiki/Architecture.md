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

```sql
CREATE TABLE IF NOT EXISTS app_data (
  collection TEXT PRIMARY KEY,
  data_json TEXT NOT NULL
)
```

Collections stored: `tasks`, `routines`, `settings`, `labels`, `_version`.

### Task Data Model — Attachments

Each task object may include an `attachments` array. Each attachment entry contains a file name, MIME type, and base64-encoded file data. Attachments are stored inline in the task JSON and synced through the same localStorage/SQLite pipeline as all other task data. The maximum file size per attachment is 5 MB.

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
  → Fall back to ANTHROPIC_API_KEY / NOTION_INTEGRATION_TOKEN / TRELLO_API_KEY+TRELLO_TOKEN env var
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
| `PATCH` | `/api/notion/pages/:id` | Append content to a Notion page |
| `GET` | `/api/notion/status` | Check Notion connection status |
| `GET` | `/api/trello/status` | Check Trello connection status |
| `GET` | `/api/trello/boards` | List user's Trello boards |
| `GET` | `/api/trello/boards/:id/lists` | Get lists in a Trello board |
| `POST` | `/api/trello/cards` | Create a Trello card |
| `PATCH` | `/api/trello/cards/:id` | Update a Trello card |
| `DELETE` | `/api/trello/cards/:id` | Archive a Trello card |
| `GET` | `/api/trello/cards/:id` | Get a single Trello card |
| `POST` | `/api/trello/sync` | Pull cards from a Trello list |

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
