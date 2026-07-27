# Claude Dev Notes — Integrations

> Moved out of `CLAUDE.md` (2026-07-25) in the context-engineering restructure: `CLAUDE.md` now holds only invariants and gotchas, and deep implementation notes live here, loaded on demand. Content below is preserved from the former CLAUDE.md "Development Notes" and stays maintained — update it the same way CLAUDE.md used to be updated.

### Notion Sync (Pull + Ongoing)
Pulls actionable tasks from Notion pages into Boomerang, and keeps linked tasks in sync.

**Auth model (2026-05-23, Stage 3 complete):** Dual-path. MCP for most operations, REST API for file uploads and block-level writes. MCP connection via OAuth 2.0 + PKCE + DCR to `https://mcp.notion.com/mcp`. REST auth via `NOTION_INTEGRATION_TOKEN` env var (per-page Connection sharing required).

**IMPORTANT: The MCP OAuth token does NOT work as a REST `Authorization: Bearer` token.** The prior CLAUDE.md claim that "MCP token is valid for REST" was wrong — MCP tokens work for MCP protocol calls to `mcp.notion.com` but get 401 from `api.notion.com`. REST calls use the integration token from env.

**Operation Routing (update this table when changing Notion code):**

| Operation | Path | Why |
|---|---|---|
| **Search pages** | MCP `notion-search` | Works, returns JSON results. No REST advantage. |
| **Create database** | MCP `notion-create-database` | Custom tool with SQL DDL schema format — cleaner than raw API. |
| **Get page** | REST first, MCP fallback | `notionMCPProxy.js` `getPage()` tries `GET /v1/pages/{id}` when `NOTION_INTEGRATION_TOKEN` is set (structured `properties`), falls back to MCP `notion-fetch` if not configured or the REST call throws. |
| **Get child pages** | REST first, MCP fallback | `getChildPages()` calls `getBlockChildren()` (see below) and filters for `child_page` blocks; only falls back to text-extraction from MCP's markdown when no token is configured. |
| **Create page** | MCP `notion-create-pages` | Maps to `POST /v1/pages`. Properties are Notion API objects, children are string array. |
| **Create page in DB** | MCP `notion-create-pages` | Same tool, parent is `{ database_id }` instead of `{ page_id }`. |
| **Update page props** | MCP `notion-update-page` | Maps to `PATCH /v1/pages/{id}`. Properties + archived only — NO children/content support. |
| **Archive/restore** | MCP `notion-update-page` | `{ page_id, archived: true/false }` |
| **Query database** | REST first, MCP fallback | `queryDatabase()` uses `POST /v1/databases/{id}/query` (paginated, full properties) when a REST token is configured — this is the primary path, not a limitation-driven fallback. Only degrades to MCP `notion-fetch` (schema-only, no filter/sort) when no token is set. |
| **Get database** | REST first, MCP fallback | `getDatabase()` — REST returns clean JSON with the `archived` flag; MCP fallback only when no token configured. |
| **Get block content** | REST first, MCP fallback | `getBlockChildren()` — REST returns paginated structured blocks with `rich_text` arrays → clean plaintext conversion. MCP `notion-fetch` fallback returns enhanced markdown, not structured blocks, when no token is set. |
| **Update page content** | **REST only** | MCP `patch-page` doesn't take children. Uses the delete-blocks + append-blocks pattern (`updatePageContent()`). Requires `NOTION_INTEGRATION_TOKEN`. |
| **File uploads** | **REST only** | `POST /v1/file_uploads` + send. No MCP equivalent in the 14 available tools. Requires `NOTION_INTEGRATION_TOKEN` env var. |
| **Append blocks** | **REST only** | `PATCH /v1/blocks/{id}/children`. Used for file attachments. Requires integration token. |
| **Connection status** | MCP `getStatus()` | No REST call needed — checks `clientConnected` flag. |

Everywhere REST is the primary path, it's gated behind `NOTION_INTEGRATION_TOKEN` being set — a fresh install with only the MCP OAuth connection (no env token) transparently degrades to the MCP fallback for all of these, so both paths need to keep working. See `wiki/Notion-Integration.md` for the full table (kept in sync with this one) and the MCP tool ↔ REST-operation mapping.

**Full architecture, tool schemas, and endpoint reference:** See `wiki/Notion-Integration.md`. **Update that page whenever Notion code changes.**

**Implementation files:**
- `notionMCPProxy.js` — wraps MCP tool calls with response parsing. JSON-first, text fallback.
- `notionMCP.js` — MCP client, OAuth provider, tool cache, auto-reconnect.
- `knowledgeSync.js` — KB CRUD, all operations via proxy (no `token` param).
- `adviserToolsKnowledge.js` — Quokka KB tools, delegates to knowledgeSync.
- `adviserToolsIntegrations.js` — Quokka Notion tools (query, create, update page), via proxy.
- `server.js` — REST endpoints kept only for file uploads + block append. Everything else routes through proxy.

**Server Endpoints** (in `server.js`):
| Endpoint | Backend | Purpose |
|---|---|---|
| `POST /api/notion/search` | MCP | Search pages |
| `GET /api/notion/pages/:id` | MCP | Get page by ID |
| `POST /api/notion/pages` | MCP | Create page |
| `PATCH /api/notion/pages/:id` | MCP | Update page properties |
| `GET /api/notion/status` | MCP | Connection status |
| `GET /api/notion/blocks/:id` | MCP | Read page content |
| `GET /api/notion/children/:id` | MCP | List child pages |
| `POST /api/notion/databases/:id/query` | MCP | Query database |
| `POST /api/notion/file-uploads` | REST | Create file upload (no MCP equivalent) |
| `POST /api/notion/file-uploads/:id/send` | REST | Send file data (no MCP equivalent) |
| `POST /api/notion/blocks/:id/children` | REST | Append blocks for file attachments |
| `POST /api/notion/mcp/connect` | MCP | Start OAuth + DCR flow |
| `GET /api/notion/mcp/callback` | MCP | OAuth callback |
| `GET /api/notion/mcp/status` | MCP | MCP health |
| `GET /api/notion/mcp/tools` | MCP | List tools + inputSchema |
| `POST /api/notion/mcp/disconnect` | MCP | Clear tokens |

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

### Trello List Sync (Bidirectional, server-side — 2026-07-27)

Separate system from the task↔card sync above, and don't confuse them. That one
is **client-side and push-only** (`useExternalSync.js`, Boomerang → Trello) and
therefore blind to anything that happens while the app is closed. This one is
**server-side and bidirectional**: a Boomerang *list* (migration 047) mirrors a
checklist on a Trello card that someone else also edits.

- **Polling, not webhooks** — the server is tailnet-private and cannot receive
  callbacks (same constraint as Shippo). `startListSyncPolling(60s)`, plus a
  fire-and-forget kick after each local mutation.
- **`server/listMerge.js` is a pure 3-way merge** and holds every rule about
  who wins. Trello checkItems carry no per-item modification time, so a two-way
  diff cannot tell your edit from hers and degrades into last-writer-wins. The
  `shadow_*` columns are what the two sides last **agreed** on; each side is
  compared to that baseline separately.
- Fields resolve **independently** — a rename on her side plus a check-off on
  yours is cooperation, not a conflict. Real collisions keep the Boomerang
  value and are reported in `last_sync_error`.
- **A null shadow uses the LOCAL value as baseline**, so an unproven difference
  is pulled rather than pushed. When you can't prove who moved, the other side
  wins — pushing unproven local state is the only direction that destroys
  someone else's data.
- **Never deletes on Trello from a merge.** Only an explicit Boomerang delete
  (a tombstone) propagates. Soft deletes exist because a hard delete looks
  exactly like an item Trello hasn't sent yet, and the next poll resurrects it.
- **Wipe guard:** a poll missing >50% of previously-synced items (min 3) is
  treated as a bad response, not a mass delete. Deletions are skipped for that
  round; unrelated merges still apply.
- **A dev-shaped server merges inbound but never writes back**
  (`DEV_LIST_SYNC_WRITES=1` opts in). Two servers fighting over one real family
  list would look exactly like a sync bug.

Behaviour is pinned by `scripts/lists.test.mjs` (19 tests, in `npm test`).
Change the merge, run those first.

#### Planned: ordering and nesting (requested 2026-07-27)

Two follow-ups requested once prod lists were live and in daily use. Both are
designed but not built; the notes below exist because each has one trap that
is not obvious from the request.

**Nesting — Trello already nests TWO levels above the items, and the real
structure uses both.** Measured against the live board 2026-07-27 rather than
assumed:

```
Board  "Ongoing To Do"
└── Column (Trello calls this a "list")  "Shopping"      ← grouping level 1
    ├── Card  "2026 Groceries"                            ← grouping level 2
    │   ├── Checklist "Grocery"        → Cheese bars, Baking soda, …
    │   └── Checklist "Checklist 2"    → (a second checklist on one card)
    ├── Card  "Costco"      └── Checklist → items
    └── Card  "Trader Joe's" └── Checklist → items
```

So a **Boomerang list stays a Trello CHECKLIST** — that is where items live and
nothing about the merge changes. Nesting comes from the two *real Trello
containers* above it: the **card** and the **column**. Both round-trip
natively, so neither grouping level is Boomerang-only and both stay visible on
her side.

> ⚠️ **An earlier version of this note said "cap the depth at one level,
> because Trello has no nested checklists." That conclusion was wrong** — it
> reasoned from checklists alone and never looked at the board. Checklists
> indeed don't nest, but nesting doesn't have to come from them: card and
> column are real containers, and the family's actual structure already uses
> both. Look at the board before asserting what Trello can hold.

Both sibling patterns are live and they sit at *different depths*, so the UI
has to handle each:
- **sibling cards in a column** — Costco / Trader Joe's / 2026 Groceries
  under "Shopping"
- **sibling checklists in a card** — the requested "Groceries has Target and
  Walmart and HyVee in it"

> 🔤 **Naming collision, and it is a live footgun.** Trello's "list" is the
> board *column*; Boomerang's "list" is a Trello *checklist*. They are two
> different objects one word apart, in a codebase that already has
> `trello_list_id` free to be misread. Name the column field
> `trello_column_id` in Boomerang code (mapping to Trello's `idList`) and
> never reuse the bare word.

Schema: `lists` already carries `trello_card_id` and `trello_checklist_id`.
Add `trello_column_id` — `idList` is already on every card object Trello
returns, so it needs capturing during sync, not a new API surface. Grouping is
then fully derivable for synced lists (group by column, then by card); cache
the column and card *names* alongside, refreshed each sync, so the UI can
render `Shopping → 2026 Groceries → Grocery` without extra fetches.
Local-only lists have no Trello parents, so they still need an explicit
nullable `parent_id`.

> **Related bug to fix with this:** `syncList` currently adopts
> `checklists[0]` when no checklist is pinned. Multi-checklist cards were
> treated as the exception; the live board shows they are normal. Silently
> adopting the first of several is now actively wrong — linking should either
> require an explicit checklist choice or create one Boomerang list per
> checklist on the card.

**Sorting — name and recently-updated are VIEW state and must never write.**
Only drag writes. This is the trap: `position` is the field Trello orders by,
so a sort mode that "applied" itself by renumbering `position` would push a
full reorder of her checklist to Trello *every time the sort dropdown
changed*. Sort preference belongs in local view state; `position` stays the
one drag-owned column. (`position` is REAL precisely so a drag can insert
between two neighbours without renumbering the rest.)

Drag itself IS a new write path to her data — `PUT /checkItems/{id}` with a
new `pos`. It does not delete, so the never-delete-from-a-merge rule holds,
but it needs the same treatment as every other write: gated by
`DEV_LIST_SYNC_WRITES` on a dev-shaped server, and surfaced through
`last_sync_error` when held, or a held reorder is indistinguishable from a
broken one.

Open question to settle before building: whether "sort them" means the lists
themselves or the items within a list. The phrasing and "recently updated"
both point at lists (a per-item update time is not a thing anyone sorts a
grocery list by), but drag and name clearly want to apply to items too.

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
- All 17track fetches (`register`/`changecarrier`/`gettrackinfo`) carry `AbortSignal.timeout(15s)`, and the add-package route races its inline register+poll against an 8s cap (2026-07-20: un-timed awaits let a slow 17track hang `POST /api/packages` for minutes — reported as "Track button does nothing"; the client add form also now surfaces errors inline instead of swallowing them, incl. a friendly 409-duplicate message)
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
- Rename after creation (2026-07-24): expanded card → Rename → inline label edit (empty label falls back to the tracking number); rides the existing `PATCH /api/packages/:id` + `usePackages.editPackage`, which existed but had no UI affordance
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

**USPS rides Shippo, not 17track (2026-07-21).** USPS killed recipient-side third-party tracking on 2026-04-01 (Mailer-ID lockdown); 17track refuses USPS registration on the standard plan ("configure the 'Special Carriers'" — their paid add-on). Shippo (USPS-authorized) still returns full recipient-side tracking for arbitrary numbers — **verified live post-cutover** against a real in-transit parcel before building. `SHIPPO_CARRIERS` in `server/server.js` (currently just `usps`): 17track NEVER touches these numbers; with a Shippo token (`shippo_api_token` setting via Settings → Integrations → Shippo, or `SHIPPO_API_TOKEN` env) they poll via `server/shippoTracking.js` (`GET /tracks/{carrier}/{number}`, polling-only — the server is tailnet-private, no webhooks; USPS is not on Shippo's webhook-only list; non-Shippo shipments bill ~5¢/number). Without a token, USPS packages are "Link only" cards with a "Track on USPS.com" action (client gate: `usps && !shippo_api_token && no events`). **Amazon (TBA) is ALWAYS link-out** (`UNTRACKABLE_CARRIERS`): TBA ids live inside Amazon's closed system — 17track registers them and returns "Not found" forever, Shippo doesn't offer Amazon at all — so they're never polled anywhere and the card links to `track.amazon.com` (signed-in). Both tracking legs share `applyTrackingResult()` — the one place status transitions, ETA, signature tasks, delivered cleanup, and status-change notifications happen; never duplicate that block for a new tracking source. `shippo_api_token` is IN the Quokka secret blocklist; `check_integrations` has a free Shippo auth probe (mock-carrier test number, nothing billed).

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

**Location:** Manual only. Settings → Integrations → Weather → search city/zip → pick result. Geolocation browser prompt is intentionally avoided.

**Weather-aware "What Now?":** `getWhatNow()` now accepts an optional weather summary string and injects it into the AI system prompt. Rule: outdoor-leaning tasks (errand, physical, or keyword-matched titles like "mow") preferred on nice days before bad weather; indoor tasks preferred during rough weather with a better day coming up. Weather only mentioned in the reason when it genuinely affects the pick.

**Forecast badges on task cards:** Tasks with `due_date` inside the 7-day forecast window show a small weather emoji + high temp next to the due-date meta. Tooltip includes condition label + precipitation probability. Uses `src/components/WeatherBadge.jsx`; forecast data provided via `useWeather` hook → `TaskActionsContext`. **Kept parity (2026-07-04):** `src/kept/TodayView.jsx` renders the same badge for its `dayTasks` rows — `weatherByDate` is threaded from `AppV2.jsx` into `KeptShell`/`KeptDesktop` → `TodayView` (this wiring didn't exist when Kept's Today view was first built from scratch, since it doesn't reuse `TaskCard.jsx`). **Extended to Tasks (2026-07-11 bugfix):** `weatherByDate` was already flowing into `KeptShell`/`KeptDesktop` for `TodayView` but was never passed to `TasksViewKept` — reported as "Tasks is missing the weather." Now threaded the same way; `TasksViewKept.jsx`'s list rows show the badge with the identical due-date + `resolveWeatherVisibility()` gate. Kept's desktop Board view mode (`BoardView.jsx`) is a deliberately minimal card view (no due-date/tag meta shown at all, not just weather) and is out of scope. **Extended to Loops (2026-07-11):** the Loops tab/detail page show no due-dated task rows at all (cycle-chip trails and cadence stats only), so there was no gap there — but Today's inline "Loops" section (the routine cards shown above Anytime when a loop is due/done today) had the same missing wiring as Tasks, and a routine like "Mow" is exactly the outdoor-vs-weather case the feature exists for. Routines share the same `tags`/`energy` shape as tasks (it propagates to spawned tasks already), so the same `resolveWeatherVisibility()` gate applies directly; the lookup date is always "today" rather than the routine's own due-key, since overdue-or-not, today is when the user would actually act on it. Only the plain open-loop card shows it (not the cleared-today receipt or stack folder header) — those aren't "should I do this given the weather" moments. **Gated by relevance (2026-07-04 bugfix):** the badge only renders when `resolveWeatherVisibility()` returns `'visible'` — indoor/weather-independent tasks (tagged `inside`/`indoor`, e.g. "IFR Studying") no longer show a badge just because they have a due date. The legacy `TaskCard.jsx` badge (desktop Kanban/Projects/Stacks) is NOT yet gated this way — it doesn't currently receive a `labels` prop; tracked as a follow-up if noticed there too.

**"Best days" recommendation:** `pickBestDays()` in `src/components/WeatherSection.jsx` scores each forecast day (condition kind, precip probability, wind, temperature comfort) and picks up to 3 good ones. **Actually wired in 2026-07-04** (it existed as a fully-implemented, exported, but never-called utility since it was written — the "reveals a Best days line on the expanded card" behavior described in earlier docs never actually existed in any component). `WeatherSection` (used by `EditTaskModal`'s 7-day forecast widget) now renders a "☀️ Best days: …" callout above the grid and highlights the picked day(s) with a distinct green outline, separate from the amber due-date highlight (a day can be both). Computed live from the cached forecast — not written into the `notes` field — so user-typed notes stay clean.

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

**Weather notifications (REMOVED 2026-07-24 — weather folds into the digest's weather line; `weather_notifications_enabled`/`weather_notif_*` inert; `detectWeatherEvents()` survives for future digest enrichment). Historical:**
- `nice_day` — today is clear AND at least 2 of next 3 days are bad
- `bad_weekend` — any upcoming weekend day within 7 days is rainy/snowy/stormy
- `nice_window` — 2+ consecutive nice days coming after a bad day

Each event id (e.g. `weather:bad_weekend:2026-04-19:rain`) gets an 18-hour dedup TTL. No daily cap — multiple events in a day all notify. Delivered via push and/or email when `weather_notifications_enabled` is true. Respects quiet hours.

**Morning digest:** includes a weather summary line ("Today: ☀️ clear, 72°/48° · Tomorrow: 🌧️ rain, 55° · Sat: ⛈️ thunderstorm, 60°") when weather is configured.

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
4. **Phase 0 — obvious-junk pre-filter (free, no AI).** `isObviousJunk(subject, from)` short-circuits MFA / OTP / verification-code / sign-in-attempt / password-reset / "verify your email" / suspicious-activity / auto-reply / bounce subjects, plus common transactional sender shapes (`noreply@accounts.*`, `security-alerts@*`, `verify@*`). Match → mark `skipped` immediately. Saves AI tokens AND avoids the digit-regex misfiring on auth codes.
5. **Phase 1 — tracking-number regex extraction (free, instant)** on survivors. Hits become pending packages.
6. **Phase 2 — AI classifier** on the rest. Batched 10 at a time to Claude with a strict "default to skip" prompt: explicit ALWAYS-SKIP list (verification codes, password resets, sign-in alerts, receipts, marketing, social notifications, etc.) and a short ONLY-CREATE list (appointments with dates, bills due, documents to sign, returns, RSVPs, real human asks, government deadlines, medical follow-ups). Temperature pinned to 0 for deterministic, conservative output. Every result includes a required `reason` field — logged on every `[Gmail]` line so the user has visibility into classifications when tuning.
7. Creates tasks/packages with `gmail_pending: 1` flag for user review.
8. Broadcasts SSE update so all clients see new items immediately.

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
- AI analysis costs Anthropic API tokens (~10 emails per batch); the Phase 0 pre-filter and "skip" default cut this materially
- Email body truncated to 4000 chars for AI processing
- Only scans primary inbox (excludes promotions, social, updates, forums)
- Pending items still surface in the main task list with a yellow border + Keep/Dismiss buttons. Moving them out into a dedicated Suggestions inbox surface is a separate (parked) UX change.

### Knowledge Base (Notion-backed long-term reference)
Personal knowledge store Quokka can search. Where things are kept, how-tos, decisions and reasoning, people and their context. Lives as a Notion database the user owns; Boomerang keeps a server-side metadata cache for instant search.

**Storage.** New Notion database auto-created on first use under the user's existing `notion_sync_parent_id`. Properties: **Name** (title), **Type** (select: Location / How-to / Decision / Person), **Tags** (multi-select, freeform), **Related tasks** (rich_text, comma-separated task IDs), **Confidence** (select: Certain / Fuzzy). Body is markdown-ish (#, ##, -, - [ ]).

**Local cache.** `knowledge_index` table (migration 030) holds title / type / tags / ≤200-char summary / Notion URL / last-edited timestamp / archived flag. Background refresh every 5 min reconciles deletions made in Notion. Full body fetched on demand. Settings: `notion_knowledge_db_id`, `notion_knowledge_db_url`, `notion_knowledge_last_sync`.

**Task ↔ knowledge links.** `knowledge_page_ids_json` column on tasks (migration 030, JSON array of Notion page IDs). EditTaskModal "Linked knowledge" chip section above Manage. Mirrored on the Notion side via the "Related tasks" property so the relationship is visible from both directions.

**Capture model.** Auto-write — when the user tells Quokka "remember X is in the basement", `create_knowledge` runs inline during the chat turn (no plan-confirm). Edits and deletes go through the standard staged-plan + LIFO compensation flow because those touch pre-existing user data. Quokka is instructed to `search_knowledge` first and ask the user before creating a duplicate.

**Server endpoints (in `server.js`):**
| Endpoint | Purpose |
|---|---|
| `GET /api/knowledge/status` | Config status + last-sync timestamp |
| `POST /api/knowledge/setup` | Auto-create the Notion database, seed the local index |
| `GET /api/knowledge?q=&type=&limit=` | Search/filter/list cached items |
| `GET /api/knowledge/:id` | Cached metadata + on-demand body fetch |
| `POST /api/knowledge/refresh` | Force re-pull from Notion |

**Quokka tools (9):** `search_knowledge`, `get_knowledge`, `refresh_knowledge_index`, `list_knowledge` (read-only); `create_knowledge`, `update_knowledge`, `delete_knowledge`, `link_knowledge_to_task`, `unlink_knowledge_from_task` (staged with rollback). All gated behind `deps.knowledgeDbConfigured` — error tells the user to run setup before tools fire.

**Entry points.**
- **Quokka** (primary) — natural language. "What brand of cat food do I buy?", "Remember the Christmas decorations are in the attic crawlspace."
- **⋯ menu → Knowledge** — opens Quokka with a seeded "What's in my knowledge base?" draft in the input. User can hit send as-is or refine.
- **EditTaskModal** — Linked knowledge chip section for direct view/unlink + a search picker.
- **Settings → Integrations → Notion → Knowledge Base** — one-shot setup + Sync now button.

**Known limitations:**
- Body restore is best-effort on `update_knowledge` rollback — Notion's PATCH-children replaces blocks, so the full pre-update body would be needed for exact restore. Property restores (title/type/tags) work cleanly.
- External delete final per existing adviser policy — `delete_knowledge` archives in Notion (recoverable from Trash for 30 days); local rollback can only re-insert the cache row.
- Keyword search only (title/tags/summary). Semantic search across full bodies not wired.
- 5-minute refresh cadence — if the user adds an item in Notion directly and immediately asks Quokka, they need to tap "Sync now" or have Quokka call `refresh_knowledge_index`.

