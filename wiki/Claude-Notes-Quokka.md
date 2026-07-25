# Claude Dev Notes — Quokka (AI Adviser)

> Moved out of `CLAUDE.md` (2026-07-25) in the context-engineering restructure: `CLAUDE.md` now holds only invariants and gotchas, and deep implementation notes live here, loaded on demand. Content below is preserved from the former CLAUDE.md "Development Notes" and stays maintained — update it the same way CLAUDE.md used to be updated.

### Quokka (AI Adviser)
Free-form natural-language control surface — user says "I've rescheduled my FAA exam to May 12, adjust everything" and Quokka finds related tasks/GCal events/routines and queues the fix. Named after the quokka (a small, perpetually-smiling Australian marsupial). User-facing branding uses "Quokka"; internal code (module names, CSS classes, endpoints under `/api/adviser/`, state vars like `showAdviser`) stays as `adviser`/`Adviser` — renaming plumbing provides no value.

**Entry point:** `✨` sparkle icon in the header (took the slot where the gear used to be). Settings moved into the overflow `⋯` menu.

**Architecture (5 non-negotiables):**
1. **Atomic execute-on-confirm.** Nothing mutates during the chat turn. Mutations are staged in a server-side session plan; user reviews the plan, clicks Apply, and the plan runs in order with LIFO rollback compensation on any failure.
2. **Search-first context.** No task dumps in the prompt. The model uses `search_tasks`, `list_routines`, `gcal_list_events`, `notion_search`, etc. to explore before acting. Works the same at 10 tasks or 1000.
3. **Streaming progress.** SSE events (`turn`, `tool_call`, `tool_result`, `message`, `plan`, `done`, `runner_state`, `queue_update`, `committed`) fire live during the tool-use loop so the user sees what the model is doing. Includes an abort button.
4. **Coalesced broadcast.** During `commitPlan()` execution, individual record mutations suppress their usual SSE broadcast. A single `bumpVersion() + broadcast('adviser')` fires at the end so connected clients refetch once, not 15 times.
5. **Detached runner (2026-05-17, "F").** The Claude tool-use loop runs as an async task tied to the session, NOT the HTTP request. Closing the SSE connection doesn't abort the runner. Every event is appended to `session.events` (in-memory buffer, 500-event cap) AND fanned out to all current subscribers. New SSE connections via `subscribeOnly: true` get a replay of the buffered events first, then live events as they happen. Session TTL extends while the runner is `running`; staged plans get a 30-min hard cap before auto-abort so compensation can't unwind hours-old state. Concurrent messages (sent while runner is `running` or `awaiting_confirm`) queue on the session and advance after the user commits/aborts the current plan or the runner returns to idle. Plan-ready push notification (`push_notif_quokka_plan_ready`, default ON) fires when the runner stages a plan with no live subscribers — tap deep-links to `/?adviser=<chatId>` which opens the Quokka modal. Session lifecycle: `idle | running | awaiting_confirm | committed | errored | aborted`. **Client poll-fallback budget (2026-07-10):** when the SSE stream drops mid-turn (mobile network hiccups, backgrounding), `useAdviser.js`'s `pollSessionForResult()` falls back to polling `GET /api/adviser/session/:id` every 1.5s for up to 5 minutes before giving up with "Could not retrieve response" — long enough to outlast a legitimately long tool-use loop (a broad "search my whole task list" request can fan out into a dozen+ `search_tasks` calls plus web searches) without the client declaring failure while the server-side runner is still working. A 404 (session genuinely gone) still fails fast; other fetch errors mid-poll retry rather than aborting.

**Server modules:**
- `adviserTools.js` — registry, session/plan storage (10-min TTL, 1-min sweep), `handleToolCall()`, `commitPlan()` with rollback
- `adviserToolsTasks.js` — 23 task + routine tools (incl. 4 Sequences chain editors: `add_follow_up`, `edit_follow_up`, `remove_follow_up`, `reorder_follow_ups`; + `reconcile_loops`, `merge_tasks`)
- `adviserToolsIntegrations.js` — 12 GCal + Notion + Trello tools
- `adviserToolsMisc.js` — Gmail + packages + weather + settings + analytics + growth-area + notes tools (incl. `check_integrations`, the live cross-integration health probe)
- `adviserToolsKnowledge.js` — 9 knowledge-base tools (search, get, refresh, list, create, update, delete, link/unlink to tasks)
- **Total:** 86 tools (live count from the registry — this number drifts as features land; trust `GET /api/adviser/tools` over any doc); diagnostic list at `GET /api/adviser/tools`

**Server endpoints:**
| Endpoint | Purpose |
|---|---|
| `POST /api/adviser/chat` | SSE streaming — runs the Claude tool-use loop. Body: `{ message, history, sessionId? }`. Emits `session`, `turn`, `message`, `tool_call`, `tool_result`, `plan`, `done`, `error` events. |
| `POST /api/adviser/commit` | Executes the staged plan atomically. Body: `{ sessionId }`. Single SSE broadcast after commit if any mutations ran. |
| `POST /api/adviser/abort` | Cancels in-flight stream + clears session. |
| `GET /api/adviser/tools` | Returns the full tool inventory (name + description) for debugging. |

**Tool categories & counts:**
- Tasks (13): search, get, create (with optional `checklist_items` for multi-part tasks), update, delete, complete, reopen, snooze, move_to_projects, move_to_backlog, activate, research_task (append AI-researched notes with web search), merge_tasks (fold a duplicate into a survivor — content combined, earliest due date, external links adopted, duplicate deleted; server primitive `mergeTasks()` in db.js, also behind `POST /api/tasks/:id/merge` + the EditTaskModal "Merge duplicate" picker)
- Routines (7): list, get, create, update, delete, spawn_now, reconcile_loops (stamp completed_history for stuck-open cadence loops whose tasks are done — staged + LIFO-compensated; idempotent; skips stacks + habit loops)
- Anthropic server-side `web_search` available in the main chat loop — Quokka can look up current info (prices, news, current best-practices) live during a reply, not just from training data
- Google Calendar (5): list calendars, list events, create/update/delete events
- Notion (5): search, get page, query database, create page, update page
- Trello (7): list boards, list lists, create/update/archive card, add checklist
- Gmail (4): status, sync, approve pending, dismiss pending
- Packages (6): list, get, create, update, delete, refresh-all
- Weather (3): get, refresh, geocode
- Settings + analytics (5): get/update settings (secrets blocked), get analytics, get analytics history, `check_integrations` (live one-pass health check across every integration — see below)
- Knowledge base (9): search, get, refresh, list, create, update, delete, link/unlink to tasks (see Knowledge Base section above)
- Notes (4): list, create, update, delete — free-floating notes, no task semantics (see Notes section above)

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

### Integration Health Check (2026-06-18)
One command — "check my integrations" — and Quokka reports the live status of every integration you've connected.

**Core:** `probeIntegrations(req)` in `server.js` runs all 12 probes in parallel and returns `{ generated_at, summary, integrations[] }`. Each integration: `{ id, name, category, path, configured, status, detail }` where `status ∈ { connected, degraded, error, not_configured }`. Every probe is wrapped in `withProbeTimeout` (8s) + try/catch so one slow/failing service never sinks the report.

**Probes are LIVE but free + non-destructive** — real round-trips that cost nothing and send nothing:
| Integration | Probe | Cost/safety |
|---|---|---|
| Anthropic | `GET /v1/models?limit=1` | Free, no tokens spent |
| **Notion (MCP)** | `notionMCP.getStatus()` | mcp.notion.com / OAuth — connection state |
| **Notion (REST token)** | `restTokenStatus()` → `GET api.notion.com/v1/users/me` | **NO MCP fallback** — validates `NOTION_INTEGRATION_TOKEN` on its own path so a rotated key is tested without MCP masking a failure |
| Trello | `GET /members/me` | Free |
| Google Calendar / Gmail | OAuth refresh-token exchange | Free, validates the refresh token |
| 17track | `getquota` | Free, doesn't consume a tracking query |
| Weather | config + cache freshness | No key |
| Email (SMTP) | nodemailer `verifyEmail()` → `transporter.verify()` | **No email sent** (unlike `sendTestEmail`) |
| Web Push | `getPushStatus()` (VAPID + sub count) | Self-managed, no external call |
| Pushover | `POST /users/validate.json` | **No push fired** (unlike the test endpoints) |
| Knowledge base | `notion_knowledge_db_id` + last-sync | Notion-backed |

**Notion split is deliberate:** the two paths are independent (MCP OAuth token ≠ REST integration token; neither works as the other), so they're reported as two separate rows. This is the supported way to answer "test my new Notion key and confirm it isn't hitting the MCP."

**Surfaces:**
- `GET /api/integrations/health` — endpoint (for a future Settings panel).
- Quokka tool `check_integrations` (read-only, in `adviserToolsMisc.js`, wired via `adviserDeps.probeIntegrations`). Triggers: "check my integrations", "are my connections working", "test my Notion key".

**New exports:** `restTokenStatus()` (`notionMCPProxy.js`), `verifyEmail()` (`emailNotifications.js`). No new files — both modules are already in the Dockerfile runtime COPY list.

