# Version History

Commit-level changelog for Boomerang, grouped by date. Sizes: `[XS]` trivial, `[S]` small, `[M]` medium, `[L]` large, `[XL]` extra-large.

---

## 2026-04-23

- feat(quokka): multi-chat with 30d TTL + star-to-keep + 7d unstar grace [L]
  - **Problem.** Quokka had a single "current thread" — every topic piled into the same conversation with no separation. History was a rolling 30-entry archive only populated when you hit "Start over" or left idle for 24h, and you could only rehydrate one at a time (losing the current on switch).
  - **New model.** `app_data.adviser_chats` holds an array of independent chats; `app_data.adviser_active_chat_id` tracks which one Quokka is currently reading/writing. Each chat: `{id, title, messages, sessionId, starred, createdAt, updatedAt, expiresAt}`. Switching between chats preserves state across the board.
  - **Lifetime rules.** On create or message activity, non-starred chats get `expiresAt = now + 30d` (rolling). Starring clears `expiresAt`; unstarring sets it to `now + 7d` and surfaces an orange banner in the chat: "This chat will be deleted in N days. Star to keep." A sweep runs on every list call, deleting anything past `expiresAt`.
  - **Migration.** One-shot on first access after upgrade: the old `adviser_thread` becomes the active chat *pre-starred* (so the upgrade can't silently lose your in-flight conversation), and every `adviser_archive` entry becomes a peer chat with a fresh 30d TTL clock. Legacy keys are zeroed out so migration only runs once.
  - **Server endpoints (replace old thread/archive routes):**
    - `GET /api/adviser/chats` — list summaries + activeId (sweep runs here)
    - `GET /api/adviser/chats/active` — active chat full content
    - `GET /api/adviser/chats/:id` — single chat full content
    - `POST /api/adviser/chats` — create new empty chat, auto-activate
    - `PATCH /api/adviser/chats/:id` — update messages/title/sessionId; bumps `updatedAt` + rolls 30d TTL
    - `DELETE /api/adviser/chats/:id` — delete; clears active if it was the active chat
    - `POST /api/adviser/chats/:id/activate` — switch active
    - `POST /api/adviser/chats/:id/star` — `expiresAt = null`
    - `POST /api/adviser/chats/:id/unstar` — `expiresAt = now + 7d`
  - **Client.** `useAdviser.js` rewritten: hydrates on mount by fetching chat list + active chat body, persists active chat's messages/sessionId debounced at 400ms (same as before), exposes `newChat`, `switchChat`, `deleteChat`, `starChat`, `unstarChat`. `Adviser.jsx` replaces the History panel with a full chat-list panel — star icon per row (filled = starred), delete icon, active indicator, "expires in Nd" meta when within 7 days of expiry. A `+` icon in the header creates a new chat.
  - **Expiry banner** in the active chat when `expiresAt - now < 7d && !starred`: one tap "star to keep" button makes it infinite. Covers both the normal 30d winding down and the unstar 7d grace.
  - Removed helpers: `adviserGetThread`, `adviserSaveThread`, `adviserClearThread`, `adviserListArchive`, `adviserGetArchivedThread`, `adviserDeleteArchivedThread`, `adviserRehydrateThread`. Replaced by the `adviser*Chat*` family in `src/api.js`.
  - Modified: `server.js`, `src/api.js`, `src/hooks/useAdviser.js`, `src/components/Adviser.jsx`, `src/components/Adviser.css`, `CLAUDE.md`, `wiki/Architecture.md`, `wiki/Features.md`

- refactor(notion): rip dead Stage 1 OAuth + duplicate quokka tools + legacy UI [M]
  - Stage 1's public-integration OAuth was never used — the flow required users to register a Notion "Public" integration with privacy policy / TOS / support email, which was absurd for a personal self-hosted app. Stage 2 (MCP with DCR) sidesteps that entirely, so Stage 1 was dead code.
  - Removed server-side: `NOTION_OAUTH_TOKENS_KEY`, `refreshNotionToken()`, `getNotionOAuthClientId()`, `envNotionOAuthClientId`, `envNotionOAuthClientSecret`, `/api/notion/oauth/auth-url`, `/api/notion/oauth/callback`, `/api/notion/oauth/status`, `/api/notion/oauth/disconnect`, plus `notion_oauth` field from `GET /api/keys/status`. `getNotionAccessToken(req)` simplified to MCP-first with legacy-token fallback (the Stage 1 OAuth check is gone).
  - Removed client-side: `notionOAuthAuthUrl`, `notionOAuthDisconnect` from `src/api.js`; Stage 1 OAuth state / handlers / postMessage listener / Settings UI section.
  - Removed duplicate Quokka Notion REST tools: `notion_search` and `notion_get_page` were registered on boot alongside the MCP-bridged `notion_mcp_*` tools — the model would pick REST unpredictably, causing the filament-inventory confusion (REST used the legacy integration token while MCP had user-scoped access). MCP's native `search` and `fetch` tools do the same job, so the duplicates are gone. `notion_query_database` stays — no MCP equivalent.
  - Simplified Settings UI: Notion section now shows only the MCP panel (primary path). Legacy integration-token input field + "Connect with token" button are gone; the server-side `NOTION_INTEGRATION_TOKEN` env var still works as a fallback and surfaces as a small inline note when MCP isn't connected.
  - `/api/notion/status` response cleaned up: was `{connected, auth: 'oauth'|'legacy', oauth, legacy, workspace_name, bot}`, now `{connected, auth: 'mcp'|'legacy', mcp, legacy, bot}`.
  - Modified: `server.js`, `src/api.js`, `src/components/Settings.jsx`, `adviserToolsIntegrations.js`

- fix(notion): let MCP OAuth token back all REST endpoints [XS]
  - Symptom: after connecting via MCP, Quokka would find the filament database via `notion_mcp_notion_search` (user-scoped access works) but then fall through to the REST `notion_query_database` tool, which was hitting the legacy integration token and returning "database not shared with integration" errors. MCP and REST were authing separately.
  - Fix: `getNotionAccessToken(req)` in `server.js` now checks `notion_mcp_tokens.access_token` first. Notion's MCP flow issues a standard OAuth access token (via Dynamic Client Registration), which is also valid as a bearer token against Notion's REST API — so every REST endpoint + Quokka's REST-backed tools now inherit MCP's user-scoped access automatically.
  - `notionMCP.js` now stamps `saved_at: Date.now()` on every token save so the server-side resolver can decide freshness without duplicating the MCP SDK's refresh logic. The SDK still owns refresh; the resolver just avoids using obviously-stale tokens.
  - Modified: `server.js`, `notionMCP.js`

- fix(docker): include notionMCP.js in production image [XS]
  - Stage 2's `notionMCP.js` was missing from the Dockerfile's explicit `COPY` list, so the production container crashed on startup with `ERR_MODULE_NOT_FOUND: Cannot find module '/app/notionMCP.js'`. Pre-push smoke test didn't catch it because it runs `node server.js` from the full repo checkout (where the file exists), not against a built Docker image. Added `notionMCP.js` to line 24.
  - Modified: `Dockerfile`, `wiki/Version-History.md`

- feat(notion): MCP client — Stage 2 of MCP migration [L]
  - **Why.** Stage 1's public-integration OAuth required the user to register a Notion "Public" integration (privacy policy, TOS, support email, etc.) — absurd friction for a personal self-hosted app. Notion's hosted MCP server sidesteps this entirely: it uses OAuth 2.0 + PKCE + Dynamic Client Registration (RFC 7591), so the client registers itself programmatically at the first auth attempt. No app pre-registration, no public-integration red tape.
  - **New module `notionMCP.js`.** Wraps `@modelcontextprotocol/sdk` v1.29. Implements `OAuthClientProvider` backed by `app_data` (three keys: `notion_mcp_client` for DCR result, `notion_mcp_tokens` for access/refresh, `notion_mcp_pkce` for transient PKCE state). Singleton `Client` + `StreamableHTTPClientTransport` against `https://mcp.notion.com/mcp`. Lazy reconnect, `autoReconnect()` on server startup if tokens exist.
  - **New endpoints:** `POST /api/notion/mcp/connect` (returns auth URL; the module captures Notion's redirect URL via `redirectToAuthorization()` during the aborted first connect), `GET /api/notion/mcp/callback` (calls `transport.finishAuth(code)`, reconnects, closes popup via postMessage), `GET /api/notion/mcp/status`, `GET /api/notion/mcp/tools`, `POST /api/notion/mcp/disconnect`.
  - **Dynamic Quokka tool registration.** After MCP connects and tool list is fetched, every read-only MCP tool (`annotations.readOnlyHint === true`) is bridged into Quokka's registry with a `notion_mcp_` prefix. Quokka now sees the full native Notion MCP tool surface in real time — no hardcoded wrappers. MCP tool results are normalized: JSON-text content is parsed, multi-text content is joined, errors throw. Mutations (non-readOnly) are skipped in Stage 2 — the existing REST-backed `notion_create_page` / `notion_update_page` tools keep running with their existing compensation/rollback logic. Stage 3 will migrate writes.
  - **Settings UI.** New "Notion MCP (recommended)" panel at the top of the Notion integration section. One button — "Connect via MCP" — opens Notion's OAuth popup. On successful callback, postMessage triggers a status refresh showing `Connected — N tools discovered`. Stage 1 public-integration OAuth and legacy integration-token paths drop below as fallbacks.
  - **Scope.** Stage 2 is read-only Quokka tools via MCP + user auth via MCP. The legacy REST proxy endpoints (used by `useNotionSync` / `useExternalSync`) remain unchanged — still authenticate via `getNotionAccessToken(req)` which falls back to the legacy integration token. Stage 3 will migrate those background sync paths to MCP and delete the REST proxy code.
  - New: `notionMCP.js`, `@modelcontextprotocol/sdk` dependency
  - Modified: `server.js`, `src/api.js`, `src/components/Settings.jsx`, `package.json`, `CLAUDE.md`, `wiki/Architecture.md`, `wiki/Features.md`

- feat(notion): OAuth auth + database-query tool — Stage 1 of MCP migration [M]
  - **Why.** The legacy internal-integration token model requires every page/database to be explicitly shared with the integration via Connections, and doesn't expose database-row querying through Quokka. Blocks both the unified-workspace-access goal and concrete use cases like surfacing filament-inventory rows inside the app.
  - **OAuth connection.** New `/api/notion/oauth/auth-url`, `/api/notion/oauth/callback`, `/api/notion/oauth/status`, `/api/notion/oauth/disconnect`. Server-side token storage at `app_data.notion_oauth_tokens` mirrors the GCal pattern (access + refresh + expiry). Client-side popup flow in Settings listens for `notion-connected` postMessage and refreshes status.
  - **Token resolution precedence.** `getNotionAccessToken(req)` prefers the OAuth access token (refreshing with 5-min buffer via HTTP Basic auth against `https://api.notion.com/v1/oauth/token`), falling back to the legacy integration token (`x-notion-token` header / `NOTION_INTEGRATION_TOKEN` env). All 13 existing `/api/notion/*` endpoints now use the async resolver, so switching to OAuth requires zero changes to existing sync code paths.
  - **Database queries, flattened.** `/api/notion/databases/:id/query` now returns `properties` as a plain flat map (title/rich_text → string, number → number, select/multi_select/status → name(s), date → {start, end}, checkbox → bool, etc.) via a new `flattenNotionProperties()` helper, so callers don't have to re-interpret Notion's property schema.
  - **Quokka tool.** New `notion_query_database` tool in `adviserToolsIntegrations.js` with the same flattened-property shape. Accepts `database_id`, optional Notion `filter` / `sorts` / `page_size` / `start_cursor`. 50 tools now (was 49).
  - **Settings UI.** The Notion block leads with an OAuth "Connect with Notion" button (when `NOTION_OAUTH_CLIENT_ID` + `NOTION_OAUTH_CLIENT_SECRET` are configured via env). Legacy integration-token path is collapsed under a "Use a legacy integration token instead" disclosure. Users with a legacy token connected see an "Upgrade to OAuth" nudge with an explanation of the per-page-sharing limitation.
  - **Sequencing.** This is Stage 1 of three. Stage 2 will migrate Quokka's 4 Notion tools (`notion_search`, `notion_get_page`, `notion_create_page`, `notion_update_page`) to call the hosted Notion MCP server via an MCP client, building reusable MCP-client infrastructure. Stage 3 will migrate `useNotionSync` + `useExternalSync` + the server REST proxy to MCP, deleting the legacy Notion REST code. After Stage 1 alone, both goals (no per-page-sharing friction, database queries) are already met for OAuth-connected users; stages 2-3 are architectural purity rather than user-visible capability.
  - Env vars: `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET` (new). Legacy `NOTION_INTEGRATION_TOKEN` still honored.
  - Modified: `server.js`, `adviserToolsIntegrations.js`, `src/api.js`, `src/components/Settings.jsx`, `CLAUDE.md`, `wiki/Architecture.md`, `wiki/Features.md`

---

## 2026-04-22

- feat(adviser): multi-part tasks + research tool + web search + checklist cruft cleanup [L]
  - **Multi-part tasks.** `create_task` now accepts `checklist_items` (array of `{text, checked?}`) and optional `checklist_name`. Staged one umbrella task with a populated sub-list instead of 8 bouncing independent tasks. System prompt rule #9 tells Quokka to prefer this shape when the user says "break this down" or "plan for X."
  - **Research tool.** New `research_task` (50 tools now). Takes a `task_id` + optional `focus`, makes its own Claude call with Anthropic's server-side web_search enabled, appends the result to the task's notes under a dated `--- Research (YYYY-MM-DD) ---` divider. Existing notes preserved. Compensation restores the pre-research notes on plan rollback.
  - **Web search in the main chat loop.** Added `{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }` to Quokka's tools array. Anthropic runs the search server-side during the API call and returns results inline — we surface the activity via SSE `tool_call` / `tool_result` events so the user sees "web_search: <query>" in the tool log. System prompt rule #8 tells Quokka when to use it.
  - **Checklist format cleanup.** The app had two coexisting checklist formats: a legacy flat `task.checklist` and a newer named `task.checklists` (multi-list). EditTaskModal migrated flat → named on read, but TaskCard + store.js + EditTaskModal's save path still wrote to the old field, and every DB row carried both columns. Cruft.
    - New migration `018_migrate_legacy_checklist.sql` converts any task with legacy items + no new-format data into a single named "Checklist" entry; leaves tasks that already have named checklists alone.
    - `src/components/TaskCard.jsx` now only reads `task.checklists` (the fallback wrapper around `task.checklist` is dead code post-migration) and the checkbox handler only writes to `checklists`.
    - `src/components/EditTaskModal.jsx` no longer writes `checklist: []` on save — the field stays `[]` naturally now that nothing populates it.
    - `adviserToolsTasks.js` `create_task` writes to `checklists` directly, not the legacy field.
    - `checklist_json` column stays in the DB (SQLite column drops are painful, will be inert going forward).
  - **Parked: attachment uploads.** No way to hand Quokka a PDF/image and say "make tasks from this" yet. Noted in CLAUDE.md under "Parked (future)."
  - Modified: `server.js`, `adviserToolsTasks.js`, `src/components/TaskCard.jsx`, `src/components/EditTaskModal.jsx`, `CLAUDE.md`
  - New: `migrations/018_migrate_legacy_checklist.sql`
- docs(adviser): fill architecture gaps — thread/archive endpoints + SSE resilience [XS]
  - `wiki/Architecture.md` routes table was missing the 7 thread/archive endpoints added across recent commits. Added them.
  - Added an "SSE resilience" paragraph to the AI Adviser architecture section covering the priming comment + `res.flush()`, 15s heartbeat, 90s per-turn timeout, and verbose logging — all introduced while debugging the iOS "Load failed" issue but never documented.
  - Added a "Thread persistence + archive" paragraph explaining the `app_data.adviser_thread` + `app_data.adviser_archive` storage model, 24h TTL auto-archive, 30-entry cap, 60-char title generation, and the rehydrate flow.
  - Modified: `wiki/Architecture.md`
- fix(adviser): tasks moved back to active via Quokka don't show up stale [XS]
  - `isStale()` in `src/store.js` computes staleness from `last_touched`. The manual UI flow (App.jsx:293) already sets `last_touched` on every status transition, so moving a task Backlog → Active via the UI resets the staleness timer correctly. Quokka's tools (`update_task`, `complete_task`, `reopen_task`, `move_to_projects`, `move_to_backlog`, `activate_task`, `snooze_task`, `create_task`, `spawn_routine_now`) were only writing `updated_at` — so a task pulled out of backlog after a week would land on the active list already flagged stale.
  - Fix: every adviser task mutation now writes `last_touched = now` alongside `updated_at`, matching what the manual UI does. Backlog → Active via Quokka now resets the stale timer the same way it would if you'd clicked Activate in the app.
  - Modified: `adviserToolsTasks.js`
- feat(adviser): archive past Quokka chats + rehydrate from history [M]
  - Previously: hitting "Start over" deleted the thread. Any prior conversation was gone.
  - Now: "Start over" (and the 24-hour idle TTL expiry) archive-then-clear. Past chats land in `app_data.adviser_archive`, a rolling list capped at 30 entries, newest first. Auto-generated title from the first user message (60-char truncation).
  - New endpoints: `GET /api/adviser/archive` (summaries), `GET /api/adviser/archive/:id` (full thread), `DELETE /api/adviser/archive/:id`, `POST /api/adviser/archive/:id/rehydrate` (archives the current thread, restores the selected one, removes it from the archive list so there are no duplicates). Rehydrate drops `sessionId` — a new server-side adviser session is minted on the next `/chat` call.
  - History UI: a small History icon next to "Start over" in the Adviser header (desktop + mobile). Opens an in-modal panel listing past chats with title, timestamp, message count, and a per-row trash button. Tapping a chat rehydrates it. Intentionally tucked away behind an icon — matches "doesn't need to be easy to get to but it should be possible."
  - Related fixes: added `console.error('[Quokka] stream error', err)` in the SSE onError handler so the next Load failed leaves a trace visible in Safari remote debugging (user-facing banner still shows the short message). Added a system-prompt rule (#7) telling Quokka to BATCH tool calls in a single assistant turn for bulk operations — serial tool-use loops over 15+ turns are the most likely cause of mobile Load failed.
  - Modified: `server.js`, `src/api.js`, `src/hooks/useAdviser.js`, `src/components/Adviser.jsx`, `src/components/Adviser.css`, `CLAUDE.md`
- feat(adviser): render markdown in Quokka messages [S]
  - Quokka's replies contain markdown (`**bold**`, bullet lists, headings) but we were rendering them as plain text, so the UI showed literal `**Apr 23**` stars and raw `- ` bullets. Hideous.
  - Added a tiny dependency-free markdown renderer at `src/utils/renderMarkdown.js` that handles the subset Claude actually emits: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`, `#`-headings, `-`/`*` bullet lists, numbered lists, and paragraph breaks. Returns React nodes (no `dangerouslySetInnerHTML`).
  - Added matching styles in `Adviser.css` with tight vertical rhythm so a whole message still reads as one block, not a document.
  - User bubbles stay plain text (no processing) — user input isn't markdown.
  - New: `src/utils/renderMarkdown.js`
  - Modified: `src/components/Adviser.jsx`, `src/components/Adviser.css`
- feat(adviser): thread persistence lives server-side, not localStorage [M]
  - Previously: Quokka's conversation lived in React state in App.jsx, which iOS Safari aggressively evicts when the PWA is backgrounded, switched away from, or inactive. User switches to Gmail to check something, comes back, thread is gone. Unusable.
  - Now: thread stored in `app_data.adviser_thread` inside the container. Three new endpoints: `GET /api/adviser/thread`, `POST /api/adviser/thread` (writes `{messages, sessionId, updatedAt}`), `DELETE /api/adviser/thread`. 24-hour idle TTL drops abandoned threads on next GET.
  - Client (`useAdviser`): hydrates from server on mount; persists on every `messages`/`sessionId` change with a 400ms debounce so a streaming response doesn't hammer the save endpoint; clears server thread on "Start over."
  - Messages capped to last 40 bubbles server-side to prevent the blob from ballooning.
  - Modified: `server.js`, `src/api.js`, `src/hooks/useAdviser.js`, `CLAUDE.md`
- fix(adviser): plan previews show names instead of raw IDs [S]
  - Before: "Update task 15c85061-8088-4829-b9f4-8fb1670df39e: due_date" — unreadable, you have no idea which task Quokka is about to touch.
  - After: "Update \"Buy furnace filters\": due_date" — the preview reads like English.
  - For local tasks/routines: added `taskLabel(id)` / `routineLabel(id)` helpers in `adviserToolsTasks.js` that do a sync DB lookup and return the title (truncated to 60 chars). All 13 task/routine preview strings now use them.
  - For external resources (GCal events, Notion pages, Trello cards) there's no local title to look up, so added optional `summary_hint` / `title_hint` / `name_hint` / `card_name_hint` fields to the respective tool schemas. Marked the fields explicitly as "not sent to the external API" — they only feed the preview string. Updated the Quokka system prompt to require hints on every external update/delete/archive call so the user never sees an opaque ID again.
  - Modified: `adviserToolsTasks.js`, `adviserToolsIntegrations.js`, `server.js`, `wiki/Version-History.md`
- feat(adviser): Quokka naming + thread persistence + debug logging + composer fix [M]
  - **Renamed to Quokka.** User-facing strings ("AI Adviser" → "Quokka") in the modal title, empty-state heading/subtitle, and header icon tooltip. System prompt now gives Claude the persona: a cheerful quokka-mascot vibe named after the perpetually-smiling Australian marsupial, with light Aussie warmth ("g'day", "no worries") kept deliberately restrained. Internal code (module filenames, `/api/adviser/*` endpoints, `.adviser-*` CSS classes, `showAdviser` state) stays as `adviser` — renaming plumbing adds churn without value.
  - **Thread now persists across modal close/reopen.** `useAdviser()` moved up to `App.jsx` so conversation state survives the user closing the modal. They can step away, check something, and come back to the same thread. The server session's 10-minute TTL still reclaims truly abandoned sessions; `adviserAbort()` only fires when the page actually unmounts.
  - **Composer textarea auto-grows.** Was stuck at `rows=1` so multi-line suggestions (like the "I've rescheduled my FAA exam" preset) got clipped at the bottom. Added an effect that syncs height to scrollHeight on every input change, plus bumped min-height 40→44, max-height 140→160, and added `env(safe-area-inset-bottom)` padding to the composer so it clears the iOS home indicator.
  - **Verbose server logging + timeouts.** The chat endpoint was silent — when something hung, `docker logs` showed nothing. Added `[Adviser <8char>]`-prefixed logs at every step (chat start, per-turn model call with latency, stop_reason, each tool call + result + timing, session end with staged-step count, errors). Added a 90-second per-turn timeout on Claude calls via a nested `AbortController` so the model can't hang indefinitely. Added a 15s heartbeat (`: heartbeat` comment line) to keep long-lived SSE connections alive through proxies. Primed the stream with `: connected\n\n` + `res.flush()` so iOS Safari / CDN layers commit the chunked response immediately instead of buffering the first KB.
  - Modified: `src/App.jsx`, `src/components/Adviser.jsx`, `src/components/Adviser.css`, `src/hooks/useAdviser.js`, `server.js`, `CLAUDE.md`, `wiki/Features.md`
- chore(deps): pin `serialize-javascript` >= 7.0.5 to close 4 high-sev advisories [XS]
  - Transitive dep of `vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-terser`. Versions <= 7.0.4 are vulnerable to RCE via RegExp.flags / Date.prototype.toISOString and to CPU-exhaustion DoS via crafted array-likes. Build-time only (never shipped to browsers), but GitHub Dependabot was flagging it on `main`.
  - Fix: added `"serialize-javascript": "^7.0.5"` to the existing `overrides` block in `package.json` (same pattern used for `lodash`). Preferred over `npm audit fix --force` because the latter would downgrade `vite-plugin-pwa` from 1.2.0 → 0.19.8 (breaking). `npm audit` now reports 0 vulnerabilities.
  - Modified: `package.json`, `package-lock.json`
- feat(adviser): AI Adviser — free-form natural-language control surface across every app capability [XL]
  - **Server-side engine (`adviserTools.js`)** — in-memory tool registry + session-scoped plan storage (10-min TTL, 1-min sweep). `registerTool()`, `handleToolCall()`, `commitPlan()`. Read-only tools run live during the tool-use loop; mutation tools return a preview string + stage a step. Plans commit atomically with LIFO compensation rollback on any step failure.
  - **49 tool definitions** across four modules:
    - `adviserToolsTasks.js` — 17 task + routine tools (search, CRUD, complete/reopen, snooze, move between statuses, routine CRUD + spawn-now)
    - `adviserToolsIntegrations.js` — 12 GCal + Notion + Trello tools (list/get/create/update/delete events, search pages, create/update pages, card + checklist operations)
    - `adviserToolsMisc.js` — 20 Gmail + packages + weather + settings + analytics tools
  - **Endpoints:**
    - `POST /api/adviser/chat` — SSE streaming. Runs the Claude tool-use loop (max 15 turns), emits `session`, `turn`, `message`, `tool_call`, `tool_result`, `plan`, `done`, `error` events live.
    - `POST /api/adviser/commit` — executes the staged plan. Coalesces SSE broadcast into a single version bump after success.
    - `POST /api/adviser/abort` — cancels the in-flight Claude request + clears the session.
    - `GET /api/adviser/tools` — diagnostic tool list.
  - **Rollback compensation:** local DB creates delete, updates restore captured pre-state, deletes re-insert. External API creates delete/archive the resource; updates capture pre-state via GET then PATCH back; external deletes log a warning (can't be restored).
  - **Search-first context:** no task dump in the system prompt. Model explores via `search_tasks`/`list_routines`/`gcal_list_events`/`notion_search` — same prompt size at 10 tasks or 1000.
  - **Security:** secret keys (API tokens) redacted in `get_settings` output, blocked from `update_settings` writes. Auth tokens pass through a per-request `deps` closure — Claude never sees them.
  - **Client (`src/components/Adviser.jsx` + `Adviser.css` + `src/hooks/useAdviser.js` + additions to `src/api.js`)** — chat modal (sheet on desktop, full-screen on mobile), live tool-call progress log, plan preview with Apply/Cancel bar, streaming SSE reader, abort button, prompt suggestions on empty state.
  - **Header reshuffle:** the ✨ sparkle AI Adviser icon takes the slot where the Settings gear used to be. Settings moves into the overflow `⋯` menu alongside Projects / Import / Analytics / Activity Log.
  - **Dockerfile:** `COPY` line updated to include all four adviser server modules.
  - New: `adviserTools.js`, `adviserToolsTasks.js`, `adviserToolsIntegrations.js`, `adviserToolsMisc.js`, `src/components/Adviser.jsx`, `src/components/Adviser.css`, `src/hooks/useAdviser.js`
  - Modified: `server.js`, `Dockerfile`, `src/App.jsx`, `src/api.js`
- fix(ui): priority toggle height mismatches on Routines + EditTaskModal [S]
  - `.priority-toggle` had no explicit height so it rendered ~28px tall next to ~36-40px date inputs — visible mismatch on the Priority / End Date row in the routine add/edit form. Added `min-height: 40px` + explicit horizontal padding so it matches siblings everywhere it's used.
  - In the EditTaskModal's three-column DUE / DUR (MIN) / PRI row, iOS renders `type="date"` a couple pixels taller than neighboring inputs due to its native picker chrome. Forced the row's inputs to `height: 40px` (was 36) and added `-webkit-appearance: none` + normalized `line-height` on the date input so all three fields share exactly the same exterior size.
  - Modified: `src/components/EditTaskModal.css`

---

## 2026-04-20

- feat(tasks): extract text from attachments via Claude vision/documents [S]
  - New `extractAttachmentText(attachments)` in `src/api.js` — sends images through Claude vision and PDFs through the documents API to pull verbatim text. Plain-text files (`text/*`) are decoded directly without a round-trip. Multi-file results get a `--- filename ---` separator.
  - "Extract text" button appears next to "+ Attach" in AddTaskModal and in the EditTaskModal attachments section once an attachment exists. Output is appended to the task's notes — useful for screenshots of receipts, photos of handwritten lists, or PDF instructions.
  - Modified: `src/api.js`, `src/hooks/useTaskForm.js`, `src/components/AddTaskModal.jsx`, `src/components/EditTaskModal.jsx`
- fix(tasks): photo attachments no longer crash the app [S]
  - Attaching a photo (especially from an iPhone) could crash Boomerang to a blank screen. Typical iPhone photos are 2-5 MB raw, which inflates to ~2.7-6.7 MB as base64. That blew past the server's 2 MB `express.json()` body limit on sync, past iOS Safari's ~5 MB `localStorage` quota when `saveTasks` ran, and could OOM the tab during `JSON.stringify`. Since there's no React ErrorBoundary, any of those threw a white screen.
  - New util `src/utils/imageCompress.js` — `processAttachment(file)` downscales image attachments through a canvas (max 1600px on the long edge, JPEG quality 0.82). Typical phone photos drop to 200-400 KB, fitting comfortably in all three limits. Non-image files go through a hardened FileReader wrapper that actually handles `onerror` and null `result`.
  - Both attachment entry points (quick-add via `useTaskForm`, edit modal's inline upload) now run through the util. HEIC or other undecodable images fall back to the raw base64 path so the attachment still works even if the browser can't re-encode it.
  - Modified: `src/hooks/useTaskForm.js`, `src/components/EditTaskModal.jsx`
  - New: `src/utils/imageCompress.js`

---

## 2026-04-17

- feat(routines): day-of-week scheduling + manual "Create Now" button [M]
  - New optional `schedule_day_of_week` column on routines (migration 017). When set (0=Sun … 6=Sat), `getNextDueDate()` computes the cadence interval end, then snaps forward to the first occurrence of that weekday. Example: weekly + Fri → spawn every Friday; quarterly + Sat → spawn on the first Saturday after the 3-month mark (may drift up to 6 days from the exact quarter, which is fine for "air filter on a weekend" style routines).
  - "Daily" cadence ignores the weekday anchor (daily fires every day anyway, so a weekday filter makes no sense).
  - New "On" dropdown in the routine add/edit form next to Frequency. Default "Any day" preserves current behavior.
  - Scheduled weekday is surfaced on the routine card's cadence meta (e.g. "weekly · Fri").
  - New "Create now" button in the expanded routine toolbar — bypasses the schedule and immediately spawns a one-off task with due date today. Does NOT add to `completed_history`, so the cadence clock is untouched until the task is completed. Useful for "I want to mow today even though it's not Friday."
  - New: `migrations/017_add_routine_schedule_day.sql`
  - Modified: `db.js`, `src/store.js`, `src/App.jsx`, `src/hooks/useRoutines.js`, `src/components/Routines.jsx`
- feat(tasks): background auto-sizer — every task gets sized regardless of create path [M]
  - Auto-sizing was only firing on the quick-add + add modal + Gmail-approve paths, plus the manual "Auto" button. Tasks from routines, Notion sync, Trello sync, GCal pull, markdown import were silently staying null-sized — breaking the points formula (`SIZE_POINTS[null] || 1` = 1 point instead of the intended 5 for a default M).
  - New column `size_inferred` on tasks (migration 016). Existing tasks with a non-null size are marked as already-inferred so they won't be re-processed.
  - `createTask` now defaults size to `'M'` instead of `null`, so points always compute correctly immediately. The background hook refines it later.
  - New hook `useSizeAutoInfer(tasks, updateTask)` in `src/hooks/useSizeAutoInfer.js` — on every render, picks the first active task with `size_inferred = false` that hasn't been attempted this session, waits 500ms, calls `inferSize`, then updates `{ size, energy, energyLevel, size_inferred: true }`. On API failure, leaves the flag false so the next page load retries. Throttled per render, so a just-migrated DB with dozens of un-inferred tasks doesn't hammer Anthropic.
  - Manual user size pick in EditTaskModal / AddTaskModal now marks `size_inferred = true` so the background hook doesn't override. Deselecting falls back to `'M'` + `size_inferred = false` to re-trigger auto-infer.
  - `addTask` marks `size_inferred = true` whenever the caller provides an explicit size (e.g. quick-add's inline inferSize call that updates the task).
  - New: `migrations/016_add_size_inferred.sql`, `src/hooks/useSizeAutoInfer.js`
  - Modified: `db.js`, `src/store.js`, `src/App.jsx`, `src/hooks/useTasks.js`, `src/hooks/useTaskForm.js`, `src/components/EditTaskModal.jsx`
- fix(weather): due-date badge in card top row also respects visibility [XS]
  - The little weather badge next to "due in 6d" was rendering for inside-tagged tasks because it was on a separate render path that didn't consult `resolveWeatherVisibility`
  - Gated the badge so it only renders when visibility is `'visible'` — `inside` tag, `weather_hidden`, or auto-detected indoor now hide the badge in addition to the expanded weather UI
  - Modified: `src/components/TaskCard.jsx`
- feat(weather): per-card hide control with persistence [M]
  - New `weather_hidden` boolean on tasks (migration 015) — persists per task and syncs across devices
  - Per-card X button on the weather line on each card → click to collapse weather into the drawer for that specific task
  - "Hide weather on this card" checkbox in the EditTaskModal mirrors the same flag
  - Inside the drawer, when the hide was explicit (weather_hidden), a "Show weather on this card" button appears to flip it back
  - Clicking the "Weather" text in the drawer header toggles the drawer open/closed (the whole button is the click target)
  - Visibility rule priority reordered so per-card hide wins over the `outside` tag (per-card is more explicit)
  - New: `migrations/015_add_weather_hidden.sql`
  - Modified: `db.js`, `src/components/WeatherSection.jsx`, `src/components/TaskCard.jsx`, `src/components/TaskCard.css`, `src/components/EditTaskModal.jsx`
- refactor(weather): drop global hide-on-cards toggle — per-task tag control only [XS]
  - Previous commit added a system-wide `weather_cards_drawer` setting, but the intent was per-card control only
  - Removed the Settings toggle and the `defaultHidden` param from `resolveWeatherVisibility`
  - Per-task override via `inside` / `outside` tags remains the only way to adjust weather visibility beyond auto-detect
  - Modified: `src/components/WeatherSection.jsx`, `src/components/Settings.jsx`, `src/components/TaskCard.jsx`
- feat(weather): tag-based + global visibility control with drawer fallback [M]
  - The auto-detect heuristic was over-eager — tasks like "Gardyn Tank Refresh" (energy=physical, indoor garden) were getting weather UI they didn't need. New `resolveWeatherVisibility()` in `WeatherSection.jsx` consolidates the rules:
    1. Task tagged `outside`/`outdoor` → always shown
    2. Task tagged `inside`/`indoor` → in a collapsible drawer
    3. Global setting `weather_cards_drawer` true → drawer for everything (except `outside` tag)
    4. Auto-detected outdoor → shown
    5. Otherwise → hidden
  - Drawer is a small "🌤 Weather" disclosure button — collapsed by default, click to open. Applies to both the card best-days line and the modal 7-day forecast.
  - New Settings → Weather → "Hide weather on cards" toggle (`weather_cards_drawer`) with hint about the `inside`/`outside` tag overrides.
  - Fixed: 7-DAY FORECAST label in the edit modal was scrunched against the Status pills above it. Added 16px top margin.
  - Removed duplicate outdoor-detection code from TaskCard + EditTaskModal — both now share `resolveWeatherVisibility` and `isOutdoorTaskShape` from `WeatherSection.jsx`
  - Modified: `src/components/WeatherSection.jsx`, `src/components/TaskCard.jsx`, `src/components/TaskCard.css`, `src/components/EditTaskModal.jsx`, `src/components/Settings.jsx`
- refactor(weather): swap card and modal — best days on card, 7-day forecast in edit modal [S]
  - Previous placement had the full 7-day forecast taking too much room on outdoor cards
  - Cards (quick-expand on the main list) now show only the compact "Best days: …" line with a sun icon. No forecast widget.
  - Full 7-day forecast widget (3+4 layout with wind) now lives in the EditTaskModal, above the Notes field, only for outdoor tasks
  - The forecast reacts to in-modal edits of title + energy
  - Modified: `src/components/TaskCard.jsx`, `src/components/EditTaskModal.jsx`
- fix(ui): scheduling row — due/dur/pri columns no longer overlap on narrow screens [XS]
  - Explicit classes `scheduling-due`, `scheduling-dur`, `scheduling-pri` with fixed flex-basis for duration (76px) and priority (88px), so the "DUR (MIN)" label doesn't bleed into the date column
  - Date column flexes with `min-width: 0` so the native date input shrinks cleanly
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/EditTaskModal.css`
- fix(weather): best-days belongs in the expanded card view, not the full edit modal [XS]
  - Previous commit put the best-days line in EditTaskModal; intent was the expanded inline card view (the "quick-edit" you get by tapping a card on the main list)
  - Forecast widget stays on the card as a section, best-days line (with sun icon) now renders in the expanded section above the notes
  - Modified: `src/components/TaskCard.jsx`, `src/components/EditTaskModal.jsx`
- refactor(weather): card forecast widget reshaped, best-days moved to edit modal [S]
  - Forecast section is now always visible on outdoor task cards (not gated on expand) so the layout is glanceable from the list
  - Reshaped layout: centered row of 3 days (larger) + centered row of 4 days (smaller) below — less visual weight per card
  - Best-days line removed from the card and now lives in the EditTaskModal, just above the Notes field, with a sun icon to make the recommendation feel like a tip
  - Best-days computation in the modal reacts to live edits to title + energy (e.g. retag "mow" with people energy and the line disappears)
  - Modified: `src/components/WeatherSection.jsx`, `src/components/TaskCard.jsx`, `src/components/TaskCard.css`, `src/components/EditTaskModal.jsx`
- feat(weather): 7-day forecast section + best-days recommendation on outdoor task cards [M]
  - New `WeatherSection` component renders a 7-day forecast grid in the mobile expanded view: condition icon, high/low, wind speed per day, with the task's due date highlighted
  - New best-days recommendation line shown just above the notes: picks up to 3 days within the forecast window scored for outdoor suitability (clear/partly cloudy, low precip, moderate wind, comfortable temp). Rendered alongside notes, not written into the `notes` field — always fresh as the forecast changes
  - Only shown for outdoor-leaning tasks: `energy === 'physical' || energy === 'errand'` OR title matches outdoor keywords (mow, yard, garden, paint deck, wash car, shovel snow, hike, etc.)
  - Added `wind_speed_10m_max` + `wind_gusts_10m_max` to the Open-Meteo fetch so daily wind is available
  - New: `src/components/WeatherSection.jsx`
  - Modified: `weatherSync.js`, `src/components/TaskCard.jsx`, `src/components/TaskCard.css`
- fix(docker): include weatherSync.js in production image [XS]
  - The Dockerfile's explicit server-file COPY list was missing `weatherSync.js`, causing the container to crash on startup with `ERR_MODULE_NOT_FOUND`
  - Added `weatherSync.js` to the production stage COPY line
  - Modified: `Dockerfile`
- feat(weather): weather-aware suggestions, notifications, and card badges [L]
  - New `weatherSync.js` server module — fetches a 7-day forecast from Open-Meteo (free, no API key) every 30 min, caches in `app_data.weather_cache`
  - Manual location: user searches by city/zip in Settings → Integrations → Weather; geocoding via Open-Meteo's free search endpoint
  - Weather-aware "What Now?" — the AI prompt is enriched with today/tomorrow/weekend outlook so outdoor tasks get suggested on nice days before bad weather and indoor tasks get prioritized on rough days
  - Forecast badges on task cards — tasks with a `due_date` inside the 7-day forecast window render a small weather icon + high temperature next to the due-date meta
  - Weather notifications — detects three event types (rare-nice-day, rough-weekend, nice-stretch-incoming), de-duped per event via `notification_throttle`, delivered via push and/or email. No daily cap — multiple weather events in a day will all notify; the same event won't re-fire for ~18h
  - Morning digest (push + email) now includes a weather summary line when configured
  - New server endpoints: `GET /api/weather`, `POST /api/weather/refresh`, `POST /api/weather/geocode`, `POST /api/weather/clear-cache`
  - New settings: `weather_enabled`, `weather_latitude`, `weather_longitude`, `weather_location_name`, `weather_timezone`, `weather_notifications_enabled`, `weather_notif_push`, `weather_notif_email`
  - Graceful degradation — module is a complete no-op when disabled or no location set
  - Changing the location invalidates the cache and triggers an immediate refresh
  - New: `weatherSync.js`, `src/hooks/useWeather.js`, `src/components/WeatherBadge.jsx`
  - Modified: `server.js`, `emailNotifications.js`, `pushNotifications.js`, `src/api.js`, `src/App.jsx`, `src/contexts/TaskActionsContext.jsx` (via taskActions value), `src/components/TaskCard.jsx`, `src/components/TaskCard.css`, `src/components/Settings.jsx`, `src/components/WhatNow.jsx`

---

## 2026-04-13

- refactor(ui): add TaskActionsContext to eliminate prop drilling [M]
  - New `src/contexts/TaskActionsContext.jsx` provides all task callbacks via React Context
  - TaskCard signature reduced from 13 props to 3: `task`, `expanded`, `onToggleExpand`
  - KanbanBoard simplified — no longer passes 7 callback props through KanbanColumn
  - ProjectsView simplified — only receives `tasks` and `onClose` props
  - Fixed broken search results TaskCard: was using wrong handlers (`completeTask` instead of `handleComplete`) and non-existent props (`onExpand`, `expanded`)
  - Removed unused `onBacklog` and `onFindRelated` props from mobile TaskCard calls
  - Wrapped `handleSnooze` in `useCallback` for context value stability
  - Bonus: `expanded` prop is now a boolean (was `expandedId` string comparison), so React.memo can skip re-rendering unaffected cards
  - Modified: `src/App.jsx`, `src/components/TaskCard.jsx`, `src/components/KanbanBoard.jsx`, `src/components/ProjectsView.jsx`
  - New: `src/contexts/TaskActionsContext.jsx`
- docs: full documentation audit and testing plan rebuild [S]
  - UPCOMING_FEATURES.md: removed 4 completed items (morning digest, AI nudges, batching, Trello multi-list)
  - Architecture.md: added GET /api/analytics/history route to route table
  - CLAUDE.md: added keyboard shortcuts and analytics dashboard to architecture notes
  - Features.md: added Header Layout section describing Packages + Settings + overflow menu
  - Testing-Plan.md: rebuilt from scratch — 15 sections, added full analytics coverage (charts, heat map, breakdowns, search), scheduling row fix, header menu tests
- fix(ui): scheduling row alignment — due, duration, priority fields properly aligned [XS]
  - All three fields now use `align-items: flex-end` so labels sit above and inputs line up at bottom
  - Consistent 36px input height across date, duration, and priority toggle
  - Duration input uses dedicated `dur-input` class (was using `add-input` with wrong sizing)
  - Removed inline style overrides that caused misalignment
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/EditTaskModal.css`
- feat(analytics): GitHub-style activity heat map and collapsible completed section [M]
  - 52-week heat map showing daily task or point density with color intensity scaling
  - Metric toggle (Tasks/Points) changes heat map coloring (green/orange)
  - Horizontal scroll on mobile for full year view
  - Month labels along top, DOW labels on left
  - Less/More legend for color scale
  - Completed tasks section now collapsible — click to expand, data fetched on demand
  - Modified: `src/components/Analytics.jsx`, `src/components/Analytics.css`
- feat(analytics): comprehensive analytics page with charts, breakdowns, search [L]
  - New `GET /api/analytics/history?days=30` endpoint — single SQL query aggregates all data server-side
  - Daily completion bar chart with tasks/points toggle and time range picker (7d/30d/90d/All)
  - Day-of-week productivity patterns chart with "best day" insight
  - Breakdowns by tag (with label colors), energy type (with icons), and size (with colored bars)
  - Completed tasks search with filters (energy type, size, tag)
  - All-time view groups by week to avoid hundreds of bars
  - Pure CSS bar charts — no charting libraries
  - Added `size` filter to `queryTasks` in db.js
  - Modified: `db.js`, `server.js`, `src/components/Analytics.jsx`, `src/components/Analytics.css`
- docs: add comprehensive Testing Plan to wiki [XS]
  - New `wiki/Testing-Plan.md` — checklist for all features from the April 2026 sprint
  - Updated `wiki/Features.md` — added markdown import, morning digest, desktop keyboard shortcuts, side drawer, richer cards, database sync, routine detection, recurring events, multi-list Trello, AI email nudges, batch mode
  - Updated `wiki/Architecture.md` — recurring event RRULE in external sync docs
  - Updated `CLAUDE.md` — header menu change noted
- style(ui): keep Packages and Settings visible, overflow the rest into menu [XS]
  - Header now shows: Packages icon + Settings gear + "..." overflow menu
  - Overflow menu contains: Projects, Import Markdown, Analytics, Activity Log
  - Modified: `src/App.jsx`
- refactor(ui): consolidate header icons into dropdown menu [S]
  - Replaced 4 individual icon buttons (Import, Projects, Packages, Settings) with a single "..." menu button
  - Menu also includes Analytics and Activity Log (previously only accessible from other views)
  - Click-outside to dismiss, Escape key closes menu
  - Cleaner header: just logo + menu trigger
  - Modified: `src/App.jsx`, `src/App.css`
- feat(notifications): morning digest, AI nudges, batch mode, Trello multi-list [L]
  - Morning digest (#15): scheduled daily summary via email and/or push at configurable time
  - AI email nudges (#16): nudge messages now use Claude AI when API key available, static fallback
  - Batch mode (#17): new `email_batch_mode` setting combines all notifications into one email
  - Trello multi-list sync (#18): checkbox list selector in Settings for syncing from multiple Trello lists
  - Settings UI: new Morning Digest section with email/push toggles and time picker, batch mode toggle, Trello multi-list checkboxes
  - Modified: `emailNotifications.js`, `pushNotifications.js`, `src/components/Settings.jsx`
- feat(sync): Google Calendar recurring event support [L]
  - Push sync: routine-spawned tasks now create recurring events with RRULE
  - Cadence mapping: daily, weekly, biweekly, monthly, quarterly, annually, custom → RRULE
  - Recurring event ID stored on routine (`gcal_recurring_event_id`) — subsequent spawned tasks link to it
  - Pull sync: recurring event instances collapsed by `recurringEventId` — only one task per series
  - Server returns `recurringEventId` on fetched events for recurring detection
  - Migration 014: `gcal_recurring_event_id` column on routines table
  - Modified: `src/hooks/useExternalSync.js`, `src/hooks/useGCalSync.js`, `src/store.js`, `server.js`
  - New: `migrations/014_add_gcal_recurring_id.sql`
- feat(notion): auto-suggest routines from recurring patterns in Notion pages [M]
  - During page-based Notion sync, AI analysis already returns `is_recurring` and `recurrence` fields
  - Recurring tasks now appear as purple suggestion banners instead of regular tasks
  - "Create" button creates a routine with the inferred cadence; "✕" dismisses permanently
  - Dismissed patterns stored in localStorage (`boom_notion_dismissed_patterns`)
  - Modified: `src/hooks/useNotionSync.js`, `src/App.jsx`
- feat(notion): wire database sync into UI [M]
  - New "Database Sync" section in Settings → Notion (when connected)
  - Paste database ID or URL → verifies connection → syncs rows as tasks
  - Extended useNotionSync hook with `pullFromDatabase()` — queries all database rows with pagination
  - Deduplication uses same two-pass system (exact title + AI fuzzy match)
  - Database rows are Notion pages — reuses existing `notion_page_id` field
  - New `notionQueryDatabase()` API function in api.js
  - Settings: `notion_db_id`, `notion_db_title`
  - Modified: `src/api.js`, `src/hooks/useNotionSync.js`, `src/components/Settings.jsx`
- feat(ui): markdown import for bulk task creation [M]
  - New import button (FileDown icon) in header opens markdown import modal
  - Paste markdown or upload .md/.txt files
  - Parses: checkboxes (`- [ ] task`), bullets (`- task`), numbered lists (`1. task`)
  - Sections (`## Header`) become group labels in preview
  - Two-step flow: paste/upload → preview with select/deselect → import
  - Skips completed checkboxes (`- [x]`) and plain text paragraphs
  - New: `src/utils/markdownImport.js`, `src/components/MarkdownImportModal.jsx`
  - Modified: `src/App.jsx`
- feat(ui): richer desktop task cards with notes preview and checklist progress [S]
  - Desktop cards now show truncated notes preview (first 120 chars, muted text)
  - Checklist progress bar with done/total count on cards with checklists
  - Tags were already always visible on desktop (no change needed)
  - Modified: `src/components/TaskCard.jsx`, `src/components/TaskCard.css`
- feat(ui): desktop keyboard shortcuts for task navigation and actions [M]
  - New `src/hooks/useKeyboardShortcuts.js` — centralized keyboard handler
  - Shortcuts: `n` (new task), `/` (search), `j`/`k`/arrows (navigate), `Enter`/`e` (edit), `x` (complete), `s` (snooze), `Escape` (close/deselect), `?` (help)
  - Visual highlight on keyboard-selected card via `keyboard-selected` CSS class
  - Auto-scroll selected task into view
  - Escape key closes topmost modal/overlay with stack-aware ordering
  - Shortcuts disabled when typing in inputs/textareas
  - Help overlay accessible via `?` key
  - Modified: `src/App.jsx`, `src/App.css`, `src/components/TaskCard.jsx`, `src/components/TaskCard.css`
  - New: `src/hooks/useKeyboardShortcuts.js`
- feat(ui): EditTaskModal renders as right-side drawer on desktop [M]
  - On desktop (≥768px), EditTaskModal slides in from the right as a 480px side drawer instead of bottom sheet
  - Overlay covers the left side (click to dismiss), no drag handle on desktop
  - New CSS classes: `sheet-overlay-drawer`, `sheet-drawer` with `slideInRight` animation
  - Mobile behavior unchanged (bottom sheet with pull-to-close handle)
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/Modal.css`
- docs(cleanup): fix stale entries and create tracking issues for untracked work [S]
  - CLAUDE.md: removed stale "Phase 2 Gmail not yet implemented" from Package Tracking
  - CLAUDE.md: added issue cross-references to known limitations, added #14-18 to tech debt list
  - CLAUDE.md: added TaskActionsContext to architecture notes
  - UPCOMING_FEATURES.md: removed GCal sync (already shipped), added AI email nudges, notification batching
  - Created issues: #15 (morning digest), #16 (AI email nudges), #17 (notification batching), #18 (Trello multi-list UI)

## 2026-04-12

- fix(sync): gcal pull filter diagnostic logging, larger filter input [XS]
  - Added detailed logging showing how many events filtered by Boomerang-managed, title filter, and remaining to import
  - Filter input changed from `settings-input` to `add-input` for a larger typing area
  - Modified: `src/hooks/useGCalSync.js`, `src/components/Settings.jsx`
- chore(settings): remove USPS Direct Tracking section from integrations [XS]
  - USPS API requires IP agreement for third-party tracking and was never functional
  - Removed the entire USPS settings UI (client ID/secret fields)
  - Modified: `src/components/Settings.jsx`
- feat(sync): title filter for Google Calendar pull sync [S]
  - New "Filter by title" text field in Settings → Google Calendar → Pull Sync
  - When set, only calendar events whose title contains the filter text (case-insensitive) are imported
  - Empty filter = import everything (existing behavior)
  - Modified: `src/components/Settings.jsx`, `src/hooks/useGCalSync.js`

## 2026-04-11

- feat(routines): Notion page search/create/link in routine add/edit form [M]
  - Routines can now find or create a Notion page directly from the add/edit form
  - Search existing pages, link to a match, or create a new page with `isRecurring` metadata (frequency included)
  - Linked Notion pages are shown on routine cards ("Open in Notion") and inherited by spawned tasks
  - Unlinking clears `notion_page_id` and `notion_url` on save
  - Wired `updateRoutineNotion` through App.jsx → Routines prop
  - Modified: `src/components/Routines.jsx`, `src/App.jsx`
- fix(ui): pull-to-close on handle only, routine deep link, scheduling alignment [S]
  - Pull-to-close touch handlers moved from entire sheet body to just the handle element — fixes choppy scrolling caused by touch interception
  - Removed `overscroll-behavior: contain` from sheet CSS
  - Routine link in EditTaskModal now passes routine ID → Routines view auto-opens the edit form for that specific routine
  - Scheduling row uses `align-items: flex-end` with natural heights instead of forced `height: 36px` — fixes priority being too low
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`, `src/components/Routines.jsx`, `src/App.jsx`, `src/components/EditTaskModal.css`, `src/components/Modal.css`
- fix(ui): smooth ref-based pull-to-close, duration/priority alignment [S]
  - Pull-to-close rewritten to use refs + direct DOM manipulation instead of React state, eliminating re-render jank during drag
  - Scheduling row uses `align-items: stretch` with explicit `height: 36px` on all three controls (date, duration, priority) so labels and inputs align perfectly
  - Priority toggle uses fixed `width: 76px` instead of `min-width` — no more row resizing when cycling states
  - Duration input background matches date input styling
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`, `src/components/EditTaskModal.css`
- fix(ui): pull-to-close isolation, duration styling, fixed-width priority toggle [S]
  - Pull-to-close now calls `stopPropagation` + `preventDefault` on touch move to prevent background pull-to-refresh from triggering simultaneously
  - Sheet CSS gets `overscroll-behavior: contain` to block scroll chaining
  - Duration input gets matching background, border-radius, and font-size so it aligns visually with date input
  - Priority toggle gets `min-width: 72px` and `justify-content: center` so the row doesn't resize when cycling between Normal/High/Low
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`, `src/components/EditTaskModal.css`, `src/components/Modal.css`
- fix(ui): fluid pull-to-close, scheduling row card, routine link [M]
  - Pull-to-close on modals is now fluid with visual tracking (translateY + opacity fade during drag) instead of threshold-only detection
  - "Part of routine" at top of EditTaskModal is now a tappable link that opens the Routines view
  - Scheduling row (due date + duration + priority) wrapped in a subtle card (`.scheduling-row`) with `justify-content: space-between` so fields spread evenly with breathing room
  - Date input uses `width: auto` so it sizes to content instead of expanding to fill
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/EditTaskModal.css`, `src/components/AddTaskModal.jsx`, `src/App.jsx`
- fix(ui): second pass form polish — spacing, button consistency, Trello clarity [M]
  - Due date on its own line; Duration + Priority on a second row with breathing room (no longer smashed together)
  - Labels section gets 16px bottom margin to visually separate from the categorization form-group
  - Normalized collapsible section buttons: empty sections show "+ Add" button, sections with content show chevron + count badge — applies to Attachments, Checklists, and Comments
  - Trello list picker now prefixed with "Trello list" label so it's clear what the dropdown is for
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`
- fix(ui): polish form layout — priority/date/duration row, pull-to-close, autosave position [M]
  - Priority moved to the Due Date + Duration row in EditTaskModal and AddTaskModal (out of the form-group)
  - Due date input made smaller (compact padding/font)
  - Autosave pill repositioned to float next to close button (informational, not in title row)
  - Attachments section uses "+" icon instead of chevron
  - Pull-to-close: swipe down on sheet to dismiss (EditTaskModal + AddTaskModal)
  - Energy Drain no longer wrapped in drain-priority-row since priority moved out
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`, `src/components/Modal.css`
- refactor(ui): redesign mobile form layouts for consistency and compactness [L]
  - **Routines form**: Priority + End Date on one inline row; priority as visible labeled toggle ("! High"/"Normal"); frequency + custom days inline; Notion as compact connection button instead of full section
  - **EditTaskModal**: Due Date + Duration on one inline row; Size/Energy Type/Drain/Priority grouped in a `.form-group` card; Checklists, Comments, and Attachments are collapsible sections (auto-expand if content exists, collapsed when empty); section headers show count badges
  - **AddTaskModal**: Same form-group pattern for categorization; Attachments + Notion as compact inline connection row instead of separate sections
  - New CSS patterns in EditTaskModal.css: `.form-inline-row`, `.form-inline-field`, `.form-group`, `.section-header`, `.section-badge`, `.section-chevron`, `.priority-toggle`, `.duration-inline`
  - Consistent label spacing (marginBottom: 4px) across all three forms
  - Modified: `src/components/Routines.jsx`, `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`, `src/components/EditTaskModal.css`
- fix(ui): restore native date/time picker appearance on mobile [S]
  - Date and time inputs shared `.routine-select` CSS which set `appearance: none` and added a SVG dropdown chevron — stripping native picker styling on iOS and making inputs look like blank select boxes
  - Overrode with `appearance: auto`, `-webkit-appearance: auto`, and `background-image: none` for `input[type="date"]` and `input[type="time"]` so native mobile date/time pickers render properly
  - Affects all 5 date inputs across the app: AddTaskModal, EditTaskModal, SnoozeModal, ExtendModal, Routines
  - Modified: `src/components/Settings.css`
- fix(routines): don't auto-complete task when converting to routine [XS]
  - `handleConvertToRoutine` was calling `completeTask(taskId)`, which closed the original task and fired completion side effects (toast, points, Trello sync)
  - Now links the existing task to the newly-created routine via `routine_id` so it stays active as the first instance
  - When the user later completes it, `handleComplete` logs the completion on the routine and `spawnDueTasks` takes over for future instances (it already skips routines that have an active task)
  - Modified: `src/App.jsx`

## 2026-04-08

- feat(packages): USPS direct tracking API — bypasses 17track for USPS packages [L]
  - OAuth 2.0 client credentials flow with 8-hour token caching
  - `pollUSPS()` calls USPS v3 tracking API with full event parsing
  - All USPS packages route to direct API: background poll, single refresh, initial create
  - Non-USPS packages (UPS, FedEx, etc.) continue using 17track
  - Status mapping, ETA extraction, signature detection, delivery notifications
  - Settings UI: "USPS Direct Tracking" section in Integrations with client ID/secret fields
  - Env vars: `USPS_CLIENT_ID`, `USPS_CLIENT_SECRET`
  - Modified: `server.js`, `store.js`, `Settings.jsx`, `.env.example`
- refactor(packages): normalize USPS 420+ZIP prefix at storage time [S]
  - Tracking numbers are now stripped of 420+ZIP routing prefix before saving to DB
  - Applies to manual add, Gmail import, and carrier detect endpoints
  - Startup fixup normalizes any existing packages in the database and clears `last_polled` to force re-registration
  - Removed the re-registration workaround since numbers are now clean at source
  - Modified: `server.js`, `gmailSync.js`
- fix(packages): re-register USPS 420-prefix packages with normalized number [S]
  - Background poll only registered never-polled packages, so USPS numbers registered under the old full 420+ZIP format were never re-registered with the normalized number
  - Now re-registers any package where `normalize17trackNumber` produces a different value
  - Modified: `server.js`
- fix(sync): improve tracking number extraction from HTML emails [S]
  - Extract tracking numbers from ALL link URLs (not just known carrier domains)
  - Added Shopify to tracked URL domains
  - Added debug logging for regex scan phase to diagnose misses
  - Modified: `gmailSync.js`
- fix(packages): strip USPS 420+ZIP prefix before sending to 17track [S]
  - 17track API rejects USPS numbers with the 420+ZIP routing prefix
  - New `normalize17trackNumber()` strips prefix for register, poll, and changecarrier calls
  - Result matching updated to handle normalized vs stored number mismatch
  - Modified: `server.js`
- feat(ui): server logs viewer in Settings with copy-all button [M]
  - Intercepts console.log/error/warn into 500-entry circular buffer
  - New `/api/logs` endpoint serves buffered logs
  - New "Logs" tab in Settings with monospace log viewer
  - Filter buttons: All, Gmail, GCal, Push, Email, DB, SSE, Errors
  - "Copy All" button copies full log text to clipboard
  - "Refresh" button to re-fetch latest logs
  - Errors shown in red, warnings in yellow
  - Modified: `server.js`, `Settings.jsx`, `Settings.css`
- fix(sync): fix pending flag on packages created before SQL fix [S]
  - Rescan now detects packages created with broken SQL (gmail_pending=0) and fixes their pending flag
  - Modified: `gmailSync.js`
- fix(sync): Gmail pending state not showing + duplicate packages [M]
  - `rowToTask`/`rowToPackage` and `taskToRow`/`packageToRow` in db.js were missing `gmail_message_id` and `gmail_pending` fields — pending state was never sent to client
  - Added yellow border + envelope badge to PackageCard for gmail_pending packages
  - Added tracking number dedup: checks existing packages before creating (both regex and AI phases)
  - Modified: `db.js`, `gmailSync.js`, `PackageCard.jsx`, `Packages.css`
- feat(sync): regex-based tracking number extraction before AI analysis [M]
  - Phase 1: scan email text for tracking number patterns (USPS, UPS, FedEx, Amazon, DHL)
  - Shipping context keywords (shipped, tracking, on the way, etc.) gate ambiguous patterns to reduce false positives
  - Packages found via regex skip AI entirely — instant, free, no API key needed
  - Auto-generates label from email subject/sender
  - Phase 2: remaining emails still go to AI for task extraction
  - Gmail sync now works without Anthropic key (regex-only mode for packages)
  - Modified: `gmailSync.js`
- fix(sync): improve Gmail email parsing for tracking number detection [S]
  - Extract tracking URLs from HTML link hrefs before stripping tags
  - Preserve HTML structure (br/p/div → newlines) instead of collapsing to whitespace
  - Append extracted tracking URLs as hints for AI analysis
  - Increase body truncation limit from 4000 to 6000 chars
  - Add USPS 420+ZIP prefix format to AI prompt
  - Modified: `gmailSync.js`
- feat(sync): Gmail integration — AI-powered email scanning for tasks and packages [XL]
  - OAuth flow using same Google credentials as GCal, separate token with gmail.readonly scope
  - Server-side scanning engine (`gmailSync.js`) fetches inbox, sends to Claude for analysis
  - AI extracts actionable tasks (title, due date, notes) and package tracking numbers (carrier auto-detect)
  - Pending review flow: Gmail-imported items show yellow border + envelope badge, expand to Keep/Dismiss
  - Pending items excluded from all notification engines (client, email, push)
  - Settings UI: connect/disconnect, scan days config, manual "Scan Now", auto-scan toggle
  - 5-minute server-side polling when auto-scan enabled
  - `gmail_processed` table for deduplication, `gmail_message_id`/`gmail_pending` columns on tasks + packages
  - New: `gmailSync.js`, `migrations/012_create_gmail_tables.sql`
  - Modified: `server.js`, `db.js`, `api.js`, `store.js`, `Settings.jsx`, `TaskCard.jsx`, `TaskCard.css`, `App.jsx`, `useNotifications.js`, `emailNotifications.js`, `pushNotifications.js`
- fix(ui): center Projects view title in mobile header [XS]
  - Modified: `ProjectsView.jsx`
- fix(ui): remove redundant analytics button from header [XS]
  - Analytics is already accessible via the MiniRings in the header stats row
  - Modified: `App.jsx`
- feat(tasks): add Projects space for longer-term tasks [M]
  - New `project` status — tasks moved here are fully excluded from all notifications (client, email, push)
  - Dedicated Projects view accessible via folder icon in header (purple, #A78BFA)
  - Mobile: full-screen overlay; Desktop: sheet modal + Kanban column
  - "Move to Projects" button in EditTaskModal, "Activate" to return to active
  - Projects excluded from GCal sync (events removed when moved), Trello status sync, and What Now
  - Stale/overdue visual indicators suppressed in Projects view
  - Separate from backlog — projects are intentional long-term work, backlog is someday/maybe
  - Modified: `store.js`, `App.jsx`, `App.css`, `EditTaskModal.jsx`, `TaskCard.jsx`, `KanbanBoard.jsx`, `useExternalSync.js`, `useTrelloSync.js`
  - New: `ProjectsView.jsx`, `ProjectsView.css`
- fix(notifications): test email always reported success even on failure [S]
  - `sendTestEmail()` ignored `sendEmail()` return value, always returned `{ success: true }`
  - Now performs SMTP send directly and propagates actual error messages to the UI
  - Modified: `emailNotifications.js`
- feat(notifications): Web Push notifications — background alerts even when app is closed [L]
  - Server-side push loop mirrors email notification logic (same types, frequencies, throttling, quiet hours)
  - VAPID keys auto-generated on first startup and persisted in database (no config needed)
  - Custom service worker (`push-sw.js`) handles push events and notification clicks
  - `push_subscriptions` DB table stores browser subscription endpoints
  - Settings UI: per-device enable, per-type toggles, test push button, disable button
  - Package status change push notifications (delivered, exception, out for delivery, signature)
  - Works on iOS 16.4+ (Home Screen PWA), all Android browsers, all desktop browsers
  - Server endpoints: `/api/push/status`, `/api/push/vapid-key`, `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/test`
  - Expired subscriptions (410/404) auto-cleaned from DB
  - Modified: `pushNotifications.js` (new), `push-sw.js` (new), `usePushSubscription.js` (new), `server.js`, `db.js`, `Settings.jsx`, `api.js`, `migrations/011`
- feat(notifications): SMS gateway detection for email notifications [S]
  - Detects SMS gateway recipients (tmomail.net, vtext.com, txt.att.net, etc.)
  - Sends text-only, 140-char truncated, minimal-header emails to phone numbers
  - Covers T-Mobile, Verizon, AT&T, Sprint, Metro, Cricket, Google Fi, Ting, Republic, US Cellular, Boost, TracFone
  - Status endpoint includes `sms_mode` flag
  - Modified: `emailNotifications.js`
- fix(notifications): test email always reported success even on failure [S]
  - `sendTestEmail()` ignored `sendEmail()` return value, always returned `{ success: true }`
  - Now performs SMTP send directly and propagates actual error messages to the UI
  - Modified: `emailNotifications.js`
- fix(notifications): env var NOTIFICATION_EMAIL now takes priority over UI setting [XS]
  - Previously UI-saved `email_address` overrode the env var
  - Modified: `emailNotifications.js`
- fix(ui): show effective email recipient when env var is set [XS]
  - Email field shows read-only env value instead of stale database value
  - Modified: `Settings.jsx`
- fix(ui): package tracking view uses desktop dialog on wide screens [M]
  - Packages was the only overlay still using mobile-only `settings-overlay` on desktop
  - Added `isDesktop` prop + `sheet-overlay/sheet` rendering pattern (matching Settings, Routines, Analytics)
  - Added desktop CSS with wider sheet (720px), hover states on cards
  - Modified: `Packages.jsx`, `Packages.css`, `App.jsx`

## 2026-04-07

- fix(notifications): specific error messages for email config status [XS]
  - Startup log now says exactly what's missing (e.g. "missing: NOTIFICATION_EMAIL")
  - Settings UI distinguishes between "SMTP not configured" vs "No recipient email"
  - Modified: `emailNotifications.js`, `Settings.jsx`
- fix(packages): fix single-package refresh being blocked by downgrade guard [S]
  - Downgrade guard was blocking ALL status updates on user-initiated refresh, not just downgrades
  - Removed guard from single-package refresh (user explicitly wants fresh data)
  - Guard remains on automated polling loop and refresh-all (background protection)
  - Also: skip 5-min throttle for pending packages so user can retry immediately
  - Modified: `server.js`
- fix(packages): show refresh result feedback on individual package cards [S]
  - Card refresh button shows green checkmark when updated, "Up to date" when throttled
  - Detail modal refresh button shows same feedback
  - No more silent flash-and-grey with no visible change
  - Modified: `PackageCard.jsx`, `PackageDetailModal.jsx`
- fix(packages): prevent status downgrade from stale 17track responses [M]
  - 17track intermittently returns `NotFound` for packages that already have valid tracking data
  - Added status rank guard in all three poll paths (polling loop, refresh-all, single refresh)
  - Packages at `in_transit` or higher will never be reverted to `pending`/`Not found yet`
  - Modified: `server.js`
- fix(packages): aggressive polling for newly added packages with no data [XS]
  - Packages stuck at "Not found yet" (pending, no events) now poll every 5min instead of 30min
  - Once 17track returns real tracking data, normal intervals resume
  - Modified: `server.js`
- fix(packages): show cooldown timer on refresh button [S]
  - 5-minute cooldown after refresh with visible `M:SS` countdown next to icon
  - Cooldown persists in localStorage across page reloads
  - Button disabled with tooltip showing remaining time
  - Modified: `src/components/Packages.jsx`
- chore: close GitHub issues #2 (routine infinite loop) and #7 (wiki reorg) — both resolved
- docs(claude): update technical debt section, remove closed issues, fix DB write interval
- fix(packages): add offline localStorage cache for packages [S]
  - Packages now persist in `boom_packages_v1` localStorage key
  - Instant render from cache on app open, then server fetch overwrites
  - If server is down, cached packages still display instead of empty list
  - Modified: `src/hooks/usePackages.js`
- fix(notifications): add emailNotifications.js to Docker image [XS]
  - Dockerfile stage 3 COPY line was missing the new file
  - Modified: `Dockerfile`
- feat(notifications): add email notification system [L]
  - Server-side notification engine mirrors client-side push logic (overdue, stale, nudge, high-priority, size, pileup)
  - Nodemailer transport with SMTP env var configuration (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
  - Gracefully tolerant: no-op when SMTP not configured, no errors, no broken UI
  - Per-type email toggles in Settings → Notifications (matches existing push notification UI pattern)
  - Package tracking email notifications (delivered, exception)
  - Dark-themed HTML email templates matching app aesthetic
  - Database migration for server-side notification throttle and log tables
  - Test email button and SMTP status indicator in settings
  - Docker compose files updated with SMTP env vars
  - DB persistence interval reduced from 3s to 1s for faster package tracking writes
  - New files: `emailNotifications.js`, `migrations/010_create_email_notification_tables.sql`
  - Modified: `server.js`, `db.js`, `src/store.js`, `src/api.js`, `Settings.jsx`, `docker-compose.yml`, `docker-compose.dev.yml`, `package.json`
- fix(packages): open tracking links in browser instead of PWA [XS]
  - PWAs intercept `target="_blank"` links within app scope
  - Use explicit `window.open()` to force external browser tab
  - Modified: `PackageCard.jsx`, `PackageDetailModal.jsx`
- fix(packages): update ALL duplicate packages, not just first match [S]
  - `batch.find()` only matched the first package with a given tracking number — duplicates never got updated
  - Changed to `batch.filter()` in both polling loop and refresh-all endpoint
  - Modified: `server.js`
- fix(packages): auto-refresh from 17track on app open [S]
  - Load cached data from DB first (instant render), then silently fire background refresh-all
  - SSE broadcast updates UI automatically when poll completes — no stale "Pending" cards
  - Modified: `src/hooks/usePackages.js`
- fix(packages): immediate poll on package create [S]
  - Package create now registers, waits 1.5s, polls 17track before responding
  - Card shows real status from the start instead of requiring manual refresh
  - Modified: `server.js`
- style(packages): shorten verbose carrier status on dashboard cards [XS]
  - "Shipper created a label..." → "Label created, package pending", etc.
  - Detail modal still shows full carrier text
  - Modified: `src/components/PackageCard.jsx`
- fix(packages): broaden ETA extraction for UPS [XS]
  - Check `estimated_delivery_date.from`, `.to`, and `scheduled_delivery_date` as fallbacks
  - Log `time_metrics` when no ETA found for diagnosis
  - Modified: `server.js`
- feat(packages): show ETA in detail status banner [XS]
  - ETA displayed on right side of status banner (e.g. "In Transit ... Tue, Apr 8")
  - Modified: `src/components/PackageDetailModal.jsx`, `src/components/Packages.css`
- style(ui): multi-colored analytics bar chart icon [XS]
  - Three colored bars: blue, amber, green
  - Modified: `src/App.jsx`
- fix(packages): animated swipe actions + colored header icons [S]
  - Rewrote swipe to track finger position in real-time (matching TaskCard pattern)
  - Header icons: analytics (multi-color), packages (amber), settings (muted)
  - Modified: `src/components/PackageCard.jsx`, `src/components/Packages.css`, `src/App.jsx`, `src/App.css`
- feat(packages): show duplicate badge on cards with same tracking number [XS]
  - Yellow "Duplicate" badge helps identify entries to clean up
  - Modified: `src/components/PackageCard.jsx`, `src/components/Packages.jsx`, `src/components/Packages.css`
- fix(packages): invalid date display + deduplicate registration calls [S]
  - ETA could be full ISO datetime — now strips time portion before parsing
  - Deduplicates tracking numbers in register17track
  - Modified: `src/components/PackageCard.jsx`, `src/components/PackageDetailModal.jsx`, `server.js`
- fix(packages): refresh-all registers ALL packages, not just unpolled [XS]
  - Modified: `server.js`
- fix(packages): auto-fix carrier for already-registered 17track numbers [S]
  - When register returns -18019901 (already registered), calls changecarrier to update
  - Modified: `server.js`
- fix(packages): pull-to-refresh on scroll container [XS]
  - Moved touch handlers to `.settings-overlay` (actual scroll container)
  - Modified: `src/components/Packages.jsx`
- feat(packages): batch refresh-all + carrier codes in 17track registration [M]
  - New `POST /api/packages/refresh-all` batches all active packages in one API call
  - Refresh button in header and pull-to-refresh trigger batch refresh
  - 17track numeric carrier IDs (UPS=100002, FedEx=100003, etc.) sent during registration
  - Modified: `server.js`, `src/api.js`, `src/hooks/usePackages.js`, `src/App.jsx`, `src/components/Packages.jsx`
- fix(packages): use 17track API v2.4 instead of v2.2 [XS]
  - API key was bound to v2.4 — v2.2 endpoints were returning empty results
  - Modified: `server.js`
- fix(packages): wrong request body format + status mapping for 17track v2.4 [M]
  - `gettrackinfo` was sending `{ number: [...] }` but v2.4 expects bare JSON array
  - Fixed status mapping to use `latest_status.status` object (not plain string)
  - Modified: `server.js`
- chore(config): add TRACKING_API_KEY to docker-compose and .env.example [XS]
  - Modified: `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`
- fix(packages): add 17track registration step — tracking wasn't working [M]
  - 17track API requires numbers to be registered via `/register` before `gettrackinfo` returns data
  - New `register17track()` called on package create, manual refresh, and first poll cycle
  - Added response logging to diagnose API parsing issues
  - Modified: `server.js`
- fix(packages): tracking env key not seen by frontend — missing from getKeyStatus [XS]
  - `getKeyStatus()` was dropping the `tracking` field from the server response
  - Modified: `src/api.js`, `src/components/Settings.jsx`
- fix(packages): tracking API key not reaching server + add connect/test button [M]
  - `getApiHeaders()` was missing the `x-tracking-key` header — UI-provided key never sent to server
  - `getTrackingApiKey()` now falls back to DB-stored settings (not just env var + header)
  - Polling loop uses `getTrackingApiKey()` instead of only `envTrackingApiKey`
  - `keys/status` endpoint now checks DB-stored key too
  - New `POST /api/packages/test-connection` endpoint uses free quota check (no tracking query consumed)
  - Settings integration section now has Test Connection button, status dot, retry on error
  - Auto-tests on mount when env var is configured
  - Modified: `src/api.js`, `server.js`, `src/components/Settings.jsx`
- style(packages): official carrier logos served as static SVG files [S]
  - Logo SVGs in `public/carriers/` for UPS, FedEx, USPS, DHL, Amazon, OnTrac, LaserShip
  - `CarrierLogo` component loads via `<img>` tags (drop-in replaceable files)
  - Used in PackageCard, PackageDetailModal, and add form carrier detection
  - New files: `src/components/CarrierLogo.jsx`, `public/carriers/*.svg`
  - Modified: `src/components/PackageCard.jsx`, `src/components/PackageDetailModal.jsx`, `src/components/Packages.jsx`
- style(packages): match Settings integration layout to other integrations [XS]
  - Package Tracking now uses the same collapsible row pattern as Anthropic/Notion/Trello/GCal
  - Expandable via `expandedIntegration` state, status dot, credential toggle, env var detection
  - Modified: `src/components/Settings.jsx`
- feat(packages): add duplicate tracking number detection [XS]
  - Client-side: live check as you type, shows warning with existing label, disables Add button
  - Server-side: 409 response if tracking number already exists
  - Case-insensitive comparison
  - Modified: `src/components/Packages.jsx`, `src/components/Packages.css`, `server.js`
- feat(packages): add sort options — by status, delivery date, or carrier [S]
  - Sort dropdown in header (same pattern as task sort)
  - Status (default): groups by Issues/Active/Delivered with ETA sub-sort
  - Delivery date: flat list sorted by ETA, then status
  - Carrier: grouped by carrier name, status sub-sort within each group
  - Modified: `src/components/Packages.jsx`, `src/components/Packages.css`

### Notifications
- fix(notifications): fix broken notification system — wrong status filter + stale settings closure [M]
  - All notification types except high-priority were filtering `status === 'open'` (a legacy status that no longer exists) instead of `not_started`/`doing`/`waiting` — making overdue, stale, nudge, size-based, and pile-up notifications completely dead
  - Settings were captured once in the useEffect closure and never re-read — toggling notifications or changing frequencies required a task change (via SSE hydration) to take effect
  - Rewrote to use a single always-running 1-minute interval that reads settings fresh each tick, uses a ref for current tasks, and filters by actual active statuses
  - Modified: `src/hooks/useNotifications.js`

### Package Tracking
- feat(packages): add package tracking with 17track API integration [XL]
  - New `packages` table (migration 009) with full tracking lifecycle
  - Server-side adaptive polling loop with batched 17track API queries (up to 40 per request)
  - Carrier auto-detection via regex patterns (USPS, UPS, FedEx, DHL, Amazon, OnTrac, LaserShip)
  - Carrier website fallback links on every card (works without API key)
  - Status-colored cards: pending (gray), in_transit (blue), out_for_delivery (teal), delivered (green), exception (red)
  - Full tracking timeline in detail modal with event history
  - Signature-required detection with auto-creation of high-priority errand task (full nagging escalation)
  - Delivery/exception/out-for-delivery/signature notifications (respects quiet hours)
  - Configurable auto-cleanup of delivered packages (default: 3 days)
  - API quota exhaustion handling with in-app banner and automatic recovery at midnight UTC
  - Manual refresh with 5-minute per-package throttle
  - Package Tracking settings in Integrations tab (API key, retention, notification toggles)
  - Package icon in header bar between Analytics and Settings
  - SSE broadcast on package updates for cross-client sync
  - New files: `migrations/009_create_packages_table.sql`, `src/utils/carrierDetect.js`, `src/components/Packages.jsx`, `src/components/Packages.css`, `src/components/PackageCard.jsx`, `src/components/PackageDetailModal.jsx`, `src/hooks/usePackages.js`, `src/hooks/usePackageNotifications.js`
  - Modified: `server.js`, `db.js`, `src/api.js`, `src/App.jsx`, `src/store.js`, `src/components/Settings.jsx`

---

## 2026-04-06

### Google Calendar
- fix(server): add trust proxy for correct protocol behind nginx [XS]
  - `req.protocol` now returns `https` behind reverse proxy, fixing OAuth redirect_uri mismatch
  - Modified: `server.js`
- style(ui): make GCal Disconnect and Remove All Events buttons more visible [XS]
  - Outlined buttons with clear text instead of blending into background
  - Remove All Events uses accent color to signal destructive action
  - Modified: `src/components/Settings.jsx`, `src/components/Settings.css`
- style(ui): replace native confirm() with in-app confirm dialog [S]
  - Custom styled dialog matching app design (dark theme, rounded corners)
  - Used for "Remove All Events" and "Clear all data" confirmations
  - Modified: `src/components/Settings.jsx`, `src/components/Modal.css`
- chore(docs): move technical debt and future plans to GitHub Issues [S]
  - Created issues #2-#10 for bugs, enhancements, and docs work
  - CLAUDE.md now references issues instead of inline task tracking
  - Modified: `CLAUDE.md`
- fix(gcal): push existing tasks to calendar on sync enable + new task create [M]
  - Initial sync picks up all tasks with due dates (today or future) when push sync is first enabled
  - New tasks with due dates now create calendar events immediately (was silently skipped)
  - 1-second stagger between initial sync events to avoid Google rate limits
  - Past due dates excluded from initial sync to avoid calendar clutter
  - Modified: `src/hooks/useExternalSync.js`
- fix(ui): hide Sync Now button unless pull sync is enabled [XS]
  - Button was confusing when user only wanted push sync
  - Modified: `src/components/Settings.jsx`
- feat(gcal): add bulk delete for Boomerang-managed calendar events [M]
  - New endpoint `POST /api/gcal/events/bulk-delete` — finds and deletes all events with "Managed by Boomerang" marker
  - "Remove All Events" button in Settings → Google Calendar section
  - Also clears `gcal_event_id` from all tasks to fully unlink
  - Confirmation dialog before executing, shows result count
  - Modified: `server.js`, `src/api.js`, `src/components/Settings.jsx`, `wiki/Architecture.md`

---

## 2026-04-05

### Dev Tooling
- feat(server): add dev seed system for realistic test data [M]
  - `SEED_DB=1` at container startup wipes DB and loads messy ADHD-realistic test data
  - Primary: calls Claude API to generate fresh data; fallback: static `scripts/seed-data.json`
  - 53 tasks (mixed statuses, overdue, heavily snoozed, missing fields), 7 routines, 12 labels
  - `scripts/generate-seed-data.js` for standalone regeneration with API key
  - New files: `seed.js`, `scripts/seed-data.json`, `scripts/generate-seed-data.js`
  - Modified: `server.js`, `docker-compose.dev.yml`, `Dockerfile`
- feat(api): add POST /api/dev/seed endpoint for on-demand re-seeding [XS]
  - Modified: `server.js`
- chore(ci): publish :dev container and isolate dev environment [S]
  - Dev CI workflow now publishes `ghcr.io/ryakel/boomerang:dev` on push to `dev` branch
  - `docker-compose.dev.yml` uses port 3002, `boomerang-dev` container/volume names, pulls `:dev` image
  - Tailscale + Portainer redeploy via `PORTAINER_DEV_WEBHOOK_URL`
  - PR builds still validate without pushing
  - Renamed `dev-ci.yml` → `build-and-publish-dev.yml` to match prod naming
  - Modified: `.github/workflows/build-and-publish-dev.yml`, `docker-compose.dev.yml`

### UI Consistency
- `b48bf40` fix(ui): unified label picker dropdown with colored pills across all modals [M]
- `pending` fix(ui): fix date pickers across entire app — consistent sizing and native styling [S]

### Labels & Filters
- `c093a69` feat(ui): drag-to-reorder labels and mobile label dropdown [M]

### Google Calendar Integration
- feat(gcal): add bidirectional Google Calendar sync with OAuth 2.0 [XL]
  - OAuth flow with server-side token management and auto-refresh
  - Push sync: tasks with due dates create calendar events with AI-inferred times
  - Pull sync: calendar events imported as tasks with AI deduplication
  - Settings UI with calendar picker, status filter, timed/all-day toggle
  - Migration 007: add `gcal_event_id` column to tasks table
  - New files: `src/hooks/useGCalSync.js`, `migrations/007_add_gcal_columns.sql`
  - Modified: `server.js`, `db.js`, `src/store.js`, `src/api.js`, `src/hooks/useExternalSync.js`, `src/components/Settings.jsx`, `src/App.jsx`
- feat(gcal): add per-task duration override and event buffer [M]
  - Per-task `gcal_duration` field in EditTaskModal (shown when due date is set)
  - Duration priority: task override → AI inference → size-based → global default
  - 15-min buffer checkbox in Settings adds breathing room around calendar events
  - Migration 008: add `gcal_duration` column to tasks table
  - Modified: `db.js`, `src/store.js`, `src/hooks/useExternalSync.js`, `src/components/EditTaskModal.jsx`, `src/components/Settings.jsx`

### Snooze
- `fe40289` fix(ui): overhaul snooze options with context-aware labels and custom picker [M]

### Settings
- `e0c5897` fix(ui): show version number in desktop settings window [XS]

### Routines
- `5268c16` feat(routines): add optional end date for routines and fix priority layout [M]

### CI/CD
- `2ba388f` chore(ci): add wiki path exclusion and dev branch pipeline [S]

### Toast Messages (AI Pre-generated)
- `f49ca71` fix(store): add toast_messages and trello_sync_enabled to DB schema [S]
- `f078d25` feat(ui): backfill toast messages for pre-existing tasks on load [S]
- `7f37ae6` feat(ui): pre-generate AI toast messages on task create/update [M]
- `f9d342b` fix(ui): fix double toast and stuck toast bugs [S]
- `a5cb9fc` fix(ui): prevent double toast on AI message arrival [S]

### Ongoing Sync (Trello + Notion)
- `d1b931e` feat(sync,ui): add Notion ongoing sync and AI-powered toast messages [L]
- `1631cb2` chore(sync): add server-side trello sync logging [XS]
- `e346774` fix(sync): fix trello sync guard and add change detection logging [S]
- `1f50654` fix(sync): hydrate Trello IDs for pre-existing linked tasks and fix push race [S]
- `b765270` fix(sync): remove unused import and fix ref cleanup lint errors [XS]

### CSS Monolith Split
- `756a762` refactor(ui): split App.css monolith into per-component CSS files [L]

### Trello Sync
- `d1b9d26` feat(trello): add ongoing bidirectional sync for linked cards [L]
- `2921d04` feat(trello): sync native checklists and attachments to Trello [M]

### Notion Sync
- `d00a76f` feat(notion): full sync with checklists, attachments, and metadata [L]

### File Attachments + Research
- `64d9ffb` feat(tasks): auto-research when attachments are added [S]
- `65a211f` feat(api): wire file attachments into research task flow [S]

### Snooze/Due Date Fix
- `fe11268` fix(tasks): prevent snooze past due date and show both dates on card [M]

### Offline Mutation Queue
- `e104416` feat(sync): add offline mutation queue with auto-replay [M]

### iOS PWA Fix
- `fc90478` fix(ui): use 100dvh to eliminate PWA bottom dead space [S]

### Docs
- `b410e29` chore: remove outdated design.md spec [XS]
- `86e202a` docs: update README with current features and tech stack [S]
- `1c22abe` docs(sync): update CLAUDE.md, wiki features/architecture/version-history [M]
- `5f086d5` docs(sync): update CLAUDE.md with completed technical debt items [M]
- `7bf3eae` docs(sync): mark offline mutation queue as done in CLAUDE.md [XS]

---

## 2026-04-04

### Bottom Bar Spacing
- `d497eb2` fix(ui): tighten bottom bar spacing and add fade/separator [S]
- `b03efc8` fix(ui): reduce bottom bar dead space and add separator [S]
- `b017949` fix(ui): halve bottom bar dead space and add subtle separator [XS]
- `b213440` fix(ui): reduce bottom bar dead space below quick-add [XS]
- `6f78981` Revert "fix(ui): reduce bottom bar dead space further [XS]"
- `48daf55` fix(ui): reduce bottom bar dead space further [XS]

### Desktop UI
- `cc2ffef` docs: update CLAUDE.md with completed desktop modal work [XS]
- `11972f1` fix(ui): fix Routines +New button using giant submit-btn style [XS]
- `e9bb35f` feat(ui): desktop Analytics uses sheet-overlay modal pattern [S]
- `c0bf373` feat(ui): desktop Settings/Routines use sheet-overlay modal pattern [M]
- `b36489a` fix(ui): fix settings modal transparent bg in light mode, update docs [XS]
- `4098fc8` fix(ui): fix desktop overlays, hide mobile bottom bar, update tech debt [S]
- `9205fb8` fix(ui): desktop WhatNow modal, hide redundant quick-add, cleanup [S]
- `295b1c4` feat(ui): fix desktop bugs + add kanban drag-and-drop [M]
- `14bde8c` feat(ui): content-sized kanban columns with per-column add-card [S]
- `19f334c` feat(ui): add desktop kanban board view with 5 columns [L]
- `cee56b1` feat(ui): add desktop layout and hover states via media queries [M]
- `b4533c3` fix(ui): tighten mobile bottom bar spacing [XS]

### Checklists
- `0e11ca1` fix(tasks): persist checklists to database, fix Trello push [M]
- `f8eea88` feat(tasks): add Trello-style multiple named checklists with drag-and-drop [L]

### Integrations UI
- `e9fdb86` feat(ui): auto-test env integrations on load, add disconnect/test buttons [M]
- `78b4cbe` feat(ui): redesign integrations tab as accordion with status dots [M]
- `a134a45` feat(ui): make Notion template and Trello board/list sections collapsible [S]
- `d3c56db` fix(ui): show Notion template without connect, fix button overflow, add loading pill [M]

### Notion Templates
- `2c0f1e6` fix(notion): resolve tag IDs to display names in page template [S]
- `b779821` feat(notion): add metadata placeholders and rich text to page template [M]
- `2a5132d` feat(notion): add configurable page template with rich block types [M]

### Database Migration (JSON → SQL)
- `9609148` perf(server): transaction-wrap bulk writes, remove git dependency [S]
- `de10f42` fix(server): copy migrations dir into Docker image and guard seed [XS]
- `9853a2f` feat(store): migrate database from JSON blobs to proper SQL tables [XL]
- `7e71216` feat(store): migrate database from JSON blobs to proper SQL tables [XL]

### Server-Side Features
- `6a7b5a9` feat(api): add server-side analytics, done pagination, and task search [L]

### Icons
- `0c6a10e` fix(ui): replace emoji icons with Lucide, add search clear button [S]

### Config
- `6aac59e` chore(config): move git rules to top of CLAUDE.md, add session hook, bump lodash [M]

### Energy UI Refinement
- `028399c` fix(ui): align drain buttons and priority button in same row [XS]
- `5da5021` fix(ui): priority label above ! button, right-aligned next to Energy Drain [XS]
- `76cf174` fix(ui): move priority button right-aligned next to Energy Drain label [S]
- `09c7da5` feat(ui): remove confrontation energy type, redesign priority button, rename drain level [M]
- `8b74716` fix(ui): restore energy type labels under icons in modal selectors [S]
- `e8246b4` fix(ui): fix drain level button centering, swap remaining emoji with Lucide icons [S]
- `2960261` feat(ui): replace CSS hack icons with Lucide vector icons [S]
- `bf48fb3` fix(ui): replace broken CSS shape icons with colored letter circles [S]
- `8cc5a56` fix(ui): normalize all energy type icons to same 16x16 size [XS]
- `a311c9e` fix(ui): icon-only energy selectors, fix people and physical icons [S]

---

## 2026-04-03

### Energy/Capacity Tagging + Notion Pull Sync
- `9cf96da` feat(tasks): merge energy tagging, Notion sync, and architecture refactor [XL]
- `15a2fb1` feat(tasks): add energy/capacity tagging and Notion pull sync [XL]
- `3a49177` refactor(ui): extract shared hooks and deduplicate modal/sync logic [L]

### Performance
- `4ad38e3` perf(ui): wrap TaskCard in React.memo to prevent unnecessary re-renders [XS]

### Energy UI
- `8cb3c45` fix(ui): replace emoji with CSS/text, redesign energy indicators [M]
- `0691a26` fix(ui): restore non-energy emoji that were incorrectly removed [XS]
- `4dc5969` fix(ui): replace text labels with CSS icons, move energy to right side [M]
- `93c8db5` fix(ui): move energy badge below date on its own right-aligned row [XS]
- `c732d3a` fix(ui): energy badge in tags row, right-aligned opposite tags [XS]

### Docs
- `77f1249` docs: require user confirmation before pushing to main [XS]
- `ac75121` docs: enforce push-to-main workflow, prevent feature branch conflicts [XS]
- `37e7785` docs: add technical debt tracking and migration plans to CLAUDE.md [S]

---

## 2026-04-02

### Core Features
- `52d3eb6` fix(ui): only one task card expanded at a time [S]
- `c870524` feat(ui): add Doing section at top of task list [S]

### Trello
- `9e36f99` fix(trello): add logging and archive fallback for Trello push failures [S]
- `ad7e35e` feat(trello): add bidirectional reconciliation during sync [M]
