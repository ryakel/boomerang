# Version History

Commit-level changelog for Boomerang, grouped by date. Sizes: `[XS]` trivial, `[S]` small, `[M]` medium, `[L]` large, `[XL]` extra-large.

---

## 2026-07-21

- feat(packages): Shippo becomes the USPS tracking backend — live USPS status is back [M]
  - Follow-up to the link-out change below, closing the loop the same day: a live Shippo API call against the user's active Ground Advantage number returned FULL recipient-side tracking (event history, ETA, service level) post-cutover — Shippo's USPS-authorized position survived the April 1 Mailer-ID lockdown that killed 17track's standard-plan USPS access. Verified before building, per the "test with a free account before building" note.
  - **`server/shippoTracking.js`** (new): `shippoGetTrack()` — `GET api.goshippo.com/tracks/{carrier}/{number}`, 15s timeout, maps Shippo statuses (PRE_TRANSIT/TRANSIT/DELIVERED/RETURNED/FAILURE/UNKNOWN + `out_for_delivery` substatus) onto boomerang's, reverses the oldest-first history to the app's newest-first shape, null on any failure. Deliberately polling-only: the server is tailnet-private (no inbound webhooks) and USPS is NOT on Shippo's webhook-only carrier list. `shippoProbe()` validates auth free via the mock carrier's test numbers.
  - **`applyTrackingResult()` extracted in `server.js`**: the status-rank downgrade guard, ETA, signature-task creation/completion, delivered auto-cleanup stamps, and all status-change notifications (delivered/exception/out_for_delivery/signature ×3 channels) moved out of the 17track poll loop into one shared function both legs call — the Shippo path gets identical notification behavior for free instead of a duplicated block.
  - **Wiring:** `SHIPPO_CARRIERS` set (usps) — 17track NEVER touches these numbers; when a Shippo token is configured (`shippo_api_token` setting or `SHIPPO_API_TOKEN` env, `getShippoToken()`), USPS polls on a Shippo leg in the background loop, the add-package route (bounded 8s, same race as 17track), per-package refresh, and refresh-all (which now works Shippo-only when no 17track key is set). `isUntrackable()` is now conditional: USPS is a link-out card ONLY when no Shippo token exists.
  - **Client:** the link-only gate keys off `usps && !shippo_api_token && no events` (the events check covers env-var-only servers); link-only copy now points at Settings → Integrations → Shippo. New Shippo row + token field in the Integrations panel (live token required; non-Shippo shipments bill ~5¢/number).
  - **Safety/health:** `shippo_api_token` added to the Quokka secret blocklist (get redacted / update refused); new `check_integrations` probe row "Shippo (USPS tracking)" (free auth check, no tracking number billed).
  - **Amazon goes link-out too (same PR):** the dashboard export showed both TBA numbers registered with 17track and stuck at "Not found" forever — TBA ids live inside Amazon's own systems, are registered with no carrier network, and Shippo doesn't offer Amazon at all; no third party tracks them accurately. New `UNTRACKABLE_CARRIERS` set (`amazon`): never polled by either leg (17track loop, add-route, refresh via the `isUntrackable` early-return, refresh-all), rendered as a "Link only" card whose action is "Track on Amazon" (`track.amazon.com/tracking/<TBA>`, resolves signed-in). Gmail scanner still auto-captures TBA numbers so the cards exist. Same delivered-cleanup caveat as USPS-without-Shippo: no events → manual delete.

- fix(packages): USPS becomes a link-out card — no more doomed 17track registration [S]
  - Prod investigation (active USPS number sitting "pending" forever; 17track dashboard export showed zero USPS registrations ever accepted): USPS killed recipient-side third-party tracking on 2026-04-01 (Mailer-ID lockdown; Web Tools retired 2026-01-25). 17track now refuses USPS registration on the standard plan outright — "due to the policy of carrier 'USPS' (code '21051'), registration is temporarily unavailable. Please complete the quota purchase and configure the 'Special Carriers'" — USPS is only served on their paid Special Carriers add-on. Boomerang WAS attempting registration correctly; every attempt was rejected, silently (console-log only), and the card just sat pending.
  - Server: `UNTRACKABLE_CARRIERS` set (currently `usps`) + `isUntrackable()` — excluded from the polling loop, the add-package inline register+poll, per-package refresh (returns `untrackable: true`, no 17track calls), and refresh-all; no quota burned on guaranteed misses. The boot-time "reset stuck USPS packages for re-registration" repair removed (it had become a guaranteed-miss loop; its stated "without carrier code" behavior no longer matched the code anyway). 420-prefix normalization kept.
  - Client: USPS rows show a "Link only" status chip; expanded card explains the April 2026 USPS policy, hides Refresh, and the carrier-site action becomes "Track on USPS.com" (`getTrackingUrl` already had the USPS template).
  - Un-gating later: if the 17track account ever buys the Special Carriers add-on, remove `usps` from `UNTRACKABLE_CARRIERS` (server) + the `untrackable` gate in `PackageRow` (client) — registration plumbing is untouched and still correct.
  - Known limitation: USPS packages never auto-transition to delivered (no events), so retention cleanup doesn't fire for them — they stay until deleted manually. Shippo was evaluated as an alternative USPS source: its Track API accepts arbitrary numbers (paid per-number) and docs don't restrict USPS, but the docs predate the April enforcement — verify with a free account + one live call before building anything. USPS Informed Delivery emails + the Gmail scanner remain the durable recipient-side route.

- feat(ios): OTA bundle updates — web changes reach the native shell without an Xcode rebuild [M]
  - Born of the study-app comparison ("why does study never need rebuilds?"): study's shell loads the deployed site live (`server.url`), but that model requires the server domain baked into the binary at build time (iOS `WKAppBoundDomains` is static), which breaks "someone else points one binary at their own server." Boomerang keeps the **bundled model + runtime config** and adds self-hosted **OTA live updates** instead — the distributable answer to the same problem.
  - **Server:** the Docker build now also produces `dist.zip` (same public assets the SPA serves) and ships it in the image; `GET /api/bundle/manifest` (`{available, version, url}`, version = `APP_VERSION`) + `GET /api/bundle/download` serve it. Both are auth-gate OPEN_PATHS — the content is already served unauthenticated as the SPA, and the native download runs outside the token-attaching fetch interceptor. Bare-metal runs without the zip report `available:false` and nothing changes.
  - **Client:** `src/otaUpdater.js` (wired in `main.jsx`, native shell only, dynamic import so the web bundle never loads the plugin) — on boot and app resume, compares the manifest version against the running bundle's `__APP_VERSION__`, downloads + `set()`s the new zip via `@capgo/capacitor-updater` (manual mode, `autoUpdate:false` — never talks to Capgo's cloud). `notifyAppReady()` on every boot arms the plugin's auto-rollback, so a broken bundle reverts instead of bricking the shell.
  - **One last routine rebuild** is needed to get the plugin into the binary (`cap sync ios` + build on the Mac); after that, pushing to `dev`/`main` updates the corresponding app on next launch/foreground. Version checks stay disabled in the shell (`VERSION_CHECKS_ENABLED` gate) — OTA replaces that flow natively.
  - Dev/prod pairing falls out automatically: each app updates from whatever server its ConnectionSetup points at (`boom_api_base`), so Boomerang Dev tracks the dev server and Boomerang tracks prod, with zero URLs in the repo.

- fix(ui): boot auth probe times out and shows a splash — no more white screen off-tailnet [S]
  - Prod report (surfaced while comparing rebuild models with the study app): the native shell — and the PWA offline — showed a blank screen when the server was unreachable, which read as "caching isn't working." The cache was fine; the boot gate was the blocker: `App.jsx` fetched `/api/auth/status` with no timeout and rendered `null` until it settled. Off-tailnet, a fetch to the `100.x` host doesn't reject — iOS silently drops the packets and lets it hang 60+ seconds — so the fail-open `.catch` never fired and the app sat blank. Same trap the App Intent hit (fixed 2026-07-19 with a 10s URLSession timeout); the web boot path never got the equivalent.
  - The probe now carries `AbortSignal.timeout(4s)` (timeout → the existing fail-open path; the server remains the real enforcement), skips straight to the cached UI when `navigator.onLine === false`, and the `checking` state renders a minimal `BootSplash` (centered pulsing brand mark on the themed background) instead of `null` — even the bounded wait is never blank.
  - Behind the gate everything was already offline-capable (tasks cache in `boom_tasks_v1`, mutation queue replays on reconnect), so this one gate was the whole "white screen offline" failure.

- fix(packages): Track-package button no longer fails silently or hangs on 17track [M]
  - Prod report (with screenshot): "Pushing the track button does nothing" — number + label filled, USPS detected, tap, nothing. Two compounding bugs, both reproduced headless:
  - **Silent client failure:** `handleAdd` in `PackagesModal.jsx` had `try/finally` with no catch — ANY failed `POST /api/packages` (409 duplicate, 401, 500, network) was an unhandled rejection and the form just sat there. Now caught and rendered inline (`.v2-package-add-error`); `createPackage` in `api.js` parses the server's error body so the message is the real reason, with a friendly 409 case ("Already tracking this number as \"X\" — pull to refresh if you don't see it", since the twin may be a pending Gmail import this device hasn't fetched).
  - **Unbounded 17track awaits:** the add route awaited `register17track` + `poll17track` inline with NO timeout — a slow/unreachable api.17track.net held the response open for minutes, making the button look dead. All three 17track fetches (`register`, `changecarrier`, `gettrackinfo`) now carry `AbortSignal.timeout(15s)` (protects the background polling loop too), and the add route additionally races its inline register+poll against an 8s cap — past it, the response returns the pending package immediately and the poll finishes in the background (its write lands for the next fetch/poll cycle).
  - Verified headless: happy path renders the row; duplicate attempt shows the inline message instead of nothing.

## 2026-07-19

- refactor(ui): Kept More/sidebar consolidation — 9 rows down to 4, Notebook merges Notes + Growth areas [M]
  - User: "More is really fucking full now. We probably need to shrink it down and bring pieces together." Direction confirmed as prune-and-fold: every row that already had a home elsewhere leaves the menus instead of being duplicated.
  - **Mobile More (9 → 4):** Notebook · Arcs · Packages · Settings. Removed as duplicates: What now? (lives on Today), Analytics (header avatar). Folded: Caught → Analytics, Activity log → Settings → Data (the "Open activity log" button already existed there), Growth areas → Notebook.
  - **Desktop sidebar Review group (9 → 5):** Notifications · Notebook · Arcs · Analytics · Packages (desktop keeps an Analytics row — no avatar entry there). Loop suggestions row removed too — the Sparkles button on the Loops surface has been its home since 2026-06-11, same as mobile.
  - **Notebook:** `NotesModal` retitled, now Notes on top + a Growth-areas section below a hairline divider. `GrowthAreasModal.jsx` exports the CRUD body as `GrowthAreasPanel`; the legacy-theme Growth areas modal wraps the same panel, so the standard theme is untouched.
  - **Caught → Analytics:** new hand-off row on the Overview tab ("Caught — everything you finished") that closes Analytics and opens the Done list. Deliberately OUTSIDE the history-loaded gate so the Done list stays reachable while analytics is loading or empty — Analytics is now its only Kept entry point.
  - Legacy standard-theme surfaces (Header, SystemMenu) deliberately untouched.
  - Verified by headless render (mobile + desktop): More shows exactly the 4 rows; Notebook opens with both composers; sidebar shows the pruned Review group; the Caught hand-off opens the Done modal. (First verify run caught the hand-off hidden behind the empty-history gate — moved out and re-verified.)

- feat(ios): native App Intent is now the real voice-capture path — /api/capture target, offline queue, 10s timeout [M]
  - User: "I actually need this to fix the native Siri integration. Shortcuts is a bandaid." `BoomerangIntents.swift` rewritten around the new capture endpoint: POSTs `{text, source:'siri'}` to `/api/capture` (was `/api/intake` — native captures now carry `capture_source` provenance and get the server-side long-dictation title/notes split), with a **10s request timeout** (an unreachable Tailscale host used to hang Siri for the 60s URLSession default).
  - **Offline queue-and-sync (`CaptureQueue`):** a capture must never be lost. Network failure or 429 → the capture persists in the App Group (`boom_capture_queue`, JSON, 50-cap oldest-dropped) and Siri says "saved on this device — it'll sync next time." Drains oldest-first on the next intent run (before the new capture, preserving spoken order) and on every app foreground (`sceneDidBecomeActive` added to `SceneDelegate.swift`). Items removed only AFTER a successful send — crash mid-flush re-sends (duplicate, annoying) rather than loses (trust-destroying). 400 drops the item so bad content can't wedge the queue; 401/403/5xx keep it and stop.
  - Honest Siri dialogs per failure class (not connected / token rejected / rate-limited / saved offline / server said no), two new invocation phrases ("Capture a thought in Boomerang", "Boomerang capture").
  - One-utterance "Add X to Boomerang" confirmed NOT buildable as specced — App Shortcuts phrases can only embed AppEnum/AppEntity params, never free-form Strings; documented in `wiki/UPCOMING_FEATURES.md` (the task-title AppEntity is the upgrade path). Docs: `wiki/iOS-Native-App.md` Phase 3 rewritten, `wiki/Capture-Shortcut.md` repositions the HTTP Shortcut as the no-app fallback.
  - NOT compile-verified — no Xcode in this environment; needs the pending Mac build session (`npm run ios:dev`).

- feat(api): voice capture endpoint + "Boomerang Capture" Siri shortcut [M]
  - **Goal:** a thought exits the head hands-free — "Hey Siri, Boomerang Capture" → dictate → task in the inbox within seconds, from phone, Watch, or CarPlay. New `POST /api/capture` (`{ text, source? }` → 201 with the created task) rides the existing auth gate (API token). Capture is deliberately dumb — no project, no due date, no priority; the background auto-sizer refines size/energy like every other create path.
  - **Provenance:** migration 045 adds `tasks.capture_source` (NULL = not capture-created; `'siri'`/`'shortcut'`/`'manual'`/`'api'`) so a future digest can call out voice-captured items for triage. Wired through `taskToRow`/`rowToTask`/upsert in `server/db.js`; survives partial updates via the merge-then-upsert path.
  - **Never lose a capture:** text trimmed, empty → 400, capped at 2,000 chars; long dictation keeps the first 500 chars as the title and preserves the FULL text in notes instead of silently truncating (unlike `/api/intake`'s 500-char slice). Failures return 5xx so the Shortcut visibly errors — no silent drops.
  - **Hardening:** in-route sliding-window rate limit (30/min, `createRateLimiter` in the new `server/capture.js`) so a leaked token can't become a spam cannon; `authGate` in `auth.js` now logs rejected requests (method + path + IP, never the credential).
  - **Tests:** `scripts/capture.test.mjs` (wired into `npm test`) — unit tests for validation/title-split/rate limiter, plus real-HTTP tests against a spawned server with auth enabled: 401 missing/bad token, 201 happy path (source stamped, inferred flags correct), 400 empty text.
  - **Docs:** new `wiki/Capture-Shortcut.md` (2-minute Shortcuts recipe: Dictate Text → Get Contents of URL → notification confirmation, Watch enabled); Phase 2 (parameterized native App Intent phrase, offline queue-and-sync, pointing the native intent at `/api/capture`) queued in `wiki/UPCOMING_FEATURES.md`, not built.

## 2026-07-18

- feat(tasks): Notes — leave a note without creating a task [L]
  - User request: "I need a concept of a note. Something where I can leave a note without creating a task that has a due date." New first-class `notes` concept — free-floating notes with NO task semantics: no due date, no status, no points, no nagging, never counted in pile-up or analytics. Deliberately its own SQL table (migration 044: id/body/pinned/timestamps) + dedicated per-record endpoints (`GET/POST /api/notes`, `PATCH/DELETE /api/notes/:id`) — never part of the bulk `/api/data` blob (same carve-out as growth areas/packages), so the whole-blob LWW hazard can't touch it.
  - **Pinned = leave a note on the fridge.** Pinned notes render as a gold sticky strip at the top of Kept's Today (mobile + desktop), above the Day Arc hero next to the growth banner. Tap opens the Notes surface; the X unpins (never deletes). Unpinned notes live only in the Notes page.
  - **Capture:** the Throw sheet (center Throw button / ⌘K) gains a **Task | Note** toggle — note mode drops the date chips, placeholder flips to "What do you want to remember?", button becomes "Leave it". Plus the Notes surface's composer (with a pin-on-create checkbox) and Quokka.
  - **Notes surface:** `NotesModal` (More → Notes on mobile, sidebar → Notes on desktop) — composer, pinned-first list, inline edit, pin/unpin, delete, and **"Make it a task"**: first line → task title, remainder → task notes, note removed once the task exists (goes through the normal `handleAddTask` path, so auto-sizing/tagging apply).
  - **Quokka tools (4, in `adviserToolsMisc.js`):** `list_notes` (read-only), `create_note` ("note to self: …"; `pinned` only when the user asks for it on Today), `update_note`, `delete_note` — staged with capture/restore compensation like every other mutation tool. Live registry now reports 86 tools total (the docs' old "64" count had drifted; corrected).
  - Cross-device: note writes bump the sync version + broadcast; `useNotes.reload()` rides `hydrateFromServer` so a note left on the phone appears on the desktop on the next sync round-trip.
  - Verified end-to-end on a scratch server: full CRUD + validation via API; headless renders of the Today sticky, Throw-sheet note mode (created a real note through the UI), Notes list, and the promote flow (task landed server-side with body split into title/notes, note removed).

- fix(sync): manual settings flush no longer swallows a just-added task [M]
  - Found while live-verifying Notes, but pre-existing on `dev` and reproducible against a clean baseline: `flush()` (the manual settings/labels push) cleared the pending per-record debounce timer, and `pushBulkState`'s success handler then advanced `prevTasks`/`prevRoutines` to current state — marking any task/routine change from the last ~300ms as "already pushed" without ever pushing it. Concrete prod shape: the first-ever task add triggers the streak-anchor effect, which saves settings + flushes within the 300ms window → the task exists locally but never reaches the server (verified: baseline won the race by ~60ms of render timing; the Notes branch shifted timing and lost it deterministically).
  - Fix, both halves: `flush()` now runs the pending per-record push before the bulk push (same pattern `fetchAndHydrate` already uses), and `pushBulkState` only bootstraps the per-record snapshots when they're still null (the fresh-empty-server path) instead of overwriting them — a bulk push carries settings/labels only and must never claim tasks as pushed. Verified: the previously-lost throw now lands server-side with the settings flush racing it.

## 2026-07-17

- fix(routines): duplicate-spawn guard v2 — due_date out of the key + automatic cleanup sweep [M]
  - Prod: "still seeing a shit ton of duplicates from loops." Two holes in the morning's v1 guard: (1) it keyed on due_date, but a STALE client (offline phone with old completed_history) computes an older next-due for the same cycle — copies differ on due date and both inserted; (2) pre-guard duplicates just sat there. Fix: non-stack routines now block on ANY active `(routine_id, title)` twin regardless of due date (the client's own legacy "any non-done instance blocks" rule, finally enforced at the serialization point; title in the key keeps follow-up chain steps safe); stacks keep the per-cycle due_date key (yesterday's lingering member + today's spawn is legitimate). New `dedupeSpawnedTasks()` sweep removes existing duplicate groups — survivor prefers a user-touched status over `not_started`, then oldest created_at — running automatically at every server boot (before notification engines) and via `POST /api/tasks/dedupe-spawns` (`?dryRun=1`). Existing prod dupes clear on the next container cycle, no manual deleting.
  - Live-verified on a scratch server: stale-client different-due race now deduped; chain steps and cross-cycle stack members still allowed; same-cycle stack member deduped; sweep kept the `doing` copy over two `not_started` twins; boot sweep log confirmed removing a planted dupe on startup.

- refactor(analytics): Flight log merged INTO Analytics — one stats surface [M]
  - User's actual point, correctly this time: "tell me how analytics is not flight log with a different name... maybe we should collapse them." The previous de-dupe still left two surfaces showing the same stats (stat cards + year ribbon + badges vs summary + year heatmap + charts). Collapsed: `src/kept/FlightLog.jsx` deleted; AnalyticsModal's Overview tab now leads with the profile hero (rally / best rally / lifetime / points-yr / best day / today, reusing the `bm-fl-stats` cards) and ends with Achievements. Every entry point — Kept header trend icon, desktop sidebar (Flight log row removed), More → Analytics — opens the same modal. The DensityRibbon year view retired with the page (the heatmap is the year view; the component survives for LoopsView). Verified by headless render: avatar tap → merged Analytics with hero, 4 tabs, badges.

- fix(analytics): heatmap actually shows data on mobile; AI tab findable; Flight log \u2194 Analytics de-duped [M]
  - **Heatmap ("GitHub style graph is completely broken"):** verified by headless render — the 687px grid sat in a ~308px scroller pinned to the LEFT, so phones showed only the year-old empty half while every active cell was off-screen right; worse, the month labels lived OUTSIDE the scroller and compressed to viewport width, so labels didn't even correspond to columns. Fix: labels moved inside a `heatmap-inner` container at the grid's natural width (labels + columns scroll together), and the scroller auto-positions to NOW on open — recent weeks visible first, swipe back in time. Confirmed post-fix via DOM probe (scrollLeft pinned right, hot cells on-screen) + screenshot.
  - **AI tab ("where is the AI tab???"):** it rendered, but as the third identical segmented-pill row below the range and metric pickers — invisible as navigation. Tabs (Overview/Tasks/Habits/AI) now sit FIRST in the modal, styled as underline tabs (ember active underline, mirrors Settings); the metric toggle + summary card only render on the tabs they apply to (Overview/Tasks).
  - **Flight log vs Analytics ("separate surfaces? basically the same data"):** the duplication was the badges grid on both. Achievements now live only on the Flight log (the profile page: streak, arcs, badges); Analytics is the numbers surface (charts, patterns, AI usage). The Flight log gains a "Full analytics — charts, patterns, AI usage \u2192" button that hands off directly, so the trend icon is one tap from everything. Kept's segmented-control tab override retired in `src/kept/analytics.css`.

- fix(ui): Quokka history controls collapsed into one row [XS]
  - Prod screenshot: history view stacked three rows — the (now-redundant) toolbar history chip, a Back-to-chat/New row, then the search bar. The toolbar hides entirely while history is open (ChatList owns the controls), and Back \u00b7 search \u00b7 New share a single row (search flexes, buttons no-shrink). Match-count line renders under the bar only while searching.

- feat(settings): build/version rows minimized — tap the label for the description [XS]
  - Follow-up to the start-minimized pass: the App build and Server version rows carried paragraph-length explanations that always rendered. New `InfoHintRow` (label + \u24d8 glyph as the tap target) keeps just the label and the version chip visible; tapping the label reveals/hides the description. The build-tap easter-egg stays on the version code itself.

- feat(settings): every Settings section starts minimized [M]
  - Prod request: "Settings should start minimized across the board. They seem to retain last state, but they get really long and really messy." Root of the mess: Notifications + Integrations persisted their fold state in settings with an all-expanded default — whatever you ever expanded stayed expanded forever — and General/Tasks/Data had no folding at all.
  - New shared `SettingsSection` component (chevron header reusing the existing section-header styling): SESSION-LOCAL state, always starts collapsed, deliberately un-persisted. Notifications + Integrations flipped from the persisted `collapsed_*_sections` maps to the same session-local start-collapsed behavior (the old settings keys become inert, like `v1_disabled`). General wrapped into Appearance / Home screen / Build & version; Tasks into Task behavior / Impact dates / AI tone / AI models & keys; Data into Server connection / Backup / Activity / Server logs / Markdown import / Developer / Danger zone. Labels stays flat (the list IS the content).

- feat(ai): OpenAI provider integration + AI usage dashboard [XL]
  - **Multi-provider utility AI.** The utility surfaces (size/energy/impact inference, Polish, reframe, What Now, toasts, nudges, Gmail classification, pattern/tag scans, AI search, growth areas, research notes) now route through two tiers — **Workhorse** and **Quick** — each switchable between Anthropic and OpenAI models in Settings → Tasks → AI models (curated catalog + `provider:model-id` custom escape hatch; defaults stay Sonnet 5 / Haiku 4.5). New `server/aiGateway.js` is the single door: resolves the tier, calls the provider (OpenAI chat completions with `max_completion_tokens` + `reasoning_effort: 'low'` on gpt-5-family — reasoning tokens spend from the output budget, the OpenAI twin of the Sonnet 5 thinking trap), returns `{text, provider, model}`. Client utility calls moved from the raw Anthropic proxy to `POST /api/ai/complete`. Deliberately pinned to Anthropic: Quokka's tool-use loop, research_task/ladder tools, and the vision surfaces (OCR, research attachments). Feature gates now use `aiConfigured(tier)` so an OpenAI-only install doesn't silently lose features. OpenAI key: Settings → Integrations → OpenAI (test = free models-list probe; also in `check_integrations` + `/api/keys/status`); env `OPENAI_API_KEY` supported; key added to the Quokka secret blocklist.
  - **AI usage dashboard (local tracking).** Migration 043 `ai_usage` table — every AI call logged at the gateway/proxy choke points with provider, model, feature tag, tokens, and cost estimated from the new `MODEL_CATALOG` pricing table (longest-prefix matching because providers echo dated model ids like `gpt-5-mini-2025-08-07`). `GET /api/ai/usage?days=N` aggregates totals / by-provider / by-model / by-feature / by-day; rendered as a new **AI tab in Analytics** (est. cost, calls, tokens cards + breakdown tables, follows the range picker). Pinned-Anthropic paths log too: Quokka (`quokka`), research/ladder tools, vision calls (`ocr`/`research` via a `_feature` tag on `/api/messages`).
  - **Live-verified end to end:** scratch server + real OpenAI key — tier override routed a live `pong` through gpt-5-mini, usage logged with correct ~$0.00003 cost estimate, all breakdowns populated; no-key and missing-prompt error paths clean; migration 043 runs; lint/build/tests green.

- fix(ui): attachments are finally openable — in-app viewer with Share/Download [S]
  - Prod report: "uploaded an image and I cannot do anything with that image, at least on mobile." The edit-modal attachment list rendered name + size + a remove button — no open/view affordance existed anywhere, on any platform, since attachments shipped. New `AttachmentViewer` (`src/components/AttachmentViewer.{jsx,css}`): tapping the attachment name (now underlined) opens a full-screen overlay — images render inline (data: URL), PDFs in an iframe (blob URL), text files as a preview; every type gets **Download** plus a **Share** button when the platform supports file sharing (`navigator.share` with a File — on iOS that's the native sheet with Save Image / Save to Files, which sidesteps the unreliable new-tab blob URLs in the capacitor:// shell). All local — nothing fetched, Escape/backdrop closes, sits above ModalShell (z 115) below toasts. on thinking-enabled + tokenizer-tight calls [S]
  - Audit follow-up to the adaptive-thinking incident below ("any other surfaces?"): swept the codebase for the rest of the Sonnet 5 breaking-change classes. Clean: no `top_p`/`top_k`/forced `tool_choice` anywhere, no assistant-prefill request shapes (the adviser always ends requests with a user turn). Real residual risk: on the calls that deliberately KEEP adaptive thinking, thinking spends from the same `max_tokens` pot — the Quokka chat loop's 2048 cap (calibrated when Sonnet 4.6 ran thinking-off) could truncate mid-`tool_use` on a thinking-heavy turn, and `research_task` (2048) / ladder drafting (1200) likewise. Plus Sonnet 5's tokenizer runs ~30% hotter, squeezing the thinking-disabled JSON budgets (Gmail 10-email batch at 2048, `callClaude` at 1024, attachment OCR at 4096).
  - Raised caps (hard ceilings — zero cost unless output actually grows): adviser chat + research_task 2048→8192, ladder draft 1200→4096, Gmail classify 2048→4096, `callClaude` + `researchTask` 1024→2048, `extractAttachmentText` 4096→8192. One-liner budgets (10/60/100/400/700/800) left alone — outputs inherently tiny.

- fix(api): Sonnet 5 adaptive-thinking response shape crashed/degraded every utility AI call [L]
  - Prod screenshot: tapping **Polish** on task notes dumped `undefined is not an object (evaluating '(await Ti(...)).match')` plus the entire prompt into the notes area. Root cause: `claude-sonnet-5` runs adaptive thinking BY DEFAULT when the `thinking` param is omitted — the response's first content block can be a `thinking` block (empty text under the default display), so `data.content[0].text` is `undefined`. Client sites crashed (`callClaude` → Polish/reframe/What-Now/toast/dedup/size-inference, `researchTask`, `extractAttachmentText`); `?.`-chained server sites silently returned `''` and degraded without a trace (Gmail classification, growth-area rephrasing, AI email nudges, weekly pattern/tag scans, Haiku AI search, push-message rewrites). Intermittent because adaptive thinking only triggers when the model judges the task warrants it.
  - Second, fully-silent kill: Sonnet 5 REJECTS non-default sampling params — the Gmail classifier still pinned `temperature: 0`, so every classification call 400'd and email scanning was dead.
  - Fix: `claudeText(data)` + `NO_THINKING` exported from `aiModels.js` (imported by both bundles). `claudeText` collects all text blocks (never index `content[0]`); all 13 utility call sites now use it, and the cheap ones (inference/classification/one-liners) spread `...NO_THINKING` into the body — pre-Sonnet-5 cost/latency, and thinking can't eat a 100-token `max_tokens` from the inside. Gmail's `temperature: 0` removed. Deliberately untouched: the Quokka adviser loop (appends `response.content` wholesale — thinking blocks echo back correctly per the API contract) and `research_task`/ladder-draft (already filter text blocks; reasoning helps there).
  - Verified: `claudeText` unit cases (thinking-first, text-only, thinking-only, empty, null, multi-text) all pass; lint 0 errors; `npm test` + smoke + prod build green.

- fix(routines): server-side duplicate-spawn guard — loops no longer double-spawn across clients [M]
  - Prod report with screenshot: "Take out recycling" ×2 (today) and "Refresh Bot Accessories" ×2 (tomorrow) — one recycling copy auto-tagged `inside`, its twin bare, the fingerprint of two separate clients each running the spawn pass. Root cause: `spawnDueTasks`'s "already has an instance" guard is client-local — two clients opening inside the same sync window (native app + PWA/desktop in the morning) each see no instance, each spawn, and per-record `POST /api/tasks` inserted both blindly. Newly visible now that the native app runs alongside other clients daily.
  - Fix at the only serialization point: `findActiveSpawnTwin(task)` in `server/db.js` + a create-only check in `POST /api/tasks` — a NEW id carrying a `routine_id` is dropped when an ACTIVE twin (same `routine_id` + `due_date` + `title`, status not done/completed/cancelled) exists; response returns the twin + `deduped: true` with no version bump/broadcast. Title in the key keeps stack members safe (same routine+due, different titles); done twins don't block (manual "Spawn now" after completing today's instance stays legit). Guard is on the route, NOT in `upsertTask`, so Quokka's LIFO compensation restores are never silently dropped. Client: `pushChanges` (`useServerSync.js`) sees the flag and schedules a rehydrate so the losing client's phantom copy is replaced by server truth before the auto-sizer touches the dead id.
  - Verified live against a scratch server: race dedupes to the twin, existing-id re-push passes, two stack members insert, done-twin re-spawn inserts, non-routine same-title task inserts. Existing dupes in prod predate the guard — delete one of each pair by hand.

- docs(ios): iCloud Private Relay breaks Siri/Shortcuts DNS on tailnet-only hostnames [XS]
  - On-device debugging after the plugin-registration fix: the Siri intent got past the config gate but failed with "A server with the specified hostname could not be found" — while Safari and the app reached the same hostname on the same phone at the same moment. Root cause (user-confirmed by toggling it off): **iCloud Private Relay** routes DNS for background/system-initiated requests (App Intents from Siri/Shortcuts, Share Extension) through Apple's DNS proxy, bypassing Tailscale's resolver — and the server hostname has no public DNS record. Documented in `wiki/iOS-Native-App.md` (Connectivity section): symptom, confirmed culprit, and the two fixes — Private Relay / Limit IP Address Tracking off, or (durable) a public A record pointing the hostname at the server's Tailscale `100.x` IP so any resolver answers while routing stays tunnel-only. Not fixable from app code; doc-only change.

- fix(ui): Quokka history discoverability + chat search; Integrations tidy-up [M]
  - **Quokka history** (prod: "can't easily get to my chat history without knowing the search is history"): the mobile toolbar chip rendered a SEARCH icon for the chat-history toggle — a Wallaby-era leftover ("search-style chip") that Kept inherited. It's now a History icon + chat count on every theme.
  - **Chat search** (prod: "Also I have no search"): the history panel gains a search field — titles match instantly; a 2+ character query lazily fetches full message bodies once (cached) so message CONTENT matches too, with a match count / "searching contents…" line.
  - **Integrations panel** (prod: "looks like shit"): fixed the garbled intro copy ("Tokens are shared Tokens persist across reloads"); `.v2-settings-btn` no longer wraps its label mid-word ("Sync\nnow") or gets crushed in flex rows (`white-space: nowrap` + `flex-shrink: 0`); toggle-row text owns the squeeze (`min-width: 0` + `overflow-wrap`); sub-section labels (Sync parent / Knowledge base / Database sync) get one consistent spacing rhythm instead of ad-hoc inline margins. A full visual redesign of the panel still wants a dedicated design pass with live rendering — this is the make-it-not-broken tier.

- fix(ios): BoomerangNative plugin was never registered — App Group stayed empty, Siri intent dead [S]
  - First real Siri test: the intent RAN (registered in Shortcuts, executed) but replied "Open Boomerang and connect to your server first" on a fully-connected phone. Root cause: Capacitor 6+ does not auto-discover plugins compiled into the app binary — `BoomerangNative` (the localStorage→App Group config bridge from Phase 0) was a well-formed `CAPBridgedPlugin` that nothing ever registered, so every JS `setSharedConfig` call silently failed and the App Group never received `boom_api_base`/`boom_api_token`. The Share Extension reads the same App Group and would have failed identically. Fix: `capacitorDidLoad()` override in `BoomerangViewController` calls `bridge?.registerPluginInstance(BoomerangNative())`. After rebuild + one app launch (the interceptor-install mirror pushes the config), the intent and Share Extension have credentials.

- fix(sync): native-app settings never saved — stale-client guard swallowed every push [M]
  - Prod report (round 3 of "toggles won't stay"): the Push master kept reverting when toggled from the native app. Root cause is the sync-side twin of the version-mismatch reload loop: `guardStaleClient` rejects any bulk `/api/data` push whose `_appVersion` ≠ the server's `APP_VERSION` — silently, returning `{ok:true}` — as a stale-cached-JS defense. In the PWA the versions always match (the bundle is built inside the same Docker build). In the NATIVE shell they can never match (bundle stamped by the Mac/Xcode Cloud git checkout vs. the Docker tag), so every settings write from the native app was accepted-and-discarded, then reverted on the next hydrate.
  - Fix: bulk pushes now carry `_platform` (`native`/`web`, from `isNativeShell()`); the app-version equality check is skipped for native clients — it's a WEB staleness heuristic whose remedy (reload) doesn't exist for a pinned native bundle. The data-version staleness check (`_version < serverVer`) still applies to all clients, which is the guard that actually prevents behind-data clobbers; `preserveAbsentSettings` + the durable-key merges are unaffected.
  - Live-verified both directions: native client with mismatched app version → settings persist; stale WEB client with mismatched version → still silently rejected, stored settings untouched.
  - NOTE: needs BOTH sides — the server (container cycle) and a rebuilt app (the client must send `_platform`). Until the next `npm run ios:*`, settings changes should be made from the PWA.

- fix(loops): ended loops left on Today forever + "Resting" archive section [M]
  - Prod report: a loop with end date Jul 14 still surfaced in Today's Loops section on Jul 16, and the user wanted pause/end to behave like an ARCHIVE — stats kept, reactivation possible. Three parts:
  - **The bug:** `isRoutineDue()` in store.js respects `end_date`, but Kept's `TodayView` computes its own due check (`dueKey <= todayKey` from `getNextDueDate`) and never consulted it — an ended loop surfaced daily forever (spawning was already correctly stopped, so only the card lingered). New exported `isRoutineEnded()` in store.js (reused inside `isRoutineDue`); TodayView's loops memo now filters `!paused && !isRoutineEnded`.
  - **"Resting" section on the Loops tab:** paused loops used to VANISH from the Kept Loops library entirely (`!r.paused` filter — only the RoutinesModal's internal list showed them), and ended loops stayed mixed into the active list. Both now render in a dimmed **Resting** group at the bottom — title, why-chip (`paused` / `ended <date>`), total catches — tappable to the detail page, pencil to the editor. The routine row + `completed_history` are untouched, so this IS the archive: stats survive, nothing spawns or nags.
  - **LoopDetail banner:** a resting loop's detail page says so ("stats are kept, nothing spawns or nags") with an **Edit to resume / Edit to reactivate** button — unpause or clear/extend the end date in the editor and the loop returns to active surfaces with its history intact.

- feat(ios): TestFlight/Xcode Cloud Phase 0 — repo prep [S]
  - `ios/App/ci_scripts/ci_post_clone.sh` (Xcode Cloud builds the web bundle: brew node if missing → `npm ci` → `npm run build` → `cap sync ios` → `agvtool new-version -all $CI_BUILD_NUMBER` for TestFlight-unique build numbers; local builds unaffected). `App.Release.entitlements` with `aps-environment: production` wired to the App target's Release/Release-Dev configs only (Debug sideloads keep sandbox — no manual env switching, archives are production automatically). `ITSAppUsesNonExemptEncryption = false` in Info.plist (kills the per-build export-compliance questionnaire). Validated: both entitlements plists + Info.plist parse with correct values, pbxproj parses, per-block verification that only Release/Release-Dev reference the new file. Remaining phases (App Store Connect record, repo connect, workflow creation, `APNS_ENV=production` flip AFTER the TestFlight build registers) are the account-holder's — click-path in `wiki/TestFlight-Xcode-Cloud.md`.

- fix(ios): ios-deploy.sh picked a SIMULATOR — physical devices only now [S]
  - Second real-run failure mode: the build succeeded (and the bundle-id guard proudly reported the right app), but `devicectl` staged the install into **CoreSimulator** (`EBADARCH`: device-arm64 binary, simulator target). Cause: the JSON picker's fallback to `d['identifier']` — when the phone's tunnel wasn't up, it took "any device," and devicectl's list includes simulators, whose identifiers are standard UUIDs. The picker now accepts ONLY physical hardware (UDID shape `^[0-9A-F]{8}-[0-9A-F]{16}$`), prefers a connected one, and never falls back past that; the no-device error message says simulators are deliberately excluded. Unit-tested: a connected simulator loses to a disconnected physical phone.

- feat(brand): new logo — icon set regenerated from the real art [M]
  - The user's generated brand art landed via the `brand-drop` branch (chat image uploads arrive view-only — no file bytes — so GitHub web upload became the pipeline). **`brand/`** (new top-level dir, dev-only, not in the Docker image) holds the 10 source PNGs: dark/light square marks (1254²), dark/light DEV concepts, dark/light wordmarks, 4 transparent wordmarks.
  - **Generated from the source pixels** (sharp, no re-drawing): `AppIcon.appiconset` 1024 (straight resize of `boomerang_dark.png`), `AppIcon-Dev.appiconset` 1024 (from `boomerang_dev_dark.png`, its baked-in white rounded corners filled with the art's background via an even-odd rounded-rect overlay — the fill seam sits entirely inside the zone iOS's ~22% corner mask removes; the art's own radius is ~16%), PWA `icon-512`/`icon-192`/`apple-touch-icon` PNGs, and `favicon.svg` + legacy `icon-*.svg` as embedded-PNG SVGs of the same art.
  - **`src/components/Logo.jsx`** (the in-app header glyph) redrawn to the new mark: tapered throw-swoosh with the comma-hook tail + catch dot (art ember `#F04E23`) over the return blade, which keeps following `var(--v2-text)` so it reads on every theme. Parametric trace of the icon art (filled crescents between offset ellipse arcs), not the old arch-and-smile.
  - Both native apps pick the icons up on next rebuild; PWA/browser icons ship with the next bundle.

- fix(lint): server-wide lint coverage — and it immediately found a real Notion bug [M]
  - The eslint config's server block still targeted the pre-reorg paths (`server.js`, `db.js`) — meaning only TWO server files were ever linted, and post-reorg none were. Now: `server/**/*.js` + `scripts/**/*.{js,mjs}` with `ecmaVersion: 'latest'` (top-level await), and `ios/` + `previews/` added to ignores (the Mac's `ios/build/` DerivedData was getting swept by the pre-push hook — Capacitor's bundled `native-bridge.js` fails eslint, reported as a blocked `git push`).
  - **Real bug found by the new coverage (`no-undef`): `textToNotionProperties()` / `simpleMapToNotionProperties()` were called in `notionMCPProxy.js` but defined NOWHERE** — the 2026-05-24 create-pages schema refactor rewrote the file and dropped the definitions while keeping the call sites. Every string-properties `updatePage()` — the `PATCH /api/notion/pages/:id` title sync and knowledgeSync property updates — has thrown a swallowed ReferenceError since. Both helpers restored verbatim from the pre-refactor implementation (`git show dbb7312`).
  - Dead code cleared across 9 server modules (unused weather imports in the push/email engines, orphaned `isConfigured()` in pushover, unused escalation import + var, unused `pkgId` assignments in gmailSync, a useless try/catch in notionMCP, stale `getData` params). All behavior-neutral removals; lint 0 errors, tests + smoke green.

- refactor(repo): de-splatter the root — server modules → `server/`, previews → `previews/`, plans → `wiki/` [L]
  - The repo root held ~25 loose server runtime modules next to configs, five dev-preview HTML harnesses, two orphaned planning docs, and stray local junk. Reorganized:
  - **`server/`** now holds every server runtime module (`server.js`, `db.js`, `auth.js`, `seed.js`, all notification engines + APNs, digest, gmail/weather/notion/knowledge syncs, pattern/tag detection, growth areas, `aiModels.js`, all five `adviserTools*`). Intra-module imports (`./db.js`) survived the move unchanged; the handful of boundary paths updated: `dist` static serving + `migrations` dir resolve via `__dirname/..`, `../scripts/backup-db.js`, `../scripts/seed-data.json`, scripts/CI/smoke/`npm start` run `node server/server.js`, client imports of the shared model-id module became `../server/aiModels.js`.
  - **The Dockerfile's explicit per-file COPY list is GONE** — replaced by `COPY server ./server`. This retires the #1 documented prod-crash trap (a new root module silently missing from the image, `ERR_MODULE_NOT_FOUND` after deploy). New server modules now ship automatically. CLAUDE.md Git Rule 8 rewritten accordingly.
  - **`previews/`** holds the dev-only render harnesses (`kept-preview`, `kept-desktop`, `kept-viz-preview`, `brand-board`, `wallaby-preview`); `LOOPS-NOTIFICATIONS-PLAN.md` + `UPCOMING_FEATURES.md` moved into `wiki/`. Root is now: configs, `index.html`, `Dockerfile`/composes, `README`/`CLAUDE.md`, and directories.
  - **Validated:** lint 0, Vite build clean, unit tests + smoke green (the smoke boot caught the one missed boundary import — `scripts/backup-db.js` — exactly as designed), and a live boot from the new layout serving `/api/health` + the app shell with zero errors.

---

## 2026-07-15

- fix(notion): MCP resilience — synchronous token flush, dead-token retry parking, iOS re-auth guidance [S]
  - Born of the evening's disconnect + a failed phone re-auth. Three parts:
  - **Root cause hardened:** Notion MCP refresh tokens ROTATE on every refresh, and the rotated token rode the 1-second batched persist — a container restart inside that window strands the DB with an already-invalidated token (the disconnect mechanism; ~10 rapid deploys that evening made it near-certain). `initNotionMCP`'s injected `setData` now calls `flushNow()` synchronously for `notion_mcp_tokens` writes.
  - **Dead-token retries parked:** the 5-minute reconnect retry loop can never heal an `invalid_grant`/401-shaped failure (the refresh token itself is dead) — it just spammed the log forever. `isDeadTokenError()` now stops the retries and sets an actionable `lastError` ("Notion session expired — reconnect from Settings → Integrations → Notion"), which flips the existing `needsReauth` status so Settings shows the Reconnect banner instead of looking vaguely broken.
  - **iOS re-auth hijack documented in-UI:** attempting the OAuth consent from iPhone Safari bounces into the Notion APP via universal links (where the flow dies) whenever the app is installed — reported as "it keeps kicking me from safari to the app." The Notion integration block now shows the working paths when disconnected: a **private tab** (universal links don't fire there) or a one-time desktop connect (the connection is server-side state shared by every client). A native-shell OAuth flow (system browser + `boomerang://` return deep-link + status polling) remains on the build queue.

- fix(notifications): Test digest bypassed channel masters [S]
  - Prod report: test digest double-sent (native iOS + Pushover) while ALL digest toggles displayed off. The scheduled digest paths in all three engines correctly require channel master AND digest opt-in — but `sendDigestNow()` (the Test digest button) checked only the digest opt-in flags. The user's settings carried `push_digest_enabled`/`pushover_digest_enabled: true` from earlier experimenting; masters were off; the honest master-gated display correctly showed "off"… and the test fired both channels anyway under different rules. `sendDigestNow` now applies the same master gates as the scheduled path, with explicit `channel master off` skip reasons in the response. Live-verified: masters off → all three skipped; push master on → push leg attempted, pushover still skipped.

- docs(ios): TestFlight + Xcode Cloud plan [XS]
  - New `wiki/TestFlight-Xcode-Cloud.md`: the "no more Mac builds" plan. Phase 0 = repo prep Claude can do (ci_post_clone.sh web-bundle build, Release-entitlements split for `aps-environment: production`, `ITSAppUsesNonExemptEncryption`, CI build-number wiring); Phases 1–5 = the account-holder's Apple-UI + one-Mac-session path (app record → connect repo → create workflow → `APNS_ENV=production` flip on prod AFTER the TestFlight build is installed and registered — the sandbox/production sequencing trap is called out explicitly → internal tester install). Steady state: merge to `main` → cloud build → TestFlight update, 90-day expiry reset by any push. Boomerang Dev deliberately stays a local sideload.

- docs(ios): "The standard rebuild" — branch-vs-scheme rule + build-verification recipe [XS]
  - New lead section in `wiki/iOS-Native-App.md` (mirrored in CLAUDE.md): build BOTH apps from `main` by default — the branch picks the code, the scheme picks the flavor; Boomerang Dev targets the dev *server*, not the dev *branch* (build from `dev` only for unpromoted work). Includes the how-do-I-know-I'm-current recipe: Settings → General → App build vs `git describe --tags origin/<branch>` (fetch tags — prod releases are auto-tagged, e.g. `v2.24.3`), and the reminder that a new capability's first build needs one interactive ⌘R for signing registration. Written after a stale-build round where the phone showed `v2.24.1-1-gba5d8a5` while the tips were two fix-rounds ahead.

- fix(notifications): native-only phones got nothing — engine bailed on zero web subscriptions [S]
  - Prod catch, and a real Phase-4b hole: `runPushCheck()` and `checkPushDigest()` kept their pre-4b `if (subscriptions.length === 0) return` guards, so a native-only setup (APNs device registered, zero web-push subscriptions — exactly the recommended end state) never reached the dual-leg `sendPush()`: no nags, no digest, nothing. Both bails are now native-aware (`subscriptions.length === 0 && !hasApnsTargets()`), with `hasApnsTargets()` (configured + ≥1 device) exported from `apnsNotifications.js`. The send-path functions (`sendPackagePush`/`sendQuokkaPlanReadyPush`/`sendDigestPush`) had no such guards and were already correct. Startup log now reports both legs ("0 web subscription(s), native APNs active" — live-verified).

- fix(ui): APNs "already enabled" detection + locked-toggle explainers [S]
  - Prod annoyance report: the APNs "Enable on this device" button rendered stateless — identical before and after registration ("Do you have a clean way to detect that notifications are already enabled?"). Three-part fix:
  - **Per-device state:** `enableNativePush()` stores the device token (`boom_apns_token`, quota-safe); `GET /api/apns/status?token=…` now answers `this_device: true|false` (`getApnsStatus(deviceToken)` in `apnsNotifications.js`); the Settings button becomes a disabled "✓ Enabled on this device" when registered. Live-verified (registered token → `this_device:true`, unknown → `false`).
  - **Launch keep-fresh:** `refreshNativePushRegistration()` in `nativePush.js`, called from AppV2's mount effect — re-registers on every launch per Apple guidance (tokens rotate on restore/reinstall). Guarded on permission already granted, so it can never trigger the iOS permission prompt.
  - **Locked-toggle explainers** (companion report: "why don't I have the ability to enable these?"): the Notification-types section now says which channel columns are locked because their masters are off, and the APNs row shows a red warning when devices are registered but the Push master is OFF — the state where Send test works (direct endpoint) but no real nag would ever send natively.

- fix(store): quota-safe localStorage — the native shell's "Boomerang hit a snag" crash [M]
  - Native-app crash report (ErrorBoundary screen): `setItem` threw "The quota has been exceeded" during hydrate on the `capacitor://localhost` origin, and `save()` had no error handling, so the QuotaExceededError killed the whole render. Unrecoverable by design flaw: "Clear local state & reload" re-hydrated from the server straight back into the same overflow.
  - **Biggest payload found:** `logActivity()` stored a FULL task snapshot per entry — base64 `attachments` included — 500 entries deep. Snapshots now go through `slimSnapshot()`: attachments reduced to a count (`attachments_count`), notes capped at 2000 chars. Snapshots exist for metadata recovery; attachment bodies never belonged there.
  - **`safeSetItem()` in `store.js`** — every localStorage write in the app now rides it (store saves, modified stamps, activity/notif logs, mutation queue, external-sync queue, packages cache, Notion page cache, notification throttle stamps; `apiConfig.js` gets a local try/catch since it must stay import-free). On quota: evict the convenience caches (`boom_activity_log_v1`, `boom_notif_log_v1`, `boom_packages_v1` — all rebuildable or server-backed), retry once, and if the payload still doesn't fit, warn once and continue in-memory. The server is the source of truth; a failed cache write now degrades to "stale offline cache," never a dead app.
  - Deliberately NOT done: stripping attachments from the cached tasks blob itself — a stripped cached record pushed back per-record could erase attachments server-side. The durable upgrade path is moving the offline cache to IndexedDB (no meaningful quota); tracked as future work.

- feat(notifications): Phase 4b — full native APNs coverage as the Push channel's second delivery leg [M]
  - Every notification type now delivers natively to the iOS app. Architecture: **not** a 4th engine loop — `sendPush()` in `pushNotifications.js` is the single choke point every push-type notification already funnels through (crisis, escalation, high-pri, overdue, stale, nudge, size, pile-up, habit pace, routine suggestions, digest, packages, Quokka plan-ready, test), so the APNs leg slots in there: native first, web push second. The long-planned "centralized dispatcher when the 4th transport lands" shrank to this — no new loop, no new toggle matrix, no new throttle keys.
  - **Arbitration (the duplicate-killer):** native landing on ≥1 device skips **Apple** web-push endpoints (`push.apple.com` — Safari/Home-Screen PWA), so a phone carrying both the PWA and the native app gets exactly one banner. Desktop Chrome/Firefox always receive. Native sending 0 (unconfigured/no devices/bad key) falls through to full web push — the native leg can only reduce duplication, never drop a notification. Escape hatch: `push_web_alongside_native` (default off), shown in Settings once a device is registered, for a PWA on a *different* Apple device.
  - APNs rides the Push master + per-type `push_notif_*` toggles + `push_` throttles; deep links carry the same `?task=` URLs so engagement analytics (tap/completion) work unchanged. `threadId` = the payload tag, so iOS groups banners by notification type.
  - Settings: APNs row now visible from ANY client when the server is configured (status + Send test; the Enable button stays native-shell-only since it needs the Capacitor bridge); Push master relabeled "Push" with the two-leg description. `sendTestPush` no longer refuses on zero web subscriptions when native devices exist.
  - **Live-verified against Apple's real sandbox:** booted with a fake-but-valid P-256 key + registered device → dual-leg send ran, APNs HTTP/2 request reached `api.sandbox.push.apple.com` and got the correct `403 InvalidProviderToken` for fake creds, engine fell through to the web leg cleanly and reported an honest failure. With real credentials that 403 is a 200.

- feat(notifications): channel truth — dev muzzle, push-device registry, honest toggles, panel reorg [M]
  - Prod report: duplicate notifications ("server pushing Pushover while my app is doing iOS push") while the app's own toggles showed channels off. Root causes addressed as a class, since APNs can't be the sender (it delivers only test banners until Phase 4b):
  - **Dev-instance notification muzzle.** A dev-shaped server (`APP_VERSION` = `dev`/`dev-*`) now NEVER background-sends: the three engine loops (and with them the digest), package status sends, weather alerts, and the Quokka plan-ready push are all gated by `notifsMuzzled` in `server.js` (weather check duplicated per-file in `weatherSync.js`, same pattern as `isPileupExempt`). The moment dev shares the user's real Pushover/SMTP/push credentials (a settings copy or one test-config session), every nag fires twice — prod + dev — which is exactly the duplicate class reported. Direct test endpoints stay live so channels can still be validated from the dev UI. Opt out with `DEV_NOTIFICATIONS=1`. Exposed as `notifsMuzzled` on `/api/health`; Settings → Notifications shows a banner on muzzled instances.
  - **Web-push subscription registry.** `GET /api/push/subscriptions` + `DELETE /api/push/subscriptions/:id` (`deletePushSubscriptionById` in db.js) — every live subscription listed with push-service origin (Apple/Chrome/Firefox heuristic) + date in Settings → Notifications → Channels, with per-device Remove, rendered regardless of the master toggle. This is the only way a client can see a STALE device's subscription (e.g. the old Home-Screen PWA still receiving web push that looks like "native iOS push" — invisible from the native app, which can't inspect another context's subscription).
  - **Honest toggle display.** Per-type channel toggles (types matrix, package cards, Quokka plan-ready, digest rows, weather rows) used to render checked-but-faded when their channel master was off — visually "on" while nothing would send (screenshot-reported). Display is now master-gated: a toggle reads OFF whenever its channel master is off.
  - **Panel reorganization.** Notifications tab now reads delivery → content → modes → guardrails → diagnostics: Channels (masters + device rows + registry + APNs) → Deep links (public app URL + Pushover link mode, now with a standard section header + collapse) → Notification types → High-priority escalation → Critical mode → Pile-up → Quiet hours → Daily digest → Email deliverability → Weather → Test channels → Notification history (tests + history moved to the end as diagnostics; Critical moved up beside escalation).

- fix(ios): ios-deploy.sh — robust device detection + bundle-id install guard [S]
  - First real run on the Mac exposed both weaknesses. (1) Device detection grepped `devicectl list devices` table output for the literal word "connected" + a hardware-UDID-shaped token — found nothing on the user's machine, so the script exited before ever building (diagnosed via the missing `Debug-Dev-iphoneos` product; the app that DID land on the phone was an Xcode ⌘R with the prod "App" scheme still selected, which looked like "ios:dev built over my prod app"). Now uses `devicectl list devices --json-output` parsed by an embedded python3 heredoc: prefers `tunnelState == 'connected'`, falls back to any paired device (Wi-Fi pairing reports `available`), takes `hardwareProperties.udid` (falls back to `identifier`). Parser logic unit-tested against a synthetic devicectl JSON shape. (2) New install guard: after the build, PlistBuddy reads the product's `CFBundleIdentifier` and the script **refuses to install** when it doesn't match the scheme's expected bundle id — a config/scheme mixup can no longer silently touch the wrong app on the phone; the built id + display name are echoed before install.

- fix(ui): APNs controls belong in the Channels section, not the Public-app-URL card [XS]
  - Prod report: the native-push block "looks super stupid" as its own one-off section — the Notifications panel already models delivery channels (web push / email / Pushover rows in **Channels**, with web push's "Enable on this device" sub-row as the per-device registration pattern). The APNs block was nested inside the unrelated "Public app URL" card. Moved into Channels as the 4th channel row ("Native iOS (APNs)", native-shell-only), mirroring the web-push device-row layout (column row, same `v2-settings-btn` actions). No behavior change — same status line, Enable, and Send test wiring.

- fix(ios): App Shortcut phrases can't embed a String parameter [XS]
  - Second Mac-compile error in `BoomerangIntents.swift`: "'AppEntity' and 'AppEnum' are the only allowed types for 'taskTitle'". Siri phrases may only embed AppEnum/AppEntity parameters (finite vocabulary); the two parameterized phrases (`"Add \(\.$taskTitle) to …"` / `"Throw \(\.$taskTitle) to …"`) were invalid for a free-form String. Replaced with four non-parameterized phrase variants — Siri collects the title via the parameter's `requestValueDialog` ("What's the task?") instead, which is the standard dictation flow for free-text intents.

- fix(ios): raise iOS deployment target 15.0 → 16.0 — AppIntents requires it [XS]
  - First real Mac compile of the Mac-session bundle failed: every AppIntents symbol in `BoomerangIntents.swift` errored "only available in iOS 16.0 or newer" because the App target (and project) still carried the Capacitor template's `IPHONEOS_DEPLOYMENT_TARGET = 15.0` (`-target arm64-apple-ios15.0` in the failing swiftc invocation). All 12 remaining `15.0` entries in `project.pbxproj` (project-level + App target, Debug/Release + their `-Dev` clones) bumped to `16.0`, matching the ShareExtension configs which were authored at 16.0 from the start. Chose the target bump over sprinkling `@available(iOS 16, *)` — `AppShortcutsProvider` registration doesn't gate cleanly, and the only device this app targets runs iOS 27. pbxproj re-validated with mod-pbxproj after the edit.

- feat(ios): `npm run ios:dev` / `ios:prod` — one-liner build+install+launch [S]
  - `scripts/ios-deploy.sh` (npm aliases `ios:dev` → scheme "App Dev" / `ios:prod` → scheme "App"): npm install → web build + `cap sync` → `xcodebuild` the requested scheme/config (`Debug-Dev`/`Debug`) for the first connected iPhone (`xcrun devicectl` autodetect, or pass a UDID) with `-allowProvisioningUpdates` → `devicectl install` + launch. No Xcode UI. `ios/build` (the script's derivedDataPath) gitignored. Caveat documented in the script: a brand-new capability (e.g. a not-yet-registered App Group) can require one interactive ⌘R in Xcode before headless signing works; steady-state is fully CLI. `npm run ios` (the Xcode-GUI flow) unchanged.

- feat(ios): the Mac-session bundle — Share Extension + App Intents + side-by-side Dev app [L]
  - **Everything pending a Mac build, consolidated onto dev in one change** (per user: "get literally everything prepped that needs a Mac session and smash it together"), plus the requested **dev/prod app split** so testing never touches prod data.
  - **Dev app (new):** full second build-configuration set — `Debug-Dev`/`Release-Dev` on the project and BOTH targets, and a shared **"App Dev" Xcode scheme** alongside "App". The Dev app is `ryakel.boomerang.app.dev` / display name "Boomerang Dev" / URL scheme `boomerang-dev` / App Group `group.ryakel.boomerang.dev` / a DEV-badged icon (`AppIcon-Dev.appiconset`, generated from the brand SVG with an ember DEV banner) — installable **side by side** with prod, with its own data container and its own Connection config (point it at tasks-dev). All branding flows through three build settings (`BOOMERANG_APP_GROUP`/`BOOMERANG_URL_SCHEME`/`BOOMERANG_DISPLAY_NAME`) substituted into Info.plist and the entitlements, and read by Swift via `Bundle.main` (`BoomerangAppGroup` key) — one codebase, zero `#if` forks. Server side: `buildDeepLink()` emits `boomerang-dev://` when `APP_VERSION` matches the dev pattern (same detection as `isDevEnv`), so the dev server's Pushover links open the Dev app. APNs: the dev server needs `APNS_TOPIC=ryakel.boomerang.app.dev` (env-driven already).
  - **Phase 2 Share Extension, rebased onto current dev** (supersedes PR #660): `ios/App/ShareExtension/` target fully wired in the pbxproj (all four configs), App Group now config-driven.
  - **Phase 3 App Intents (NEW — `BoomerangIntents.swift`):** in-app AppIntents (iOS 16+, no extra target) — "Add Boomerang task" for Siri / Shortcuts / Spotlight / Action button / Back Tap, with an `AppShortcutsProvider` phrase set ("Throw X to Boomerang"). Reads base+token from the App Group, POSTs `/api/intake`, replies "Caught it" — runs in the background, no app launch.
  - **Validated:** mod-pbxproj structural pass (both targets × all four configs resolve, embed phase + dependency correct, project-level configs present); both `.xcscheme` files parse as XML; both Info.plists parse with the substitution vars; lint 0 / tests 17/17 + smoke / `cap config` parses. Real compile is the Mac session (checklist in `wiki/iOS-Native-App.md`).
  - **The user asked for this well before the Pushover deep-link detour; building it directly now.** Native, Boomerang-branded iOS notifications where **tapping the banner itself opens the native app** — the thing neither web push (opens PWA/Safari) nor Pushover (opens the Pushover app) can do.
  - **Server (`apnsNotifications.js`, added to the Dockerfile runtime COPY list):** APNs HTTP/2 sender with **zero new dependencies** (Node `http2` + `crypto`); token-based auth via ES256 JWT (45-min cache; signing verified against a locally-generated P-256 key — 64-byte ieee-p1363 signature, round-trip verified). Config is env-only like SMTP: `APNS_KEY_P8` (literal/`\n`-escaped/base64), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` (default `ryakel.boomerang.app`), `APNS_ENV` (`sandbox` default — Xcode debug builds — or `production`). Unconfigured = complete no-op. Device tokens live in the `apns_devices` app_data carve-out (token → timestamps; NOT the clobber-able settings blob); stale tokens (410/`BadDeviceToken`/`Unregistered`) pruned on send. Endpoints: `GET /api/apns/status`, `POST /api/apns/register|unregister|test` — all live-tested against a booted server (status/missing-env report, hex token validation, graceful unconfigured test send, unregister).
  - **Client:** `src/nativePush.js` — `enableNativePush()` (permission → APNs register → POST token, 15s timeout with actionable errors) + `wireNativePushTapHandler()` (banner tap → payload `url` → the shared `applyDeepLink()`, wired in `AppV2` beside the `appUrlOpen` listener). Settings → Notifications → Channels gains a native-only "Native iOS notifications (APNs)" block: server status line, **Enable on this device**, **Send test**. `@capacitor/push-notifications@8.1.2` added.
  - **Native project:** AppDelegate gains the two `didRegister/didFailToRegister` forwarding methods the plugin requires; `App/App.entitlements` with `aps-environment: development` wired into both App configs (`CODE_SIGN_ENTITLEMENTS`, pbxproj reparses clean); `capacitor.config.ts` `PushNotifications.presentationOptions` (banner/sound/badge in foreground).
  - **Scope honesty:** this is the **pipeline** (register + send + tap-routing + test). Full notification-type coverage (high-pri ladders, overdue, digest, packages — the 4th transport loop, or the long-planned centralized dispatcher) is Phase 4b on top.
  - **Turn-on:** (1) developer portal → Keys → + → enable APNs → download `.p8`, note Key ID; (2) enable Push Notifications capability for the App ID (Xcode does this automatically on next build with the entitlement present, paid team); (3) set the four env vars on the server container; (4) `npm run ios`, then in the app: Settings → Notifications → Enable on this device → Send test.

- fix(notifications): Pushover link mode carved out of the settings blob — un-clobber-able [S]
  - **Round 2 of "the toggle never saves":** even with `preserveAbsentSettings()`, the toggle still reverted on force-quit/navigation. Cause: the guard only protects ABSENT keys — any client on a **current** bundle whose localStorage predates the user's flip sends an explicit `pushover_open_native: false` (defaults merge in `loadSettings()`), and explicit values must win or nothing could ever be turned off. A boolean in a whole-blob LWW sync across N devices is unfixable by guards.
  - **Fix — the growth-areas carve-out pattern:** the setting now lives in its own `app_data` key (`pushover_link_mode`) with dedicated endpoints `GET/POST /api/pushover/link-mode`; the Settings toggle reads/writes those directly (optimistic, reverts on failure), and `buildDeepLink()` reads the carve-out first (legacy blob key = fallback only). No bulk blob push can touch it, by construction.
  - **Verified live, including the attack:** booted the server, set link-mode true, then pushed a bulk settings blob containing an explicit `pushover_open_native: false` — link-mode read back `true`. The clobber path is disconnected, not guarded.
  - Note: the native app's previously-installed bundle still shows the OLD blob-backed toggle until its next rebuild — set the mode from the prod web app (or verify at `/api/pushover/link-mode`) in the meantime.

- feat(settings): show the connected server's version next to the app build [XS]
  - **Prod feedback (justified):** "you have mangled the app version and the server version and removed the caching refresh so I have no idea what to track." Since the native shell disabled version-mismatch reloads (correctly — they boot-looped), there was NO user-visible way to tell what the *server* is running: the Settings Build row shows the client bundle's `__APP_VERSION__`, which in the native app is the Xcode-built bundle and never matches the server's Docker tag.
  - Settings → General now has two labeled rows: **App build** (this client's bundle, hint text explains native-vs-web semantics) and **Server version** (live `appVersion` from the connected server's `/api/health`, piggybacking the existing isDev health fetch). "Did the deploy land?" is now answered in-app on any client, native included.

- fix(sync,server): stale clients erased new settings keys — `pushover_open_native` "never saves" [S]
  - **Prod report, angry and correct:** the new "Open Pushover links in the iOS app" toggle never persisted, so Pushover kept deep-linking to the web app. Mechanism: the documented whole-blob last-writer-wins hazard (Derived-Stat Durability rule 5) — any client still running a **pre-feature bundle** (installed PWA, open desktop tab) has no `pushover_open_native` in its localStorage blob, and its next bulk push (autosave, pagehide beacon) wholesale-replaced the server blob, erasing the toggle seconds after it was set. I added a new durable settings key without the required server-side guard.
  - **Fix — the generalization, not another one-off:** `preserveAbsentSettings(prev, next)` in `server.js`, wired into both bulk write paths (`PUT`/`POST /api/data`) ahead of `mergeDurableStreakSettings`: any key present in the stored blob but **absent** from the incoming blob keeps its stored value. Absent ≠ turned off — every hydrated client sends explicit values for all `DEFAULT_SETTINGS` keys, so toggling something off still works; only stale bundles omit keys. This protects every FUTURE settings key from the same erasure, ending the per-key-guard whack-a-mole for plain values (monotonic keys like `streak_anchor`/unions keep their stronger guards). `POST /api/data/restore` deliberately untouched (explicit wipe-and-replace semantics). Logs `[SYNC] settings guard: … preserved: <keys>` so occurrences are visible in server logs.
  - Verified: behavior test (preserve on omission, explicit-false wins, null-safe), `npm test` 17/17 + smoke, lint clean.

- feat(ios): `npm run ios` one-command rebuild + tappable Pushover test [XS]
  - **`scripts/ios-rebuild.sh` (npm alias `npm run ios`):** `npm install` → `npm run build` → `cap sync ios` → `cap open ios`, with friendly step output. Fixes the newbie trap where checking out a branch that added a dependency (`@capacitor/app`) and running `build:mobile` fails with "failed to resolve import" because `build:mobile` doesn't install. Use `npm run ios` as the standard rebuild-after-pull command.
  - **Pushover test notification is now tappable:** `sendTestNotification()` had no `url`, so there was no "Open in Boomerang" link to test the deep link with. It now includes `buildDeepLink(settings, null)` — with `pushover_open_native` on that's `boomerang://` (opens the native app), so the Settings → Pushover → Test button verifies the native deep link end to end.

- feat(notifications,ios): Pushover deep links open the native iOS app [M]
  - **User report:** tapping a Pushover notification opened the *web* app in Safari, not the installed native app. Cause: `buildDeepLink()` in `pushoverNotifications.js` always returned the https `public_app_url` (`https://.../?task=<id>`), which iOS hands to Safari — the native WebView loads `capacitor://localhost` and never matches an https URL.
  - **Fix:** a custom URL scheme the native app owns. New `pushover_open_native` setting (default OFF — web-only setups unchanged): when on, Pushover deep links become `boomerang://?task=<id>`. The app registers the `boomerang` scheme (`CFBundleURLTypes` in `ios/App/App/Info.plist`) and routes the tap via `@capacitor/app`'s `appUrlOpen` (+ `getLaunchUrl()` for cold start) into the existing deep-link handler, which now lives in a reusable `applyDeepLink(search)` in `AppV2.jsx` (shared by the web `?task=` path and the native scheme). The native listener runs once via a ref so a tasks-state change can't re-fire the launch task. Settings → Notifications → Channels gains an "Open Pushover links in the iOS app" toggle below Public app URL.
  - `@capacitor/app@8.1.1` added (matches Capacitor core 8; peer `>=8.0.0`). `npm audit` clean.
  - **Bundle-check fix (necessary, THREE copies):** the JS-bundle syntax check used `new Function(bundle)` (script mode), which rejects the top-level `import`/`export` Vite emits once anything is code-split — and `@capacitor/app` lazy-loads its web impl, forcing a split. The same `new Function` check was duplicated in `scripts/smoke-test.sh` (pre-push) AND inline in both `.github/workflows/build-and-publish-dev.yml` and `build-and-publish.yml` (the `JS FAIL: Unexpected token 'export'` that failed CI on #661). All three replaced with `node --check` on the fetched bundle (module-aware). Same coverage (syntax only), correct for ESM output, future-proofs the remaining native plugins.
  - **Turn-on (Mac):** `git pull` → `npm run build:mobile` (syncs `@capacitor/app` + the URL scheme) → ⌘R; then Settings → Notifications → toggle "Open Pushover links in the iOS app". No entitlement/capability/paid requirement — it's just a URL scheme.

- feat(ios): Phase 0 — native token bridge (App Group) [S]
  - Foundation for every out-of-WebView native surface (Share Extension, App Intents, native push): those run in Swift processes that can't read the WebView's `localStorage`, where the connection config lives. `BoomerangNative.swift` — a `CAPBridgedPlugin` exposing `setSharedConfig`/`getSharedConfig` — mirrors `boom_api_base`/`boom_api_token` into an App Group container (`UserDefaults(suiteName: "group.in.kfam.boomerang")`). `src/apiConfig.js` calls it from `setApiConfig()` (every Connection-screen save) and once on interceptor install (covers configs set before this build). WebView stays the source of truth; the bridge only writes what JS hands it.
  - **Safe to ship inert:** no entitlements/signing touched, so it can't break the current build. Until the App Group capability is added in Xcode (paid account), `UserDefaults(suiteName:)` returns nil and the plugin resolves `stored:false` — a silent no-op. On web, `isNativeShell()` is false so nothing runs; `@capacitor/core` is now pulled into the bundle (+8KB) but only `registerPlugin` (proxy factory), never invoked off-native.
  - Verified: lint 0 errors, `npm test` 17/17 + smoke green.

- fix(ios): belt-and-braces + instrumentation for the shrunken layout viewport [S]
  - The first `obscuredContentInsets = .zero` pass may not have been in the tested binary (screenshot looked identical pre/post; build-vs-pull timing ambiguous). Rather than another blind round: `BoomerangViewController` now (1) **logs** `⚡️ [Boomerang] fullBleed(...)` lines to the Xcode console with the inset/safe-area/frame values it found — proving from the console whether the override runs and which mechanism the system used; (2) zeroes the viewport through **both** shrink-capable APIs (`obscuredContentInsets`, iOS 26+, and `setMinimumViewportInset(.zero, maximumViewportInset: .zero)`, iOS 15.5+); (3) re-asserts in a post-`viewDidAppear` async pass to catch late system writes.

- chore(ios): real app icon — replace Capacitor's placeholder [XS]
  - The committed native project shipped the template's generic icon. Rendered `public/icon-512.svg` (the Kept arc-into-catch mark on the dark ground) at 1024×1024, flattened opaque (iOS app icons reject alpha), into `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`. Native-only; the PWA icons are untouched. If the phone keeps showing the old icon after a rebuild, delete the app from the Home Screen once — iOS caches icons per install.

- fix(ios): zero the iOS 26+ auto-obscured viewport insets — layout viewport 96pt short [S]
  - **Diagnosed with a real probe** (Web Inspector finally reachable thanks to the forced inspectability): `innerHeight=778` / `visualViewport.height=778` vs `screen.height=874`, while `env(safe-area-inset-top/bottom)` correctly reported `62px`/`34px` — the layout viewport was short by *exactly* the safe-area sum. Rotation didn't fix it. The iOS 26+ SDK auto-populates WKWebView's viewport-obscuring insets (the `obscuredContentInsets` machinery, Safari 26 cycle) from the safe area for a root-view web view, shrinking the layout viewport — and since the app's CSS ALSO pads with `env()` (the PWA mechanism), everything got double-shrunk: bottom tab bar floating ~96pt above the screen bottom with the WebView's white background showing beneath, header pushed down after rotation. Capacitor 8.4.2 has no iOS-26 handling at all (verified against its Swift sources).
  - **Fix:** `ios/App/App/BoomerangViewController.swift` — a `CAPBridgeViewController` subclass (now the storyboard's root VC, `customModuleProvider="target"`) that sets `webView.obscuredContentInsets = .zero` under `#available(iOS 26.0, *)`, re-asserted in `viewDidLayoutSubviews` so rotation/safe-area recomputes can't re-inset it. CSS keeps sole ownership of safe-area spacing, same as the installed PWA.
  - **Mac report (app now fully renders + syncs):** the Kept bottom tab bar was smashed at the screen bottom — labels clipped by the home indicator, plus a dead band below the bar. Cause: the Phase-1 scaffold set `ios.contentInset: 'always'` in `capacitor.config.ts`, which makes the native WKWebView inset the page content — stacking on top of the app's own CSS safe-area handling (`env(safe-area-inset-*)` + `viewport-fit=cover`, the mechanism the installed PWA already uses). The doubled offset pushed the fixed bottom bar half off-screen. Removed the option (default edge-to-edge) so the CSS is the single source of truth, same as the PWA. Requires `npx cap sync ios` to propagate.

- fix(sync): version-mismatch reload disabled in the native shell — infinite boot loop [S]
  - **Mac report (the launch after the scene fix — app now boots, connects, and authenticates):** stuck cycling `SSE: connected → VERSION MISMATCH — client=v2.16.1-15-gf36e16f server=dev-f36e16f → reload`. The stale-client update path (`useServerSync`'s `fireVersionMismatch` → AppV2 unregisters service workers + `location.reload()` after 1s) assumes reloading fetches the server's new bundle. In the Capacitor shell the bundle is baked into the binary: the client version comes from `git describe` on the build Mac while the server's is Docker's `APP_VERSION` (`dev-<sha>`), so they NEVER string-match — same commit included — and a reload can't change anything → infinite loop. Worse, the SSE mismatch path `return`s before `fetchAndHydrate`, so the app never even loaded data between reloads.
  - **Fix:** `VERSION_CHECKS_ENABLED = !isNativeShell()` in `useServerSync.js`, gating both check sites (the SSE `connected` handler and the on-demand `checkVersion()`). Native bundle updates ship via app rebuilds (`npm run build:mobile` + Xcode), not server pushes — the web/PWA update flow is untouched.
  - **Mac report:** the app crashed at launch with `EXC_BREAKPOINT` on the `AppDelegate` class line. Console had the real story: *"Application failed to launch: UIScene life cycle is required for apps built with this SDK. See Technote TN3187."* The iOS 27 SDK (Xcode 27) hard-requires the UIScene lifecycle; Capacitor 8.4.2's app template still ships the legacy AppDelegate-only lifecycle, so every fresh `npx cap add ios` project aborts at launch on the new toolchain.
  - **Fix:** `ios/App/App/SceneDelegate.swift` (window via the Main storyboard's `CAPBridgeViewController`; cold- and warm-start deep links / universal links forwarded to `ApplicationDelegateProxy` — under scenes the AppDelegate url handlers are no longer called) + `UIApplicationSceneManifest` in `Info.plist` (single scene, `UISceneStoryboardFile: Main`, replaces `UIMainStoryboardFile`) + the pbxproj references for the new source file.
  - **`ios/` is now committed** (generated via `npx cap add ios` — works on Linux, it's template extraction). Rationale: the scene migration would be silently lost on every regenerate, Phase 2's Share Extension needs the native project versioned anyway, and fixes reach the Mac via `git pull` instead of hand-edits in Xcode. Root `.gitignore` gained the build-output ignores (`ios/App/build`, `ios/App/output`, `ios/DerivedData`, `xcuserdata/`, `ios/capacitor-cordova-ios-plugins`) alongside the existing generated-file ignores (`public`, `capacitor.config.json`, `config.xml`, Pods). Note for the Mac checkout: the previously-untracked local `ios/` collides with the pulled one — `rm -rf ios && git pull && npx cap sync ios`, then redo Signing team + bundle id once (they live in the pbxproj).

- feat(ios): Phase 1.5 in-app Connection screen [M]
  - **Unblocks device setup without Safari:** even with inspectability forced on (below), the Xcode-27-beta Safari still showed "No Inspectable Applications" — so the Web-Inspector localStorage step (the only way to configure the native app) was pulled forward from the roadmap and built. `src/components/ConnectionSetup.{jsx,css}`: full-screen first-run form (server URL + API token, LoginScreen's visual language), **Test & save** verifies `/api/health` (base URL right) and `/api/auth/status` with `x-api-token` (token right) before persisting via `setApiConfig()`, then reloads so the fetch/SSE interceptor re-installs with the new config.
  - **Gating (`src/App.jsx`):** shows ahead of the auth check when `isNativeShell()` (new helper in `src/apiConfig.js`: `location.protocol === 'capacitor:'`) and no `boom_api_base` is configured — the relative `/api` probes would otherwise fail against `capacitor://localhost` and render an empty app. Reopen paths: native-only "Server connection / Change server…" block in Settings → Data; a "Change server or API token…" escape hatch on the login screen (in the native shell password login is a dead end — cross-origin fetches can't carry the session cookie, the token IS the credential); `?connect=1` on the web build for testing. Reopen plumbing is a one-shot sessionStorage flag (`requestConnectionSetup()`/`consumeConnectionSetupRequest()`).
  - Zero web/PWA impact: the screen only auto-shows under `capacitor:`, and the interceptor remains inert with nothing configured.
  - **Verification:** lint 0 errors; `npm test` 17/17 + smoke green; rendered via `?connect=1` in Chromium (dark Kept theme) — card, labels, error styling, and Cancel behave as designed.

- fix(ios): force WebView inspectability on iOS builds [XS]
  - **Mac build session, next blocker:** Safari's Develop menu showed "No Inspectable Applications" for the simulator — the Web-Inspector `localStorage` step (currently the ONLY way to configure `boom_api_base`/`boom_api_token` on a device, until Phase 1.5's in-app Connection screen) was unreachable. iOS 16.4+ WKWebViews are invisible to Safari unless `isInspectable` is set; Capacitor's `ios.webContentsDebuggingEnabled` claims auto-`true` for development builds but that detection didn't hold on the Xcode 27 beta toolchain. Set it explicitly `true` in `capacitor.config.ts` (release builds inspectable too — acceptable for a single-user personal app; revisit if this ever goes to TestFlight/App Store).

- chore(deps): Capacitor 6→8, TypeScript devDep, nodemailer 9 [S]
  - **Prod report from the first real Mac build attempt (macOS 27 / Xcode 27 beta):** `npx cap add ios` failed twice. (1) The repo never declared `typescript` as a devDependency even though `capacitor.config.ts` requires it to parse — and installing today's latest TypeScript (7.x) crashes the Capacitor CLI's config loader (`Cannot read properties of undefined (reading 'CommonJS')` — the CLI's `requireTS` uses the classic `ts.ModuleKind` API that TS ≥6 removed). Pinned `typescript: ^5.9.0` as a devDep. (2) An `npm audit fix --force` run on the Mac had half-upgraded the stack (`@capacitor/cli` 8.4.2 alongside core/ios 6.2.0) — mixed majors.
  - **Fix:** all three Capacitor packages aligned at `^8.4.2` (Capacitor 8 targets Xcode 26+, correct for current toolchains; its iOS template is SPM-based, so CocoaPods is no longer needed at all). `nodemailer` `^8.0.5` → `^9.0.3` (clears GHSA-p6gq-j5cr-w38f; the vuln's `raw` option is never used by `emailNotifications.js`, and the API surface we use — `createTransport`/`sendMail`/`verify` — is unchanged). This also clears the 3 pre-existing high `npm audit` findings flagged on 2026-07-14 (`@capacitor/cli`→`tar` chain): `npm audit` is now 0.
  - **Verification:** `npm test` green (17/17 unit + smoke: server boots on nodemailer 9, bundle parses); `npx cap config --json` parses `capacitor.config.ts` cleanly with CLI 8.4.2 + TS 5.9.3. No Dockerfile impact (all changes are deps; Capacitor/TS are client/dev-only, nodemailer version rides the existing `npm ci`).
  - Docs: `wiki/iOS-Native-App.md` prerequisites + generate steps updated (Xcode 26+, SPM instead of CocoaPods, TS note).

## 2026-07-14

- fix(tasks): tasks born with a settled size never got impact/tags/energy inferred [S]
  - **Prod report on `dev-c594f50` (after the starvation fixes landed and visibly worked on quick-add tasks):** some new tasks still got no AI treatment at all. Root cause: the background net keys entirely off `size_inferred` — a task created WITH a size (Quokka passes one on most `create_task` calls; a manual size pick in the add modal does the same) is born `size_inferred=true` and never enters the queue, so impact, auto-tags, and missing energy are never inferred for it.
  - **Fix:** `useSizeAutoInfer` gains a secondary fill-only candidate class — `size_inferred` true, `impact` null and not hand-set, `created_at >= '2026-07-14'` (the impact feature's ship date) — that runs the same single inference call but writes ONLY the still-unset fields (impact, merged tags, energy when missing; never touches the settled size). The `created_at` epoch gate preserves the deliberate lazy backfill: historical settled-size tasks stay at the impact-2 baseline instead of triggering an upgrade-day inference storm. `impact_inferred` is stamped even when the model returns no impact so a task can't be re-picked forever.

- fix(tasks): background AI hooks starved by task-list churn — triage/reality-check/inference never ran [S]
  - **Prod report (with screenshots, minutes after the dev deploy):** "I created the task, it tagged it as critical and then nothing else." Build was current (`dev-0ab833d`), settings correct — the task showed no Triage checklist, no Reality-check verdict, no auto tags/impact.
  - **Root cause, two layers in the shared background-hook pattern (`useSizeAutoInfer` → copied into `useCrisisTriage` + `useRealityCheck`):** (1) the effect marks the task `attempted` and arms a throttle timer, but the cleanup — which runs on EVERY `tasks` identity change — cancelled the timer while `attempted` still blocked a re-pick, so any list churn inside the throttle window (autosave, the server's `crisis_since` stamp echo, SSE refetch) permanently starved the task for the session; (2) even when the timer fired, the post-`await` `cancelled` guard dropped the finished result whenever the list changed during the multi-second AI call — which is the NORMAL state right after creating/tagging a task. The sizer had shipped with this latent shape for months, masked by `handleAddTask`'s direct inference path covering the quick-add flow; the two new hooks have no direct path, so the bug surfaced immediately.
  - **Fix (all three hooks):** cleanup releases the id from `attempted` when the call never started (churn now just re-picks the task next effect run); the result write is no longer gated on effect cleanup (`updateTask` by id is safe under churn) and merges against a `latestTasks` ref instead of the stale closure so a tag/checklist the user added mid-call is never clobbered. Failure semantics: once a call actually runs and fails on a REAL API error (no key, parse error), the task stays blocked until next app load — but NETWORK-shaped failures (iOS suspending the PWA mid-call, offline blips) now release the id for a retry on the post-resume refetch (`isNetworkError()` in `src/api.js`: `inferSize`/`generateCrisisTriage`/`generateRealityCheck` rethrow fetch TypeError/AbortError instead of swallowing them).
  - **Same report, second symptom ("can't navigate away from Quokka without it failing"):** backgrounding the PWA kills the SSE reader and freezes the poll timers mid-turn; the detached server-side runner keeps working, but the client had NO resume path — `tryResubscribe` only ran on initial hydration, so returning to the app landed on a dead stream or a "Could not retrieve response" error with the finished answer sitting in the session buffer. `useAdviser` now re-attaches on every `visibilitychange`→visible (session present + no live stream → subscribe-only resubscribe, buffered events replay, stale error state cleared; dead session 404s silently). Also made the unmount cleanup stream-only and explicitly NOT `adviserAbort()` — the old cleanup's `[]`-frozen `sessionId` closure meant it never actually fired, which was accidentally correct (aborting the detached runner on every page refresh would kill running plans); now it's correct on purpose.

- feat(tasks): DIY-or-hire "Reality check" on repair/construction tasks [M]
  - **User request (verbatim):** "I want to also include some AI push to not let my pride get in the way. I am admittedly not handy. I should stop trying to always fix shit myself. Maybe instead the plan should be to push me for construction and repair like tasks to figure out if I should actually be doing it or hiring it out." Decisions (asked one batch, all recommended): auto-run on EVERY repair-shaped task (no button — pride would never tap "question my competence"), the verdict STARTS at hire-out and DIY has to earn it (trivial jobs only; water/gas/electrical/roof/structure = automatic hire), and nags switch framing once a hire verdict lands.
  - **Migration 042:** `diy_assessed`/`diy_verdict`/`diy_reason`/`diy_first_move` on tasks. Detection is a free deterministic regex (`isRepairTaskShape()` in `src/store.js` — strong repair nouns/verbs; bare "fix" only counts with physical/errand energy); the assessment itself is one AI call via the new `useRealityCheck` background hook (mirrors `useSizeAutoInfer`/`useCrisisTriage`, gated by new `diy_reality_check` setting, default on) → `generateRealityCheck()` in `src/api.js` with the hire-default stance baked into the prompt (custom instructions can carve exceptions).
  - **Nag framing on 'hire' (all three engines):** critical bodies swap their "First move" for `diy_first_move` and add "hire it out" to the status bits; high-pri bodies append "you decided to hire this out. First move: …"; the quick-win nudge becomes "Make the call" with the hire first-move; the digest suffixes "· hire it out" on Big-rock/Today/Carrying lines. `generateCrisisTriage()`'s prompt now defaults repair-crisis plans to warranty/quotes/book-the-pro after stop-the-bleeding.
  - **UI:** EditTaskModal "Reality check" banner (verdict pill, blunt reason, first move) with a flip-the-verdict override ("I'm doing it myself anyway" ↔ "Actually, hire it out" — 'diy' returns nag framing to normal, no re-run); 🛠 "hire it out" chip on Kept Today/Anytime/Critical/Tasks rows; Settings → Tasks toggle.
  - **Quokka:** new system-prompt rule 11 (push quotes not DIY steps, never validate non-trivial DIY plans, stage verdict flips when the user decides — Impact renumbered to rule 12); `summarizeTask` exposes `diy_verdict`/`diy_first_move`; `update_task` whitelist accepts the four diy_* fields.
  - Known limitations documented in CLAUDE.md: keyword-based detection can miss oddly-phrased repairs; no cost lookup (use Quokka `research_task`); verdicts never auto-rerun.

- refactor(tasks): rename the crisis tag's user-facing term to "Critical" [S]
  - **User request (same day the feature shipped):** "I'd like to reframe crisis across the board to be Urgent … Or maybe Critical?" — resolved via two questions: term = **Critical** (severity state, pairs with 🚨/Emergency, distinct from both the High priority flag and due-date urgency); tag = **renamed to match** (`critical`, not keeping `prio`).
  - **User-facing copy renamed everywhere:** notification titles (`🚨 CRISIS` → `🚨 CRITICAL` in push + email; body "in crisis Nd" → "critical for Nd" in all three engines), the staleness check-in ("Still a crisis?" → "Still critical?", push + EditTaskModal banner + Today-row chip), the pinned section ("🚨 Now" → "🚨 Critical" on Kept Today + Tasks), EditTaskModal checkbox ("🚨 Crisis mode" → "🚨 Critical"), the Settings card ("Crisis mode" → "Critical mode" with reworded hints), the What Now prompt marker/rule (`[CRISIS]`/`CRISIS RULE` → `[CRITICAL]`/`CRITICAL RULE`), and Quokka's system-prompt rule 10.
  - **Defaults renamed:** `DEFAULT_LABELS` entry `{id:'prio'}` → `{id:'critical'}`; `settings.crisis_label` default `'prio'` → `'critical'`; every code fallback updated. **Internal identifiers deliberately unchanged** (`crisis_since`, `crisis_triage_done`, `crisis_label`/`notif_freq_crisis`/`crisis_stale_days`/`crisis_auto_breakdown`, `isCrisisTask()`, `useCrisisTriage`, log type `crisis`) — same renaming-plumbing-provides-no-value convention as Quokka/adviser.
  - **Migration for the hours the old name was live:** a self-extinguishing reconciler effect in `AppV2.jsx` (loadLabels() never merges defaults into existing installs, so a one-shot shim in the loader couldn't cover task tags): renames a stored `prio` label in place (id + name, dropped instead if a `critical` label already exists), rewrites `prio` → `critical` in any task's tags, and normalizes a stored `crisis_label='prio'`. Idempotent; pure no-op once no `prio` remains; delete after prod data can't contain `prio` (same lifecycle as the theme shims).
  - Docs: CLAUDE.md section retitled with a terminology note, Features.md ("Critical"), Configuration.md, Architecture.md, spec doc banner, UPCOMING_FEATURES.md.

- feat(tasks): crisis tag ("prio") + impact-based prioritization [XL]
  - **Implements the whole plan merged this morning** (`wiki/Crisis-Tag-And-Impact-Ranking.md`, PR #646) in one PR per user instruction ("merge and build it all"). All resolved decisions honored: 2h crisis cadence, quiet-hours wake as separate opt-in, 7-day "Still a crisis?" check-in that never auto-demotes, NO impact points multiplier, Pushover Emergency at overdue-or-24h, impact as dots.
  - **Crisis tag (migration 040 — `crisis_since`, `crisis_triage_done`):** `isCrisisTask(task, settings)` exported from `db.js` (mirrored client-side in `store.js`); per-task crisis loop in all three engines (`pushNotifications.js`/`emailNotifications.js`/`pushoverNotifications.js`) before the high-pri loop — exempt from its 3-per-tick cap, `notif_freq_crisis` default 2h + avoidance boost, never `adaptiveFreq()`d, bodies carry age/due/"First move: <first open checklist item>". Pushover: priority 1 → priority 2 Emergency at overdue-or-24h-in-crisis with receipt save; removing the tag counts as a resolution (`isResolutionUpdate`) and cancels a ringing alarm; quiet hours use the same per-task `wake-me` gate as high-pri. Crisis tasks excluded from hp/escalation loops + stale/nudge/pile-up pools (crisis outranks an active escalation ladder). `isNotifiable()` treats the tag as an opt-in (undated crises nag; optional `settings` param, fetched once in `filterNotifiableTasks`). `crisis_since` stamped/cleared in `upsertTask` (`applyCrisisTransition`) so every write path is covered. `useCrisisTriage` hook + `generateCrisisTriage()` auto-draft a 3-5-step stop-the-bleeding "Triage" checklist once per crisis (merge-only, flag resets on un-tag). Web-push "Still a crisis?" ping once per `crisis_stale_days` window + EditTaskModal banner (Keep re-stamps `crisis_since`; Demote swaps tag for high_priority). Pinned "🚨 Now" section on Kept TodayView + TasksViewKept (red rows, crisis age, first move, pulsing stale chip); What Now hard rule via new `crisisIds` param (crisis is pick #1, or its first move when the window's too small); Next-up +1000; digest leads Today with 🚨 and includes undated crises. Guardrails: crisis label excluded from AI auto-tag candidates in BOTH `useSizeAutoInfer` and `handleAddTask`; Quokka system-prompt rule 10 (only on explicit user declaration, stage a triage checklist alongside). New settings + `prio` default label; Settings → Notifications "Crisis mode" card (label/cadence/check-in/auto-triage); EditTaskModal "🚨 Crisis mode" checkbox with inline "Also wake me for this".
  - **Impact ranking (migration 041 — `impact` + `impact_inferred` on tasks, `impact` on routines):** rides the existing single `inferSize()` call (new rubric: 3 = people-you're-responsible-to/money/health/unblocks, 2 = own commitments, 1 = self-only; assignee = strong 3 signal); `impact_inferred` mirrors `size_inferred`; NULL scores as the 2 baseline (lazy backfill). Routine impact propagates at all four spawn paths like assignee. New pure `impactRank()` + `CRISIS_RANK` in `src/scoring.js` (base + due ladder 80/60/40/20 + weather-window 50 + event-proximity 0→50 ramp + stale decay −15 cap) with 9 unit tests (`scripts/impact.test.mjs`, wired into `npm test`); ctx built by new `src/impactContext.js` from `computeWeatherWindow()` (new export in `WeatherSection.jsx`: good day now, ≥2 of next 3 bad) + `settings.impact_dates` (`[{id,label,date,lead_days,tag}]`, editor in Settings → Tasks, Quokka-editable). Surfaces: Today/Anytime ordered by impactRank; "Impact" sort mode in Kept Tasks; tap-to-cycle dots chip (`src/kept/ImpactDots.jsx`, `handleCycleImpact` threaded through both Kept shells); EditTaskModal Impact segmented control (deselect = back to auto); What Now line data + prefer-higher-impact rule (size-vs-time HARD RULE unchanged); Next-up `+impact×25`; digest "🎯 Big rock today" line (impact-3, due-picked, sync-safe); "That one mattered." toast prefix on impact-3 completions; Analytics "By impact" breakdown (`byImpact` in `getAnalyticsHistory` + AnalyticsModal section). Quokka: `create_task`/`update_task`/`create_routine`/`update_routine` accept `impact` (stamps `impact_inferred`; null returns to inference), `summarizeTask` exposes `impact` + `crisis_since`, system-prompt rule 11.
  - **Docs:** CLAUDE.md (two new feature sections + auto-tag exclusion note), `wiki/Features.md` (Crisis Mode + Impact Ranking sections), `wiki/Architecture.md` (schema + crisis-loop transport note), `wiki/Configuration.md` (Crisis card, impact dates, default labels), plan doc flipped to SHIPPED with deviation notes, `UPCOMING_FEATURES.md` now lists only the parked follow-ups.
  - **Verification:** `npm test` 17/17 (8 existing + 9 new impact tests) + smoke test green (migrations 040/041 apply, server boots, bundle parses); `vite build` clean; eslint 0 errors. `npm audit`: 3 pre-existing high vulns via `@capacitor/cli`→`tar` (build-time devDependency; fix is a breaking major bump — flagged, not taken).

- docs(wiki): plan crisis tag ("prio") + impact-based prioritization [S]
  - **User request (planning only, no implementation yet):** (1) a tag like `prio` that flips a task onto a much higher priority path — nags relentlessly AND helps distill how to rapidly get started (washing-machine-broken scenario); (2) a better mechanism to prioritize by impact — spouse impact, holiday proximity, getting outdoor work done before a stretch of bad weather — because "doing lots of shit but none that feels super impactful."
  - New `wiki/Crisis-Tag-And-Impact-Ranking.md`: full two-feature spec. Crisis tag reuses the `wake-me` tag-as-behavior-switch pattern — per-task nag loop in all three engines at its own `notif_freq_crisis` cadence (default 2h, per user), Pushover priority 1 escalating to Emergency, exempt from adaptive-throttle back-off and the high-pri per-tick cap, counts as an `isNotifiable()` opt-in so undated crises still nag, auto-generated AI triage checklist (`crisis_triage_done`, migration 040), 🚨 pinned section, hard What Now preference, and a never-auto-applied guardrail (excluded from AI auto-tagging like `wake-me`). Impact is a stored AI-inferred 1–3 dimension (migration 041, rides the existing single `inferSize()` call, tap-to-cycle like energy) plus live rank-time boosts: weather-window-closing (reuses `pickBestDays` + `resolveWeatherVisibility`), event proximity via a manual `settings.impact_dates` list, and due proximity — all combined in one pure, unit-tested `impactRank()` in `src/scoring.js` consumed by sort order, What Now, Next-up scorer, digest "Big rock" line, completion toast, and an Analytics breakdown.
  - Spec includes the crisis-vs-impact ranking model (crisis is a separate manual-alarm axis, never "impact 4"), a 5-PR build order, and a parked list (GCal-derived event detection, crisis inline push actions, weekly impact recap). All decision points resolved by the user same-day, one at a time: 2h crisis cadence; quiet-hours wake stays a separate inline opt-in; "Still a crisis?" check-in at 7 days (configurable, never auto-demotes); NO impact points multiplier in v1; Pushover Emergency only at overdue-or-24h-in-crisis; impact rendered as dots (●●●).
  - `UPCOMING_FEATURES.md`: near-term entry pointing at the spec.

## 2026-07-12

- docs(wiki): Batch C Settings screenshot retakes after the tab-structure reorg [S]
  - Retook the four Settings shots (`settings-general/notifications/integrations/labels.png`, replaced in place) against the shipped 6-tab structure (`General, Tasks, Labels, Integrations, Notifications, Data`), and captured the new `settings-tasks.png` for the Tasks tab. Same conventions as the original pass (seeded dev DB, light mode, desktop 1440×900 @2x).
  - The two content-stale shots now show what the reorg actually built: `settings-general.png` is pure appearance (Theme/Mode/Home screen/Daily goal/Build — the task-behavior fields are gone from it), and `settings-notifications.png` shows the consolidated Pile-up card with "Max open tasks" + "Pile-up thresholds" + "Exempt from pile-up count" together in one card.
  - `Configuration.md`: removed the interim "Screenshot note" staleness callout (its reason for existing is resolved) and embedded `settings-tasks.png` in the Tasks subsection. `Screenshot-Shot-List.md`: status updated — Batch C marked done; the weather loop shot remains the only outstanding capture.

## 2026-07-11

- docs(wiki): reconcile settings-reorg + wiki-rebuild branches with the merged screenshot PR [S]
  - **Why:** PR #639 (screenshots) merged into `dev` while PR #638 (settings reorg) and #640 (wiki rebuild) were still open on an older base — both needed rebasing onto the new `dev` tip, and the user specifically asked to check whether any of the newly-embedded screenshots were now stale given the reorg.
  - **Git:** rebased both branches onto `origin/dev` (0b1c5ca). #638 rebased clean. #640 had one real conflict in `Features.md`'s "Desktop UI" section (both branches touched the same paragraph — kept #639's screenshot embed at the top and #640's "Standard theme:"/"Kept theme — command center" sub-headers below it); `Home.md`/`Kept-Design-Language.md`/`Version-History.md` auto-merged clean.
  - **Screenshot staleness found:** all four Settings screenshots (`settings-general/notifications/integrations/labels.png`) show the pre-reorg 7-tab bar. Two are also content-stale, not just cosmetically stale: `settings-general.png` still shows "Default due date"/"Staleness threshold"/"Reframe trigger"/"Max open tasks", all four of which moved elsewhere in the reorg; `settings-notifications.png` is missing the now-consolidated "Max open tasks" row in the Pile-up card (it was captured right after the *first*, smaller pile-up-picker-location fix, not the larger tab restructure that followed it). Documented as **Batch C** in `Screenshot-Shot-List.md` with a per-file stale-reason table, a priority ranking, and a new `settings-tasks.png` shot for the Tasks tab that didn't exist before. Added an inline "Screenshot note" callout in `Configuration.md` next to the stale General shot so readers aren't misled in the meantime.
  - **`Configuration.md` update:** this file predates both #639 and #640 and wasn't touched by either — its "Settings (in-app)" section still described the old tab layout independent of the screenshots. Reorganized into General / Tasks / Labels / API Keys(Integrations) sub-sections matching the new 6-tab structure, added a Pile-up bullet under Notifications, and noted the Server-logs fold-in under Data.
  - **Verification:** `npm test` (8 unit tests + smoke test) clean on both rebased branches.
- docs(wiki): real UI screenshots captured + embedded across the wiki [M]
  - Executed the screenshot shot list handoff (the prior session's sandbox couldn't drive a browser against `localhost`; this one can). Captured 18 shots of the shipped Kept UI against a seeded dev DB (`SEED_DB=1`, static-fallback data), light mode, at the spec'd viewports (mobile 390×844 @3x, desktop 1440×900 @2x). New `wiki/images/` directory.
  - **Batch A (14):** mobile Today / Tasks / task action sheet / quick edit / Loops / loop detail / Throw / More / What now; desktop Today / Tasks List / Tasks Board / Loops / Throw (⌘K) / Quokka welcome.
  - **Batch B (4, unblocked):** the Settings reorg the shot list said to wait for (the pile-up exemption picker move to the Notifications tab) had already landed on `dev`, so the four Settings shots (General / Notifications / Integrations / Labels) were captured too — `settings-notifications.png` shows the post-reorg "Pile-up thresholds" + "Exempt from pile-up count" cards together, the specific "after" reference the list wanted.
  - **Skipped (1):** `kept-mobile-today-loop-weather.png` — needs the Weather integration configured plus an outdoor-tagged seeded loop; flagged for a follow-up pass once weather is set up in a capture environment.
  - Embedded: `Home.md` (Today hero), `Getting-Started.md` (Throw sheet at the first-task step), `Features.md` (mobile Today/Tasks/Loops trio at the top, desktop Board under Desktop UI, Settings→Notifications under the pile-up exemption paragraph — whose stale "below Max open tasks" pointer was also corrected to "below Pile-up thresholds" per the reorg), `Kept-Design-Language.md` (new "§0 Reference screenshots" gallery of all 14 Batch A shots), `Configuration.md` (General / Integrations / Labels shots at their subsections).
- docs(wiki): audit and rebuild the wiki [L]
  - **User request:** "go audit and rebuild the wiki." Read all 23 pages under `wiki/`, cross-checked against `CLAUDE.md` and the actual codebase (greps against `src/`, `server.js`, `Dockerfile`, `package.json`), and fixed what was stale, duplicated, or missing.
  - **Rewrites:** `Development.md`'s entire Project Structure section described the deleted v1 codebase (`App.jsx`, old `src/components/`, `useSync.js`, `useTrelloSync.js` as a top-level hook) — rewritten to match the current tree (`AppV2.jsx`, `src/kept/`, current hooks, current `npm test`/`npm run build:mobile` scripts). `Features.md`'s Themes/Header Layout/Desktop UI sections described the four-palette Light/Dark/Terminal-Dark/Terminal-Light picker and the pre-Kept "Packages + gear + overflow menu" header — both fully replaced (Standard/Kept families × Light/Dark/System modes; BottomTabs+SystemMenu+SpacesHub for Standard mobile vs. Kept's 4-tab+Throw IA and desktop command center).
  - **Deleted (superseded snapshots, git history preserves them):** `V2-State.md` (a 2026-05-11 point-in-time snapshot describing Terminal as "the active aesthetic" and an 8-tab Settings including a Beta tab, all long gone), `Testing-Plan.md` (an April-2026-sprint manual checklist testing header/menu items that no longer exist), `Wallaby-Ideas.md` (backlog for the Wallaby theme, torn out in the K6 demolition).
  - **Fixed path/reference drift:** `Sequences.md` and `Activity-Prompts.md` still pointed at `src/v2/components/` (flattened to `src/components/` at Kept K0). `Docker.md` described a 2-stage Dockerfile and an outdated `docker-compose.yml` env-var list; actual `Dockerfile` has 3 stages (the middle one exists specifically to dodge QEMU slowness on cross-platform builds) and compose has grown GCal/SMTP/tracking/PUBLIC_APP_URL vars since this was written. `Local-Verification-Harness.md` still referenced the removed Wallaby theme's `.wb-shell`/`.wb-nav-tab` selectors and `wallaby-dark` theme value in its Puppeteer examples — updated to Kept's `.bm-shell`/`.bm-nav-tab`/`kept-dark`. `Architecture.md` still described `src/wallaby/` as a live surface and pointed at two `check:terminal-*` convention smoke-test scripts that were dropped along with the rest of the Terminal teardown (`package.json` has no `check:*` scripts at all today). `Kept-Design-Language.md`'s status banner still said "approved direction, pre-implementation" for a design language that's been the shipped default since 2026-06-10.
  - **Fixed a real divergence in `CLAUDE.md` itself** (not just the wiki): its Notion "Operation Routing" table claimed `Get page`/`Get child pages`/`Query database`/`Get block content` all go through MCP `notion-fetch`, with Query database flagged as a "LIMITATION" needing a possible future REST fallback. Reading `notionMCPProxy.js` directly showed the REST-first-with-MCP-fallback path was already fully wired and is the primary path whenever `NOTION_INTEGRATION_TOKEN` is set — `wiki/Notion-Integration.md`'s table already had this right. Corrected `CLAUDE.md` to match, since it was the stale side of the divergence.
  - **`Home.md`'s page index was missing 13 of the (now 20) wiki pages** — `Escalation-Ladder.md`, `Growth-Areas.md`, `Sequences.md`, `Activity-Prompts.md`, `Activity-Prompts-Testing.md`, `Local-Verification-Harness.md`, `Notion-Integration.md`, `Kept-Design-Language.md`, `Screenshot-Shot-List.md`, `iOS-Native-App.md`, `iOS-Shortcut.md` were all unlinked from the front page. Rebuilt into grouped sections (Getting started / How it works / Feature deep-dives / Mobile & platform / Testing / Operations & reference) instead of one flat list.
  - **Fixed the wiki-sync mechanism itself:** `.github/workflows/wiki-sync.yml` used a plain `cp wiki/*.md .wiki/`, which only ever adds/updates pages — a page deleted from the source `wiki/` directory (like the three above) would silently linger on the published GitHub Wiki forever. Switched to `rsync -a --delete` so deletions actually take effect.
  - Left `Version-History.md` itself untouched per its own append-only/`merge=union` convention.

- fix(ui): pile-up label exemption picker was in the wrong settings tab [XS]
  - **User report:** screenshots showing the actual Notifications settings screen ("Pile-up thresholds", "Quiet hours") with no exemption picker in sight, while it had actually landed in the General tab next to "Max open tasks" — despite being documented as "Settings → Notifications." "Why the fuck would it be there??"
  - Root cause: `SettingsModal.jsx` has two separate pile-up-related fields living in two different tabs — `max_open_tasks` (the limit itself) sits in General, while `stale_warn_pct`/`stale_warn_days` ("Pile-up thresholds") sit in the actual Notifications tab (`NotificationsPanel`). The new exempt-labels picker was added next to `max_open_tasks` in General, matching neither its own documentation nor where a user looking for pile-up config would actually look.
  - Fixed: moved the picker (state, toggle handler, and JSX) out of `SettingsModal`'s General-tab body and into `NotificationsPanel`, as its own `.v2-settings-block` card directly below "Pile-up thresholds" — same screen as every other pile-up-related setting.

- refactor(settings): settings IA rethink + dead-setting cleanup [L]
  - **User request:** "take a deep dive through the settings section and help me make it make sense. Shit is everywhere." Follow-on from the pile-up placement fix above — an audit of the full `SettingsModal.jsx` surface found the same split-with-no-cross-reference pattern repeated in several places, plus settings with zero UI control anywhere (dead in practice) and a hand-copied toggle-switch block at ~10 call sites.
  - **Tab structure changed**, not just content moved: `TABS` went from `General, AI, Labels, Integrations, Notifications, Data, Logs` (7) to `General, Tasks, Labels, Integrations, Notifications, Data` (6). The old `AI` tab had exactly one real setting (custom instructions) — folded into a new `Tasks` tab next to the task-behavior thresholds (`default_due_days`, `staleness_days`, `reframe_threshold`) that used to sit orphaned in General with no link to the notification types or AI tone they actually drive. The old standalone `Logs` tab (`ServerLogsPanel`) folded into `Data`, under Activity — same diagnostics category. General is now purely appearance (theme/mode) + Home screen + Build.
  - **Pile-up fully consolidated:** `max_open_tasks` moved out of General into the same Notifications card as `stale_warn_pct`/`stale_warn_days` and the label-exemption picker — one card for everything "too many open tasks."
  - **`public_app_url` relabeled and relocated** from a Pushover-only-looking field inside the Pushover integration block to its own block in Notifications → Channels — it's actually consumed by web push, Pushover, and the daily digest.
  - **Dead settings found and fixed:** `trello_sync_enabled` had no UI control anywhere so the Trello "Sync now" button could never appear (condition now checks `trello_board_id`, mirroring Notion). `src/hooks/usePackageNotifications.js` — a 95-line client-side hook for package delivered/exception/signature browser notifications — was gated behind `notifications_enabled`, which defaults `false` with no UI control anywhere; confirmed dead in practice and deleted outright (server-side push/email/pushover already cover the same events across 3 channels). Closed a real gap while there: added `push_notif_package_signature`/`email_notif_package_signature`/`pushover_notif_package_signature` toggles so signature-required is gated per-channel like delivered/exception already were.
  - **Toggle switch consolidated:** the `Toggle` component was defined locally inside `NotificationsPanel` and hand-copied at ~10 sites in `IntegrationsPanel`/General. Hoisted to module scope, all call sites now use `<Toggle />`.
  - **Deliberately left alone** (documented in-code, not silently dropped): Weather notifications' missing Pushover column — `pushoverNotifications.js` has no weather-event dispatch at all, so a toggle would be another dead setting, a real feature gap rather than a placement bug. The legacy `useNotifications.js` client engine shares the same dead `notifications_enabled` gate as the deleted hook but is a bigger separate removal decision, out of scope here.
  - **Verification:** `npx eslint`, `node --check` on the three server notification modules, `npm run build`, `npm test` (8 unit tests + smoke test) all clean.

- feat(ui): weather badges on Today's inline Loops section [XS]
  - **User follow-up** (after the Tasks weather fix, and a "what about Loops?" question): screenshot of Today's "Loops" section showing routine cards (e.g. "Tighten Washer door") with no weather info — "Seems like it would be really helpful here, no?"
  - Checked the Loops tab/detail page first: no gap there, since neither shows any due-dated task row at all (just cycle-chip trails and cadence stats) — nowhere to put a badge.
  - But Today's inline "Loops" section (the routine cards shown when a loop is due/done today) had the same missing wiring Tasks just got fixed for — and a loop like "Mow" is exactly the outdoor-vs-weather case this feature exists for. Routines already share the same `tags`/`energy` shape as tasks (propagated to spawned tasks), so `resolveWeatherVisibility()` applies directly; looked up against "today" rather than the routine's own due-key, since that's when the user would act on it regardless of overdue status.
  - `TodayView.jsx`'s `loops` computation now includes a `weatherDay` per routine; rendered only on the plain open-loop card (not the cleared-today receipt or stack folder header, which aren't "should I do this" moments).

- feat(notifications): configurable label exemption from the pile-up count [M]
  - **User request:** "If tasks are labeled for something else they shouldn't count in the pile up. Maybe that is configurable."
  - New `settings.pileup_exempt_labels` (array of label ids, default `[]`) — tasks tagged with any of these labels no longer count toward the "too many open tasks" limit/warning. Configurable in Settings → Notifications via a multi-select label picker just below "Max open tasks", reusing the same `v2-form-label-grid`/`v2-form-label-pill` component AddTaskModal's tag picker already uses.
  - New `isPileupExempt(task, settings)` helper (duplicated per-file, matching the existing convention for `isStale()`/`isAvoidance()` in this codebase rather than centralizing) — applied to the pile-up pool in all four places that compute it: `pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, and the client-side `src/hooks/useNotifications.js` browser-push path. Verified with a standalone script covering 7 cases (matching tag, non-matching tag, missing tags, feature disabled, multi-tag/multi-exempt overlap).
  - Scoped narrowly to pile-up counting, per the request — stale/nudge sampling and the digest are unaffected; an exempt task still surfaces normally everywhere else.
  - Noted (not fixed, out of scope): the client-side browser-push pileup path in `useNotifications.js` still uses its own older `ACTIVE_STATUSES` filter rather than `isNotifiable()`'s due-date-or-nag_allowed gate from the 2026-07-11 "quiet unless opted in" work earlier today — a pre-existing gap this fix didn't introduce or need to touch.

- fix(ui): Tasks was missing weather badges [XS]
  - **User report:** "Tasks is missing the weather."
  - `weatherByDate` was already threaded from `AppV2.jsx` into `KeptShell.jsx`/`KeptDesktop.jsx` and passed to `TodayView.jsx` (which shows weather badges), but was never also passed to `TasksViewKept.jsx` — so Tasks' list rows never got the badge even for dated tasks in the exact same forecast window Today would show it for.
  - Fixed: `TasksViewKept.jsx` now accepts `weatherByDate`, computes the same due-date + `resolveWeatherVisibility()`-gated badge `TodayView.jsx` uses, and renders it in the row meta. `KeptShell.jsx`/`KeptDesktop.jsx` now pass the prop through.
  - Left `BoardView.jsx` (Tasks' desktop Board mode) alone — it's a deliberately minimal card view that doesn't show due dates or tags either, not a parity gap.

- refactor(ai): centralize model ids in aiModels.js, upgrade Sonnet to claude-sonnet-5 [M]
  - **User question, then request:** "What models is boomerang using? Should we be updating them?" → after summarizing findings (Sonnet usage was on an older `claude-sonnet-4-6`; Haiku usage was already current), user said "Let's update and centralize."
  - New root module `aiModels.js` (no Node-specific dependencies, so it's importable from both server modules and the Vite client bundle) exports `SONNET_MODEL` (now `claude-sonnet-5`, was `claude-sonnet-4-6`) and `HAIKU_MODEL` (`claude-haiku-4-5-20251001`, unchanged — already current).
  - Replaced the literal model string at every call site: `server.js` (Quokka adviser — removed the now-redundant `ADVISER_MODEL` local constant; 2 AI-search endpoints), `gmailSync.js`, `growthAreas.js`, `patternDetection.js`, `tagSuggestions.js`, `emailNotifications.js`, `adviserToolsTasks.js` (research_task + generate_escalation_ladder), `notifAi.js`, `scripts/generate-seed-data.js`, and client-side `src/api.js` (3 call sites) + `src/hooks/useNotifications.js`.
  - Added `aiModels.js` to the Dockerfile's Stage 3 runtime `COPY` list (root-level `.js` file imported by `server.js` and others — would silently `ERR_MODULE_NOT_FOUND` on deploy otherwise, per the standing Dockerfile-COPY rule).
  - A future model upgrade is now a one-line edit in `aiModels.js` instead of a grep-and-replace across a dozen files.

- feat(notifications): undated tasks are quiet by default, not just projects [M]
  - **User report (follow-up):** after the Today-rail fix above, user corrected: "This is 100% a mobile problem" — and attached screenshots showing Pushover nags ("Too many open tasks: 22 open (limit: 20)", "Quick win available: Try 'Paint header'") that named/counted undated "Anytime" tasks even though mobile's Today screen already showed them correctly. The actual gap wasn't visibility — it was that `isNotifiable()` let ANY `not_started`/`doing`/`waiting` task nag regardless of due date, so "someday, no deadline" tasks counted toward the pile-up limit and got sampled for stale/quick-win pings exactly as loudly as something due today.
  - Asked the user to choose a direction (`AskUserQuestion`) between quieting undated tasks by default, restricting pileup/nudge to due-today-only, or auto-promoting neglected tasks into Today. User picked **"quiet unless opted in"** — the same pattern Projects have always had via `nag_allowed`.
  - `isNotifiable()` (`db.js`) now requires `due_date || nag_allowed || (escalation_current_rung != null)` for ordinary active-status tasks (previously unconditional true). The escalation carve-out matters: Escalation Ladder tasks are commonly undated by design ("I need a response, no rigid deadline") and are drawn from the same notifiable pool — without this exception, extending the project-style gate to ordinary tasks would have silently broken that entire feature. Verified all branches with a standalone script covering 13 cases (undated/dated × ordinary/project/escalation/gmail-pending/snooze_indefinite/done) before shipping.
  - `EditTaskModal.jsx` gets a "Remind me about this without a due date" toggle for ordinary tasks with no due date (same `nag_allowed` column the Project toggle already used, just no longer gated to `status==='project'`). Quokka's `create_task`/`update_task` `nag_allowed` param now applies to any task, not just projects — previously `create_task` silently forced it to `false` for non-project statuses.
  - Side effect, called out rather than left as a silent surprise: the morning digest's "Carrying" section no longer mentions a purely undated, non-opted-in task (it still carries forward anything with a due date normally) — undated tasks are quiet everywhere now, consistently, not just in real-time push/email/pushover.

- fix(ui): desktop Today rail was missing undated ("Anytime") tasks [S]
  - **User report:** "Getting really frustrated with notifications when the items are in tasks and not in today... if they aren't in today then they should functionally be a backlog task or something should be pushing those tasks forward to today."
  - Root cause: `isNotifiable()` (`db.js`) makes any `not_started`/`doing`/`waiting` task eligible for stale/nudge nags regardless of `due_date` — no due-date gate at all for ordinary tasks (only `project` status has the due-date-aware `nag_allowed` opt-in). Mobile's `TodayView.jsx` already accounts for this: undated active tasks render in a dedicated "Anytime" section on the Today screen ("the main page must show them"). But `TodayRail.jsx` — the side rail shown on desktop while browsing Tasks/Loops — only ever computed `dueToday` (`due_date <= today`) and had no undated-task section at all. So on desktop, an undated task sat visibly in the main Tasks pane while being completely invisible on the rail that represents "Today" — yet it was still fully nag-eligible. Not a backlog task (backlog is a manual, never-automatic status per `AppV2.jsx`/`adviserToolsTasks.js`) and not shown in Today — exactly the disconnect reported.
  - Fixed by giving `TodayRail.jsx` the same "Anytime" section `TodayView.jsx` already has (undated, active, unsnoozed, non-stack, non-child tasks), capped at 8 rows with a "+N more in Tasks" note so nothing silently disappears if the list is long. Now every notifiable task surfaces somewhere on the Today surface, on both mobile and desktop.

- fix(store): Quokka's "Could not retrieve response" error on long tool-use turns [S]
  - **User report:** screenshot + transcript of Quokka's "find contractors for my tasks" request — a broad request that legitimately fanned out into 13+ `search_tasks` calls, 2 `get_task` calls, 2 `web_search` calls, and 2 `update_task` calls — ending in "Could not retrieve response" even though the updates had actually been staged.
  - Root cause: `useAdviser.js`'s SSE-drop poll-fallback (used when the stream disconnects mid-turn — common on mobile cellular, especially once the phone screen locks) only polled `GET /api/adviser/session/:id` for 30 attempts × 1.5s = 45 seconds before giving up. The server-side detached runner (per the Quokka architecture doc above) keeps working regardless of client disconnects — sessions stay alive up to 10 min idle / 30 min while a plan is staged — so 45 seconds was never enough budget for a genuinely long multi-tool-call turn like this one; the client declared failure while the server was still legitimately working.
  - Fixed: extracted the (previously duplicated in two places) poll loop into a shared `pollSessionForResult()`, extended the budget to 5 minutes, and made transient fetch errors mid-poll retry instead of immediately aborting (only a 404 — session genuinely gone — stops early). Module-level `POLL_INTERVAL_MS`/`POLL_BUDGET_MS` constants make the budget easy to retune later.

- fix(ui): swipe-down-to-dismiss on Kept's bottom sheets [S]
  - **User report:** "Throw task modal swipe down doesn't work" — the sheet's grabber bar has always looked draggable (it's the standard bottom-sheet affordance) but no touch handling was ever wired behind it on either `.bm-sheet` (ThrowSheet, and the Tasks action sheet in `TasksViewKept.jsx` shares the identical grabber pattern and the identical gap).
  - New `src/hooks/useSheetSwipeDown.js`: a small reusable pointer-events hook — drag follows the finger via a live `translateY`, release past ~90px or a quick flick calls the dismiss callback, otherwise the sheet snaps back with a short eased transition. Attaches to a dedicated `.bm-sheet-handle` wrapper around the grabber (not the whole sheet), so the input/chips/buttons below stay normal tap targets and don't fight the drag gesture.
  - `ThrowSheet.jsx` composes the swipe offset with its existing keyboard-occlusion `translateY` (both now write through the same ref-tracked offset instead of two effects stomping `sheet.style.transform`) so swiping down still works correctly while the keyboard is up.
  - `TasksViewKept.jsx`'s task action sheet gets the same fix for consistency — it had the exact same grabber-implies-swipe gap.

- fix(ui): wire up the "What now?" row on Kept mobile's More tab [XS]
  - **User report:** "What now is still a dead link" — reported again after the design-audit pass (which added the row to `MoreView.jsx`) had already shipped to `dev`.
  - Root cause: that earlier fix added the `onWhatNow` prop declaration and the row to `MoreView.jsx`, but never updated `KeptShell.jsx`'s `<MoreView>` render call to actually pass `onWhatNow` down — it was only wired to `<TodayView>`. So the prop was `undefined` on the More tab specifically, and tapping the row did nothing. `KeptDesktop.jsx` and `AppV2.jsx`'s own wiring were both already correct (confirmed by re-tracing the whole chain), which is why the bug looked like a phantom the first time.
  - Fixed: `KeptShell.jsx` now passes `onWhatNow={onWhatNow}` to `<MoreView>`.

- fix(notion): create-page ID parsing failed on the hosted MCP server's actual response shape [S]
  - **User report:** creating a Knowledge Base entry via Quokka staged correctly but errored with "Could not parse page ID from response: {"pages":[{"id":"...","url":"https://app.notion.com/p/...",...}]}" after the Notion page was actually created.
  - Root cause, two compounding bugs in `notionMCPProxy.js`'s `createPage()`/`createPageInDatabase()` (both call `notion-create-pages`): (1) they checked for a top-level `json.id`, but the hosted MCP server wraps the result as `{"pages":[{id, url, properties}]}` — the id is one level deeper, so the check always missed and fell through to a URL-regex fallback; (2) that fallback (`extractIdFromUrl`) only matched `www.notion.so/<id>` URLs, not the `app.notion.com/p/<id>` format the hosted server actually returns, so it failed too — together turning every successful create into a thrown error.
  - Fixed: new shared `parseCreatedPage()` helper checks `json.pages[0].id` first (the real shape), falls back to a flat `json.id` for safety, then falls back to the URL regex — which now also matches `app.notion.com/p/<id>`. Verified against the exact response shape from the bug report.
  - `createDatabase()` (a different MCP tool, `notion-create-database`, with no evidence of the same bug) was left untouched — no unverified changes to an unrelated code path.

- fix(ui): Fable-driven design audit — keyboard/scroll bug, Escape gaps, undefined tokens, checkbox/touch-target fixes [L]
  - **User request:** "Use fable to look at all of the design elements of the web page and find bugs... new tasks have a tendency to show up under the keyboard... Also look at edit menus. They look like shit." Four Fable agents audited (1) mobile keyboard/viewport interactions, (2) design-token/color consistency, (3) modal/motion consistency + desktop/mobile parity, (4) edit-modal visual quality. Playwright can't reach even `localhost` in this sandbox (same limitation hit earlier this session), so every finding below is code-verified, not visually confirmed — flagging that explicitly since some of this is CSS-only and worth a real look before promoting to `main`.
  - **The reported bug, root-caused and fixed:** `src/kept/ThrowSheet.jsx` had no keyboard-occlusion handling (unlike `BottomTabs.jsx`/`FloatingCapture.jsx`, which already carry a `visualViewport` listener) and closed without blurring its focused input, so the keyboard's dismiss animation unwound mid-re-render. Separately, nothing in the app ever scrolled a newly-created task into view — combined with `addTask` prepending to state and undated tasks landing in the list's last ("Anytime") section, a new task's actual visibility flipped depending on which date chip was picked, matching the "while inconsistent" description exactly. Fixed: ThrowSheet now has the same `visualViewport` handling as its siblings + blurs before close; `data-task-id` attributes were added to task rows in `TodayView.jsx`/`TasksViewKept.jsx`; `AppV2.jsx` now scrolls a freshly-thrown task's row into view (keyboard-settle delay) via a new `scrollTaskIntoView` helper.
  - **Two more real bugs in the same flow, fixed:** ThrowSheet's "More options" handoff to the full Add modal silently dropped the typed title/date (contradicted its own code comment) — now threaded through `onMoreOptions`/`onOpenFullAdd`. `AddTaskModal` is permanently mounted with no reset, so stale title/notes/tags/size persisted across opens — `AppV2.jsx` now bumps a `key` (`addModalKey`) on every fresh open, forcing a clean remount, and accepts an `initialDraft` prop to seed from the Throw handoff.
  - **Other confirmed bugs fixed:** `ConfirmDialog`'s `autoFocus` sat on the destructive confirm button, contradicting its own "Enter shouldn't auto-confirm" comment — moved to Cancel. `ThrowSheet` and the Kept task-action sheet (`TasksViewKept.jsx`) had no Escape-to-close, unlike every other modal — added. `WeatherSection.css` used legacy `--text`/`--text-dim` tokens that only branch on literal `[data-theme="light"]`, never `"kept-light"` — rendered near-white/dark-gray text in Kept's light theme; swapped for the correctly-branching `--v2-text`/`--v2-text-faint`. `LoginScreen.css` was built entirely against five tokens that don't exist anywhere in the codebase (`--bm-surface`/`--bm-ink`/`--bm-ink-soft`/`--bm-line`) plus a hardcoded Fraunces font-family — always silently fell back to hand-guessed hex; renamed to the real tokens (`--bm-card`/`--bm-text`/`--bm-text-meta`/`--bm-hairline`) and the font to `var(--v2-font-display)`. Two more undefined-token spots (`--v2-border`, `--v2-surface-elev` — used in `EditTaskModal.css` and `SettingsModal.css`, defined nowhere, silently falling back to `currentColor`) pointed at real tokens. An invalid `font: 600 12px/1 inherit` shorthand in `QuickEditTask.css` (CSS-wide keywords can't be a shorthand sub-value, so the whole declaration was dropped) split into individual properties. The checklist-item delete button in `EditTaskModal.css` was `opacity: 0` until `:hover` — invisible and undiscoverable on touch devices, which never fire hover — now visible by default, hover-reveal gated behind `@media (hover: hover) and (pointer: fine)`. `MoreView.jsx` (Kept mobile's "More" tab) never rendered a "What now?" row despite already receiving an `onWhatNow` prop from `KeptShell.jsx` — added, restoring reachability from all four mobile tabs instead of just Today.
  - **Small consistency fixes bundled in:** missing `accent-color` on native checkboxes in `EditTaskModal.css`/`GrowthAreasModal.css` (rendered as default browser-blue against the app's ember/gold theme); a stale hardcoded `rgba(255, 98, 64, ...)` (the old, pre-Kept accent hue) in `GrowthAreasModal.css` swapped for a theme-tracking `color-mix()`; a referenced-but-never-defined `--v2-radius-lg` token minted as an alias for the existing `--v2-radius-card`.
  - **Explicitly NOT attempted this pass** (documented as a roadmap, not silently dropped): a large color-token sweep (~90+ places across the shared `src/components/*.css` layer using hardcoded hex/rgba instead of tokens — stale pre-Kept accent hue, four different "success green"/"warning amber" values, an unminted Quokka-purple, icon stroke-width drift between `src/components/` (mostly 1.75) and `src/kept/` (mostly 2)); a shadow/radius harmonization pass; the systemic Escape-key-closes-two-stacked-modals-at-once issue (would need a real focus-stack coordinator across `ModalShell`/`ConfirmDialog`/sheets, not a local patch); and the deeper edit-modal rebuild — `QuickEditTask.jsx` (the mobile quick editor) is confirmed still running the torn-out "Wallaby" theme's `wb-*` class vocabulary (purple accents, square checkboxes, card-on-card backgrounds) bridged only by token compatibility shims, and `EditTaskModal`/`RoutinesModal` show real card-in-card nesting and 3-4 different treatments for equivalent controls (remove buttons, action pills, selected-chip colors) where later features were bolted onto `forms.css`'s layered Wallaby→Kept override passes rather than a single design pass. All of this needs a dedicated pass with actual visual verification, not a blind mechanical sweep.

- fix(tasks): make the Growth Areas Today-view dismiss reversible [XS]
  - **User request:** "if I dismiss I need the ability to restore it."
  - `src/kept/TodayView.jsx`: dismissing the growth-area banner now leaves a tiny "Show today's nudge" restore link in its place (icon + short label, not a full sentence) instead of the banner just vanishing for the rest of the period. Tapping it clears the dismiss key and brings the banner back.

- feat(tasks): Growth Areas — evening timing + day-scope filtering [M]
  - **User request:** prod feedback — "on a Saturday I probably can deprioritize work things and prioritize family things... leave work at work" plus a request for an evening/workday-evening surfacing option.
  - Replaced the single `mode` enum (`morning`/`persistent`/`both`) with three independent booleans (`morning`, `evening`, `persistent`) plus a `day_scope` (`any`/`weekdays`/`weekends`) eligibility filter, applied everywhere an area is considered — the daily rotation pool AND contextual injection (What Now/Quokka). Legacy `mode`-shaped records normalize on read, no migration needed (JSON blob collection, not a SQL table).
  - Solves the concrete example deterministically rather than via AI-inferred domain weighting: "leave work at work" = `evening` + `day_scope: weekdays` simply never enters the pool on a Saturday.
  - `growth_area_today` cache now holds independent morning + evening picks (`{date, morning, evening}`); each period gets its own once-daily rotation + AI rephrase (period-flavored prompt — morning = start-the-day cue, evening = wind-down cue). Digest reads the morning pick; the Kept Today-view banner picks whichever period it currently is client-side (evening from 5pm local on), with a per-`date:period` dismiss key so dismissing one doesn't suppress the other.
  - UI: `GrowthAreasModal`'s mode dropdown replaced with Morning/Evening/Persistent checkboxes + a day-scope select, in both the add form and the row editor.
  - Quokka: `create_growth_area`/`update_growth_area` schemas updated to the new fields (still default to morning+persistent when none of the three timing flags are given, matching the old "both" default).

- feat(tasks): add Escalation Ladder — contact-persistence tracking [XL]
  - **User request:** second half of the "Fix the specs then build" instruction, following the Growth Areas build. Builds `wiki/Escalation-Ladder.md` end-to-end.
  - For "I need a response and I'm not getting one" tasks: tracks repeated attempts to reach an unresponsive person/organization and PROMPTS to switch tactic once a rung's attempts are exhausted, rather than just re-nagging the same dead approach. Distinct from Sequences (`follow_ups`, completion-triggered) — this fires on attempt-threshold.
  - New `tasks` columns (migration 039): `escalation_rungs`, `escalation_current_rung`, `escalation_attempt_log`, `escalation_awaiting_advance`, `escalation_stuck`. Business logic in `db.js`: `setEscalationLadder`, `logEscalationAttempt`, `advanceEscalationRung`, `dismissEscalationAdvancePrompt`, `resolveEscalation`, `escalationNudgeOverride`.
  - Scoring: each logged attempt is worth 1 point (`computeEscalationStatsToday` in `src/scoring.js`, same "waiting = progress" principle as project sessions), rolled into daily points/tasks and credited toward the streak.
  - Notifications: active-ladder tasks get their own tactic-aware per-task nudge (current rung's suggestion/script, or the prompted-advance copy) at the rung's own cadence, across push/email/Pushover — new `*_notif_escalation` toggles (default ON), excluded from the generic aggregate stale/nudge pools so they're never double-nagged.
  - UI: `EditTaskModal` gains an "Escalation" section (toggle, rung editor, status line, Log attempt/Move on/Got a response actions, prompted-advance and stuck banners with a "Brainstorm next moves" hand-off to Quokka). Kept's `TodayView` rows show a small "☎ N/M" indicator (amber-pulsing when awaiting-advance or stuck).
  - Quokka: 5 new tools in `adviserToolsTasks.js` — `generate_escalation_ladder` (its own Claude call to draft rungs, same pattern as `research_task`), `set_escalation_ladder`, `log_escalation_attempt`, `advance_escalation_rung`, `resolve_escalation`.
  - Verified end-to-end against a fresh SQLite DB: set rungs → log attempts to threshold → awaiting-advance → advance → last-rung attempt (no auto-stuck without a threshold, matches spec) → resolve, all via curl.

- feat(tasks): add Growth Areas — standing personal-coaching reminders [L]
  - **User request:** two docs-only feature specs (`wiki/Growth-Areas.md`, `wiki/Escalation-Ladder.md`) were sent through an adversarial Fable-model design pass, revised per its critique, then built end-to-end. This commit covers Growth Areas.
  - Deliberately tiny: standing reminders about *yourself* ("be more patient on calls") — not tasks, no tracking, no streak, no check-in. The rebuilt part vs. the original draft is delivery: rotation instead of a static list, fresh AI-rephrased wording instead of static banner text, and contextual injection instead of a permanent chip (habituation was the design flaw the Fable pass caught).
  - New `growthAreas.js` root module (Dockerfile runtime COPY list) — its own dedicated `app_data` collections (`growth_areas`, `growth_area_today`), deliberately kept out of the bulk `/api/data` sync blob (same durability reasoning as tasks/routines/packages). Server endpoints: `GET/POST /api/growth-areas`, `PATCH/DELETE /api/growth-areas/:id`, `GET /api/growth-areas/today`.
  - Morning rotation: one area a day (day-of-year mod pool size), AI-rephrased fresh each day, cached server-side so the digest and Today-view banner agree. Bugfix during testing: an empty cached pick (no eligible areas yet) is no longer sticky — adding your first area now shows up the same day instead of waiting until tomorrow.
  - Contextual injection: active `persistent`/`both` areas feed into `getWhatNow()` (new 6th param) and Quokka's system prompt — both may mention an area in one line when genuinely relevant, never forced.
  - Digest gains a "☀️ Today: {text}" line (`digestBuilder.js`, synchronous cache read); Kept's `TodayView` gets a small dismissible banner above the Day Arc hero (dismiss = "seen", reappears next local morning).
  - Management UI: `GrowthAreasModal` (simplest CRUD in the app, on par with Labels) — entry points in the legacy System menu, Kept mobile More view, and Kept desktop sidebar.
  - Quokka: 4 new tools (`list_growth_areas`, `create_growth_area`, `update_growth_area`, `delete_growth_area`) in `adviserToolsMisc.js`, staged with capture/restore compensation.

- feat(routines): add `assignee` for loops/tasks the user supervises but doesn't own [M]
  - **User request:** track recurring chores that are for the user's son (something they supervise, not their own task) with simple flat-point scoring rather than the normal ADHD-effort size×energy grading.
  - New `assignee` TEXT column on both `routines` and `tasks` (migration 038). Free text (e.g. "Jack"), null = the user's own task/loop — no multi-user accounts, purely informational/organizational since only the user operates this app.
  - Propagated from routine → spawned task at every spawn path (`spawnDueTasks`, `spawnNow`, `logHabit`, stack members) — same pattern as `energy_type`/`energy_level` inheritance.
  - Scoring: `calculateTaskPoints()` in `src/scoring.js` now returns a flat `1` for any task with `assignee` set, instead of the `size × energy × speed` formula — per user decision, still counts toward the user's own daily points/streak total (they're supervising it), it just scores like a simple did-it-or-didn't chore rather than graded effort.
  - UI: `RoutinesModal`'s "Labels & notes" section gains a "For" text field (blank = mine). Kept's `LoopsView`/`LoopDetail` show a small chip/meta suffix when set; `TodayView`'s task rows show "for {name}" in the meta line.
  - Quokka: `create_routine`/`update_routine` and `create_task`/`update_task` all accept `assignee` now (routines for recurring chores, tasks for one-off ad-hoc ones); `summarizeTask`/`summarizeRoutine` expose it so the model can read current state.
  - Verified: a standalone script against a fresh SQLite DB (all 38 migrations) confirms the `assignee` column round-trips correctly on both `routines` and `tasks` (set and unset cases), and a scoring script confirms `calculateTaskPoints` returns flat `1` for an assigned task regardless of size/energy while leaving the user's own tasks' scoring unchanged. `eslint` clean, production build clean, `npm test` passes.

- feat(weather): surface the "Best days" recommendation + hide badges on weather-independent tasks [S]
  - **Prod feedback:** the 7-day forecast widget in `EditTaskModal` just listed the week passively — no actual "do it on X day" suggestion, even though the data made it obvious (e.g. tomorrow was the clearest day of the week). Separately, the on-card weather badge in Kept's Today view was showing on every dated task regardless of whether it was actually weather-relevant — indoor/weather-independent routines like "IFR Studying" and "Weekly Cleaning" (tagged `inside`) displayed the same rain badge as genuinely outdoor tasks.
  - Root cause 1: `pickBestDays()`/`formatBestDaysLine()` in `src/components/WeatherSection.jsx` were fully implemented and exported (and documented in CLAUDE.md as a shipped "Best days" feature) but **never actually called from anywhere in the app** — dead code since the day they were written. The forecast widget only ever highlighted the task's own due date, never the best-scoring day.
  - Root cause 2: the on-card `WeatherBadge` (both the legacy `TaskCard.jsx` and Kept's `TodayView.jsx`, wired up in the 2026-07-04 weather-badge fix earlier today) only checks `task.due_date` — it was never gated by `resolveWeatherVisibility()`, the same tag/energy-based outdoor-relevance check that already drives the forecast widget and the (also-unused) "Best days" line.
  - Fix: `WeatherSection` now calls `pickBestDays()` on its own forecast data, renders a "☀️ Best days: Tmrw 85°" callout line above the grid, and highlights the picked day(s) with a distinct green outline (separate from the existing amber "due date" highlight — a day can be both). Kept's `TodayView.jsx` now gates its on-card weather badge through `resolveWeatherVisibility({task, labels, weatherEnabled: true}) === 'visible'`, so only outdoor-tagged or auto-detected-outdoor tasks show it — indoor-tagged tasks show nothing, matching the rule the forecast widget already enforced.
  - Known scope limit: the legacy `TaskCard.jsx` (desktop Kanban, Projects view, Stacks) still shows its weather badge ungated — fixing it requires threading a `labels` prop through 4 more parent components that don't currently receive it (`KanbanBoard.jsx`, `ProjectsView.jsx`, `StackSection.jsx`, `ProjectPinnedSection.jsx`), which wasn't part of the reported bug (all screenshots were the Kept mobile Today view). Tracked as a follow-up if it's noticed there too.
  - Verified: `eslint` clean (pre-existing warnings only), production build clean, `npm test` (date units + cycles units + smoke test) passes.

- feat(theme): add a System option that follows the OS color scheme live [S]
  - **User request:** the theme picker only offered Light/Dark — no way to have the app follow the device's own light/dark setting the way most apps do.
  - `src/theme.js` gains `'system'`/`'kept-system'` sentinel values (one per theme family) stored directly in `settings.theme`. `resolveTheme()` maps a sentinel to its concrete equivalent via `prefers-color-scheme`, and the new `watchSystemTheme(getTheme)` subscribes to OS scheme changes and re-applies the theme live while the app is open — wired into `AppV2.jsx`'s mount effect — so an automatic sunset dark mode flips the app without needing a reload. Settings → General's Mode control is now a three-way Light/Dark/System segmented picker.
  - `index.html`'s pre-paint script mirrors the same sentinel-resolution table (it can't import modules) so there's no flash of the wrong theme before React mounts.
  - Also fixed the underlying default: new installs previously resolved `prefers-color-scheme` ONCE at first load and saved a frozen concrete value (`kept-dark`/`kept-light`) — if the OS scheme later changed, the app stayed stuck. New installs now default to the literal `'kept-system'` sentinel, so they keep tracking the OS scheme going forward. Existing users' explicit theme choices are untouched.
  - Verified: a standalone script exercising `resolveTheme`/`isSystemTheme`/`applyTheme` against a mocked `matchMedia` confirms correct resolution in both OS-dark and OS-light states, concrete-theme passthrough, and the unknown-theme fallback. `eslint` clean, production build clean, `npm test` passes.

- fix(kept): wire weather badges into Today view + fix desktop Loop suggestions button [S]
  - **Bug 1 — weather missing from cards.** Outdoor-tagged tasks (e.g. tagged `outside`) showed no weather indicator at all in the Kept Today view, even with a due date inside the forecast window. Root cause: this was a gap, not a regression — when Kept's `TodayView.jsx` was built from scratch (replacing the legacy `TaskCard.jsx`-based list), it never got the weather wiring the old card had. `AppV2.jsx`'s `useWeather()` result was threaded into every legacy v2 list surface but never passed as a prop into `<KeptShell>`/`<KeptDesktop>`, so `TodayView` had no weather data to render regardless.
  - Fix: `weatherByDate={weather.enabled ? weather.byDate : null}` now passed from `AppV2.jsx` into both `KeptShell` and `KeptDesktop`, threaded through to `TodayView`, which computes `weatherDay` from the task's `due_date` (identical lookup to `TaskCard.jsx`) and renders the existing `WeatherBadge` component in the row's meta line for `dayTasks`. Reuses `WeatherBadge`'s existing CSS (`.v2-weather-badge` etc., already shipped in the bundle since `TaskCard.jsx` is imported unconditionally) — no new styles needed.
  - **Bug 2 — suggestions "swallowed."** On Kept **desktop** only, tapping the "Suggestions" button inside the Loops view silently did nothing. Root cause: `KeptDesktop.jsx`'s `<LoopsView>` instantiation never passed `onOpenSuggestions` (introduced in commit `11573ba`, "loop reconcile review surface") — the mobile `KeptShell` passed it correctly, masking the desktop gap. The badge dot (pending count) still rendered since that's a separate fetch, making the button look live while being dead.
  - Fix: added `onOpenSuggestions={onOpenSuggestions}` to `KeptDesktop.jsx`'s `LoopsView` call.
  - Verified: `eslint` clean (pre-existing warnings only), production build clean. Weather fix verified by seeding a fake `weather_cache` + a due-today `outside`-tagged task into a fresh SQLite DB and confirming `GET /api/weather`/`GET /api/data` return the expected shapes the fix consumes; a live-browser screenshot pass was attempted but blocked by a sandbox networking limitation (Chromium couldn't complete any navigation, including to external sites) unrelated to the app.
  - Not fixed here (out of scope, flagged for later): the notification bell's `unread` count is also never wired into `KeptHeader` in either shell — the badge dot never lights up even though `NotificationsModal` computes a real count once opened. Separate, small fix, deferred since the user is prioritizing the iOS-native-app push reliability work over notification UI polish right now.

- fix(settings): make Integrations panel rows collapsible again [S]
  - **Prod bug:** every integration row (Anthropic, Notion, Trello, GCal, Gmail, 17track, Weather, Pushover) in Settings → Integrations rendered its full inline config unconditionally — API key fields, Disconnect, Sync Parent, Knowledge Base, all stacked open at once — forcing a very long scroll with no way to fold a row shut, unlike the Notifications tab which still collapses correctly per-section.
  - Root cause: the Notifications panel has a `collapsed_notif_sections` settings-persisted collapse mechanism (`isCollapsed`/`toggleCollapsed` + a `SectionHeader` button with a rotating chevron); `IntegrationsPanel` never had the equivalent — not a regression from a specific commit, this panel's tracked history never included it.
  - Fix: added the identical mechanism scoped to integrations (`settings.collapsed_integrations_sections`), reusing the existing `.v2-settings-section-header`/`.v2-settings-section-chev` CSS. Each integration's name became a toggle button with a chevron; all of that row's inline content (API key/connect/config blocks) is now gated behind `!isCollapsed(int.key)`. The row-level "Sync now"/"Configure in tab" actions stay always-visible (summary-level, not configuration detail).
  - Verified: `eslint` clean, production build clean, `npm test` (date units + smoke test) passes.

- fix(kept): brand-new loops no longer show a false "missed last week" gap [S]
  - **Prod bug:** creating a weekly routine via Quokka (e.g. "Take out trash" every Thursday, "Take out recycling" every Friday) on a day when the scheduled weekday had already passed that calendar week immediately showed a "1 to fix" badge — "caught 0 of last 1 week" — even though the routine didn't exist yet during that window.
  - Root cause: `cycleWindows()` in `src/kept/cycles.js` correctly forward-shifts a weekly routine's anchor to the next occurrence of its `schedule_day_of_week` (mirroring `getNextDueDate`'s fixed grid, per the 2026-06-20 bugfix) — but when that shift pushes the anchor into the future relative to today, `sinceDays` goes negative and the old `Math.max(0, Math.floor(sinceDays / stepDays))` clamp forced the window index back to `0`, minting a window at that future anchor anyway. The window was neither `current` (today hadn't reached it) nor `caught` (no history yet), and `loopGaps()` had no check for "hasn't started yet" — so it fell straight into `missed`. Two independent scheduling functions (`getNextDueDate`, which correctly says "nothing owed yet," and `cycleWindows`, which minted a phantom past window) disagreed.
  - Fix: when `sinceDays`/`monthsSince` is negative (the first cycle hasn't started), `cycleWindows()` now generates zero windows for that routine instead of clamping to index 0. Established routines are unaffected — the clamp only mattered for the negative case, which only arises for a schedule freshly created this way.
  - Added `scripts/cycles.test.mjs` (wired into `npm test`) — regression coverage for the exact scenario, confirms an established routine's genuinely missed past cycles still surface correctly, and confirms a routine created ON its scheduled weekday gets a single `current` (not missed) window. Also fixed `src/kept/cycles.js`'s `../dates` import to the explicit `../dates.js` extension so the module resolves under plain Node's test runner (Vite already tolerated the extensionless form; the new unit test needed the explicit one).
  - Verified: new tests fail against the pre-fix logic (confirmed by temporarily reverting just the clamp) and pass with the fix; `eslint` clean; full `npm test` (date units + cycles units + smoke test) passes; production build clean.

- fix(routines): pre-stamp create_routine id so chained add_follow_up doesn't hallucinate a routine_id [S]
  - **Prod bug:** a Quokka plan that created a routine and chained a follow-up onto it in the same turn ("create a weekly recycling routine, then chain a compost follow-up to it") failed at commit with `Routine not found: <uuid>`. Root cause: `create_task` has a `preStage` hook that pre-stamps a real id at *stage* time so a later staged step can reference it (documented in the system prompt); `create_routine` never got the same treatment — its id was only generated inside `execute`, i.e. at *commit* time. The staged response the model saw for the create_routine step had no real, usable id, so when asked to chain `add_follow_up.routine_id` to "the routine I'm about to create," the model fabricated a UUID, which predictably didn't exist yet at commit.
  - Fix: `create_routine` now has a `preStage` (mirrors `create_task`'s) that pre-stamps `rt-<ts>-<hex>` and returns it as `id` in the staged response; `execute` uses `args.id`. `add_follow_up` and `spawn_routine_now` gained a `stagedValidate` (mirrors `create_task`'s parent_id check) that accepts a `routine_id` matching either a real routine or an earlier staged `create_routine` in the same plan, surfacing a clear correction to the model at stage time instead of letting the whole plan roll back at commit. `routineLabel()` now resolves forward references to staged (not-yet-committed) routines for a natural-reading preview (`"Take out recycling (pending)"`) instead of `"(missing routine ...)"`. System prompt's "Chained-create id handling" bullet extended to state the identical rule for `create_routine` → `add_follow_up`/`spawn_routine_now`/`update_routine`.
  - Verified: a standalone script driving `create_routine` → `add_follow_up` → `commitPlan` through the real `db.js` (fresh SQLite, all 37 migrations) confirms the staged `create_routine` response now includes a real `id`, the follow-up stages cleanly with a `"(pending)"` preview, and the plan commits successfully end-to-end (previously reproduced the exact `Routine not found` failure without the fix). `node --check` on both touched files.

## 2026-06-21

- fix(sync): flush pending local changes before hydrating — stop completed tasks resurfacing [M]
  - **Prod bug:** checking a task off and having it pop back onto the list. Root cause: a completion is written to local state immediately but its push to the server is debounced (`DEBOUNCE_MS = 300`). If a refetch fired inside that 300ms window, `fetchAndHydrate` **cancelled** the pending push and then overwrote local state with the server's copy — which never received the completion — so the task reverted. Triggers: `visibilitychange` (the app regaining focus — the single-device path, brutal on mobile), an `sse-update` from another device (the desktop↔phone "smashing on top of each other"), and `pull-refresh`.
  - Fix: `fetchAndHydrate` now **flushes** pending mutations before fetching instead of cancelling them — `pushChanges` is made awaitable and the refetch awaits it, so the user's change lands on the server first and the subsequent fetch returns the merged result. Per-record (tasks/routines), so push-then-fetch is order-safe.
  - Also closed a narrower single-device sliver: a genuine edit made within the 2s post-hydrate echo-suppression window used to be **dropped** (early `return`); it's now rescheduled for just after the window instead of lost. The per-record diff baseline already makes the hydrate echo a no-op, so nothing re-pushes spuriously.
  - Verified: `eslint`, `npm run build`, and the smoke test pass. The true repro is a two-device / refocus race — recommend confirming on `boomerang-dev` with desktop + phone before promoting.

- feat(mobile): Capacitor scaffold + native connection plumbing (iOS app Phase 1) [M]
  - First step toward a native iOS app (Capacitor wrap of the existing web app, to add a Share Extension + App Intents for creating tasks from Messages/Siri). **Model: bundled assets** (ships `dist/` in the binary, talks to the API remotely) so the PWA's offline mutation queue + cached shell are preserved; **connectivity via Tailscale** (server stays private, app reaches the tailnet host, `API_TOKEN` gates it).
  - `@capacitor/core` + `@capacitor/ios` (deps) + `@capacitor/cli` (dev) added; `capacitor.config.ts` (bundled model — `webDir: 'dist'`, no `server.url`); `npm run build:mobile` = `vite build && cap sync ios`.
  - `src/apiConfig.js` — runtime connection config (`boom_api_base` / `boom_api_token` in localStorage; no secrets in the bundle) + a `window.fetch`/`EventSource` shim that prefixes relative `/api` URLs with the configured server base and attaches the token. **Inert on the web** (nothing configured → installs nothing), installed once from `src/main.jsx`. Cross-origin can't ride the session cookie, hence Bearer token; the SSE stream uses `?api_token=` since EventSource can't set headers.
  - `auth.js` `bearerFromReq` now also accepts `?api_token=` (query) in addition to `Authorization: Bearer` / `x-api-token`, so the native app's EventSource sync authenticates. Header remains preferred.
  - No Dockerfile / server-build impact: `apiConfig.js` rides the Vite bundle, `capacitor.config.ts` + `ios/` are Mac/dev-only, runtime COPY list unchanged. Verified: `npm install`, `eslint`, `npm run build` clean; live boot test confirms `/api/data` + `/api/events` authenticate via header token, query token, and reject a bad token (401), web path (no auth) unchanged.
  - Guide: `wiki/iOS-Native-App.md` (Mac steps `cap add ios` / `pod install` / Xcode signing, runtime connection config, phased roadmap: 1.5 in-app Connection screen → 2 Share Extension → 3 App Intents → 4 native push). `.gitignore` covers Capacitor's generated `ios/` artifacts.

## 2026-06-20

- fix(routines): align weekly loop cycle-windows to schedule_day_of_week (false-missed + wrong-day "Mark done") [S]
  - Prod bug (screenshots): a "weekly · Fri" loop flagged "week of Jun 13 — MISSED" despite being done, and clicking **Mark done** stamped Jun 13 (a **Saturday**) — an off-schedule green dot. Root cause: `cycleWindows()` in `src/kept/cycles.js` anchored the 7-day grid on the routine's **creation date**, ignoring `schedule_day_of_week`. The loop was created on a Saturday, so windows ran Sat→Fri; completing this week's task today (Sat Jun 20) landed in the *next* window, leaving Jun 13–19 empty → false missed. The missed gap's representative day is the window **start** (Saturday), so `markRoutineDayDone` stamped the wrong weekday.
  - Fix: when a weekly routine has an explicit `schedule_day_of_week`, move the window anchor FORWARD to the first scheduled weekday on/after creation (mirrors `getNextDueDate`'s fixed grid; forward — not backward — avoids minting a leading window that predates the routine, which would be a fresh false-missed). Every window boundary then lands on the scheduled weekday, a same-week completion closes the current cycle, and "Mark done" stamps the correct day. Daily/custom/month-scale cadences unchanged.
  - Verified with a frozen-clock (TZ-pinned) repro of the exact scenario: without the anchor the "week of Jun 13" miss reproduces; with it, windows align to Friday (Jun 5/12/19), today's Jun 20 completion closes the current week, and `loopGaps` returns no missed/unrecorded. `npm test` (5), eslint, and `npm run build` pass.
  - Note: a stray completed_history stamp on Jun 13 from the earlier mis-fire persists in the user's data (cosmetic Saturday dot + lifetime +1); it no longer causes a false gap and can be removed via the routine's "Last done" edit / Quokka.

## 2026-06-19

- feat(server): opt-in authentication gate + iOS Shortcut intake endpoint [L]
  - New `auth.js` root module (added to the Dockerfile runtime COPY list) with an `authGate` middleware mounted over every `/api` route. **INERT unless `AUTH_PASSWORD` or `AUTH_PASSWORD_HASH` is set** — existing self-hosted instances are unchanged until configured, so this ships safely. Built for the "I want to host this on a public web host" move, which breaks the old "attacker who can read the DB already has shell" threat model.
  - **Two credential types share the gate.** Humans: `POST /api/auth/login {password}` → httpOnly + SameSite=Lax + Secure session cookie `boom_session` (30-day rolling, persisted in `app_data.auth_sessions` so restarts/redeploys don't log you out). Because cookies ride every same-origin fetch + the SSE EventSource automatically, the client needed ZERO per-fetch changes — just one boot gate in `src/App.jsx` that probes `GET /api/auth/status` and renders the new `src/components/LoginScreen.{jsx,css}` when `authEnabled && !authenticated` (fails OPEN on a flaky probe; the server is the real enforcement). Machines (iOS Shortcut / future native app): static `API_TOKEN` as `Authorization: Bearer <token>` or `x-api-token: <token>`.
  - Passwords verified with `scrypt` + `crypto.timingSafeEqual` (hash format `scrypt$<saltHex>$<hashHex>`); API token timing-safe compared. `scripts/auth-setup.js [password]` prints `AUTH_PASSWORD_HASH` + a fresh `API_TOKEN`. Cookie `Secure` auto-detects via `req.secure` (`trust proxy` already on) or force with `COOKIE_SECURE=1`/`0`. Open-without-auth even when gated: `/api/health`, `/api/auth/status`, `/api/auth/login`, `/api/auth/logout`.
  - **New `POST /api/intake`** `{ title|text, notes?, due_date?, high_priority?, tags? }` — the iOS Shortcut's target. Authed by the gate (API token or cookie), builds a full task with server-side defaults + `size_inferred=false` so the background auto-sizer refines size/energy. Recipe doc `wiki/iOS-Shortcut.md` covers share-sheet / Siri / Action button wiring.
  - Verified by live boot tests: gate inert with no env (200 on `/api/data`); with creds set, `/api/data` 401 without auth, `/api/intake` 401 on wrong token + creates a task on valid Bearer token, login rejects wrong password (401) and sets an httpOnly cookie on the right one, cookie then authorizes `/api/data` (200). `npm run build`, `eslint`, and `npm test` (smoke + date units) all pass.
  - Docs: README (Features bullet + Configuration → Authentication), `wiki/Security-Notes.md` (new Authentication section + serverless caveat), `wiki/Architecture.md` (Authentication section + new routes), `wiki/Features.md` (Authentication + iOS Shortcut sections), CLAUDE.md (Authentication section), `.env.example` (auth vars). **Note:** the app is NOT serverless-friendly (persistent notification loops + SSE + in-memory Quokka runner + local SQLite + session store assume one always-on instance) — documented so a Lambda/Cloud-Functions host isn't attempted.
  - Pre-existing `npm audit` high (`nodemailer` <=9.0.0, used by the email engine — untouched here; fix is a breaking major bump) flagged, not bundled into this PR.

## 2026-06-18

- feat(api): one-command live health check across every integration ("check my integrations") [M]
  - New `probeIntegrations(req)` in `server.js` LIVE-probes all 12 integrations in one parallel pass and returns `{ generated_at, summary, integrations[] }`, each item `{ id, name, category, path, configured, status, detail }` where status is `connected | degraded | error | not_configured`. Probes are real round-trips but cost nothing and send nothing: Anthropic lists models (`GET /v1/models`), SMTP uses nodemailer `verify()` (no email sent), Pushover hits `/users/validate.json` (no push fired). Each probe is timeout-wrapped (8s) and try/caught so one slow/failing service never sinks the report.
  - **Notion is split into its two independent paths** so they're tested separately: `notion_mcp` reads `notionMCP.getStatus()` (mcp.notion.com / OAuth), `notion_rest` calls the new `restTokenStatus()` in `notionMCPProxy.js` which validates `NOTION_INTEGRATION_TOKEN` against `api.notion.com` (`GET /v1/users/me`) with **NO MCP fallback** — the one call that confirms a rotated integration token on its own path without the MCP masking a failure. Directly answers "test my new Notion key and make sure it isn't hitting the MCP."
  - Surfaces: `GET /api/integrations/health` (new endpoint) + Quokka read-only tool `check_integrations` (in `adviserToolsMisc.js`, wired through `adviserDeps.probeIntegrations`). Say "check my integrations" / "are my connections working" / "test my Notion key" and Quokka returns the full report. Brings the adviser tool count 63 → 64 (settings+analytics group 4 → 5).
  - New exports: `restTokenStatus()` (`notionMCPProxy.js`), `verifyEmail()` (`emailNotifications.js`). No new files → no Dockerfile COPY change (both modules already in the runtime list). Verified: server boots, `GET /api/integrations/health` returns all 12 with correct statuses on a cred-less DB (11 not_configured, web_push degraded), `check_integrations` present in `GET /api/adviser/tools`.

- chore(repo): stop `Version-History.md` generating merge conflicts (union merge driver) [XS]
  - This changelog is append-near-the-top, so any two parallel or stale-base branches edited the same region → it conflicted on essentially every change (it caused 100% of the day's merge-conflict churn). New `.gitattributes` marks `wiki/Version-History.md` as `merge=union`: git keeps BOTH sides' added lines on merge/rebase instead of emitting a conflict. Scoped to this file only — `union` is correct for an append-only log, wrong for prose files (CLAUDE.md edits replace text, so it's deliberately excluded). Verified by reproducing the exact failing rebase (two branches both inserting at the top): 0 conflict markers, both entries retained. Documented the mechanism + trade-off (entries can interleave in odd order; tidy on sight) in CLAUDE.md's Documentation Requirements.
- fix(routines): auto-roll now re-applies the trigger time when carrying a task forward [S]
  - Prod bug: a daily **auto-roll** loop with a **trigger time** (e.g. "IFR Studying – PM" at 13:00) surfaced in the morning instead of staying parked until its clock time. Cause: `spawnDueTasks` in `useRoutines.js` rolls an auto-roll routine's existing instance forward to today, but the roll path only *cleared* a stale `snoozed_until` and never re-applied `triggerSnooze(today, trigger_time)` — so the rolled-forward task had no snooze and showed immediately. The fresh-spawn path always set it correctly; only the roll path was wrong. Not a regression from the day's UI/vite/changelog work (those don't touch routine logic).
  - Fix: the roll updates now always set `snoozed_until = triggerSnooze(today, routine.trigger_time)` (today@trigger if still future, else null). Added a `needsSnoozeFix` check so an already-surfaced instance (due today, snooze cleared) gets re-parked on the next spawn pass — idempotent (no-op once correct), and a no-op for loops without a trigger time. Verified across 5 scenarios: rolled-from-yesterday → hidden until 13:00; already-surfaced → re-parked; correctly-snoozed → no-op; past trigger (after 13:00) → surfaces; no-trigger loop → unchanged.

- fix(build)!: clear all 3 high-severity audit findings — vite 6→8, plugin-react 4→6, vite-plugin-pwa 1.2→1.3 [S]
  - `npm audit` flagged 3 high advisories (esbuild + vite + `@vitejs/plugin-react`, incl. the esbuild dev-server advisory `GHSA-gv7w-rqvm-qjhr`), and Dependabot was alerting on the default branch. All three are **build-time `devDependencies` only** — the multi-stage Dockerfile's runtime stage runs `npm ci --omit=dev`, so vite/esbuild/plugin-react never ship in the prod container (actual runtime exposure was zero). Cleared anyway since prod promotion was gated on a clean audit.
  - npm's only fix path was the semver-major bump, so: `vite ^6.3.5 → ^8.0.16`, `@vitejs/plugin-react ^4.4.1 → ^6.0.2`, `vite-plugin-pwa ^1.2.0 → ^1.3.0` (1.3.0 declares `vite ^8` support). `vite.config.js` uses only stable APIs (`defineConfig`/`define`/`server.proxy`/`VitePWA`) so no config changes were needed. Docker already runs `node:22-alpine` (satisfies vite 8's `^20.19 || >=22.12` engine). Verified: `npm audit` → **0 vulnerabilities**, `npm run build` green (PWA v1.3.0, comparable bundle size), eslint clean (pre-existing warnings only), and the built app boots + serves under `node server.js`.

- docs: update wiki model references to claude-sonnet-4-6 [XS]
  - `Development.md` + `Features.md` still named the retired `claude-sonnet-4-20250514`; aligned them with the app-wide model swap. (Version-History references to the old id are intentional — they describe the migration.)

## 2026-06-14

- fix(ai)!: migrate off the retiring `claude-sonnet-4-20250514` model app-wide [S]
  - Prod report: "Broke the shit outta Quokka" — new chats open but every send returns "Could not retrieve response". Root cause: every Claude call in the app hardcoded `claude-sonnet-4-20250514` (Claude Sonnet 4, May 2025 snapshot), which Anthropic **deprecated with a retirement date of 2026-06-15** — so it began failing right at the deadline. Quokka surfaced it first because it's the heaviest caller (up to 15 tool-use turns per message → near-certain to hit the failing model), but the same stale ID powered size/energy inference, date extraction, toast lines, research, pattern detection, tag suggestions, Gmail scan, and AI nudges. Confirmed via the `claude-api` skill (authoritative model catalog) — not a regression from recent commits (none touched the adviser path).
  - Fix: swapped every `claude-sonnet-4-20250514` → the current `claude-sonnet-4-6` across all 9 source files (`server.js` `ADVISER_MODEL`, `adviserToolsTasks.js` research_task, `src/api.js`, `src/hooks/useNotifications.js`, `patternDetection.js`, `tagSuggestions.js`, `emailNotifications.js`, `gmailSync.js`, `scripts/generate-seed-data.js`). The adviser/inference call shapes carry no `thinking`/`budget_tokens`/prefill/`output_format`, so the migration is a clean model-ID swap with no breaking-change risk. The Haiku calls (`claude-haiku-4-5-20251001`) are still current and were left untouched. Kept the Sonnet *tier* (Quokka's deliberate cost choice for long tool loops); `claude-sonnet-4-6` is a non-dated alias so it won't silently age out the same way. Effort tuning (Sonnet 4.6 defaults to `high`) deferred — pure correctness swap.

- fix(ui): un-smash the loop + task editor forms at iPhone PWA width [S]
  - Rendered every edit screen at iPhone PWA size (390px). The forms-based
    editors (Edit loop / RoutinesModal, full Edit task + Add task / EditTaskModal
    + AddTaskModal — all sharing `forms.css` + the energy-grid CSS) were cramped;
    the chip quick-editor, Throw sheet, What-now and Settings rendered fine.
  - **Energy type pills truncated** ("people"→"pe…", "confrontation"→"co…"): the
    grid was `flex: 1; flex-wrap: nowrap`, built for 5 chips on one row; the 6th
    type (confrontation, added earlier today) tipped it into ellipsis. Now a
    responsive `grid (auto-fit, minmax 88px)` that wraps to a clean 3×2 with
    text-wrap fallback + tuned font/padding so even "confrontation" reads on one
    line. Fixes Add + Edit task together (single source in `AddTaskModal.css`).
  - **Loop "Auto (cadence) / Habit (target frequency)" toggle** wrapped into two
    floating half-pills → now two full-width stacked segments.
  - **Follow-up step rows**: the "After prev" timing select truncated to
    "After pre" (96px → 116px) and the controls row now `flex-wrap`s so the
    move-up/down arrows drop to their own line instead of overflowing.
  - CSS-only; `RoutinesModal.css` + `AddTaskModal.css`. Verified via a puppeteer
    iPhone-viewport harness against the real running app.

- fix(tasks): restore the missing "Confrontation" energy type everywhere [S]
  - Bug report: the energy-type picker (Kept quick-edit, Add/Edit modals, What-now capacity step) offered only 5 types — **Confrontation was absent** — yet badges (Dragon Slayer, the gold "Balanced Diet" = every energy type in one week), the avoidance nagging boost, and the AI inference docs all treat it as a first-class 6th type. So Balanced Diet was literally unearnable and confrontation tasks could never be tagged by hand.
  - Root cause: `confrontation` had been dropped from every UI/inference surface while the Quokka tool enums (`adviserToolsTasks.js`) and badge math still expected 6. Restored across the board:
    - `store.ENERGY_TYPES` (the single source for Add/Edit modals, EditTaskModal, WhatNowModal, TaskCard) + tap-to-cycle now includes Confrontation (`Flame` icon).
    - `src/kept/QuickEditTask.jsx` hardcoded `ENERGY` list (the modal in the report) + `TaskCard`/`WhatNowModal` icon maps gained `Flame`.
    - **Color token** `--energy-confrontation` was missing from the single-source block — added to `tokens.css` (#E8806A) and both Kept palettes via a new `--bm-f-flame` flight token (light #C0392B / dark #E5734F), distinct from clay (physical) and eucalypt (errand). Verified all six render distinctly in kept-dark.
    - **AI inference prompt** (`inferSize` in `src/api.js`) never listed confrontation, so the model could never emit it either — added it plus the What-now / capture prompts and label maps.
    - **Avoidance nagging boost** (`AVOIDANCE_ENERGY_TYPES`) was `['errand']` only across `store.js` + the three server engines (`email`/`push`/`pushover`), contradicting the documented "confrontation/errand get nagged ~30-56% more" — now `['errand', 'confrontation']` everywhere.

## 2026-06-13

- fix(api): research mode no longer crashes on backslashes / newlines [S]
  - Prod: running Research threw "JSON Parse error: Unrecognized token '\'". `researchTask` asked the model for `{"notes":"…multi-line bullets…"}` then `JSON.parse`d it — but freeform notes routinely contain raw newlines and backslashes (measurements like `3\4"`, paths, escapes) that aren't valid JSON, so the parse blew up and the result was lost. Long-standing fragility, not a regression from the recent tags/loops work (git log on `researchTask` confirms it was untouched). Fix: prompt for a plain markdown bullet list and use the response text directly; if an older reply still wraps it in JSON, unwrap by hand (no `JSON.parse`) and strip code fences. Verified the failing backslash case + fenced + legacy-JSON inputs.

- fix(ui): Settings joins the card aesthetic + edit-modal title affordance [S]
  - Settings was lagging the loop/edit-modal polish: inputs sat on a different surface, and the **Logs tab had no Kept treatment** — its active filter was an inverted near-black pill clashing with the warm palette. Now (Kept) settings inputs are inset on the page bg to match the editors, buttons are raised card-2 chips, the Logs filter chips use ember when active, and the log stream is a proper warm card.
  - Edit-modal title fix: the heading-styled title input read as a section header with no visible field when empty (you couldn't tell where to type a new loop/task name). Added a hairline underline (ember on focus) so it's clearly editable while keeping the big-title look.

- feat(ui): Kept edit modals adopt the LoopDetail card aesthetic [M]
  - Polish pass toward the native build. The Add/Edit task + loop-editor forms still wore the flat wallaby-era form styling; now (Kept only) each `.v2-form-section` / `.v2-form-row` / `FormDisclosure` renders as a warm rounded card (matching LoopDetail's "Recent cycles"/"Needs attention" cards) — an iOS-grouped-form feel. Inputs are inset on the page bg so they don't blend card-on-card; chips/pills are raised to `--bm-card-2`; the title reads as a heading (display font, no box); the primary submit is gold to match the LoopDetail primary. All in `src/kept/forms.css`, gated to `[data-theme^="kept"]`, so Standard themes are untouched.

- fix(routines)!: "Mark done" on a stack cycle inflated the count + never cleared [S]
  - Prod report: tapping **Mark done** on a Bedtime (stack) needs-attention day kept ticking the lifetime count up (12 → 43) while the day stayed "finished, not recorded". Cause: `markRoutineDayDone` keyed its idempotency + the gap check on the cycle's **due day** (`ymd`) but STAMPED the member's `completed_at` ISO — for a stack, members are often completed on a *different* local day than the due date, so the stamp bucketed elsewhere, the June-8 check never saw it, and every click appended another stamp.
  - Fix: the stamp now always buckets to `ymd` (use the real completion time only when it lands on the same local day, else noon-of-`ymd`), so a single click resolves the gap and further clicks are true no-ops. `markRoutineDayDone` also self-heals exact-duplicate timestamps, and `hydrateRoutines` collapses exact-duplicate `completed_history` stamps on load — correcting counts already inflated by the bug (identical timestamps are never legitimate). Verified: 4 junk dupes → 1, gap clears on click 1, clicks 2-3 unchanged.

- fix(achievements): Balanced Diet breakdown matches the progress number [XS]
  - The detail checklist showed THIS week's energy types while the card's "4/6" is the BEST week ever — two different weeks, so the breakdown contradicted the number (the achievement is "every energy type in one week"). The overlay now reflects the **best week's** type set (`balancedBestSet` in `badges.js`), titled "Your best week", so the 4 checked match the 4/6 and the two unchecked are what that single week was missing.

- feat(achievements): tier legend, aligned card footers, tap-through detail overlay [S]
  - Three asks from a prod screenshot. (1) **What the colors mean** is now explicit — a Bronze/Silver/Gold legend sits in the grid header (the card tints are achievement tiers). (2) **Footer alignment** — earned dates and progress bars sat at different heights because cards were different sizes; cards are now equal-height (`grid-auto-rows: 1fr`) with the footer pinned to the bottom (`margin-top:auto`), so dates/bars line up across the whole grid. (3) **Detail overlay** — tapping any badge opens a popup with the emoji, tier, description, and either the earned date or a progress bar + "N to go". Set-shaped badges show a **done/outstanding checklist**: Balanced Diet lists all six energy types with this-week checks (`checklist`/`checklistTitle` added in `badges.js`). Mystery badges open a "keep playing" card. Cards are now buttons; `BadgesGrid` is shared by Analytics + the Flight log so all surfaces get it.

- feat(tags): weekly NEW-tag discovery from past tasks [M]
  - Sibling to the routine pattern scan. New `tagSuggestions.js` runs a weekly (Sunday 4am local) scan over recent task titles (last 90 days) and asks Claude for up to 5 NEW tag themes that recur across tasks but aren't covered by existing labels — durable contexts ("finances", "home", "health") over one-offs, deduped against current labels + pending suggestions. Stored in `app_data.tag_suggestions`.
  - Surfaced in the Suggestions inbox above the routine suggestions: each shows the proposed tag + rationale + example task titles, with **Add tag** (creates the label client-side via the normal CRUD + sync, then dismisses) or **Dismiss**. New tasks then auto-tag with the accepted label. Server never mutates the labels blob (dodges the bulk-write hazard) — accept is client-side.
  - Endpoints: `GET /api/tag-suggestions`, `POST /api/tag-suggestions/:id/dismiss`, `POST /api/tag-suggestions/scan` (manual, runs in the same pass as the routine scan from the modal). `tagSuggestions.js` added to the Dockerfile runtime COPY list (root module imported by server.js). Verified: module boots + lifecycle starts, store list/dismiss work, no-key scan degrades gracefully.

- feat(tasks): auto-evaluate tags on new tasks (alongside size + energy) [S]
  - `inferSize` now takes the user's label list and also returns `tags` — the existing labels that clearly apply (conservative; never invents labels; only valid ids survive). Auto-applied on every create path via the background `useSizeAutoInfer` hook + `handleAddTask`, merged into any hand-set tags (never drops one). The quiet-hours bypass label (`wake-me`) is excluded from candidates so auto-tagging can't change notification behavior. (Weekly NEW-tag discovery from past tasks is the next piece.)

- fix(routines): loop reconcile now covers STACKS (the blank-cycle bug) [S]
  - Prod report (with screenshots): "Bedtime" showed June 10 as incomplete on its calendar even though every Bedtime task (Start dishwasher, Lock doors, …) was done that day. Cause: a stack closes per `(routine_id, due_date)` cycle (all members cleared → one `completed_history` stamp), but that closing stamp can fail to land (completed from the main list, a refetch race, pre-fix completions) — and the reconcile work explicitly EXCLUDED stacks, so `loopGaps` returned nothing for Bedtime (no "Needs attention" card) and the day stayed blank with no way to fix it.
  - `loopGaps` (`src/kept/cycles.js`) and the server `reconcileRoutineHistory` (`db.js`) now reconcile stacks per cycle: a past `(routine_id, due_date)` cycle whose every member is done but whose closing stamp is missing is surfaced as an **unrecorded** gap (Mark done stamps the due day, closing the cycle). Partial cycles (not all members done) are left alone; habit loops still excluded. Verified: a fully-done unstamped cycle is flagged, a partial one isn't.

- fix(routines): make the loop trail tappable into the missed-days breakdown [XS]
  - User report (with screenshot): "I should be able to click on this and see what was missed on a given loop." The cycle-chip trail / month / year visualization — the thing that visually shows the misses — wasn't a tap target; only the loop title opened the detail. Wrapped the visualization in a keyboard-accessible button (`bm-loop-card-viz`) that opens `LoopDetail`, where the per-day "Needs attention" breakdown (unrecorded + missed, each with Mark done / Skip) already lives.

- feat(routines): loop reconcile review surface — see + fix the days per loop [M]
  - Follow-up to the reconcile work (user: "I'd like to click on the missing loops to see what days I need to look at and fix"). Instead of silently auto-closing stuck loops on load, Boomerang now surfaces them for review. `loopGaps(routine, tasks)` (`src/kept/cycles.js`) walks the cadence windows and splits past, non-current, uncaught cycles into **unrecorded** (a finished task exists in the window — the loop just never recorded it) and **missed** (due but no completion at all).
  - `LoopsView` shows an "N to fix" chip on each affected loop card; tapping it (or the card) opens `LoopDetail`, which renders a **Needs attention** card listing each day, labeled by group, with two actions per day: **Mark done** (`markRoutineDayDone` → stamps `completed_history`, crediting the cycle) or **Skip** (`skipRoutineDay` → records the day so it stops surfacing, without crediting — the trail stays honestly uncaught).
  - **Schema:** migration `037` adds `routines.skipped_days_json` (JSON array of acknowledged 'YYYY-MM-DD'); wired through `routineToRow`/`rowToRoutine`/the UPSERT + the client `createRoutine` default. `skipped_days` is excluded from both `loopGaps` and the server reconcile.
  - **Removed the silent auto-reconcile-on-load** (it would have erased the "unrecorded" group before the user could see it). The Quokka `reconcile_loops` tool stays as the explicit fix-all and now also respects `skipped_days`. Threaded `onMarkLoopDay`/`onSkipLoopDay` AppV2 → KeptShell/KeptDesktop → LoopsView → LoopDetail.

- feat(routines): loop quick-actions on the Kept Loops surface — Spawn + Skip [M]
  - Plan item 1. `spawnNow` and `skipCycle` existed only inside the buried RoutinesModal list; they're now reachable from the Kept Loops page. `onSpawnNow` + `onSkipCycle` thread AppV2 → KeptShell / KeptDesktop → LoopsView → LoopDetail. The spawn guard (refuse while an instance is still active) is extracted into one shared `handleSpawnLoop` in AppV2 so RoutinesModal and the Kept surfaces all enforce it identically.
  - **Swipe** (`LoopSwipe.jsx`, reusing `useSwipeActions`): each Loops card swipes left to reveal **Spawn** (gold) + **Skip** (neutral), with a brief ✓ "Spawned" / "Skipped" confirmation like the modal's spawn feedback. Spawn greys to "On list" when an instance is already active. Habit loops render as plain cards (they're logged, not spawned/skipped — parity with the modal).
  - **Buttons** on `LoopDetail`: a Spawn now / Skip cycle action row sits under the rally/best/lifetime stat cards so the tap-through page carries the same actions.
  - Gardyn case note holds: spawn today → complete the task → the cycle's clock resets on completion, so Spawn alone covers "run it today, the month resets" now that it's no longer buried.

- feat(quokka): `reconcile_loops` tool — close stuck-open loops on request [S]
  - Companion to the auto-on-load reconcile: a server-side `reconcileRoutineHistory({ dryRun })` in `db.js` (buckets completion-days in `settings.user_timezone`, matching the durability `completion_days` path) backs a new Quokka `reconcile_loops` tool in `adviserToolsTasks.js`. Staged like other edits, with a dry-run preview that names exactly which loops + how many days it'll stamp, and per-routine LIFO compensation that restores each `completed_history` on rollback. Idempotent; skips stacks + habit loops. So "close the loops that won't clear" now works conversationally, not just on the next app open. (Routine tool count 6 → 7.)

- fix(routines): reconcile stuck-open loops against their completed tasks [S]
  - Follow-on to item 4 (user report: "loops that all tasks have been completed but the loop isn't closed"). A loop closes (cadence advances, card crosses out) when its spawned task is completed — that stamps `completed_history`. Tasks completed before the stamping path existed, via a non-stamping path, or surviving a history wipe leave the loop stuck open: a done task on the list and no matching history entry, so it never advances and keeps nagging.
  - New `reconcileRoutineHistory(tasks)` in `useRoutines.js` walks every ordinary cadence routine's done tasks and appends a `completed_history` stamp for any completion-day missing from the history. Runs once per session after server hydration (AppV2, gated like the streak-anchor effect) so existing stuck loops auto-close on next open. Idempotent — only ever adds genuine done-task evidence, so re-running is a no-op. Stacks (close on last-member clear) and habit loops (multi-per-day logs, no cadence) are excluded.

- fix(routines): loop card crosses out + counts when its task is completed from the main list [S]
  - Plan item 4. Completing a routine-spawned task from the main task list advanced the cadence clock (`completeRoutine` stamps `completed_history`) but the Today loop card didn't reliably cross out or increment the "Loops `{done}/{total}`" header — the `doneToday` indicator keyed solely off the `completed_history` stamp, which can lag or be reverted by a server refetch race.
  - `doneToday` now ORs in a second, independent signal: a routine-spawned task with `status='done'` and a `completed_at` bucketing (local time) to today. The two completion paths (loop check vs main-list complete) now agree. Stacks are unchanged — they still close on last-member clear via their own cycle accounting.

- fix(routines): un-smash the Edit-loop header + return to the Kept loops page on save [S]
  - Plan items 2 + 3. The in-form `← Back to {noun}s` pill (`v2-routine-back`) stacked directly under ModalShell's own back-arrow + title — a doubled, smashed header. Removed; ModalShell's close affordance is the single exit (button + CSS both gone).
  - When the modal opens DIRECTLY into the form from Kept (via `editRoutineId` / `openToForm`), Save now calls `onClose()` instead of `setView('list')` — so the user lands back on the Kept Loops page, not the leftover internal "Loops · N active" list. Forms reached from the modal's own list still return to that list. Tracked via a new `openedToForm` flag.

- fix(notifications)!: notifications now stay read — persisted `read_at`, separate from `tapped_at` [M]
  - Plan item 5. "Read" was conflated with the engagement-analytics `tapped_at` field, which broke three ways: `markAllRead` only mutated local React state (never the server, so reopening re-marked everything unread); `tapped_at` is keyed by `(task_id, channel)` so task-less notifications (weather, pile-up, generic) could never be marked read; and stamping `tapped_at` for a passive glance polluted tap/completion analytics.
  - **Schema:** migration `036_notification_read_at.sql` adds `read_at TEXT` to `notification_log` (rides the table that already survives bulk wipes, so read-state syncs across devices). **db.js:** `markNotifEntriesRead(ids)` + `markAllNotifsRead()`; `listNotifLog` returns `read_at`. **server.js:** `POST /api/notifications/log/read` (body `{ ids }` or `{ all: true }`). **api.js:** `markNotifsRead()`. **NotificationsModal:** "unread" + the row dot/highlight key off `read_at`; `handleTap` and `markAllRead` persist via the new endpoint. `markNotificationTap` stays for real task-tap engagement analytics only.

## 2026-06-12

- feat(ui): quick editor — Polish + Research inline, decrowded checklist [S]
  - Prod report: "Big lists feel crowded and the polish and research functions are missing unless I go to more options." The Kept quick editor (QuickEditTask) now surfaces both AI actions right under the notes field: a **Polish** pill wired to useTaskForm's existing `handlePolish` (it was always in the form hook, just never rendered here) and a **Research** pill that reveals an inline prompt + Go, running the same `researchTask` call as the full editor and appending results to notes via the autosave path.
  - Decrowding: checklist rows get breathing room (9px vertical padding, hairline separators, 1.35 line-height) with delete icons dimmed to 0.45 until hover; the title input is now an auto-growing textarea so long titles wrap instead of clipping ("Move Notion connector to new Bo…" → full title visible).
  - Verified in the harness at 390px kept-dark: 2-line title renders unclipped in a grown textarea, both pills present, Research reveals the prompt input, 6 checklist rows show the new spacing.

- fix(notion): KB adoption reports REST-access failures with the share-the-database fix [S]
  - Mystery solved (verified by fetching the user's database directly): there are TWO "Boomerang Knowledge" databases — the auto-created `742626dd…` (REST-shared, what the server synced) and `ee8d3826…` (the one the user actually uses, holding the real entries, NOT shared with the REST integration). When REST can't see a database, the MCP fallback returns only the SCHEMA — never rows — so the index sits empty while entries exist: the exact "connected but empty / schema instead of content" symptom.
  - `verifyRestAccess` now returns a boolean, adoption carries `rest_access`, and the setup response includes a pointed hint when REST is blind: *"open the database → ⋯ → Connections → add your Boomerang integration, then Sync now."*

- fix(ui): Quokka opens at the latest message [XS]
  - Reopening Quokka dropped you at the TOP of your last chat (prod report). The auto-scroll only fired on message changes and only moved the inner pane — on open, the chat hydrates async and Kept's outer page scroller stayed at the top. Both scrollers now land at the bottom on open (frame + post-hydration pass) and stay pinned during streaming. Recorded as diagnosis (d) in the Q-plan; Q2's single-scroller layout retires the dual-scroller problem for good.
  - Verified live: a seeded 29-message chat opens with the newest message in view, both scrollers at bottom.

- docs(design): Quokka surface redesign plan (Q1–Q3) + diagnosis [S]
  - Prod report: chat loses message order, has massive overscroll, and "feels like we bolted v2 into Kept again." All three diagnosed to exact causes (design doc §14): the stream handler updates messages BY POSITION (`slice(0,-1)` replace-last) instead of by identity, the SSE resubscribe replays the whole event buffer with no consumed-index filter, and the chat renders two nested scrollers (the Kept full-page `.v2-modal` scroller wrapping a 60dvh inner pane) inside form-oriented override CSS.
  - Plan: **Q1** chat-engine correctness (message ids, update-by-id, one consumed-event cursor across SSE+poll, strict placeholder lifecycle), **Q2** Kept-native QuokkaSurface (fixed three-row column, one scroller with overscroll containment + stick-to-bottom, ember user bubbles / document-voice replies / gold tool chips / plan card as the hero, frosted composer; desktop 720px column), **Q3** polish (history slide-over, suggestion chips, wb-icon-btn retirement).
  - Also tracked: KB creates succeed but report errors (response parsing after side effect) — user-deferred.

- fix(notion): remove the decoy KB settings keys that misled Quokka [XS]
  - The vestigial `settings.notion_knowledge_db_id/url/last_sync` blob keys (always empty — the real connection lives in standalone server keys) made Quokka's `get_settings` read a WORKING knowledge base as "unconfigured," which kicked off the whole repair spiral that overwrote the real key with a share-link id. The decoys are gone from DEFAULT_SETTINGS; the knowledge tools' own configured-check (the standalone key) is the single truth.

- fix(notion): KB adoption proves the id is a queryable database + reports indexed count [S]
  - Round 2 of the existing-KB report: adoption "succeeded" with a `/p/` share-link id but every index query came back empty — `getDatabase`'s MCP `notion-fetch` fallback returns content for ANY id (pages, views, share-link targets), so it can't tell a database from anything else. Adoption now runs a real `queryDatabase` against the id BEFORE storing it and rejects non-databases with a pointed message ("open the database as a full page and copy THAT URL").
  - The setup response and Quokka's `connect_knowledge_database` result now include the **indexed count**, so "Connected — 2 items" vs a silently empty index is visible at connect time; refresh errors surface instead of being swallowed.

- fix(notion): connect an EXISTING knowledge-base database — the missing path [M]
  - Prod report: a user with a pre-existing "Boomerang Knowledge" database had no way to register it — the DB id lives in a standalone server key written ONLY by the auto-create flow, the Settings field Quokka described didn't exist, and Quokka's `update_settings` writes settings-blob keys the server never reads. Re-running setup would have minted a duplicate database.
  - **Three new paths**: (1) `POST /api/knowledge/setup` accepts `database_id` (URL or bare id) and adopts the existing database after verifying it's reachable and un-archived, then runs the first index sync; (2) Settings → Notion → Knowledge Base gains an "…or connect an existing database" input + Connect button; (3) Quokka gains a `connect_knowledge_database` tool (64th) so "use my existing KB" works conversationally — with compensation clearing the stored id on plan rollback.
  - `parseDatabaseId` handles dashed UUIDs, bare 32-hex, notion.so slug URLs (where a trailing slug letter must not bleed into the id — caught in unit checks), app.notion.com `/p/` short links, and hand-grouped dashed ids.
  - Verified: parser unit table (6 shapes), endpoint error paths (garbage input → clear parser message; unreachable Notion → clear connection message), Settings UI in the bundle (section renders inside the Notion-connected gate, which the harness can't enter).

- feat(ui)!: K6 — Wallaby teardown [XL]
  - **`src/wallaby/` is gone** (22 files): WallabyShell + the Home/Habits/Tasks/Profile/Goals/Notifications views, nav, header, ContributionHeatmap, the shared.css de-pill overrides, and the wallaby palette blocks. The Wallaby family is removed from the theme picker, `theme.js`, and the index.html pre-paint map.
  - **Survivors relocated into `src/kept/`** (load-bearing for Kept): `heatmapUtils.js`; `WallabyEditTask` → `QuickEditTask.{jsx,css}` (the Kept mobile quick editor); the `modals/forms/settings/analytics` override sheets with gates narrowed from `:is(wallaby, kept)` to `kept` only; and a new `wb-compat.css` carrying the base `--wb-*` token defaults + the Quokka toolbar `.wb-icon-btn` rules so wb-token components resolve everywhere until the quick editor is rebuilt bm-first.
  - **Theme migration**: stored `terminal*`/`wallaby*` values collapse silently onto `kept-dark`/`kept-light` in both `loadSettings()` and the pre-paint script — no dead-palette flash, no stranded users.
  - AppV2 sheds the WallabyShell render block, `isWallaby`, and `useWallabyEditor` (now `useQuickEditor`, Kept-only); `useMobilePages` matches kept only.
  - Verified live: stored `wallaby-dark` → boots as `kept-dark` (DOM + persisted) into the Kept shell; quick editor and full editor (5 disclosures) intact; theme picker reads Standard/Kept; Standard theme renders its own layout untouched. `npm test` 5/5, lint clean, build green.

- feat(ui): Board view mode — Kanban demoted to a mode (K5 complete) [M]
  - The desktop Tasks surface gains a **List | Board** toggle: Board renders Up next / Doing / Waiting / Done as Kept-native columns with native drag-and-drop. Dragging a card between columns changes its status; **dropping on Done catches it** through the canonical completion handler (points, toast, undo all ride along); dragging out of Done reopens. Done column shows the last 15. Label filters compose; the board excludes gmail-pending, children, and stack members like the list does.
  - New `src/kept/BoardView.jsx` + `bm-board-*` styles; `boardable` + `onStatusChange` threaded through KeptDesktop only (mobile keeps the list).
  - With the Today rail (part 1) and Board, **K5 is functionally complete** — the remaining spec items (Timeline mode, detail panel, j/k nav) move to the post-teardown polish list.
  - Verified live at 1440px: 4 columns render with correct counts; dragging "Change furnace filter" onto Done moved it and completed the task server-side.

- feat(ui): desktop Today rail + sidebar K4 parity (K5 continuation, part 1) [M]
  - **Today rail**: the Kept desktop command center gains its third column — while working in Tasks or Loops, a 290px right rail keeps today ambient: date + rally chip, the Day Arc, catches/pts-left, a What now button, and the Due-today list with catchable checks (canonical handlers). Hidden on the Today tab, where the full surface IS today.
  - **Sidebar K4 parity**: Flight log and Notifications rows join the Review section — the K4 destinations were mobile-only until now.
  - New `src/kept/TodayRail.jsx` + `bm-rail-*` styles in desktop.css.
  - Verified live at 1440px: rail renders on Tasks (arc + stats + due rows), disappears on Today, sidebar rows open the Flight log and Notifications center.

- feat(ui): Tasks sort modes + Kept-native frosted toast [S]
  - **Tasks tab sorting** (the queued ask): an ArrowUpDown toggle next to search reveals sort chips — **By due date** (the grouped day-planner default) / **Newest** / **Oldest** / **A–Z**; non-default modes flatten to one sorted section within the active tab + label filter, and the toggle glows ember while a custom sort is active. Done/Snoozed keep their natural orders.
  - **Toast restyle, the visual half of the earlier overhaul**: the inverted black pill becomes a **frosted banner** — translucent surface + backdrop blur (the same chrome language as the Kept nav and the pinned-control underlay), hairline border, a 3px ember accent edge, ember UNDO pill. Reopen variant tints toward the accent. All on `--v2` tokens, so Standard inherits gracefully.
  - Verified live: sort chips render, A–Z flattens correctly (first/last alphabetical), toast renders frosted with the ember edge + Next-up row.

- feat(ui): Flight log — the avatar's real destination (K4 complete) [M]
  - The Kept header avatar opened Analytics — the last borrowed screen. It now opens the **Flight log**: a six-card records strip (↻ rally / best rally / lifetime / year points / best day / today, gold-iconed), **Your year** as a Density Ribbon with a Catches/Points toggle (arcs not grids, per the spec), and the full achievements wall with earned dates. Reads the analytics daily series; no new data. Analytics keeps its More-menu home.
  - New `src/kept/FlightLog.{jsx → flightlog.css}`; avatar wiring threaded through KeptShell with the Analytics fallback.
  - **K4 is complete**: bell → notifications center, loop card → detail page, avatar → Flight log. Every header affordance now leads to its own purpose-built surface.
  - Verified live: avatar → Flight log with correct stats (records strip matches seeded data), ribbon renders, metric toggle flips, 6/24 badge wall embedded.

- feat(ui): loop detail page + cycle-true rally (K4, part 2) [M]
  - **Tapping a loop card opens a real detail page** instead of dumping into the editor: back arrow + title + a deliberate Edit button, cadence/anchor/time meta, three stat cards (↻ rally / best / lifetime in the loop's feather color), a 16-chip "Recent cycles" trail, and a steppable month calendar (MonthDots with prev/next). The card's pencil still edits directly.
  - **Rally and best are now measured in the loop's own cycles** — consecutive weeks/months/intervals caught (`cycleRally` in cycles.js, computed over a 60-window depth) — replacing the calendar-day streak that read "↻ 1" forever on anything non-daily. Card chips and detail agree; the current in-flight cycle extends the rally only once caught and never breaks it.
  - Verified live: weekly loop with catches 0/7/14 days back reads ↻ 3 on card + detail (best 3, 9× lifetime); month stepper steps; Edit opens the editor; back returns to the list.

- feat(ui): notifications center — the bell's real destination (K4, part 1) [M]
  - The Kept header bell opened the Activity log — a borrowed screen. It now opens a real **Notifications** center reading the existing server `notification_log` (no new data): All/Unread tabs with a live unread count, day-grouped rows in the Activity log's icon-chip language (overdue/stale/pile-up/package/weather/Quokka tones), unread dots, two-line body previews, channel + time-ago meta.
  - **Tap a row** → marks it read (stamps `tapped_at` via the engagement API when task-linked) and deep-links into the task editor. **Mark all read** clears the dots optimistically. Activity log remains in More, unchanged.
  - New `src/components/NotificationsModal.{jsx,css}`; bell wiring threaded through KeptShell (`onOpenNotifications`).
  - Verified live with mocked log fixtures: day groups + unread dots render, Unread tab filters (2 of 5), mark-all-read empties it, tapping a task-linked row opens the editor.

- feat(ui): 🧹 Clean Sweep — 24th badge, evens out the wall [XS]
  - Gold, recovery class: catch 3+ overdue tasks and end the day with zero overdue. Computed from live state (overdue caught today + nothing overdue remaining); the durable earn stamp makes the moment permanent.
  - Verified live: with overdue caught and the board cleared, the badge earned and stamped (`badges_earned.clean_sweep`); while loop-spawned overdue remained it correctly stayed locked.

- feat(ui): achievements expansion — 11 new badges + durable earn persistence (design wave 4/4) [M]
  - **Earned is forever now**: the first render where a badge qualifies stamps `settings.badges_earned[id] = 'YYYY-MM-DD'` (via `stampEarnedBadges` in the shared BadgesGrid); `computeBadges` merges the map so deleting the rows that earned a badge can never un-earn it — the existing 12 badges were silently vulnerable to exactly the deletion class that caused the streak incident. Server-side key-union guard added for `badges_earned` in `mergeDurableStreakSettings`. Earned cards show their date.
  - **11 new badges** (10/12-earned wall → 23 total): recovery class — 🪃 *It Comes Back* (catch a 30+ day-old task, hidden), 🔆 *Phoenix* (lose a 14+ day rally, build a 7-day one from the ashes, hidden), 🏳️ *Strategic Retreat* (set aside 5 tasks); energy class — 🐉 *Dragon Slayer* (⚡⚡⚡ confrontation catch), 🥗 *Balanced Diet* (every energy type in one week), 🏋️ *Heavy Lifting* (3 L/XL in a day); pattern class — 🌅 *Dawn Patrol* (3 before 8am), 🌙 *Night Shift* (a catch after 10pm, hidden), 🛠️ *Weekend Warrior* (10-catch weekend); loop class — 📦 *Stack Champion* (10 clear-bonuses), 🛤️ *Long Haul* (quarterly+ loop alive a year).
  - **Hidden badges** render as dashed ❓ mystery cards until earned, then reveal with their tier color.
  - Verified live: seeded a ⚡⚡⚡ confrontation catch, a 45-day-old completion, and a 10pm catch → Dragon Slayer / It Comes Back / Night Shift earned and revealed, earn map stamped with dates, Phoenix still a mystery card.

## 2026-06-11

- feat(ui): task editor — progressive disclosure (design wave 3/4, part 2) [M]
  - The full task editor (reached via "More options" from the quick editor) gets the same treatment as the loop form: Status, Notes (+weather), Due/Priority, GCal duration, Size, Energy, and Checklists stay visible; **Attachments, Connections, Labels, Comments, Project/Project-link, and Linked knowledge** move behind summarizing disclosure rows (counts / "Notion linked" / "2 selected"), opening by default when they have content. The Project row only renders when relevant (project task or parents available). Manage row unchanged at the bottom.
  - `FormDisclosure` extracted to a shared component (`src/components/FormDisclosure.{jsx,css}`) — both editors now use one primitive.
  - Verified live through the Kept flow: task → quick editor → More options → full editor shows 5 collapsed disclosures + the visible essentials; Labels expands to working pills.

- fix(ui): Loops page speaks one visual language — dailies join the cycle chips [S]
  - Prod report: "Why in the world are there two entirely different design strategies on the loops page?" — the daily mini-trail exception from wave 1 put dot-rows next to chunky chips on the same surface. Dailies now render cycle chips like everything else (one chip per day, "caught 8 of last 11 days · today ✓"); the FlightTrail leaves the Loops cards entirely.
  - Also: caption pluralization fixed ("caught 1 of last 1 months" → singular units), and the window anchor falls back to the oldest history stamp for legacy loops without created_at.

- feat(ui): loop editor — progressive disclosure (design wave 3/4, part 1) [M]
  - The "reskinned v2 form" complaint (§13b): the loop editor now shows only the decisions you actually make — title, mode, frequency/day, time (or target count for habits) — with everything else behind hairline disclosure rows that expand in place: **More options** (end date, priority, auto-roll, last-done repair), **Stack items**, **Follow-ups**, **Labels & notes**. Collapsed rows summarize their contents ("last done 2026-06-11", "3 items"); rows with content open by default when editing. Submit says "Create loop" in Kept.
  - New `FormDisclosure` primitive in RoutinesModal + `v2-form-disclosure-*` styles on shared tokens — all themes inherit, no override CSS, zero logic changes (every field/handler preserved verbatim).
  - Verified live: new-loop form renders one calm screen (4 collapsed rows); editing a stack pre-opens Stack items with both members; full round-trip create with a disclosure-buried field (high priority) persisted correctly.

- feat(ui): Activity log refresh — day groups + action icon chips (design wave 2/4) [S]
  - The flat 200-row stream is now grouped under sticky day headers (Today / Yesterday / Tue, Jun 9) with a tinted icon chip per action type (created/completed/reopened/deleted/status/edited/snoozed/skipped/priority/error), title-first row hierarchy, and the Restore pill right-aligned on the row. Search, All/Deleted/Errors filters, and AI search unchanged.
  - Styled on `--v2-*` tokens so the Kept palette flows through without override CSS (per the K4 no-reskin-by-override rule); Standard and Wallaby inherit the same cleanup.
  - Verified live in Kept: three day groups, 10 icon chips, restore pill functional.

- feat(ui): cadence-aware loop charts — cycle chips replace the day-grid (design wave 1/4) [M]
  - The Loops "Trail" tab now fits the visualization to the loop's own cadence (§13a; prod report: the dot grids were "really hard to interpret for as much real estate as they eat"):
    - **Daily loops** → a compact 4-week mini Flight Trail (single row).
    - **Habit loops** → 12 target-aware cycle chips (filled = target met, faded = partial, hollow = nothing) + "this week 2/3 · target met N of last M weeks".
    - **Everything else** (weekly/monthly/quarterly/annually/custom) → one chip per cadence window, anchored at the loop's creation date, with "caught N of last M <units> · this one ✓".
  - New `src/kept/cycles.js` (window math: day-stepped + month-stepped + habit periods) and `src/kept/CycleChips.jsx`; Month/Year drill-down tabs unchanged. Cards drop to a third of their height.
  - Also: the loop editor's escape hatch says "← Back to loops" in Kept (noun threaded into RoutineForm — last hardcoded "routines" string).
  - Verified live across all four shapes (daily mini-trail; habit 3×/week with met/partial/missed weeks; weekly with gaps; monthly) — chip counts and captions match the seeded history exactly.

- fix(ui): New loop goes straight to the form + Suggestions button on Loops [S]
  - Follow-up: icon swapped to the single four-point `Sparkle` (the universal AI glyph) — `Sparkles` is Quokka's mark.
  - **Flow fix** (prod report: "New loop → Loop List → New routine makes no sense"): the "New loop" button now opens the editor directly in the blank form (`openToForm` prop on RoutinesModal, consumed on open) — no list detour, no second tap. The list's own buttons also respect the Kept noun now ("+ New loop", not "+ New routine").
  - **Loop suggestions live on the Loops page**: gold Sparkles "Suggestions" button in the title row (deliberately not the Quokka ember treatment — it's the pattern scanner, not the adviser), with an ember dot badge when the weekly scan has pending finds (`GET /api/suggestions` count). The "Loop suggestions" row is removed from the mobile More menu; desktop sidebar and Standard theme unchanged.
  - Verified live: Loops header shows the badged button → opens "Loop suggestions"; "New loop" lands on the form; More menu reads Arcs · Analytics · Caught · Packages · Activity log · Settings.

- feat(ui): Kept pull-to-refresh + toast swipe-up dismiss [S]
  - **Pull-down-to-refresh on the Kept mobile shell** (the dropped ask, recovered by auditing the transcript — it predated a context compaction and fell out of the working notes): dragging down from the top of any tab surface (Today/Tasks/Loops/More) reveals a boomerang-arc spinner; releasing past the threshold runs a full server refetch (`useServerSync.refetch` → the same hydration path SSE uses) and holds the spinner until it resolves. `overscroll-behavior-y: contain` keeps the browser's own rubber-band out of the way. New `src/kept/PullToRefresh.jsx`.
  - **Toast swipe-up dismiss**: the top banner now follows the finger upward and flicks away past 36px — a real push-notification gesture to go with tap-dismiss. (Honest accounting from the user's audit: the earlier toast round changed position, animation, dismissal, and copy — the visual shell itself is still the adaptive dark pill; a Kept-native banner restyle rides with the editor redesign wave.)
  - Verified live: drag → spinner at 96px + `/api/data` refetch fired on release; catch → toast at top → swipe up → dismissed.

- fix(ui): hero follows breakdown date selection + Loop suggestions rename + nav swap [S]
  - **The hero now follows the breakdown's selected day** (prod report: "slider and counts should change with the date selection"): selection state lifted from `WeekBreakdown` into `TodayView`; picking a non-today day swaps the headline date, the Day Arc (value + "points that day" caption), and the meta row to that day's numbers — catches/points computed identically to the breakdown's item list so the arc total always matches the itemization; loops shown as a plain done-count (historical due-ness isn't reconstructable). Reverts to live today-stats when today is selected or the breakdown closes.
  - **"Routine suggestions" → "Loop suggestions"** everywhere Kept-facing (More row, desktop sidebar row, modal title via a `title` prop — Standard theme keeps "Routine suggestions").
  - **Bottom nav swap**: Today · Tasks · [Throw] · Loops · More (Tasks promoted next to Today per user preference).
  - Achievements expansion + cadence-aware charts confirmed into the next design wave alongside the Kept-native editors (design doc §13).

- feat(ui): completion toasts — push-style top banner + fresh no-repeat message pools [S]
  - **Top banner** (prod request: the bottom pill "sits in the way"): the toast now slides down from the top edge like an iOS push banner — tap anywhere to dismiss, auto-dismisses after 4s (8s with a Next-up suggestion), Undo and Next-up unchanged. z-index above the shell header and pinned modal controls.
  - **Fresh messages** (prod report: "I get the same like 6 every time… really tired of 'That's barely procrastination'"): root cause — routine/stack tasks completed same-day fall back to the 5-message static quick pool (AI prefetch only backfills on app load, so spawn-and-complete-today always went static). Pools expanded to 12–18 messages per variant (brand-voiced: "Caught it mid-air.", "The boomerang came back. You caught it.", "Released from the haunted backlog."), the offending line culled, and a **shuffle-bag picker** (last ~14 shown per variant persisted in `boom_toast_recent_v1`) guarantees no repeats until a pool is exhausted.
  - Verified live: catch → banner at top with a new message + Undo; tap dismisses; recent-bag persists.

- fix(ui): Kept hero tap target + frosted pinned-control underlay [S]
  - **The whole Day Arc + stats block now toggles the daily breakdown** (prod report: "Still can't click on the hero bar"). The previous tap target was only the skinny catches/loops/pts row — and the harness verification used a JS `.click()`, which bypasses hit-testing and hid how small the real target was. Re-verified with real synthetic touch taps on the arc itself.
  - **Claude-style frosted underlay behind the pinned back button** (prod report: "it keeps overlapping shit — things need to fade behind it in a way that shows it's intentional"): the full-page modal top strip is now a backdrop-blur band (translucent page tint + feathered mask) instead of a hard gradient, so scrolled content visibly dissolves behind the control. Header padding bumped 60→72px so titles clear the button at rest. Scoped away from the in-shell Quokka surface (no frost band over the app header).
  - Stale Settings copy fixed: Kept description now says Smoke/Linen + ember, not the abandoned green-ink palette.
  - Design feedback captured in `wiki/Kept-Design-Language.md` §13: cadence-aware loop trails (dot grids don't fit non-daily loops), Kept-native editors (reskinned v2 forms feel foreign), achievements expansion ideas.

- fix(ui): Kept loop crediting + tap-the-stats breakdown + suggestions scan transparency [M]
  - **Cleared stacks credit as closed loops** (prod report: clearing Bedtime's last member flipped the hero from "2/3 loops" to "2/2" — the finished loop fell out of both counts). A stack whose cycle cleared today now stays counted and renders as a checked receipt row (title · cadence · rally · done-check) until midnight, matching how plain done loops behave. Check is display-only; un-clearing goes through reopening the member task.
  - **Tap the hero stats for a daily breakdown** (prod request): the catches/loops/pts-left row on Today now toggles an inline week strip (Sunday-anchored, activity-intensity bars, prev/next week chevrons) + the selected day's caught tasks with per-task points and the Daily Bonus egg — v2 WeekStrip parity in the Kept skin, defaulting to today. New `src/kept/WeekBreakdown.jsx` + `bm-week-*` styles.
  - **Loop-suggestions scan is no longer a silent shrug** (prod report: "Routine suggestions has nothing for all of the data it has access to"): the engine verified healthy in the harness (4 ad-hoc weekly completions → 1 weekly suggestion surfaced), but "Run scan now" discarded the scan's result. The empty state now reports what the scan saw — "Scanned N completed tasks, M repeating candidates, K cleared the confidence bar" — and explains that loop-spawned tasks are skipped on purpose, so only ad-hoc repeats (3+ at a steady rhythm) can surface.
  - Verified live end-to-end on seeded data: last-member clear → hero 0/1 → 1/1 + receipt row; stats tap → strip + "3 catches · 8 pts" itemization; scan → "Water the plants (weekly)" pending.

- fix(streak): completion-day provenance survives task deletion — round 3, the actual prod mechanism [M]
  - Final diagnosis of the 36→27 incident (from the user's real analytics + easter-egg data): the dismissed Gmail import carried the ONLY completion evidence for 2026-05-14. Deleting it turned that day into a **fault day** (active tasks, no completion) and `computeStreak`'s walk broke there — the anchor/floor fixes from rounds 1–2 were real but orthogonal; no floor can carry a walk through a fault day.
  - `db.js deleteTask()` now stamps the dying task's completion day (done `completed_at` / waiting `waiting_at`, bucketed in the user's timezone via `Intl.DateTimeFormat`) into `settings.completion_days` — compact append-only 'YYYY-MM-DD' provenance. `computeStreak` credits those days as completions.
  - The server-side guard grew into `mergeDurableStreakSettings()`: anchor backward-only + **union** merges for `completion_days`, `free_days`, and `easter_egg_wins` on every bulk settings push, so no stale device blob can drop streak evidence. Quokka's `setData()` path still bypasses it for deliberate corrections.
  - User repair for the already-lost day: `free_days: ["2026-05-14"]` via Quokka (confirmed restored, rally 49 with the 2026-04-23 anchor).
  - Verified in the harness on the incident shape: baseline rally 33 → delete the day's only completion → provenance stamped, rally 33 live and after reload (28 without the fix); hostile anchor-less blob push → guard restored the entry.

- fix(streak): server-side backward-only guard for streak_anchor — round 2, the anchor now actually survives [M]
  - Round 1 shipped the anchor but it died in prod within seconds, two ways: (a) the client seeding effect ran against localStorage-cached tasks BEFORE server hydration, so a device that hadn't hydrated the (Quokka-set) repair anchor seeded its own later date and `flushSync()`ed it over the server's; (b) even with that gated, any live page whose localStorage lacked the anchor erased it via the `pagehide` sendBeacon whole-blob settings push — reproduced exactly in the harness ("hydrate merge: server=undefined").
  - Fixes, all three layers: **server** `mergeStreakAnchorBackwardOnly()` on bulk PUT/POST `/api/data` keeps the earlier of (stored, incoming) — the load-bearing fix, since the blob path is last-writer-wins; **client effect** now waits for server hydration (`serverHydratedRef`) before seeding; **client hydration merge** keeps an earlier local anchor over a later server one. Quokka `update_settings` uses `setData()` directly and bypasses the guard, so deliberate repairs/corrections always stick.
  - Also corrected round 1's wrong claim: `/api/analytics/history` aggregates `status='done'` rows from the same tasks table — it is NOT an independent survivor and can't reconstruct deleted pending imports. New "Derived-Stat Durability Rules" section in CLAUDE.md captures the whole lesson.
  - Verified in the harness against the hostile shape: server anchor 2026-05-06, live client stripped of it + unload beacon crossfire → server log shows the guard catching the push, anchor intact on both ends, rally restored 27 → 36.

- fix(streak): persistent backward-only streak anchor — deleting old records can't shorten the rally [S]
  - Prod incident: a 36-day rally dropped to 27 after dismissing old Gmail imports. Root cause: `computeStreak`'s history floor = the creation date of the OLDEST SURVIVING task, recomputed live — deleting your earliest record moved the floor forward and retroactively cut the streak. The bonus/egg math was untouched and innocent.
  - Fix: `settings.streak_anchor` ('YYYY-MM-DD', only ever moves backward) now bounds the floor. AppV2 maintains it once per load from the oldest task AND the earliest active day in `/api/analytics/history` (which survives deletion/cleanup) — so affected users' floors restore to their true history start on next load, and no future delete/dismiss can shrink a rally.
  - Verified against the exact incident shape: seeded a 36-day-old import as the oldest record, anchor persisted (from analytics, even earlier), dismissed the import → rally unchanged.

- fix(ui): Kept audit round 2 — real Gmail review, What Now, subtasks, Snoozed tab, label filters [L]
  - **Gmail review actually works now** (prod report: "imported items isn't doing shit"): the banner routed to SuggestionsModal — the *routine-pattern* surface — and deeper, the Keep/Dismiss buttons died with v1's TaskCard and were never ported to v2 at all. Today now has a **Review** section: pending rows with **Keep** (approves via `/api/gmail/approve`, task joins the list optimistically) and **Dismiss** (deletes). The More/sidebar row is relabeled "Routine suggestions" to match what it actually opens.
  - **What Now is reachable again**: a Compass button under the Day Arc (mobile) + a sidebar row (desktop) open the existing WhatNowModal.
  - **Checklist subtasks render inline** on Tasks rows (gold circle sub-checks, toggle via the canonical checklist update) — Wallaby parity restored.
  - **Snoozed tab** on Tasks: returns chips + a **Now** bring-back button (unsnoozeTask).
  - **Label filter chips** on the Tasks tab (All + labels, dot-styled, horizontal scroll); **stack members excluded** from Upcoming/Backlog/Snoozed (they live in their Today folder; still in Done as records).
  - All verified live end-to-end on seeded data; lint 0; tests + build + smoke pass.

- fix(ui): Kept Today — caught tasks leave the list + collapsible sections [S]
  - **Caught tasks no longer linger struck-through** on Today (the last day-planner-recap carryover): completion removes the row immediately, v2's contract — the toast's Undo covers regret, Caught keeps the record.
  - **Sections collapse into their titles**: Arcs / Today / Anytime / Loops on Today and every group on the Tasks tab get a chevron toggle (new shared `Section` component + `useCollapsedSections`), persisted in `settings.kept_collapsed` — the same cross-device mechanism as v2's `collapsed_sections`.
  - Verified live: catch → row leaves with zero strikethroughs; collapse → rows hidden, aria-expanded + persisted state correct.

- fix(ui): Kept Today — main-page contract restores (divergence audit, round 1) [M]
  - From the divergence audit: five places Kept's Today silently dropped v2 main-list behavior.
  - **Habit-mode loops always visible** — the cadence filter ran target-frequency loops through `getNextDueDate` (which doesn't model them), hiding them after any log; habit-mode is "log any day", so they're now always due.
  - **Pinned Arcs return to the main page** — pinned projects (title · session count · gold Log-session button) with their active children as catchable rows, above the Today section.
  - **Gmail-pending visibility** — a gold banner ("N imported items to review") on Today opens Suggestions; Suggestions also added to the desktop sidebar.
  - **Signal restores** — `Nd on list` staleness meta (isStale), `doing`/`waiting` status tags, and a high-priority marker (ember halo on the check + HIGH tag).
  - Verified live on seeded data: all five render and behave; zero page errors; lint 0; tests + build + smoke pass.

- fix(ui): lock text-size-adjust — landscape rotation no longer inflates text permanently [XS]
  - Prod report: rotate to landscape and back → row titles and meta stuck at boosted sizes (everything except SVG text). iOS Safari's font boosting inflates text on rotation and, with `text-size-adjust` unlocked, keeps the inflated sizes back in portrait. `html { -webkit-text-size-adjust: 100% }` in index.css renders authored sizes in every orientation. (Not reproducible in headless Chromium — the standard documented remedy, applies to all themes.)

- fix(ui): Kept Today — undated tasks get an Anytime section (new throws were invisible) [S]
  - Prod report ("new tasks not hitting the main page" — with three duplicate throws as evidence): the Throw sheet defaults to *No date*, and Kept's Today only showed tasks with `due_date <= today` — Wallaby Home's day-planner filter carried into what is actually the main page, so undated tasks never appeared there (v2's Up next always showed them). Today now renders an **Anytime** section (overdue/today rows first, then undated active tasks, same row anatomy + swipe). Future-DATED tasks still stay off Today until their day, per the scheduled-work rule. Verified: a thrown no-date task appears under Anytime immediately.

- fix(ui): Kept stacks are folders — v2-parity display (open members only, no history, no chrome rows) [M]
  - Prod report: the Bedtime folder rendered "36/36" — every done member from every past cycle, struck through. The `due <= today` member filter dragged in all history, and the waiting/cleared stack rows added chrome v2 never had. **Reverted to the v2 StackSection model:** a stack is an organizational folder — grouped by cycle `(routine, due_date)`, rendered ONLY while a cycle has open un-snoozed members, showing ONLY those open members (done ones drop out; the `done/total` header carries progress). Nothing pre-trigger, nothing after clear — no waiting row, no Start button, no cleared receipt (dead `onSpawnStackToday` threading removed from the Kept shells).
  - Verified against the exact report scenario (2 fully-done past cycles + live cycle + a pre-trigger stack): zero historical ghosts, pre-trigger stack fully hidden, folder vanishes with its last member, exactly one new history stamp.

- fix(ui): Kept Today — trigger-time stacks stay "returns tonight" until their clock time [S]
  - Prod screenshots (the "Bedtime" stack, trigger 8pm-ish) showed snoozed stack members leaking into Today as individual "↩ returns tonight" rows hours early. Pre-trigger, a stack now renders as ONE row — `Bedtime · 3 items · ↩ returns tonight` with a muted check, no Start button — per the trigger-time contract. Members surface grouped only once un-snoozed; `returningSoon` excludes stack members (the stack row represents them). Verified with a 23:45-trigger stack: single returns row, zero member leakage, no premature grouped block.

- fix(ui): Kept Today — stack support (grouped member rows, Start affordance) [M]
  - Stacks were rendered as a single-toggle loop row on Kept's Today — tapping the check would have caught one arbitrary member per tap. Stacks now fan out properly: a grouped block (stack head + `done/total` progress + indented member rows with feather checks) when the cycle is spawned; a **Start** button when due but not yet spawned; a "cycle cleared today" state after the last member. Member checks route through the REAL task path (`onCompleteTask`) so the 20% clear-bonus and the lone last-member `completed_history` stamp hold — verified end-to-end: 3-member stack spawned, members grouped (not duplicated in the plain Tasks rows), full clear produced exactly ONE history stamp + the bonus toast.
  - `onSpawnStackToday` threaded into KeptShell + KeptDesktop; stack members excluded from Today's plain task rows.

- fix(ui): Kept Today — only cadence-due loops; modal-top fade strip [S]
  - **Prod bug:** Today listed EVERY non-paused loop daily (loggd's all-habits-are-daily assumption carried into TodayView) — weekly/monthly/quarterly routines like "Mow · weekly · Fri" surfaced days early. The loops list now filters through `getNextDueDate`: a loop shows only when cadence-due today (or overdue), or already done today so a checked loop doesn't vanish. The full library stays on the Loops tab. Verified with a Friday-anchored weekly loop completed last Friday: hidden from Today, present in Loops.
  - **Edit-modal title collision:** with the back button pinned (previous fix), scrolled content slid UNDER it — the "Edit loop" title read "it loop" mid-scroll. A fixed gradient strip (page bg → transparent, click-through) now fades content out under the pinned controls.

- feat(ui): Kept palette revision — "Smoke + Ember" replaces Nightgum + Ochre [M]
  - The green-ink + gold direction read *earthy* in daily use. From a 4-direction live exploration (same Today screen re-skinned via token injection) the user picked a blend of "Warm Ink + Ember" and "Graphite + Gold": **Smoke** — a warm-neutral de-greened canvas (`#16140F` dark / `#F8F4ED` light) — with the brand's original **ember orange** (`#F26640`/`#D9512B`) as THE hero, and **gold demoted to the warm companion accent** (`--bm-gold`, rally chips + the ochre feather). Danger shifts to crimson so it can't collide with the ember hero.
  - Token rename to match reality: `--bm-gold*` → `--bm-ember*` across all Kept components; new real `--bm-gold`/`--bm-gold-soft` for the rally accents. wb-bridge remapped (pause → gold-soft).
  - Brand re-inked: the arc-into-catch mark goes ember (Logo.jsx, favicon, regenerated PWA icons on the smoke tile); browser-chrome colors updated in theme.js + pre-paint. Spec §3 rewritten with the new tables and the revision note.
  - Verified live in both modes; zero page errors; lint 0; tests + build + smoke pass.

- fix(ui): Kept tire-kicking round 1 — editors, swipe, clickable loops, pinned back button [M]
  - **Editors now speak Kept.** A `--wb-*` → `--bm-*` token bridge inside the kept theme blocks means every wallaby-built component resolves to the Kept palette, and the forms/settings/analytics override layers are `:is()`-extended to kept — so the chip task editor (now enabled for kept themes, it was wallaby-gated), the full EditTaskModal's form controls, AddTaskModal, and the Settings/Analytics internals all render gold-on-Nightgum instead of raw v2. The bridge is explicitly temporary: it dies at the K6 Wallaby teardown when those components re-token to `--bm-*` directly.
  - **Swipe is back:** new `RowSwipe` wrapper (shared `useSwipeActions` gesture) on Today + Tasks rows — swipe left reveals Catch (gold) / Delete.
  - **Loops are tappable:** loop rows on Today and loop-card titles on Loops open the loop editor (previously only the pencil icon was interactive).
  - **Back button pinned:** the full-page modal back arrow (and the autosave chip) were absolutely positioned inside `.v2-modal` — the page SCROLLER — so they scrolled off-screen on long pages. Now `position: fixed`.
  - Verified live: chip editor opens in Kept palette from the task action sheet; loop tap opens "Edit loop"; back arrow at top after an 800px scroll; swipe wrappers on every row.

- fix(ui): Kept — shared-modal titles follow the Kept naming layer [S]
  - The More menu said Arcs / Caught / Loops but the modals opened as "Projects" / "Done" / "Routines". `ProjectsView`, `DoneList`, and `RoutinesModal` now take a `title` override (+ `noun` on RoutinesModal so the form reads "New loop"/"Edit loop"); AppV2 passes the Kept names when a kept theme is active. Standard + Wallaby keep their existing titles. Verified live: all three open under their menu names.

- feat(ui): Kept — bouncing wordmark + shared sync-bounce hook [S]
  - The save-wave is back on the brand: the Kept `boomerang.` wordmark (mobile header + desktop sidebar) renders per-letter spans driven by the same sync states as the standard header — letters bounce while saving, flash green on sync, dim on degraded/offline. The gold period rides the wave (boosted-specificity rule keeps it gold through the state colors; animations still apply on top).
  - **Dedupe:** the hold/flash state machine existed as identical copies in `Header.jsx` and `WallabyHeader.jsx` (a third was about to land) — extracted to `src/hooks/useSyncBounce.js`; all three headers now consume it. `syncStatus`/`queueLength` threaded into KeptShell + KeptDesktop.
  - Verified live: header captured mid-wave in `saving` state; idle → saving → idle cycle confirmed on a real task completion.

- feat(ui): Kept K5(v1) + K6 cutover — desktop command center + new-install default [L]
  - **KeptDesktop** (`src/kept/KeptDesktop.jsx` + `desktop.css`): the command-center layout for kept themes on desktop — persistent sidebar (brand, gold **"Throw a task ⌘K"** pill, Today/Tasks/Loops nav, Review section routing to Arcs/Caught/Analytics/Packages/Activity, Quokka card, Settings) over a centered work surface rendering the shared Kept views. **⌘K** opens the Throw sheet (centered dialog treatment on desktop). FloatingCapture FABs gated out of kept desktop. K5 continuation (Today rail, Board/Timeline view modes, detail panel) tracked in the spec.
  - **K6 cutover (new installs):** an unset theme now defaults to **Kept following the system color scheme** (`kept-dark`/`kept-light` via `prefers-color-scheme`, persisted on first load). Existing users keep their stored theme — nothing migrates. Wallaby remains in the picker; its teardown is the K6 completion step once Kept is accepted as the daily driver.
  - Verified headless: fresh install lands on kept-light (headless prefers light); desktop Today/Tasks/Loops navigation, ⌘K throw dialog, matched-version hero data. The transient "3650-day rally" seen during verification was the pre-existing computeStreak iteration guard surfacing on an EMPTY task list (blocked hydration) — not a Kept regression.

- feat(ui): Kept K3 — the KeptShell mobile IA (Today / Loops / Throw / Tasks / More) [XL]
  - **KeptShell** renders for kept themes on mobile: `KeptHeader` (mark + `boomerang.` wordmark, gold Quokka button — Quokka is one tap from every screen, not a nav tab — bell, avatar), `KeptNav` (Today · Loops · **Throw** · Tasks · More; one gold accent, active dot), and the **ThrowSheet** (title + Today/Tomorrow/Weekend/No-date chips; "More options" hands off to the full AddTaskModal).
  - **TodayView:** wing-corner Day Arc hero (points vs goal, catches / loops / pts-left meta, `↻ rally` chip) + today's tasks as hairline rows (gold circle checks, dot-tags, `↩ returns` chips for snoozed) + Loops rows with mini Flight Trails and feather checks.
  - **LoopsView:** Trail/Month/Year underline segments over per-loop cards (FlightTrail / MonthDots / DensityRibbon); edit routes to the existing routine editor. **TasksViewKept:** Upcoming/Backlog/Done with grouped sections, action sheet (reschedule chips = "throw it back", edit, delete). **MoreView:** Arcs (ProjectsView), Analytics, Caught, Packages, Suggestions, Activity log, Settings.
  - **Structural cleanup (per the K-plan):** the canonical habit-toggle handler was extracted from WallabyShell's inline closure to a shared `toggleHabitDay` in AppV2 — both shells now consume the same single-writer completion path. `useWallabyMode` generalized to **`useMobilePages`** (wallaby OR kept), and `wallaby/modals.css` now serves both shells via `:is()` gates — the full-page modal treatment (back arrow, takeover) works identically in Kept.
  - Verified headless end-to-end on seeded data: Today/Loops (all three ranges)/Tasks/action sheet/More/Throw (thrown task lands under Tomorrow)/Quokka-from-header. Zero page errors; lint 0; dates tests + build + smoke pass.

- feat(ui): Kept K2 — canonical date module + the four signature viz components [L]
  - **`src/dates.js`** is now THE date module: `parseLocalDate` / `localYMD` (date-only strings are LOCAL days — the documented contract behind three past timezone-bug incidents), `addDays`, `weekStartMonday`, `fmtMonthDay`. `store.js` and `wallaby/heatmapUtils.js` delegate to it (re-exports keep every existing import working). **First real unit tests:** `scripts/dates.test.mjs` (node:test) covers the UTC-midnight trap, passthrough, month/leap boundaries, streak chaining, week anchoring — wired into `npm test` ahead of the smoke test.
  - **`src/kept/` viz components** (spec §5, shared mobile+desktop): `FlightTrail` (rows of 14 round day-dots, consecutive done-days bridged by literal streak ARCS; `mini` variant for list rows), `MonthDots` (numbered circle calendar + arcs), `DensityRibbon` (weekly totals as a smooth gradient area curve — the year view that replaces contribution grids), `DayArc` (semicircular gold gauge with tenth-ticks + tip dot). All colors via `--bm-*` tokens / feather props; intensity-scaled opacity; `<title>`/aria labels.
  - Dev harness `kept-viz-preview.html` + `src/kept-viz-preview.jsx` (vite-dev only, never shipped) — all four screenshot-verified in kept-dark and kept-light with deterministic mock history.

- feat(ui): Kept K1 — brand assets + palettes + theme registration + energy single-source [L]
  - **New brand shipped:** Kept arc-into-catch mark replaces the V-swoosh everywhere — `Logo.jsx` (gold arc + ink-aware catch curve via `--v2-text`), `favicon.svg`, `icon-192/512.svg`, regenerated `icon-192/512.png` + `apple-touch-icon.png` (sharp, Nightgum-gradient tile).
  - **`src/kept/palette.css`:** full `--bm-*` token set (Nightgum defaults for every theme + `kept-dark`/`kept-light` blocks overriding `--v2-*`), gold hero, feathers, scrim/shadows. Kept themes also swap `--v2-font-display` to Fraunces (loaded in index.html, replacing the orphaned JetBrains Mono terminal font).
  - **Theme registration:** `kept-dark`/`kept-light` in `src/theme.js` + index.html pre-paint; Settings → Theme family is now Standard / Wallaby / Kept (generic family×mode composition replaced the per-family branching).
  - **Energy colors single-sourced:** new `--energy-{desk,people,errand,creative,physical}` tokens — standard values in tokens.css, wallaby palette maps them to `--wb-cat-*`, kept palette to feathers. `store.ENERGY_TYPES` and WallabyEditTask now reference the tokens; the four duplicated hex definitions are gone (one source, every theme tunes in one place).
  - Until K3, Kept themes render the standard layout in the Kept palette — the KeptShell (4-tab + Throw) lands next.

- chore(ui): Kept K0 — demolition (terminal teardown + src/v2 flattening + theme registry) [XL]
  - **Terminal theme fully removed** (the documented "didn't stick" teardown): `src/v2/terminal/` (11 CSS files), `useTerminalMode`, the `terminalTitle`/`terminalCommand`/`terminalConfirmLabel` props on ModalShell/EmptyState/ConfirmDialog and ~20 call-site files, the terminal-only TaskCard density signals (tappable `[ ]` checkbox + its completing-fade machinery, `[X/Y]` inline counter, 🔥N routine-streak badge + its `routineStreaks` threading through 6 components, notes preview), `data-terminal-*` attributes, every `[data-theme^="terminal"]` CSS block in component stylesheets, and both `check:terminal-*` smoke scripts. The theme migration shims (store.js + index.html pre-paint) survive so stored terminal values keep upgrading to wallaby.
  - **`src/v2/` flattened into `src/`** — the post-v1 tree had `src/v2/` as a meaningless layer. `src/v2/components/` → `src/components/`, `src/v2/wallaby/` → `src/wallaby/`, `src/v2/hooks/*` merged into `src/hooks/`, `AppV2.{jsx,css}` + `tokens.css` to `src/`. All import paths rewritten (including dynamic `import('../../api')` calls vite couldn't resolve); the eslint `no-use-before-define` override now covers all of `src/` (one legitimate-at-runtime forward reference in `useAdviser` annotated).
  - **Theme registry consolidated:** new `src/theme.js` (`THEME_COLORS` + `applyTheme()`) replaces the duplicated theme→color maps in AppV2 and SettingsModal — sync points down from three to two (index.html pre-paint can't import).
  - First phase of the Kept migration (`wiki/Kept-Design-Language.md` §12): the bundle now carries exactly two design languages (Standard + Wallaby) before Kept adds its own.

- docs(ui): Kept — public-facing design language + full rebrand direction [L]
  - Wallaby is too close to its loggd.life inspiration to ship publicly. **Kept** captures the spirit (history-first glanceability, warm dashboard energy, semantic clarity) but rebuilds every expression from the boomerang metaphor: throw / return / catch / kept.
  - **Brand (full rebrand, direction 3 of 3 explored):** arc-into-catch mark, `boomerang.` Fraunces wordmark with gold period, gold-ochre hero on green-ink canvases (Nightgum dark / Linen light, system-follow default). Exploration board in `brand-board.html`.
  - **Language:** arcs-not-grids — Flight Trail (round day-dots with literal streak ARCS bridging consecutive days), Month Dots, Density Ribbon (smooth area curve year view), Day Arc gauge. One hero color + six "feather" identity accents; hairline lists; dot-tags; wing-corner hero cards; Fraunces display + DM Sans body; throw/catch motion vocabulary with iOS haptics.
  - **IA:** mobile = 4 tabs + center Throw button (Quokka moves to the header); desktop = command center (sidebar + List/Board/Timeline work surface + Today rail + detail panel, ⌘K throw, keyboard hint bar). Coherence contract: identical tokens/viz/row anatomy/naming across platforms; only navigation chrome and density differ.
  - Full spec in `wiki/Kept-Design-Language.md` incl. the loggd-distinction table and the K1–K6 migration plan. Rendered prototypes: `kept-preview.html` (mobile, both palettes) + `kept-desktop.html` (desktop, both palettes), screenshot-verified.

- refactor(ui): wallaby design-language coherence pass + v2 date bugfixes + v1 purge [XL]
  - **Wallaby coherence.** Shared control primitives (`.wb-back`, `.wb-seg`, `.wb-stepper`, `.wb-fab`, the `.wb-btn` semantic family, `.wb-confirm`) consolidated into `src/v2/wallaby/shared.css` — `.wb-btn` had two drifted definitions (GoalsView vs HabitsView) whose winner depended on CSS import order. Active-state convention codified: view/range tabs → slate `--wb-card-3` fill; form value-pick segments → green. The Analytics Overview/Tasks/Habits tabs (the one green outlier) now match every other view tab. New palette tokens `--wb-on-action`, `--wb-on-pause`, `--wb-scrim`, `--wb-shadow-pop`, `--wb-shadow-press` replace every raw `#fff` / `rgba(0,0,0,…)` in wallaby CSS+JSX so wallaby-light renders correctly (task-sheet scrim, FAB/sheet shadows, pause-button text, active tag-chip text in the chip editor). Energy accents in WallabyEditTask map to `--wb-cat-*` instead of hardcoded Tailwind hexes; streak flames use `--wb-cat-orange`. One color-identity rule: `routineColors()` in heatmapUtils assigns a habit's accent from its index in the FULL routines list, shared by Home/Habits/Profile (previously Profile indexed a differently-filtered list, so the same habit could render different colors per surface — and pausing one routine reshuffled the others). WallabyEditTask footer buttons match the `.wb-btn` scale.
  - **v2 bug fixes.** Date-only strings (`due_date`) were parsed with naive `new Date('YYYY-MM-DD')` → UTC midnight → previous local day west of UTC: a task due today grouped as Overdue in the Wallaby Tasks view, GoalsView target dates displayed a day early, and `longestStreak` broke chains. New `parseLocalDate` in heatmapUtils + `localYMD` returning date-only strings as-is fix all call sites. The Wallaby Goals "+" FAB now creates a project (status `'project'` via the createAsProject path) instead of a plain task that never appeared in Goals. Dead code removed: the four unreachable `showHabits/showTasks/showProfile/showGoals` overlay blocks in AppV2 (+ `.v2-habits-overlay` CSS), the unused `onAdviserAfterCommit` threading in WallabyShell, the unused `habitColor()` hash helper, and the `.wb-placeholder` CSS for the retired "coming soon" rows.
  - **v1 purge.** Deleted `src/AppV1.jsx`, the entire legacy `src/components/` (21 v1-only components + CSS, ~18k lines), and `src/App.css`. Shared components v2 imported from the v1 tree (`Logo`, `Rings`(+css), `CarrierLogo`, `WeatherSection`) moved to `src/v2/components/`; the `.weather-*` styles WeatherSection depends on were extracted from v1's TaskCard.css into `src/v2/components/WeatherSection.css` (v2 had been inheriting them through the v1 bundle graph). `src/App.jsx` is no longer a router — it always renders AppV2; the `ui_version` flag + `?ui=` escape hatch are ignored; the Settings → Legacy tab and `v1_disabled` setting are gone; index.html pre-paint sets `data-ui="v2"` unconditionally.
  - Transitive `hono` advisory (GHSA-2gcr-mfcq-wcc3, via @modelcontextprotocol/sdk) resolved via `npm audit fix` → 0 vulnerabilities.
  - Verified headless (wallaby-dark + wallaby-light): Home, Habits + detail, Tasks + action sheet, Goals, Analytics, Settings, Notifications, Quokka. Build + lint + terminal-title/button smoke tests pass.

- fix(ui): wallaby edit-modal verification pass — three editor bugs [S]
  - `WallabyEditTask` initialized drain from `task.energy_level`, but client task objects carry camelCase `energyLevel` (db.js maps the column on read) — the chip editor always opened existing tasks with no drain, and its next autosave wrote `energyLevel: null`, silently wiping the task's drain level.
  - Stale editor handoff: AppV2 passed the `editTarget` *snapshot* (captured when the editor opened) to the modals, so flipping chip editor → "More options" seeded the full editor with pre-edit values — and its autosave could write them back. The modals now receive the LIVE task (`tasks.find(id)`, falling back to the snapshot for server search results).
  - Debounce loss: the chip editor's 500ms autosave timer was cancelled on unmount, dropping an edit made just before back/"More options"/status-close. A `flushSave()` now runs on every exit path.
  - Verified headless end-to-end: pick energy+drain in the chip editor and immediately open "More options" inside the debounce window → full editor shows the new values; wallaby-light chip editor + full editor + AddTaskModal render correctly (full-page, back arrow, readable active tag chips).

---

## 2026-06-08

- fix(routines): Wallaby — one history stamp per completion (kill the doubling) [M]
  - **The bug:** completing a routine and then checking it on the Wallaby Home/Habits grid recorded the day **twice** — inflating the grid intensity, streak, and total-count. Root cause was source-of-truth fragmentation: `completed_history` (what the Wallaby grids/streaks read) was written by *both* `completeRoutine` (on task completion) *and* the Home checkbox's raw `updateRoutine(completed_history…)` write. Same completion, two stamps.
  - **The fix (targeted — one stamp per path):** `onToggleHabit` in `AppV2.jsx` no longer raw-writes for today. It now routes through the canonical task path: an **auto/cadence** routine's check completes (or reopens) the real surfaced task — `completeRoutine` is the lone history writer — and falls back to a direct **toggle** of the day's stamp only when no concrete task applies (past day, or today with nothing surfaced; check adds, re-tap removes — single source, nothing to double with). Verified headless: completing via the task + checking on Home yields exactly one history entry; re-tapping a no-task day toggles cleanly instead of incrementing.
  - **Latent bug #1 fixed — empty habit-mode grids.** `logHabit` created a born-done task but never stamped `completed_history`, so habit-mode (target-frequency) routines' Wallaby grids were populated *only* by the Home checkbox. `logHabit` now stamps history once per log (born-done tasks never route through `handleComplete`, so no double), and the Home habit-mode check routes through `logHabit` / un-log. (Historical habit-mode logs predating this fix won't backfill the grid — going forward is correct.)
  - **Latent bug #2 fixed — reopen phantom.** Reopening a routine task left its `completed_history` stamp behind, so the grid kept showing the day done. New `uncompleteRoutine(id, ymd)` in `useRoutines` removes one same-day entry; `handleUncomplete` (and the Wallaby `onCompleteTask` reopen branch) call it — ordinary routines always, stacks only when the cleared cycle is being un-cleared (mirrors the last-member stamp rule).
  - **Stacks now expand to member rows on Home.** A stack routine in the Home daily "Habits" list renders one checkable row per spawned member task (grouped under a title + `done/total`), each routed through the real task path (`onCompleteTask`) so the 20%-on-clear bonus and the lone last-member history stamp stay correct. If the cycle isn't spawned yet (today only), a "Start stack · N items" row spawns it via the new `onSpawnStackToday` callback. `HabitsView` still shows a stack as one grid card (cleared-cycle history). New `.wb-home-stack-*` styles in `HomeView.css`.

---

## 2026-06-07

- fix(ui): Wallaby — three post-promotion bug fixes (snooze leak / notif scroll / Spaces gate) [S]
  - **Routine spawns showing before their trigger time** (Home + Tasks): the Wallaby `HomeView` daily list and `TasksView` Upcoming list filtered on active status but never excluded snoozed tasks — so routine-spawned tasks waiting on a `trigger_time` (snoozed until, e.g., 8pm) and "set aside" tasks surfaced hours early. Both now exclude `isSnoozed(task)` (shared `store.js` helper), matching the standard v2 list, which keeps snoozed tasks out of the active sections. Verified headless: a task due today but snoozed +3h is absent from Home and from the Upcoming count.
  - **Weird scrolling in Notifications**: `.wb-notifs` used `min-height: 100vh`, but the surface scroll container already sits below the 52px header — so the content was 52px taller than its container and even an empty notifications list scrolled ~52px of dead space. Changed to `min-height: 100%` (fills the surface exactly) + `overflow-wrap: anywhere` (defensive against long bodies). Verified: scrollHeight now equals clientHeight (no phantom scroll).
  - **Wallaby gate not holding in the Standard Spaces hub**: `SpacesHub` listed the four Wallaby-native surfaces (Dashboard/Habits/Tasks/Goals) as launcher rows. They're unreachable in Wallaby (the shell covers the hub) and conceptually wrong in Standard, so they leaked Wallaby views into the Standard theme. Removed those four rows (+ now-unused icon imports and `onOpen*` props at the `AppV2` callsite); the hub is back to Projects / Routines / Knowledge. The dead `.v2-habits-overlay` blocks remain as documented unreachable fallback. Verified: Standard hub renders exactly `[Projects, Routines, Knowledge]`.

- chore(release): delete `wiki/wallaby-reference/` ahead of prod promotion [XS]
  - Removed the 9.9 MB of external loggd reference PDFs/screenshots (+ the 2026-06-07 feature-request shots) — they must not ship to prod, per the dev→main ritual. Recoverable from git history. Doc links updated to note the removal.

- fix(ui): Wallaby — de-pill the shared modals too (Snooze/WhatNow/Confirm/…) [S]
  - New `src/v2/wallaby/shared.css` (via `AppV2.css`) Wallaby-gates the **shared** v2 components reachable from Wallaby. Most of their pill controls use the `--v2-radius-pill` token, so it's redefined `999px → 10px` for `:root[data-ui="v2"][data-theme^="wallaby"]` — de-pilling Snooze, WhatNow, Reframe, ConfirmDialog, Suggestions, Packages, Settings (segmented + buttons), Adviser, etc. in one shot. **Toggle switches are protected** (`.v2-settings-toggle-track` restored to a pill track — a switch isn't a "pill"). Literal-`999px` stragglers handled too: `.v2-stack-bonus` / `.v2-form-date-preview` → 10px; indicator bars (`.v2-analytics-dow/-bd-track/-fill`, `.v2-badge-progress`, `.v2-edit-checklist-progress`) → 4px. Verified: token = 10px in Wallaby, toggle track = 999px, Settings segmented controls render as rounded squares.

- fix(ui): Wallaby — zero pills (de-pill every surface) [S]
  - Per user "Wallaby should have zero pills": swept all `border-radius: 999px` → `10px` rounded squares across every Wallaby surface — segmented controls (Tasks Upcoming/Backlog/Done, Habits Single/Month/Year, Profile Tasks/Points, Analytics Overview/Tasks/Habits + range/metric), tags/label chips, counts/badges (streak chip, section counts, habit counts, "Soon"/"Today" badges, header notification badge), goal chips. Progress bars softened to 4px (clearly non-pill). **True circles preserved** (avatars, the date circle, week dots, round checkboxes at 50%). Combined with the earlier editor de-pill, Wallaby now has no pill-shaped controls. (Shared modals like Snooze/WhatNow keep their own v2 styling — sweep on request.)

- fix(ui): Wallaby editors use rounded-square controls, not iOS pills [XS]
  - The task editors' config controls were fully-rounded **pills** (999px) while the rest of Wallaby's cards/buttons (and the editors' own More-options/Delete buttons) are rounded **squares** (10–18px) — inconsistent. De-pilled both: the chip quick-editor (`.wb-edit-chip` / `-opt` / `-tag` → 11px) and the full editor's controls (`forms.css`: `.v2-form-seg` / `-energy-pill` / `-label-pill` / `-ai-pill` / misc edit chips → 10–11px). Now matches the Wallaby button/card language. (User: "More options still has the rounded pill look … so does the edit menu itself … doesn't the rest use rounded squares?")

- fix(ui): Wallaby re-skin the full task editor + fix DUE/PRIORITY clipping [M]
  - The full `EditTaskModal` (reached via the chip editor's "More options", and used for projects/subs + the Add modal) inherited Wallaby surface tokens but its **active states were still white** (`--v2-text`) — "barely even reskinned." New `src/v2/wallaby/forms.css` (gated `[data-theme^="wallaby"]`, via `AppV2.css`) brings every shared v2 form control into the Wallaby language: segmented pills (Status/Size/Energy-drain) → navy card with **green active** (was white), energy-type pills → purple-tint active, inputs/textareas/selects → card surfaces, AI pills (Auto/Research/Infer) → purple chips, primary action → green / danger → red, checklist progress → green. Fixes Add + Edit in one go.
  - **DUE/PRIORITY clipping** (regression from the NL-date `DateField` redesign): the date field's text input imposed a ~20ch intrinsic width that overflowed its grid cell and covered the priority button ("Normal" → "rmal"). Fixed the shrink chain in `DateField.css` — `.v2-form-date-field { min-width: 0; max-width: 100% }` + `.v2-form-date-text { flex: 1 1 0 }`. Global (all skins). Verified: DUE = 165px in-column, PRIORITY "Normal" full.

- feat(ui): Wallaby task editor in loggd chip language (`WallabyEditTask`) [L]
  - Review-pass req #1. The Wallaby Edit-task surface no longer uses rows of v2 white segmented pills — new `src/v2/wallaby/WallabyEditTask.{jsx,css}` rethinks it in loggd's language: large title, "Add details or notes…" textarea, "+ Add subtask…", and the core config as **chips with dropdown carets** — Status · Due · Priority · Energy (+drain) · Size · Tags — each expanding an inline picker. Footer: **More options** (→ full editor) + Delete.
  - Reuses `useTaskForm` and the **same partial-save autosave contract** as `EditTaskModal` (updateTask merges, so advanced fields it doesn't manage are preserved); status changes route through `onStatusChange` (completion/chain-break/trello intact). `AppV2` renders it for regular tasks in Wallaby mobile via `useWallabyEditor`; **projects/subs and "More options" fall back to the full `EditTaskModal`** (still owns gcal duration, knowledge links, project link, follow-ups, attachments, research, weather, wake-me). Standard/Terminal/desktop unchanged.
  - Verified headless: chips render with live values; energy picker shows types + drain; editing notes + picking energy **persists to the server** (partial merge — no clobber).

- feat(ui): Wallaby header avatar → growth arrow + streak day-count in Pulse [S]
  - **Header avatar** (`WallabyHeader`): the plain gradient dot now holds an **up-and-right arrow** (`TrendingUp`) — it opens Profile/"Your year", so a growth arrow fits (no real users). (Review-pass req #3.)
  - **Today's Pulse streak-at-risk** (`HomeView`): the row now names the habit AND shows the streak length, loggd-style — "🔥 **take meds** streak at risk (4 days)" — leading with the longest at-risk streak (`+N more` when several). Uses the already-computed `currentStreak`. (Review-pass req #2.) Verified headless.

- docs: capture 2026-06-07 review-pass feature requests + reference [XS]
  - Saved 5 reference shots to `wiki/wallaby-reference/feature-requests-2026-06-07/` and recorded three paused requests in `wiki/Wallaby-Ideas.md` so they're not lost: (1) **Edit-task modal redesign** into loggd's pill-chip language (real work); (2) **streak-with-day-count** in Today's Pulse (new, easy); (3) **header avatar → ↗ arrow** (easy). No code changes — paused per user.

- feat(analytics): tabbed AnalyticsModal — Overview / Tasks / Habits (all skins) [M]
  - The single long-scroll AnalyticsModal is now organized into three tabs (shared component, all skins): **Overview** (summary + daily completions + 52-week heatmap + Achievements), **Tasks** (by day of week + Balance radar + by tag/energy/size + adaptive-throttle decisions), and a new **Habits** tab — per-routine completion (count, current streak 🔥, last-done, bar relative to the busiest) derived from `routine.completed_history`, no new endpoint. Range + metric controls stay above the tabs. Implemented by gating existing sections on the active tab (no reorder), so it's low-risk. Base tab styling in `AnalyticsModal.css`; Wallaby override → green segmented control. Focus/mood tabs intentionally omitted (deferred features). Verified headless: tab switching shows the right sections; Habits shows 7 routines with full names.

- feat(ui): swipe-to-reveal actions on Wallaby task rows [S]
  - Brings the Wallaby `TasksView` rows to parity with the v2 TaskCard: swipe a row left to reveal **Done/Reopen** (green) + **Delete** (red). Extracted the v2 TaskCard's gesture into a shared `src/hooks/useSwipeActions.js` (offset/threshold/vertical-cancel, returns `{x, open, swiping, close, handlers}`) and wired it into the Wallaby `TaskRow` (actions panel behind, row slides on `translateX`). Tapping the row still opens the action sheet; an open swipe closes on body tap. Verified headless (touch-emulated): drag-left settles at `translateX(-132)` with Done/Delete revealed. (Standard skin already had swipe via the v2 TaskCard.)

- feat(tasks): natural-language due dates in the shared DateField (all skins) [M]
  - The due-date field now accepts typed natural language — "tomorrow", "next tue", "in 3 days", "fri", "next week", "6/9", or a raw `YYYY-MM-DD` — parsed locally by `src/utils/parseNaturalDate.js` (pure, dependency-free, **no AI/network**). A live "→ 2026-06-19" preview shows while typing; Enter/blur commits (unparseable input reverts). A calendar button still opens the native date picker (overlaid `<input type=date>` at opacity:0 for reliable iOS-PWA tap). `DateField` rewritten (text input + cal button); the parsed-preview wraps to its own line so the control stays usable in the half-width DUE column. Used by Add + Edit task modals → works in every skin. Verified headless: parser unit-checked (today/tomorrow/in N/weekday/next-weekday/M-D/ISO), and in-modal typing "next fri" → preview + commit to the ISO date.

- feat: local Badges / Achievements (self-derived, all skins) [M]
  - 12 achievements computed entirely from data the app already tracks — **no new schema/endpoints**: lifetime done, best/longest streak (`computeStreak`/`computeRecords`), best-day tasks/points, top habit completion count, total points + longest active-day run (from `/api/analytics/history`). Badges: First Step, Getting Going (10), Century (100), 500 Club, Week Warrior (7-streak), Fortnight (14), Monthly Master (30), Consistent (active 7 days straight), Big Day (10/day), Point Storm (100 pts/day), Habit Former (habit ×30), Point Collector (1,000 pts). Bronze/silver/gold tiers.
  - Shared, theme-agnostic: `src/badges.js` (`computeBadges`) + `src/v2/components/BadgesGrid.{jsx,css}` (earned in tier color, locked dimmed with a progress bar, "N/12 earned"). Surfaced in the shared **AnalyticsModal** (all skins — fed `tasks`/`routines`/`records`/`streak` from AppV2) and the Wallaby **Profile** (new Achievements section). Verified headless: 3/12 earned render correctly from seed.
  - Out of scope (deferred, keeps it no-fork): persisted "seen" set + earn-celebration toast.

## 2026-06-06

- chore(ui): turn OFF Terminal theme (not ripped out) [S]
  - Wallaby is the daily driver, so Terminal is removed from the Settings theme picker (only **Standard / Wallaby** remain). Existing terminal users migrate **terminal-dark → wallaby-dark, terminal-light → wallaby-light** at three points: `loadSettings()` (store.js), the `index.html` pre-paint script (no first-frame flash), and the AppV2 mount effect (via `loadSettings`). **All terminal code stays in place** — `src/v2/terminal/`, `useTerminalMode`, `terminalTitle`/`terminalCommand` props, `check:terminal-titles` — so it's reversible (re-add the picker option + drop the two shims). The full "didn't stick" rip-out is NOT done. Verified headless: `terminal-dark` in storage → renders `wallaby-dark` (+ WallabyShell); picker shows only Standard/Wallaby.

- feat(ui): Wallaby nav per-tab active colors + More cleanup + Analytics segments [S]
  - **Bottom nav** — each tab lights up its **own** color when active instead of a single shared green: Home blue, Habits green, Quokka purple, Tasks orange, More pink (`--nav-color` inline var per tab → `.wb-nav-tab.is-active`). (User: "each of the buttons on the bottom menu to be a different color when highlighted.")
  - **More menu** — Timer / Vision / Daily check-in rows **removed entirely** (deferred features, no "coming soon" placeholders). More now lists Profile / Goals / Analytics / Packages / Settings. Dropped the dead `Placeholder` component + `sub==='timer'` branch + unused icon imports.
  - **Analytics selectors** — the range (7d/30d/90d/1y/All) and metric (Tasks/Points, Balance Tags/Energy) toggles were small left-floating pills with dead space; reskinned to **full-width segmented controls matching the Tasks header** (`.wb-tasks .wb-seg`: contained pill track, subtle card-3 active fill). (User: "selectors at the top look awkward" + "use the way tasks does this for analytics.")

- ci: route Docker base-image pulls through mirror.gcr.io (fix flaky builds) [XS]
  - The Docker build kept failing on `node:22-alpine` pulls from `registry-1.docker.io` (`i/o timeout` / `DeadlineExceeded`) — a recurring GitHub-runner ↔ Docker Hub connectivity flake (3× in one session), unrelated to app code. Fix: `setup-buildx-action` now sets a buildkitd registry **mirror** (`docker.io → mirror.gcr.io`, Google's reliable mirror of Docker Hub official images). Falls back to docker.io if the mirror lacks an image. Applied to **both** the dev and prod workflows; the dev one also now runs buildx on **PR builds** (previously non-PR only, so PR builds pulled straight from Hub).

- fix(ui): Wallaby Quokka — Chats + New chat as top icon buttons [XS]
  - The Chats / New-chat controls sat in a full-width band below the title, eating vertical space. In Wallaby they're now compact **icon buttons pinned to the title row** (top-right), matching the Tasks header: **Chats → search magnifier** (`wb-icon-btn`, the same icon Tasks uses), **New chat → purple `+`** (`wb-icon-btn-accent`). (User: "Put chats and new chats at the top with the same search icon from tasks.") `AdviserModal` swaps to icon buttons via `useWallabyMode()`; `modals.css` absolute-positions the toolbar top-right (it lives in the non-scrolling flex body, containing block `.v2-modal`, so it pins cleanly). Non-Wallaby keeps the labeled pills. Tapping the magnifier still opens the chat history list.

- fix(ui): Wallaby full-screen modals use a back arrow, not a dismiss X [S]
  - Full-screen Wallaby pages (Packages/Analytics/Settings/Edit/Add/Snooze/…) showed the ModalShell dismiss **X** (top-right). But they're pages you navigate *into* (Packages/Analytics/Settings from More), so the consistent affordance is a **back arrow** (top-left), matching the drill-down views (Profile/Goals/Notifications). (User: "Packages has this x instead of the back arrow.") `ModalShell` now swaps `X → ArrowLeft` when `useWallabyMode() && !useIsDesktop()` (new `useWallabyMode` hook mirrors `useTerminalMode`; button gets class `v2-modal-back`); `modals.css` positions it top-left styled like `.wb-back` and drops the title below it. Non-Wallaby/desktop keep the X. Quokka still has no affordance (tab). Verified headless: Packages/Edit → back arrow top-left (x=16, aria=Back); Quokka → hidden.

- fix(ui): Wallaby — no close X on Quokka (it's a nav tab, not an overlay) [XS]
  - Quokka is the shell's *surface* for the Quokka nav tab, but it still showed the ModalShell close X top-right — a vestigial overlay affordance (you leave a tab via the bottom nav, not an X). Hid it via `[data-theme^="wallaby"] .wb-shell .v2-modal-close { display: none }` in `modals.css`. The full-screen **overlay** modals (Edit/Add/Settings/Packages/Analytics/…) keep their X — they cover the nav, so the X is their only way back. Verified headless: Quokka close = `display:none`, Edit modal close = `display:flex`.

- docs: add Local-Verification-Harness runbook (build + headless-screenshot in-session) [S]
  - `wiki/Local-Verification-Harness.md` documents the reproducible workflow for spinning up a real server inside a session and driving it headlessly: matching-`APP_VERSION` build (or the version-mismatch update overlay blocks all clicks), seeded background server, theme injection via `localStorage` (full settings blob + far-future `boom_last_modified`), puppeteer run from repo root with `domcontentloaded` (SSE never idles) + in-page `.click()` (fixed elements mis-fire on `elementHandle.click`), `elementFromPoint` layering diagnostics, and a Gotchas table (each entry cost a debugging loop). Linked from CLAUDE.md.

- fix(ui): Wallaby overlay modals are true full-screen pages (no click-through) [S]
  - Overlay modals opened on top of the shell (Edit/Add/Settings/Analytics/Packages/Snooze/…) used to pin between the WallabyHeader and a hardcoded `bottom: 64px` nav offset. But the nav is **content-sized** (no fixed 64px height), so a clickable strip of the Home surface showed through below the overlay, and the header/nav stayed interactive *behind* the "page" — taps leaked to Home, and the only way back was the X. (User: "stuff that used to be drawers still hijack the screen so clicking on items in the home row does things behind it … partial page partial drawer … I have to click close in the upper right.")
  - Fix: in `modals.css`, overlay modals (rendered by `AppV2` as siblings of `.wb-shell`) now get `inset: 0` — a **true full-screen takeover** covering header + nav, so nothing behind is reachable; close X returns you. Header row picks up the notch/safe-area inset since it now starts at the top. **Quokka** (`.wb-shell .v2-modal-overlay`) is exempted — it's the shell's *surface* for the Quokka tab, so it keeps the header + nav (you leave it via the nav). Verified headless: Edit modal covers y=40…835 (was leaking nav/header); Quokka keeps both.

- fix(ui): Wallaby Home — readable date when today is the selected day [XS]
  - In the Home week strip, when **today was also the selected day** the date number rendered green-on-purple (the `is-today` green-text rule overrode the `is-selected` white-text rule by source order) — unreadable. Added a higher-specificity `.is-selected.is-today` rule keeping the number white. Found during a full headless QA sweep of every Wallaby surface (no other defects: no crashes/React errors; desktop correctly falls back to Kanban).

- feat(ui): Wallaby reskin polish — Home daily-summary card + Profile Records [S]
  - **Home "Daily summary" card** (`HomeView`, today only): a backward-looking recap below Today's Pulse — `N tasks · M habits done today` headline, a day-streak chip, and a **mini 14-week activity heatmap** (reuses `ContributionHeatmap`, fed by `/api/analytics/history?days=98` so it survives task retention). Deep-work hours stay omitted until the Timer lands. `streak` now threads `WallabyShell → HomeView`.
  - **Profile "Records" section** (`ProfileView`): a 3-card strip between the stat pills and the Activity year-grid — **Best day** (tasks), **Best points**, **Longest streak** — all from the `records` prop (`computeRecords`), no new data.
  - Both are Wallaby-scoped components, additive, reuse existing primitives/data. Verified headless (wallaby-dark, 390px): summary card + records strip render with real seeded data.

- feat(dev): dev-only "Reseed dev database" button (Settings → Data) [S]
  - One-tap reseed without touching a terminal: **Settings → Data → "Reseed dev database"** wipes the DB and reloads fresh seed fixtures (tasks rebased to today + ~250 days of synthesized routine history), then reloads the app. Confirm dialog first; no undo.
  - **Hard-gated to dev, two layers:** `server.js` computes `isDevEnv` (true only when `APP_VERSION` is `dev` or `dev-<sha>` — prod images build `v1.x.x` git tags) and (1) exposes `isDev` on `GET /api/health` so the button only renders on the dev build, and (2) makes `POST /api/dev/seed` return **403** outside dev. So even a stale client pointed at prod can't wipe it.

- feat(ui): Wallaby — all modals render as full pages, not slide-up sheets [S]
  - New `src/v2/wallaby/modals.css` (mobile + `[data-theme^="wallaby"]` gated, imported via `AppV2.css`): **every** ModalShell surface (Packages, Settings, Analytics, Edit, Add, Quokka, …) now renders as a solid full **page** that sits between the persistent WallabyHeader (top: 52px + inset) and WallabyNav (bottom: 64px + inset) — no slide-up sheet, no animation, no rounded card chrome. (User: "the wallaby theme shouldn't have the slide up menus. Everything should have its own page.") The Quokka branch in `WallabyShell` now relies on this global treatment instead of the bespoke `.wb-quokka-page` chrome-stripping (removed) — the header/nav splits that looked strange are gone because the surface no longer double-stacks an inline page inside a stop-at-nav surface.
  - **Analytics buttons fix:** the range (7d/30d/90d) and metric toggles were loose pill buttons; reskinned to **contained segmented controls** (rounded track on `--wb-card-2`, green active fill) in `analytics.css`.

- feat(ui): Quokka is its own page; nav swap; idle icon [S]
  - Quokka moved to the **center** nav slot (Home · Habits · **Quokka** · Tasks · More) and is now **its own page** instead of a pop-up: selecting the tab renders the adviser inline in the shell surface (`.wb-quokka-page` strips the ModalShell chrome; the surface stops above the nav so the composer clears it). Its icon is muted when idle and green when active **like every other tab** (dropped the always-purple). `WallabyShell` takes `adviser`/`onOpenEasterEgg`; the AppV2 adviser modal stays for non-Wallaby.

- chore(dev): seed covers all timelines (rebased to today + rich habit history) [S]
  - The static `seed-data.json` was frozen at Jan–Apr, so recent views (heatmaps, Today's Pulse, Analytics 7d/30d) rendered empty. `seed.js` `makeSeedCurrent()` now, at seed time: (1) **rebases every task date** so the latest completion lands today (overdue stays overdue, upcoming stays upcoming); (2) **synthesizes rich cadence-based routine history** spanning ~250 days up to today (daily habit → ~188 entries Sep→today; weekly → ~24). So dev data covers all timeframes. Dev-only; benefits every skin.

- feat(ui): Wallaby Analytics visual reskin + reachable from More [S]
  - `src/v2/wallaby/analytics.css` (Wallaby-gated, via AppV2.css): visual reskin of the existing AnalyticsModal — sections → navy cards, the summary "big number" → its own card with a **green** hero value, range/metric toggles → green active, chart fills (daily bars / DOW / breakdown) → Wallaby purple. All of Boomerang's analytics preserved (daily, by-day-of-week, balance radar, by-tag, by-energy, heatmap). Added **More → Analytics** (`onOpenAnalytics` → existing `showAnalytics`). Standard/Terminal untouched.

- feat(ui): Wallaby Home → "Today's Pulse" (per-day content) [M]
  - Makes the clickable calendar meaningful — the whole Home now reflects the **selected day** (loggd today-page, `d35f6ec0`/`bd6d7aa6`). New: a **Today's Pulse** card (today only — streak-at-risk · "N habits left (x/y done)" · "N tasks for today"), a **Tasks card** (the day's tasks: due/carrying on today, due-or-completed on past days, with checkbox/reopen, overdue + label chips, and an `n/m done` progress bar), and the **Habits card** (the day's completion + per-habit streak). Selecting a different day swaps the tasks + habit states + counts; past days drop the pulse card.
  - `HomeView` now takes `tasks`/`labels` + `onCompleteTask`/`onOpenTask` (threaded via `WallabyShell`). Reskin — existing data only; mood/vision/deep-work/year-grid parts stay deferred. Public-Profile sub-tab intentionally omitted (per user).

- feat(ui): Wallaby Settings visual reskin (notifications "fire") [S]
  - `src/v2/wallaby/settings.css` (imported via AppV2.css, gated `[data-theme^="wallaby"]`): visual-only reskin of the existing SettingsModal — **every Boomerang setting + tab preserved**. Tabs → single scrollable row with a green underline on the active tab; `.v2-settings-block`s → grouped navy cards; toggles → loggd **green** when on; segmented controls → green active; inputs/buttons → navy surfaces. **Notifications** get the standout treatment: a CHANNELS card + per-type cards on the elevated surface with Push/Email/Pushover toggle tiles. Standard/Terminal untouched.

- fix(ui): Wallaby header rebrand + nav/menu placement + font + FAB [S]
  - **Header**: real Boomerang branding back — the bouncing `BOOMERANG` wordmark (reuses the global `.v2-header-wordmark` + sync-bounce, wired to `syncStatus`/`queueLength`) with the **`Logo` to the right of the text**. Header actions: **Quokka** (Sparkles) + bell + avatar.
  - **Placement per user**: **Quokka stays in the top header**; **Timer + Packages moved into the More menu** (Packages → the real PackagesModal; Timer → "coming soon" placeholder). Bottom nav is now **Home · Habits · Tasks · More** (Timer removed).
  - **Font**: dropped Wallaby's Inter override — inherits the v2 typography (Syne display / DM Sans body) per preference.
  - **FAB fix**: the Habits/Tasks `+` FAB had `z-index:20` (below the nav's `z-45`) so the nav clipped it; raised to `z-47` and `bottom: calc(80px + safe-area)` so it floats clear.
  - Note: **"Habits" is a display label for routines** — no data change; same `routines`/`completed_history`. Standard/Terminal still say "Routines."

- feat(ui): Wallaby Home calendar is interactive [S]
  - The Home date hero + week strip were inert. Now: tap a **day** to select it (purple highlight); the habit rows reflect that day's completion and the check **toggles/backfills** that day (`onToggleHabit(routine, ymd)` → adds/removes a local-noon `completed_history` entry). **Week navigation** via ‹ › chevrons (future days disabled). Tapping the date hero (or the "Today" pill that appears off-today) jumps back to today. Streak-at-risk banner only shows when today is selected.

- feat(ui): Wallaby Tasks refinements + QA pass (header overlap, home check) [M]
  - **Tasks** (loggd `IMG_1581` + `task-action-sheet`): 3rd **Done** tab (Upcoming/Backlog/Done with counts); **TODAY/TOMORROW** grouping with section icons (Overdue/Today/Tomorrow/Upcoming/Anytime); **semi-random per-task checkbox colors** (cycled by id hash — not priority/label, per direction); notes subtitle line; **task tap → action sheet** (Reschedule Today/Tomorrow/Next week/No date · Edit · Delete · Focus-timer "Soon"). Reschedule → `updateTask({due_date})`, Delete → `deleteTask`.
  - **QA — bugs found + fixed:**
    - **Home habit check did nothing** (felt unclickable): the toggle handler called `store.localYMD(isoString)` but that helper needs a `Date` → `getFullYear is not a function` threw and aborted silently. Wrapped in `new Date(ts)`. Toggle now logs/clears today's completion + advances the streak.
    - **Header overlapped the status bar in PWA standalone:** the header set `env(safe-area-inset-top)` as *bottom* padding and didn't add it to its height. Now `height = bar + inset`, `padding-top: inset` (box-border) so brand/bell sit below the notch.
    - **Done-tab checkbox re-completed instead of reopening:** wired the Tasks checkbox to be status-aware — `task.status === 'done' ? uncompleteTask : handleComplete`. Clicking a completed task now reopens it.
  - Interaction sweep (headless): 12/12 surfaces/affordances pass (nav tabs, habit check, Tasks grouping/colors/Done/action-sheet, habit-card→detail, bell→notifications, avatar→profile, More→Goals).

- docs(wallaby): capture loggd reference assets + full feature catalog [S]
  - loggd.life blocks automated fetch, so durably committed the reference into `wiki/wallaby-reference/` (6 clean app-export PDFs + 16 downscaled screenshots, ~3.5MB, indexed by README). Expanded `wiki/Wallaby-Ideas.md` with the complete Help-Center feature catalog (Notes, Focus Timer modes, Vision's 6 exercises, Goals Life Areas + auto goal-tags, habit scheduling types, XP/12-tiers/badges/feature-unlocks, Community, 3-level privacy, Free/Pro). Added the **all-skins principle**: net-new features are theme-agnostic (shared app layer, every skin) — and that boundary is the reskin→fork line.

- feat(ui): Wallaby top header + notifications center [M]
  - **What.** Persistent Wallaby top app bar (`WallabyHeader`): brand wordmark + 🔔 bell (unread badge) + avatar, above every shell surface. Bell → `NotificationsView` — a loggd-style notifications center that reads Boomerang's **existing** `GET /api/notifications/log`: All/Unread tabs, grouped Today/Yesterday/Earlier, type-colored icons (overdue/stale/pileup/package/weather/quokka), channel + time-ago, unread dots, optimistic Mark-all-read. Avatar → Profile.
  - **Wiring.** `WallabyShell` fetches the log once for the badge + center; header offsets the surface (`--wb-header-h`). Home's redundant date-hero avatar removed (header owns it).
  - **Scope.** Reskin — reads the existing log; no new data. (Reliable read-state persistence + the underlying notification-delivery bug are backend follow-ups, flagged separately.)
  - **Verification.** Real app: header brand/bell/avatar over Home; center renders grouped real-typed entries with the right icons.

- feat(ui): Wallaby habit detail + month calendar; Habits Single/Month/Year [M]
  - **What.** Tapping a Habits card opens the **habit detail** (loggd `IMG_1586`): icon + cadence, description, **Streak / Best / Total** stat cards, a "logged today" pill, a **month calendar** of completions (‹›  stepper + "N days completed / X%"), and **Archive / Delete** (two-tap). Edit (pencil) opens the routine editor.
  - Habits range tabs are now **Single / Month / Year** (per direction): Single = rolling heatmap **with per-card month labels**, Month = calendar grid, Year = full 53-week heatmap. Cards are tappable. Added `longestStreak` to `heatmapUtils`.
  - **Wiring.** `HabitsView` manages list↔detail internally; detail actions thread through `WallabyShell` → `AppV2`: Edit → routine editor (`setEditRoutineId`+`setShowRoutines`), Archive → `togglePause`, Delete → `deleteRoutine`. **Reskin only** — reads `completed_history`, no new data.
  - **Verification.** Rendered via the harness: detail (Streak/Best/Total + month calendar), Single with month labels, Year heatmap.

- feat(ui): Wallaby bottom-nav shell + Home daily agenda [L]
  - **What.** The loggd IA. `WallabyShell` + `WallabyNav` give Wallaby mode a 5-tab bottom nav — **Home · Habits · Tasks · Timer · More** — over the active surface. New `HomeView` (loggd `IMG_1582`): date hero + week strip, streak-at-risk banner, today's habits as checkable rows (per-habit color check toggles today's `completed_history`). **More** routes to Profile + Goals and shows deferred-feature placeholders (Timer, Vision, Daily check-in) — those features land after the reskin per scope.
  - **Integration.** `AppV2` renders `<WallabyShell>` (z-40, covers header/list) when `isWallaby && !isDesktop`, and skips the standard `BottomTabs`. Shared modals (Edit/Add/Settings, z-100) still open above the shell. Habits/Tasks/Profile/Goals are now reached as nav tabs / More entries rather than the interim Spaces rows.
  - **Scope.** Reskin-only: net-new features (Timer logic, Vision, Daily mood-journal, XP/levels/achievements) are deferred — placeholders for now.
  - **Verification.** Driven through the real app in wallaby-dark: Home renders the daily agenda + week strip, all 5 tabs switch, More lists Profile/Goals/Settings + Coming-soon Vision/Daily.

- feat(ui): Wallaby Goals surface (projects as goals) [M]
  - **What.** Fourth Wallaby surface (loggd `IMG_1572`): `src/v2/wallaby/GoalsView.{jsx,css}`. A goals list (project cards with category chip + gradient progress bar + sessions/steps meta) and a goal **detail** with a big metric card (steps-complete or sessions-logged, progress bar, budget), a "Why this matters" notes block, and the full **semantic action button** set — orange *Log session* / slate *Edit goal* / green *Complete* / yellow *Set aside* / red *Delete* (two-tap confirm).
  - **Mapping.** Boomerang projects → goals. Progress prefers child-step completion (`done/total` of `parent_id` children), falling back to `session_count` toward the 10-session cap. Budget via `computeProjectBudget`. Category chips from `tags` → labels; target from `due_date` (else "Ongoing").
  - **Wiring.** Reachable via **Spaces → Goals** (`onOpenGoals` overlay + escape-stack entry in `AppV2`). Log session → `logProjectSession`; Complete → `handleComplete`; Edit → `EditTaskModal`; Set aside → `updateTask({status:'backlog'})`; Delete → `deleteTask`.
  - **Verification.** Driven through the real app against a created project (Spaces → Goals → detail shows `1/3 steps`, sessions, notes, and the semantic buttons).

- feat(ui): Wallaby Profile/dashboard surface + heatmap fit-to-width [M]
  - **What.** Third Wallaby surface (loggd `IMG_1574`): `src/v2/wallaby/ProfileView.{jsx,css}`. Gradient avatar + "Your year" header with contribution count, a horizontally-scrollable row of **colorful stat pills** (day streak / points today / done today / best streak / lifetime done), an **Activity year-grid** (53-week contribution heatmap, Tasks/Points toggle, fed by `/api/analytics/history?days=365`), and per-habit grids below.
  - **Heatmap fix.** `ContributionHeatmap` now fits its container width (cells size purely by `width:100% + aspect-ratio`, fixed `height` dropped) and month labels position by `index/weeks %` — so the full 53-week year fits without horizontal scroll and labels stay aligned at any week count. Improves the Habits heatmaps too.
  - **Wiring.** Reachable via **Spaces → Dashboard** (`onOpenProfile` row in `SpacesHub`, `showProfile` overlay + escape-stack entry in `AppV2`). Stat values come from AppV2 (`dailyStats`, `streak`, `records`, `lifetimeDone`, `routines`); the year history is fetched inside `ProfileView`.
  - **Verification.** Driven through the real app (Spaces → Dashboard in wallaby-dark renders live stats + the year-grid + per-habit grids).

- feat(ui): Wallaby Tasks surface, wired into the app [M]
  - **What.** Second Wallaby surface (loggd `IMG_1575`): `src/v2/wallaby/TasksView.{jsx,css}`. Segmented **Upcoming / Backlog**, tasks grouped (Overdue / Today / Upcoming / Anytime), **pink square checkboxes** (orange for high-priority), colored label chips resolved from `tags` → labels, overdue/today due meta, **nested checklist items** as circular sub-checkboxes (completed = filled green + strikethrough), search filter, green FAB.
  - **Wiring.** Reachable via **Spaces → Tasks** (`onOpenTasks` row in `SpacesHub`, `showTasks` overlay + escape-stack entry in `AppV2`). Checkbox → `handleComplete`; subtask toggle → `updateTask({ checklists })`; row tap → `EditTaskModal`; FAB → AddTaskModal. Fed by live `tasks` + `labels`.
  - **Verification.** Screenshot-driven through the real app (Spaces → Tasks in wallaby-dark renders 42 live tasks with correct grouping, chips, and nested checklist toggles). New file under `src/`, ships via Vite bundle — no Dockerfile change.

- feat(ui): Wallaby design language — Habits surface, wired into the app [L]
  - **What.** First surface of a full IA remap toward the loggd.life reference: a deep-navy, heatmap-first dashboard language named **Wallaby**. Adds the theme + the **Habits** screen (Boomerang routines rendered as loggd-style habit cards), selectable via Settings → General → Theme → **Wallaby**, reachable via **Spaces → Habits**.
  - **Integration.** `wallaby-dark` / `wallaby-light` registered in the three theme sync points (`index.html` pre-paint, `AppV2.jsx` mount effect, `SettingsModal` picker — now a Standard/Terminal/**Wallaby** family toggle). `palette.css` imported via `AppV2.css`. `HabitsView` mounts as a full-screen overlay (`.v2-habits-overlay`, back button) fed by live `useRoutines` routines; new `onOpenHabits` row in `SpacesHub`; `showHabits` added to the escape stack. Base `--wb-*` defaults defined for every v2 theme so the surface always resolves its tokens.
  - **New `src/v2/wallaby/`.** `palette.css` — two palettes (`wallaby-dark` flagship + `wallaby-light`) that override the shared `--v2-*` tokens and add structural `--wb-*` tokens (card surfaces, per-habit category accents blue/purple/green/orange/pink, heatmap cells, semantic action colors orange=primary/green=complete/yellow=pause/red=delete/slate=secondary, colorful FABs). `ContributionHeatmap.{jsx,css}` — GitHub-style grid (weeks × 7 days, local-time bucketing, per-color intensity). `heatmapUtils.js` — day bucketing, per-habit color cycling, streak, week/month helpers. `HabitsView.{jsx,css}` — the screen: heavy grotesk "Habits" title, Single/Week/Month segmented control, week + month date steppers, habit cards (color icon tile + title + streak/count badges + the grid), purple FAB. Each habit gets a distinct color by list index.
  - **Verification.** Rendered in isolation via `wallaby-preview.html` + `src/wallaby-preview.jsx` (dev-only harness, mock routine data) and screenshot-checked against IMG_1573 (Single) / IMG_1577 (Week). Not imported by `index.html`, so it does not affect the running app or ship to prod.
  - **Verification.** Built + screenshot-driven through the real app (Spaces → Habits in wallaby-dark renders the live seeded routines, paused ones filtered, weekly-cadence routines showing as single clean rows). Shipped to `dev` so it can be exercised against real routine data on `boomerang-dev:3002`.
  - **Next.** Full IA remap continues: 5-tab bottom nav (Home/Habits/Tasks/Goals/Profile) promoting Habits from the Spaces hub to a top-level tab, then Tasks/Goals/Profile/Home surfaces.

## 2026-06-04

- fix(ui): tic-tac-toe text/labels actually follow the active theme [XS]
  - **Symptom.** Title (`> tic-tac-toe`), status (`// you win!`), and buttons (`[ play again ]` / `[ close ]`) rendered in the terminal aesthetic even on light/dark themes. The earlier "follows theme" fix only theme-gated the colors, not the strings — the brackets/`>`/`//` were hard-coded in JSX.
  - **Fix.** Render the terminal-style strings only when `useTerminalMode()` returns true; light/dark themes get plain `Tic-tac-toe` / `You win!` / `Play again` / `Close`.
  - Modified: `src/v2/components/TicTacToe.jsx`, `src/v2/components/TicTacToe.css` (comment fix).

- fix(ui): WeekStrip actually updates when you win tic-tac-toe [XS]
  - **Root cause.** The two `useMemo` blocks in `WeekStrip.jsx` referenced `easterEggWins` in their bodies but didn't list it as a dependency. So when the easter-egg win prop changed, the memo kept the stale closure and the day count stayed unchanged. The earlier "fix" just passed the prop down; the memo never noticed it had changed. AppV2's stats line worked because it doesn't memoize, which is why "3/3 today" looked right while the WeekStrip still showed "2/3".
  - **Fix.** Add `easterEggWins` to both dependency arrays. The lint rule was already flagging this on every push.
  - Modified: `src/v2/components/WeekStrip.jsx`

## 2026-06-01

- feat(packages): v2 Packages modal — "Carrier site" link to the provider's tracking page [XS]
  - The v2 Packages modal never exposed a link out to the carrier's own tracking page (v1's `PackageCard`/`PackageDetailModal` both had one via `getTrackingUrl()`). Added a "Carrier site" action in the expanded package row that opens the provider page (UPS/FedEx/USPS/DHL/Amazon/OnTrac/LaserShip) in a new tab. Only renders when `getTrackingUrl()` resolves a URL for the package's carrier.
  - Files: `src/v2/components/PackagesModal.{jsx,css}` (import `getTrackingUrl` + `ExternalLink`, compute `trackUrl` per row, `text-decoration: none` so the anchor matches the other pill actions).

- fix(packages): v2 Packages modal — Track button + carrier detection both broken [S]
  - **Symptom.** In the v2 Packages modal, adding a tracking number did nothing ("Track doesn't work") and the "Detected:" line rendered blank even for an obvious UPS `1Z…` number.
  - **Cause.** Two property/signature mismatches in `src/v2/components/PackagesModal.jsx` (v1 was unaffected):
    1. `handleAdd` called `onAdd({ tracking_number, label, carrier })` with a single object, but `addPackage`/`createPackage` are **positional** `(trackingNumber, label, carrier)` — so the object itself was sent as the tracking number and the create request was malformed.
    2. The detection result from `detectCarrier()` is shaped `{ code, name, icon, trackUrl }`, but the modal read `.carrier` / `.label` (undefined) → blank "Detected:" label and carrier always fell back to `'other'`.
  - **Fix.** Call `onAdd(tracking, label || null, detectedCarrier?.code || 'other')` positionally; render `detectedCarrier.code` (CarrierLogo) and `detectedCarrier.name` (label).
  - File: `src/v2/components/PackagesModal.jsx`.

---

## 2026-05-31

- feat(routines): Stacks — one routine that fans out into several independent tasks, with a clear bonus [L]
  - **What.** A routine can now hold **members**: an "Evening" routine at 8pm spawns *start dishwasher*, *take out trash*, *refill milk* as three separate, independent task cards each cycle (vs `follow_ups`, which is a *dependent* chain). Each member is a real task scoring its own points; clearing **every** member of a cycle pays a **20% bonus** (20% of the cycle's combined member points), stamped on the task that closes the cycle.
  - **Model.** A routine is a "stack" iff `members` is non-empty. The cycle key is `(routine_id, due_date)` — members of one spawn batch share the due date. The stack re-spawn guard skips only a same-day duplicate, so a daily stack refreshes each day even if a prior cycle has leftovers (those remain as overdue cards — the "missed cycle surfaces as overdue, not a pileup" philosophy). `completed_history` is stamped (cadence + streak advance) only when the **last** member is cleared; partial completion just scores the members individually.
  - **Display.** Surfaced cycles render grouped in a mobile **StackSection** above the regular sections — header (title · time · `done/total` pip · "+N on clear"), members as indented TaskCards. Members are dropped from the active sections (Doing/Stale/Up next/Waiting) to avoid double-display; they stay in Snoozed pre-trigger (so a trigger-time stack only surfaces at its time). Desktop Kanban shows members in their natural columns (mirrors pinned-project children). The completion toast celebrates the bonus.
  - **Editor.** RoutinesModal gains an "Items (stack)" section (add/remove rows); the routine card meta shows `· N items`. Quokka `create_routine` / `update_routine` accept a `members` array, and `summarizeRoutine` exposes it.
  - **Schema.** Migration 035 adds `routines.members_json` + `tasks.stack_bonus`. Wired through `db.js` (row mappers + both UPSERTs), `src/store.js` (`createRoutine`/`createTask` defaults), `src/scoring.js` (`computeDailyStats` + `computeRecords` fold in `stack_bonus`), `src/hooks/useRoutines.js` (`spawnStackMembers`, stack-aware `spawnDueTasks` + `spawnNow` returning an array), `src/v2/AppV2.jsx` (stack grouping + bonus logic in `handleComplete`), new `src/v2/components/StackSection.{jsx,css}`, `src/components/Toast.jsx`, `adviserToolsTasks.js`.
  - **v1.** `spawnNow` now returns an array; the v1 `onSpawnNow` call site was updated. v1 RoutinesModal doesn't expose the members editor (deprecation path) but merge-updates preserve the field.
  - **Out of scope (v1):** combining a stack with `auto_roll`, and per-member follow-up chains.

---

## 2026-05-30

- ci(deploy): opt into Node 24 for all actions via FORCE_JAVASCRIPT_ACTIONS_TO_NODE24 [XS]
  - Sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` in both workflow `env` blocks so every JS action runs on the runner's Node 24, ahead of GitHub's 2026-06-16 forced cutover — clears the Node 20 deprecation warnings without guessing each action's new major version (a wrong tag would hard-fail the workflow). Reversible by removing the line. Validates on the next dev build before it ever exercises a prod publish.

- ci(deploy): retry transient Tailscale connect so a blip doesn't red-fail the build [S]
  - The prod/dev publish jobs failed the entire run when the `tailscale/github-action` connect blipped — even though the image had already built and pushed to GHCR. Added a second Tailscale attempt (runs only if the first fails); the Portainer deploy + verify steps now succeed if **either** attempt connected. Hardened the Portainer webhook `curl` with `--retry 3 --retry-delay 2 --retry-all-errors`.
  - Files: `.github/workflows/build-and-publish.yml`, `.github/workflows/build-and-publish-dev.yml`.
  - NOTE: the Node 20 action-deprecation warnings (checkout/setup-node/docker/* on Node 20, forced to Node 24 after 2026-06-16) are separate and not addressed here — tracked for a version-bump pass once the action majors are verified Node-24-ready.

- fix(routines): interval cadences recur from last completion, not a creation-date grid [M]
  - **Breaking bug.** "Every 180 days" (and other anchor-less cadences) used a fixed grid pinned to the routine's `created_at`. A routine done 91 days ago read as **due now** instead of due in ~89 days, because the last-done predated the creation anchor and the code fell back to the (past) creation date.
  - **Fix.** `getNextDueDate` now splits on `hasAnchor`: cadences with an explicit calendar anchor (weekly + weekday, month-scale day-of-month / ordinal weekday / legacy weekday) keep the fixed grid; anchor-less interval cadences (every N days, every N months, weekly/monthly with no specific day) recur as `lastDone + interval` (or `created_at + interval` if never done). Matches the user's model: explicit anchor wins, otherwise it's relative to when you last did it.
  - Verified against the real routine set (8/8): water jugs no longer due, "every Friday" / daily / weekly-Sat all still correct.
  - Modified: `src/store.js` (`addCadenceInterval` restored, `hasAnchor` branch).

- feat(routines): editable "Last done" date — repair routines that nag after lost history [M]
  - **Problem.** Routines whose `completed_history` was emptied (e.g. an old DB wipe) fire as "never done" and nag forever — and there was no way to tell the app when a routine was actually last completed. The fixed-schedule change made this visible because such routines compute as overdue.
  - **Fix.** New **"Last done"** date field in the v2 RoutinesModal edit form. Sets the most-recent completion entry (or appends one where there were none; clearing drops the most-recent), which drives `getNextDueDate` — e.g. set "Change furnace filter" to its real date and it goes quiet until next quarter instead of nagging immediately. Non-destructive: never erases older history. Time pinned to local noon so the date can't drift across timezones.
  - Quokka `update_routine` gains a `last_done` convenience field ("YYYY-MM-DD" or null) so several can be repaired by voice.
  - Modified: `src/v2/components/RoutinesModal.jsx` (`ymdLocal`, `lastDone` state, `resolveCompletedHistory`, edit-only field), `adviserToolsTasks.js` (`last_done` → `completed_history` mapping). Not data loss — completion history was always intact in the DB; this restores the ability to correct it.

- feat(routines): intelligent month-scale schedule anchor — "the 18th", "1st Monday", "last Friday" [L]
  - Monthly / quarterly / annually / custom-months routines had no day-of-month picker — they anchored to the routine's *creation day*. Now you can anchor explicitly, three ways:
    - **Day of month** — `schedule_day_of_month` 1–31 ("the 18th"). Clamped to month length (31 → Feb 28/29).
    - **Ordinal weekday** — `schedule_week_of_month` (1/2/3/4/last) + `schedule_day_of_week` → "1st Monday", "every 2nd Tuesday", "last Friday". Works for quarterly/annually too (e.g. quarterly · 1st Saturday).
    - **Creation day (default)** — no rule set falls back to the creation day-of-month.
  - Resolved on the fixed grid, so the anchor never drifts on late completion. If the rule's first slot is before `created_at` (created the 20th, rule "the 18th"), the series starts the next month.
  - Migration 034 adds `schedule_day_of_month` + `schedule_week_of_month` to `routines`. Wired through `db.js` (row mapping + upsert), `src/store.js` (`getNextDueDate` month-grid rework, `resolveMonthDay`, `nthWeekdayOfMonth`, `formatScheduleAnchor`), `useRoutines.addRoutine`, the v2 `RoutinesModal` cadence-aware "On" picker, and Quokka `create_routine` / `update_routine`.
  - v1 `Routines.jsx` keeps the weekday-only dropdown; editing a month-anchored routine there preserves the anchor (merge-update doesn't clobber the new columns).

- fix(routines): fixed-schedule cadence — completing off-cycle no longer drifts the series [M]
  - **Problem.** `getNextDueDate` anchored the next due date off the *last completion timestamp*. Completing a weekly routine 3 days late pushed the next one 3 days late too, and the whole series drifted. Off-cycle completion "fucked everything up."
  - **Fix.** Due dates now form a FIXED GRID anchored at the routine's `created_at`. The next due is the first grid slot after the slot containing the most recent completion — the grid never re-bases on when you actually check it off. "Every Monday" stays Monday, "the 5th" stays the 5th, regardless of early/late completion. A missed cycle surfaces as a single overdue task (no pileup); completing it snaps you back to the current slot.
  - **Daily** is special-cased (every calendar day; tomorrow if already done today). **Weekly** folds `schedule_day_of_week` into the grid origin; **month-scale** cadences snap each grid point forward to the weekday (unchanged).
  - **Behavior change.** Previously a late completion delayed the next occurrence; it no longer does. Anchor is the creation date (no per-routine anchor UI yet — weekly day via the "On" dropdown, monthly day-of-month via the creation day).
  - Modified: `src/store.js` (`getNextDueDate` rewrite + `startOfDay` / `addCadenceInterval` helpers)

- feat(routines): add trigger times — surface-at clock time + absolute follow-up step times [L]
  - **Routine trigger time.** New optional `trigger_time` ('HH:MM' 24h) on routines. When set, tasks spawned by the routine are snoozed until that clock time on their due day — they don't surface in the list *and* don't nag before it (every notification engine + the list filter already honor `snoozed_until`). A past trigger time surfaces the task immediately. Use case: "start dishwasher" only after 8pm. Empty = any time (unchanged behavior).
  - **Absolute clock times on follow-up steps.** Each follow-up step can now be timed by an absolute clock time (`at_time` 'HH:MM', optional `at_next_day` for "the next morning") instead of the relative `offset_minutes`. A step uses exactly one mode. Completes the dishwasher example: start @ 8pm → pour milk @ 9pm → empty dishwasher @ 6am next morning.
  - **Snooze mechanism.** Routine trigger snooze is computed client-side in `useRoutines.js` (browser TZ) on spawn (`spawnDueTasks` + `spawnNow`); follow-up `at_time` snooze is computed server-side in `db.js` `spawnNextChainStep` (server TZ — same characteristic the existing sub-day offset already had).
  - **UI (v2).** RoutinesModal form gains an "At time" time input (with Clear) below Frequency/On; the follow-up step editor gains an "After prev | At time" mode toggle (time input + "next day" checkbox). Routine cards show the trigger time in the cadence meta (e.g. `daily · 8pm`). v1 Routines.jsx (no follow-up editor, deprecated) is untouched.
  - **Quokka.** `create_routine` / `update_routine` accept `trigger_time`; `add_follow_up` / `edit_follow_up` accept `at_time` / `at_next_day` (mutually exclusive with `offset_minutes`); `summarizeRoutine` / chain summaries expose the new fields.
  - Added: `migrations/033_add_routine_trigger_time.sql`
  - Modified: `db.js`, `src/store.js`, `src/hooks/useRoutines.js`, `src/v2/components/RoutinesModal.jsx`, `src/v2/components/RoutinesModal.css`, `adviserToolsTasks.js`

## 2026-05-26

- feat(packages): show ETA on the package row without expanding [XS]
  - **Glanceability.** Each package card now shows `ETA <date>` (or `Delivered <Nd ago>` once delivered) directly under the tracking number, so you don't have to tap into the row to see when it's coming.
  - Modified: `src/v2/components/PackagesModal.jsx`, `src/v2/components/PackagesModal.css`

- fix(sync): break infinite sync loop between multi-client auto-roll routine updates [M]
  - **Root cause.** Auto-roll routines called `updateTask` with a new `last_touched` timestamp on every hydration, even when `due_date` was already today. Two clients would ping-pong: Client A rolls → SSE → Client B hydrates + re-rolls with new timestamp → SSE → Client A repeats. Version counter incremented ~1/second indefinitely.
  - **Fix 1 (primary).** `spawnDueTasks` in `useRoutines.js` now checks whether the active instance's `due_date` is already today and has no stale snooze before emitting a roll update. No-op rolls are skipped entirely.
  - **Fix 2 (defense-in-depth).** `skipNextPush` in `useServerSync.js` replaced with a 2-second `skipPushUntil` suppression window. The old boolean flag was consumed on the first state change after hydration, leaving subsequent state changes (like auto-roll `updateTask`) unprotected.
  - Modified: `src/hooks/useRoutines.js`, `src/hooks/useServerSync.js`

- feat(scoring): award 1 point for moving tasks to waiting status [S]
  - **Motivation boost.** Moving a task from not_started/doing to waiting (e.g. sent an email, made a call) now counts as +1 task and +1 point in the daily stats. Reflects real work done even when the task isn't fully complete.
  - **New column.** `waiting_at` timestamp (migration 032) records when the task entered waiting status. Cleared when leaving waiting.
  - **Daily stats.** `computeDailyStats` counts waiting tasks stamped today alongside completions.
  - **Streak.** `computeStreak` counts waiting transitions as completion days.
  - **WeekStrip.** Waiting tasks show in the weekly heat strip alongside completions.
  - Modified: `db.js`, `src/scoring.js`, `src/store.js`, `src/hooks/useTasks.js`, `src/v2/components/WeekStrip.jsx`
  - Added: `migrations/032_waiting_at.sql`

- feat(ui): move New + What Now buttons to mobile bottom tab bar [S]
  - **Bottom bar.** Four buttons: Today | New | What now | Spaces. The two action buttons (+ and compass) live alongside the navigation tabs for easy thumb reach.
  - **FloatingCapture.** Now desktop-only — mobile gets the bottom bar actions instead of floating FABs.
  - **Terminal theme.** Action tabs styled with accent glow, matching existing bracketed-mono idiom.
  - Modified: `src/v2/components/BottomTabs.jsx`, `src/v2/components/BottomTabs.css`, `src/v2/AppV2.jsx`, `src/v2/terminal/tabs.css`

- feat(ui): long-press New for full editor + per-button colors on bottom bar [S]
  - **Long press.** Short tap on New opens inline quick-add input above the tab bar (rapid-fire capture). Long press (500ms) opens the full AddTaskModal. iOS context menu suppressed.
  - **Quick-add bar.** Input slides up from the tab bar with animated entry. Submit button matches green New color. iOS keyboard occlusion handled via visualViewport API.
  - **Per-button colors.** Today=blue, New=green, What now=orange, Spaces=purple. Each button's icon pill and active state use its own color. Terminal theme uses per-button glow instead of uniform accent.
  - Modified: `src/v2/components/BottomTabs.jsx`, `src/v2/components/BottomTabs.css`, `src/v2/AppV2.jsx`, `src/v2/terminal/tabs.css`

## 2026-05-25

- feat(ui): WeekStrip nav below stats + breathing room + auto-shrink [S]
  - **Nav row below.** Date range selector (< May 24-30 >) renders below the stats+days row in inline mode, not above. Always visible when strip is open.
  - **Breathing room.** Day cell gap 4px → 8px, min-width 48px with 8px padding.
  - **Auto-shrink.** Measures available width and shows 3-7 days centered on today. ResizeObserver re-measures on viewport change.
  - Modified: `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`

- feat(ui): inline WeekStrip in desktop stats bar [S]
  - **Desktop (≥769px).** WeekStrip day cells render inline after the date/streak/today buttons in the same flex row. Nav arrows and range label hidden — the date button already shows the date. Detail panel wraps below full-width when a day is clicked. `display: contents` on the strip wrapper lets its children participate in the parent flex.
  - **Mobile (<769px).** Falls back to the existing stacked layout below the stats line — no change.
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`

- style(ui): left-align stats strip, detail panels, and WeekStrip on desktop [XS]
  - Stats, streak/today detail, and WeekStrip now start from the left edge instead of floating centered. Reads naturally left-to-right and aligns with the Kanban columns below.
  - Modified: `src/v2/AppV2.css`, `src/v2/components/WeekStrip.css`

- fix(ui): WeekStrip full-width on desktop + Kanban columns wrap on narrow viewports [XS]
  - **WeekStrip.** max-width 480px → 900px so it fills the desktop content area instead of looking tiny.
  - **Kanban wrap.** `flex-wrap: wrap` so columns stack into rows when the viewport can't fit them side-by-side, instead of requiring horizontal scroll.
  - Modified: `src/v2/components/WeekStrip.css`, `src/v2/components/KanbanBoard.css`

- fix(ui): Kanban columns dynamically resize with viewport [XS]
  - **Bug.** Columns were fixed at 260px — dead space on wide screens, cut off on narrow ones.
  - **Fix.** `flex: 1 0 220px; max-width: 400px` — columns grow to fill available space, cap at 400px, scroll horizontally below 220px each.
  - Modified: `src/v2/components/KanbanBoard.css`

- fix(ui): desktop stats strip spacing + detail panel label/value gap [XS]
  - **Stats strip.** Removed max-width constraint and excess padding — no more dead space flanking the centered stats.
  - **Detail panels.** Added 16px gap so "Current streak" and "20 days" don't run together. Widened to 360px.
  - **WeekStrip.** Tightened to 480px max-width with less vertical whitespace.
  - Modified: `src/v2/AppV2.css`, `src/v2/components/WeekStrip.css`

- fix(ui): date picker unclickable on desktop Chrome [XS]
  - **Bug.** Desktop Chrome only opens the date picker via the calendar indicator icon, not the full input area. The overlay trick (opacity:0 input covering the display span) worked on iOS Safari but not Chrome — only the far-right calendar icon was clickable.
  - **Fix.** Stretched `::-webkit-calendar-picker-indicator` to fill the entire input with `position: absolute; inset: 0; width/height: 100%`.
  - Modified: `src/v2/components/DateField.css`

- fix(ui): WeekStrip missing Easter egg bonus + desktop layout fixes [S]
  - **Easter egg bug.** WeekStrip day count and detail panel only counted done tasks, not the Easter egg bonus. Stats line "3/3 today" included it but WeekStrip showed "2/3" with no "Daily Bonus" entry. Fixed by passing `easterEggWins` to WeekStrip.
  - **Kanban columns.** Reverted flex-grow back to fixed 260px with horizontal scroll — 7 columns with flex-grow smushed into unreadable mush.
  - **Stats + WeekStrip width.** Constrained to max-width 600px on desktop.
  - Modified: `src/v2/components/WeekStrip.jsx`, `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `src/v2/components/WeekStrip.css`, `src/v2/components/KanbanBoard.css`

- feat(ui): desktop Kanban responsive columns + stats strip [M]
  - **Stats strip on desktop.** The date/streak/today-count header + expandable WeekStrip were mobile-only. Lifted them out of the mobile list branch into the shared layout so they render above both Kanban and mobile views. Hidden during search.
  - Modified: `src/v2/AppV2.jsx`

- fix(ui): modal bottom-sheet min-height prevents shrinking during search [XS]
  - **Bug.** On mobile, the Done modal (and any ModalShell) shrank to fit content when search filtered results down to a few items, causing the search bar to jump down the screen.
  - **Fix.** Added `min-height: 60dvh` to `.v2-modal` so the bottom sheet maintains a stable height regardless of content.
  - Modified: `src/v2/components/ModalShell.css`, `src/v2/components/DoneList.css`

- fix(routines): "done today" label showing for yesterday's completions [XS]
  - **Bug.** `formatLastDone` compared raw millisecond deltas (`Math.floor(diff / 86400000)`), which doesn't cross calendar day boundaries. A routine completed at 11pm yesterday would show "done today" at 8am the next day because the elapsed time is under 24h.
  - **Fix.** Compare calendar dates (midnight-truncated) instead of raw deltas.
  - Modified: `src/v2/components/RoutinesModal.jsx`

- feat(ui): port remaining v1-only settings + date inference to v2 [M]
  - **Notion database sync** — database ID/URL input, verify via `notionQueryDatabase`, display connected title, disconnect button. Integrations → Notion → Database sync section.
  - **Notion page template** — collapsible textarea editor for the markdown template used when syncing pages to Notion. Reset-to-default button.
  - **Pushover deep-link URL** (`public_app_url`) — text input in the Pushover section for tappable notification links.
  - **Date inference button** — "Infer" AI pill on the Due date field in EditTaskModal. Calls `inferDate()` to extract a date from the title and notes. Only shows when no date is set. `handleInferDate` + `dateInferring` added to `useTaskForm` hook.
  - **v1 deprecation status:** All v1-only settings are now available in v2. Deleting v1 code will not lose any configuration surface.
  - Modified: `src/hooks/useTaskForm.js`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`

- fix(ui): logs copy button copies filtered view, not all logs [XS]
  - **Bug.** "Copy all" in Settings → Logs copied the entire unfiltered log buffer regardless of which filter tab was active.
  - **Fix.** `handleCopy` now uses `filtered` instead of `logs`. Button label shows count when a filter is active (e.g. "Copy 12").
  - Modified: `src/v2/components/SettingsModal.jsx`

- fix(analytics): 52-week heatmap blank due to UTC/local timezone mismatch [S]
  - **Bug.** The server buckets completed_at dates using UTC (`.split('T')[0]`), but the client's `buildHeatMapGrid` was generating keys via `localYMD()` which uses local timezone. For users west of UTC, evening completions landed in the next UTC day, causing all or most cells to show as empty.
  - **Fix.** Switched `buildHeatMapGrid` to use UTC throughout: `Date.UTC()` construction, `setUTCDate/getUTCDay` iteration, `toISOString().split('T')[0]` keys, `getUTCMonth()` for month labels. Fixed in both v1 (`Analytics.jsx`) and v2 (`AnalyticsModal.jsx`).
  - Modified: `src/v2/components/AnalyticsModal.jsx`, `src/components/Analytics.jsx`

- feat(ui): Legacy toggle to disable v1 + global error logging [M]
  - **Legacy toggle.** New `v1_disabled` setting in Settings → Legacy. When enabled: (1) v1 UI is blocked from rendering — any `?ui=v1` or localStorage flag is overridden, logged to Activity Log. (2) Server-side bulk data endpoints (`GET/PUT/POST /api/data`) return 410 Gone and log to server logs. Per-record APIs (`/api/tasks/:id`, etc.) are unaffected.
  - **Global error logging.** `window.onerror` and `unhandledrejection` handlers write to the Activity Log as `error` action entries. ErrorBoundary render crashes also logged. New `logSystemError(message, detail)` in store.js.
  - **Activity Log errors tab.** New "Errors" filter button in Activity Log. Error entries show red "ERROR" badge + expandable detail block with stack trace.
  - **useServerSync 410 handling.** When bulk endpoints return 410 (v1 disabled), sync logs a descriptive error to the Activity Log instead of silently going offline.
  - Modified: `src/App.jsx`, `src/store.js`, `src/hooks/useServerSync.js`, `src/v2/components/ErrorBoundary.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/ActivityLog.jsx`, `src/v2/components/ActivityLog.css`, `server.js`

- feat(ui): AI-assisted search for Done list and Activity Log [M]
  - **Feature.** Search bar at the top of both modals with instant local substring filter + debounced AI-powered semantic search (uses Claude Haiku).
  - **Done list.** Types a query → immediate local filter on loaded tasks → 400ms debounce fires `POST /api/search/ai` which does keyword LIKE search + AI semantic ranking on the last 200 done tasks. Shows result count + "AI-assisted" indicator when AI results arrive.
  - **Activity Log.** Same search bar → immediate local filter on task_title + action label → AI search sends entry titles to the server for semantic matching. Returns matched entry IDs for filtering.
  - **Fallback.** If no Anthropic API key is configured, falls back to server-side LIKE search (done) or local substring (activity). The search bar works identically either way.
  - **Server endpoint.** `POST /api/search/ai` — accepts `{ query, scope, items? }`. For `scope: 'done'`: queries DB + AI ranking. For `scope: 'activity'`: ranks provided items via AI. Uses Haiku for cost efficiency.
  - Modified: `server.js`, `src/api.js`, `src/v2/components/DoneList.jsx`, `src/v2/components/DoneList.css`, `src/v2/components/ActivityLog.jsx`

## 2026-05-23

- fix(ui): kill 100dvh — pure inset:0 for bottom gap + Notion error always visible [XS]
  - **Bottom gap.** `bottom: auto; height: 100dvh` was returning a genuinely wrong value on iOS PWA — the gap was 100+ pixels, not sub-pixel. Removed the entire `@supports (height: 100dvh)` block. Pure `position: fixed; inset: 0` + body-bg match. If the keyboard issue (#213) recurs, we'll solve it with JS, not CSS hacks.
  - **Notion error.** Error text was inside the `!connected && !needsReauth` conditional — if the status was in any other state, errors were invisible. Moved error + fallback-link rendering outside all conditionals so they always show.
  - Modified: `src/v2/AppV2.css`, `src/v2/components/SettingsModal.jsx`

- feat(ui): port all missing v1 settings to v2 + fix Notion connect popup [L]
  - **Notion connect fix.** Removed about:blank pre-open approach — now opens the popup directly with the auth URL, falls back to a clickable link if popup is blocked. Error text visible inline. Added `notion-mcp-connected` postMessage handler so v2 status refreshes after OAuth.
  - **GCal** (+7 controls): bulk delete events, status filter checkboxes, AI-timed events toggle, fallback time + duration inputs, remove-on-complete toggle, event buffer toggle, pull filter text input, last sync timestamp.
  - **Trello** (+3 controls): multi-list sync checkboxes, status mapping display + re-infer button, last sync timestamp.
  - **Gmail** (+2 controls): reset & rescan button, last sync timestamp.
  - **Weather** (+3 controls): enable/disable toggle, refresh now button, per-task tag hint text.
  - **17track** (+5 controls): dedicated inline section (was generic api-key), test connection button, retention days input, 4 package notification toggles (delivered, exception, signature, auto-task).
  - **Notifications** (+3 controls): pile-up thresholds (percentage + days), digest style picker (curated vs counts), email recipient address input.
  - **CSS**: Added `.v2-integrations-sub-settings` (indented subsection), `.v2-integrations-row-compact` (inline input row), `.v2-integrations-check` (checkbox label).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/Version-History.md`

- fix(notion): MCP connect button works on iOS + error feedback [XS]
  - **Bug.** "Connect via MCP" button did nothing. Two causes: (1) iOS blocks `window.open()` inside async callbacks — by the time the API response arrived, the user gesture had expired. (2) Errors were silently swallowed.
  - **Fix.** Open a blank popup synchronously on tap, then redirect it after the API responds. Show error text if the call fails. Added `notion-mcp-connected` postMessage handler so the v2 status refreshes when the OAuth popup completes.
  - Modified: `src/v2/components/SettingsModal.jsx`

- chore(ui): purge all v1 references from v2 Settings [S]
  - Removed broken "Manage in v1" / "Connect in v1" fallback buttons (Notion showed "Open undefined in v1")
  - Removed `switchToV1` function + prop threading through IntegrationsPanel
  - Removed dead `PLACEHOLDER_TABS` / `PLACEHOLDER_BODY` code + "Open v1" EmptyState
  - Removed stale `v1Section` props from tracking + pushover integrations
  - Fixed Pushover hint "Credentials in v1 → Integrations" → "Credentials in Integrations tab"
  - Fixed "across v1 and v2" → "Tokens persist across reloads"
  - Fixed stale comment "Configure in v1 CTAs"
  - Only v1 reference remaining: the intentional Legacy tab toggle for opting back to v1 UI
  - Modified: `src/v2/components/SettingsModal.jsx`

- fix(ui): full Notion connect/disconnect/reconnect in v2 Settings + bottom gap [M]
  - **Notion controls.** v2 Settings had NO connect, disconnect, or reconnect buttons for Notion — all of that was v1-only. Now the Notion integration section renders a full lifecycle: "Connect via MCP" when not connected, page search + KB setup + "Disconnect" when connected, and a warning banner with "Reconnect" + "Disconnect" when MCP needs reauth. The `inline` section always renders regardless of connection state.
  - **Bottom gap.** Root cause: body background `var(--bg)` = `#F5F5F7` (v1 light grey) vs v2 app `var(--v2-bg)` = `#FFFFFF`. Any sub-pixel gap between the fixed container and the screen edge exposed the mismatch. Fix: `:root[data-ui="v2"] body { background: var(--v2-bg) }` makes the gap invisible. Reverted `min-height` approach back to `bottom: auto; height: 100dvh` for the keyboard fix.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `src/v2/AppV2.css`

- fix(notion): MCP auto-reconnect + expired connection UI warning [M]
  - **Root cause.** MCP SDK v1.29 calls `provider.prepareTokenRequest()` for token refresh, but `NotionMCPProvider` didn't implement it. Auto-reconnect always failed.
  - Added `prepareTokenRequest()` returning `grant_type=refresh_token`. 5-min retry loop on failure. Transport reset on reconnect. `needsReauth` + `error` in status. Orange dot + warning banner + Reconnect button in Settings.
  - Modified: `notionMCP.js`, `server.js`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`

- fix(notion): search returns "No pages found" — response shape mismatch [XS]
  - Server returns `{ pages: [...] }` but client expected a flat array. `Array.isArray({ pages })` → false → empty results. Unwrap `.pages` in `notionSearch()`.
  - Modified: `src/api.js`

- feat(ui): clickable WeekStrip dates + fix best-streak math [S]
  - **Clickable dates.** Each day cell in the WeekStrip is now a tappable button. Tapping a day opens an inline detail panel below the strip showing tasks completed that day with their point values. Summary line shows total tasks + points. Selected day gets accent highlight. Navigating weeks clears the selection.
  - **Best-streak fix.** `computeRecords.longestStreak` used a simpler algorithm than `computeStreak` — it only counted raw done-task days, not no-fault days or project sessions. This produced "Best streak: 10" when the current streak was 18. Fixed by using `Math.max(currentStreak, historicalLongest)` so the best streak is always ≥ current.
  - Modified: `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`, `src/v2/AppV2.jsx`

- feat(ui): tappable home stats — streak + today detail panels [S]
  - Streak and today counters in the home stats line are now tappable buttons. Tapping opens an inline detail card below the stats line (same slot as WeekStrip, mutually exclusive).
  - **Streak detail**: current streak, best streak, best day (tasks + points).
  - **Today detail**: tasks done / goal, points earned / goal, remaining active count, list of completed tasks.
  - Each tap closes the other sections (WeekStrip closes when streak/today opens, and vice versa).
  - Buttons highlight with accent color on hover/active.
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- fix(ios): bottom panel raised on PWA cold start [XS]
  - **Bug.** On some iOS PWA cold starts, BottomTabs floated above the screen bottom, leaving a gap. The previous 100dvh fix (issue #213) removed `bottom: 0` and relied solely on `height: 100dvh`, which iOS sometimes reports as stale on first render.
  - **Fix.** Switch from `bottom: auto; height: 100dvh` to `min-height: 100dvh` while keeping `inset: 0` (bottom: 0 stays as anchor). The min-height prevents keyboard-triggered shrinking (the original bug), while the bottom anchor ensures the container always reaches the screen edge on first render.
  - Modified: `src/v2/AppV2.css`

## 2026-05-22

- fix(weekstrip): date tap actually toggles in light/dark/default themes too [XS]
  - **Bug.** After the prior PR #220 fix, the date tap worked in terminal but still no-op'd in light/dark. The render condition still had a `(!isTerminal && show_week_strip)` clause that kept the strip visible regardless of `weekStripShown` — light/dark's default is `show_week_strip=true`, so tapping toggled the state but the strip stayed open via the legacy clause.
  - **Fix.** Make `weekStripShown` the single source of truth across all themes. Seed it from EITHER `week_strip_always_open` OR `(!isTerminal && show_week_strip)` on mount, then let the date tap drive it. Drops the redundant render-condition clause and the now-unused `isTerminal`/`useTerminalMode` ref in AppV2.
  - Modified: `src/v2/AppV2.jsx`, `wiki/Version-History.md`

- fix(weekstrip): date tap always toggles + "always open" works in all themes [XS]
  - **Bug.** With "Keep 7-day strip always open" turned ON, tapping the 📅 date in the home stats line did nothing — the button was hard-disabled by the setting. Date tap had been a no-op in this state since 2026-05-17 (commit ac164dc), but only surfaced now that the setting was discoverable across all themes (issue #208).
  - **Fix.** Setting now seeds the initial WeekStrip visibility state on app load instead of force-locking it. The date tap is always live — user can hide-on-demand even with always-open ON; next reload restores the default. Drop the `disabled` attribute, drop the `alwaysOpen` ternary on the chevron, drop the JSX IIFE wrapper now that there's no derived state to compute.
  - **Description copy.** Settings row renamed "Keep 7-day strip always open" → "Open 7-day strip by default". Hint now reads: "Show the strip expanded when the app loads. Tap the date in the home stats line any time to hide it or re-open it." Drops the terminal-only framing entirely (closes #208 description portion).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `wiki/Version-History.md`

- chore(spaces-badge): remove the Spaces tab attention dot [XS]
  - **Ask.** User found the dot more annoying than useful — even with the 3-day grace period, it kept firing on pinned projects that didn't actually need a nudge. Pulling it.
  - **Removal.** Drop `spacesBadge` prop + badge JSX from BottomTabs. Remove `.v2-bottom-tab-badge` styles from both BottomTabs.css and terminal/tabs.css. Drop `position: relative` from `.v2-bottom-tab` (was only there to anchor the badge). Drop `wantsAttention` + `stalePinnedCount` from useSpaces. Drop the AppV2 useSpaces import + call (no consumer left).
  - **What stays.** `src/v2/hooks/useSpaces.js` itself remains as the data shape the future SpacesHub preview-card upgrade (C-upgrade) will consume — `pinnedCount`, `totalCount`, `activeCount`, `spawnedTodayCount`, stubbed `knowledge`. The hook is just dormant until a consumer wires it back in.
  - **Notes for the future.** If the attention signal is ever revisited, probably needs a richer rule than "3-day no-session" — maybe "pinned + no Today-list child + N+ days." Or replace the dot entirely with a one-tap "snooze the nudge" affordance. Either way, requires a UX redesign, not just a threshold tweak.
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/BottomTabs.jsx`, `src/v2/components/BottomTabs.css`, `src/v2/hooks/useSpaces.js`, `src/v2/terminal/tabs.css`, `wiki/Version-History.md`

- fix(viewport): iOS PWA grey gap below BottomTabs after keyboard interaction [XS]
  - **Bug.** After typing in any modal input (Add task, Adviser, Edit, etc.), closing the keyboard left a grey strip of body-background visible below the bottom tab bar on iOS PWA standalone mode. Force-quitting the PWA was the only way to restore correct layout (issue #213).
  - **Cause.** `.v2-app { position: fixed; inset: 0 }` anchors to the layout viewport. iOS Safari leaves the layout viewport in a stale state across keyboard show/hide cycles, which makes the v2-app draw shorter than the actual visual viewport.
  - **Fix.** Use `height: 100dvh` (dynamic viewport height) instead of `inset: 0`'s implicit bottom anchoring. `dvh` tracks the live visual viewport so the app stays correctly sized through every iOS URL-bar / keyboard / orientation transition. Wrapped in `@supports (height: 100dvh)` so older browsers fall back to the inset:0 path. Boomerang targets iOS 16.4+ for Web Push anyway, so dvh is the default path for nearly all users.
  - Modified: `src/v2/AppV2.css`, `wiki/Version-History.md`

- fix(spaces-badge): grace period for newly-pinned projects [XS]
  - **Bug.** Spaces tab attention dot fired immediately on any newly-pinned project. `useSpaces` treated `last_session_at = null` as "stale forever," which made the badge a false positive every time a user pinned something — defeating the signal it was supposed to send (issue #212).
  - **Fix.** Use the most-recent of `last_session_at`, `last_touched`, `created_at` as the staleness reference. `setProjectPinned` already stamps `last_touched`, so a brand-new pin now gets a full 3-day grace window before the dot fires. Projects with no reference timestamps at all (truly unknown state) don't fire either — silence beats a false positive.
  - Modified: `src/v2/hooks/useSpaces.js`, `wiki/Version-History.md`

- feat(routines): custom cadence supports "every N months" alongside "every N days" [S]
  - **Ask.** Existing custom cadence only supported days. Quarterly + annually are fixed presets; in-between cadences like "every 2 months" / "every 6 months" weren't expressible.
  - **Schema.** Migration 031 adds `custom_unit TEXT DEFAULT 'days'` to the routines table. `custom_days` keeps its name as the interval count (regardless of unit) — kept for backward compat with all callers; renaming would have touched a dozen files. Null/missing `custom_unit` is treated as `'days'` everywhere so pre-migration routines preserve exact behavior.
  - **Logic.** `getNextDueDate` switch case for `'custom'` branches on `custom_unit` — days → `setDate(+N)`, months → `setMonth(+N)`. `cadenceIntervalMs` (streak tolerance) approximates months as 30 days × N — exact 28-31 day variation doesn't matter for the 1.5× tolerance window. `formatCadence` renders "every 2mo" / "every 14d".
  - **UI.** RoutinesModal cadence picker — when `custom` is selected, an "Every" row now shows an N input + a unit dropdown (days/months). v2 EditTaskModal's inline "Convert to routine" form gets the same unit dropdown next to the N input.
  - **Quokka tools.** `create_routine` + `update_routine` schemas now expose `custom_days` (the canonical column name) + `custom_unit` (enum: days, months). While there, fixed a latent bug — the create-tool's old `custom_interval_days` arg was being read into a non-existent field, so every Quokka-created custom routine actually saved `custom_days=null` and spawned on the default 7-day fallback. New schema uses `custom_days`; execute body accepts the legacy `custom_interval_days` arg name as a fallback for compat with any in-flight chat context.
  - **Backward compat.** `summarizeRoutine` exposes `custom_days` + `custom_unit` so Quokka can read state before update tools fire. Pre-migration routines (which have neither field saved) silently default to days — no migration backfill needed.
  - **Verification.** Migration 031 applies cleanly on server boot. `custom_unit` column verified present alongside `custom_days`. `npm run check:terminal-titles` + lint + production build + smoke all clean.
  - Modified: new `migrations/031_routine_custom_months.sql`; `src/store.js`, `src/hooks/useRoutines.js`, `src/v2/AppV2.jsx`, `src/v2/components/RoutinesModal.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `db.js`, `server.js`, `adviserToolsTasks.js`, `CLAUDE.md`, `wiki/Version-History.md`

- feat(ui): Spaces tab attention-badge + useSpaces data layer [S]
  - **Ask.** Bottom tab bar (just shipped) was missing the "something in here wants your attention" signal. A pinned project drifting past the no-session-in-3-days threshold is the exact case the user needs surfaced without opening Spaces — they committed to caring (pinned it), but haven't touched it. Add a presence-only badge dot on the Spaces tab.
  - **Data layer.** New `src/v2/hooks/useSpaces.js` derives `{ projects, routines, knowledge, wantsAttention }` from existing useTasks + useRoutines state — no fetches. `projects.stalePinnedCount` counts pinned projects where `last_session_at` is null OR more than 3 days old. `wantsAttention` is a single boolean (today: `stalePinnedCount > 0`) that future signals can OR into without changing the BottomTabs contract.
  - **Badge render.** New `spacesBadge` prop on BottomTabs. In light/dark: 8px accent-colored dot anchored top-right of the icon pill via `position: absolute` on the tab button (which is now `position: relative`), with a 2px surface ring so it reads cleanly over the active-tab pill background. In terminal: dot is `position: static` and renders as a small accent-color `•` glyph inline after the bracketed label with `--v2-glow` text-shadow, matching the bracketed mono idiom. `aria-label` swaps to "Spaces (attention needed)" when the badge is on.
  - **Presence, not counts.** Deliberately a dot, not a number. Counter would invite "I have 4 stale projects, that's bad" anxiety; the dot says "hey, peek in here." Per-project breakdown lives inside the SpacesHub when the C-upgrade lands.
  - **C-upgrade prep.** `useSpaces` already returns the data shape the future preview-card render will consume (`pinnedCount`, `totalCount`, `stalePinnedCount`, `activeCount`, `spawnedTodayCount`, stubbed `knowledge.itemCount`). When SpacesHub graduates from picker rows to rich cards, the data layer doesn't change — only the SpacesHub JSX.
  - **Verification.** `npm run check:terminal-titles` clean. `npx eslint src/v2/` clean. Production build clean.
  - Modified: new `src/v2/hooks/useSpaces.js`; `src/v2/AppV2.jsx`, `src/v2/components/BottomTabs.jsx`, `src/v2/components/BottomTabs.css`, `src/v2/terminal/tabs.css`, `wiki/Version-History.md`

- feat(ui): mobile bottom tabs + Spaces hub + SystemMenu — retire the ⋯ More menu [L]
  - **Ask.** The single ⋯ overflow menu had grown to 8 items (Settings, Projects, Knowledge, Routines, Done, Analytics, Suggestions, Activity log) — too long to scan, no grouping, no live information, every destination one extra tap deep. Replace it with a layered navigation pattern sized to each surface's frequency.
  - **Three new surfaces, each frequency-appropriate.**
    1. **BottomTabs (mobile only).** Persistent bottom strip with `[ Today ]` (default — the task list) and `[ Spaces ]` (opens the SpacesHub picker). Renders only when `!isDesktop` (≤768px) — desktop keeps Kanban + side drawer and never needed the ⋯ menu's discoverability problem. Active-tab indicator is a soft accent pill behind the icon in light/dark; in terminal mode the lucide icon hides and the bracketed mono label glows with accent + `var(--v2-glow)` text-shadow (matching the filter-tabs idiom already in `flatten.css`).
    2. **SystemMenu (anchored popover off the ⚙ header icon).** Hosts low-frequency system surfaces: Settings, Analytics, Done, Suggestions, Activity log. Reuses the brand-popover's surface treatment (soft border, hairline-tinted rows, drop shadow) so the two header popovers feel like siblings. Click-outside closes; the originating ⚙ button's own onClick toggles open/closed. In terminal mode the lucide icon glyphs go monochrome, the colored chevron disappears, and labels render `> command` form via the existing `data-terminal-cmd` attribute pattern.
    3. **SpacesHub (modal-sheet picker, opens from the Spaces tab).** Three roomy hairline rows — Projects, Routines, Knowledge — each with icon + label + subtitle. Tapping a row closes the hub and launches the existing dedicated modal (`ProjectsView`, `RoutinesModal`, or a Quokka chat seeded with "What's in my knowledge base?"). No internal sub-tab strip — keeps Tap-to-destination cheap (2 taps from Today) and leaves the structure ready for the C-upgrade (rich preview cards with live session counts / last-touched timestamps) without contract changes.
  - **Header swap.** `MoreVertical` icon → `Settings` (⚙) glyph. Header prop renamed `onOpenMenu` → `onOpenSystemMenu`; new `systemMenuOpen` prop drives `aria-expanded`. `data-system-menu-anchor` attr on the button lets SystemMenu's outside-click handler ignore the source button (otherwise tap-to-toggle would immediately close).
  - **Tab indicator safety net.** `activeTab` state ('today' | 'spaces') drives the BottomTabs render. A `useEffect` watches `spacesHubOpen`, `showProjects`, `showRoutines`, `showAdviser`: when activeTab is 'spaces' and all four are false, it snaps back to 'today'. Closing the hub's X also explicitly resets. The indicator never lies about which surface the user is looking at.
  - **FAB offset.** `FloatingCapture` bottom offset bumped from `max(16px, env(safe-area-inset-bottom))` to `calc(72px + env(safe-area-inset-bottom))` so the speed-dial sits above the new tab bar. Desktop @media (≥769px) override resets the original 16px so the FAB doesn't float in dead space.
  - **Terminal styling.** New `src/v2/terminal/tabs.css` carries all three components' terminal overrides — bracketed labels with glow on active tab, monochrome `> command` rows in SystemMenu, hidden icons + `>` prompts + `// comment` subtitles + `→` ASCII chevrons in SpacesHub. Imported from `terminal/index.css` alongside the other structural files.
  - **What's gone.** The legacy `<ModalShell open={showMenu}>...</ModalShell>` block (~70 lines of `v2-more-menu`/`v2-more-row` markup, 8 destinations) is deleted from AppV2.jsx. The `showMenu`/`setShowMenu` state, the `MoreVertical` import, and the destination-icon imports (FolderKanban / BookOpen / RotateCw / CheckCircle2 / BarChart3 / Lightbulb / History / ChevronRight / SettingsIcon) all leave AppV2's import list. The legacy `.v2-more-menu` CSS in AppV2.css is kept for now — multiple v2 modals still reuse `v2-more-row` styling for hairline-list rows.
  - **Out of scope (deferred to follow-up PRs).** `useSpaces()` data-layer hook + tab-bar badge dots for spaces-fresh activity. Rich preview cards inside SpacesHub (C-upgrade — session counts, last-touched timestamps, knowledge new-item counter). Tab-bar transition animation + reduced-motion handling.
  - **Verification.** `npm run check:terminal-titles` clean. `npx eslint` clean on every touched file. `npm test` (build + boot smoke test) passes. Browser-side validation deferred to the `:dev` Docker deploy on `boomerang-dev` (port 3002) after merge.
  - Modified: new `src/v2/components/BottomTabs.{jsx,css}`, new `src/v2/components/SystemMenu.{jsx,css}`, new `src/v2/components/SpacesHub.{jsx,css}`, new `src/v2/terminal/tabs.css`; `src/v2/AppV2.jsx`, `src/v2/components/Header.jsx`, `src/v2/components/FloatingCapture.css`, `src/v2/terminal/index.css`, `CLAUDE.md`, `wiki/Version-History.md`

---

## 2026-05-21

- feat(knowledge): Notion-backed knowledge base + Quokka tools [L]
  - **Ask.** "I have a list in my head — where construction paper is kept, what cat-food brand I switched to, decisions I've made — that I want Quokka to remember and surface when relevant. Don't make me fill out forms; just let me tell Quokka 'remember that the lampshade is in the basement' and have it stick."
  - **Storage.** New Notion database holding long-term reference items. Auto-created on first setup under the user's existing `notion_sync_parent_id` so there's zero manual schema work. Properties: Name (title), Type (select: Location / How-to / Decision / Person), Tags (multi-select, freeform), Related tasks (rich_text — comma-separated task IDs), Confidence (select: Certain / Fuzzy). DB id stored as `notion_knowledge_db_id` setting; URL stored as `notion_knowledge_db_url`.
  - **Cache.** Server-side `knowledge_index` table (migration 030) holds metadata only — title, type, tags, ≤200-char summary, related task IDs, Notion URL, last-edited timestamp. Background refresh loop every 5 min reconciles deletions made directly in Notion. Full body fetched on demand via the same Notion REST endpoint stack the rest of the integrations use (MCP-issued OAuth token doubles as a Bearer token).
  - **Task ↔ knowledge linking.** New `knowledge_page_ids_json` column on `tasks` (JSON array of Notion page IDs). EditTaskModal gets a "Linked knowledge" chip section above Manage — tap a chip to unlink, + chip opens a search picker against the cached index. Notion mirror: backlinks written to the knowledge item's "Related tasks" property so the relationship is visible from either side.
  - **Capture model.** Auto-write — when the user tells Quokka "remember X is in the basement", `create_knowledge` runs inline during the chat turn with no plan-confirm step. Edits and deletes go through the existing staged-plan + LIFO compensation flow because those touch existing user data. Quokka is instructed to call `search_knowledge` first and ask before creating a duplicate.
  - **Quokka tools (9).** `search_knowledge`, `get_knowledge`, `refresh_knowledge_index`, `list_knowledge` (read-only); `create_knowledge`, `update_knowledge`, `delete_knowledge`, `link_knowledge_to_task`, `unlink_knowledge_from_task` (staged with rollback). Adviser deps grow `knowledgeDbConfigured` flag so tools short-circuit with a clear setup-prompt error when missing.
  - **Server endpoints (5).** `GET /api/knowledge/status` (config + last-sync), `POST /api/knowledge/setup` (auto-create the database), `GET /api/knowledge` (search/filter/list), `GET /api/knowledge/:id` (cached metadata + on-demand body), `POST /api/knowledge/refresh` (force re-pull).
  - **Settings UI.** Knowledge Base subsection inside the existing Notion integration card. Disabled "Set up Knowledge Base" button when no `notion_sync_parent_id` is configured (with hint); after setup, surfaces ✓ Connected + Open in Notion link + Sync now button.
  - **Entry point.** New "Knowledge" entry in the overflow ⋯ menu (between Projects and Routines). Tapping it opens Quokka with a seeded "What's in my knowledge base?" draft in the input — user can hit send as-is or refine. Quokka is the primary surface; the menu entry is the discoverability handle.
  - **Limitations.**
    - Body restore is best-effort on `update_knowledge` rollback — Notion's PATCH-children API replaces blocks, so we'd need the full pre-update body to restore exactly. Property restores (title/type/tags) work cleanly.
    - External delete is final per the existing adviser policy — `delete_knowledge` archives in Notion (recoverable from Trash for 30 days) but rollback can only re-insert the local cache row.
    - Search is keyword-only against title/tags/summary. Semantic search across full bodies isn't wired (would need an embedding step or a Notion-side full-text query).
    - Background refresh fires every 5 min; if the user adds an item in Notion directly and immediately asks Quokka about it, they'll need to tap "Sync now" or have Quokka call `refresh_knowledge_index`.
  - Modified: new `knowledgeSync.js`, new `adviserToolsKnowledge.js`, new `migrations/030_knowledge_base.sql`; `server.js`, `db.js`, `Dockerfile`, `src/store.js`, `src/api.js`, `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/v2/components/AdviserModal.jsx`, `CLAUDE.md`, `wiki/Features.md`, `wiki/Architecture.md`, `wiki/Version-History.md`

---

## 2026-05-20

- feat(tasks): backdate task completion to fix streak credit [S]
  - **Ask.** "I did a task and forgot to come back to it to check it off and I didn't get credit for it." Need to mark a task done as of an earlier date so the daily streak and points land on the day the work actually happened.
  - **Surface.** EditTaskModal (v2) — when `currentStatus === 'done'`, a new "Completed on" section appears directly under the Status row with a date picker. Hint copy: "Backdate if you finished this earlier — fixes streak and points credit." Field defaults to the task's current `completed_at` (or today if the user just flipped status to done in this modal). Max=today; no future dates.
  - **Flow for the forgot-to-check-off case.** Open the task → tap ✓ Done (status flips, completed_at stamps to now, "Completed on" appears with today's date) → tap the field, pick yesterday → autosave fires after 500ms with `completed_at = yesterday ISO`. Streak (`computeStreak` in `src/store.js`) and daily stats (`computeDailyStats` in `src/scoring.js`) both bucket by `new Date(t.completed_at).toDateString()` — no new code needed, they just see the updated date.
  - **Routine cadence sync.** Routine-spawned tasks need a second touch: `completeRoutine` appends `new Date().toISOString()` to the routine's `completed_history` at the moment of completion. If the user later backdates the task's `completed_at`, the routine's history entry would drift. New `adjustRoutineHistory(routineId, fromIso, toIso)` on `useRoutines` swaps the matching entry (or falls back to the last entry if exact-ISO match misses, since the task and routine timestamps drift by a few ms even when stamped from the same handler). `AppV2.handleEditModalSave` detects `completed_at` changes on routine-tagged tasks and propagates. Sorts history after the swap so `getNextDueDate`'s "last entry = newest" assumption holds.
  - **Time-of-day preservation.** ISO is the source of truth in local state; the picker converts YYYY-MM-DD ↔ ISO and preserves the original hours/minutes/seconds across edits (defaults to "now" the first time a task transitions to done). So a 2pm-yesterday completion stays at 2pm yesterday when reformatted, not midnight.
  - **DateField extension.** Existing `DateField` had a hardcoded "due date" placeholder and "Clear due date" aria label. Extended with `placeholder`, `max`, `ariaLabelEmpty`, `ariaLabelFilled`, `clearLabel`, `showClear` props (all backward-compatible defaults). The completion-date instance disables the clear button via `showClear={false}` — clearing the date would leave the task in done-status with no completion timestamp, which the streak code treats as "not counted at all," and there's no UI affordance to recover from that. Status flip away from done already clears `completed_at` cleanly via `changeStatus`.
  - **Save semantics.** `savePayload` only includes `completed_at` when `currentStatus === 'done' && completedAtIso`. Avoids re-stamping a stale value when the task is active. `changeStatus` continues to clear `completed_at` on done→active transitions; the modal also resets `completedAtIso` locally so the field re-defaults to today on re-completion.
  - **Out of scope.** No backdate UI on the TaskCard itself — the user picked "edit modal only" so backdating stays a deliberate, edit-mode-gated action rather than something easy to do by accident on the main list.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/DateField.jsx`, `src/hooks/useRoutines.js`, `src/v2/AppV2.jsx`, `wiki/Features.md`, `wiki/Version-History.md`

---

## 2026-05-17

- fix(datefield): date picker not opening on iPhone PWA [XS]
  - **Bug.** Tapping the Due date field in the EditTaskModal on iPhone PWA (light theme) did nothing — the native picker never opened.
  - **Cause.** DateField rendered a visible `<button>` trigger plus an off-screen 1×1 `<input type="date">` and called `.showPicker()` on tap. Modern Safari supports `showPicker()` but it can silently fail on iOS PWA in some versions — try/catch swallowed the error, then the fallback `el.focus(); el.click()` on a 1×1 opacity:0 input never opened the native picker either.
  - **Fix.** Drop the trigger-button + showPicker pattern. Now the real `<input type="date">` is overlaid full-size on top of a styled display span at `opacity: 0` with pointer-events enabled. Tapping the field hits the native input directly — iOS opens the picker the way it always has, no JS required. The display span underneath is `pointer-events: none` so taps pass through. Same bracketed terminal look + the regular border in light/dark.
  - Modified: `src/v2/components/DateField.jsx`, `src/v2/components/DateField.css`, `wiki/Version-History.md`

- fix(settings): notifications panel cleanup — collapsible sections, descriptions on every type, Quokka card matches the rest [S]
  - **Three asks from the screenshots:**
    1. Collapse the noisy notif sections so the panel isn't a wall of toggles.
    2. The Quokka card has descriptive text none of the others have — either remove it or give the others the same treatment.
    3. Each notification type should have a short description, formatted title-above-text like the channel-master rows.
  - **Fixes:**
    - **Collapsible section headers.** New `SectionHeader` component renders a clickable row with a `▾`/`▸` chevron + label + hint. Click to fold/unfold. State persists in `settings.collapsed_notif_sections` (cross-device + reload). Applied to Channels, Notification types, Daily digest, Test channels, Email deliverability, Weather notifications. High-priority escalation + Quiet hours kept as-is — those already gate their content via their primary Toggle row.
    - **`desc` field on every NOTIF_TYPE.** Overdue/Stale/Nudges/Size/Pile-up/Habit nudges/Routine suggestions all gain a one-line description rendered under the title (same shape as the Quokka card). Package types too.
    - **Card head restructured.** New `.v2-notif-card-text` column wraps title + description as a vertical stack so the frequency input + channel toggles align top-right correctly. Quokka card now uses the same structure; no longer special-cased.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/Version-History.md`

- fix(notifications): respect backstage subs, blocked subs, and notifications_muted server-side [S]
  - **Bug.** A "Quick win available" push fired with `"Organize travel documents & confirmations" (S)` — a backstage sub of the Summer '26 Vacation project that's blocked behind several earlier subs. Not in the user's main list, not actionable yet, definitely shouldn't be on the lock screen.
  - **Cause.** Server-side notification dispatchers (push, email, pushover, digest) used `isNotifiable(task)` which only checks status / snooze_indefinite / gmail_pending. The project-aware filters (`isBackstageSub`, `isBlockedSub`) and the `notifications_muted` flag were enforced only by the client when building the visible task list. Server-side never saw them.
  - **Fix.** New `filterNotifiableTasks(allTasks)` helper in `db.js` — composes `isNotifiable` plus per-context filters:
    - Backstage subs of projects (`child_visibility === 'backstage'` AND parent is a project) → skip.
    - Blocked subs (any id in `blocked_by` not yet `done`) → skip.
    - Also: `isNotifiable` now respects `task.notifications_muted` directly so dispatcher branches that didn't already filter for it get the rule too.
  - Replaced `allTasks.filter(isNotifiable)` with `filterNotifiableTasks(allTasks)` in `pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, `digestBuilder.js`.
  - **Out of scope.** The general-nudge picker still chooses a small task at random from the eligible pool. With this filter applied, random will now pick from a much smaller, accurate set — but priority-aware picking (high-pri first, then earliest due) is the obvious follow-up if random still feels noisy.
  - Modified: `db.js`, `pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, `digestBuilder.js`, `wiki/Version-History.md`

- fix(tz): replace every UTC-based date key with a local-timezone helper [S]
  - **Bug originally reported.** At 7pm Central on Sunday May 17, the home-stats header said "Sun, May 17" but the WeekStrip highlighted MON 18 as today with a 0/3 count.
  - **Cause.** `date.toISOString().slice(0, 10)` (or `.split('T')[0]`) converts to UTC before slicing. After ~6-7pm Central, UTC has already rolled to the next calendar day. Anywhere this was used for "today" / "due date" / per-day bucket keys, the date silently shifted forward at night Central.
  - **Audit + fix.** New `localYMD(d = new Date())` exported from `src/store.js` — composes YYYY-MM-DD from local-time components. Every callsite that represents a user-visible calendar day swapped to it. Affected files: `src/v2/components/WeekStrip.jsx` (today highlight, completions bucket), `src/scoring.js` (easter-egg key in `computeDailyStats`), `src/store.js` (`getDefaultDueDate`, `computeStreak`), `src/api.js` (3 AI-context "today" strings), `src/AppV1.jsx`, `src/v2/AppV2.jsx` (next-task score's "due today" check), `src/components/Routines.jsx` (default end date), `src/components/SnoozeModal.jsx` + `src/v2/components/SnoozeModal.jsx` (defaultDate + minDateStr), `src/components/Analytics.jsx` + `src/v2/components/AnalyticsModal.jsx` (per-day chart keys, today highlight), `src/components/EditTaskModal.jsx` + `src/v2/components/EditTaskModal.jsx` (min-date attribute on date input), `src/components/AddTaskModal.jsx` + `src/v2/components/AddTaskModal.jsx` (min-date attribute), `src/components/ExtendModal.jsx` (extend offsets + minDate), `src/v2/components/RoutinesModal.jsx` (today/end-date inputs), `src/v2/components/TicTacToe.jsx` (easter-egg-win key), `src/hooks/useRoutines.js` (4 sites — habit log, spawn-now, auto-roll today, scheduled-spawn due-date), `src/hooks/useExternalSync.js` (GCal initial-sync "today" filter), `src/components/Settings.jsx` + `src/v2/components/SettingsModal.jsx` (backup filename stamps).
  - **Server-side date stamps unchanged.** `scripts/backup-db.js` still uses ISO/UTC for its filename (server-side consistency, runs at container TZ). `db.js`/`server.js` analytics queries use stored `completed_at` ISO strings directly — those are timezone-anchored at write time, no UTC-vs-local ambiguity.
  - Modified: ~20 files plus the new `localYMD` helper. Smoke + lint clean.

- fix(ui): home-stats line on light/dark + collapsible pinned projects [S]
  - **Home-stats on light/dark.** The "📅 Sun, May 17 · 🔥 12 days · ✓ 4/3 today" line was still gated on `isTerminal && ...` in AppV2 — my earlier PR #175 to lift it never reached dev (it was opened against `main` and got closed during the alignment-merge cleanup, never re-applied). Now properly unfenced: wrapper class renamed `.v2-terminal-home-stats` → `.v2-home-stats`, base styling in `AppV2.css`, terminal-flavor tweaks (monospace + tighter line-height) scoped under `[data-theme^="terminal"]` in `terminal/init.css`. Date toggle still folds the WeekStrip in all themes.
  - **Pinned-project collapse.** Each pinned project card now has a chevron next to its title — tap to collapse/expand the sub list. Collapsed cards show a tighter meta line: `N active subs · next: Title (due X) · 🔥 sessions`. Expanded view unchanged (full session + budget + last-touched detail). Per-project state persists in `settings.collapsed_pinned_projects` so each pinned project's fold state survives reloads + cross-device sync. Useful when multiple projects are pinned and you only want one expanded at a time.
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `src/v2/terminal/init.css`, `src/v2/components/ProjectPinnedSection.jsx`, `src/v2/components/ProjectPinnedSection.css`, `wiki/Version-History.md`

- feat(quokka): backgrounded runner — chat continues server-side, reattaches on reopen, push notif when plan ready [L]
  - **The use case.** Ask Quokka to do something with 30+ tool calls. Background the PWA. Come back 5 minutes later and the plan is already staged, with a push notification telling you it's ready. Previously: closing the SSE connection killed the upstream Claude call, lost all in-flight work.
  - **Detached runner architecture.** Tool-use loop now runs as an async task on the session (`session.runnerState` + `session.runnerPromise`), not the request. Events are emitted via `appendEvent()` which appends to `session.events` (500-event cap, in-memory) AND fans out to all current SSE subscribers. Closing the HTTP connection only unsubscribes — the runner keeps going. Reconnect via `POST /api/adviser/chat { sessionId, subscribeOnly: true }` replays buffered events first, then streams live ones. Multiple devices/tabs can subscribe to the same session simultaneously (fan-out).
  - **State machine.** `idle → running → (awaiting_confirm | errored | aborted)`. On `awaiting_confirm` with no live subscribers, a Quokka plan-ready push notification fires through the existing web-push infrastructure. On `errored`, the plan stays staged so the user can see what happened. On `aborted`, the queue is dropped and session is cleaned up. On successful commit, `commitPlan` no longer deletes the session — it resets `plan = []` + `runnerState = 'idle'` so queued follow-ups can advance within the same conversation.
  - **Queued concurrent messages.** Sending a new message while the runner is `running` or `awaiting_confirm` queues it server-side (`session.queue`) instead of starting a parallel turn. The queue advances when the runner returns to idle OR when the user commits/aborts the current plan. Client UI shows a "queued — will run after current finishes" indicator.
  - **TTL extensions.** Idle 10-min TTL still applies — but extends while the runner is `running`. `awaiting_confirm` plans get a 30-min hard cap before auto-abort so the compensation system can't be asked to unwind hours-old state. The sweep loop runs every 60s, same as before.
  - **Push notification.** New per-type toggle `push_notif_quokka_plan_ready` (default ON), under the existing `push_notifications_enabled` master. Web-push-only (informational, not nag-urgent — no email/Pushover variants). Tap → deep-links to `/?adviser=<chatId>`, which v2's URL-handling effect now recognizes (opens the Quokka modal). New `sendQuokkaPlanReadyPush()` in `pushNotifications.js`; service worker reads `payload.data.url` for the deep-link target and skips inline action buttons via `no_actions: true`.
  - **Client changes.** New `runnerState` + `queueLength` exposed by `useAdviser`. On hydration AND chat-switch, if the active chat has a `sessionId`, the client tries `subscribeOnly` automatically — if the session is alive, replays + goes live; if dead (404), no-op. `switchChat` no longer aborts the runner — switching away leaves it running so you can come back. Event handler factored into `makeEventHandler()` so both new-send and resubscribe share the same state-transition logic.
  - **Out of scope (noted).** Server-restart persistence of in-flight runners — current system also loses on restart, no regression here. Plan-staleness warning ("this was generated 25 min ago, DB may have changed") — the 30-min `awaiting_confirm` cap is the safety net. Multi-device subscription beyond fan-out (e.g. push notifications selecting which device gets the deep-link) — single-user app, defer.
  - Modified: `adviserTools.js`, `server.js`, `pushNotifications.js`, `public/boomerang-sw.js`, `src/api.js`, `src/hooks/useAdviser.js`, `src/v2/AppV2.jsx`, `src/v2/components/AdviserModal.jsx`, `src/v2/components/AdviserModal.css`, `src/v2/components/SettingsModal.jsx`, `CLAUDE.md`, `wiki/Version-History.md`

- feat(projects): sub-task dependencies — "blocked_by" hides not-yet-doable subs [M]
  - **The use case.** Real projects have ordering. "Booking day" has no business being on the main list when "research destinations" and "choose final" aren't done yet. Routines have follow-up chains; projects needed the same idea but dependency-based (not time-based).
  - **Data model (migration 029).** New `blocked_by_json` column on `tasks`: array of sibling sub IDs this sub is blocked by. Default `'[]'`. A sub is "blocked" when ANY blocker has `status !== 'done'`.
  - **Filter rule.** Blocked subs hide from the main list entirely (mobile + desktop). They appear only inside the Projects modal drill-down under a new "Waiting on others" group, faded, with a `⏸ waits on X, Y` subtitle listing the incomplete blockers. As soon as the last blocker completes, the sub auto-appears in the main list — no manual action needed.
  - **EditTaskModal — blocker chips.** Sub-task edit modal gains a "Waits on" chip list under the Project link section. Each sibling sub renders as a tappable chip; tap to add/remove as a blocker. Selected chips are styled with a purple tint + `⏸` glyph; completed siblings render with a `✓` check (still tappable for history, but they're effectively no-op blockers). **Cycle protection:** candidates that would create a loop (A → B → A) are filtered out of the chip list before render. The user can't pick a cycle.
  - **Quokka — blocked_by everywhere.** `create_task` + `update_task` both accept a `blocked_by: string[]` field. `stagedValidate` enforces: (a) every blocker id must reference a real task or a staged create in the same plan, (b) no self-references, (c) no cycles in the combined DB + session graph. Errors come back to the model as tool-result text so it can self-correct in-loop, same pattern as the chained-create id validation.
  - **What's NOT in scope.** Notifications still treat blocked subs like any other task (could be suppressed; deferred until it becomes a problem). Drag-to-reorder subs as an alternative to blocked_by — still on the follow-up list. Pre-fetched cycle detection at app boot (not needed; only matters at write time). Blocked-sub indicator on the pinned-project card itself (showing "N blocked behind X") — could add later if useful.
  - Modified: `migrations/029_add_blocked_by.sql` (new), `db.js`, `adviserToolsTasks.js`, `src/hooks/useTasks.js`, `src/v2/AppV2.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/v2/components/ProjectsView.jsx`, `src/v2/components/ProjectsView.css`, `wiki/Version-History.md`

- fix(git): use merge-commit for dev→main; rebase rewrites SHAs and recreates divergence [XS]
  - **The actual root cause of the "branches keep diverging" problem.** Not cherry-picking (that was already gone). Not using dev as PR head (already fixed). It's that `merge_method=rebase` rewrites the commit's SHA when it lands on the target. Every dev→main promotion via rebase produces a new SHA on main for the same content. `git log` then sees the commits as different by SHA → next promotion has 3-way-merge conflicts on same-content changes.
  - **Fix.** dev→main always uses `merge_method=merge`. Merge commits preserve dev's SHAs as parents. `git diff origin/main origin/dev` stays empty after every promotion forever.
  - **Feature → dev keeps `merge_method=rebase`** for linear history within dev. dev is its own source of truth there, no cross-branch alignment to preserve.
  - Modified: `CLAUDE.md`, `wiki/Version-History.md`

- fix(projects): backstage subs no longer leak into the main list on desktop [XS]
  - **Bug.** "Show in main list when the parent project is pinned" checkbox respected on mobile but not desktop — backstage subs were appearing in the Kanban Up Next column even when the toggle was off.
  - **Cause.** The earlier fix that made pinned-project subs visible on desktop (PR #176, "C. Pinned-child filter on desktop") removed the filter unconditionally instead of narrowing it to active children only. Result: backstage subs also fell through into the regular sections on desktop.
  - **Fix.** New `isBackstageSub(t)` helper in `useTasks`: returns true when `t.parent_id` is set, `t.child_visibility === 'backstage'`, and the parent is a project. Applied to `openTasks` unconditionally — backstage subs never show in the main list (mobile or desktop), only inside the Projects drill-down. The existing `isPinnedChild` filter still handles avoiding double-display of active subs on mobile.
  - Modified: `src/hooks/useTasks.js`, `wiki/Version-History.md`

- fix(git): correct dev→main flow — never use dev as PR head, GitHub deletes it [XS]
  - **What happened.** PR #179 was head=`dev`, base=`main`, rebase-merge. GitHub's "automatically delete head branches" setting deleted `dev` from the remote when the PR merged. Discovered when `git ls-remote origin refs/heads/dev` returned nothing right after a "successful" merge.
  - **Recovery.** `git push origin refs/remotes/origin/main:refs/heads/dev` recreated dev from main's tip. Branches realigned, zero content delta.
  - **Corrected flow** (documented in CLAUDE.md): always push dev's tip to a fresh short-lived release branch first, then PR that branch to main. Auto-delete then nukes the release branch on merge, leaving dev untouched.
  - Modified: `CLAUDE.md`, `wiki/Version-History.md`

- chore(git): end the dev→main cherry-pick era; CLAUDE.md updated with new flow [XS]
  - **What happened.** Earlier dev→main promotions ran through a cherry-pick branch off main. Each cherry-pick produced a new SHA even though content matched dev exactly. After ~10 promotions, branches accumulated 10 same-content / different-SHA commit pairs. A direct dev→main PR started failing with 13 file conflicts because git's 3-way merge can't tell that the cherry-picked and original versions are the same change.
  - **Fix.** One-time alignment merge on main: `git merge -X theirs origin/dev` (always take dev's version on conflict) → identical-content main with a clean merge commit bridging the histories. Followup commit (`align(adviser-modal-css)`) cleaned up a unique-to-main hunk left over from an earlier cherry-pick that `-X theirs` couldn't auto-handle (an old `position: sticky` rule the polish round had removed).
  - **Going forward.** Direct dev→main PRs only. No cherry-pick branches. The merge-base is now dev's tip, so each future dev commit applies cleanly. Workflow documented in CLAUDE.md.
  - Modified: `CLAUDE.md`, `wiki/Version-History.md` (plus the historical `align(adviser-modal-css)` commit + the merge commit, already on main)

- fix(projects+quokka): polish round — composer overlap, project-aware edit modal, desktop sub visibility, sort-by-due, vertical fill, chained-create ids [M]
  - **Single PR bundling A–E from the bug-dump conversation plus the highest-impact Quokka fixes from the sub-agent analysis.** All shipped together because they're entangled with the same projects+subs workflow.
  - **A. Quokka modal overlap.** The "APPLIED N CHANGES" green bar and the composer were two independent `position: sticky` blocks at different `bottom:` offsets — they collided on commit. Replaced with a single `.v2-adviser-footer` flex column that contains both bars + the composer in one sticky-bottom unit. No more overlap; action buttons stay reachable.
  - **B. Project-aware EditTaskModal.** When `task.status === 'project'`: modal title becomes "Edit project" / terminal `> project --edit`, the project-controls section now lists every sub with a one-tap shortcut (sorted by due date, done/backstage styling), the "Move to projects" affordance hides, the delete button title warns about orphaning. When `task.parent_id` is set: a prominent "📁 Sub of [Project] ›" banner sits above the title input, tappable to open the parent's edit modal. Title becomes "Edit sub" / terminal `> sub --edit`. Placeholders adapt to context. New props: `childTasks` + `onOpenTask`.
  - **C. Pinned-project subs no longer disappear on desktop.** Pre-fix, `useTasks` unconditionally filtered active children of pinned projects out of `openTasks` to prevent double-render under the ProjectPinnedSection — but Kanban (desktop) doesn't draw that section, so subs vanished entirely. Now `useTasks` exports `isPinnedChild` and `openTasks` includes everything; AppV2's mobile path applies the filter via `dropPinnedChildren`, desktop shows everything in natural status columns. Bug repro from the user: subs only showed when the project's status changed away from `'project'` — now they show in the right column regardless.
  - **C2. "In main list" badge no longer overlaps the energy chip.** Moved the per-sub visibility toggle out of `position: absolute; top: 8px; right: 8px` (which overlapped the TaskCard's energy icon) onto its own row below the sub card via `.v2-pv-visibility-row`.
  - **D. Sort subs by due date.** Both the ProjectPinnedSection card and the ProjectsView drill-down now sort active children ascending by `due_date` (no-due-date last). Drag-to-reorder remains a follow-up.
  - **E. Quokka desktop vertical fill.** New `flexBody` prop on ModalShell (opt-in) makes the modal a flex column with the header fixed and the body filling remaining height — no global modal behavior change. AdviserModal opts in. The messages container takes `flex: 1` on desktop with `max-height: none`, scrolls internally; mobile keeps the `60dvh` cap so the keyboard doesn't crush messages.
  - **F. Quokka chained-create ids actually work now.** Sub-agent diagnosed the painful "(missing task 61163db8)" preview from the bulk-test session: when the model staged `create_task(project)` then `create_task(sub, parent_id=??)`, no real id existed yet because ids were generated at `execute` time, not at stage time. The model fell back to hallucinating ids. Fix: new `preStage(input)` hook on tool defs. `create_task` opts in — it generates the real `task-${ts}-${hex}` id at stage time, returns it to the model as `id` in the staged response, and stamps it into `step.input` so `execute` uses the same id at commit. System prompt rule 9 updated to explain.
  - **F2. Stage-time validation surfaces id-reference errors to the model.** New `stagedValidate(input, session)` hook. `create_task` rejects a `parent_id` that doesn't match any real task or any staged-create in the same plan; `update_task` does the same for its `id`. Errors come back as tool-result text so the model self-corrects in-loop instead of failing the whole commit. `taskLabel()` falls back to looking up the session plan, so previews say "Foo (pending)" instead of "(missing task abc12345)" when referencing a not-yet-committed sibling.
  - **F3. System prompt deferral rule.** New rule 0 at the top: "if the user signals incoming context ('wait', 'I'll send more info', 'before you do anything'), respond with text only and DO NOT call mutation tools." Cheapest fix for the user's #1 frustration from the transcript — Quokka jumping ahead of the brief.
  - **Out of scope.** Backgrounded PWA (chat continues server-side while app is closed) hasn't landed yet; that's the next conversation. Drag-to-reorder subs is a future enhancement.
  - Modified: `adviserTools.js`, `adviserToolsTasks.js`, `server.js`, `src/hooks/useTasks.js`, `src/v2/AppV2.jsx`, `src/v2/components/AdviserModal.jsx`, `src/v2/components/AdviserModal.css`, `src/v2/components/ModalShell.jsx`, `src/v2/components/ModalShell.css`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/v2/components/ProjectsView.jsx`, `src/v2/components/ProjectsView.css`, `src/v2/components/ProjectPinnedSection.jsx`, `scripts/check-terminal-buttons.js`, `wiki/Version-History.md`

- fix(quokka): orphan sub-tasks + duplicate-delete crash + chat bar disappearing [M]
  - **Bug A — orphan sub-tasks.** Quokka asked to "build out sub-tasks for the vacation project" created 8 top-level tasks with NO `parent_id`. The model would then try a follow-up `link_task_to_project` for each, but `search_tasks` only returns 20 hits by default and the model couldn't find them all → most stayed orphan. Root cause: `create_task` schema didn't accept `parent_id`, forcing a two-step create-then-link workflow.
  - **Fix A.** `create_task` schema gains `parent_id` + `child_visibility` + `pinned_to_today` + `nag_allowed`. The new task is linked at creation time — no follow-up tool call. `update_task` gains the same four fields so existing orphans can be linked with a single call instead of a separate `link_task_to_project`. `TASK_FIELDS` updated so `pickTaskUpdates` passes them through. `child_visibility` defaults to `'active'` when `parent_id` is set (matches the manual "+ Add child step" UI). Validation: parent must exist and can't be self.
  - **Bug B — duplicate delete crashes the whole plan.** When Quokka searched multiple times to find tasks to delete, it sometimes staged the same task id for delete twice. `commitPlan` runs steps sequentially: step 1 succeeds, step 5 calls `getTask(id)`, gets null, throws `Task not found: ...`, the whole plan rolls back, nothing actually gets deleted. User saw the error message + no changes.
  - **Fix B.** `delete_task` is now idempotent — already-gone target returns `{deleted: false, already_gone: true}` instead of throwing. Duplicate delete steps in a plan are now safe.
  - **Bug C — chat bar disappears.** When chat history grew past the viewport, the composer (input + send button) scrolled out of view. User had no way to type without scrolling back down first.
  - **Fix C.** Composer wrapped in `position: sticky; bottom: 0` so it pins to the bottom of the modal scroll container. Confirm-bar and committed-bar stick just above it so the action buttons stay visible too. Hairline border + surface-color background so it reads as anchored to the modal frame.
  - **Also touched.** Updated system-prompt rule 9 to explicitly tell the model when to use a project-with-subs structure (vs a one-task-with-checklist structure) and that `parent_id` belongs on `create_task` itself. Updated `create_task` and `update_task` tool descriptions to call out the same.
  - Modified: `adviserToolsTasks.js`, `server.js`, `src/v2/components/AdviserModal.jsx`, `src/v2/components/AdviserModal.css`, `wiki/Version-History.md`

- feat(projects): "+ New project" button inside the Projects modal [XS]
  - **The hole.** After the projects-integration feature shipped, projects were first-class — but the only way to *create* one was the legacy "create a regular task, open EditTaskModal, hit Move to Projects" path. Awkward when the Projects modal is the primary surface for managing them.
  - **Fix.** New `+ New project` button in the ProjectsView toolbar. Click → ProjectsView closes, AddTaskModal opens with a project-flavored title (`New project` / terminal `> project --new`), explanatory banner ("silent by default, no nags unless you set a due date or opt in"), and the created task lands directly as `status='project'`. EmptyState also gains a tappable CTA when no projects exist yet so first-time users have an obvious way in.
  - Plumbing: new `createAsProject` boolean state on AppV2 mirrors the existing `addChildOfProject` pattern. `handleAddTask` reads the flag and bumps status post-creation. Both context flags clear on close.
  - Modified: `src/v2/components/ProjectsView.jsx`, `src/v2/components/ProjectsView.css`, `src/v2/components/AddTaskModal.jsx`, `src/v2/AppV2.jsx`, `wiki/Version-History.md`

- copy(projects): "children" → "subs" everywhere user-visible [XS]
  - **Why.** "no children · no sessions · budget 20" sounded clinical/awkward on the Projects modal meta line. User preference: subs.
  - **Visible strings updated.** ProjectsView meta `"no children"` / `"X/Y active"` → `"no subs"` / `"X/Y subs"`. Empty drill-down `"No child tasks yet."` → `"No subs yet."` Empty Projects state body mentions "subs" explicitly now. Pinned-section meta `"N active steps"` → `"N active subs"`. Cap-feedback strings `"complete a child or the project"` → `"complete a sub or the project"`. Add-child buttons relabeled `"Sub"` (was `"Step"`). AddTaskModal title `"New step in X"` → `"New sub in X"`; banner copy + placeholder updated to match. Tooltips and aria-labels harmonized.
  - **Code names unchanged.** `child_visibility`, `parent_id`, `getChildTasks()`, `getChildren`, `activeChildren`, `onAddChild` etc. stay as-is — they're internal terminology, not user-facing.
  - Modified: `src/v2/components/ProjectsView.jsx`, `src/v2/components/ProjectPinnedSection.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/AddTaskModal.jsx`, `wiki/Version-History.md`

- fix(projects): mobile layout — title truncated to "Canc...", actions too cramped [XS]
  - **Bug.** ProjectsView card rendered chev + title + meta + 3 action buttons all on one row. On a narrow viewport (iPhone, etc.) the title got `text-overflow: ellipsis`-clipped to "Canc..." for any project longer than ~5 characters, and the icon-only Pin/Add/Edit buttons jammed against the title's right edge with no breathing room.
  - **Fixes (`ProjectsView.{jsx,css}`):**
    - Restructured card from horizontal `[chev][title][meta][actions]` flex to vertical: top row is `[chev][title + meta column]`, bottom row is `[actions]` with `margin-left: 22px` to align past the chev. Wraps cleanly at any width.
    - Title now wraps (`word-break: break-word`, removed `white-space: nowrap`) instead of truncating. Long project names render across multiple lines instead of "Canc...".
    - Action buttons gained text labels next to their icons ("Pin"/"Pinned", "Step", "Edit") for finger-target clarity.
    - Added a `pinned` chip next to the meta line so the pin state is glanceable without relying on icon color alone.
  - **Also touched `ProjectPinnedSection.css`:** `.v2-pp-title-row` now allows wrap so the same crowding can't happen on the main-list pinned card if the title + due date overflow a narrow viewport.
  - Modified: `src/v2/components/ProjectsView.jsx`, `src/v2/components/ProjectsView.css`, `src/v2/components/ProjectPinnedSection.css`, `wiki/Version-History.md`

- feat(projects): pinning, session logging, parent/child, nag policy, "set aside" snooze [L]
  - **The problem.** Projects (status='project' tasks) were buried in a separate modal and contributed nothing to daily progress — a project would sit untouched for weeks not because it didn't matter but because it was out of sight, out of mind. The user explicitly wanted: integrate projects into the daily flow, count session work toward points/streak, keep nags off by default but allow them when there's a deadline, and add a "later, fuck off" snooze for everything else.
  - **Data model (migration 028).** Eight new columns on `tasks`: `parent_id` (self-FK + index), `pinned_to_today` (project pin), `nag_allowed` (project-level escalation opt-in), `session_count` + `last_session_at` + `session_log_json` (session tracking), `child_visibility` ('active' = surfaces in main list under pinned parent, 'backstage' = drill-down only), `snooze_indefinite` ("set aside" flag).
  - **Points model.** Per-session credit = `effort_budget × 0.10`, capped at 10 sessions per project before requiring a real child completion or project close. Budget = `max(project's own size×energy, sum of children's size×energy, 20-pt floor)`. Naturally scales — vacation with 8 child tasks (200pt budget) earns 20pts per session; tiny solo project earns the floor. Sessions also bump the daily-task counter, contribute to streak (extended `computeStreak` in `src/store.js`), and write an `activity_log` entry. Server is authoritative via `logProjectSession()` in `db.js`; client falls back to optimistic local state if the network call fails.
  - **Main list integration.** New `ProjectPinnedSection` component renders pinned projects at the top of the v2 main list (above Doing/Stale/Up next). Each pinned project card shows session count, days-since-last-touched, budget, child count, and three primary actions: Log session / Add step / Edit / Unpin. Active children (`child_visibility='active'`) surface as indented `TaskCard`s under the parent with a `↳` continuation glyph. Backstage children stay in the Projects modal drill-down.
  - **Nag policy.** Projects stay silent by default. Toggle `nag_allowed` on per-project to enable calm stale/nudge notifications even without a deadline. Set a `due_date` and normal escalation rules apply regardless of the toggle (the toggle UI gets disabled with explanatory text). New shared `isNotifiable(task)` helper in `db.js` replaces the hardcoded `ACTIVE_STATUSES.includes(...)` filter across all four notification surfaces — push, email, pushover, digest. Also folds in `snooze_indefinite` (set-aside tasks never notify).
  - **"Later, fuck off" snooze.** New snooze option labeled "Later — set aside" on both v1 and v2 `SnoozeModal`. Sets `snoozed_until = 2099-12-31` + `snooze_indefinite = true`. Task lives in the Snoozed section but never auto-resurfaces. `formatSnoozeLabel()` recognizes the sentinel and renders "set aside" instead of a date. v2 SnoozeModal also gains an "↺ Bring back now" affordance at the top of the modal when the task is already snoozed — works for both time-bound snoozes and indefinite set-asides.
  - **EditTaskModal extensions.** Project tasks get a "Project" section with pin toggle, nag-allowed toggle (auto-disabled when a due date is set), session-count meta, Log Session button, and Add Child Step button. Non-project tasks get a "Project link" section with a parent-project dropdown and (when linked) a "Show in main list" visibility toggle. All four new fields ride through the existing autosave debounce — no manual save needed.
  - **ProjectsView drill-down.** Replaced the flat list with expandable per-project cards: tap to drill in and see children grouped Active/Other. Active children render as full `TaskCard`s (so they can be completed/snoozed in place); Other (done/cancelled/backlog) render as compact rows. Each project card surfaces a Pin toggle, Add Child button, and Edit shortcut directly.
  - **Quokka tools (5 new in `adviserToolsTasks.js`).** `list_project_children`, `pin_project_to_today`, `log_project_session`, `project_set_nag_policy`, `link_task_to_project`. All follow the existing capture-and-restore compensation pattern. `summarizeTask()` now exposes the new fields so Quokka can read them. Updated `move_to_projects` description to mention the silent-by-default behavior so the model knows about `project_set_nag_policy`.
  - **Server endpoints (2 new in `server.js`).** `GET /api/projects/:id/children` returns project + children + budget + session points + cap. `POST /api/projects/:id/log-session` logs a session and returns the awarded points (or 409 when capped).
  - **Out of scope.** Recurring routines as projects, GCal sync for child tasks, AI-suggested next steps for projects, weekly-pattern analytics on session frequency, dedicated project view on desktop kanban. Dark-mode QA pass on the new components also deferred — terminal mode covered explicitly; light/dark inherit base v2 surface tokens.
  - Modified: `migrations/028_project_pinning_and_sessions.sql` (new), `db.js`, `server.js`, `pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, `digestBuilder.js`, `adviserToolsTasks.js`, `src/api.js`, `src/store.js`, `src/scoring.js`, `src/hooks/useTasks.js`, `src/components/SnoozeModal.jsx`, `src/components/SnoozeModal.css`, `src/v2/AppV2.jsx`, `src/v2/components/SnoozeModal.jsx`, `src/v2/components/SnoozeModal.css`, `src/v2/components/TaskCard.jsx`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/AddTaskModal.css`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/v2/components/ProjectsView.jsx`, `src/v2/components/ProjectsView.css`, `src/v2/components/ProjectPinnedSection.jsx` (new), `src/v2/components/ProjectPinnedSection.css` (new), `scripts/check-terminal-buttons.js`, `CLAUDE.md`, `wiki/Features.md`, `wiki/Architecture.md`, `wiki/Version-History.md`, `README.md`

- fix(gmail): much stricter classifier — kill MFA / OTP / sign-in noise [S]
  - **Bug.** The Gmail auto-add was creating pending tasks for verification codes, sign-in alerts, password resets, and other transactional noise. The system prompt had a one-liner "don't create tasks for password resets" but no explicit reject categories, no temperature pin, and no cheap pre-filter — so the model was inventing actions ("Enter verification code 487291", "Review sign-in attempt") out of obvious junk.
  - **Fixes (all in `gmailSync.js`):**
    - **Pre-filter (Phase 0).** New `isObviousJunk(subject, from)` runs before the tracking-regex scan. Tight subject/sender patterns catch verification codes, OTP, 2FA, sign-in attempts, magic links, password reset/changed notifications, "confirm/verify your email", suspicious-activity alerts, "was that you", auto-replies, undeliverable bounces, and common transactional sender shapes (`noreply@accounts.*`, `security-alerts@*`, `verify@*`, etc.). Match → mark processed as `skipped` immediately. Saves AI tokens AND avoids the digit-regex misfiring on auth codes.
    - **Strengthened system prompt.** Reframed as a strict classifier with "default to skip" guidance. Explicit ALWAYS-SKIP list (15+ categories including all the noise types above plus marketing, social, system alerts, calendar invites already on GCal, etc.). Explicit short ONLY-CREATE list (appointments, bills with real due dates, documents to sign, returns, RSVPs, real human asks, government deadlines, medical follow-ups). Every result now includes a required `reason` field so the user (via server logs) can see exactly why something was classified the way it was.
    - **Temperature pinned to 0.** Deterministic, conservative output — drift away from "skip" should require strong signal, not a creative roll.
    - **Reason logged.** AI's `reason` is appended to every `[Gmail]` log line (created task, created package, skipped). First diagnostic surface when the filter is too strict or too loose.
  - **Pre-filter smoke test.** 20/21 obvious-junk subjects flagged; 0/7 real tasks falsely flagged. The one miss ("Your password was changed" with "was" between the words) was fixed by widening the pattern to `password (?:was |has been )?(?:reset|changed|updated)`.
  - **Out of scope.** Moving pending Gmail items out of the main task list into a dedicated Suggestions inbox surface (the user's "wrapped into suggestions" suggestion) — that's a separate UX change, this PR keeps the existing pending-review UX (yellow border + Keep/Dismiss on cards). The AI-smartness fix is what the actual complaint was about.
  - Modified: `gmailSync.js`, `wiki/Version-History.md`, `CLAUDE.md`

- feat(activity-log): fully wire activity log to all task mutations [S]
  - **Bug.** The Activity Log in the v2 overflow menu was almost always empty. `ACTION_LABELS` in `ActivityLog.jsx` declared seven action types (created, completed, deleted, status_changed, edited, snoozed, priority_changed) but `logActivity()` was only called from three places: complete, delete, and skipped (chain-step). Creates, edits, snoozes, status changes, priority flips, and reopens all silently dropped on the floor.
  - **Fix.** Wire `logActivity()` into every user-facing mutation in `src/hooks/useTasks.js`:
    - `addTask` → `created`
    - `addSpawnedTasks` → `created` per task (covers routine spawns, markdown import, GCal pull, etc.)
    - `snoozeTask` → `snoozed`
    - `updateTask` → `priority_changed` if `high_priority`/`low_priority` touched; `edited` if any of `title`/`notes`/`tags`/`due_date`/`size`/`energy`/`energyLevel`/`checklist_json`/`attachments` touched; otherwise no entry (filters out background housekeeping like `size_inferred` flips, sync-back assignments, `weather_hidden` toggles)
    - `uncompleteTask` → `reopened`
    - `changeStatus` → `completed` for done transitions, `reopened` for coming-out-of-done, `status_changed` for everything else (project, backlog, waiting, doing)
  - **UI.** Added `reopened` + `skipped` to `ACTION_LABELS` and `ACTION_TONE` (the `skipped` action was already being logged from AppV2's chain-step path but had no label/color, so it was rendering as bare action name). Updated empty-state body text to enumerate all logged action types.
  - **Out of scope (left for future).** UI filters still just toggle "All / Deleted." With more action types now flowing in, faceted filters (by action, by date) would help — but this is the wiring fix the user asked for, not a UI redesign. localStorage 500-entry cap unchanged.
  - Modified: `src/hooks/useTasks.js`, `src/v2/components/ActivityLog.jsx`, `wiki/Version-History.md`

- fix(notifications): v2 Settings missing digest config; digest test failed silently [S]
  - **Bug.** "Test digest" button in v2 Settings → Notifications returned a generic "Send failed" with no useful info. There was no UI anywhere in v2 to opt a specific channel into the digest, so even with push/email/pushover channel masters on, all three `*_digest_enabled` flags defaulted to falsy and `sendDigestNow()` skipped every channel.
  - **Causes.** (1) v2's `NotificationsPanel` never exposed the three per-channel digest toggles (`push_digest_enabled`, `email_digest_enabled`, `pushover_digest_enabled`) or the `digest_time` picker — v1 has them all under "Morning Digest" but v2 omitted the whole block. (2) `sendDigestNow()` returned `{success: false, fired: [], skipped: [...]}` with no `error` field when no channel delivered, so the v2 test runner fell back to the generic "Send failed" message. (3) The test button's `enabled` predicate checked channel masters, not the digest opt-in flags — so the button was clickable even when nothing could deliver.
  - **Fixes.**
    - Add "Daily digest" block to v2 `NotificationsPanel` with three per-channel toggles (each disabled if its channel master is off), digest-time picker, and explanatory hints.
    - `sendDigestNow()` now returns a clear `error` string when `fired.length === 0`, listing each channel and why it was skipped.
    - Test-digest button `enabled` predicate now requires at least one `*_digest_enabled` flag to be on.
  - Modified: `src/v2/components/SettingsModal.jsx`, `pushoverNotifications.js`, `wiki/Version-History.md`

- fix(notifications): v2 Settings never wired up web-push subscribe flow [S]
  - **Bug.** Toggling "Web push" ON in v2 Settings → Notifications never triggered an iOS notification permission prompt, never registered a device subscription, and never caused Boomerang to appear in iOS Settings → Notifications. Web push couldn't actually deliver.
  - **Cause.** v2's `NotificationsPanel` only flipped the server-side `push_notifications_enabled` boolean. It never imported `usePushSubscription`, never called `Notification.requestPermission()`, never called `pushManager.subscribe()`, never POSTed an endpoint to the server. v1 has the correct flow (the "Enable on this device" button at `Settings.jsx:2625`) but v2 has been the default since the 2026-05-03 cutover, so anyone who newly enabled web push in v2 silently got no delivery. Server-side `subscription_count` could still read >0 because of stale subscriptions from before the cutover, hiding the bug from the diagnostic endpoint.
  - **Fix.** Wire `usePushSubscription` into v2 `NotificationsPanel`. When `push_notifications_enabled === true` and the device isn't yet subscribed, render an "Enable on this device" button that runs the full subscribe handshake (permission prompt → pushManager.subscribe → POST endpoint). When subscribed, render a "Disable on this device" button. Surface any subscribe error inline.
  - Modified: `src/v2/components/SettingsModal.jsx`, `wiki/Version-History.md`

- fix(settings): notification history showed "Invalid Date" on every row [XS]
  - **Bug.** Notification history list rendered every timestamp as "INVALID DATE" in both v1 and v2 Settings.
  - **Cause.** Server's `GET /api/notifications/log` returns rows with `sent_at` (matching the SQLite column name), but both `Settings.jsx` and v2 `SettingsModal.jsx` read `entry.timestamp` — a field that doesn't exist on the response. `new Date(undefined)` → Invalid Date.
  - **Fix.** Read `entry.sent_at` in both components. No server-side change.
  - Modified: `src/components/Settings.jsx`, `src/v2/components/SettingsModal.jsx`, `wiki/Version-History.md`

- fix(ui): tighten PWA manifest for iOS install recognition [XS]
  - **Why.** Diagnosing Pushover-on-iOS deep-link UX. Tapping a notification opens Safari (per Pushover settings), but Safari was not showing the "Open in Boomerang" affordance that hands a URL off to an installed PWA. iOS Safari's PWA install-matching logic is opaque, but `id` (stable identity anchor) and explicit `scope` are documented prerequisites for reliable association across manifest updates. Current manifest had neither.
  - **Fix.** Add `id: '/'`, explicit `scope: '/'`, and `handle_links: 'preferred'` to the VitePWA manifest. `id` anchors PWA identity so iOS doesn't treat post-update manifests as a different app. Explicit `scope` removes ambiguity vs. the implicit start_url-derived default. `handle_links` is a Chrome-respected hint that doesn't hurt Safari.
  - **iOS users must delete + re-add the Home Screen icon** for changes to take effect — iOS caches the manifest at install time. Manifest changes have zero effect on already-installed PWAs.
  - **What this does NOT solve.** iOS does not deep-link from third-party apps directly to PWAs — that's a platform limitation. Best case after this change is "Pushover → Safari → tap 'Open in Boomerang' banner → PWA" (one extra tap). If the banner still doesn't appear after re-install, we've hit the iOS ceiling and the options narrow to (a) live with manual app-switch after Pushover, or (b) Capacitor wrap.
  - Modified: `vite.config.js`, `wiki/Version-History.md`

---

## 2026-05-16

- fix(terminal): three small RoutinesModal bugs [XS]
  - **Double plus on "new routine" button.** Terminal CSS renders `[ + ` as a `::before` prefix; the JSX also rendered a Lucide `<Plus>` SVG icon, so terminal users saw `[ + + new routine ]`. Hide the SVG when in terminal mode via `.v2-routine-new-btn > svg { display: none }`. Light/dark themes still get the proper icon.
  - **Priority `[ normal ]` center-aligned.** Both modes: button text was inheriting browser-default `text-align: center`, so the bracketed text floated mid-row in habit mode (full-width section) and mid-column in auto mode (half-width grid cell). Added `text-align: left` to `.v2-form-pri-toggle` under the terminal selector.
  - **Auto-roll `[ on ]` / `[ off ]` center-aligned.** Same cause; same fix on `.v2-form-toggle`.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- fix(terminal): auto-roll toggle no longer renders as a chromed button [XS]
  - **Why.** Production sighting on v1.6.0 — the auto-roll On/Off toggle in the RoutinesModal form rendered with rounded-rectangle button chrome in terminal mode, breaking the no-button-chrome idiom that every other control follows. The `.v2-form-toggle` class had base styling but no terminal-mode override; the check-terminal-buttons script had it listed under EXEMPT with a misleading "sub-element" comment, which silenced the guard.
  - **Fix.** Terminal-mode rules added to `src/v2/terminal/init.css`: transparent background, no border, bracket prefix/suffix (`[ on ]` / `[ off ]`) matching `.v2-form-pri-toggle`. Off renders muted, On renders accent + glow.
  - Removed `v2-form-toggle` from `check-terminal-buttons.js` EXEMPT so the guard will catch future regressions on this class. Confirmed `OK — 64 classes checked`.
  - Modified: `src/v2/terminal/init.css`, `scripts/check-terminal-buttons.js`, `wiki/Version-History.md`

- release: v0.12.0 — activity prompts (auto-roll, habit mode, suggestions) to main [L]
  - Bump version 0.11.0 → 0.12.0. Ship the full Activity-Prompts feature set from `dev` to `main`. Three user-facing features land together: routine `auto_roll` (medication-style — missed days roll the existing task forward instead of stacking), `spawn_mode: 'habit'` (target-frequency tracking with `+ Log it` button and behind-pace push nudges), and a weekly pattern-detection scan that surfaces routine suggestions from completed-task history. Plus a snooze-leak fix that stops the dispatcher from nudging on items the user explicitly silenced.
  - **Schema deltas:** migrations 025 (`auto_roll`), 026 (`spawn_mode` + `target_count` + `target_period`), 027 (`pattern_suggestions` table). Existing rows unaffected — every new field defaults safely.
  - **Notifications matrix gains two rows:** `habit_nudge` (push priority-0 only, never Pushover) and `routine_suggestion` (weekly; push + email default-on, pushover opt-in). Settings UI auto-renders both.
  - **New surfaces:** v2 SuggestionsModal accessible via overflow ⋯ → Suggestions. v2 RoutinesModal gains Auto/Habit segmented picker + auto-roll toggle. Quokka gets `list_suggestions` / `dismiss_suggestion` / `snooze_suggestion` tools.
  - **Durability:** `pattern_suggestions` is server-only, outside the `/api/data` bulk-PUT path — same posture as `notification_log` post-2026-05-08 wipe.
  - **Docs:** README updated with Routines+Habits+Suggestions line and two new notification-table rows. Spec in `wiki/Activity-Prompts.md`; comprehensive test plan in `wiki/Activity-Prompts-Testing.md`.
  - `npm audit` reports 0 vulnerabilities.
  - Modified: `package.json`, `package-lock.json`, `README.md`, `wiki/Version-History.md`

- fix(routines): priority toggle alignment in habit-mode form [XS]
  - **Why.** User: "Priority isn't aligned like the rest." In habit mode the End date / Priority row collapses to just Priority (End date is hidden) inside a 2-column grid (`v2-form-row`). With End date gone, Priority fills the left half-column with center-aligned bracketed text, making `[ normal ]` float at ~25% from the left — visually offset from every other field in the form which hugs the left edge.
  - **Fix.** Split the JSX: keep the End date + Priority row when `!isHabit`; render Priority as its own full-width `v2-form-section` when `isHabit` (same pattern as the Mode picker and the now-hidden Auto-roll section). Now `[ normal ]` aligns flush-left with the other section labels.
  - Modified: `src/v2/components/RoutinesModal.jsx`, `wiki/Version-History.md`

- feat(routines): historic-pattern detection + suggestions inbox [L]
  - **Why.** User: "I'd like the app to prompt me to add things based on historic activities." Most repeating work in Boomerang lives as ad-hoc tasks the user manually re-creates each time — patterns the app could detect and offer to routinize. This PR adds a weekly scan over 12 months of completed-task history, surfaces detected patterns in a Suggestions inbox, and lets the user accept (creates a routine with cadence-aware defaults), snooze, or permanently dismiss each one.
  - **Migration 027.** New `pattern_suggestions` table (server-only, outside `/api/data` bulk-PUT — same durability posture as `notification_log` post-2026-05-08 wipe). 12 columns including `snooze_until` for the "Not yet" action.
  - **`patternDetection.js` module.** Title normalization, interval-based cadence classification (daily / weekly / monthly / quarterly / annually), confidence score = `min(1.0, count/6) × (1 - stddev/mean)` with 0.45 floor. Annual special case: 2 occurrences with 320–400 day gap qualify. Skips clusters where the title already matches an existing routine.
  - **Optional AI clustering pass.** Gated on `anthropic_api_key`. Merges near-duplicates ("mow lawn" / "mow the grass" / "cut grass") via Claude. Bounded to 50 candidates per run to cap cost. Skipped silently when no API key.
  - **Weekly scheduler.** `startPatternDetection` adds a 1-hour tick that gates on Sunday 3am local. Single-fire per Sunday via `app_data.pattern_last_scan` marker — survives restarts.
  - **Server endpoints.** `GET /api/suggestions` (list pending, filters by snooze_until), `POST /:id/accept` (creates routine with cadence-aware defaults — daily/weekly → auto_roll, longer → plain auto), `POST /:id/dismiss` (permanent), `POST /:id/snooze` (body `{ days }`, default 14, max 180), `POST /scan` (manual trigger).
  - **db.js CRUD.** `upsertPatternSuggestion` (idempotent on `normalized_title`; dismissed/accepted rows left alone), `listPendingSuggestions`, `countPendingSuggestions`, `getPatternSuggestion`, `updateSuggestionStatus`, `snoozeSuggestion`.
  - **Notification type `routine_suggestion`.** Weekly throttle, default ON for push + email, opt-in for pushover (`=== true` gate). Push payload carries `data.suggestionsView: true` so the service worker deep-links to `/?suggestions=1` on bare tap. Matrix row added to v2 Settings.
  - **v2 SuggestionsModal.** New modal with list of suggestion cards. Each card shows title + cadence chip + sample titles disclosure + meta (`5× in past 12mo · last 3d ago · 67% match`). Three actions: Make it a routine (inline accept with defaults), Not yet (14d snooze), Dismiss (permanent). Empty state with "Run scan now" CTA.
  - **AppV2 integration.** New `showSuggestions` state, modal render, Escape handler entry, deep-link handler that reads `?task=X` (was absent from v2 — quietly fixed in passing) AND `?suggestions=1`. Lightbulb-icon menu row added to the overflow ⋯ above Activity log.
  - **Quokka tools.** `list_suggestions` (read), `dismiss_suggestion` and `snooze_suggestion` (both with rollback compensation that restores prior status / snooze_until). Quokka can list / dismiss / snooze via natural language.
  - **Dockerfile.** `patternDetection.js` added to the Stage 3 COPY list so the runtime container actually ships it (per CLAUDE.md root-level-js rule).
  - **Cross-cutting durability.** `pattern_suggestions` is server-side only, outside the bulk-PUT path. The 2026-05-07 wipe scenario can't take suggestions out.
  - **Testing.** Comprehensive test plan in new `wiki/Activity-Prompts-Testing.md` covering PR 1 + PR 2 + PR 3 + the snooze fix. Notification checks flagged as `prod` since boomerang-dev has no SMTP / Pushover / push subscription.
  - **Smoke test passes; lint 0 errors.**
  - Modified: `migrations/027_pattern_suggestions.sql` (new), `patternDetection.js` (new), `db.js`, `server.js`, `Dockerfile`, `pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, `public/boomerang-sw.js`, `adviserToolsMisc.js`, `src/v2/AppV2.jsx`, `src/v2/components/SuggestionsModal.jsx` (new), `src/v2/components/SuggestionsModal.css` (new), `src/v2/components/SettingsModal.jsx`, `wiki/Activity-Prompts.md`, `wiki/Activity-Prompts-Testing.md` (new), `wiki/Features.md`, `wiki/Version-History.md`

- feat(routines): habit mode — target-frequency tracking for things that aren't ready to be hard routines [M]
  - **Why.** User: "I'd like the app to prompt me to work out at least a couple times a week. Right now I'm not ready for it to be a routine but I need to start doing it more." Habit mode is the answer — a routine with a target frequency (`N× per week / month`) and no cadence-locked schedule. The user logs proactively when they do the thing, and gets a gentle behind-pace nudge mid-period if they're falling short. Streaks reinforce.
  - **Migration 026.** `routines.spawn_mode TEXT DEFAULT 'auto'` (auto | habit), `target_count INTEGER`, `target_period TEXT` (week | month). All NULL for the existing population.
  - **`computeHabitStats`.** New helper in `src/store.js` returns `{ period_start, period_end, completions, target, streak, behind_pace, elapsed_ratio }` from `(routine, tasks, weekStartsOn)`. Behind-pace check fires only past 30% of the period to avoid early-week nudging — Monday morning at 0/2 is fine, Thursday at 0/2 isn't. The same helper logic is mirrored inline in `pushNotifications.js` + `emailNotifications.js` so the server and client agree on period bounds and behind-pace state; the three implementations must stay in sync.
  - **Streak.** Walks backward period-by-period from the period before current. Caps at 52 to prevent runaway. Periods with `target_count = 0` (e.g., paused) skip without breaking the streak.
  - **`isRoutineDue` short-circuits habit routines** to false so they don't enter the cadence-driven spawn loop. The spawn schedule is irrelevant for habits.
  - **v2 RoutinesModal:**
    - Form: segmented Auto / Habit picker right after Title. Habit mode reveals Target count + Per (Week/Month) and hides Frequency / On day / End date / Auto-roll.
    - List: habit row renders `habit · 2× / week · 1/2 this week · 🔥3`. Behind-pace shows the count in alert color. Expanded actions: "+ Log it" instead of "Spawn now" / "Skip cycle". Log button creates a task with `status='done'` linked to the routine — counts toward the period total instantly.
  - **`logHabit(id)` in `useRoutines.js`** returns a fully-completed task; AppV2 wires it through `addSpawnedTasks` so the persistence flows through the normal task path.
  - **Behind-pace push nudge** in `pushNotifications.js`. One push per habit per 24h max, only past 30% elapsed pace, payload includes `data.habitAction = true` and `data.routineId`. Push priority-0 only — never Pushover. Body: `"1/2 this week — want to log one today?"`
  - **Inline web-push actions.** `public/boomerang-sw.js` surfaces Log it / Not today buttons when habitAction is set. Bare tap deep-links to `/?routine=<id>`. New server endpoints `/api/notifications/action/log-habit` (creates the done task) and `/api/notifications/action/not-today` (bumps push + email throttle 24h forward so the same routine doesn't re-nudge).
  - **Email habit nudge** in `emailNotifications.js` — same logic but default-OFF (`email_notif_habit_nudge === true` required). Push is the primary channel; email is opt-in for users who batch their notifications.
  - **Pushover deliberately skipped.** Habit nudges are encouragement, not alarms — Pushover's priority-1/2 ladder is wrong for "you haven't been to the gym this week."
  - **Settings UI.** Habit nudge row added to the v2 Notifications matrix. Toggles map to `push_notif_habit_nudge` / `email_notif_habit_nudge` / `pushover_notif_habit_nudge`. The pushover toggle is rendered for matrix consistency but the dispatcher ignores it.
  - **Spec status.** `wiki/Activity-Prompts.md` PR 2 section marked ✅ SHIPPED. PR 3 (pattern detection) still planned.
  - Modified: `migrations/026_add_habit_mode.sql` (new), `db.js`, `src/store.js`, `src/hooks/useRoutines.js`, `src/v2/AppV2.jsx`, `src/v2/components/RoutinesModal.jsx`, `src/v2/components/RoutinesModal.css`, `src/v2/components/SettingsModal.jsx`, `pushNotifications.js`, `emailNotifications.js`, `public/boomerang-sw.js`, `server.js`, `wiki/Activity-Prompts.md`, `wiki/Features.md`, `wiki/Version-History.md`

- fix(notifications): snoozed tasks no longer trigger nudges, overdue, stale, size, or pile-up [S]
  - **Why.** User: "I shouldn't be getting nudged for items that are snoozed." Snooze is the explicit "be quiet about this until later" signal; today every notification type except high-priority was filtering on the raw `activeTasks` set, which includes future-snoozed tasks. The user was getting "Quick win available: 'X'" pings for things they'd just snoozed.
  - **Root cause.** All four dispatchers (`pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, `src/hooks/useNotifications.js`) compute both `activeTasks` (non-terminal, non-gmail-pending) and `nonSnoozed` (the further-filtered subset). High-priority correctly uses `nonSnoozed`; overdue, stale, nudge, size-based, and the pile-up percentage branch were all leaking through `activeTasks`. The "stale" type happened to be mitigated by `isStale()`'s own internal snooze check, but the others had no defense at all.
  - **Fix.** Swapped `activeTasks` → `nonSnoozed` in every affected branch across all four dispatchers. Body text counts ("You have N open tasks") also use `nonSnoozed` since a snoozed task isn't actionable right now. Initial "any tasks at all" gate checks left as `activeTasks` (a snoozed task is still real workload, just not nudge-worthy yet).
  - **Legacy counts-style digest.** `digestBuilder.js` `buildCountsDigest` was leaking the same way (overdue / due-today / stale / "N open" counts all derived from `activeTasks`). The default curated digest already filtered correctly via `nonMuted` — only the opt-in `digest_style: 'counts'` path was broken. Now derives from `nonSnoozed`; dropped two now-dead positional parameters from its signature.
  - **Auto-roll snooze logic also fixed.** The PR 1 auto-roll path compared snooze by *date string* (`snoozed_until.split('T')[0]`), so a snooze to "today at 8pm" would be cleared because the date matches today. Replaced with timestamp comparison (`new Date(snoozed_until) <= new Date()`) so forward-looking snoozes survive the roll and only stale past snoozes get cleared.
  - **Spec updated.** `wiki/Activity-Prompts.md` adds a "Snooze as the 'not before' signal" section covering the principle across all three PRs. PR 3's `pattern_suggestions` schema gains a `snooze_until INTEGER` column for the "Not yet" action — temporary silence vs. permanent Dismiss. PR 2 spec note: behind-pace nudge needs a `next_nudge_after`-style mechanism for "Not today."
  - **Bundled into the existing PR** per user request ("Nudge bug fix I want in this") instead of carving off a separate PR. Smoke test green, lint 0 errors.
  - Modified: `pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, `src/hooks/useNotifications.js`, `digestBuilder.js`, `src/hooks/useRoutines.js`, `wiki/Activity-Prompts.md`, `wiki/Version-History.md`

- feat(routines): auto-roll flag — pills no longer stack on missed days [S]
  - **Why.** User asked for a way to add daily medication that handles missed days gracefully: "Pills has to auto roll. I can't take two sets of pills to make up for the missed one." Today's routines either skip spawning when an active instance exists or — for cadences like daily where the active instance is from yesterday — would have left a stale task on the list indefinitely. Auto-roll fixes both.
  - **Migration 025.** `routines.auto_roll INTEGER DEFAULT 0`. Opt-in per routine; existing routines unchanged.
  - **`spawnDueTasks` returns `{ spawned, rolled }`.** For auto-roll routines that find an existing non-terminal instance, instead of skipping the spawn, push `{ taskId, updates }` into `rolled` to bump the existing task's `due_date` forward to today (and clear `snoozed_until` if past). For routines without auto-roll, behavior is unchanged.
  - **Stricter terminal-status set on auto-roll path.** A cancelled / backlog / project instance shouldn't block a new spawn nor get rolled forward — those statuses are user-driven deferrals or abandonments, not active instances. The legacy non-auto-roll path keeps its original `!== 'done'` guard to avoid scope-creeping a behavior change. Cleanup of the legacy path's permissive guard is left for a future PR.
  - **Callers updated.** `src/AppV2.jsx` and `src/AppV1.jsx` now destructure `{ spawned, rolled }` and apply rolls via `updateTask` before the existing spawn-enhance path runs. Same useEffect, same trigger conditions.
  - **UI.** v2 `RoutinesModal` form gained an "Auto-roll" section between End date / Priority and Notes, with a hint paragraph and a single On/Off button. New `.v2-form-toggle` CSS rules — bordered button that uses `var(--v2-accent)` for "On" so the visual doesn't read as priority-orange. v1 RoutinesModal intentionally not updated (v1 is on its way out post-cutover).
  - **Why a stricter active-check for auto-roll.** The legacy guard treats `cancelled`/`backlog`/`project` as "active" and silently suppresses spawning — which is arguably a bug, but one that's been live for months. Auto-roll's check (`TERMINAL_FOR_ROLL`) treats those as terminal so a back-burnered pill instance doesn't get bumped forward against the user's intent.
  - **Smoke test passed.** Migration 025 applies cleanly, server boots, JS bundle parses, lint shows 0 errors (9 pre-existing warnings unrelated).
  - **Spec status.** `wiki/Activity-Prompts.md` PR 1 section marked ✅ SHIPPED. PR 2 (habit mode) and PR 3 (pattern detection) still planned.
  - Modified: `migrations/025_add_routine_auto_roll.sql` (new), `db.js`, `src/store.js`, `src/hooks/useRoutines.js`, `src/AppV1.jsx`, `src/v2/AppV2.jsx`, `src/v2/components/RoutinesModal.jsx`, `src/v2/components/RoutinesModal.css`, `wiki/Activity-Prompts.md`, `wiki/Features.md`, `wiki/Version-History.md`

- docs(spec): activity prompts — auto-roll, habits, historic suggestions [S]
  - **Why.** User: three related needs surfaced in one ask — "prompt me to add things based on historic activities," "prompt me to work out a couple times a week (not ready for it to be a routine)," and "I need to be better about taking my pills, not sure routine is the right shape." Designed all three together first per user request before any code lands.
  - **Unifying shape.** "Suggest, don't spawn." Today's routines fire on cadence whether you wanted a task or not. The three needs all want softer behavior — the schedule knows when something *might* happen; spawning is decided per-instance.
  - **Three independent mechanisms, three PRs.**
    1. **`auto_roll` flag on routines.** Solves pills. If a non-terminal instance already exists when the schedule fires, roll its `due_date` forward instead of stacking a duplicate. You can't take two sets of pills to make up for the missed one.
    2. **`spawn_mode: 'habit'` on routines.** Solves workouts. Target N per week/month, no cadence-locked schedule, no auto-spawn. Always-visible routine card with "+ Log it" button for retroactive logging. Behind-pace web-push nudge mid-week, escalating Fri/Sat, never Pushover. Per-period streak tracking.
    3. **Pattern detection → `pattern_suggestions` table.** Solves historic prompts. Weekly Sunday 3am scan over 12 months of completed tasks, normalizes titles, detects cadence (daily / weekly / monthly / quarterly / annually) by interval mean+stddev, optional AI clustering pass for near-duplicate titles. Surfaces as new `routine_suggestion` notification type (web push default-on, email/Pushover default-off) deep-linking to a review screen.
  - **Durability lesson encoded.** `pattern_suggestions` lives server-side, outside the bulk-PUT path used by `/api/data` — same posture as `notification_log` after the 2026-05-07 wipe. A future wipe can't take suggestions out.
  - **Schema deltas planned.** Migrations 025 (`auto_roll` + `spawn_mode` + `target_count` + `target_period` on routines) and 026 (`pattern_suggestions` table). PR 1 only needs the `auto_roll` column; the habit columns can land with PR 2 cleanly.
  - **Open questions deferred to PR time** documented in the spec — cadence inference for accepted suggestions, annual cadence detection with only 2 occurrences, "not yet" auto-dismiss after 3 weeks, retroactive habit log dates, habit + sequences interaction.
  - **No code yet.** Spec-first per user request: "Spec first, then PR 1." Implementation lands in three follow-up PRs starting with PR 1 (auto-roll + pills).
  - Added: `wiki/Activity-Prompts.md`
  - Modified: `wiki/Version-History.md`, `wiki/Features.md`

---

## 2026-05-12

- feat: relocate Easter-egg triggers (build row + Quokka phrase) [S]
  - **Why.** User: "Let's actually put it on the build number so I don't accidentally edit something. Also I want to trigger it with quokka if I say 'Want to play a game'." Original 7-tap location (EditTaskModal title) was too easy to fat-finger while editing real tasks.
  - **TicTacToe lifted to AppV2.** Top-level state + render. Any modal can call `openEasterEgg()` to launch it. Removed from EditTaskModal entirely (title-tap counter, state, render, import).
  - **Build row trigger.** Settings → Logs → Build code (`__APP_VERSION__`) gets a 7-tap counter inside a rolling 2s window. Same Android-build-number metaphor, just on the version display where accidental triggering doesn't matter.
  - **Quokka phrase intercept.** AdviserModal's `handleSubmit` checks user input against `/\b(?:want to|wanna|let'?s|shall we) play (?:a |an )?game\b/i` before sending to the AI. Match → fire `onOpenEasterEgg`, clear input, skip the network call. No chat entry recorded; on game close, user is back in Quokka with a clean input. WarGames reference baked into the regex variants.
  - **ModalShell `onTitleTap` prop removed** — no callers now that EditTaskModal doesn't use it.
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/ModalShell.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/AdviserModal.jsx`, `wiki/Version-History.md`

---

## 2026-05-11

- feat: no-fault streak + hidden tic-tac-toe Easter egg [M]
  - **No-fault streak.** User: "Not every day is going to have something that needs to make it to the list, and gaming the list just to put something on it to check it off seems antithetical to the goal." Right. `computeStreak` now treats "empty days" (zero completions + zero active tasks on that calendar date) as no-fault — the streak walks across them instead of breaking. Manual `free_days` still respected.
  - **`hadActiveTasksOnDay(tasks, date)` helper.** A task counts as actionable on day D if: status is active (not in backlog/projects/cancelled), `created_at <= end-of-D`, `snoozed_until` null or `<= end-of-D`, and not already completed before start-of-D. If no tasks meet this on D and D has no completions, it's a no-fault day.
  - **Easter egg — hidden tic-tac-toe.** New `TicTacToe.jsx` component. Triggered by 7-tapping the EditTaskModal title within a rolling 2s window (Android build-number metaphor — works fine in PWAs, just JS click handlers + timing). On the player's first win each day, stamps `settings.easter_egg_wins[YYYY-MM-DD] = true` and contributes +1 task + +1 point to that day's `computeDailyStats`. Subsequent wins same day: no point. Win days also count as completion days for `computeStreak`.
  - **AI difficulty:** intentionally moderate, not unbeatable. Always takes a winning move, blocks the player's winning move 70% of the time, otherwise random. Means ~30% of player threats slip through — beatable without being trivial.
  - **Persistence:** stampWin writes to localStorage via `saveSettings`, then calls `onPointEarned` which is wired to `useServerSync.flush()` so the new wins map syncs to the server immediately (otherwise a subsequent SSE hydrate would wipe the local-only change).
  - **Discoverability:** zero user-facing copy mentions the egg. Power users find it by mashing the modal title — the same way Android users discover developer options.
  - Modified: `src/store.js`, `src/scoring.js`, `src/v2/AppV2.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/ModalShell.jsx`, `wiki/Version-History.md`
  - Added: `src/v2/components/TicTacToe.jsx`, `src/v2/components/TicTacToe.css`

- style+fix: terminal stats `◎` + WhatNow icon swapped to Compass [XS]
  - **Bug.** Brand popover's stats row still rendered the colored MiniRings SVG in terminal mode — the only ring of color in an otherwise monochrome popover. User flagged it as "hasn't migrated to the new look."
  - **Fix.** Terminal CSS hides the SVG and renders `◎` (bullseye glyph) in accent color + glow via `::before` on `.mini-rings`. Rings concept preserved (per user request "I want to keep the rings concept for stats"), look matches the rest of the terminal idiom.
  - **Identity collision.** The WhatNow FAB at the lower-right used `Target` (concentric rings), the same visual identity as Stats. User: "Come up with a new icon for what's next that's not a +." Replaced `Target` → `Compass` in `FloatingCapture.jsx` (both render slots: the idle button and the open-card anchor). Compass reads as "find direction / pick a path forward" — semantically right for "what should I do now?" without overlapping with stats or with the `+` add affordance. `WhatNowModal`'s internal "Anything" capacity button keeps `Target` — semantically distinct (open-ended, no constraint).
  - Modified: `src/v2/components/FloatingCapture.jsx`, `src/v2/terminal/sections.css`, `wiki/Version-History.md`

- fix+style: EditTaskModal CTA → "Close" + restore section-count alignment [XS]
  - **CTA rename.** With autosave back (#134) and the AutosaveIndicator showing "✓ Saved" feedback (#136), the `[ Save changes ]` button no longer commits anything new — it just closes the modal. Relabeled to `Close` so the affordance reads honestly. RoutinesModal kept as-is (still explicit-save; no autosave there).
  - **Count regression.** Collapsible sections (#138) introduced `.v2-section-label-toggle .v2-section-label-count { margin-left: 0 }` to make room for the chevron — that stranded the count flush-left next to the section text instead of pushed right. The chevron also had `margin-left: auto`, which became redundant. Fix: drop the count override, drop the chevron's auto, give it an 8px gap. Count returns to the right; chevron sits beside it.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/SectionLabel.css`, `wiki/Version-History.md`

- fix+feat: label visual selection + tightened Polish + collapsible sections [M]
  - **Three bundled changes.** All client-side polish surfacing issues the user flagged in one batch.
  - **Bug — label selection invisible (especially in terminal).** `.v2-form-label-pill` in terminal CSS used `background: transparent !important` + `color: var(--v2-text-meta) !important`, which beat the inline `style={{ background, color }}` set by the active state in JSX. The user saw no visual distinction between picked and unpicked labels, and couldn't tell which were "really" selected. Fix: each pill now exposes its color as a CSS custom property `--label-color` via inline style; new `.v2-form-label-pill-active` rules read the var in both light/dark (fill the pill) and terminal (color the bracketed text + a glow). Saves were already wired correctly — the perceived save bug was the visual bug masquerading.
  - **Bug — Polish over-suggests checklists + hallucinates labels.** `polishNotes()` system prompt rewritten: explicit "DEFAULT TO null" instruction on `suggestedChecklist`, with concrete examples that do vs don't warrant one (4+ discrete actionable steps in order). Label hint rewritten to be strict: labels MUST be copy-pasted verbatim from the user's existing list; no inventing, abbreviating, pluralizing, or paraphrasing. Empty list of labels → `suggestedLabels` MUST be `[]`. Also added: "Do NOT mention labels, tags, or categories inside the notes text" so the polished body doesn't have a stray `Labels:` line referencing things that won't apply.
  - **Feature — collapsible task sections.** Tap any section header (Doing / Stale / Up next / Waiting / Snoozed) to collapse it; chevron flips `▾` / `▸`. State persists via a new `collapsed_sections` setting (map of section name → bool), so the preference survives reloads and syncs across devices via the standard `/api/data` round-trip. Use case: keep Snoozed collapsed when there's nothing time-sensitive in it; expand to peek when needed.
  - **`SectionLabel` API.** Optional `onToggle` callback flips the component into a `<button>` (vs `<div>`), adds `aria-expanded`, and renders the chevron. Existing callers without `onToggle` (search results) render as before.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/AddTaskModal.css`, `src/v2/terminal/init.css`, `src/v2/terminal/sections.css`, `src/api.js`, `src/store.js`, `src/v2/AppV2.jsx`, `src/v2/components/SectionLabel.jsx`, `src/v2/components/SectionLabel.css`, `wiki/Version-History.md`

- feat(ui): v2 AutosaveIndicator — restored everywhere v1 had it [S]
  - **Why.** User: "I used to have a save indicator at the top of the places I would edit in v1. For each theme that should come back." Then: "I want it everywhere it was in v1." v1 had the `.autosave-pill` at the top of `EditTaskModal` (driven by local `justSaved`) and `Settings.jsx` (driven by `syncStatus`). Both restored.
  - **`AutosaveIndicator` component.** Single `saved` boolean prop. Idle state reads "Autosave"; flash state reads "✓ Saved" for 2s.
  - **Light/dark.** Pill chrome: rounded, soft `rgba(text, 0.06)` bg, meta-color text. Saved flash uses the green success color (`#52C97F` on 15% bg) matching v1's `.autosave-pill-saved` palette.
  - **Terminal.** Drops pill chrome entirely. Renders as `// autosave` / `// ✓ saved` — same comment idiom used throughout terminal mode. Saved flash uses `--v2-accent` + glow.
  - **`ModalShell` `headerSlot` prop.** New optional render-prop slot positioned at the same top-row as the close X (offset 64px to its left to avoid overlap). Mirrors v1's `.autosave-pill-floating` placement.
  - **EditTaskModal wiring.** `justSaved` flag flips true inside the autosave effect's setTimeout (right after `onSave` fires), back to false after 2s. Cleanup useEffect clears the timer on unmount.
  - **SettingsModal wiring.** Same `justSaved` flag, flipped inside the existing 300ms `flushDebounceRef` debounce after `onFlush()` runs. Every settings change → debounced save → 2s flash. Cleanup mirrored.
  - Modified: `src/v2/components/ModalShell.jsx`, `src/v2/components/ModalShell.css`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/SettingsModal.jsx`, `wiki/Version-History.md`
  - Added: `src/v2/components/AutosaveIndicator.jsx`, `src/v2/components/AutosaveIndicator.css`

- fix(ui): v2 EditTaskModal — restore field autosave (v1 parity) [S]
  - **Why.** User: "Everything else used to auto save before v2. This was a regression." Correct — v1 EditTaskModal autosaved every form change on blur/onChange. v2 shipped with an explicit `[ Save changes ]` button intentionally (per the source comment: "less surprising for the new UI, easier to reason about. PR8 polish can add per-field autosave if it feels natural in use"), but in practice the modal partially autosaved anyway: status changes and the manage actions (`> archive`, `> delete --confirm`, etc.) fired immediately, while form fields (title, notes, tags, due date, size, energy, priority, checklists, attachments, comments, weather-hidden, gcal-duration) only persisted on explicit Save. The mixed behavior trained the user to expect autosave for everything; checklist edits silently dropped when they closed the modal via X.
  - **Fix.** Single `useMemo`-built `savePayload`, watched by a debounced (500ms) autosave effect. JSON-string ref-compare so reference churn on array/object state (e.g. `selectedTags`) doesn't fire spurious saves. Empty-title guard preserved. `last_touched` removed from the payload — `useTasks.updateTask` already stamps it.
  - **Unmount flush.** A separate effect with empty deps fires on unmount: if the latest payload differs from the last-saved baseline, save synchronously before the modal goes away. Closing via X / route change within the 500ms window no longer strands edits.
  - **Save button kept.** Still wired to `handleSave` — explicit flush-and-close affordance. Updates `lastSavedJson` ref so the autosave doesn't double-fire.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `wiki/Version-History.md`

- release: v0.11.0 — terminal theme + v2 milestone to main [L]
  - **What's in this release.** First merge of `dev` → `main` since the v2 cutover. Bundles every PR from 2026-05-10 + 2026-05-11. Highlights:
    - **Terminal theme family** (PR A–H) — Light, Dark, Terminal Dark (GitHub Dark), Terminal Light (GitHub Light) palettes; ASCII flourishes, monospace stack, `> verb` modal headers, `// section` labels, bracket toggles, density signals on TaskCard.
    - **No-button-chrome philosophy** in terminal — every settings control, every notification card, every modal CTA, every "add" pill flattened to sigil+text or bracket-radio idiom. Update-available modal included.
    - **Home stats line** (`📅 Sun, May 10 ▾ · 🔥 N days · ✓ N/goal today`) where the calendar date is the WeekStrip show/hide toggle.
    - **WeekStrip** lost its internal range-toggle + `today N/goal` summary (folded into home stats line). GoalProgressBar removed entirely — today's count lives in WeekStrip's today cell.
    - **EditTaskModal "add" pills** (`+ add checklist`, `+ attach files`, `+ notion`, `+ add comment`) — dashed borders dropped, flat `+ verb noun` idiom matching the `// manage` section.
    - **Markdown import** moved from overflow menu to Settings → Data.
    - Click-to-complete `[ ]` checkboxes on task cards (terminal); urgency as title text color; 700ms `[✓]` confirmation pulse.
    - Sequential typing demo on Quokka empty state; `[ object Object ]` bug fixed.
    - Theme persistence rewrite — local theme survives server hydration.
    - DateField component — `[ due date ]` opens native picker, renders `[ YYYY-MM-DD ]` filled.
    - Smoke tests for terminal-title + terminal-button coverage in pre-push hook.
  - **Audit.** `npm audit` reports 0 vulnerabilities.
  - **Decision criterion clock starts now.** Per CLAUDE.md → "Terminal Theme Stress Test", 30 days of daily terminal use → consider Light/Dark deprecation. All four palettes stay live + equal in the picker until that date.
  - Bumped: `package.json` 0.10.0 → 0.11.0, `package-lock.json` to match
  - Modified: `wiki/V2-State.md` (status flip), `wiki/Features.md` (`>` prefix, home stats line, WeekStrip behavior), `CLAUDE.md` (terminal section header)

- style(ui): terminal — flatten update-available modal [XS]
  - **Why.** User: "The reload module still has a button." The version-mismatch modal (`v2-update-overlay` / `v2-update-modal`) still rendered with rounded-modal chrome + a filled accent reload pill in terminal mode.
  - **Modal.** Drop the border-radius + drop-shadow chrome. Add a hairline border + soft accent glow ring. Match the terminal flat-card idiom used elsewhere.
  - **Title.** "Update available" → `// update available` in monospace meta.
  - **Sub copy.** "Refreshing automatically…" → `// refreshing automatically…` matching the comment idiom.
  - **Version.** Rendered in monospace accent with glow.
  - **Reload button.** `Reload now` → `[ reload now ]` — flat bracketed accent text, no fill, no pill radius. Matches every other terminal CTA (`[ Save changes ]`, `[ Done ]`, etc).
  - Modified: `src/v2/AppV2.css`, `wiki/Version-History.md`

- feat(ui): terminal — WeekStrip toggle moves to home-stats calendar date [S]
  - **Why.** User: "The weekstrip makes no sense anyway when the dates are hidden. Remove the today N and hide the '// Month dd-dd' with the dates below that are already hidden with the toggle. Make the calendar icon and the date next to it as the hide/show button." Right call — the WeekStrip had its own internal range-toggle while the home stats line above already showed today's count, so toggling the days alone left an orphan header. And the `today 3/3` in the header duplicated `✓ 3/3 today` in the stats line one row up.
  - **Behavior.** Default in terminal mode: the home stats line shows `📅 Sun, May 10 ▾ · 🔥 1 day · ✓ 3/3 today`. The WeekStrip is entirely hidden. Tapping `📅 Sun, May 10 ▾` reveals the strip (header + day cells together); chevron flips to `▴` and the date+chevron tint accent. Tap again to hide.
  - **WeekStrip simplified.** Dropped the internal `userExpanded` state, the range-label-as-button, the `today N/goal` summary, and the `alwaysOpen` prop. The component is now a "dumb display" — when mounted, it renders fully. Visibility is owned by AppV2.
  - **Light/dark unchanged.** `show_week_strip` setting still gates the strip in light/dark mode (always-visible when opted in). The new click-to-toggle behavior is terminal-only. Setting label clarified: "Show 7-day strip (light/dark)".
  - **`week_strip_always_open` preserved** — terminal users who want the strip permanently visible can flip it in Settings → General → Home screen. When on, the date-toggle button disables (no chevron) and the strip renders permanently.
  - Modified: `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`, `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — flatten EditTaskModal "add" pills [XS]
  - **Why.** Screenshot showed `+ Add checklist`, `📎 attach files`, `🔍 notion`, `+ add comment` still rendering as dashed-border boxes in terminal mode. The dashed chrome was a holdover from an earlier pass that meant to drop borders but didn't go far enough — they read as boxes, not commands.
  - **Treatment.** All four classes (`.v2-edit-add-pill`, `.v2-edit-checklist-new`, `.v2-edit-connection-pill`) collapse to flat `+ verb noun` text. Border, radius, padding chrome all dropped. Inline SVG icons hidden — the `+ ` sigil via `::before` replaces them. Hover swaps text + sigil to accent + glow, same idiom as the `// manage` section rows. Disabled state fades to 0.4 opacity.
  - **Notion search.** Stays as `+ notion` — uniform `+` sigil reads as "add this thing to the task" across all four. The button's actual behavior (search/link/create) is intact; just visually it joins the family.
  - **Light/dark unchanged.** Base CSS dashed-border treatment kept — this is terminal-only.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- feat(ui): WeekStrip days collapse by default, click range to toggle [S]
  - **Why.** User: "I want to be able to click on the calendar on the main page and have it hide/show the days under the weekly summary. It should be hidden by default and can [be] enabled permanently in settings." The strip was always-open, taking 60+px of vertical space on every load even when the user just wants the task list.
  - **Behavior.** WeekStrip default state is collapsed — only the header row renders, showing `< May 4-10 · today 3/5 ▾ >`. Clicking the range label toggles the day grid below. Nav arrows still shift the visible week; they don't fold/unfold.
  - **`week_strip_always_open` setting.** New Settings → General → Home screen toggle ("Keep day cells expanded"). When on, days stay rendered permanently and the range label loses its toggle affordance (chevron hidden, no hover bg). When off (default), the toggle works.
  - **Collapsed-header summary.** When collapsed, the header gains `· today N/goal` right after the range so users still see today's progress without expanding. Hidden when there's no today cell in the visible week (i.e., user navigated to a past/future week).
  - **Visual.** Light/dark: range becomes a hover-tinted pill, chevron rotates 180° when expanded. Terminal: range stays flat, chevron swaps to `▾` (collapsed) / `▴` (expanded) ASCII via `::after` on the toggle, accent color when expanded. Today summary renders accent color in both themes.
  - **A11y.** Toggle button has `aria-expanded` + `aria-controls` pointing at the day list. Days list gets `id="v2-week-strip-days"`. Reading the collapsed header conveys today's progress aloud.
  - Modified: `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`, `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/store.js`, `wiki/Version-History.md`

- refactor(ui): drop GoalProgressBar, fold count into WeekStrip's today cell [S]
  - **Why.** User: "Let's move the completion bar up to the top. I thought we were using the shaded boxes for that." Right — WeekStrip's intensity fill on each day cell already encodes `count vs goal` (0/some/met/2×met). GoalProgressBar duplicated the signal underneath, so the home screen had two indicators for the same number. Recommended dropping the bar and folding the exact `N/goal` count into today's cell; user approved.
  - **WeekStrip.** Today's cell gets a new `.v2-week-strip-count` line between the date number and the intensity bar, rendered only when `isToday`. Light/dark: 11px medium meta-color, accent on today. Terminal: 11px monospace accent. The intensity fill still does the at-a-glance week scan; the count gives the exact number for today without breaking the 7-cell grid rhythm.
  - **GoalProgressBar gone.** `src/v2/components/GoalProgressBar.{jsx,css}` deleted. Render removed from `AppV2.jsx`, import line dropped. `show_goal_progress` setting removed from `src/store.js` defaults + Settings → General → Home screen toggle. No migration needed — settings are a JSON blob, stale keys are silently ignored.
  - **Trade-off accepted.** Linear-percent visual is gone. Reading exact progress now means reading the fraction inside today's box. Fine — boxes are already the right shape, and one indicator beats two.
  - Modified: `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`, `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/store.js`, `wiki/Version-History.md`
  - Deleted: `src/v2/components/GoalProgressBar.jsx`, `src/v2/components/GoalProgressBar.css`

- refactor(ui): move markdown import from overflow menu to Settings → Data [XS]
  - **Why.** User: "Let's move import markdown to the data tab. I'm not positive it's going to live long. But I have it built for now. It's a rarely used function." Crowding the top-level overflow menu with a feature that may be deprecated isn't worth the slot.
  - **Settings → Data.** New "Markdown import" block sits between Activity and Danger zone. Bracketed `[ import from markdown ]` button (terminal idiom inherited from `.v2-settings-btn` class) opens the existing `MarkdownImportModal` after closing Settings.
  - **Wiring.** `SettingsModal` gains an `onShowMarkdownImport` prop, mirroring the existing `onShowActivityLog` pattern. `AppV2` passes `() => setShowMarkdownImport(true)`.
  - **Overflow menu.** "Import from markdown" row removed from the `…` menu. `Upload` lucide icon dropped from `AppV2.jsx` import list (no longer used there).
  - **No behavior change** beyond placement — the modal itself is untouched.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/AppV2.jsx`, `wiki/Version-History.md`, `wiki/Architecture.md`

---

## 2026-05-10

- fix(ui): terminal — markdown import button row alignment [XS]
  - **Why.** User: "Alignment on the buttons here is fucked." `[ preview tasks ]` and `[ upload .md ]` sat in a row but `[ preview tasks ]` was centered awkwardly in its half.
  - **Root cause.** Base CSS on `.v2-md-import-primary` sets `flex: 1` so the button expands to fill remaining space. With chrome stripped in terminal mode, the bracketed text floats centered in an invisible-but-expanded button slot. Visual mismatch with `[ upload .md ]` (which uses `.v2-settings-btn`, natural width).
  - **Fix.** Override `flex: 0 0 auto` + `margin-right: 18px` in terminal mode so the preview button takes natural width and the two buttons sit side-by-side from the row's start, with a comfortable gap between.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — DoneList reopen + load-more buttons [XS]
  - **Why.** User: "Done list reopen are buttons. Import markdown preview is a button." The markdown preview button was already fixed in #123 — the user is seeing a cached PWA build. Done-list reopen + load-more genuinely weren't touched.
  - **`.v2-done-reopen`** (per-row "Reopen" button on each completed task): hairline-bordered pill → bracketed accent text `[ reopen ]`. Hover deepens the glow.
  - **`.v2-done-load-more`** (bottom "Load more" pagination): same treatment, meta-text inactive, accent on hover.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — notif cards + logs view + analytics brackets + markdown CTA [XS]
  - **Why.** Four screenshots in quick succession (per the new batching rule):
    1. Notif cards rendered each frequency type as a bordered card with surface-bg fill — "these don't fit with the aesthetic"
    2. Logs filter chips had pill chrome + the log-stream wrapper had card border + radius — "Logs of all things should look like terminal"
    3. Stats range buttons wrapped mid-button — closing `]` orphaned on next line, "alignment on the braces looks like shit in stats"
    4. Markdown import "Preview tasks" CTA still rendered as filled-blue pill — "Import markdown preview is a button"
  - **Notification cards** (`.v2-notif-card`): bordered surface-bg card → flat row with hairline-bottom separator. Channel toggle wrapper (`.v2-notif-card-channel`) drops its tinted bg + radius. Disabled state fades opacity. `.v2-notif-cards` gap zeroed since hairlines now separate.
  - **Logs filter chips** (`.v2-settings-filter`): pill chrome → bracket-radio idiom matching `.v2-form-seg` and `.v2-settings-segment-btn`. Inactive `[ ] all`, active `[•] all` with accent + glow.
  - **Logs stream** (`.v2-settings-logs-stream`): bordered card with rounded corners + faint bg → bare div. Log rows drop their 4px radius, gain a dashed bottom hairline so consecutive entries read as a log feed. Empty state gets `// ` prefix.
  - **Stats range/metric buttons** (`.v2-analytics-range-btn`, `.v2-analytics-metric-btn`): `white-space: nowrap` + `flex-shrink: 0` so `[ 7d ]` etc. stay on one line. Parent `.v2-analytics-range` / `.v2-analytics-metric` get `flex-wrap: wrap` + `gap: 4px 8px` so the row wraps at button boundaries instead of inside buttons.
  - **Markdown import primary CTA** (`.v2-md-import-primary`): the audit miss — used by "Preview tasks" and "Import N tasks" buttons. Filled-blue pill → bracketed accent text matching `.v2-form-submit` convention.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- fix(ui): ship-prep batch — Quokka send button + autofocus + docs [XS]
  - **Why.** User feedback: "Quokka seems fixed. The paper airplane should probably be adjusted to p10k or true word only send button. There is also a bug in PWA where it drops me immediately into the text box and the keyboard covers up half the stuff." Plus the heads-up that `DateField` + `TypingSuggestions` weren't yet in `wiki/Architecture.md`.
  - **Send button** (`.v2-adviser-send`) — was rendering an airplane SVG flanked by `[` `]` brackets in terminal mode (the JSX child is `<Send>` lucide; my bracket-wrap `::before`/`::after` rules wrapped the SVG). Hidden the SVG in terminal mode via `display: none` and replaced with `[ send ]` text via `::before` content. Matches the bracketed-CTA convention used by `.v2-form-submit`, `.v2-confirm-btn-primary`, etc.
  - **Autofocus bug** — `useEffect(() => { if (open && !showHistory) inputRef.current?.focus() }, ...)` was firing the keyboard immediately on modal open, covering half the empty-state typing demo + suggestion buttons on iOS PWA. Removed. Focus moves into the input naturally when the user taps it or picks a suggestion (the existing `inputRef.current?.focus()` inside the `onSelect` callback still works).
  - **wiki/Architecture.md** — `DateField` and `TypingSuggestions` added to the v2 component family list with notes on what they do + their terminal-mode treatment. Also bumped the convention-smoke-test mention to reference both `check:terminal-titles` AND `check:terminal-buttons`.
  - Modified: `src/v2/components/AdviserModal.jsx`, `src/v2/terminal/init.css`, `wiki/Architecture.md`, `wiki/Version-History.md`

- fix(sync): terminal theme persistence — REAL fix (AppV2's hydrate also clobbered local) [XS]
  - **Bug.** PR #109 added a theme-preservation guard inside `useServerSync.js`, but the persistence bug came back. User: "The terminal setting isn't sticking still."
  - **Why #109 was incomplete.** `AppV2.jsx`'s `hydrateFromServer` callback ALSO wrote `saveSettings(data.settings)` directly — and it ran BEFORE the protected save in useServerSync. So the order on every hydrate was: (1) onHydrate clobbers local theme with server's stale value; (2) useServerSync reads localStorage to get "the local theme" — which is now the stale server value just written; (3) "preserves" it — i.e. writes it back as a no-op. Net effect: local pick gets overwritten.
  - **Fix.** Drop the `saveSettings(data.settings)` call from `hydrateFromServer`. useServerSync owns the localStorage write for settings (with the theme-preservation guard from #109). The hydrate callback now only mirrors downstream React state — `setSortBy(data.settings.sort_by)` — and lets useServerSync handle persistence.
  - Modified: `src/v2/AppV2.jsx`, `wiki/Version-History.md`

- fix(ui): quokka — typing demo types each phrase once, sequentially, no loop [XS]
  - **Bug.** Typing-prompt was effectively looping the same phrase. User: "You should b typing each line sequentially once. Not the same one over and over."
  - **Rewrite.** Each phrase types once, in order. As it finishes, it moves into a `completed[]` array (rendered as a static line) and the next phrase starts typing below it. After the last phrase, `phase` flips to `'done'` — no more animation, all phrases visible as a stack. The cursor sits on the active line during typing; completed lines fade to meta-text so the eye lands on the typing one.
  - **State model** simplified: `{ completed: string[], currentIdx, currentText, phase: 'typing' | 'holding' | 'done' }`. No erase phase, no loop.
  - **`prefers-reduced-motion`** sets `completed = phrases` immediately, no animation.
  - **Terminal mode** adds a `> ` prefix per line via `.v2-typing-prompt-line::before`; completed-line prefix fades to meta.
  - **NOTE:** PR #118 was a false-positive merge — pushed against a stale local branch ref so the diff was empty against base. This is the real ship.
  - Modified: `src/v2/components/TypingPrompt.jsx`, `src/v2/components/TypingPrompt.css`, `src/v2/components/AdviserModal.css`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- fix(ui): quokka — horizontal overflow + missed toolbar buttons [XS]
  - **Bug.** Quokka modal scrolling expanded the page horizontally — text in the empty state body, the typing-prompt line, and the suggestion buttons all extended past the visible viewport. Plus the "+ New chat" and "Chats" toolbar buttons still rendered as filled-blue / outlined-blue pills in terminal mode (audit miss — they use `.v2-adviser-tool-btn` not `.v2-adviser-btn`).
  - **Root cause #1 — `white-space: pre` on `.v2-typing-prompt`.** The longest suggestion phrase rendered as a non-wrapping single line, forced its parent wide, and cascaded the overflow up through the empty state into the modal body. **Fix:** changed to `white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word`. Preserves the visible spaces in the typed phrase but wraps when needed.
  - **Root cause #2 — audit miss on toolbar buttons.** `.v2-adviser-tool-btn` only had a font-size override in terminal mode. The base CSS still rendered borders/fills. Added explicit chrome strip: bare lowercase text, `-primary` variant gets accent color + glow.
  - **Suggestion buttons** also flattened in terminal mode: dashed bottom hairline, `> ` prefix on each row, full-width with `word-break: break-word` so long prompts wrap.
  - **Empty state** got safety constraints: `max-width: 100%`, `padding: 24px 4px 16px` (less horizontal), and `overflow: hidden; text-overflow: ellipsis` on the demo line as a fallback.
  - Modified: `src/v2/components/TypingPrompt.css`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- feat(ui): quokka — typing-prompt demo above example suggestions [XS]
  - **Why.** User: "Can you do typing text? I'd love to see that added to the examples in quokka." Adds a CLI-demo feel to Quokka's empty state — Quokka literally types out what you could ask, cycling through `PROMPT_SUGGESTIONS`.
  - **New `TypingPrompt` component.** Character-by-character typing with a blinking cursor (`_`). Cycles through provided phrases: type → hold (~1.6s) → erase → next phrase. Configurable `typeMs` / `eraseMs` / `holdMs` / `pauseBetweenMs` props. `prefers-reduced-motion` short-circuits to a static render of the longest phrase, no animation.
  - **Wiring.** Rendered inside AdviserModal's empty state, between the intro body text and the static suggestion buttons below. Standard themes give it a faint background tint + rounded corners (callout look). Terminal mode swaps to a left-hairline + `> ` prompt prefix in accent green-blue with glow, so it reads as a live CLI demo.
  - **Static buttons still ship.** The typing line is a demo; the four clickable suggestion buttons under it still give users a one-tap shortcut to populate the input.
  - Modified: `src/v2/components/AdviserModal.jsx`, `src/v2/components/AdviserModal.css`, `wiki/Version-History.md`
  - Added: `src/v2/components/TypingPrompt.jsx`, `src/v2/components/TypingPrompt.css`

- style(ui): terminal — audit-pass cleanup (settings tabs, Kanban sigils, WeatherBadge, hover glow) [S]
  - **Why.** User: "go through and look for any inconsistencies in the terminal layouts. Check everything so as to minimize what I need to tell you to go fix." Five issues found and fixed; two genuine design forks asked and confirmed as "keep both" (action vocab: sigil+text on cards vs bracketed on modal CTAs; picker idiom: underline toolbar pills vs bracket settings segments).
  - **Settings tabs** (`.v2-settings-tab` — General/AI/Labels/Integrations/etc.) had no terminal override beyond font-size; still rendered as bordered pills. Now flat text-tabs with bottom-border accent underline-on-active, matching the toolbar pill idiom (both are "navigate between sub-views" tabs).
  - **Kanban column sigils** were uniform `✦` while mobile sections used per-section sigils. Threaded a `sigil` prop through `KanbanColumn` JSX + new `data-sigil` attribute on `.v2-kanban-col-title`. Terminal CSS reads it via `attr()` so desktop matches mobile:
    - `→ doing`, `+ up next`, `… waiting`, `z snoozed`, `≈ backlog`, `§ projects`
  - **WeatherBadge** (`🌧 64°` on task meta) had no terminal treatment — picked up default font + color. Added explicit `var(--v2-font-body)` monospace + meta-text color so it blends into the rest of the card meta line.
  - **Hover glow normalization** — most accent-colored interactive elements used hardcoded rgba glows of varying intensity (6px 0.45, 8px 0.55, 12px 0.65, 14px 0.7). Standardized on `var(--v2-glow)` everywhere the color is accent. Errand-green (`✓ done` action, `[✓]` tap-active), overdue-red (`[ delete ]`), and high-pri-amber (`↷ skip`) keep their non-accent hardcoded glows intentionally — they signal a color identity distinct from "primary interactive."
  - **Two design forks confirmed as "keep both" (no action):**
    - Action vocab: card actions stay sigil+text (`☾ snooze`, `✎ edit`, `✓ done`); modal CTAs stay bracketed (`[ Save ]`, `[ apply ]`, `[ send ]`). Reads as "row-level vs commit-level."
    - Picker idiom: toolbar filter pills stay underline-tab style; settings family/mode segments stay bracket-radio style. Reads as "navigate between views vs pick one value."
  - Modified: `src/v2/components/KanbanBoard.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — `$` prompt prefix → `>` everywhere [XS]
  - **Why.** User: "Replace the terminal $ with >". `$` reads as shell-prompt; `>` reads as more universal CLI-prompt (matches our `→` section sigils + the chevron-y feel of the rest of the language).
  - **Bulk replace across all terminal-mode prompt strings:**
    - `terminalTitle` props on 15 modal call sites: `$ task --new` → `> task --new`, `$ snooze` → `> snooze`, `$ settings` → `> settings`, `$ stats` → `> stats`, etc.
    - `data-terminal-cmd` attributes on the More menu + EditTaskModal manage cluster: `$ archive` → `> archive`, `$ delete --confirm` → `> delete --confirm`, etc.
    - Header popover: `open $ stats` → `open > stats`
    - Wordmark CSS: `content: "$ "` → `content: "> "` (so the `$ boomerang_` brand wordmark becomes `> boomerang_`)
    - CLAUDE.md convention doc updated to reference `> verb` as the canonical form
  - **No JSX shape change**, just literal text. Light + dark themes don't see any of these — they remain the modal's regular `title` prop value.
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/SnoozeModal.jsx`, `src/v2/components/ReframeModal.jsx`, `src/v2/components/WhatNowModal.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/PackagesModal.jsx`, `src/v2/components/AnalyticsModal.jsx`, `src/v2/components/ProjectsView.jsx`, `src/v2/components/DoneList.jsx`, `src/v2/components/ActivityLog.jsx`, `src/v2/components/AdviserModal.jsx`, `src/v2/components/MarkdownImportModal.jsx`, `src/v2/components/Header.jsx`, `src/v2/terminal/wordmark.css`, `CLAUDE.md`, `wiki/Version-History.md`

- style(ui): terminal — settings segments → bare brackets + double completion-fade duration [XS]
  - **Why.** Settings → General Theme picker (Standard/Terminal + Light/Dark rows) still rendered as bordered button boxes despite the bare-bracket idiom used everywhere else. And user feedback on the completion fade: "Could stand to have the card and check stay a little longer. What if you double that."
  - **Settings segments.** `.v2-settings-segment-btn` overrides in flatten.css rewritten to match the `.v2-form-seg` style:
    - Inactive: `[ ] standard` (faint bracket + meta text)
    - Active: `[•] standard` (accent bracket + accent text + glow)
    - No background, no border, lowercase, monospace
    - 16px gap between options (horizontal flex-wrap)
    Reads identical to status/energy/size/etc. pickers now.
  - **Completion fade 350ms → 700ms.** TaskCard's `completeTimer` setTimeout bumped to 700ms; CSS keyframe `v2-card-completing-out` matched. The `[✓]` checkmark now holds at full opacity for the first 60% of the window (~420ms) before the slide+fade kicks in. Total time on screen for user confirmation: roughly twice as long. Reduced-motion path unchanged.
  - Modified: `src/v2/components/TaskCard.jsx`, `src/v2/terminal/flatten.css`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- fix(ui): terminal — checkbox `[✓]` persists with row fade-out on complete [XS]
  - **Bug.** When the user tapped `[ ]` to complete a task, the `[✓]` only rendered during `:active` (finger held down). The moment they lifted their finger, React processed `onComplete`, the parent filtered the task out of the active list, the card unmounted — and the user never saw a confirmation. The check felt non-existent.
  - **Fix.** Add a local `completing` state to TaskCard. On checkbox tap: `setCompleting(true)` immediately, then `setTimeout(onComplete, 350)`. While completing:
    - The card root gets `v2-card-completing` class → CSS animates a 350ms opacity-out + slight rightward slide
    - The checkbox `::before` flips to `[✓]` (errand-green + glow) via a class-based rule that wins over the default `[ ]`
    - `pointer-events: none` while fading so accidental double-taps can't re-fire
    - 350ms timer hits → `onComplete(task.id)` fires → task removed from active list → card unmounts cleanly
  - **Cleanup.** `useEffect` clears the timer if the card unmounts for some other reason (parent removes the task, navigation, etc.) so the callback can't fire on a stale instance.
  - **Light/dark unchanged.** Their Done button + swipe-to-Done paths still remove the row immediately. The fade is terminal-only — it's specifically the answer to "the checkbox tap feels invisible because the checkmark doesn't stay long enough."
  - **Reduced motion.** `prefers-reduced-motion` reduces the animation to a flat `opacity: 0.5` while fading.
  - Modified: `src/v2/components/TaskCard.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — urgency moves from checkbox glyph to title color [XS]
  - **Why.** User: "Why are you dropping the urgency? Shit is that what those were? I thought they were done check boxes." The leading `[!]` (overdue) and `[*]` (high-pri) glyphs on the checkbox were misreading as alternate checkbox states rather than urgency markers — especially now that the checkbox is a real tappable button. Suggested fix: title color for urgency.
  - **What changed.** The `.v2-card-overdue .v2-card-checkbox::before` and `.v2-card-high-pri .v2-card-checkbox::before` overrides removed. Checkbox now reads `[ ]` always (or `[✓]` on tap-active). Urgency signal moves to the title text:
    - Overdue → `.v2-card-title { color: var(--v2-alert-overdue) }` (red)
    - High-pri → `.v2-card-title { color: var(--v2-alert-high-pri) }` (amber)
    - Both (overdue + high-pri) → red wins (overdue is the more urgent of the two)
  - **Clean separation now:** `[ ]` is state (tap to complete); title color is urgency. No more "is this a different kind of checkbox?" confusion.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- feat(ui): terminal — clickable `[ ]` checkbox + drop duplicate done affordances [S]
  - **Why.** User: "I should be able to click on the empty check box squares on the tasks page and have them be marked as done. I know that is duplicative of the done slider and done button. Wondering if it actually mitigates the need for those. Thoughts? Edit and done on click AND slide already feel a little duplicative." Locked-in answer after a 2-question round: tap `[ ]` toggles done; drop `✓ done` from expanded actions; drop swipe-left gestures entirely. Terminal mode only.
  - **JSX.** Added a `<span role="button" className="v2-card-checkbox">` before the title text in TaskCard. Click handler stops propagation (so taps don't also expand the card) and calls `onComplete(task.id)`. Keyboard accessible via Enter/Space. Used `<span role="button">` rather than `<button>` because TaskCard's outer `.v2-card-main` is already a `<button>` and HTML doesn't allow nested buttons. Light/dark mode hides the element via `display: none`.
  - **CSS.** The existing `[ ]` / `[!]` / `[*]` glyphs that previously rendered on `.v2-card-title::before` moved to `.v2-card-checkbox::before` (so the user is tapping a real DOM element, not a pseudo-element). Hover lifts the bracket to accent + glow. Active state flips to `[✓]` errand-green so the tap lands visibly before the task disappears from the list. `.v2-card-action-primary` (the `✓ done` button in expand) is `display: none` in terminal — duplicate of the checkbox. `.v2-card-swipe-actions` panel hidden too.
  - **Gesture.** `handleTouchStart` and `handleTouchMove` short-circuit when `useTerminalMode()` is true so the swipe gesture itself never engages. Light/dark themes keep swipe.
  - **Expand actions in terminal now show:** `☾ snooze` + `✎ edit` (+ `↷ skip` for chain tasks). Done is no longer here — the checkbox at the top is the canonical way.
  - **Tap target.** Checkbox has `min-width: 32px` and `min-height: 32px` with negative `margin-left: -4px` to extend the hit zone slightly past the visual `[ ]` width without changing layout.
  - Modified: `src/v2/components/TaskCard.jsx`, `src/v2/terminal/cards.css`, `src/v2/terminal/flatten.css`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- fix(sync): preserve local theme on server hydration [XS]
  - **Bug.** Terminal mode preference didn't persist on refresh. User picks Terminal in Settings → Theme; refresh; back to the previous theme.
  - **Root cause.** `useServerSync.js` hydration path called `saveSettings(data.settings)` unconditionally on every SSE-triggered server fetch. If a refresh landed within the ~300ms debounce window between a local theme pick and the server flush — OR if the server was briefly unreachable when the flush fired — the hydration would overwrite the just-saved local theme with stale server data. The preference appeared to revert.
  - **Fix.** Theme is now device-local: hydrate preserves whatever local theme value was set before the hydrate ran. The reasoning: different devices have different ergonomics (laptop vs phone vs tablet) and the user might genuinely want terminal on one device and light on another. First-install case (no local theme yet) still adopts the server's theme — only an explicitly-set local theme blocks server overwrite.
  - Other settings (notification preferences, integration tokens, etc.) still sync through the bulk path. Theme is the only key the hydrate now ignores from the server.
  - Modified: `src/hooks/useServerSync.js`, `wiki/Version-History.md`

- fix(ui): edit modal — done status didn't show active state [XS]
  - **Bug.** In EditTaskModal's status row, the `✓ Done` button never showed as "selected" even when the task's current status was `done`. The user reported it as "done checkmark doesn't show up when checked; selected vs not may be inverted."
  - **Root cause.** `STATUS_OPTIONS` only contains `['not_started', 'doing', 'waiting']`, and the JSX threads the active class via `currentStatus === s ? ' v2-form-seg-active' : ''` only on the map. The `✓ Done` button is rendered outside the map as a separate "mark complete" affordance and hardcodes `className="v2-form-seg v2-edit-status-done"` with no active-state branch. Result: when `status === 'done'`, none of the four options showed the `[•]` radio dot — nothing read as currently selected.
  - **Fix.** Add `${currentStatus === 'done' ? ' v2-form-seg-active' : ''}` to the done button's className. Terminal CSS gains an override so the `v2-edit-status-done.v2-form-seg-active` state stays in the errand-green family (`[•]` dot + stronger green glow) rather than flipping to the generic accent-blue from `.v2-form-seg-active`.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- chore(ui): terminal — root-cause + sweep 32 missed button classes + add coverage guard [S]
  - **Why.** User asked why energy/auto/research/priority got missed in earlier "comprehensive button strip" passes and to proactively scan for others. Root cause analysis below; sweep covers everything found; new smoke test prevents it happening again.
  - **Root cause.** When earlier passes "generalized" the button strip, they only targeted **shared** classes (`.v2-form-seg`, `.v2-card-action`, `.v2-form-input`). v2 has several **custom-class** button shapes that exist as their own class because they needed unique sizing/icon rules: `.v2-form-energy-pill` (flex sharing), `.v2-form-ai-pill` (sparkle icon variant), `.v2-form-pri-toggle` (cycling state), `.v2-analytics-range-btn`, `.v2-adviser-history-btn`, `.v2-package-action`, etc. The generic rules never matched them. Plus I never opened AnalyticsModal, full ReframeModal, the Labels CRUD modal, or notification settings rows during this session — so their entire button surfaces never got swept.
  - **Sweep — 32 classes added in this PR:**
    - **Adviser**: `.v2-adviser-btn`, `.v2-adviser-history-btn`, `.v2-adviser-chat-icon-btn`, `.v2-adviser-chat-row`
    - **Analytics**: `.v2-analytics-range-btn` (+ active), `.v2-analytics-metric-btn` (+ active), `.v2-analytics-bd-row`, `.v2-analytics-dow-row`
    - **EditTaskModal subviews**: `.v2-edit-add-pill`, `.v2-edit-connection-pill`, `.v2-edit-checklist-toggle`, `.v2-edit-routine-toggle`, `.v2-edit-routine-row`, `.v2-edit-comment-input-row`
    - **Settings**: `.v2-integrations-toggle-row`, `.v2-notif-test-row`, `.v2-settings-log-row`, `.v2-labels-row`, `.v2-labels-icon-btn`, `.v2-notif-history-toggle`, `.v2-notif-history-chev`
    - **List rows**: `.v2-done-row`, `.v2-shortcut-row`, `.v2-snooze-custom-row`, `.v2-activity-row`
    - **Modal-specific**: `.v2-reconcile-suggestion-row`, `.v2-reframe-result-row`, `.v2-package-action`, `.v2-routine-new-btn`, `.v2-routine-action`, `.v2-activity-action`, `.v2-header-popover-row`
  - **New guard: `scripts/check-terminal-buttons.js`.** Greps every CSS file in `src/v2/components/` for class definitions matching `.v2-*-{btn|pill|toggle|seg|chip|tab|option|action|row|cta|trigger}` and asserts each one is referenced from at least one rule inside `src/v2/terminal/*.css` OR from a terminal-gated rule inside the component's own CSS (so per-component overrides like `DateField.css`'s terminal block count). Layout-only containers can be exempt-listed at the top of the script — currently 24 exemptions for things like `.v2-form-row`, `.v2-settings-row`, etc. that are pure flex containers with no chrome of their own. Run via `npm run check:terminal-buttons`. Wired into `.githooks/pre-push` between the existing terminal-titles check and the smoke test. Catches drift on every push.
  - **Baseline.** 58 button-shaped classes covered, 0 missed.
  - **Bundle.** CSS 248.6KB gzip 35.5KB (+~4.5KB sweep). JS unchanged.
  - Modified: `src/v2/terminal/init.css`, `package.json`, `.githooks/pre-push`, `wiki/Version-History.md`
  - Added: `scripts/check-terminal-buttons.js`

- feat(ui): terminal — DateField + form polish (energy/auto/research/priority as labels) [S]
  - **Why.** User feedback: "Center up the calendar row at the top. Energy type should look like labels. Same with auto, research and priority. I think date should just be the word [due date] and have it open a calendar picker. Once picked, Date format should be YYYY-MM-DD. Give me an option to clear the due date."
  - **`DateField` (new component).** Replaces the bare `<input type="date">` in AddTaskModal + EditTaskModal. Renders as a `[ due date ]` placeholder when empty, `[ YYYY-MM-DD ]` when filled, with an inline `× clear` button (only visible when filled). Tap the trigger → calls `.showPicker()` on a hidden off-screen `<input type="date">`; falls back to focus+click for older browsers. Modern support is iOS 16.4+ / Chrome 99+ / Firefox 101+, which covers what Boomerang targets. Same UX in light/dark (looks like a regular input rect with the placeholder/value text inside) and terminal (collapses to bare bracketed text).
  - **Energy type, Auto, Research, Priority → bracketed labels.** Earlier passes only stripped some of these. This pass generalizes:
    - `.v2-form-energy-pill` → `[ desk ]` / `[ people ]` / `[ errand ]` / etc. — active state keeps the inline energy-type color (so the segment legend on the form matches the chip color on the card row)
    - `.v2-form-ai-pill` (Auto, Polish, Research toggle) → `[ auto ]` / `[ polish ]` / `[ research ]` accent text + glow
    - `.v2-edit-research-go` (the inline "Go" inside the research input row) → `[ go ]` accent
    - `.v2-form-pri-toggle` → `[ normal ]` / `[ ↑ high ]` / `[ ↓ low ]` bracket text; hover lifts to accent + glow
  - **Center home-stats line.** `.v2-terminal-home-stats` was left-aligned by the default `flex` flow. Added `justify-content: center` + `text-align: center` so the date · streak · today line sits centered above the calendar.
  - **Bundle.** CSS 244.0KB gzip 35.0KB (+~3KB for energy/ai-pill/priority/date-field overrides). JS 810.5KB gzip 224.4KB (+~1KB for the new DateField component).
  - Modified: `src/v2/components/AddTaskModal.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`
  - Added: `src/v2/components/DateField.jsx`, `src/v2/components/DateField.css`

- fix(adviser): render assistant markdown as React nodes, not HTML [XS]
  - **Bug.** Quokka assistant messages were rendering as the literal string `[object Object]` whenever the message content was non-empty. Reproduced consistently on multi-step plan responses (the screenshot the user reported was a "Combine the two UPS drop off tasks" plan where the assistant text bubble between the tool calls and the planned changes showed `[object Object]`).
  - **Root cause.** `AdviserModal.jsx` used `dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}`, but `renderMarkdown()` (in `src/utils/renderMarkdown.js`) returns **React nodes**, not an HTML string. Assigning a React element to `innerHTML` calls the element's `toString()` which produces `[object Object]`.
  - **Fix.** Render `renderMarkdown(...)` as JSX children of the bubble div. Also defensive-coerce `message.content` to a string if a legacy/persisted chat happened to store it as anything else (the JS-on-server-and-client paths both currently produce strings, but the coercion is cheap insurance for stored-chat migrations or future server changes).
  - Modified: `src/v2/components/AdviserModal.jsx`, `wiki/Version-History.md`

- style(ui): terminal — comprehensive button strip across all modals [S]
  - **Why.** "We should get rid of all of the buttons when in terminal but also be aware that most of how we interact with this is mobile, so real estate is limited." Previous passes hit task-card actions + segmented controls + manage cluster + more menu, but several modal surfaces still shipped with filled / bordered button chrome.
  - **What got stripped this pass:**
    - **SnoozeModal** option rows (`.v2-snooze-row`): card chrome → flat hairline-separated rows; label rendered as `[ later today ]` accent-bracketed text. Custom-time toggle button → text-only.
    - **WhatNowModal** option list + capacity buttons + skip link: same flat-row treatment with `[ 5 min ]` bracketed labels.
    - **ConfirmDialog** buttons: cancel becomes plain meta text, danger becomes `[ delete ]` red text + glow on hover, primary becomes `[ apply ]` accent.
    - **Settings buttons** (`.v2-settings-btn` family): Connect / Test / Save / Disconnect / etc. → `[ verb ]` accent text. Danger variants get red bracket text. Strong-danger gets bold red.
    - **AddTaskModal**: priority toggle becomes a bottom-bordered transparent text pill that lights up on hover; label pills become `[ +tag ]` faint-bracketed text rows.
    - **AdviserModal** send button: `[ send ]` accent text + glow.
    - **PackagesModal** toolbar buttons: `[ refresh all ]`, `[ + add tracking ]` accent text.
    - **EditTaskModal** research button + inline edit-research input row: `[ research ]` accent text.
  - **Mobile real-estate awareness.** Where buttons were stacked vertically (snooze options, whatnow options), keep that layout because each option needs a full tap target — but with `min-height: 44px` for touch and zero card chrome, the row is denser. Where buttons were inline (settings, package toolbar, manage cluster), keep them inline; flat text wraps cleanly without extra padding.
  - **Tap-target preserved.** All flat-text buttons keep a `min-height: 32–44px` so the actual click target stays comfortable on phones — the visual flatness doesn't shrink the hit zone.
  - **Convention:** primary actions get accent + glow + brackets `[ verb ]`; secondary actions get meta-text without brackets; destructive actions get the appropriate red/amber + brackets.
  - **Bundle.** CSS 240.3KB gzip 34.5KB (+~7.8KB). JS unchanged.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — checkbox idiom inline, not stacked [XS]
  - **Why.** Last PR replaced the status segmented control's filled buttons with `[•] doing` checkbox notation but stacked the options vertically. User: "Buttons don't make sense in terminal but we need to not just stack everything vertically when we eliminate them." The fix: keep horizontal layout, just swap chrome for inline `[ ]` / `[•]` per option.
  - **Generalized to ALL segmented controls.** Previous rule only targeted `.v2-edit-status-row .v2-form-seg`; new rule targets every `.v2-form-seg` instance. So status, priority (Normal/High/Low), size (XS/S/M/L/XL/Auto), energy type (desk/people/errand/creative/physical), energy drain (low/medium/high) all get the same inline checkbox treatment in terminal mode.
  - **Layout: `flex-wrap: wrap` keeps horizontal flow.** Options sit on one line at desktop widths, wrap to additional lines on narrow phones. `gap: 4px 14px` (row × column) gives breathing room without ballooning vertically.
  - **Per-option text:**
    - Inactive: `[ ] xs` in faint bracket + meta text
    - Active: `[•] xs` in accent + cyan glow
    - Hover: text color lifts from meta to text on inactive options
  - The `✓ Done` row in EditTaskModal status keeps errand-green so it still reads as the completion action.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — toolbar buffer + checkbox-style status idiom [XS]
  - **Why.** Two specific feedback items: (1) the filter pill scroll-strip at the top of the home was sitting flush against the viewport edge — needed left/right padding to breathe; (2) the EditTaskModal status row (`not started / doing / waiting / done`) still rendered as filled segmented buttons even in terminal mode, which "made zero sense" against the rest of the bare-text aesthetic.
  - **Toolbar padding.** `padding: 8px 0` from the earlier flatten was too aggressive — restored to `padding: 8px 16px`. The first tab no longer sits flush; the scroll-strip has room to breathe.
  - **Status row → `[ ]` / `[•]` checkbox column.** In terminal mode, the segmented buttons strip all chrome, become a vertical column of bracketed text rows:
    - `[•] doing` (active — accent radio dot + glow)
    - `[ ] not started` (inactive — empty bracket, faint)
    - `[ ] waiting`
    - `[ ] done` (kept as its own row from the JSX; green errand-color since it's the completion state)
  - Mutually exclusive single-pick uses `[•]` (radio dot) rather than `[x]` (checkbox). Hover lifts inactive rows from meta to text color.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- feat(ui): terminal — init treatment for modals + theme picker reorg + global Analytics→stats [M]
  - **Why.** "Now put that same treatment on the edit menus, routines, and packages. Also globally replace analytics with stats in the terminal themes." Plus a follow-up: theme picker should be `Standard / Terminal` family with a `Light / Dark` mode underneath, not a flat 4-option strip.
  - **More menu rows** (`AppV2.jsx` + `init.css`). Each row label gets a `data-terminal-cmd` attribute (`$ settings`, `$ projects`, `$ routines`, `$ done`, `$ stats`, `$ log`, `$ import --markdown`). Terminal CSS hides the visible label text (`font-size: 0`) and renders the `$ verb` form via `attr(data-terminal-cmd)` on `::before`. Same pattern as PR F's manage-cluster labels. Hover lights the row's command text in accent + glow. Card chrome on the row dropped — flat with hairline separator below.
  - **Header popover "Open Analytics"** (`Header.jsx` + `init.css`). Span gets `data-terminal-cmd="open $ stats"`; same CSS treatment swaps the visible text in terminal mode.
  - **AnalyticsModal empty state** (`AnalyticsModal.jsx`). Wired the existing `terminalCommand` prop on EmptyState to show `// loading stats — pulling completion data` and `// no completions yet — finish a task to start seeing patterns`.
  - **Routines list rows** flatten in terminal mode. Card chrome dropped; rows become bare flat rows with hairline below. Routine title gets a `↻ ` accent prefix. Cadence/meta in monospace, no chip bg. Notes prefixed with `// `. Action buttons (pause/edit/delete/spawn) become bare lowercase text-buttons with hover glow.
  - **Packages rows** flatten. Card chrome dropped; same row pattern. Label gets a `📦 ` prefix. Status text loses its colored pill bg, becomes bracketed colored text (`[ in transit ]`, `[ delivered ]`) inheriting the existing per-status colors. Add-form panel flattens to dashed-border rect.
  - **EditTaskModal form labels** (`v2-form-label`) get the `// ` comment prefix in terminal mode + lowercase. Section headers like "Notes", "Checklist", "Attachments", "Connections" read as `// notes`, `// checklist`, etc.
  - **Theme picker reorg** (`SettingsModal.jsx`). Replaced the flat 4-option `[Light] [Dark] [Term Dark] [Term Light]` segmented control with two stacked rows:
    - **Family**: `[Standard] [Terminal]`
    - **Mode**: `[Light] [Dark]`
    Combined value still maps to the four `theme` settings: `light`, `dark`, `terminal-light`, `terminal-dark`. Helper closure derives `family` + `mode` from `settings.theme` and the click handler reconstructs the full value before saving + applying. Reads more naturally — pick a family, pick a canvas.
  - **Bundle.** CSS 231.3KB gzip 33.9KB (+~4KB modal overrides + theme picker rework). JS 809.5KB gzip 224.0KB (+~1KB JSX touches).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/Header.jsx`, `src/v2/components/AnalyticsModal.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- feat(ui): terminal — home stats line (date · streak · today) + auto-enable WeekStrip + restore brand mark [S]
  - **Why.** User's focus shifted to the main section: bring init's calendar + date-progress + fire-streak signals up there. PR-H opt-in surfaces (WeekStrip + GoalProgressBar) get auto-enabled in terminal mode so users don't have to toggle them. New segmented status line at the top renders date + streak + today's progress as three powerlevel10k cells.
  - **`📅 Sun, May 10  ·  🔥 14 days  ·  ✓ 3/5 today`.** New `.v2-terminal-home-stats` div rendered above the WeekStrip (only in terminal mode). Each cell has a meaningful color: date in muted text, streak in high-pri amber (the fire color, with soft amber glow), today in errand-green (success, with soft green glow). Separators in faint text. Streak comes from existing `computeStreak(tasks, settings)`; today comes from `dailyStats.tasksToday` / `daily_task_goal`. Pluralization handled (`1 day`, `N days`).
  - **WeekStrip + GoalProgressBar auto-enable in terminal mode.** Previously gated behind `settings.show_week_strip` / `settings.show_goal_progress` (default off). Now `(setting || isTerminal)` flips the gate — terminal mode always renders both. Light/dark users still opt-in via Settings → General → Home screen.
  - **`useTerminalMode` hook imported in AppV2.** Already existed for `terminalTitle` / `terminalCommand`; now drives the auto-enable + the new stats line.
  - **Brand `v` logo restored.** Earlier same day it was hidden ("modern brand on CLI aesthetic" misfit), but user's call: keep as a deliberate idiosyncrasy. One drop of brand color next to the prompt is fine.
  - **Bundle.** CSS 226.7KB gzip 33.5KB (+~0.4KB stats-line CSS). JS 808.2KB gzip 223.8KB (+~0.6KB stats-line JSX + useTerminalMode hook).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal theme — hide brand logo + add section dividers [XS]
  - **Why.** Side-by-side check vs init showed two remaining misfits: the orange `v` brand SVG sitting next to the `$ boomerang` prompt (modern brand mark on a CLI aesthetic — wrong vibe) and section spacing relying on whitespace alone, which wasn't doing enough visual work to separate groups (init uses a thin rule above each section).
  - **Brand logo hidden.** `.v2-header-brand > svg { display: none }` in terminal mode. The `$ boomerang_` text prompt is identity enough; the visual payload of the SVG conflicts with the bare-text feel everywhere else.
  - **Section hairlines.** Any `.v2-section-label` preceded by a `.v2-card` or `.v2-card-swipe-wrap` gets `border-top: 1px solid hairline` + extra top padding. The first section in a list (which has no preceding card) doesn't get the rule, so the page top stays clean.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal theme — per-section sigils + sigil+text action buttons [S]
  - **Why.** Locked-in design decisions from a four-question round: per-section sigils to differentiate sections at a glance (vs the uniform `✦`), and sigil+text action buttons to read as powerlevel10k segments (vs flat bracketed text). Energy chip stays top-right; status indicators stay leading-bracket — those were already right.
  - **`SectionLabel.jsx` accepts a `sigil` prop.** Defaults to `✦` (light/dark see uniform sparkle, no behavior change). The bullet span renders `✦` as inline text AND carries `data-sigil={sigil}` as an attribute. Light/dark CSS shows the inline text. Terminal CSS reads `attr(data-sigil)` via `::before`. Cost: one prop, JSX stays minimal.
  - **Per-section sigils on the home screen:**
    - `→ doing` (active, in-progress)
    - `~ stale` (squiggle, languishing)
    - `+ up next` (queued)
    - `… waiting` (pending external)
    - `z snoozed` (sleep)
    - Kanban columns keep uniform `✦` for now (different code path; a follow-up could differentiate those too)
  - **Card action buttons → sigil + text, no brackets.** Lucide icons hidden via CSS. Each action gets a meaningful glyph prefix:
    - `☾ snooze` (moon, rest)
    - `✎ edit` (pencil)
    - `↷ skip` (rotation arrow, advance chain)
    - `✓ done` (check; primary; replaces the `[ ]` bracket wrap from PR C)
  - The Done bracket wrap from PR C dropped — `::before` content goes from `[ ` to `✓ `, `::after` content empties out. Reads as `✓ done` in accent green/blue with the existing glow on hover.
  - **Bundle.** CSS 226.0KB gzip 33.4KB (unchanged — content swaps, not additions). JS +0.06KB (the SectionLabel sigil prop + AppV2 renderSection signature change).
  - Modified: `src/v2/components/SectionLabel.jsx`, `src/v2/AppV2.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal theme — revert palette to GitHub Dark/Light + powerlevel10k energy segments [S]
  - **Why.** User: "Stick with GitHub light and dark color palettes. So you don't need to completely strip everything. Incorporate our add ons like energy and whatever into the init design. Think like powerlevel10k or similar." — and a follow-up: "We can have a terminal look without losing all of the features."
  - **Palette reverted.** terminal-dark back to canonical GitHub Dark blue (`#58A6FF` accent, `#0D1117` canvas, `#C9D1D9` text, cyan glow). terminal-light back to GitHub Light blue (`#0969DA`). The structural language (powerlevel10k segments, bracketed text, bare rows, lowercased section labels with `✦` prefix) carries the init feel; the palette stays canonical.
  - **Energy chip restored as powerlevel10k segment.** Init.habits hides per-row energy info, but for Boomerang energy is real signal. Render it as a colored segment instead of a pill: emoji prefix per type + `⚡`-character bolts per level, in the energy-type color, on transparent. Lucide icon + Zap SVGs hidden via CSS. Emoji + bolt-text rendered via attribute selectors (`[title^="Desk"]`, `[title*="level 2"]`, etc.) since `task.energy`/`task.energyLevel` don't surface to the DOM. Per-type color applied to the whole segment so the prefix + bolts read as one cell:
    - 💻 desk → `var(--v2-energy-desk)`
    - 👥 people → `var(--v2-energy-people)`
    - 🏃 errand → `var(--v2-energy-errand)`
    - 🎨 creative → `var(--v2-energy-creative)`
    - 💪 physical → `var(--v2-energy-physical)`
    - ⚡ confrontation → `var(--v2-energy-confrontation)`
  - **Convention reaffirmed.** Don't strip features to chase the aesthetic. When something doesn't fit init's exact look, find the powerlevel10k-style monospace re-render (sigil + colored text segment) instead of `display: none`. Same pattern can apply to any other surface where the init reflex says "remove" but the feature is actually useful.
  - Modified: `src/v2/terminal/palette-dark.css`, `src/v2/terminal/palette-light.css`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal theme — full init aesthetic pass [M]
  - **Why.** User: "Done fucking around. Go full init aesthetic. Fuck the duplication and deviation comments from earlier." Stress test is over — the call is to commit. PR pushes the rest of the way to look like init.habits.
  - **Palette swap.** GitHub Dark blue accent → terminal green (`#7EE787`). Canvas darkened with a subtle green tint (`#0D1117` → `#0B1110`); text shifts cool gray → light green-gray (`#C9D1D9` → `#C2D1C5`). Hairlines pick up the green. Glow shadow shifts cyan → green. terminal-light gets matching green accent (`#0969DA` → `#1F8E3A`). Radii zeroed across the board (`pill: 6px → 0`, `card: 4px → 0`, `modal: 6px → 0`).
  - **Card action buttons → text buttons.** Lucide icons hidden via CSS. CSS attribute selectors render bracketed text buttons:
    - `aria-label="Snooze"` → `[snooze]`
    - `aria-label="Edit"` → `[edit]`
    - `aria-label*="Skip"` → `[skip]` (amber)
    - `aria-label="Mark done"` → `[ done ]` (existing PR C bracket prefix retained, lowercased + green)
  - Hover shifts color to bright accent + glow text-shadow.
  - **Energy chip hidden.** Init habits don't carry per-row energy badges; the title speaks for itself. `display: none` via `!important`.
  - **Section labels: lowercase + smaller + sparkle prefix.** `> DOING [6]` → `✦ doing [6]`. The chevron `>` from PR B's section bullet replaced with `✦` (init's section sparkle). Text lowercased, font dropped to 13px, count badge dimmed to faint.
  - **Wordmark tightened.** `$ boomerang_` text drops 2px more (15 → 13). Letters use accent green with glow. `$` prefix stays meta-color.
  - **Header icons** lose any background/border, become bare 16px lucide icons in meta-text color, hover to accent + glow.
  - **Filter pills further tightened.** Smaller font (12px), lowercase, gap dropped between tabs.
  - **Kanban (desktop) gets the same treatment.** Column headers lowercase + sparkle prefix + accent. Count badges bracketed. "Add task" inline button becomes `[+] add task` text. Inline add input becomes a bottom-bordered transparent field.
  - **Notes preview indented** to match init's `// description` indent under each habit (24px left padding, 11px font).
  - **Floating capture position** tightened (right: 16px → 12px) so the bare `+` glyph hugs the corner.
  - **Architecture.** New `src/v2/terminal/init.css` (~220 lines). Imported last in `terminal/index.css` so its rules override anything from earlier files. All under `[data-theme^="terminal"]`. `!important` used liberally where component CSS / inline styles would otherwise win — JSX stays untouched per the stress-test convention but the convention's "be conservative" guideline is loosened: user's call is explicit.
  - **Bundle.** CSS 223.9KB gzip 33.1KB (+~5KB). JS unchanged.
  - Modified: `src/v2/terminal/palette-dark.css`, `src/v2/terminal/palette-light.css`, `src/v2/terminal/index.css`, `wiki/Version-History.md`
  - Added: `src/v2/terminal/init.css`

- style(ui): terminal theme — deeper flatten (no row borders, bare buttons, text-tab filters) [S]
  - **Why.** First flatten pass (PR earlier today) kept hairline row separators on cards, kept thin borders on action buttons, kept the FAB as a small bordered square. Side-by-side with init.habits, all of that still reads as "modern app chrome" — init has zero borders on individual rows, zero borders on action buttons (just bracketed `[add]` text), zero borders on filter chips (just text-tabs with underline-on-active).
  - **TaskCard rows.** Top hairline `border-top` removed. Hover background tint removed. Expanded-state background tint removed. Cards become bare text on the page bg, separated by line-height alone. Status `[!]`/`[*]` glyph leading characters from the previous PR continue to do the work for overdue/high-pri.
  - **Card action buttons.** All borders dropped via `!important` (the existing `.v2-card-action` rules used inline borders that needed an override push). Snooze/Edit/Skip become bare icons with a hover color shift only. Done becomes `[ Done ]` text with cyan text-shadow glow on hover (no box, no border, no fill). The skip-advance keeps amber but loses its border too.
  - **Filter pills → text-tabs.** `.v2-toolbar-pill` background + border + border-radius wiped via `!important` (TaskListToolbar.jsx applies inline `style={{ background: label.color, borderColor: label.color, color: '#fff' }}` to active label-color filters; only `!important` defeats inline styles). Replaced with bottom-border indicator: inactive tabs are `--v2-text-meta`, active tab gets accent color + 2px accent underline + glow text-shadow. Reads like the `habits / stats / profile` tab strip in init.
  - **Toolbar icons.** Sort + search buttons drop borders entirely. Bare icons with accent-color glow on hover. The sort dropdown menu becomes a flat panel with accent border + cyan glow.
  - **FAB.** Borders removed entirely. The `+` and target glyphs render as bare 22px icons in accent color; hover gets a brighter cyan text-shadow glow only. No square, no border, no fill — just the glyph. Drops the previous "thin square" treatment.
  - **Section labels.** `border-bottom` hairline from yesterday's flatten dropped. The section label text (`> DOING [6]`) is the heading; the rule was overkill and made labels look like underlined chips. Replaced with `padding: 16px 0 6px` so vertical whitespace creates the section break.
  - **EditTaskModal manage cluster.** Border removed; buttons become text rows with hover color shift + glow. Delete still red-text, hover gets red glow.
  - **Modal close X.** Border removed. Bare icon with accent-glow hover.
  - **Form submit.** Border removed; just `[ Save ]` accent text with glow. Hover deepens the glow rather than adding a fill.
  - **Architecture.** Rewrote `src/v2/terminal/flatten.css` (now ~370 lines). All overrides under `[data-theme^="terminal"]`. `!important` used deliberately on selectors that need to defeat component-level inline styles (TaskListToolbar's label-color, FloatingCapture's accent fills) — JSX stays untouched per the stress-test convention; the CSS battle is the right tradeoff.
  - **Bundle.** CSS 218.8KB gzip 32.4KB (+~2KB from the rewrite). JS unchanged.
  - Modified: `src/v2/terminal/flatten.css`, `wiki/Version-History.md`

- style(ui): terminal theme — strip modern app chrome (flatten) [M]
  - **Why.** PR A–I shipped terminal text + ASCII flourishes on top of a fundamentally modern card-based UI: rounded card surfaces with borders, filled accent buttons, glowing FAB, drop-shadowed modals, pill-shaped action chrome. Reads as "modern app in monospace," not as a CLI tool. User feedback after first in-browser look: didn't go far enough. PR J flattens the chrome.
  - **TaskCard.** Surface bg dropped, border + border-radius dropped, box-shadow dropped. Cards become flat rows on `var(--v2-bg)`, separated by a single hairline `border-top` (skipped on the first card after a section label or at top of list). Hover gets a faint 2% bg tint instead of an accent border. Expanded card uses a slightly elevated 2.5% bg tint so the open row reads as the focused one without pretending to be a card. Status colors no longer ride a 2px left border — overdue + high-pri override the existing `[ ]` title prefix to `[!] ` (red) / `[*] ` (amber) so status reads as a leading character on the title line, not as a chrome decoration.
  - **Card actions.** Snooze/Edit/Skip lose their pill chrome — flat 1px hairline boxes, square corners, no hover bg fill. The Done primary button drops the accent fill + brand glow box-shadow + brightness-filter hover; becomes bordered `[ Done ]` text in accent color with a soft cyan text-shadow glow and a 0.08 opacity wash on hover. Skip-advance keeps amber but flattens the same way.
  - **Energy chip.** Pill bg removed; becomes inline icon + bolts only.
  - **ModalShell.** Sheet bg shifts to `var(--v2-bg)` (matches page) with a 1px hairline border instead of the surface elevation. Border-radius zeroed at all breakpoints, box-shadow zeroed (desktop drawer no longer floats with a shadow). Overlay scrim deepened from 0.45 to 0.70 so the modal reads as a takeover, not a card. Close X button squares off too.
  - **FAB.** 48px circle → 36px square. Accent fill → transparent with thin accent border. Box-shadow + hover lift removed. Hover gets a 0.10 accent wash, active gets 0.18. Same flattening for both `+` (add) and target (what-now) variants. The FC card panel that expands from the FAB switches to flat-rect with accent border + cyan glow text-shadow.
  - **Form submit primary.** "Save changes" / "Add task" fills replaced with bordered `[ verb ]` text — uses `::before` `[ ` and `::after` ` ]` brackets with the same accent color as the button text. No fill, no shadow, no transform on click.
  - **Form inputs + textarea + title.** Border-radius 10px → 0. Border-color stays hairline; focus state still flips to accent.
  - **EditTaskModal manage cluster.** Pill-shaped `Backlog` / `Projects` / `Make recurring` / `Delete` buttons → flat squared boxes. Delete border colors with overdue red. Confirm-yes button drops its red fill, becomes red-bordered transparent text.
  - **Settings segmented control.** Rounded-pill cluster → joined-border tab strip. Adjacent buttons share a border (right-border collapsed except on the last child); active button gets accent border + accent text + glow text-shadow. No background fill on active.
  - **Section labels.** Add a thin hairline `border-bottom` so the label reads as a listing header. Padding-bottom 4px so the rule sits close to the text but not flush.
  - **ConfirmDialog + ChainReconcileModal.** Same flattening — bg matches page, border becomes hairline, radius zeroed, shadow removed, deeper overlay.
  - **Toast.** Pill bg → bordered flat rect with accent border + cyan glow text-shadow.
  - **Architecture.** New `src/v2/terminal/flatten.css` (~330 lines). Imported via `terminal/index.css` between `typography.css` and the existing structural override files. All selectors gated on `[data-theme^="terminal"]`. Light + dark are completely untouched. Deleting the file restores the modern chrome to terminal mode entirely.
  - **Bundle.** CSS 217KB gzip 32.2KB (+~9KB from the new file's coverage). JS unchanged.
  - Modified: `src/v2/terminal/index.css`, `wiki/Version-History.md`
  - Added: `src/v2/terminal/flatten.css`

- style(ui): terminal theme — typography scale-down [S]
  - **Why.** First in-browser look at the merged terminal aesthetic showed text feeling chunky — task titles dominating the column, modal headers eating half the screen. Monospace is denser per-character than proportional fonts at the same point size, but the v2 sizes were originally tuned for Syne + DM Sans. Swapping to JetBrains Mono at the same numeric sizes overshoots.
  - **Approach.** New `src/v2/terminal/typography.css` with size overrides under `[data-theme^="terminal"]`. Light + dark stay at the calm Wheneri-tuned sizes. Dedicated file (not inline per component) so "what does terminal change about text?" is one grep, and graduating the smaller scale to all themes (if that's where we land) is one block to delete or de-gate.
  - **Major reductions:** modal title 32px Syne → 22px mono; empty title 22px Syne → 16px mono; card title 16px → 14px; card meta + notes preview + density spans 12px → 11px; form input/textarea 14px → 12px; form title 18px → 15px; settings row label 14px → 12px; settings row hint → 11px; ConfirmDialog title 16px monospace; Adviser chat → 12px.
  - **Held steady.** Section labels (already 11px), week-strip range/label (already 11/10px), edit-manage label, header wordmark range — these were already tuned for monospace and stayed.
  - **Bundle.** CSS 208KB gzip 31.2KB (+~3KB from 100 lines of override rules). JS unchanged.
  - Modified: `src/v2/terminal/index.css`, `wiki/Version-History.md`
  - Added: `src/v2/terminal/typography.css`

- chore(ui): terminal theme PR I — stress-test convention + smoke test + docs [S]
  - **Why.** PR A–H built four palettes + extensive terminal-only treatments (CSS overrides, `terminalTitle`/`terminalCommand` props on 16 modals + 7 empty states, three TaskCard density signals hidden from light/dark, bracket toggles, manage-section reflow). The user's working hypothesis: "terminal might become the default forever — let's stress-test that, but be careful about creating more divergence in the meantime." PR I writes that down so subsequent work doesn't accidentally widen the gap.
  - **CLAUDE.md → "Terminal Theme Stress Test" section.** Documents the working hypothesis + the convention while we stress-test:
    1. Don't widen JSX divergence for new features — existing plumbing is enough; new features go terminal-first OR theme-agnostic, not theme-branched
    2. CSS overrides under `[data-theme^="terminal"]` are still cheap; use them for visual flourishes
    3. New `<ModalShell>` call sites must include `terminalTitle` (smoke test enforces)
    4. Density signals on TaskCard are terminal-only by user preference (PR G); graduate criteria documented — drop the gate if usage validates
    5. Decision criterion for "terminal forever": ~30 days of daily use in `terminal-*` → terminal becomes default; Light/Dark deprecation timeline starts
    6. Structural plan for both pivots: "terminal forever" (lock in, deprecate light/dark, drop CSS gates) and "terminal didn't stick" (rm -rf src/v2/terminal/, drop variants from picker, delete useTerminalMode + theme-aware props)
  - **Smoke test: `scripts/check-terminal-titles.js`.** Scans every v2 component for `<ModalShell` JSX and asserts each call site carries a `terminalTitle=` prop. Uses a brace-counting parser (not naive regex) so JSX with embedded arrow functions like `onClose={() => setOpen(false)}` doesn't trip on the inner `>`. Wired into:
    - `npm run check:terminal-titles` script in package.json
    - `.githooks/pre-push` between lint and smoke test, with a clear failure message pointing to the CLAUDE.md section
    - Run on PR I baseline: clean — all 15 `<ModalShell>` call sites have `terminalTitle`
  - **wiki/V2-State.md.** Flipped "Terminal-aesthetic theme toggle" parking-lot bullet from `[ ]` to `[x]` with a full PR A–I summary + the stress-test note pointing to CLAUDE.md.
  - **wiki/Architecture.md.** Added "Theme palette family" subsection under Component Architecture documenting the four `data-theme` values, the directory layout (`src/v2/terminal/`), the migration shim, the theme-aware JSX hooks/props (`useTerminalMode`, `terminalTitle`, `terminalCommand`, `data-terminal-cmd`), and the smoke-test convention.
  - **wiki/Features.md.** New "Themes" section near the top with a 4-row table covering Light / Dark / Terminal Dark / Terminal Light, plus a paragraph on `$ verb` modal headers and the opt-in home-screen surfaces (week strip + goal bar).
  - **No code shipped beyond the smoke test.** This is the lockdown PR — code is the docs + the guardrail. Visual QA pass is a manual session in browser, not a code change.
  - Modified: `CLAUDE.md`, `wiki/V2-State.md`, `wiki/Architecture.md`, `wiki/Features.md`, `wiki/Version-History.md`, `package.json` (added `check:terminal-titles` script), `.githooks/pre-push` (added the check between lint and smoke test)
  - Added: `scripts/check-terminal-titles.js`

- feat(ui): terminal theme PR H — home-screen 7-day strip + goal progress bar (opt-in) [M]
  - **Why.** init.habits puts a daily-rhythm strip at the top of its main view and a goal progress bar at the bottom — both surface "where am I in my day?" without the user having to open Analytics or do math. PR H adds those two surfaces to v2's home screen, opt-in (default off) and theme-aware so they fit any palette.
  - **`WeekStrip` component (new).** 7-day calendar row rendered above the first task section. Each day cell shows day-of-week label + date number + an activity-intensity indicator. Today is highlighted; future days dim to 0.55 opacity. Activity intensity buckets:
    - 0 (no completions) — empty
    - 1 (some completions but below daily goal) — pale dot/pale block
    - 2 (met goal, up to 2× goal) — accent dot at 0.55 opacity / `▃` block
    - 3 (≥2× goal — over-achievement) — full accent dot / `█` block
    - `< prev` / `next >` arrows on the row header navigate weeks. State managed locally; defaults to current week. Range label reads as "May 4–10" (or "Apr 27–May 3" if straddling a month boundary).
    - Tap a day = no-op for v1. Hook reserved for future "filter to that day" / "jump to that day" interactions.
  - **`GoalProgressBar` component (new).** Renders below the last task section. Shows `tasksToday / daily_task_goal` as a horizontal progress bar with caption row underneath. Bar fills 100% at goal, then a thin amber "stretch" segment past 100% indicates over-achievement. Caption: "Goal: N tasks" + count `3/5 · 60%`.
  - **Theme-aware visuals (CSS-only, same JSX both modes):**
    - Light/dark — rounded card-style day cells with hairline border, soft accent-colored intensity bar; pill-shape progress track with rounded fill
    - Terminal — bare monospace strip (no card chrome), today's date number gets a `*` prefix, intensity rendered as block characters (`▁ ▃ █`); progress bar uses `[N/N]` brackets in the count + `// goal:` comment-prefixed caption + glow shadow on the fill
  - **Settings.** New "Home screen" subhead in General tab with three rows: 7-day strip toggle, goal progress toggle, daily task goal numeric input. The subhead renders as small uppercase "HOME SCREEN" caption in light/dark and `// home screen` lowercase comment in terminal — same `.v2-settings-subhead` class with terminal-mode CSS override.
  - **Default state.** Both `show_week_strip` and `show_goal_progress` ship as `false`. Existing users see no change until they opt in. New users start without them so the calm minimal home screen is the first impression.
  - **Wiring.** AppV2's mobile list (the `<div className="v2-list">`) renders `<WeekStrip>` above the first `renderSection` call when `show_week_strip` is true, and `<GoalProgressBar>` after the last `renderSection` call when `show_goal_progress` is true. Both inside the scroll container so they move with the list. Desktop Kanban view doesn't render either — Kanban is already dense; revisit in PR I if usage warrants.
  - **Bundle.** CSS 204.2KB gzip 30.9KB (+~5.5KB from the two new component CSS files + subhead override). JS 807KB gzip 223.6KB (+~5KB from the two components + memoized completion bucketing).
  - Modified: `src/store.js` (added `show_week_strip` + `show_goal_progress` defaults), `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/Version-History.md`
  - Added: `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`, `src/v2/components/GoalProgressBar.jsx`, `src/v2/components/GoalProgressBar.css`

- feat(ui): terminal theme PR G — TaskCard density (terminal-only) [S]
  - **Why.** init.habits packs more information per row than v2's calm card does — checklist completion at a glance, notes preview without expanding, streak indicator for recurring tasks. PR G ports those three signals into TaskCard, gated on terminal mode so light/dark stay calm.
  - **Inline `[X/Y]` checklist counter.** When a task has any checklist items, the title row gets a small `[3/5]` counter span after the title. CSS-gated to terminal mode — light/dark hide it via `display: none`.
  - **One-line notes preview.** When a task has notes, the collapsed card renders a clamped first-line preview as a sub-row under the title (with a `// ` comment prefix so it reads as inline notes attached to the task). Trims to 140 chars + first newline cut so multi-line notes render as a single sentence. CSS-gated to terminal mode + collapsed state — expanded view still shows full notes via the existing `.v2-card-notes` block.
  - **Routine streak indicator.** Tasks with `task.routine_id` show a small `🔥N` indicator after the title (or after the checklist counter if both present). New `computeRoutineStreak(routine)` in `src/store.js` walks `completed_history` from newest to oldest, counting consecutive entries spaced ≤1.5× the cadence interval. Cadence intervals: daily=1d, weekly=7d, monthly=30d, quarterly=91d, annually=365d, custom=N×days. Returns 0 for never-completed routines.
  - **`routineStreaks` prop.** AppV2 builds a memoized `Record<routineId, number>` map from the live `routines` array via `useMemo`, threads it down through `renderSection` (mobile list), `KanbanBoard` (desktop), `ProjectsView`, and the search-results path. Recomputed only when `routines` changes — completing a routine instance bumps the array, which rebuilds the map.
  - **CSS architecture.** All three new spans (`.v2-card-checklist-inline`, `.v2-card-routine-streak`, `.v2-card-notes-preview`) ship with `display: none` in the base CSS. Terminal-mode CSS in `src/v2/terminal/cards.css` flips them to `display: inline` (or `display: -webkit-box` for the clamped notes line). Adding to light/dark later is a one-line change (drop the data-theme prefix scope).
  - **Bundle.** CSS 198.6KB gzip 30.1KB (+~1KB from the density rules). JS 802KB gzip 222KB (+~1KB from the streak computation + map build).
  - Modified: `src/store.js`, `src/v2/components/TaskCard.jsx`, `src/v2/components/KanbanBoard.jsx`, `src/v2/components/ProjectsView.jsx`, `src/v2/AppV2.jsx`, `src/v2/terminal/cards.css`, `wiki/Version-History.md`

- feat(ui): terminal theme PR F — control language (bracket toggles, $ verb modal headers, // manage section) [M]
  - **Why.** PR A–E got terminal mode looking right (palette, monospace, ASCII flourishes, sub-palettes). PR F gets it speaking right — modal headers read as commands, settings toggles read as switch states, destructive actions in EditTaskModal read as a CLI subcommand cluster.
  - **`useTerminalMode` hook.** New `src/v2/hooks/useTerminalMode.js` — subscribes to the documentElement's `data-theme` attribute via MutationObserver, returns `true` when the theme starts with `terminal-`. Used wherever JSX needs to swap copy or rendering (not pure CSS overrides).
  - **`$ verb --flag` modal headers.** ModalShell accepts a new optional `terminalTitle` prop; when set + terminal-mode is active, that's rendered instead of the regular `title`. Wired across every v2 modal:
    - AddTaskModal: `$ task --new`
    - EditTaskModal: `$ task --edit`
    - SnoozeModal: `$ snooze`
    - ReframeModal: `$ reframe`
    - WhatNowModal: `$ what-now`
    - SettingsModal: `$ settings`
    - PackagesModal: `$ packages`
    - AnalyticsModal: `$ stats`
    - ProjectsView: `$ projects`
    - DoneList: `$ done --list`
    - ActivityLog: `$ log`
    - RoutinesModal: `$ routines` / `$ routine --new` / `$ routine --edit` (state-dependent)
    - AdviserModal: `$ quokka`
    - MarkdownImportModal: `$ import --markdown`
    - AppV2 More menu: `$ menu`
    - AppV2 Help modal: `$ help --keys`
    - ConfirmDialog: prop added, no callers wiring it for now (chain-confirm contextual titles like "Stop the follow-up chain?" carry better signal than a generic `$ confirm`)
  - **`// manage` section reflow in EditTaskModal.** Destructive + admin actions (Backlog / Projects / Make recurring / Delete) moved into a labeled cluster under a new "Manage" sub-header. Light/dark renders the label as a small uppercase "MANAGE" caption with letter-spacing 0.08em; terminal renders as `// manage` (lowercase, monospace, comment prefix). The hairline + label do the visual grouping; in terminal mode `data-terminal-cmd` attributes on inner spans swap each button's label to its CLI form (`$ archive`, `$ move-to-projects`, `$ make-recurring`, `$ delete --confirm`) via CSS `attr()`. Light/dark show the regular "Backlog" / "Projects" / "Make recurring" / "Delete" labels.
  - **Bracket-toggle CSS-only override.** `[off] [on]` bracket pairs replace iOS-pill toggles in terminal mode. The existing `<input>+<track>+<thumb>` markup stays unchanged; CSS in `terminal/controls.css` hides the thumb, blanks the track background, and renders both labels via `::before` and `::after` on the track. The active state matches the input's `:checked` state via the sibling combinator. Active label gets the accent color + glow; inactive reads as faded text. Light/dark themes are completely untouched.
  - **EmptyState `terminalCommand` prop.** `EmptyState` accepts a new optional prop that, when provided + terminal mode is active, short-circuits the icon + title + body + CTA tree to render as a single `// comment` line — same vibe as a CLI "no results" output. Wired into 7 callers covering the main empty-state surfaces:
    - Home screen (no tasks): `// no active tasks. that's either bold or concerning. press + to add.`
    - Search empty: `// type a query — searches active, done, backlog, projects`
    - Search no matches: `// no matches for "..."`
    - DoneList: `// no completions yet — they show up here as you finish tasks`
    - ActivityLog: `// log empty — edits, completions, and deletes will appear here`
    - ProjectsView: `// no projects — move long-haul tasks here to stop the nag`
    - PackagesModal: `// no packages tracked — paste a tracking number above`
    - RoutinesModal: `// no routines yet. recurring tasks live here — dentist, oil change, water plants.`
    Other empty-state callers (Settings sub-tabs, AdviserModal, AnalyticsModal) keep the regular icon-and-body layout — those reads are dense enough that the comment form would lose information.
  - **Architecture.** New `src/v2/terminal/controls.css` joins the directory; imported via `terminal/index.css`. Holds the bracket-toggle override + empty-state-terminal renderer. Selectors all use `[data-theme^="terminal"]` so both `terminal-dark` and `terminal-light` pick up the same treatment.
  - **Bundle.** CSS 197.8KB gzip 30.0KB (+~2KB from controls.css + manage section + new pseudo-element rules). JS 801KB gzip 222KB (+~3KB from useTerminalMode hook + threaded props across modals).
  - **What's not in this PR.** Tap-to-cycle interactions on TaskCard (planned for PR G with the density features), home-screen week strip + goal bar (PR H), polish + visual QA (PR I).
  - Modified: `src/v2/components/ModalShell.jsx`, `src/v2/components/ConfirmDialog.jsx`, `src/v2/components/EmptyState.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/SnoozeModal.jsx`, `src/v2/components/ReframeModal.jsx`, `src/v2/components/WhatNowModal.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/PackagesModal.jsx`, `src/v2/components/AnalyticsModal.jsx`, `src/v2/components/ProjectsView.jsx`, `src/v2/components/DoneList.jsx`, `src/v2/components/ActivityLog.jsx`, `src/v2/components/RoutinesModal.jsx`, `src/v2/components/AdviserModal.jsx`, `src/v2/components/MarkdownImportModal.jsx`, `src/v2/AppV2.jsx`, `src/v2/terminal/index.css`, `wiki/Version-History.md`
  - Added: `src/v2/hooks/useTerminalMode.js`, `src/v2/terminal/controls.css`

- refactor(ui): terminal theme PR E — palette family + directory split [M]
  - **Why.** Terminal theme shipped as a single `data-theme="terminal"` value with one navy/cyan palette baked into `tokens.css` and `terminal.css`. To go deeper into the aesthetic and let the theme branch into sub-palettes (GitHub Dark, GitHub Light), the structure had to grow up. This PR is the foundation for the rest of the v2-polish-terminal-v2 set.
  - **Two sub-palettes.** Single `'terminal'` value retired in favor of:
    - `'terminal-dark'` — GitHub Dark colors (#0D1117 canvas, #58A6FF blue accent, #F85149/#D29922/#7EE787 alarm colors). Reads as "code editor in dark mode."
    - `'terminal-light'` — GitHub Light colors (#FFFFFF canvas, #F6F8FA panel, #0969DA blue accent, #1F2328 text). Reads as "code editor in light mode." Same monospace + ASCII flourishes, white canvas. Different brain, different lighting.
  - **Migration.** `loadSettings()` upgrades stored `theme: 'terminal'` → `'terminal-dark'` on first read and saves back. `index.html` pre-paint script does the same migration in localStorage so the right tokens are scoped before React mounts. AppV2's mount-time theme effect understands all four values. Idempotent — once migrated, the old value never reappears.
  - **Architecture.** Split the monolithic `src/v2/terminal.css` (273 lines) into `src/v2/terminal/` directory:
    - `palette-dark.css` — GitHub Dark tokens (45 lines)
    - `palette-light.css` — GitHub Light tokens (45 lines)
    - `wordmark.css` — `$ boomerang_` cursor + sync-state animations (95 lines)
    - `sections.css` — chevron section bullets, bracketed counts, popover bracket dot (50 lines)
    - `cards.css` — `[ ] ` task-title prefix, `[ Done ]` button brackets, modal buttons (75 lines)
    - `index.css` — `@import` aggregator (5 lines)
  - **Selector convention.** Structural overrides switched from `[data-theme="terminal"]` to `[data-theme^="terminal"]` so both sub-variants pick up the ASCII flourishes uniformly. Adding a new sub-palette later is one drop-in `palette-*.css` file plus an @import.
  - **Picker UI.** SettingsModal Theme picker grew from 3 options to 4 (Light / Dark / Term Dark / Term Light). New `.v2-settings-segment-4` modifier tightens padding so all four labels fit a one-row segmented control down to ~320px viewport.
  - **Theme-color meta.** Pre-paint and AppV2 effect both extend the theme-color map to all four values. terminal-light → `#FFFFFF` (white status bar to match white canvas). terminal-dark → `#0D1117` (true GitHub Dark canvas, slightly lighter than the previous `#0A0E1A`).
  - **Glow token.** terminal-dark keeps `--v2-glow: 0 0 8px rgba(88, 166, 255, 0.45)` (signature GitHub Dark blue). terminal-light sets `--v2-glow: none` — glow on white reads as a blur artifact, not an effect, so light-canvas variants intentionally drop it.
  - **Bundle.** CSS bundle is 195.5KB (gzipped 29.7KB), up ~2KB from the second palette + 4-option picker styles. JS unchanged.
  - **Visual QA.** Cycling through Light → Dark → Term Dark → Term Light reloads cleanly, settings persist, no FOUC, status-bar color matches each canvas.
  - Modified: `src/store.js`, `index.html`, `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `src/v2/tokens.css`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/Version-History.md`
  - Added: `src/v2/terminal/palette-dark.css`, `src/v2/terminal/palette-light.css`, `src/v2/terminal/wordmark.css`, `src/v2/terminal/sections.css`, `src/v2/terminal/cards.css`, `src/v2/terminal/index.css`
  - Removed: `src/v2/terminal.css` (split into the directory above)

- feat(ui): terminal theme PR D — sync animations [S]
  - **Why.** Light/dark themes use a letter-by-letter wave bounce + green flash for the saving / just-synced sync states. Brand-y, slightly playful — wrong vibe for terminal. PR D replaces those with status conventions terminals actually use.
  - **Sync states in terminal mode.**
    - `saving` → cycling spinner glyph at the cursor position (`| / - \` — the universal CLI loading indicator). 0.6s `steps(4)` rotation, cyan accent color.
    - `just-synced` → static `✓` (green via `--v2-energy-errand`) for the 700ms hold, then back to idle cursor.
    - `idle` → blinking `_` cursor (PR B).
    - `degraded` → blinking `_` in amber (PR B).
    - `offline` → blinking `_` in red (PR B).
  - **Letter behavior.** The bounce wave and green flash on individual letters are muted in terminal mode for both `saving` and `just-synced`. Letters stay solid; the spinner / checkmark at the cursor position is the sole channel for state. Reads as a CLI status line, not a brand animation.
  - **Implementation.** Uses CSS `content` animation — `@keyframes` cycle through `|` / `/` / `-` / `\\`. Modern-browser support landed 2022-2023 (Chrome 105+, Safari 16.4+, Firefox 110+). Older browsers fall back to the static `|` from the `::after` content declaration.
  - **Reduced-motion.** Spinner glyph stays static at `*` instead of cycling.
  - **Bundle.** 779KB precache (CSS-only, ~1KB source).
  - **Terminal theme is now feature-complete for the PR set in V2-State.md.** Future polish (e.g. `[OK]/[ERR]/[BUSY]` badges next to the wordmark, command-prompt style for the brand popover, alternate cadences) can land as smaller follow-ups based on usage.
  - Modified: `src/v2/terminal.css`, `wiki/Version-History.md`

- feat(ui): terminal theme PR C — TaskCard ASCII flourishes [S]
  - **Why.** Cards picked up the theme's palette + radii from PR A, but they still read as "v2 cards in dark blue." PR C makes them feel like rows in CLI task-list output.
  - **Title prefix.** `[ ] ` checkbox affordance prepended to every task title via `.v2-card-title::before`. Universal terminal TODO marker — Active tasks still aren't done so they always show the empty checkbox; once they complete they leave the active list anyway, so a `[✓]` state isn't needed in this view.
  - **Primary action button.** "Done" wraps in `[ Done ]` brackets via `::before` / `::after`, plus a subtle cyan `--v2-glow` box-shadow so the primary affordance pulses with the accent — the one place the theme allows itself a little ornament beyond pure characters.
  - **Skip-advance button.** Amber outline + faint amber background fill so it reads as a peer command in the action row (instead of feeling out of place against the cyan primary).
  - **Meta separator.** `·` → `|` via `font-size: 0` + `::before`. Pipe reads as terminal output column separator.
  - **Modal buttons.** Same `[ ... ]` bracket treatment applies to `ConfirmDialog`'s danger button and `ChainReconcileModal`'s primary button so destructive confirms and Quokka apply-suggestions reads as one visual language with the in-card primary. Reconcile primary also gets the cyan glow.
  - **Bundle.** 779KB precache (terminal.css gained ~1KB CSS source, no measurable bundle change after compression).
  - **What's still pending.** Sync-state animations: ASCII spinner per letter on saving, `[OK]/[ERR]/[BUSY]` bracketed status flashes (PR D — last theme PR).
  - Modified: `src/v2/terminal.css`, `wiki/Version-History.md`

- feat(ui): terminal theme PR B — wordmark prompt + section bullets [S]
  - **Why.** PR A swapped the palette + font; PR B layers the actual ASCII flourishes that make the theme feel like a CLI instead of just "v2 in dark blue."
  - **Wordmark.** `BOOMERANG` becomes `$ boomerang_` in terminal mode. Lowercase via `text-transform`, leading `$ ` prompt prefix as `::before`, blinking trailing `_` cursor as `::after` (1.1s `steps(2)` blink — hard on/off cut, not smooth fade). Cursor color picks up the cyan accent in idle state, switches to amber/red when sync goes degraded/offline. Existing letter-span saving wave still fires unchanged because the pseudo-elements aren't part of the spans.
  - **Section labels.** `✦ DOING                3` becomes `> DOING               [3]`. Sparkle character hidden via `font-size: 0`; chevron prompt rendered as `::before` on the bullet span; brackets wrap the count via `::before` + `::after` on the count span. Reads as a CLI listing row.
  - **Brand popover sync row.** The `●` indicator gets bracketed: `[●] Synced ✓` for status-line vibes.
  - **Empty-state icon backdrop** rounds to the smaller terminal `--v2-radius-card` (4px) so the soft circle becomes a boxy square — matches the theme's overall geometry.
  - **Architecture choice.** All terminal overrides live in a single new `src/v2/terminal.css` (imported from `AppV2.css`) instead of being scattered across each component's stylesheet. Two reasons: (1) easier to audit "what does terminal mode change?", (2) component CSS stays neutral so light + dark remain canonical.
  - **Reduced-motion.** Cursor blink respects `prefers-reduced-motion` — solid cursor instead of animation.
  - **Bundle.** 779KB precache (unchanged — terminal.css adds ~3KB of CSS source that compresses into the existing chunk).
  - **What's still pending.** Bracket buttons, `[ ]/[✓]` checkboxes on TaskCard (PR C). Sync wordmark spinner + `[OK]/[ERR]/[BUSY]` flashes (PR D).
  - New: `src/v2/terminal.css`
  - Modified: `src/v2/AppV2.css`, `wiki/Version-History.md`

- feat(ui): terminal theme PR A — palette, monospace stack, 3-way picker [M]
  - **Why.** Light + dark covered the calm-product end of the aesthetic spectrum, but the user wanted a third mode that reads as "this app is a tool, not a product" — inspired by [init.habits](https://inithabits.com) and classic dev-tool dark themes. Deep navy bg, monospace everywhere, cyan accents with a soft glow. Layout/component contracts are unchanged; this PR is purely tokens + the picker.
  - **Token block.** New `:root[data-ui="v2"][data-theme="terminal"]` variant in `tokens.css`. Bg `#0A0E1A`, surface `#0F1424`, text `#D8DEF0`, accent cyan `#4FC3F7`. Energy types desaturated to fit the navy palette without competing with the accent. Radii dropped from `999px / 14px / 20px` to `6px / 4px / 6px` so cards/pills read "terminal box" instead of "iOS pill." New `--v2-glow` token (subtle cyan blur) reserved for opt-in use by sync/wordmark/buttons in the next theme PRs.
  - **Font stack.** `JetBrains Mono` from Google Fonts as the primary, `'SF Mono' / 'Cascadia Code' / 'Fira Code' / ui-monospace` fallbacks. Both `--v2-font-display` and `--v2-font-body` collapse to the same monospace stack — no mixed font weights, the typographic flat-out reads as terminal.
  - **Picker.** Settings → General "Dark mode" toggle becomes a 3-way segmented control (Light / Dark / Terminal). Stacked layout because three pills don't fit alongside the row label on phone width. Wires through to `update('theme', value)` + `data-theme` attr + `meta[name="theme-color"]`. Defaults to `light` when unset (existing users keep their light/dark choice).
  - **Pre-paint application.** `index.html` inline script extended to recognize `'terminal'` alongside `'light'`/`'dark'` so the navy bg paints before React mounts (no white-flash on terminal theme load).
  - **Bundle.** 779KB precache (+1KB from token block + segmented control CSS).
  - **What this PR doesn't do.** ASCII flourishes (bracket buttons, `[ ] / [✓]` checkboxes, `>` section bullets), cursor-blink/spinner sync animations, and command-prompt header styling all land in PR B / C / D as the theme builds out.
  - Modified: `src/v2/tokens.css`, `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `index.html`, `wiki/Version-History.md`

- feat(adviser): Sequences PR 5 — Quokka tools for chain editing [S]
  - **Why.** Quokka could read routines but couldn't edit a chain template — no atomic ops on `follow_ups`. Users had to open RoutinesModal manually to add/remove/reorder steps. Now natural-language commands like *"add a 'rinse the brushes' step to the mop routine right after auto-clean"* can do the work.
  - **Four new tools** in `adviserToolsTasks.js`, each capturing the routine's pre-state in their compensation closure for rollback:
    - `add_follow_up({routine_id, title, offset_minutes, [step_index], [energy_*], [notes]})` — append or insert. Returns the new `step_id` so chained tool calls can reference it.
    - `edit_follow_up({routine_id, step_id|step_index, [title, offset_minutes, energy_*, notes]})` — update a single step's fields. `null` for energy_type/level/notes clears that field.
    - `remove_follow_up({routine_id, step_id|step_index})` — delete one step.
    - `reorder_follow_ups({routine_id, step_ids[] OR (from_index, to_index)})` — full reorder by id list, or single-step move by indices. Validates length match for the array form.
  - **Visibility into chain steps.** `summarizeRoutine` now serializes `follow_ups` with `step_index` + `step_id` + fields per step so `get_routine` and `list_routines` give the model what it needs to address steps without a separate fetch. Cost: a few hundred bytes per routine in the tool response.
  - **Tool count.** `50 → 54`. CLAUDE.md updated.
  - **Scope.** Template-only (matching PR 4). Already-spawned task instances carry their own `follow_ups` snapshot from PR 1's spawn copy and aren't retroactively mutated by template edits — the model can't accidentally rewrite a chain that's already mid-flight.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 778KB precache (server-side only — no client bundle change).
  - Modified: `adviserToolsTasks.js`, `CLAUDE.md`, `wiki/Sequences.md`

- feat(routines): Sequences PR 4 — AI chain reconciliation [M]
  - **Why.** Editing a step in a multi-step chain often makes the OTHER steps read inconsistently — rename "Empty the dirty tank" to "Drain the rinse tank" and the "Put dry tanks back" step at the end now sounds slightly off. Without reconciliation, the user has to remember to revisit each downstream step manually. Now Quokka does the cross-step pass on demand.
  - **Behavior.** When the routine form saves an EXISTING chain with edits/additions/removals, a `ChainReconcileModal` intercepts. Three states: `review` (summary of the user's changes + "Ask Quokka" / "Save without scan" buttons) → `loading` (Quokka spinner) → `diffs` (per-suggestion accept/reject toggles + "Apply selected" / "Skip all" buttons). Brand-new chains skip the gate — no point reconciling steps you just drafted. Title-only trigger; offset/notes/energy edits don't propagate linguistically.
  - **AI prompt.** Conservative-by-default. The system prompt explicitly says "empty list is the right answer most of the time" and "don't suggest changes for taste alone." Returns `[{stepIndex, suggestedTitle, reasoning}]`. Defensive parsing: ignores out-of-range indices, drops suggestions that match the current title, falls back to `[]` on any error so a flaky API never blocks the save flow.
  - **Implementation.** New `aiReconcileChain(originalChain, currentChain, parentTitle)` in `src/api.js` — uses the existing `/api/messages` proxy with a focused prompt. New `src/v2/components/ChainReconcileModal.jsx` + `.css` (state machine + per-suggestion checkboxes + accessible close + reduced-motion fallback). Hooked into `RoutineForm.handleSave` via `pendingSave` state.
  - **Scope deferred.** Live in-flight chain editing (Scenario B in `wiki/Sequences.md`) is parked. Editing a chain-step task's title in EditTaskModal doesn't yet trigger reconciliation against the queued steps. Template-only (Scenario A) is the MVP that ships here; live-edit reconciliation lands in a follow-up PR if the use case shows up enough.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 778KB precache (+7KB from the modal + AI helper).
  - New: `src/v2/components/ChainReconcileModal.jsx`, `src/v2/components/ChainReconcileModal.css`
  - Modified: `src/api.js`, `src/v2/components/RoutinesModal.jsx`, `wiki/Sequences.md`

- feat(routines): Sequences PR 3 — skip & advance [S]
  - **Why.** Sometimes a chain-step task isn't gonna happen this cycle ("I forgot to clean the mop after I finished mopping the floors") but the rest of the chain still needs to fire (the auto-clean cycle still has to happen so the dirty tank gets emptied). Without skip-advance, the user's only options were complete-as-if-done (lies in analytics) or cancel (kills the chain). Skip-advance threads the needle: this step is abandoned, but the chain advances.
  - **Behavior.** New amber `SkipForward` icon button in the expanded TaskCard action row, only renders when `task.follow_ups.length > 0`. Tap → optimistic local update marks the task `cancelled` + `skipped=true` + `completed_at=now`, fires `serverSkipAdvanceTask` which atomically persists those fields server-side AND runs `spawnNextChainStep`. New spawned step arrives via SSE-triggered refetch.
  - **Server.** `POST /api/tasks/:id/skip-advance` — single endpoint that does the cancel-mark + spawn in one DB pass, broadcasts an SSE update on success.
  - **Schema.** Migration 024 adds `skipped INTEGER DEFAULT 0` to `tasks`. Wired through `taskToRow` / `rowToTask` / `UPSERT_TASK_SQL` / `runUpsertTask` (column 36 in the upsert tuple).
  - **Activity log.** `logActivity('skipped', task)` fires from the optimistic-update path so DoneList / ActivityLog can render skipped vs cancelled differently in future polish (PR 3 doesn't change those views; the data is just queryable now).
  - **Idempotency.** PATCH and skip-advance can race; both end at the same canonical state. PATCH only spawns on transitions to `done`/`completed`, so a concurrent PATCH-cancel doesn't double-spawn. SkipAdvance handles its own spawn; second-try is a no-op since the task is already cancelled.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 771KB precache (+1KB from SkipForward icon + handler).
  - New: `migrations/024_add_task_skipped.sql`
  - Modified: `db.js`, `server.js`, `src/api.js`, `src/v2/AppV2.jsx`, `src/v2/components/TaskCard.jsx`, `src/v2/components/TaskCard.css`, `src/v2/components/KanbanBoard.jsx`, `wiki/Sequences.md`

- feat(routines): Sequences PR 2 — chain-break confirmation [S]
  - **Why.** PR 1 shipped follow-up chains, but a user could silently kill a chain by deleting the parent task / moving it to backlog / cancelling it without realizing the queued steps wouldn't spawn. After running mop chains for a few days the user wanted an explicit warning before destructive actions on chain-bearing tasks.
  - **Behavior.** Any task with `follow_ups.length > 0` triggers a `ConfirmDialog` before delete / cancel / move-to-backlog / move-to-projects: *"Stop the follow-up chain? This task has N follow-up step(s) queued. {Action} will stop the chain — the queued step(s) won't spawn."* Two options: confirm-with-stop (red destructive button) or "Keep task" (cancel). Completion is intentionally ungated since `done` ADVANCES the chain via `spawnNextChainStep` — completing isn't "breaking" the chain, it's how the chain walks forward.
  - **Implementation.** `gateOnChainBreak(task, actionLabel, confirmLabel, proceed)` helper in `AppV2.jsx` wraps the four destructive handlers (`handleDelete` / `handleBacklog` / `handleProject` / `handleStatusChange` for `cancelled`). Empty-chain tasks short-circuit and proceed immediately — no behavior change. State lives in `chainConfirm` set on `AppV2`.
  - **Reusable confirm primitive.** Extracted the dialog pattern from `SettingsModal.jsx`'s inline confirm into `src/v2/components/ConfirmDialog.jsx` + `.css`. Props: `open` / `title` / `body` / `confirmLabel` / `cancelLabel` / `tone` (`'danger'` or `'primary'`) / `onConfirm` / `onCancel`. Escape-to-close. Future destructive flows (skip-and-advance, clear-all-data, etc.) can reuse it.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 770KB precache (up from 768KB).
  - New: `src/v2/components/ConfirmDialog.jsx`, `src/v2/components/ConfirmDialog.css`
  - Modified: `src/v2/AppV2.jsx`, `wiki/Sequences.md`

- fix(ui): v2 header — iOS status bar overlap on PWA [XS]
  - **Bug.** With `apple-mobile-web-app-status-bar-style: black-translucent` (set in `index.html`), iOS PWA in standalone mode renders the system status bar (clock, signal, battery) OVER the app's content — the BOOMERANG wordmark area got the iPhone's clock display rendered on top of it, producing the "B 22:25 MERANG" overlap visible in v1.0.0 prod.
  - **Fix.** `.v2-header` `padding-top` now uses `max(14px, env(safe-area-inset-top, 0px))` (and `max(16px, ...)` on the `min-width: 601px` desktop variant) so our header content sits below the iOS status bar instead of behind it. The `viewport-fit=cover` meta tag is already in place. Header background remains a solid `var(--v2-bg)` so the status bar's text reads on a contrasting surface.
  - Modified: `src/v2/components/Header.css`

---

## 2026-05-09

- fix(ui): v2 FloatingCapture — target icon stays visible when what-now card opens [XS]
  - The target FAB was being replaced by a generic X close button when the card opened — making it look like the FAB had been "covered" by the card. Now the target icon stays at the right end of the card (same role as the `+` icon at the right of the quick-add input pill — visually persistent affordance, tap to toggle closed). Same orange-fill / black-rings treatment as the standalone FAB. Removed the unused X import.
  - Modified: `src/v2/components/FloatingCapture.jsx`, `src/v2/components/FloatingCapture.css`

- fix(ui): v2 FloatingCapture — what-now card inflates from FAB footprint [XS]
  - The taller what-now card (85px) was using the same scaleX-only animation as the 48px add card. Result: at frame 1 the full vertical height appeared instantly while only the width animated, reading as a "slam" instead of an emergence. Added a separate `v2-fc-card-whatnow-in` keyframe that scales BOTH axes from the FAB footprint (`scaleX(0.13) scaleY(0.55) → 1`) with `transform-origin: right bottom`. The card now visually inflates out of the FAB's last position. Add card unchanged.
  - Modified: `src/v2/components/FloatingCapture.css`

- fix(ui): v2 FloatingCapture — align in-card buttons with standalone FABs [XS]
  - Card had 4px right padding which inset the trailing in-card button (`+` / `X`) by that much. With the other slot still showing a standalone FAB flush against the wrap edge, the two orange circles fell out of vertical alignment. Drop right padding to 0 on both card variants so every button shares the same x-axis regardless of which slot is expanded.
  - Modified: `src/v2/components/FloatingCapture.css`

- style(ui): v2 FloatingCapture — heading on what-now card [XS]
  - Five unlabeled time chips ("5 min", "15 min", …) didn't communicate intent on their own — what does tapping a number do? Added a small heading "How much time do you have?" above the chip row. Card grows from a single-row 48px pill into a stacked 80-90px card with rounded-card border-radius (20px instead of 999px); close button aligns to top so it doesn't float against multi-line content.
  - Modified: `src/v2/components/FloatingCapture.jsx`, `src/v2/components/FloatingCapture.css`

- fix(ui): v2 FloatingCapture — orange what-now + iOS keyboard occlusion fix [S]
  - **What-now FAB orange w/ black rings.** Originally hairline-bordered neutral so it didn't compete with the accent-filled `+`. User feedback: both should be brand-accent. Now both circles share the orange fill; what-now uses black `currentColor` so the target/dartboard rings read against the orange (white-on-orange would have lost contrast on the inner ring weights).
  - **iOS keyboard occlusion.** When the soft keyboard opened, the floating capture sat at `bottom: 16px` of the layout viewport — but the keyboard covered the bottom ~40% of the screen, so the input landed behind it and the user typed blind. Now uses the `visualViewport` API to measure how much of the bottom is occluded and translates the wrapper upward by that amount; `resize` listener handles keyboard show/hide and orientation changes. CSS transition smooths the lift so it rides up with the keyboard slide-in instead of snapping.
  - Modified: `src/v2/components/FloatingCapture.jsx`, `src/v2/components/FloatingCapture.css`

- fix(ui): v2 update-modal — drop `v` prefix on sha-style versions [XS]
  - `<div className="v2-update-version">v{updateVersion}</div>` rendered `vdev-e1ba2aa` on non-tagged builds. Changed to a conditional prefix: only prepend `v` when the version starts with a digit (i.e. semver like `0.10.0` → `v0.10.0`); sha-style versions like `dev-e1ba2aa` render bare. Future-proof for tagged releases without uglying up the dev sha display.
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 right-edge speed-dial — FloatingCapture for quick-add + what-now [M]
  - **Why.** Header was crowded (5 affordances on iPhone width) and v1's bottom bar didn't aesthetically fit the v2 calmer language. New pattern: right-edge speed-dial with two stacked floating circles. Tap a circle, it expands leftward into a slim card with the relevant input. Tap-outside or Escape collapses.
  - **Quick-add (+).** Lower circle, accent-filled. Tap → expands into a 320px input pill anchored to the right edge. Enter or tap + creates a task with just the title (size auto-infer hook fills in energy on the next render). Card stays open after submit so rapid-fire capture is one tap, type, Enter, type, Enter — not modal open/close churn.
  - **What-now (target).** Upper circle, neutral. Tap → expands into a 360px card with capacity chips (`5 min` / `15 min` / `30 min` / `1 hr` / `2 hr+`). Tap a chip → opens WhatNowModal seeded with that capacity preset (preset wiring deferred — for now the chip just opens WhatNowModal, capacity arg is accepted by the handler but ignored downstream).
  - **Header cleanup.** Removed `+ Add` orange circle and `What now?` inline pill from the Header. Also dropped now-unused `Plus` and `Target` imports + the `onOpenAdd`/`onOpenWhatNow` props. Header is now: logo · BOOMERANG · ✨ · 📦 · ⋯ — calmer, room to breathe.
  - **Positioning.** `position: fixed; right: 16px; bottom: max(16px, env(safe-area-inset-bottom, 0px))` so the bottom row sits above the iOS PWA home-bar gesture indicator. Z-index 50 — above task list, below modals (which use 99999). `pointer-events: none` on the wrapper so the gap between circles doesn't block list scroll.
  - **Animation.** Scale-in transform-origin: right center keeps the right edge anchored, card grows leftward from the button. Respects `prefers-reduced-motion` (fade only, no scale).
  - **Reduce-motion-friendly + iOS-safe focus.** iOS Safari needs focus to chain through a user-tap event handler — we route the `<input>` focus through the click handler, with a useEffect safety net for keyboard-only users. autoFocus on the input handles desktop.
  - New: `src/v2/components/FloatingCapture.jsx`, `src/v2/components/FloatingCapture.css`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/Header.jsx`

- fix(ui): v2 header pill + swipe slider + routine spawn-now feedback [S]
  - **Header today-count pill removed.** The "10 today" pill in the header was crowding the BOOMERANG wordmark on iPhone width AND duplicating the "X done today" line in the wordmark-tap popover. Dropped the pill from the action nav; the popover keeps the count, accessible via tap-the-wordmark. Header is now: wordmark · What now? · + · ✨ · 📦 · ⋯. (Bigger header redesign deferred to a separate planning conversation — too dense for a snap fix.)
  - **Swipe slider clipping.** `SWIPE_OPEN_OFFSET` (-120px) didn't match `.v2-card-swipe-actions` width (160px), so when the card snapped open the leftmost 40px of the action panel stayed under the card — Edit's "E" got eaten and the user saw "dit". Bumped the offset to -160 so the card translates exactly the panel width.
  - **Routine "Spawn now" feedback.** No visual confirmation on tap meant the user tapped 10 times and got 10 duplicate tasks. Two-part fix: (1) AppV2's `onSpawnNow` handler now refuses the spawn if an instance of that routine is still active on the list (returns null silently); (2) RoutineRow takes a `hasActiveTask` prop and renders the button as a disabled "Already on list" state in that case. On a successful tap, the button briefly shows ✓ + "Spawned" for 1500ms before reverting. `activeRoutineIds` Set is memoized in AppV2 from `tasks` and threaded through `RoutinesModal` → each `RoutineRow`.
  - Modified: `src/v2/components/Header.jsx`, `src/v2/components/TaskCard.jsx`, `src/v2/components/RoutinesModal.jsx`, `src/v2/components/RoutinesModal.css`, `src/v2/AppV2.jsx`

- style(ui): v2 follow-ups unit picker — readable abbreviations (min / hr / day) [XS]
  - Single-letter `h` and `d` looked stranded next to `min`. Switched the unit dropdown to `min` / `hr` / `day`. Internal value tokens stay the same (`'min'`/`'h'`/`'d'`) so existing data and conversion logic are unaffected.
  - Modified: `src/v2/components/RoutinesModal.jsx`

- fix(ui): v2 RoutinesModal — drop duplicate header on form view [XS]
  - The form view rendered its own `← Back · New routine` bar below the ModalShell header (which had an empty title slot). Stacked headers wasted vertical space and looked wrong on iPhone width. Fix: pass the form title (`New routine` / `Edit routine`) into ModalShell so it renders in the modal's normal title slot. Removed the duplicate `<h2 class="v2-routine-form-title">` and its wrapper. Back link kept as a small inline pill above the title input so users can still return to the list view without closing the modal.
  - Modified: `src/v2/components/RoutinesModal.jsx`, `src/v2/components/RoutinesModal.css`

- feat(routines): Sequences PR 1 — completion-triggered follow-up chains [M]
  - **What.** Routines can hold an ordered template of follow-up steps. When a routine spawns a task instance, the template is copied onto the spawned task. Completing the spawned task spawns the next step with `due_date` derived from `now + step.offset_minutes`, and the chain walks forward as each step is completed. Use case (the user's mop): clean floors → auto-clean mop (offset 0) → empty tanks (30 min) → put back (2 days).
  - **Schema.** Migration 023 adds `follow_ups_json TEXT DEFAULT '[]'` to both `tasks` and `routines`. Step shape: `{id, title, offset_minutes, energy_type?, energy_level?, notes?}`. Routines hold the template; tasks hold the live in-flight chain. PR 1 editor exposes title + offset only — energy/notes can be added later or filled in by the background size-inference hook.
  - **Spawn logic.** `db.js` `spawnNextChainStep(parentTask)` runs from `updateTaskPartial` whenever a task transitions to `done`/`completed` AND has non-empty `follow_ups`. Sub-day offsets set `snoozed_until = trigger time` so the new task doesn't surface until the cycle is up; ≥1-day offsets land on the future date directly (no snooze, appears naturally on its due day). New task inherits `routine_id` from the parent so the chain stays grouped under the source routine for `completed_history` + activity log + analytics.
  - **Routine-instance copy.** Both spawn paths in `src/hooks/useRoutines.js` (`spawnNow` for manual + `spawnDueTasks` for cadence-driven) copy `routine.follow_ups` onto the spawned task. `addRoutine` signature gains an optional `followUps` parameter.
  - **Editor UI.** New Follow-ups section on the routine form (between Notes and Labels). `FollowUpStepRow` sub-component with title input, offset value + unit dropdown (min/h/d), reorder up/down chevrons, remove ×. Steps with empty title get filtered on save. The form drives both create + edit; `initial.follow_ups` seeds the editor when editing.
  - **State propagation.** Server-side spawn happens during the existing `PATCH /api/tasks/:id` request; the broadcast that wraps that PATCH already fires SSE → connected clients refetch and pick up the new chain step in the same round-trip. No additional broadcast plumbing.
  - **Roadmap parked in `wiki/Sequences.md`:** PR 2 delete prompt for mid-chain tasks, PR 3 skip-and-advance, PR 4 AI-mediated edit reconciliation, PR 5 Quokka tools. Sequence parking-lot entry in V2-State.md superseded by this PR — Sequences moves from "future direction" to "shipped (PR 1 of 5)".
  - New: `migrations/023_add_follow_ups.sql`, `wiki/Sequences.md`
  - Modified: `db.js`, `src/hooks/useRoutines.js`, `src/v2/components/RoutinesModal.jsx`, `src/v2/components/RoutinesModal.css`, `CLAUDE.md`

- fix(ui): v2 Notifications + Header bug pass + Beta → Legacy rename [S]
  - **Escalation row.** Single inline row from PR #63 wrapped awkwardly on iPhone width (Before due + On due fit row 1, Overdue dropped to row 2 alone with the input far left). Replaced `.v2-notif-stages-inline` flex layout with `.v2-notif-stages-grid` — three equal columns (label-above, centered input below) that fit symmetrically on iPhone-mini width without wrap. Per-cell "h" units removed; unit appears once in the section hint copy.
  - **Quiet hours.** Same redundant-title-row treatment as escalation: hoisted toggle into the section header row alongside the "Quiet hours" label + hint, dropped the duplicate "Enable quiet hours" sub-row.
  - **More notification options block removed.** Stale v1 deferral pointer at the bottom of NotificationsPanel ("Morning digest schedule + style, adaptive throttling 👍/👎 feedback chips, Pushover priority routing helper text still live in v1") deleted — those configurations are surfaced in v2 surfaces (digest in NotificationsPanel, throttle chips in AnalyticsModal, Pushover priority hint in Pushover row of IntegrationsPanel).
  - **Beta tab → Legacy.** `Beta` was a v2 onboarding artifact when v2 was opt-in; now that v2 is the default, the tab's only remaining purpose is the v1 escape hatch. Renamed to `Legacy`, dropped the stale "What's coming" roadmap (all items shipped), reworded copy to frame v1 as an escape hatch rather than a "legacy interface".
  - **Wordmark dark-mode contrast.** During the `saving` state the BOOMERANG letters were dimmed to `--v2-text-meta` (55% alpha), which reads fine in light mode but poorly against dark-mode bg. Removed the color override — bounce animation alone signals state, dim-on-top was redundant double-encoding.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `src/v2/components/Header.css`

- docs(v2): park Sequences feature + better Logs filter UX as post-v2 follow-ups [XS]
  - Documented "Smart follow-up sequences" (completion-triggered task chains; user's mop example: clean → auto-clean → empty tanks → put back) under V2-State Future-direction parking lot, including the two implementation shapes considered (standalone Sequence primitive vs `follow_ups` array on Tasks/Routines) and open questions on cancel/snooze semantics.
  - Documented "Better Logs filter UX" — current chips are hand-curated string matches; ideas include auto-discovering tag prefixes from the log stream and/or moving to structured logs (`{level, tag, msg}` objects) so chips reflect reality without hand-maintenance.
  - Modified: `wiki/V2-State.md`

- style(ui): v2 Settings polish — escalation row, Logs Google filter, build version, 17track gate [S]
  - **Notifications → High-priority escalation.** Three-stage cadence collapsed to a single inline row (`Before due [24] h · On due [1] h · Overdue [0.5] h`). The enable toggle moves up alongside the section label so the whole control fits without burning vertical space on a separate "Enable escalation" row. New `.v2-notif-stages-inline` flex layout in CSS; the old `.v2-notif-stages` grid remains for any other call site.
  - **Logs filter.** Combined the separate `Gmail` and `GCal` filter chips into a single `Google` chip that matches `[Gmail]`, `[GCal]`, and `[GCalSync]` log lines. Verified against actual log call sites — the two real prefixes (`[Gmail]`, `[GCal]`) cover every Google integration log line that either old chip would have caught.
  - **Build version moved to General.** Was in the Beta tab as a heading + paragraph + code chip; now lives as a row in the General tab next to the other settings, using `.v2-settings-row` styling for visual parity. Beta tab no longer surfaces `__APP_VERSION__`.
  - **17track row gate fix.** Added `'api-key'` to the IntegrationsPanel action-button allow-list so the 17track row no longer renders the "Connect/Manage in v1" fallback button alongside the inline API-key field. Removed the stale "Why v1 for OAuth?" trailing note now that Trello / GCal / Gmail all have native v2 connect flows. Status panel copy updated to drop the "OAuth-heavy integrations are configured in v1" disclaimer.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`

- feat(ui): v2 ErrorBoundary + early data-ui/data-theme application [S]
  - **Why.** The 2026-05-09 TDZ bug rendered a black screen with no surfaced error because React unmounts on uncaught render exceptions and v2's :root tokens fall through to dark fallback bg with no content. Adding a top-level error boundary at AppV2's wrapper means render-time failures show a recoverable fallback instead of a dead app, AND the stack hits `/api/logs/client-error` for triage.
  - **`ErrorBoundary.jsx` + `.css`.** Class component (React error boundaries require classes). `getDerivedStateFromError` + `componentDidCatch`. Fallback UI: 🪃 + "Boomerang hit a snag" + collapsible details (message, stack, component stack) + Reload button (also unregisters service worker) + "Clear local state & reload" button (wipes localStorage with a confirm before doing so). All token-driven so it adapts to dark mode; falls back to inline defaults if `data-ui` somehow isn't set yet.
  - **`src/App.jsx` wiring.** v2 path wraps `<AppV2>` in `<ErrorBoundary>`. v1 stays unwrapped — legacy surface, no need to add behavior.
  - **`server.js` `/api/logs/client-error` endpoint.** Receives `{message, stack, componentStack, url, userAgent, appVersion}` from the boundary and prints to the server log via the `[CLIENT-ERROR]` prefix. Best-effort — no DB write, just visibility for triage.
  - **`index.html` early-paint script** now applies both `data-ui="v2"` (when not opted into v1) AND `data-theme` (when settings.theme is set, light OR dark) BEFORE React mounts. Without this, an error during AppV2's first render would show the boundary in light mode regardless of user preference, since data-ui was previously only set in AppV2's mount effect.
  - **Dark-mode audit.** Walked every v2 surface for hardcoded colors that wouldn't swap. All `var(--v2-*)` token references adapt cleanly. `#fff` text is always paired with `var(--v2-accent)` filled buttons (orange + white reads on both modes). Hardcoded RGB tints (alert-tinted card backgrounds, hover tints, etc.) are low-alpha and read on both modes. Active-state pattern (`background: var(--v2-text); color: var(--v2-bg)`) inverts cleanly across modes. No surface flagged for follow-up.
  - **Verification.** `npm run lint` clean. `npm test` smoke passes. Bundle: 762KB precache (up from 759KB).
  - New: `src/v2/components/ErrorBoundary.jsx`, `src/v2/components/ErrorBoundary.css`
  - Modified: `src/App.jsx`, `index.html`, `server.js`

- docs(v2): park "web push deprecation trial" decision for after v2 → main merge [XS]
  - Pushover is now the recommended primary on iOS but web push is still live with all its plumbing. Logged a parking-lot bullet that explicitly schedules a tap-rate / completion-rate review in Engagement Analytics 2 weeks post-v2-merge, with concrete go / no-go criteria and a rough scope estimate (~250-400 LOC net delete) if go.
  - Modified: `wiki/V2-State.md`

- feat(ui): v2 Integrations — Trello / GCal / Gmail connect flows ported out of v1 [M]
  - Removed the "Connect in v1" / "Manage in v1" punt for the three OAuth-style integrations. Each integration row now renders its own connect UI inline when not connected.
  - **Trello.** New `inline: 'trello-connect'` mode. Hint links to `trello.com/app-key`; "Enter credentials" reveals API key + Token password inputs. Connect button calls `trelloStatus()` to verify; on success populates the boards list. Disconnect button in the connected (`trello-config`) state clears `trello_api_key` + `trello_secret` and resets cached status.
  - **Google Calendar.** New `inline: 'gcal-connect'` mode. Hint links to Google Cloud console + shows the redirect URI to add. Client ID + secret inputs. Connect opens an OAuth popup via `gcalGetAuthUrl()`; the success callback posts `{type: 'gcal-connected'}` which a postMessage listener in the panel picks up to refresh status. Disconnect via `gcalDisconnect()`.
  - **Gmail.** New `inline: 'gmail-connect'` mode — reuses GCal credentials (same Google Cloud project, per Boomerang's existing pattern). One Connect button if creds set, else a "Configure Google Calendar credentials first" hint. Same popup + postMessage flow as GCal. Disconnect via `gmailDisconnect()`.
  - Action-button gate updated so all six new modes (`*-connect`, `*-config`) skip rendering the right-side "Connect/Manage in v1" fallback. Trello's `username` surfaces as the row's `sub` line when connected.
  - Fixes the "Settings → Integrations" section being unable to onboard new users without flipping back to v1.
  - Modified: `src/v2/components/SettingsModal.jsx`

- fix(ui): v2 Settings blocks have padding-top so labels don't butt against the divider above [XS]
  - `.v2-settings-block` was `padding-bottom: 24px + border-bottom` only — sibling blocks rendered their first label flush against the previous block's divider. Added `.v2-settings-block + .v2-settings-block { padding-top: 24px }` to give every non-first block breathing room.
  - Modified: `src/v2/components/SettingsModal.css`

- docs(v2): note terminal-flavored loading animations on the parking-lot terminal-theme bullet [XS]
  - The wordmark-wave from PR #58 is exactly the kind of ambient state-feedback that the terminal theme should preserve. Added an idea-bank sub-bullet to V2-State's terminal-aesthetic entry: ASCII spinner glyphs per letter, cursor blink on the trailing `_`, `[OK]/[ERR]/[BUSY]` bracketed flashes, `loading…` ellipsis cycling, output-line scroll. Same `animState` state machine drives a different visual vocabulary.
  - Modified: `wiki/V2-State.md`

- style(ui): v2 AI tab — Anthropic key UI moves to Integrations, AI shows pointer note [XS]
  - Anthropic key UI was duplicated across the AI tab (full editable block) and the Integrations row (which routed back to AI). Consolidated: Integrations row now embeds the editable block directly via a new `inline: 'anthropic'` mode; AI tab drops the full block and shows a one-line pointer ("Get a key at console.anthropic.com, then configure under Settings → Integrations") with a clickable inline link that flips active tab to Integrations. Fixes the visual cramming where the ANTHROPIC API KEY header was butted against the Custom-instructions Clear button.
  - `AnthropicKeyBlock` gains an `embedded` prop that strips the outer block wrapper + the redundant header/hint when rendered inside the Integrations row.
  - New `.v2-settings-inline-link` utility for tab-link-as-anchor styling.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`

- fix(ui): v2 wordmark wave completes a full pass before restarting [S]
  - Bug. Fast syncs (saving → synced under ~200ms) flipped `data-sync-state` back to idle before the bounce wave reached the G — only the B and the first O ever moved.
  - Fix. Header now runs a small state machine: when saving starts, the visual state is held at "saving" for a minimum 1300ms (one full wave traversal + margin). If sync completes mid-wave, the green "just-synced" flash queues to fire after the hold, instead of clobbering the in-flight wave. Subsequent saves during the hold restart the timer cleanly.
  - Replaces the old `justSynced` boolean with an `animState` (`idle | saving | just-synced`) that's the single source of truth for wave / flash timing. `deriveSyncVisualState` reads animState, so the visible behavior matches the timing intent regardless of how quickly the underlying sync resolves.
  - Modified: `src/v2/components/Header.jsx`

- style(ui): v2 labels back to flex-wrap (5-wide grid was wrong for dynamic content) [XS]
  - Reverted PR #56's 5-column grid: with variable label counts the last row's leftover chips stretched to 1fr each (looked busted), and ellipsis-truncating long custom names ("low-energy", "phone-call") was unfriendly. Back to flex-wrap with content-sized chips. Kept the energy-type chip typography (12px font, 32px height, lowercase) so labels still read as the same kind of control as the energy chips above; just no rigid column grid.
  - `title` attr on each chip from PR #56 stays (harmless, useful as accessible name).
  - Modified: `src/v2/components/AddTaskModal.css`

- style(ui): v2 labels grid → 5 wide to match energy-type row [XS]
  - `.v2-form-label-grid` switched from flex-wrap to `grid-template-columns: repeat(5, minmax(0, 1fr))` and chips picked up the energy-type sizing (12px font, 0 8px padding, 32px height, gap 4px). Same width math, same lowercase aesthetic. Long custom-label names ellipsis-truncate; full name available via `title` attribute.
  - Modified: `src/v2/components/AddTaskModal.css`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/EditTaskModal.jsx`

- style(ui): v2 energy-type row fits all five chips on a single line [XS]
  - Was wrapping to two rows on iPhone (`desk / people / errand` then `creative / physical`). New layout: `flex: 1 1 0` per chip with `min-width: 0` so they share equal slices of the row, smaller font (12px) + tighter padding (0 8px) + height 32px + gap 4px. Five-chip width fits ≤375px viewports without ellipsis. `flex-wrap: nowrap` enforces one line.
  - Modified: `src/v2/components/AddTaskModal.css`

- style(ui): v2 chip controls — energy type matches energy drain shape, lowercase chip text [XS]
  - Energy type pills now share the `.v2-form-seg` shape: full pill (`var(--v2-radius-pill)`), 36px height, flex-wrap layout (was 96px-min grid columns with rounded-rect 10px corners). The per-type color treatment in the active state still distinguishes Desk / People / Errand / Creative / Physical via inline border + text colors.
  - Added `text-transform: lowercase` to both `.v2-form-seg` and `.v2-form-energy-pill` so all chip controls read like the user's lowercase labels (Status / Size / Energy type / Energy drain).
  - Modified: `src/v2/components/AddTaskModal.css`

- fix(ui): v2 date input collapses with `appearance: none` — force block + min-height [S]
  - PR #52 stripped iOS Safari's native `<input type="date">` chrome to fix the overflow into Priority. Side effect: with native chrome gone, iOS gives an empty date input zero intrinsic dimensions, so the rendered border collapsed to padding-only and no longer matched the Priority button's width.
  - Fix: `display: block` forces it out of inline layout (where iOS computes width against content); explicit `min-height: 44px` matches `.v2-form-pri-toggle` so the row aligns vertically too. Cleaned up a duplicate `min-width: 0` block while editing.
  - Modified: `src/v2/components/AddTaskModal.css`

- fix(ui): v2 EditTaskModal — strip native date-input chrome + unified add-pill style [S]
  - **Due/Priority STILL overlapped** despite the `minmax(0, 1fr)` fix in PR #51. Root cause was iOS Safari rendering native chrome on `<input type="date">` that bleeds *outside* the styled border into the adjacent grid column. `-webkit-appearance: none; appearance: none;` on `.v2-form-input` strips the native UI and leaves only the styled box; the picker still triggers on tap.
  - **Add-affordance pills were inconsistent.** "+ Add checklist" (dashed, transparent), "Attach files" (gray-fill), "Notion" (gray-fill), "+ Add comment" (gray-fill) — three different visual treatments for four structurally-identical "tap to add" empty-state pills. New shared `.v2-edit-add-pill` class with the dashed-border treatment; applied to all four. Existing `.v2-edit-checklist-new` aliased to the same selector to keep the original markup working.
  - **Verification.** `npm run lint` clean. `npm test` smoke passes. Bundle: 752KB precache (unchanged).
  - Modified: `src/v2/components/AddTaskModal.css`, `src/v2/components/EditTaskModal.css`, `src/v2/components/EditTaskModal.jsx`

- fix(ui): v2 EditTaskModal — Due/Priority overlap + Checklists empty-collapse + Connections moves up [S]
  - **Due/Priority overlap (iOS Safari).** `.v2-form-row` was `grid-template-columns: 1fr 1fr`. `1fr` is shorthand for `minmax(auto, 1fr)`, where `auto` falls back to the cell's intrinsic content size. iOS Safari's `<input type="date">` has a wide intrinsic content size when filled (~150px+), which expanded the Due column past its half-share and overlapped the Priority column. Fix: `minmax(0, 1fr) minmax(0, 1fr)` lets columns shrink below intrinsic. Added `min-width: 0` to `.v2-form-input` / `.v2-form-textarea` defensively.
  - **Checklists section empty-collapse.** CHECKLISTS label only renders when at least one checklist exists. Empty state is just the "+ Add checklist" pill with the tighter `.v2-form-section-compact` margin. Same pattern Attachments / Comments / Connections already use.
  - **Connections moved up.** Block now sits between Attachments and Labels (instead of below Comments). Groups the three "linking content" affordances together: Checklists / Attachments / Connections. Comments stays where it is — it's a task-internal thread, not external linking.
  - **Verification.** `npm run lint` clean. `npm test` smoke passes. Bundle: 752KB precache (unchanged).
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/AddTaskModal.css`

- fix(ui): v2 header trim + EditTaskModal density pass [M]
  - **Why.** Two surfaces became dense as v2 polish piled on. Header had 7 right-side affordances pushing the More button off-screen on iPhone (Settings unreachable). EditTaskModal had Notes pills overlapping DUE labels, Attachments pills bleeding into Energy buttons, an oversized "Convert to routine" full-width button, and unbalanced bottom action row with Delete styled as a loud destructive primary.
  - **Header — animated wordmark replaces sync icon.** Each letter of "BOOMERANG" wraps a span with a per-letter animation delay (60ms stagger). `data-sync-state` on the wordmark drives: `idle` (default), `saving` (staggered Y-bounce, 1100ms loop), `just-synced` (700ms green flash on saving→synced transition), `degraded` (yellow letters when queue is building / SSE reconnecting), `offline` (red letters steady). Removed the cloud / cloud-off icon entirely.
  - **Header — brand-tap popover.** Wordmark is a button now. Tap reveals a popover anchored under the brand with MiniRings (full-size, since they're not crammed into the header strip anymore), today-count shortcut, sync-status text. MiniRings + cloud icon removed from the always-visible header. Frees four slots; More button reachable again.
  - **Header — kept inline.** Today pill (count + "today" label) survives because it's actionable. What now? / + / Sparkles / Package / More cluster fits comfortably.
  - **EditTaskModal — Notes pills moved out of the textarea wrap.** Polish + Research no longer absolute-positioned at the textarea's bottom-right. New `.v2-edit-notes-toolbar` flex row below the textarea uses the `-inline` ai-pill variant. No more overlap with typed text or the next form section.
  - **EditTaskModal — Attach pills go inline.** Attach files / Extract text use `-inline` so they don't escape into surrounding sections.
  - **EditTaskModal — empty sections collapse.** ATTACHMENTS / COMMENTS / CONNECTIONS labels only render when the section has content (or is explicitly opened). Empty state is just the inline "+ Attach files" / "+ Add comment" / "Notion" pill, with a tighter `.v2-form-section-compact` margin so empty sections don't pad out the modal.
  - **EditTaskModal — Convert to routine compacted.** Big full-width dashed button gone. Trigger is a small "Make recurring" pill in the bottom action shelf (RotateCw icon). Cadence picker only renders when actively converting, then disappears after Convert / Cancel.
  - **EditTaskModal — bottom action row rebalanced.** All four pills (Backlog / Projects / Make recurring / Delete) share the neutral `.v2-edit-action` style. Delete only goes loud-red on confirm via `v2-edit-action-confirm-yes`. Row is `justify-content: center` so they spread evenly instead of packing left.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke passes. Bundle: 752KB precache.
  - Modified: `src/v2/components/Header.jsx`, `src/v2/components/Header.css`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/v2/components/AddTaskModal.css`

- feat(ai): polish suggests checklists + labels; next-up toast follow-up-aware [M]
  - **Why.** Two enhancement requests. (1) Polish was just a notes rewrite — it didn't notice when notes described a multi-step process that should become a checklist, or when content matched an existing label. (2) Next-task suggestion on complete used a flat heuristic (high-pri / due-today / size) without considering follow-up signals like same routine, same Notion page, shared tags, or "follow up: X" titles.
  - **Polish enhancements.** `polishNotes(title, rawNotes, availableLabels)` now also returns `suggestedChecklist: { name, items: [{text}, …] } | null` and `suggestedLabels: [labelName, …]`. The system prompt tells the AI to only suggest labels that match exactly from the provided list (never invent), and to suggest a checklist only when the notes describe a multi-step process. Both fields are optional — old behavior preserved for callers that ignore them.
  - **`useTaskForm.handlePolish`.** Loads `availableLabels` and threads them to the API. On response, applies suggested labels by case-insensitive name match against the user's existing labels (never adds new label rows). Stores the proposed checklist on `form.suggestedChecklist` for the consumer to apply. Surfaces a `polishApplied` summary so the UI can confirm what changed.
  - **v2 EditTaskModal — apply UI.** Soft-purple "Polish added X labels" pill plus a checklist suggestion row with an "Apply" button (consumes the suggestion + appends to checklists) and a ✕ dismiss. AddTaskModal shows the labels-applied note + a "Save and reopen to apply checklist" hint (no checklist field at create time).
  - **v1 EditTaskModal — auto-apply.** v1's `handlePolish` now applies suggested labels the same way and auto-inserts the suggested checklist when the task has none yet (v1 has no apply UI, so auto-apply is the cleanest behavior).
  - **Next-up follow-up scoring (v2).** Base score (high_priority +100 / due-today +50 / XS-S +20) preserved. New follow-up signal capped at +90 total: `+40` same `routine_id` (next instance of same recurring task), `+25` same `notion_page_id` (same doc context), `+30` per shared tag (capped at +60), `+35` if title contains follow-up keyword (`follow up`, `follow-up`, `next step`, `reply to`, `respond to`, `after `), `+50` if title mentions the completed task's title verbatim. The cap means a wildly-overdue stranger task can still beat a same-tag low-pri future task — follow-up tunes the order, doesn't dominate.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 750KB precache (up from 746KB).
  - Modified: `src/api.js`, `src/hooks/useTaskForm.js`, `src/v2/AppV2.jsx`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/components/EditTaskModal.jsx`

- fix(ui): v2 version-refresh modal [S]
  - **Why.** v2's `onVersionMismatch` handler unregistered the service worker and triggered `window.location.reload()` after 1s, but rendered no UI between detection and reload. Users on slow connections saw the page seemingly hang then snap-reload — the v1 `update-modal` ("Update available: v0.99 · Refreshing automatically… [Reload now]") wasn't ported.
  - **`v2-update-overlay` + `.v2-update-modal`.** New full-viewport overlay (z-index 9999, fade-in) holding a centered modal with the version label, "Refreshing automatically…" subtitle, and an explicit "Reload now" button for users who don't want to wait the 1s. Service-worker unregister still fires either way.
  - **`checkVersion` polling.** Wired the version-check trigger v1 has — opening any of Settings / Done / Analytics / Routines / Activity Log / Packages / Projects / Adviser / Add / WhatNow / EditTask / MarkdownImport polls `checkVersion()`, which surfaces a stale-client modal without waiting for the next SSE round-trip.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 746KB precache (unchanged).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- feat(routines): "Skip this cycle" button on expanded routine cards [S]
  - **Why.** Vacation, illness, the lawn doesn't need mowing this week — there was no way to advance a routine's cadence without spawning a task and immediately completing it. Now there's a fast-forward button next to the "+" spawn-now control.
  - **Behavior.** Stamps `completed_history` with today's ISO timestamp, which makes `getNextDueDate()` roll forward by one cadence interval. Skips count toward the "Nx completed" total — close enough for a personal app, no separate skip log needed.
  - **UI.** Only shows on non-paused routines (paused routines don't have a current cycle to skip). Title text: "Skip this cycle (advance schedule, no task)".
  - Added: `skipCycle` to `useRoutines.js`, `onSkipCycle` prop wiring through `App.jsx` → `Routines.jsx` → `RoutineCard`.
  - Cherry-picked from main onto dev as part of the v2 → main milestone merge (2026-05-09).
  - Modified: `src/hooks/useRoutines.js`, `src/components/Routines.jsx`, `src/App.jsx`, `CLAUDE.md`, `wiki/Features.md`

- chore(server): delete orphan API routes + dead client wrappers [S]
  - Post-wipe-incident orphan sweep: 4 routes had no callers, 3 client wrappers had no callers. Deleting now to shrink the surface area before someone wires them to something fragile.
  - **Routes deleted (server.js):** `PATCH /api/data/:collection`, `DELETE /api/data`, `POST /api/weather/clear-cache`, `POST /api/trello/sync`. The first two were bulk-blob escape hatches from before the per-record API took over; `weather/clear-cache` was an early debugging endpoint; `trello/sync` is single-list while the working code uses `trello/sync-all-lists`.
  - **Client wrappers deleted (src/api.js):** `trelloSyncCards`, `serverFetchTasks`, `fetchPackage`. None had callers anywhere in `src/` or `public/`.
  - **Kept:** `clearAllData()` in `db.js` is still used by `seed.js`; `clearWeatherCache()` is still used internally on weather-location changes.
  - Cherry-picked from main onto dev (final-mile cleanup, 2026-05-09).
  - Modified: `server.js`, `src/api.js`, `wiki/Architecture.md`

- refactor(db): drop legacy `task.checklist` serialization [S]
  - Migration 018 emptied the legacy flat `checklist_json` column months ago and replaced it with the named `checklists_json` (multi-list) format. The serialization paths still wrote `task.checklist || []` on every upsert and the read path still parsed it into a `checklist` field on every row → JS object trip. Pure cleanup.
  - Removed: `task.checklist` reads/writes in `db.js` `taskToRow`/`rowToTask`/`UPSERT_TASK_SQL`, the `checklist: []` default in `src/store.js` `createTask`, the legacy fallback wrapper in `src/components/TaskCard.jsx`, the legacy migrate-on-read in `src/components/EditTaskModal.jsx`, the inert `checklist_json: '[]'` in `gmailSync.js`'s task constructor.
  - **Column kept.** `checklist_json` stays in the schema (SQLite column drops are painful). It's inert — never read, never written. Existing rows retain their `'[]'` value via the schema default.
  - Cherry-picked from main onto dev (final-mile cleanup, 2026-05-09).
  - Modified: `db.js`, `gmailSync.js`, `src/store.js`, `src/components/TaskCard.jsx`, `src/components/EditTaskModal.jsx`

- feat(ui): v2 MarkdownImportModal + skip ExtendModal/FindRelatedModal as superseded [S]
  - **Why.** Final polish item from V2-State. v1 has three "rare flow" modals — Extend (date preset shortcut), FindRelated (Notion search to link a task), MarkdownImport (bulk task creation from markdown). Audit found Extend + FindRelated are redundant in v2: EditTaskModal's date input already covers Extend's use case, and the inline Notion search in EditTaskModal Connections (PR #36) already covers FindRelated. MarkdownImport is the only one with an actual gap.
  - **`MarkdownImportModal.jsx` + `.css`.** Direct port of v1's component into v2 idiom — wide ModalShell, paste-or-upload first step, preview-and-toggle-tasks second step, "Import N task(s)" CTA. Uses the existing `parseMarkdown` util. Bullets (`- item`), checkboxes (`- [ ] item`), and section headings (`## Section`) all supported; headings become group labels on each parsed task.
  - **More menu wiring.** New "Import from markdown" row in the v2 More menu (Upload icon). State + render wired in AppV2 with the same shape as other secondary modals.
  - **Extend + FindRelated explicitly skipped.** V2-State updated to mark both as "superseded by existing v2 flows" rather than pending. If a future workflow re-introduces a need for fast-preset extending or standalone Notion-search, they can land then.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 746KB precache (up from 743KB).
  - New: `src/v2/components/MarkdownImportModal.jsx`, `src/v2/components/MarkdownImportModal.css`
  - Modified: `src/v2/AppV2.jsx`, `wiki/V2-State.md`

- feat(ui): v2 Analytics — adaptive-throttle 👍/👎 feedback chips [S]
  - **Why.** Analytics polish item from V2-State. v1 surfaced a row of back-off decisions ("Push overdue: 1.0× → 1.5×") with thumbs-up / thumbs-down buttons letting users approve or revert auto-tuning; v2 had no surface, so users couldn't curate the adaptive throttle from v2 at all.
  - **New section.** "Adaptive throttle decisions" at the bottom of v2 Analytics, only renders when there are unreviewed decisions in the last 30 days. Hairline list with channel chip (capitalized), type label, multiplier-before → multiplier-after, decision date, and 👍 / 👎 chip buttons.
  - **Wiring.** `getThrottleDecisions(30)` loads on modal open + after each feedback action; `markThrottleFeedback(id, 'up'|'down')` records the answer. Both functions are dynamic-imported so the test surface stays light.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 743KB precache (up from 741KB).
  - Modified: `src/v2/components/AnalyticsModal.jsx`, `src/v2/components/AnalyticsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 routine suggestion banner [XS]
  - **Why.** `useNotionSync` was already returning `routineSuggestions` / `dismissSuggestion` / `acceptSuggestion` to v2 (PR #31's wiring), but v2 wasn't rendering the suggestion banner — the recurring-pattern detection ran but had no surface.
  - **Banner.** New `.v2-routine-suggestions` row between the TaskListToolbar and the task list. Each suggestion shows "Create routine: **Title** [cadence chip]" with a primary Create button (calls `addRoutine(...)` then `acceptSuggestion`) and a ✕ dismiss button. Soft purple background matches v1's coloring for the banner.
  - **Search-aware.** Hidden when search mode is active so the search results view stays focused.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 741KB precache (up from 740KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `wiki/V2-State.md`

- feat(ui): v2 Notifications — Email deliverability + weather notification toggles [S]
  - **Why.** Three notifications-tab items grouped under one V2-State bullet. Until now `email_from_name`/`email_from_address`/`email_batch_mode`/`weather_notifications_enabled`/`weather_notif_push`/`weather_notif_email` were all v1-only; users had to flip back to v1 to override From, enable batch mode, or toggle weather alerts.
  - **Email deliverability block.** Two compact `.v2-settings-row` entries with `.v2-settings-compact-input-wide` (140px right-aligned) for From name + From address. Batch-mode toggle below with explainer ("Bundles eligible notifications into a single digest-style email instead of sending one per event"). All three gated on `email_notifications_enabled === true`.
  - **Weather notifications block.** Master toggle (gated on `weather_enabled` so it disables when no location is set) + per-channel push/email toggles (gated on the master + each channel's master). Same Toggle-row pattern the rest of the panel uses.
  - **Trailing pointer narrowed.** Now points users at digest schedule + style, adaptive throttling 👍/👎 feedback chips, and Pushover priority routing helper as the only remaining v1-only Notifications surfaces.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 740KB precache (up from 737KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `wiki/V2-State.md`

- feat(ui): v2 EditTaskModal — 7-day forecast widget + weather-hidden + GCal duration override [S]
  - **Why.** Three power-user EditTaskModal items grouped under one V2-State bullet. v2 had no forecast widget on outdoor tasks, no per-task weather hide control, and no GCal-duration override (the size-mapping default was the only value users could get).
  - **Forecast widget.** Reuses the shared `WeatherSection` + `resolveWeatherVisibility` from v1 (no v2 fork needed — they're presentation-pure). Shows when `weather.enabled` and `forecast.days.length > 0` and the task qualifies (outdoor energy / matching keyword / tagged outside). Drawer mode renders a collapsed "🌤 7-day forecast" toggle button that expands inline.
  - **Per-task hide.** Checkbox below the forecast (or inside the drawer) writes `task.weather_hidden`. Same flag used to suppress weather chips on TaskCard.
  - **GCal duration override.** Number input (5-480 minutes, step 5) appears in its own form section when a due date is set. Placeholder shows the size-derived default (XS=15 / S=30 / M=60 / L=120 / XL=240). Empty value falls back to size mapping at sync time.
  - **Wiring.** AppV2 passes the existing `weather` hook value as a prop to EditTaskModal. `weather_hidden` and `gcal_duration` are persisted in `handleSave` so the changes round-trip through `updateTask`.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 737KB precache (up from 735KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `wiki/V2-State.md`

- feat(ui): v2 header chrome — MiniRings + done-today + sync indicator + keyboard shortcuts [M]
  - **Why.** Two polish items from V2-State, both daily-visibility. v2 had no MiniRings (opens Analytics in v1), no done-today counter (opens DoneList in v1), no sync status indicator (saving/offline/synced cloud icon), and no keyboard shortcut wiring. Bundled together since the keyboard shortcuts also touch the header (helper modal + Esc closing).
  - **Header stats cluster.** New `.v2-header-stats` slot between brand and primary actions. Renders MiniRings (24px SVG with the same daily-task / daily-points / streak-divided-by-7 progress arcs v1 uses), a "today" pill (count + label, falls back to a "Done" link when no completions today but some history), and a sync icon (`Cloud` for saving/synced, `CloudOff` for offline; pulsing accent-colored animation while saving; alert-red while offline; subtle green while synced). Mobile collapses the "today" label to the bare count; wordmark hides ≤380px to make room.
  - **Keyboard shortcuts.** Wired `useKeyboardShortcuts` in AppV2: `n` new, `/` search, `j/k` navigate, `e/Enter` edit, `x` complete, `s` snooze, `Esc` close, `?` help. Computed a flat `visibleTasks` list (doing → stale → up-next → waiting → snoozed → backlog → projects) gated on `isDesktop`. v2 TaskCard accepts a new `selected` prop that adds `.v2-card-selected` (accent-colored border + soft glow). KanbanBoard threads `selectedTaskId` through to its inner Column for the desktop drag-drop surface.
  - **Modal-stack-aware Esc.** AppV2 builds an `activeModals` array each render in deepest-first order (snooze < reframe < edit < add < whatnow < settings < projects < done < activitylog < routines < packages < adviser < analytics < menu < search) and `closeTopModal` pops the deepest one. Same pattern v1 uses; lets `Esc` traverse stacked surfaces predictably.
  - **`?` help dialog.** New ModalShell at `showHelp` rendering a hairline list with `<kbd>` chips per shortcut. Toggleable via the `?` key.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 735KB precache (up from 732KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `src/v2/components/Header.jsx`, `src/v2/components/Header.css`, `src/v2/components/TaskCard.jsx`, `src/v2/components/TaskCard.css`, `src/v2/components/KanbanBoard.jsx`, `wiki/V2-State.md`

- feat(ui): v2 Integrations — Notion parent-page sync configuration [S]
  - **Why.** Last item on the v2-medium-priority list. v2 had no UI for picking the Notion parent page that drives pull-sync — users had to flip back to v1 to set or change it. Now the Notion row exposes a parent-page picker inline.
  - **`inline: 'notion-config'` mode on the Notion row** (when connected). Unconfigured state: search input + Search button. Calls `notionSearch(query)`; results render in the same hairline scroll list pattern Weather + Trello pickers use. Picking a result writes `notion_sync_parent_id` + `notion_sync_parent_title` and immediately fetches `notionGetChildPages(id)` to surface the child count.
  - **Configured state.** "📄 Syncing from **Page name**" with child count + last-sync timestamp underneath; "Change page" button to clear and re-pick. The Sync-now button on the row continues to fire `syncNotion()` (already wired via PR #31).
  - **Mount-time hydration.** New effect re-fetches the child-page count on settings open whenever a parent ID is configured + Notion is connected. Cleanup-flag pattern matches the other status-gated lazy loaders in the panel.
  - **Database sync** (querying a Notion database directly rather than walking a parent's children) deferred — that's a separate config flow with its own quirks.
  - **All seven medium-priority items now done.** Channel test buttons + notification history (PR #33), weather geocode (PR #34), EditTaskModal Comments/Research/Attachments/Extract-Text (PR #35), Notion link/create on tasks (PR #36), Trello/GCal/Gmail picker UIs (PR #37), and Notion DB sync config (this PR). V2-State TL;DR updated.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 732KB precache (up from 729KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `wiki/V2-State.md`

- feat(ui): v2 Integrations — Trello board/list, GCal calendar, Gmail scan-window pickers [M]
  - **Why.** Final piece of the v2-Integrations medium-priority list. Connected Trello/GCal/Gmail rows previously just showed status + a "Manage in v1" button. Now they expose the most-touched settings inline so users don't need v1 for daily picker tweaks.
  - **Trello config.** When `statuses.trello.connected` is true, the row's inline area shows a Board dropdown (loaded once via `trelloBoards()`) and — once a board is picked — a Default list dropdown (loaded via `trelloBoardLists(boardId)` whenever the board changes). Picking a board resets the list selection. Multi-list sync checkboxes deferred; the per-task list picker in EditTaskModal still lets users override per push.
  - **GCal config.** Calendar dropdown loaded via `gcalListCalendars()`; renders calendar `summary` with "(Primary)" suffix where applicable. Push / Pull toggles for `gcal_sync_enabled` / `gcal_pull_enabled`, each as a `.v2-integrations-toggle-row` (label-left + iOS-style toggle right). Status filter checkboxes deferred — sensible defaults (all active statuses) cover the common case.
  - **Gmail config.** Auto-scan toggle + scan-window number input (1-30 days, default 7). Same row pattern as GCal toggles.
  - **Status-gated lazy loading.** All three pickers fetch data only when their integration is connected, with cleanup flags to avoid setting state on unmount mid-fetch. Cancellable via `cancelled` closure. Failures are silent (status dot already telegraphs disconnection).
  - **Right-column action button.** Hidden for any integration whose `inline` mode is non-null — the new picker UIs replace the "Configure / Manage in v1" button. Updated the gate from a 2-mode list to a 5-mode allow-list.
  - **CSS.** New `.v2-integrations-toggle-row` (flex space-between, label-left + control-right) for the GCal/Gmail toggle pairs.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 729KB precache (up from 725KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 EditTaskModal — Notion link + create [S]
  - **Why.** Per-task Notion linking was the last piece of v1's EditTaskModal "Connections" panel that v2 didn't carry. `useTaskForm` already had the full handler set (`notionState`, `notionResult`, `handleNotionSearch`, `handleNotionCreate`, `handleNotionLink`, `setNotionResult`) — they just had no v2 render path.
  - **New Connections section** between Comments and the action row. Initial state shows a "Notion" pill button (disabled if title is empty). Clicking calls `handleNotionSearch(title, notes)` → `suggestNotionLink` server-side. While searching, a spinner row reads "Searching Notion…". On error: red message + Retry pill.
  - **Suggestions list.** Server returns matched pages via AI similarity; v2 renders them as a hairline list of full-width buttons. Picking one calls `handleNotionLink(page)` → notionResult populated → linked-pill state.
  - **Create new.** Falls through if no good match: "Create new Notion page" pill calls `handleNotionCreate()` → server creates the page with the task's title/notes/labels → notionResult populated.
  - **Linked state.** Shows "Notion ↗" pill linking to `notionResult.url` with a ✕ unlink. Unlinking just clears `notionResult` locally — the actual Notion page stays put; the task simply stops tracking it.
  - **Persistence.** `handleSave` payload includes `notion_page_id: form.notionResult?.id || null` and `notion_url: form.notionResult?.url || null`. Same shape v1 saves; ongoing sync (`useExternalSync`) picks up the link automatically.
  - **`v2-form-ai-pill-static`.** New CSS class to opt out of the default `position: absolute` on `.v2-form-ai-pill`. Lets the pill sit inline in the Connections row alongside other pills.
  - **Note.** "DB sync configuration" (parent-page picker, database picker) split off into its own pending bullet for a future PR — that's a Settings flow with a different shape than the per-task link UI.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 725KB precache (up from 722KB).
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `wiki/V2-State.md`

- feat(ui): v2 EditTaskModal — Comments, AI Research, Attachments, Extract-Text [M]
  - **Why.** Common power-user features in v1's EditTaskModal that v2 didn't carry — users had to flip back to v1 to attach files, run AI research on a task, extract text from PDFs/images, or thread comments. Medium-priority item knocked off in one PR since they all live in the same modal.
  - **Research.** New "Research" pill next to "Polish" in the Notes action row. Click toggles an inline prompt input + Go button. Submitting calls `researchTask(title, notes, prompt, attachments)` and replaces notes with the AI-augmented version. State + handler live inline in EditTaskModal v2 (not in `useTaskForm`) since AddTaskModal doesn't surface Research.
  - **Attachments.** New section between Checklists and Labels. Reuses the `useTaskForm` attachments support (`attachments` / `handleFileSelect` / `removeAttachment` / `formatFileSize` / `attachError` / `extracting` / `handleExtractText`) which was already present but never rendered in v2. File picker accepts images/PDF/text formats; 5MB total cap; hairline-bordered list with name + size + ✕ remove per item.
  - **Extract Text.** When ≥1 attachment is present, an "Extract text" pill appears next to "Attach files." Calls `extractAttachmentText(attachments)` and appends the AI-extracted text to the existing notes (preserves the user's manual notes; doesn't overwrite).
  - **Comments.** New section between Make-recurring and the action row. Each comment is `{id, text, created_at}` (same shape v1 saves). List shows comment text + relative timestamp + ✕ remove per item. Input + Add button at the bottom; Enter also adds. Collapsed by default for tasks with no comments — "+ Add" affordance opens it.
  - **Persistence.** `handleSave` payload now includes `attachments: form.attachments` and `comments` so the changes round-trip through the existing `updateTask` path. Same data shape v1 uses, so cross-UI parity is preserved.
  - **Action-pill positioning.** v2's `.v2-form-ai-pill` was previously absolute-positioned solo at bottom-right of the textarea wrap. New `.v2-edit-notes-actions` flex container holds Polish + Research at `position: absolute; bottom: 8px; right: 8px`, with the pills inside reset to `position: static` so they flow side-by-side cleanly.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 722KB precache (up from 717KB).
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `wiki/V2-State.md`

- feat(ui): v2 weather location picker in Integrations [S]
  - **Why.** Medium-priority item from V2-State. v2 had no surface for setting the weather location at all — users had to flip back to v1 just to point Boomerang at a city/zip. Open-Meteo is keyless so this is purely a geocode + setting-write flow.
  - **New `inline: 'weather'` row in IntegrationsPanel.** When unconfigured, shows a search input + Search button; Enter submits. Results render as a hairline-bordered scroll list with the geocoded `label` (city, region, country) per item. Picking a result writes `weather_latitude`, `weather_longitude`, `weather_location_name`, `weather_timezone` and flips `weather_enabled` on if it wasn't, then forces a server cache refresh so the badges/forecast update without a full reload.
  - **Configured state.** "📍 Location name" line + a "Change location" button that clears the lat/lon/name and disables `weather_enabled`, returning the row to the search state.
  - **Connection dot.** Weather row's status dot lights green when both `weather_enabled` is true and `weather_latitude` is set.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 717KB precache (up from 715KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 channel test buttons + notification history in Notifications tab [M]
  - **Why.** Two of the medium-priority items from V2-State knocked out together since they share the same panel. v2 Notifications had no way to fire a one-off test (Push / Email / Pushover priority-0 / Pushover Emergency / Digest) and no surface for the historical `notification_log` rows — both lived only in v1.
  - **Test buttons.** New "Test channels" block with five buttons. Each button gates on its channel master being on (and Pushover additionally on credentials being saved). Per-button state machine: idle → sending → sent ✓ → idle (4s auto-reset) or error with inline message. Digest test surfaces which channels actually fired (e.g. "Sent via push, email"). Pushover Emergency gates behind a v2 confirm dialog since it triggers the priority-2 alarm.
  - **Notification history.** Collapsible block at the bottom of the panel. First expand triggers `getNotifLog(50)` and renders a hairline list of recent entries: channel chip + type + time on the meta row, then title + body. Refresh button (with spinner) and Clear button (calls `clearServerNotifLog()`) in a small toolbar. Capped at 50 entries; max-height 360px with internal scroll.
  - **Polish.** Trailing "More notification options" pointer narrowed — no longer mentions test buttons or history (those landed); now points at digest schedule + style, adaptive throttling 👍/👎 chips, email From overrides + batch mode, Pushover priority routing helper, and weather-notification toggles as the remaining v1-only surfaces.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 715KB precache (up from 710KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- fix(ui): v2 visual bugs from device screenshots — notif cards, quiet hours, settings rows, dark-mode init, danger zone [M]
  - Five fixes for visual bugs the user logged from the live `:dev` build earlier today.
  - **Bug 1 — notification matrix cut off on narrow screens.** Replaced the type×channel `<table>` with a card-per-type list. Each `.v2-notif-card` has type label + freq input on top, a 3-column grid of channel toggles (Push / Email / Pushover) below — labeled chips so the channel name doesn't need a header row. Works at any width without horizontal scroll. Same data shape, same toggles, same settings keys; just a different render.
  - **Bug 2 + 3 — quiet hours inputs.** New `.v2-settings-quiet-times` flex row with `.v2-settings-time-input` (110px wide, 8px/10px padding) for the START/END time inputs. Bypass label moved into a labeled row using the new `.v2-settings-compact-input-wide` (140px). Native `<input type="time">` retained — a custom time picker is over-engineering for the use case.
  - **Bug 4A — dark-mode toggle desyncs from actual theme.** Two-part fix. `AppV2.jsx` mount effect now reads `loadSettings().theme` and applies `data-theme` + `meta[name="theme-color"]` so the rendered UI matches whatever the toggle reads. Settings toggle default also flipped from `(theme || 'dark') === 'dark'` to `theme === 'dark'` — v2 tokens default to light when `data-theme` is unset, so the previous "default to dark in the toggle" assumption was the source of the desync.
  - **Bug 4B — General-tab number inputs full-width.** Each numeric setting (default due days, staleness, reframe trigger, max open tasks) restructured from a vertical block (label / hint / full-width input) to a `.v2-settings-row` (label + hint on the left, 80px right-aligned `.v2-settings-compact-input` on the right). Reads cleaner on mobile.
  - **Bug 5 — danger-zone buttons inconsistent.** Both buttons now stack full-width (`.v2-settings-btn-block`) inside `.v2-settings-danger-actions` flex column. Outline-red "Clear completed tasks" sits above filled-red "Clear all data" — same width, same height, intentional fill-intensity step indicating destructiveness.
  - **Other.** Removed the orphan `@media (max-width: 600px)` rule that referenced the now-deleted `.v2-notif-matrix*` classes.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 710KB precache (up from 709KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 manual sync triggers (Trello / Notion / GCal / Gmail) in Integrations [M]
  - **Why.** Last v2 ship-blocker. v2 had no manual "Sync now" UI for any of the four pull-sync integrations — users had to flip back to v1 to trigger a one-shot sync. Worse: AppV2 wasn't even mounting `useNotionSync` or `useGCalSync`, so the auto-on-mount + visibility-change syncs that v1 runs were silently disabled on dev. This commit fixes both.
  - **AppV2 hook wiring.** Added `useNotionSync(tasks, setTasks)` and `useGCalSync(tasks, setTasks)` imports and call sites alongside the existing `useTrelloSync`. Pulled `syncTrello` / `syncing: trelloSyncing` from the existing useTrelloSync call (was previously only consuming `pushStatusToTrello`). Threaded all three sync functions + their busy flags through to `<SettingsModal>` as new props.
  - **IntegrationsPanel "Sync now" buttons.** New `sync` field on each integration descriptor — `{ fn, busy }`. Trello gated on `trello_sync_enabled`, Notion on `notion_sync_parent_id`, GCal on `gcal_pull_enabled`. Button uses `RefreshCw` icon with `v2-spinner` class while busy and "Syncing…" / "Sync now" labels.
  - **Gmail.** Doesn't have a hook — handled inline via `runGmailSync()` in IntegrationsPanel. Dynamic-imports `gmailSync(gmail_scan_days)`, then surfaces a `syncResult` line under the row ("N task(s), M package(s)" or "Error: …") that auto-fades after 6 seconds.
  - **Row layout.** `.v2-integrations-row-actions` is a vertical flex column on the right side of each row holding the Sync now button stacked above the existing Configure / Manage button. `.v2-integrations-sync-result` lives at the bottom of the meta column for the Gmail post-sync summary.
  - **Behavior fix.** AppV2 now runs Notion + GCal pull-sync on mount + on visibility-change, matching v1 — fixes a silent regression where the dev image wasn't pulling inbound from those integrations at all.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 709KB precache (up from 707KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- docs(v2): park "terminal-aesthetic theme" idea (init.habits inspiration) [XS]
  - User shared a screenshot of [init.habits](https://inithabits.com) — monospace + ASCII checkboxes + terminal palette + command-prompt header. Logged as a future-direction parking-lot bullet in V2-State.md: a possible third theme tier beyond light/dark via a new `data-ui` mode that swaps `tokens.css`. Explicitly not a v2 ship item; post-dev→main experiment.
  - Modified: `wiki/V2-State.md`

- docs(v2): log 5 known visual bugs from device screenshots [XS]
  - User reported 5 visual bugs from the live `:dev` build via screenshots: Notifications matrix cut off on narrow screens (Bug 1), Quiet hours time inputs overlap + bypass-label input oversized (Bug 2), time selectors feel disconnected (Bug 3), Dark-mode toggle desyncs from actual theme + General-tab number inputs full-width (Bug 4), Danger zone buttons inconsistent (Bug 5). Captured in V2-State.md "Known visual bugs (deferred)" with reproduction context and fix-direction hints. None block functionality — parked until light-mode polish settles. Also updated the dark-mode QA bullet to reference Bug 4 as the canonical instance, and the final-mile cherry-pick bullet to drop `422c2ff` from the skip-cycle entry (the hook port already landed via PR #24).
  - Modified: `wiki/V2-State.md`

- feat(ui): v2 Anthropic key entry + status check in AI tab [S]
  - **Why.** Ship-blocker. AI tab had a "Open v1 → AI" punt button for the entire API-key flow; users couldn't configure Claude from v2 at all. Notion/Trello-class punts make sense (heavy OAuth flows); Anthropic doesn't (pure key entry).
  - **`AnthropicKeyBlock`.** New sub-component in the AI tab. Loads `getKeyStatus()` on mount to detect `ANTHROPIC_API_KEY` env var. If env-set: read-only notice + a Test button. If user-set: password input (with show/hide toggle for verifying paste), Test button, Disconnect button (clears the key + resets status). Test calls `api.callClaude('Respond with just "ok".', 'ping')`. Status states: null / 'checking' / 'connected' / 'error', surfaced as a live status line below the controls.
  - **Integrations panel split.** Anthropic row in IntegrationsPanel previously had its own inline api-key input (duplicating what the AI tab now has). New `manageInTab` field on the integration descriptor — Anthropic's row now reads "Configure in AI" and clicking flips the active tab. `setActiveTab` threaded into IntegrationsPanel.
  - **OAuth-deferral copy updated.** The intro hint at the top of Integrations now reads "Anthropic is configured in the AI tab. Simple key-only integrations (17track, Pushover) can be set inline below."
  - **Model picker dropped.** Original ship-blocker text said "API key entry + model picker + status check." Dropped the picker — server-side `ADVISER_MODEL` and all other call sites are hardcoded today, so there's nothing for a UI picker to drive. Easy to add later if model selection becomes user-controllable.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 707KB precache (up from 705KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 Pushover credential entry + test buttons in Integrations [S]
  - **Why.** Pushover can't be set up from v2 at all today — clicking the row just punted to v1. But Pushover is credential-only (user_key + app_token, no OAuth flow), so the v1 punt was overkill. Ship-blocker on the v2 polish list.
  - **Inline form.** Reclassified Pushover from OAuth-deferred to `inline: 'pushover'` in `IntegrationsPanel`. Two password inputs (user_key + app_token), with the app_token field placeholder + disabled state respecting `pushoverStatus.app_token_from_env`. Hint copy points users at the Notifications tab for type-by-type Pushover toggles.
  - **Test buttons.** "Test" (priority-0, fires immediately) and "Test emergency" (priority-2, opens a v2 confirm dialog first since it triggers the bypass-DND alarm). Both show transient sending → sent ✓ → idle states; errors render inline in v2-alert-overdue red. Wired through dynamic-imported `testPushover` / `testPushoverEmergency` from api.js so the panel doesn't pull the test functions into the main bundle.
  - **OAuth-deferral copy updated.** "OAuth-heavy integrations" line at the top + "OAuth flows for Notion / Trello / Google Calendar / Gmail / Pushover" line at the bottom both drop Pushover from the punt list. Anthropic + 17track + Pushover are now the three inline-credential integrations.
  - **CSS.** `.v2-integrations-inline` now flex-column with gap so multiple inputs stack cleanly. New `.v2-integrations-actions` (flex row, wraps) and `.v2-integrations-error` (small alert-red copy).
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 705KB precache (up from 703KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 search bar + results view [S]
  - **Why.** Daily-use ship-blocker. v1 had a magnifier in the header; v2 had nothing — users had to flip back to v1 to find an old task by keyword.
  - **Search lives in TaskListToolbar.** Added a Search icon button next to the sort button. Click flips the toolbar into search mode: pills + sort + search-icon hidden, replaced by a Search-icon-prefixed input + X close button in the same row real estate (no layout shift). Esc closes too.
  - **Debounced fetch.** AppV2 owns `searchOpen` / `searchQuery` / `searchResults`. `handleSearchChange` debounces 300ms then hits `GET /api/tasks?q=<query>` (same endpoint v1 uses; covers every task — active, done, backlog, project). `searchResults === null` means "search mode active, but no query / not yet fetched"; an empty array means "no matches"; a populated array renders.
  - **Results render.** When `searchOpen`, the regular section list is replaced by a single SectionLabel ("N result(s)") + TaskCard list. Wired through the same TaskActionsContext-style handlers as the regular list — Complete / Edit / Snooze all work from results.
  - **Empty states.** "Type to search" while idle, "No matches" when the query returns nothing.
  - **`onCloseSearch`.** Resets query + results + clears the debounce timer. Toolbar still renders even when there are zero tasks if search is open (so the close button is reachable).
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 703KB precache (up from 701KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/TaskListToolbar.jsx`, `src/v2/components/TaskListToolbar.css`, `wiki/V2-State.md`

- feat(ui): v2 TaskListToolbar — sort dropdown + tag filter pills [M]
  - **Why.** v2's task list was hardcoded to `'age'` sort with no filter UI — every-page gap that pushed users back to v1 just to focus on a tag or change the sort key. Last two ship-blockers from the v2 polish list landed together since they share the toolbar surface.
  - **New `TaskListToolbar` component.** `src/v2/components/TaskListToolbar.{jsx,css}`. Renders above the task list (and above KanbanBoard on desktop). Horizontal pill row: All + each user label + Routines (visual divider, opens RoutinesModal). Active label pill takes the label's color. Sort dropdown on the right: ArrowUpDown icon → menu with age / due-date / size / name. Click-outside closes. Pills row scrolls horizontally without a visible scrollbar when overflowing.
  - **AppV2 wiring.** Three new state pieces — `activeFilter` (default `'all'`), `sortBy` (initialized from `settings.sort_by` or `'age'`), `labels` (lifted up so the toolbar sees user-edited labels — settings close handler refreshes via `setLabels(loadLabels())`; cross-client hydrate also pushes new labels into state). `filterTasks(list)` filters on `tag` membership. All seven section arrays (doing/stale/up next/waiting/snoozed/backlog/projects) now go through `filterTasks` then `sortTasks(_, sortBy)`. Projects keeps its `name` sort when sortBy is `'age'` (visual consistency with v1 — projects lean alphabetical).
  - **Persistence.** `handleSortChange` writes `settings.sort_by` and triggers a sync flush so the change rides the standard server path. Filter is in-memory (matches v1 — same intent, transient view state).
  - **Empty-state nuance.** When filter is active and yields zero matches, the empty state copy switches to "No tasks match this filter" with a "Show all" CTA that resets the filter. When unfiltered list is genuinely empty, the original "Nothing on your plate" + "Add task" message stays.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 701KB precache (up from 697KB — new component + CSS).
  - New: `src/v2/components/TaskListToolbar.jsx`, `src/v2/components/TaskListToolbar.css`
  - Modified: `src/v2/AppV2.jsx`, `wiki/V2-State.md`

- feat(ui): v2 RoutinesModal — skip-this-cycle button [S]
  - **Why.** Top ship-blocker on the v2 polish list. Without it, vacation/illness/"the lawn doesn't need mowing this week" forces the user to spawn-now then immediately complete, which both pollutes the active task list and double-counts the cycle. Main has the feature (commit `422c2ff`, 2026-05-09 earlier in the day); dev didn't pick it up because the original landing path was a failed merge that was reverted before reaching dev.
  - **Hook port.** Ported `skipCycle(routineId)` callback from main's `useRoutines.js` verbatim. Stamps `completed_history` with `now()` so `getNextDueDate()` rolls forward by one cadence interval. No DB schema change, no server endpoint — pure local-state mutation flushed via the existing routine sync. Skips count toward the "Nx completed" total — close enough for a personal app, no separate skip log.
  - **v2 wiring.** `AppV2.jsx` destructures `skipCycle` from `useRoutines()` and passes `onSkipCycle={skipCycle}` into `<RoutinesModal>`. `RoutinesModal.jsx` adds `FastForward` lucide import, threads `onSkipCycle` through both `RoutineRow` (active and paused lists) and the modal-level component, and renders a "Skip cycle" action button right next to "Spawn now" in the expanded routine card. Title attribute: "Skip this cycle (advance schedule, no task)".
  - **Hidden for paused routines.** Same logic v1 uses — paused routines don't have a current cycle to skip, so the button doesn't render when `routine.paused` is true. Spawn now stays available since you can still ad-hoc spawn from a paused routine.
  - **v1 untouched.** `src/AppV1.jsx` and `src/components/Routines.jsx` deliberately not changed. v1 on dev stays as the legacy escape hatch (per the v2 plan, v1 is frozen and gets deleted in the final-mile cleanup). The cherry-pick from main that brought App.jsx + v1 Routines.jsx changes was aborted because dev's App.jsx is now the thin router, not the v1 component.
  - **Verification.** `npm run lint` clean (warnings only), pre-push smoke test passes.
  - Modified: `src/hooks/useRoutines.js`, `src/v2/AppV2.jsx`, `src/v2/components/RoutinesModal.jsx`, `wiki/V2-State.md`

- docs: lock in MCP PR-and-merge as canonical dev workflow [S]
  - **Why.** Direct `git push origin dev` is still 403'ing on the local proxy as of 2026-05-09 (re-tested today, same error as 2026-05-03). Ref deletions also 403. Rather than treat the workaround as a temporary fallback, the MCP-PR-and-rebase-merge loop is now the documented canonical workflow until/unless the proxy bug gets diagnosed. Fully automated end-to-end with no GitHub-UI clicks — verified by PR #22, which exercised the entire loop including the auto-delete-on-rebase-merge behavior.
  - **`CLAUDE.md` Git Rules rewrite.** Rule 1 changed from "ALWAYS push to main" (the v1-era directive) to "`dev` is active; `main` is production." Rule 2 renamed from "never push without approval" to "never merge a PR without approval" — same intent, current mechanics. Rule 3 swapped `git pull origin main` for `git fetch && checkout dev && reset --hard origin/dev`. Rule 6 split push-triggers-build into "merge to dev/main triggers Docker build." New "Workflow: how dev work lands" subsection captures the 6-step loop verbatim.
  - **`wiki/V2-State.md` updates.** Replaced the stale "Branch / merge instructions" section (which still referenced `claude/v2-pending-merge` as if it were a live branch) with a generalized "How work lands on dev" how-to. Updated "Why this branch instead of direct push" → "Why MCP PR-and-merge instead of direct push" with current bug status. TL;DR section now calls out the workflow as locked in. Final-mile cleanup updated: removed npm-audit (already cherry-picked), kept the remaining main-only commits as separate cherry-pick targets, added a note about the stranded `test-push-probe` ref.
  - **Branch hygiene.** `claude/v2-cherry-npm-audit` auto-deleted on PR #22 rebase-merge. `claude/v2-polish-session-HTNSN` deleted locally (was at `dfb27fc`, no unique commits). Stale `origin/claude/v2-cherry-npm-audit` tracking ref pruned via `git fetch --prune`. `test-push-probe` on origin can't be deleted via proxy or MCP — flagged for user to delete via GitHub UI.
  - Modified: `CLAUDE.md`, `wiki/V2-State.md`, `wiki/Version-History.md`

- feat(ui): v2 EditTaskModal — multi-list checklists [M]
  - **Why.** Biggest daily-use gap in v2 EditTaskModal — no way to add/manage checklist items, so users had to flip back to v1 to edit any task with a checklist. Ships the multi-list shape v1 already uses (`task.checklists = [{ id, name, items: [{id,text,completed}], hideCompleted }]`). Migration 018 promoted `task.checklist_items` → `task.checklists` server-side; v2 TaskCard count was reading the legacy field — also fixed.
  - **Scope.** Add/rename/delete checklists, add/check/rename/delete items, hide-completed toggle (+ "N completed hidden" footer), per-list progress bar, "Add another checklist" affordance. Modeled on v1's section but with the v2 hairline + accent palette.
  - **Deferred (vs v1).** Drag-drop reorder of items within a list and reorder of lists themselves. Use case is rare enough to defer; if it gets missed, can come back as a separate commit. The data shape is identical so reorder UI can drop in without migrations.
  - **TaskCard fix.** v2 TaskCard expanded view summary now reads from `task.checklists` (sums items across all lists) instead of the legacy `task.checklist_items`. Renders correctly for the new shape.
  - **`handleSave`.** Serializes `checklists` into the patch sent to the shared `updateTask`. No server-side change — same shape v1 saves.
  - **Verification.** `npm run build` clean (852KB precache), `npm run lint` clean, `npm test` smoke test passes.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/v2/components/TaskCard.jsx`

- chore(deps): clear 2 high-severity npm-audit vulnerabilities [XS]
  - `fast-uri` 3.1.0 → 3.1.2 (path-traversal + host-confusion via percent-encoded sequences; transitive via ajv → MCP SDK).
  - `@babel/plugin-transform-modules-systemjs` 7.29.0 → 7.29.4 (arbitrary code generation on malicious input; transitive via vite-plugin-pwa workbox; build-time only).
  - `npm audit` clean afterward. Smoke test passes.
  - Cherry-picked from main onto dev as the proxy-push diagnostic payload (2026-05-09 session).
  - Modified: `package-lock.json`

---

## 2026-05-08

- fix(db): delete legacy tasks/routines JSON-blob ghost-revive path [S]
  - **Why.** Post-incident audit flagged `seedFromJsonBlobs()` in `db.js` as a ghost-revive vector. On every server boot, if the SQL `tasks` / `routines` tables were empty, the function read `app_data.tasks` and `app_data.routines` JSON blobs and re-populated the SQL tables. That blob hadn't been written to since migrations 002 + 003 landed months ago — anything in it was a months-stale snapshot. Any future event that emptied the SQL tables (corruption, accidental drop, restore-with-empty-arrays) would silently re-hydrate from this stale snapshot instead of surfacing the failure obviously.
  - **Removed:** `seedFromJsonBlobs()` function, the `seedFromJsonBlobs()` call from `initDb()`, and the `if (row.collection === 'tasks' || row.collection === 'routines') continue` skip clauses in `getAllData()` (no longer needed once the legacy rows are gone).
  - **Added migration 022** (`migrations/022_drop_legacy_task_routine_blobs.sql`) — `DELETE FROM app_data WHERE collection IN ('tasks', 'routines')` to clean up the orphan rows.
  - **Verified.** Smoke test passes. Bundle parses. Server boots clean (migration 022 runs once, deletes the rows, marks itself complete).
  - Modified: `db.js`, `wiki/Architecture.md`
  - New: `migrations/022_drop_legacy_task_routine_blobs.sql`

- fix(ui): v2 SettingsModal restore uses in-app confirm modal [XS]
  - Mirror of the v1 change. v2 already had a `confirmDialog` state pattern matching v1's, so the swap is purely call-site — replace browser-native `confirm()` in `handleImportData` with `setConfirmDialog()`. Invalid JSON and restore failures also surface in-app now.
  - Modified: `src/v2/components/SettingsModal.jsx`

- fix(settings): use in-app confirm modal for restore-from-backup [XS]
  - The restore confirmation was using browser-native `confirm()`, which on iOS shows the awkward "[hostname] says..." prefix and doesn't match the rest of the app. `Settings.jsx` already has a `confirmDialog` state pattern with matching markup at the bottom of the component — wired the restore flow to use it. Bonus: invalid-JSON and restore-failure paths also use the modal now instead of `alert()`.
  - Modified: `src/components/Settings.jsx`

- fix(ci): bump tag on refactor/perf/chore commits, expand restoreFromBackup doc [XS]
  - The previous `custom_release_rules` listed only `feat`/`fix`/`breaking`/`major`/`minor`/`patch`. Today's `refactor(server)` commit didn't bump the tag because `refactor` wasn't mapped — workflow ran but produced no new image. Added `refactor`, `perf`, `chore`, `style`, `docs`, `test` all → `patch` so future non-feat/non-fix commits trigger deploys reliably. Doc expansion on `restoreFromBackup` in `src/api.js` is the trigger to bypass `paths-ignore` (`.github/**` is ignored, so a workflow-only change wouldn't fire CI).
  - Modified: `.github/workflows/build-and-publish.yml`, `src/api.js`

- refactor(server): retire bulk task/routine/package writes, add restore endpoint [M]
  - **Why.** Post-incident audit found that `setAllData()` still routed `tasks`/`routines`/`packages` keys through `syncTasksFromArray()` / `syncRoutinesFromArray()` / `syncPackagesFromArray()` — bulk delete-and-replace helpers that were the wipe vector. Today's earlier fix added a 409 guard against empty/>50%-shrink task arrays, but routines had **no shrink guard at all**, and a future regression could re-introduce the same bug at any scale.
  - **Server-side closure.** `setAllData()` now throws if it sees a `tasks`/`routines`/`packages` key. `PUT/POST /api/data` reject those keys at the request level with 400 + clear `bulk_path_does_not_accept_arrays` error. Bulk path is settings + labels only. `syncTasksFromArray` / `syncRoutinesFromArray` / `syncPackagesFromArray` deleted entirely (~80 lines of dead code).
  - **New `POST /api/data/restore` endpoint.** Explicit wipe-and-replace semantics for backup restoration. Requires `confirm: "wipe-and-replace"` in body. Replaces tasks and routines per-record (delete-then-upsert), overwrites settings + labels blobs. Does NOT touch OAuth tokens, push subscriptions, notification logs, weather cache, adviser chats, or any other infrastructure — restore is intentionally narrower than the old `PUT /api/data` flow which would silently nuke OAuth tokens etc via `clearAllData()` then write whatever was in the backup.
  - **Settings UI updated.** Both `Settings.jsx` and `v2/SettingsModal.jsx` `handleImportData` now call `restoreFromBackup()` from `api.js` (which hits the new endpoint with the confirm field). UI also shows a confirmation dialog with task/routine counts before restoring. Previous implementation was silently broken anyway — it sent the bulk PUT without `_clientId`, which `guardStaleClient` rejected as no-op, so nothing was actually being restored.
  - **`seed.js` updated.** Test seed (`SEED_DB=1`) was the last legitimate caller of bulk task/routine writes. Now uses `upsertTask` / `upsertRoutine` per record, `setData` for settings/labels blobs.
  - **Verified.** `node --check` clean across `seed.js`, `server.js`, `db.js`, `src/api.js`, `src/components/Settings.jsx`, `src/v2/components/SettingsModal.jsx`. Smoke test passes.
  - Modified: `db.js`, `server.js`, `seed.js`, `src/api.js`, `src/components/Settings.jsx`, `src/v2/components/SettingsModal.jsx`

- fix(sync): strip tasks/routines from bulk PUT — close the wipe vector client-side [S]
  - **Why.** The 2026-05-07 wipe was a 3-layer failure: Portainer bouncing the container, client hydrate-then-flush race, server bulk-PUT with no destructive-write guard. The server guard from earlier today closes layer 3. This commit closes layer 2 — the client no longer puts the entire tasks/routines arrays into the bulk PUT payload at all. The class of bug is gone from the client side, server guard becomes belt-and-suspenders rather than the only line of defense.
  - **Change.** `buildPayload()` in `src/hooks/useServerSync.js` no longer reads tasks/routines. The bulk PUT carries only `settings` and `labels` (which still live as JSON blobs in `app_data`). All four call sites updated: `pushBulkState`, `pushChanges` no-prev fallback, `fetchAndHydrate` empty-server branch, and the `beforeunload` handler.
  - **`pushChanges` no-prev fallback hardened.** Previously, when `prevTasks`/`prevRoutines` were null (hydrate hadn't completed yet), pushChanges fell back to `pushBulkState(tasks, routines)` which sent the unverified local state to the server. That was the exact wipe vector. Now: skip the push entirely with a log line — local state isn't authoritative until hydrate succeeds. Settings/labels changes still flush via the manual `flush()` path.
  - **Lost capability.** The "server empty, push local state" fallback in `fetchAndHydrate` now only seeds settings/labels — not tasks/routines. In practice this branch was dead code (server always responds with at least `_version`) so the loss is theoretical. Per-record `/api/tasks` API remains the supported path for legitimate task creation.
  - Modified: `src/hooks/useServerSync.js`

- fix(ci): pipeline now logs Portainer response + verifies deploy actually landed [S]
  - **Why.** Even with the fail-loud fix from earlier today, a successful workflow only proves the webhook returned 2xx — it doesn't prove the container actually redeployed. After Portainer self-updates (like the 2026-05-06 23:54:47 bounce that triggered the wipe), the stack's webhook URL can change, the auto-update-on-webhook flag can reset, or the registry-pull policy can be wrong. Workflow goes green, image sits in GHCR, container keeps running stale code.
  - **Diagnostic logging.** The Trigger Portainer step now captures the webhook's HTTP status and response body and prints both. Non-2xx fails the step with a hint to re-check the webhook URL secret + Portainer's auto-update setting.
  - **End-to-end verify.** New "Verify deploy" step polls a `HEALTH_CHECK_URL` (or `HEALTH_CHECK_DEV_URL` for dev) every 20s for up to 2 minutes, checking that `/api/health` reports the expected `appVersion`. Fails the workflow if the server hasn't picked up the new image. Skipped silently if the secret isn't set, so this opts in cleanly per environment.
  - Modified: `.github/workflows/build-and-publish.yml`, `.github/workflows/build-and-publish-dev.yml`

- fix(ci): Portainer auto-deploy fails loudly instead of skipping silently [XS]
  - **Bug.** When Tailscale failed to connect (OAuth secret stale, network blip, anything), the workflow swallowed the error (`continue-on-error: true` on the Tailscale step) and the Portainer redeploy step was silently skipped via the `steps.tailscale.outcome == 'success'` gate. Workflow showed green, image was in GHCR, but the running container never got the new image. Bit us with v0.97.9 where the build succeeded but Portainer never redeployed — old container kept running stale code until a manual pull.
  - **Fix.** Portainer step now runs unconditionally on main pushes (and dev pushes). If Tailscale didn't succeed, it emits `::error::` with a clear message and exits 1, turning the workflow red. Image publish is unaffected (Tailscale step still has `continue-on-error: true`, so transient infra failures don't block image builds).
  - Modified: `.github/workflows/build-and-publish.yml`, `.github/workflows/build-and-publish-dev.yml`

- chore(test): clean up backup file leftovers from smoke test [XS]
  - After the daily DB snapshot landed, every `sh scripts/smoke-test.sh` run leaves a `test-smoke.db.YYYY-MM-DD.bak` in the repo root because the new `runBackup()` runs on server boot. Updated the smoke test's `cleanup()` trap to remove `test-smoke.db.*.bak` alongside `test-smoke.db`. Added `*.db.*.bak` to `.gitignore` as a safety net.
  - Modified: `scripts/smoke-test.sh`, `.gitignore`

- chore(deps): clear 4 moderate npm-audit vulnerabilities [XS]
  - `npm audit fix` resolved 4 moderate transitive vulnerabilities — `ip-address` (XSS in unused Address6 HTML methods), `express-rate-limit` (depended on the bad ip-address), `hono` (bodyLimit bypass for chunked requests), `postcss` (XSS via unescaped `</style>` in CSS Stringify, build-time only). All four resolved by lockfile updates only — no `package.json` change. Smoke test green.
  - Modified: `package-lock.json`

- fix(server): guard bulk PUT/POST `/api/data` against destructive task wipes [M]
  - **Bug.** On 2026-05-07 a client opened the app, its initial `GET /api/data` failed with `Load failed`, so the local task list was empty (0 tasks). The user changed a setting/label which triggered the existing "manual flush" code path, which issues a bulk `PUT /api/data` containing the **entire** local tasks array. The server's `setAllData` → `syncTasksFromArray` deletes every existing row whose ID is missing from the incoming array. Result: 153 tasks → 0. Stale-version guard didn't catch it because the client's `_version` matched the server's at push time.
  - **Fix.** New `guardBulkTaskWrite(req, res)` helper in `server.js` runs before `setAllData` on both PUT and POST `/api/data` handlers. Rejects with HTTP 409 when:
    - `body.tasks` is an array, AND
    - `existingCount > 0`, AND
    - either `incoming.length === 0` (any non-empty → empty wipe), OR
    - `existingCount >= 10 && incoming.length < existingCount * 0.5` (>50% shrink, with a 10-row floor so small task lists aren't false-positives)
  - Settings-only pushes (no `tasks` key in the body) are unaffected. Per-record `/api/tasks` mutations are unaffected — they're the supported path for legitimate bulk deletes.
  - Modified: `server.js`

- feat(ops): nightly DB snapshot + recovery script [M]
  - **`scripts/backup-db.js`** — copies `$DB_PATH` to `${DB_PATH}.YYYY-MM-DD.bak` once per day, prunes snapshots older than `BACKUP_RETENTION_DAYS` (default 7). Idempotent — re-running the same day is a no-op. Importable (`runBackup()`) and CLI-runnable.
  - **Wired into `server.js`** — runs once on boot, then every 24h via `setInterval`. Failures log to console but never crash the server.
  - **`scripts/recover-from-notification-log.js`** — read-only diagnostic. Queries `notification_log` (which survives `setAllData` since it's not in the bulk-PUT collection list) for distinct `task_id` rows with most-recent title, channels, count, and a flag indicating whether each task ID is still present in the live `tasks` table. Used to recover task titles + IDs after the 2026-05-07 wipe. Outputs human-readable text by default; `--json` for machine consumption.
  - Both scripts ship via the existing `COPY scripts ./scripts` line in the Dockerfile — no Dockerfile change needed.
  - New: `scripts/backup-db.js`, `scripts/recover-from-notification-log.js`
  - Modified: `server.js`

- fix(logging): ISO timestamps on every server log line [XS]
  - **Why.** Triaging the 2026-05-07 wipe was harder than necessary because the terminal log lines had no timestamps. Couldn't tell when the empty PUT happened, couldn't measure debounces, couldn't correlate across services.
  - **Fix.** The `console.log/.error/.warn` wrappers in `server.js` now prepend `[ISO-8601]` to the args passed to the underlying console call. Format: `[2026-05-08T14:23:01.123Z] [SYNC] push: ...`. The in-memory `serverLogs` buffer (exposed via `/api/logs`) was already timestamped per-row, so its shape is unchanged.
  - Modified: `server.js`

---

## 2026-05-03

- fix(ui): v2 light-mode bg goes pure white + desktop modals slide in as right drawers [S]
  - **Bug 1 — light bg too creamy.** `--v2-bg: #FAFAF7` had a faint warm/yellow tint that read as off-white instead of clean white. Switched to `--v2-bg: #FFFFFF`. Cards keep `--v2-surface: #FFFFFF` so they blend with the page bg, with hairline borders + subtle shadows doing the structural separation work — Wheneri-aesthetic. Dark mode untouched.
  - **Bug 2 — desktop modals floated unmoored.** All v2 modals on desktop appeared as centered floating sheets, which the user described as "mobile pop-overs that don't attach to anything." Switched the desktop ModalShell behavior (≥768px, matching `useIsDesktop`) to right-side drawers: `align-items: stretch; justify-content: flex-end` puts the modal flush against the right edge, full-viewport-height, with only the left corners rounded (`20px 0 0 20px`). Soft-dim overlay (rgba 0.30) so the main task list stays partially visible behind. Slide-in animation translates from `100%` to `0` over `--v2-dur-emphasis`.
  - **Width caps preserved.** `width: narrow` drawers cap at 480px; `width: wide` drawers cap at 640px (down from 720px so the drawer doesn't dominate). Width 100% within the cap so they always span the right side.
  - **Mobile unchanged.** Below 768px, modals stay as bottom-sheets sliding up from the bottom — the original mobile-first behavior.
  - **Verification.** `npm run build` clean (842KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: on desktop, tap any header icon → modal slides in from the right edge, attaches there, dim overlay reveals task list behind. On mobile, modals still bottom-sheet up.
  - Modified: `src/v2/tokens.css`, `src/v2/components/ModalShell.css`

- fix(ui): v2 header — equal-size action circles + colored destination icons [XS]
  - **Bug 1.** "What now?" target circle was 36px tall while the "+" circle was 38×38, and on narrow screens (≤480px) the target collapsed to icon-only with horizontal padding instead of becoming a perfect circle. Result: two adjacent orange circles that visibly didn't match. Fixed: bumped What-now? to 38px height across all viewports; on narrow screens it now switches to `width: 38px; padding: 0` so the orange "+" and orange target read as identical visual weight.
  - **Bug 2.** v1 header has tinted icons (`packages-color: #F59E0B`, `adviser-color: #A78BFA`) so Quokka/Packages stay recognizable at a glance. v2 had stripped them to plain `--v2-text-meta` grey, merging them into the icon row. Fixed: ported the same color values as `.v2-header-icon-quokka` (purple) + `.v2-header-icon-packages` (amber). Hover state shifts to a soft tinted background of the same hue.
  - **Bonus.** Same color hint pattern brought into the More-menu rows: Projects purple, Routines green, Done green, Analytics blue. Settings + Activity log stay neutral grey since they're meta-actions.
  - **Verification.** `npm run build` clean, `npm run lint` clean, `npm test` smoke test passes. Manual: header circles match in size on phone + desktop; Quokka + Packages icons are tinted; ⋯ menu rows show the brand color cues.
  - Modified: `src/v2/components/Header.jsx`, `src/v2/components/Header.css`, `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- feat(ui): v2 Integrations status panel (PR8e of 8) [M]
  - **Why.** Last placeholder Settings tab. Full OAuth flows for Notion / Trello / GCal / Gmail / Pushover each have 4–8 UI states (consent prompt, callback, picker, scope error, env-var override, disconnect confirm) — duplicating that for v2 isn't worth the maintenance burden when the resulting tokens are already shared between v1 and v2 anyway. PR8e ships a status-summary panel that covers the 80%: see what's connected, set simple key-only integrations inline, click through to v1 for OAuth-heavy flows.
  - **`IntegrationsPanel`** in SettingsModal. Status row per integration: green-glow dot (connected) or muted dot (unconfigured) + name + email/account sub-line where applicable + brief capability hint + Manage/Connect-in-v1 button. Seven entries: Anthropic, Notion, Trello, Google Calendar, Gmail, 17track, Pushover.
  - **Inline credential entry for key-only integrations.** Anthropic + 17track expose a password input field directly. Both check `getKeyStatus()` for env-var override; when the env var is present, the field is replaced with a "Provided via env var, configure server-side" notice (read-only).
  - **Connection-status fetch.** Mounts hit `getKeyStatus()` + `notionStatus()` + `trelloStatus()` + `gcalStatus()` + `gmailStatus()` + `pushoverStatus()` in parallel via dynamic imports (matches v1 lazy pattern; failures silent so dots fall back to grey). Pushover uses `configured` flag; others use `connected`.
  - **OAuth deferral copy.** Bottom of the tab explains why OAuth flows live in v1 + reassures users that tokens are shared so connecting once benefits both interfaces.
  - **PLACEHOLDER_TABS now empty.** All 8 Settings tabs have v2 implementations as of this commit. Beta tab still shows the v1↔v2 toggle.
  - **Verification.** `npm run build` clean (840KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: Settings → Integrations → see all seven rows with status dots. Connected ones glow green; unconfigured ones are grey. Anthropic + 17track accept inline keys (with env-var override note when relevant). Connect/Manage buttons flip back to v1 for the OAuth cases.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `CLAUDE.md`

- feat(ui): v2 Notifications tab (PR8d of 8) [M]
  - **Why.** Second-to-last placeholder Settings tab. The full v1 Notifications tab is 600+ lines (test buttons, digest config, adaptive throttling, Pushover priority routing, weather notifications, deliverability overrides). v2 ports the most-touched controls and points at v1 for everything else.
  - **`NotificationsPanel`** in SettingsModal. Three sections: **Channels** (master toggles for web push / email / Pushover with hint copy), **Notification types** (compact per-type × per-channel matrix table with freq input — Overdue / Stale / Nudges / Size-based / Pile-up + Package delivered / Package exception across Push / Email / Pushover, individual toggles disabled when their channel master is off), **High-priority escalation** (master toggle + 3-stage frequency inputs), **Quiet hours** (master toggle + start/end time inputs + bypass-label override).
  - **Defer pointer.** Bottom of the tab calls out morning digest config, channel test buttons, notification history, adaptive throttling controls, and Pushover priority routing as v1-only for now.
  - **Disabled toggle styling.** New `.v2-settings-toggle-disabled` class drops opacity to 0.4 + disables pointer events when a row's parent channel master is off — same UX hint v1 uses.
  - **Verification.** `npm run build` clean (835KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: Settings → Notifications → toggle channel masters, watch dependent toggles enable/disable. Edit a freq input — auto-saves with the standard 300ms debounce. Quiet hours expand on enable.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`

- feat(ui): v2 Labels CRUD tab (PR8c of 8) [S]
  - **Why.** Labels was one of the three remaining placeholder tabs in v2 Settings (along with Integrations + Notifications). Most-used of the three — users add/rename/recolor tags routinely.
  - **`LabelsPanel`** in SettingsModal. Hairline-row list: each label has a color swatch (clickable `<details>` reveals a 5-column color picker grid using shared `LABEL_COLORS`), inline-editable name input, up/down reorder arrows, and a delete button with inline confirm. Add row at the bottom: color picker + name input + Add button. Auto-cycles to the next color after each add (same UX v1 has).
  - **What's NOT in v2 Labels (vs v1):** drag-drop reordering. Up/down arrows are simpler and reliable across mobile + desktop without the touch-event juggling v1 needs.
  - **Verification.** `npm run build` clean (826KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: Settings → Labels → swatch opens color picker, name edits inline, arrows reorder, delete asks for confirm. Add a new label cycles through colors. New labels show up in the task-card filter pills.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`

- feat(ui): v2 swipe-to-reveal task actions on mobile (PR8b of 8) [S]
  - **Why.** v2 TaskCard required tap-to-expand → tap action button to do anything other than read. Mobile one-handed use suffered. v1 has full swipe gestures (left → reveal Edit + Complete, right → delete). v2 ports a leaner version: swipe-left only.
  - **Approach.** Each TaskCard owns its own swipe state. `touchstart` records origin + base swipeX; `touchmove` translates the card horizontally if horizontal motion dominates (vertical scroll wins after >12px); `touchend` snaps to either the open position (-120px revealing the action panel) if past the 60px threshold, or back to 0. Action panel sits absolutely-positioned behind the card on the right, clipped by the swipe wrap's `overflow: hidden`. Tap the card while swipe is open → close swipe; tap a revealed button → execute action + close.
  - **Two actions only: Edit + Done.** v1 has a swipe-right-to-delete; v2 keeps destructive actions explicit (Delete lives in EditTaskModal with an inline confirm). Edit button is a soft-grey panel; Done is the primary accent fill. Both 80px wide, full-card-height, with a label + icon stacked vertically.
  - **Animation.** While dragging, the card has `transition: none` so it tracks the finger 1:1. On release, the v2 standard easing kicks back in for the snap. Same pattern v1 uses but with the v2 motion tokens.
  - **Verification.** `npm run build` clean, `npm run lint` clean, `npm test` smoke test passes. Manual: on mobile, swipe a card left → Edit + Done panel reveals → tap Done → task completes + toast shows. Swipe back right or tap card → closes. Vertical scroll past the card does not start a horizontal swipe.
  - Modified: `src/v2/components/TaskCard.jsx`, `src/v2/components/TaskCard.css`

- feat(ui): v2 Trello status push + weather badges on TaskCard (PR8a of 8) [S]
  - **Why.** Two finishing touches deferred from earlier PRs. Trello-linked tasks weren't pushing status changes from v2 (cards stayed put on the Trello board even after the task moved here). Weather badges were absent from v2 cards even though the data is already cached server-side.
  - **`src/v2/components/WeatherBadge.jsx`.** Direct port of v1's WeatherBadge — same WMO-code → emoji + label table. Renders a small `🌧️ 65°` chip in the meta line for tasks with `due_date` in the cached forecast window. Hover/aria title carries condition + precipitation %.
  - **TaskCard wiring.** New `weatherByDate` prop (the same `byDate` shape v1 uses). Renders the badge in the meta row with a bullet separator. Plumbed through KanbanBoard and ProjectsView so it shows everywhere v2 renders cards.
  - **AppV2 — `useWeather` + `useTrelloSync`.** Hook calls added at the App level (matching v1 placement). Weather data flows down to all card-rendering surfaces. Trello sync exposes `pushStatusToTrello` for the action handlers.
  - **`handleComplete` / `handleStatusChange` / `handleUncomplete` / `handleDelete`.** Each now mirrors v1's full Trello chain: `done` on complete, the new status on status-change, `not_started` on uncomplete, and `closed: true` (archive) on delete via `trelloUpdateCard`. All gated on `task.trello_card_id` so non-linked tasks are unaffected. EditTaskModal's onDelete now routes through the new `handleDelete` so delete-from-edit also archives Trello.
  - **What's NOT in PR8a.** GCal status push on complete (`useExternalSync` already handles GCal event removal via `gcal_remove_on_complete` setting — works automatically; no extra wiring needed). Notion status push (Notion DBs don't have a universal status column; v1 doesn't push either).
  - **Verification.** `npm run build` clean (818KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: complete a Trello-linked task in v2 → card moves to the done list on the Trello board. Tasks with due_date in the next 7 days show a weather badge in the meta line. Drag-status-change on Kanban also pushes to Trello.
  - New: `src/v2/components/WeatherBadge.jsx`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/{TaskCard.jsx,TaskCard.css,KanbanBoard.jsx,ProjectsView.jsx}`

- feat(ui): v2 Toast + routine completion logging (PR7 of 8) [M]
  - **Why.** v2 was completing tasks silently — no feedback toast, no Undo, no "next up" suggestion. Routine cadence wasn't advancing on complete because v2's handleComplete didn't call `completeRoutine` (deferred from PR3 with a TODO). PR7 closes both gaps + adds the v2 Toast component.
  - **`src/v2/components/Toast.jsx` + `.css`.** Direct port of v1's Toast logic with v2 styling. Same static-message tiers (quick / normal / long / reopen) + AI-rewrite override via `task.toast_messages`. Same `computeTaskPoints` integration so the subtitle reads "Same-day finish · +12 pts". Same auto-dismiss timing (4s, 8s with next-task suggestion). Same Undo affordance for completes. Visual: pill-shaped, fixed bottom-center, dark-text-on-bg surface (or accent on reopen variant), slides up via `--v2-ease-emphasis`/`--v2-dur-emphasis`.
  - **AppV2 `handleComplete` rebuild.** Now mirrors v1's full chain: complete the task, close WhatNow if open, log completion on the parent routine via shared `completeRoutine` (this fixes the cadence bug — routines weren't advancing for tasks completed in v2), score next-best candidate (high_priority +100, due-today/overdue +50, XS/S +20 — same heuristic v1 uses), set toast with the completed task + next-task suggestion. Trello status push on complete is still deferred to PR8 (needs `useTrelloSync`).
  - **AppV2 `handleUncomplete` rebuild.** Now sets a reopen-variant toast so the user sees "Surprise! It's back." with the task title. Trello status push back to active deferred to PR8.
  - **`todayCount` derivation.** `tasks.filter(status==='done' && completed_at on today).length` — used by the toast subtitle when more than one task has been completed today.
  - **Motion audit.** Walked every v2 CSS file. All transitions and animations already use `--v2-ease-emphasis|standard|quick` + `--v2-dur-emphasis|standard|quick`. No ad-hoc easing or duration values remain. The token discipline from PR1 held up.
  - **What's NOT in PR7:** Trello status push on complete/uncomplete, post-completion next-up navigation drawer (toast already shows the next task — separate drawer would be redundant).
  - **Verification.** `npm run build` clean (815KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: complete a task → toast slides up with witty copy + points + Undo + next-up suggestion → tap Undo or wait 4s → toast dismisses. Complete a routine-spawned task → routine `completed_history` advances and next-due ticks forward. Reopen a done task from DoneList → reopen-variant accent toast shows.
  - New: `src/v2/components/{Toast}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 KanbanBoard (desktop) + v2 default cutover (PR6 of 8) [M]
  - **Why.** v2 had no desktop affordance — the column real estate was just a wider mobile list. v1's KanbanBoard fills that gap with horizontal status columns + drag-drop. PR6 ports it. Also: user requested **v2 becomes the default** mid-build, ahead of the originally-planned 1-2 week opt-in window.
  - **`src/v2/components/KanbanBoard.jsx` + `.css`.** Six columns: Doing / Up next / Waiting / Snoozed / Backlog / Projects. Each column is a hairline-bordered tile with `--type-section` ALL-CAPS title + count chip. Empty state in each unfilled column shows "Empty" or "Drop here" when an active drag is over it. Tasks render as v2 TaskCards inside draggable wrappers — tap to expand still works, drag to a new column triggers `onStatusChange`. **Stale tasks redistribute** back into their actual status column (same logic v1 uses) so the natural status grouping is preserved on desktop. Inline `+ Add task` per column (collapses to dashed pill, expands to inline input on click).
  - **AppV2 wiring.** Imports `useIsDesktop` from the shared hook. `tasks.filter(t => t.status === 'backlog' | 'project')` derives the two extra buckets v2 doesn't render on mobile yet. Main body renders `<KanbanBoard>` when `isDesktop`, otherwise the existing mobile list. `v2-main-kanban` class disables vertical overflow on the main container so the columns can scroll horizontally if needed.
  - **v2 default flip.** `src/App.jsx readVersion()` now returns `'v2'` unless `localStorage.ui_version === 'v1'` is explicitly set. Existing users on v1 keep their preference (their flag is `'v1'`). New users + users who never opted in get v2. URL escape hatch (`?ui=v1` / `?ui=v2`) works the same.
  - **Beta-tab toggle inverted.** v2 Settings → Beta now shows "Use legacy v1 interface" with a default-unchecked toggle. Body copy: "You're on v2 — the redesigned interface. It's the default. If you want the legacy v1 interface, toggle below; you can flip back any time." Toggling on flips to v1 + reloads. v1's Beta tab toggle still works (flips to v2).
  - **What's NOT in v2 KanbanBoard yet:** virtualized rows for very long columns, mobile-drag-drop polyfill, swipe gestures inside columns. None blocking — the column drag works on desktop via native HTML5 drag.
  - **Verification.** `npm run build` clean (810KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: load on desktop → six columns render with current task buckets; drag a card across columns → status changes correctly; tap "+ Add task" inside a column → creates a task with that column's default status. Load on mobile → still the v2 list view. Default users now load v2; v1 reachable via `?ui=v1` or Settings → Beta toggle.
  - New: `src/v2/components/{KanbanBoard}.{jsx,css}`
  - Modified: `src/App.jsx`, `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `src/v2/components/SettingsModal.jsx`, `CLAUDE.md`

- feat(ui): v2 Settings General + AI + Data + Logs tabs (PR5g of 8) [M]
  - **Why.** PR5a only shipped the Beta tab. This fills out the four most-used Settings tabs in v2 idiom — General, AI, Data, Logs — so users don't have to flip back to v1 to change daily-use prefs. Labels, Integrations, and Notifications stay as guided fallbacks (heaviest tabs; Integrations alone has 6 OAuth flows; Notifications is a full type×channel matrix).
  - **General tab.** Dark-mode toggle (iOS-style track/thumb) — also re-applies `data-theme` + theme-color meta tag immediately. Default-due-days, staleness-days, reframe-threshold, max-open-tasks as narrow numeric inputs with calm hint copy. Each field auto-saves with the same 300ms debounce + flush v1 uses.
  - **AI tab.** Custom-instructions textarea (140px min) with Import / Export / Clear buttons. Hint copy explains the scope ("shapes every AI feature — task reframes, polish, what-now, Quokka tone, notification rewrites"). API-key entry ports in a later release (multi-state form: env vs user-provided, status check, model picker) — the section currently has a "Open v1 → AI" CTA pointing back.
  - **Data tab.** Backup section with Export / Import (JSON, full state). Activity-log shortcut button (closes Settings, opens ActivityLog). Danger zone in a soft-red bordered block: Clear completed (one-click) + Clear all data (opens a v2-styled confirm dialog above the modal — overlay z-index 200, 380px max-width, accent buttons). Confirm dialog reuses the v2 ModalShell visual language.
  - **Logs tab.** Inline `ServerLogsPanel` — fetches `/api/logs`, renders with v2 typography. Toolbar: Refresh (with spinner) + Copy all. Filter pills: All, Gmail, GCal, Push, Email, DB, SSE, Errors (active filter inverted to text-on-bg). Stream is a max-480px scroll area with monospace 11px font, hairline-bordered rows, alert-tinted backgrounds for warn/error. Counter at the bottom ("Showing N of M entries").
  - **Save plumbing.** `update(key, value)` writes to localStorage + debounce-flushes to server (300ms). `onFlush` prop comes from AppV2's `useServerSync().flush`. Closing the modal also flushes once for safety.
  - **Confirm dialog.** Custom v2 component rendered above ModalShell with its own overlay. Used for "Clear all data" only — exit the destructive action through an explicit acknowledgment.
  - **AppV2 wiring.** Pulled `clearCompleted` + `clearAll` out of `useTasks`, captured `flush` from `useServerSync`. SettingsModal now receives `onFlush`, `onClearCompleted`, `onClearAll`, `onShowActivityLog`.
  - **What's deferred to PR5h+.** Labels CRUD with drag-drop reorder. Integrations (Trello / Notion MCP / GCal / Gmail / 17track / Pushover OAuth + status panels). Notifications (per-channel × per-type matrix, quiet hours, digest config, Pushover priority routing). All currently render as v2-styled EmptyState pointing to the matching v1 tab.
  - **Verification.** `npm run build` clean (805KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: Settings → General toggles theme, fields auto-save with debounce. AI tab loads custom instructions, import/export work. Data tab exports a JSON file with tasks+routines+settings+labels; Clear all opens the confirm dialog. Logs tab fetches the server log tail with filters.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `src/v2/AppV2.jsx`, `wiki/Version-History.md`

- feat(ui): v2 AnalyticsModal + Balance radar (PR5f of 8) [L]
  - **Why.** Last of the major v2 surface ports. Brings Boomerang's signature 52-week heatmap, daily completion patterns, and tag/energy/size breakdowns into v2 — and ships the **Balance radar** that was the single net-new analytics piece in the original plan (mapped from the green coaching app's "Coaching Wheel"). Last placeholder ("Analytics — soon" in the More menu) is gone; PLACEHOLDER_COPY scaffolding deleted entirely from AppV2.
  - **`src/v2/components/BalanceRadar.jsx` + `.css`.** Pure SVG radar/spider chart, no chart library. Props: `spokes` array of `{label, value, color?}`, optional `comparison` array for previous-period dashed polygon, `size`, `onSpokeClick`. Renders 4 concentric guide rings + spoke lines + filled accent polygon for current period + optional dashed-grey comparison polygon + colored vertex dots + labels with values. Anchored top-of-circle, clockwise, evenly spaced. Empty state when no spokes.
  - **`src/v2/components/AnalyticsModal.jsx` + `.css`.** Wide ModalShell. Top toolbar: range pills (7d / 30d / 90d / 1y / All) + Tasks/Points metric toggle. Big summary number + label below ("142 tasks · last 30 days"). Sections: **Daily completions** bar chart, **By day of week** horizontal-bar pattern, **Balance** with the new radar (Tags/Energy toggle — tags use top-8 by value with the user's tag colors; energy uses the 6 fixed types with energy-type colors), **By tag / By energy / By size** breakdowns as horizontal bar lists with colored fills, **52-week pattern** heatmap (column-per-week, accent gradient by intensity, month labels above).
  - **Reuses existing endpoints.** `/api/analytics/history?days=N` for the active range, `/api/analytics/history?days=365` for the heatmap. Same data shape v1 consumes — no server changes.
  - **What's NOT in v2 Analytics yet (PR8 polish if user wants):** notification engagement panel, adaptive throttle 👍/👎 chips, completed-task search (DoneList already covers that surface), records (best day / current streak via `FullRings`). Lean version focuses on the most-glanceable patterns + the new Balance radar.
  - **`src/v2/AppV2.jsx`.** Imports `AnalyticsModal`. New `showAnalytics` state. More-menu Analytics row now has a chevron and opens the real modal (was a "soon" tag). **Removed** the placeholder ModalShell + `PLACEHOLDER_COPY` constant + `openModal` state — every header surface and More-menu row is now a real v2 modal. AppV2 is meaningfully cleaner.
  - **PR5 batch summary.** Modals batch 2 is complete except for the remaining Settings tabs (General, AI, Labels, Integrations, Notifications, Data, Logs — PR5g). v2's main surfaces all have first-class implementations: Settings (Beta tab), Projects, Done, Activity log, Routines, Packages, Quokka, Analytics. Background hooks (notifications, server sync, external sync, package polling, AI inference) all run while v2 is mounted.
  - **Verification.** `npm run build` clean (789KB precache), `npm test` smoke test passes. Manual: ⋯ → Analytics → modal opens with summary + daily chart + dow pattern + radar (toggle Tags/Energy) + breakdowns + heatmap. Range pills filter all sections; metric toggle swaps tasks↔points. Balance radar renders correctly at any spoke count from 1-8.
  - New: `src/v2/components/{AnalyticsModal,BalanceRadar}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 AdviserModal — Quokka (PR5e of 8) [M]
  - **Why.** Quokka was the lone header icon (✨) still pointing at a placeholder. It's the most-used surface for users running heavy automation, so it deserves a real port.
  - **`src/v2/components/AdviserModal.jsx` + `.css`.** Wide ModalShell. Reuses the shared `useAdviser` hook and the `renderMarkdown` utility — no fork. State for chat history + active chat + streaming + plan + commit comes from the hook unchanged. Composer auto-grows up to 200px max.
  - **Layout.** Top toolbar: chat-count chip + primary "+ New chat" button. Below: either the chat list view OR the conversation view (toggled by tapping the chat-count chip). Conversation view shows: optional expiry banner (chat will be deleted in N days unless starred), scrollable messages, status indicators (thinking / applying changes), confirm-bar when a plan is staged (full-width accent, white buttons), composer at the bottom.
  - **Message bubbles.** User messages right-aligned in accent fill. Assistant messages left-aligned in muted bg. Tool-call log renders as a compact stacked list with status icons (running spinner / done check / error X / staged dot), step name in capitalized human form. Plan preview is a dashed-accent card with `›` bullets; once committed it transitions to a green-bordered "Applied N changes" card.
  - **Confirm-bar.** Full-width accent (#FF6240) at the bottom of the messages area when a plan is awaiting confirmation. Carries the change count + Cancel / Apply N changes buttons. Cancel is ghost (transparent w/ white border on accent), Apply is white-fill accent-text — strongest possible visual hierarchy for "this is the action you want to take."
  - **Empty state.** "G'day from Quokka" with the sparkle icon in an accent-tinted circle, body explaining the scope, and four prompt suggestions (rescheduling, weather-aware moves, what-now, cleanup) as ghost cards. Tapping a suggestion populates the input.
  - **Chat history view.** Hairline rows: title + last-update + msg count + star/expiring meta. Star toggle on the right (filled when starred), Delete on the far right. Empty state when no chats yet.
  - **`src/v2/AppV2.jsx`.** Imports `useAdviser` (state lives at the App level so the conversation survives modal close — same pattern v1 uses) + `AdviserModal`. Header ✨ icon now opens it. Removed the `adviser` PLACEHOLDER_COPY entry — it was the last placeholder for a header icon; PLACEHOLDER_COPY now only contains `analytics`.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: tap ✨ → modal opens → empty state shows suggestions → tap a suggestion → text appears in composer → send → see streaming "thinking" + tool-call log + plan preview → tap Apply → "Changes applied" bar. Chat history toggle works; star/unstar/delete work.
  - New: `src/v2/components/{AdviserModal}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 PackagesModal (PR5d of 8) [M]
  - **Why.** v2 had a 📦 icon in the header that opened a placeholder. Packages is a primary surface — daily check for ADHD users tracking deliveries — so it earns a real port.
  - **`src/v2/components/PackagesModal.jsx` + `.css`.** Wide ModalShell. Top toolbar: "Refresh all" + "Track new" (primary accent toggles the add form). Inline add form: tracking number input + label input + live carrier auto-detect chip (uses shared `detectCarrier` from `utils/carrierDetect`) + "Track package" submit. List below: each package as a hairline row with carrier logo + label + monospace tracking number underneath + status pill on the right. Status pill colors mirror v1 (pending/in-transit/out-for-delivery/delivered/exception) but use the v2 muted alert palette so the colors don't shout.
  - **Inline expand instead of separate detail modal.** v1 has a separate `PackageDetailModal`; v2 collapses it into the row's expand state — tap a row, see ETA / delivered-at / last location, then a vertical timeline of the latest 8 events with accent-glow on the most recent dot, then Refresh + Delete actions (Delete has inline confirm). Skips the separate modal layer entirely.
  - **Sort.** Out-for-delivery → in transit → exception → pending → delivered, then ETA ascending, then label alphabetical. Same ordering rationale as v1: surface what needs attention first.
  - **`src/v2/AppV2.jsx`.** Imports `usePackages` + `usePackageNotifications` so background polling and delivery notifications run while v2 is mounted (v1 had this; v2 was previously missing it). Header 📦 icon now opens the real modal (was a placeholder); removed the `packages` PLACEHOLDER_COPY entry.
  - **What's NOT in v2 PackagesModal yet (port later if needed):** swipe-to-reveal actions on rows, API quota status banner, refresh cooldown timer, sort dropdown, gmail-pending visual treatment. Most of these are PR8 polish — the lean version is fully functional.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: tap 📦 → modal opens → "Track new" → enter tracking number → carrier auto-detected → Track package → row appears with status pill → tap row → events timeline expands → Refresh/Delete work.
  - New: `src/v2/components/{PackagesModal}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- fix(sw): handle offline/redeploy without returning null Response [S]
  - **Bug.** `public/boomerang-sw.js` fetch handler did `fetch(req).catch(() => caches.match('/index.html'))`. The cache was never populated by the install step, so `caches.match` returned `undefined`, which made `respondWith()` reject with `FetchEvent.respondWith received an error: Returned response is null.` Safari surfaced this as "Safari can't open the page" until site data was cleared.
  - **Trigger.** Every push to dev triggers Portainer to redeploy, which briefly disconnects the device. Any navigation request during that window fell through to the broken catch branch. The bug is latent — it pre-dates the v2 work — but the v2 PR cadence is tripping it because deploys are frequent.
  - **Fix.** Three coordinated changes in the SW:
    1. **Install step** now opens `boomerang-shell-v2` cache and adds `/index.html` so the offline fallback actually has something to serve on first run + best-effort.
    2. **Activate step** cleans up old `boomerang-shell-*` caches via prefix match so the SW can be versioned by bumping `SHELL_CACHE`.
    3. **Fetch handler** now opportunistically refreshes the cached shell on every successful navigation (so the cache stays fresh), and on network failure falls back to cached `/index.html` OR a synthetic 503 offline page that styles itself to match the app's dark theme and offers a Retry button. **Critically: never resolves with null.**
  - **User unblock for stuck devices.** Users who already hit the broken state need to clear site data once (iOS Safari → Settings → Safari → Advanced → Website Data → Remove) or reinstall the home-screen PWA. After that, the new SW installs cleanly and the bug is gone going forward.
  - **Why on dev only for now.** This is technically a v1+v2 infrastructure fix (the SW serves both UIs) and ought to land on main. Pushed to dev first per the in-flight v2 workflow; cherry-picking to main is the user's call.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: clear site data → reload → SW installs → kill the container → reload → see styled 503 offline page with Retry → bring container back → Retry → app loads. Repeated dev redeploys no longer trigger the null-response error.
  - Modified: `public/boomerang-sw.js`

- feat(ui): v2 RoutinesModal + EditTaskModal bug fixes (PR5c of 8) [M]
  - **Why.** Routines was the next-most-important v2 surface to port (recurring tasks are core to the app), and shipping it lets the v2 plan explicitly showcase the **hairline-list aesthetic** the design tokens were built for. Bundled two reported EditTaskModal bugs into the same commit so the dev image picks both up at once.
  - **`src/v2/components/RoutinesModal.jsx` + `.css`.** Wide ModalShell with a list view + form view (toggled via local `view` state). **List view:** active routines as hairline rows (title left, cadence + day-of-week right, e.g. "weekly · Fri"); paused routines collapsed under a SectionLabel'd PAUSED section. Tap a row to expand inline — shows last done ("done 12d ago"), next due ("next May 8"), complete count, plus action buttons: Spawn now (primary accent, mirrors v1's manual one-off), Edit, Pause/Resume, Delete (with inline confirm). Bottom of the list has a dashed "+ New routine" button. **Form view:** title, frequency dropdown, on-day dropdown (any day / Sun-Sat snap), custom-N-days input (only shown for `custom` cadence), end date (optional), priority toggle, notes, labels. Reuses the shared `.v2-form-*` classes from AddTaskModal for visual consistency. Back button at the top to return to the list.
  - **AppV2 wiring.** Added Routines to the More menu (between Projects and Done) with a chevron — the menu is now 6 functional rows + 1 "soon" (Analytics). New state: `showRoutines`, `editRoutineId`. `useRoutines` consumed for `addRoutine`/`deleteRoutine`/`togglePause`/`updateRoutine`/`spawnNow`/`spawnDueTasks`. `editRoutineId` opens RoutinesModal directly into edit form for a specific routine — same hook v1 uses (e.g. EditTaskModal "Open routine" jumps here).
  - **Bug fix #1 — EditTaskModal Status row "multiple selected" misread.** The Done button had a permanent `--v2-accent` border + text, so adjacent to the inverted-active "Doing" button it looked like both were selected. Done is a one-shot transition action (not a status the task currently has), so neutral at rest is correct. Fix: dropped the persistent accent — Done now uses `--v2-text-meta` color and the regular `.v2-form-seg` chrome at rest, with accent fill only on hover. The leading `✓` glyph already reads as an action.
  - **Bug fix #2 — Due/Priority columns colliding on iOS.** `.v2-form-row` was using flex with `flex: 1; min-width: 0` on each field. Safari/iOS renders empty `<input type="date">` at a collapsed intrinsic width, so the date input shrank below 50% and the Priority button overflowed into its space. Fix: switched `.v2-form-row` to CSS Grid with `grid-template-columns: 1fr 1fr` so each column is exactly half the available width regardless of intrinsic content. Also bumped `.v2-form-pri-toggle` height from 42px → 44px to match the input's natural height.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: ⋯ → Routines → list of active/paused routines renders; tap row to see "done 5d ago · next May 8 · 12× completed" + actions; "+ New routine" → form with all fields → Create → returns to list. EditTaskModal: Status row no longer has dual-selected look; Due/Priority columns sit cleanly side-by-side with no overlap.
  - New: `src/v2/components/{RoutinesModal}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/AddTaskModal.css`, `src/v2/components/EditTaskModal.{jsx,css}`

- feat(ui): v2 Projects + DoneList + ActivityLog (PR5b of 8) [M]
  - **Why.** Three small read-mostly views from v1's overflow menu, all under 130 lines each in v1, ported together. Fills out three of the More-menu placeholders so v2's nav is no longer dominated by "soon" tags.
  - **`src/v2/components/ProjectsView.jsx` + `.css`.** Wide ModalShell that renders status='project' tasks using v2 TaskCard (so card actions are consistent). Calm subtitle calls out the count + "no notifications, take your time". Empty state uses v1's tone: "Move longer-term tasks here so they stop nagging you."
  - **`src/v2/components/DoneList.jsx` + `.css`.** Wide ModalShell with hairline-row aesthetic (no full TaskCard chrome — done tasks don't need edit/snooze affordances, just a Reopen pill). Title gets a strikethrough at `--v2-text-faint` so the visual reads "completed." Sections use SectionLabel (Today + per-day groups). 50-per-page pagination via the existing `/api/tasks?status=done&sort=completed_at` endpoint; fresh fetch every time the modal reopens. Empty state when no completions yet.
  - **`src/v2/components/ActivityLog.jsx` + `.css`.** Wide ModalShell. Toolbar across the top: All / Deleted segmented filter + a small "Clear history" outlined button that confirms before wiping. Each entry is a hairline row with an action label tinted in the v2 muted alert palette (so "Deleted" reads in `--v2-alert-overdue`, "Edited" in `--v2-alert-high-pri`, etc.) + relative timestamp + task title. Deleted entries with a snapshot get a Restore pill.
  - **`src/v2/AppV2.jsx`.** Imports the three new modals + lucide `CheckCircle2`. New state: `showProjects`, `showDone`, `showActivityLog`. New callbacks: `handleUncomplete` (called from DoneList), `handleRestore` (called from ActivityLog — same logic as v1: clone snapshot, reset status, new uuid, prepend to tasks). Includes `setTasks` and `uncompleteTask` from useTasks. Removed unused PLACEHOLDER_COPY entries for projects + activityLog (analytics still placeholder until PR5f).
  - **More menu refresh.** Now contains 5 rows: Settings, Projects, Done, Analytics (still "soon"), Activity log. Functional rows show a chevron; the analytics one keeps the "soon" tag. Done is a new entry in v2 — v1 surfaces it via the "X done today" header link instead.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: ⋯ → Projects opens with project tasks (or warm empty state), Done shows your completed task list with Reopen on each row, Activity log shows recent edits with the muted action palette and Restore on deleted entries.
  - New: `src/v2/components/{ProjectsView,DoneList,ActivityLog}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 SettingsModal + More menu (PR5a of 8) [M]
  - **Why.** User-prioritized: without v2 Settings, the only way to flip back to v1 from inside v2 was the URL hatch (`?ui=v1`). PR5a ships the Settings shell + a fully functional Beta tab so the v2/v1 toggle lives where it belongs. Other Settings tabs port progressively (PR5b/f).
  - **`src/v2/components/SettingsModal.jsx` + `.css`.** v2 Settings on `ModalShell` (wide variant). Pill-style tab bar with the same tab list as v1: General, AI, Labels, Integrations, Notifications, Data, Logs, Beta. Active tab gets the inverted (text-on-bg) treatment so it's unmistakable. **Beta tab is fully functional**: large heading + body explaining the v2 state, an iOS-style toggle that flips back to v1 on uncheck and reloads, the static `__APP_VERSION__` build identifier in monospace, and a "What's coming" roadmap list. **Other tabs render an EmptyState** with the tab name, a one-liner description of what'll port there, and a "Open v1" CTA that flips back so the user can configure those for now.
  - **`src/v2/AppV2.jsx`.** Imports `SettingsModal` + lucide icons for the More menu items. New state: `showMenu`, `showSettings`. The Header `⋯` button now opens a real **More menu sheet** (using `ModalShell`) listing four items in hairline-list style: Settings (functional, opens SettingsModal), Projects (placeholder), Analytics (placeholder), Activity log (placeholder). Each non-functional row carries a small "soon" tag pill; Settings has a chevron indicating it actually goes somewhere. Removed the old `menu` placeholder copy.
  - **PLACEHOLDER_COPY refresh.** `menu` removed (it's now a real menu). New entries for `projects`, `analytics`, `activityLog` so each placeholder modal can call out which PR will deliver it.
  - **CSS.** New `.v2-more-menu` / `.v2-more-row` / `.v2-more-row-tag` rules in `AppV2.css` for the hairline-list menu rows. Tab styling, beta-tab block layout, and an iOS-style toggle live in `SettingsModal.css`.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: tap `⋯` → More menu sheet → tap Settings → SettingsModal opens on the Beta tab → toggle flips to v1 cleanly. Other tabs show their EmptyState with v1 fallback CTA.
  - New: `src/v2/components/SettingsModal.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- feat(ui): v2 ReframeModal + WhatNowModal + Header What now? button (PR4d of 8) [M]
  - **Why.** Final PR in modals batch 1. ReframeModal closes the loop on the snooze→reframe escalation pattern (without it, v2 just kept piling up snooze counts forever). WhatNowModal brings Boomerang's signature "what should I do right now?" feature to v2.
  - **`src/v2/components/ReframeModal.jsx` + `.css`.** Built on `ModalShell`. Subtitle calls out the snooze count + task title. Single textarea for "what's blocking you?" → calls shared `reframeTask()` API → renders the AI-suggested replacement tasks as a clean hairline list with `→` accent bullets. "Looks good" button calls `replaceTask` to swap the original out for the reframed set.
  - **`src/v2/components/WhatNowModal.jsx` + `.css`.** Multi-step flow on `ModalShell` — title stays "What now?", subtitle changes per step. **Step 1:** time picker (5–10 min / 30 min / a couple hours, each with a sub-label). **Step 2:** energy level (Running on fumes / Moderate / I've got it). **Step 3:** capacity grid — energy types (with the type's color icon) + Anything + Skip. **Step 4:** AI-returned picks rendered as cards with tappable Done buttons; stretch suggestion appears below as a dashed-accent card. Reuses shared `getWhatNow()` and `getWeather()` APIs and the same `buildWeatherSummaryFromCache()` formatter v1 uses (small enough to inline).
  - **`src/v2/components/Header.jsx`.** Added optional `onOpenWhatNow` prop. When provided, renders a primary-accent pill button (`Target` icon + "What now?" label) at the start of the actions cluster. On screens ≤480px the label collapses to icon-only to keep the header from wrapping. Header now hosts 5 actions when fully wired: What now? · + · ✨ · 📦 · ⋯.
  - **`src/v2/AppV2.jsx`.** Imports both modals + `loadSettings`. New state: `reframeTarget`, `showWhatNow`. `handleSnooze` now reads `reframe_threshold` from settings and routes to ReframeModal instead of SnoozeModal when a task has been snoozed enough times — same logic as v1. Header `onOpenWhatNow` opens the WhatNow modal which uses the shared `tasks` array + `handleComplete` so completing from a suggestion threads through the same path (toast prefetch, routine completion, etc., as those land).
  - **PR4 batch summary.** Modals batch 1 is complete. v2 now supports the full task lifecycle in-app: add, edit, complete, snooze, reframe-on-overload, "what now?" suggestions. Editing still defers checklists/comments/research/attachments/Notion-Trello-GCal state visualization to PR5/PR8. Header is at its final affordance count for v1-parity (modulo Settings which lands in PR5).
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: Snooze a task past `reframe_threshold` → Reframe modal opens with the same task; type a blocker → AI returns replacement tasks → Looks good replaces original. Tap "What now?" → step through time/energy/capacity → suggestions render with Done buttons.
  - New: `src/v2/components/{ReframeModal,WhatNowModal}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/Header.jsx`, `src/v2/components/Header.css`

- feat(ui): v2 EditTaskModal — lean port (PR4c of 8) [M]
  - **Why.** Third of four mini-PRs. v1 EditTaskModal is 1275 JSX + 892 CSS lines with checklists, comments, research, attachments, Notion/Trello/GCal/weather state, drag-drop, and more. Porting all of that in one PR would consume the rest of the v2 schedule. PR4c ships the most-used 80% — same form fields as Add + status / delete / backlog / projects / convert-to-routine — and explicitly defers the rest.
  - **`src/v2/components/EditTaskModal.jsx` + `.css`.** Reuses `useTaskForm` hydrated from the task, plus separate state for status, delete-confirm, and routine cadence. Same lean form layout as AddTaskModal (and reuses its CSS via shared classes) so the typography rhythm is identical. Adds: status segmented row (Not Started / Doing / Waiting / + ✓ Done as a primary-tinted button), `Convert to routine` opt-in with cadence picker, and an actions row at the bottom (Backlog, Projects, Delete with inline confirm). Save button persists everything via the shared `updateTask` and closes.
  - **What's NOT in v2 EditTaskModal yet (port progressively):** checklists with drag-drop, comments, AI Research, attachments + extract-text, Notion search/link/create state visualization, Trello link state, GCal duration override, weather-hidden flag, 7-day forecast widget, "open routine parent" link. v1 EditTaskModal still handles all of these — flip to v1 if needed. The shared form hook keeps the state plumbing reusable when these port.
  - **`src/v2/AppV2.jsx`.** Imports `EditTaskModal`. New `editTarget` state holds the task being edited. TaskCard's Edit button now opens the real modal. Wired action handlers: `handleStatusChange` (delegates Done to the existing complete chain), `handleBacklog`/`handleProject` (status update + last_touched bump), `handleConvertToRoutine` (creates routine via shared `addRoutine`, links task). Removed the `edit` placeholder copy.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: open a task → fields hydrate from current values → change anything → Save → list reflects changes immediately. Status row swaps the section the card lives in. Delete asks "Delete? Yes/No" inline before destroying. Convert to routine creates the routine and links the current task.
  - New: `src/v2/components/EditTaskModal.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 AddTaskModal + Header `+ New` button (PR4b of 8) [M]
  - **Why.** Second of four mini-PRs porting v1's task-flow modals. Without an add path, v2 was read-only — users had to flip back to v1 just to create a task.
  - **`src/v2/components/AddTaskModal.jsx` + `.css`.** Lean v2 form built on `ModalShell`. Reuses the shared `useTaskForm` hook so polish/size-infer/labels/attachments state machinery isn't duplicated. Fields: title (auto-focused, Enter to submit), notes (with Polish AI pill), due date, priority cycle (Normal → High → Low), size segmented buttons + Auto, energy type pill grid (appears when energy or size is set, with active-pill border in the type's color), energy drain segmented buttons (when type is set), labels pill grid (multi-select). Primary accent submit at the bottom.
  - **What's NOT in v2 AddTaskModal yet (port later):** attachments + extract-text, Notion search/create. These are advanced flows that v1 still handles; user can flip to v1 if needed. `useTaskForm` exposes the state for these, so wiring them in PR4c (EditTaskModal, which shares the same form skeleton) or PR8 (polish) is straightforward.
  - **`src/v2/components/Header.jsx`.** Added an optional `onOpenAdd` prop. When provided, renders a 4th icon button (the `+`) in primary accent style at the start of the header actions cluster — the calm rest state goes from 3 → 4 affordances. Header still conditionally renders the button so it doesn't appear on shells that haven't wired it yet.
  - **`src/v2/AppV2.jsx`.** Imports `AddTaskModal` + `useToastPrefetch` + `inferSize`. New `showAdd` state opens the modal from the Header's `+` button. `handleAddTask` mirrors v1's add path: create task via shared `addTask`, kick off background AI inference for size/energy when not manually set, prefetch the completion-toast copy. Empty state CTA changes from "Back to v1" to "Add task" so first-run users have an obvious next step.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: tap Header `+` → modal opens with title focused → fill fields → Add task → task appears in correct section, AI inference fills size/energy a moment later (visible if you re-expand).
  - New: `src/v2/components/AddTaskModal.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/Header.jsx`, `src/v2/components/Header.css`

- feat(ui): v2 SnoozeModal + Beta-tab build number (PR4a of 8) [S]
  - **Why.** First of four mini-PRs that port v1's task-flow modals to v2 (PR4 in the build plan). Snooze is the smallest and was already broken in v2 (the TaskCard Snooze button opened a placeholder pointing back to v1). Bundling a small DX fix while we're touching Settings.
  - **`src/v2/components/SnoozeModal.jsx` + `.css`.** v2 SnoozeModal built on `ModalShell` + the hairline-list aesthetic. Reuses the shared `getSnoozeOptions()` / `getSnoozeOptionsShort()` from `store.js` and the same due-date filtering logic v1 has. Each option is a hairline-divided row with a left-aligned primary label + right-aligned meta (e.g. "Tomorrow · Tue, Apr 16 9 AM"). "Pick a date…" toggles to a custom date+time picker with an accent-pill confirm button. Mobile bottom-sheet, desktop centered panel — both inherit the ModalShell circular-pill close.
  - **AppV2 wiring.** New `snoozeTarget` state holds the task being snoozed. `TaskCard.onSnooze` now passes the full task; AppV2 routes it to the real `SnoozeModal` instead of the "coming soon" placeholder. Uses the shared `useTasks().snoozeTask` so v1 and v2 see the same result via SSE.
  - **Beta tab: static build identifier.** User flagged that the autosave indicator at the top of Settings keeps replacing the version label, making it hard to confirm which dev build is running. Added a "Build" line to the Beta tab — monospace, text-color, never overwritten by autosave state. Reads `__APP_VERSION__` (Vite-defined; on dev builds it's `dev-<sha>` from `build-and-publish-dev.yml`).
  - **What still uses placeholders in v2.** Edit, header icons (Quokka / Packages / More) — they still open ModalShell + EmptyState pointing back to v1.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: tap Snooze on a v2 card → real modal opens with options + custom picker → choose option → task moves to Snoozed section. Open Settings → Beta in either v1 or v2 (when Settings ports) → "Build" line shows the running build.
  - New: `src/v2/components/SnoozeModal.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/components/Settings.jsx` (Beta tab)

- feat(ui): v2 task list — TaskCard + section labels (PR3 of 8) [M]
  - **Why.** Third piece of the v2 maturity refresh. Brings the calm typography + status-color economy to the most-seen surface (the task list) and wires v2 against the real data hooks so it's no longer a placeholder shell.
  - **`src/v2/components/SectionLabel.jsx` + `.css`.** Tiny presentational component for "Doing / Stale / Up next / Waiting / Snoozed" headers. `--type-section` style: 11px DM Sans 600 ALL-CAPS with 0.08em letter-spacing, accent-colored sparkle bullet, optional right-aligned count. Wheneri's HOME / HOME MAINTENANCE pattern, applied to status sections.
  - **`src/v2/components/TaskCard.jsx` + `.css`.** Lean v2 card. Title is the dominant element (16px DM Sans 600). Meta line uses `--text-meta` with bullet separators. Energy renders as a single chip — lucide icon + N small `Zap` glyphs in the energy-type color, replacing v1's icon + colored-dot stack. **Status economy:** only `overdue` and `high_priority` get a 2px colored left border; `stale` becomes inline meta (`12d on list`); `low_priority` reduces opacity to 0.78. Tap to expand reveals notes preview, checklist progress, and an action toolbar (Done / Snooze / Edit). Done is wired via the shared `completeTask`; Snooze + Edit open ModalShell placeholders that tell the user the v2 modals land in PR4.
  - **`src/v2/AppV2.jsx`.** Replaced the welcome placeholder with the real shell. Wires the same hook stack v1 uses: `useTasks`, `useRoutines` + `spawnDueTasks` effect, `useNotifications`, `useServerSync` + `hydrateFromServer`, `useExternalSync` (Trello/Notion outbound), `useSizeAutoInfer`. Renders sections in v1's order (Doing, Stale, Up next, Waiting, Snoozed), sorted by age. EmptyState shows when there are zero active + zero snoozed tasks. Service worker re-registration on version mismatch matches v1 behavior.
  - **What's intentionally NOT in v2 yet.** Routine-completion logging on Done, Trello status push on Done, sort dropdown, search, tag-filter pills, backlog/projects sections, swipe-to-reveal actions, weather badges, drag-and-drop, keyboard shortcuts, Gmail-pending visual treatment, post-completion next-up toast, manual quick-add input, packages background hooks, GCal/Notion/Trello inbound syncs (manual triggers in v1 Settings still work). All of these port in subsequent PRs (4–8).
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual smoke: flip to v2 → real tasks render in sections → tap card to expand → Done removes task → Snooze/Edit show v2 placeholder modals → flip back to v1 → all changes persist (shared store + server sync).
  - New: `src/v2/components/{SectionLabel,TaskCard}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- feat(ui): v2 shell — Header + ModalShell + EmptyState (PR2 of 8) [S]
  - **Why.** Second piece of the v2 maturity refresh (see PR1 commit for context). Establishes the modal language and the calm-at-rest header so users opting into v2 see the design rhythm immediately.
  - **`src/v2/components/ModalShell.jsx` + `.css`.** Reusable modal wrapper with the Wheneri close affordance: a 36×36 circular pill X in the top-right of every modal (no handle bar — X is sufficient). Mobile: bottom-sheet with rounded top corners. Desktop: centered panel (480px narrow / 720px wide via `width` prop). Title in `--type-h1` (Syne 700 32px) with 40px top padding for breathing room. Hairline below the title, body padding 24px. Escape closes; clicking the overlay closes; body overflow locks while open and restores on close.
  - **`src/v2/components/EmptyState.jsx` + `.css`.** Reusable empty-state matching the calm tone of v1's ProjectsView. Soft circular icon backdrop (lucide stroke 1.5), `--type-h2` title (Syne 700 22px), muted meta body, optional ghost CTA. Single component used for both the v2 main empty state and the placeholder modal contents.
  - **`src/v2/components/Header.jsx` + `.css`.** The calm 4-affordance header: logo + wordmark on the left; Quokka ✨, Packages 📦, More ⋯ on the right. No stats bar, no sort/search/sync chrome at rest — that staging lands in a later PR. Sticky to the top of the v2 viewport with a hairline divider.
  - **`src/v2/AppV2.jsx`.** Replaced the welcome placeholder with the real shell. Header at top, EmptyState body ("Welcome to v2"), ModalShell wired to all three header icons rendering "Coming soon in v2 / Use v1 for this" placeholder content. Pressing any v2 icon now demonstrates the modal close affordance and typography rhythm — the actual surface (Quokka, Packages, etc.) ports in later PRs.
  - **Reuse.** v2 imports `src/components/Logo.jsx` (just an SVG, no v1-specific styling) and `lucide-react` icons. No other v1 component code is pulled in.
  - **What does NOT change in this PR.** v1 untouched. The v2 task list, real Quokka, Packages, Settings, Analytics, Routines, Projects, ActivityLog, EditTaskModal/AddTaskModal/SnoozeModal/ReframeModal/WhatNowModal, KanbanBoard, and Toast all remain placeholder/v1-only.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes, manual smoke: flip Beta toggle → v2 shell renders; tap any header icon → ModalShell opens with EmptyState; X / overlay click / Escape all close; flip back to v1 → unchanged.
  - New: `src/v2/components/{Header,ModalShell,EmptyState}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- feat(ui): v2 opt-in shell — design tokens, router, Beta tab toggle [M]
  - **Why.** UI/UX maturity refresh inspired by Wheneri and a green-themed coaching app. The four maturity dimensions in scope: typography + color discipline, card breathing + status economy, modal/affordance consistency, header staging + empty-state tone + motion. Delivered as a v2 shell behind an opt-in toggle so v1 stays exactly as-is and users can flip back any time.
  - **Architecture.** `src/App.jsx` becomes a thin router that reads a `ui_version` flag from localStorage (default `v1`) and renders either `AppV1` (the existing 1042-line component, renamed) or `AppV2` (new placeholder shell). URL escape hatch: `?ui=v2` and `?ui=v1` set the flag and strip themselves from the URL so deep-link params (`?task=X`) don't keep flipping it. `data-ui-version` is mirrored on the documentElement for analytics/debugging. `data-ui="v2"` is set when v2 mounts so namespaced tokens key off it.
  - **Design tokens** (`src/v2/tokens.css`). Single accent (`--v2-accent: #FF6240`), muted alert palette (`--v2-alert-overdue: #E8443A`, `--v2-alert-high-pri: #F2A100`), pastel-ified energy types (desk/people/errand/confrontation/creative/physical), off-white background `#FAFAF7` (light) and existing `#0B0B0F` (dark). Typography: Syne 700 display, DM Sans body. Three named easings + durations (`--v2-ease-emphasis/standard/quick`, `240ms/180ms/120ms`). All variables namespaced `--v2-*` so they cannot leak into v1 styles by accident.
  - **`src/v2/AppV2.jsx`.** Placeholder welcome page that loads `tokens.css` + `AppV2.css`. Shows "v2 is on the way" with a Back to v1 button and a meta line documenting the URL escape hatch. Subsequent PRs (Header, TaskCard, ModalShell, etc.) will replace the placeholder.
  - **Settings → Beta tab.** New top-level tab in Settings (alongside General/AI/Labels/Integrations/Notifications/Data/Logs). Single toggle: "Use v2 interface" — flips localStorage and reloads. Reserved for future opt-in experiments too.
  - **Shared infra.** v2 reuses every server endpoint, every hook, every context, `api.js`, `store.js`, `db.js` — only the React component tree and CSS fork. No migrations, no DB changes, no new endpoints.
  - **What does NOT change in this PR.** v1 visuals are untouched. No changes to TaskCard, Header, modals, or any user-facing behavior unless the Beta toggle is flipped.
  - **Verification.** `npm run build` clean (no new warnings), `npm test` smoke test passes (build + server + health endpoint + JS bundle parse), Beta toggle in Settings flips the flag, `?ui=v2`/`?ui=v1` URL escape hatch works. Default load is v1 — zero behavior change for anyone who doesn't opt in.
  - New: `src/AppV1.jsx` (renamed from `src/App.jsx`), `src/v2/tokens.css`, `src/v2/AppV2.jsx`, `src/v2/AppV2.css`
  - Modified: `src/App.jsx` (rewrote as router), `src/components/Settings.jsx` (Beta tab), `wiki/Version-History.md`, `CLAUDE.md`, `wiki/Architecture.md`

---

## 2026-05-02

- fix(settings): notion shows as disconnected when only MCP is connected [XS]
  - **Bug.** `Settings.jsx` mount-time fetch gated `notionStatus()` behind `keys.notion`, which is only true when the legacy `NOTION_INTEGRATION_TOKEN` env var is set. Users who connected via MCP (the recommended path) and don't have the env var configured saw `notionConnected = null` → "unconfigured" gray dot, even though the server correctly reports `connected: true` via the MCP token. The Notion Sync settings section (gated on `notionConnected.connected`) also failed to render in this state.
  - **Fix.** Removed the `if (keys.notion)` gate. Always call `notionStatus()` on mount — the server's status endpoint resolves whichever auth path is live (MCP or legacy) and returns `{connected: false}` cleanly when nothing is configured, so the gate added no value and broke the MCP-only case.
  - Modified: `src/components/Settings.jsx`

- refactor(settings): split Pushover across Integrations + Notifications tabs [S]
  - **Why.** Pushover settings were originally lumped into one block in the Notifications tab — credentials, public app URL, helper text, per-type toggles, and test buttons all together. That mixed two distinct concerns: *configuring the integration* (a one-time setup) and *choosing which notifications fire over it* (an ongoing preference). User correctly flagged this — Trello, Notion, GCal, Gmail all have their integration settings in the Integrations tab; Pushover should match that pattern.
  - **Integrations tab → Pushover** now hosts: master toggle, Public app URL field, User Key + App Token credentials, priority-level helper text, Test Pushover and Test Emergency buttons. Includes a hint pointing to the Notifications tab for per-type toggles.
  - **Notifications tab → Pushover** is reduced to just the eight per-type toggles (high priority, overdue, stale, nudges, size, pile-up, package delivered, package exception). When Pushover isn't yet enabled or credentials aren't configured, shows a hint pointing back to the Integrations tab instead of dead toggles.
  - No behavioral changes — same settings keys, same dispatcher logic, same defaults. Pure UX cleanup.
  - Modified: `src/components/Settings.jsx`

- docs(security): credential storage notes + Quokka blocklist patch [S]
  - **Patch.** Added `pushover_user_key` and `pushover_app_token` to the Quokka adviser's secret blocklist in `adviserToolsMisc.js`. Both `get_settings` (now redacts them) and `update_settings` (now refuses to write them) match the same handling as Anthropic / Notion / Trello / GCal / 17track keys. Closes a gap from the Pushover transport commit — those settings were stored in the same plaintext blob as other secrets but weren't protected from adviser exfiltration.
  - **Documentation.** New `wiki/Security-Notes.md` — honest accounting of where every secret lives (plaintext SQLite, browser localStorage, env vars), what's protective (OAuth tokens server-only, SMTP env-only, Quokka blocklist, HTTPS in transit), what isn't (no encryption at rest, no master-key separation, localStorage XSS-readable), and when the threat model breaks down (multi-tenant, untrusted hosting, sensitive backups). Documents practical hygiene and lists future-hardening options that aren't on the roadmap.
  - **README.md** — short "Security note" paragraph linking to the new doc so prospective users know what they're getting before they decide whether to deploy.
  - **CLAUDE.md** — new "Security Posture" section documenting the secret storage layout and the blocklist invariant ("keep this list in sync when adding new secret-shaped settings"). Future contributors won't need to re-derive this.
  - **wiki/Home.md** — links to both new docs (Security Notes, Testing Notification Stack).
  - Modified: `adviserToolsMisc.js`, `README.md`, `CLAUDE.md`, `wiki/Home.md`, `wiki/Version-History.md`
  - New: `wiki/Security-Notes.md`

- feat(notifications): tone-aware AI rewrites + Quokka weekly pattern review + test docs [M]
  - **Tone-aware AI notification rewrites.** New `notifAi.js` module exports `rewriteNotifBody(task, body)` that calls Claude Haiku 4.5 with the user's `ai_custom_instructions`. The model rewrites the static notification body in the user's preferred tone — e.g. a user who said "phone calls are confrontation-level for me" gets call-related overdue notifications framed more gently.
  - **Cost-bounded.** `canRewriteThisTick(channel)` allows at most one rewrite per dispatcher tick (60s) per channel. ~$0.001/day at typical volume.
  - **Always falls back gracefully** to the static body: no Anthropic key, no custom instructions, 2.5s timeout, malformed response, or any error all return the original body. Never throws.
  - **Skipped for Pushover Emergency** (priority 2) — `shouldRewrite({priority})` returns false for those. Urgency matters more than tone there.
  - Wired into all three transports' high-priority body construction (Pushover, web push, email).
  - **Quokka weekly cross-task pattern review.** New `runWeeklyPatternReview()` job in `server.js` runs hourly, fires only between 10am–11am on Sundays (gated by throttle key `weekly_pattern_review` with 6.5-day TTL). Queries active tasks with `snooze_count >= 3` and `last_touched` within 14 days. If 2+ qualifying, creates a new Quokka chat titled "Weekly pattern review" with a seeded user message listing the avoidance patterns and asking whether they're worth keeping / reframing / removing.
  - **Pushover ping** for the new chat — priority 0, deep-links to `PUBLIC_APP_URL`, body: "N tasks you've been pushing past — let's talk about them in Quokka when you have a minute."
  - **Skipped silently** if 0 or 1 qualifying tasks (no spam).
  - **Test sequence documented** at `wiki/Testing-Notification-Stack.md` — 17 end-to-end test cases covering every notification feature shipped in this batch (Pushover, Emergency, deep links, tap tracking, digest, analytics, adaptive throttling, wake-me, inline web-push actions, post-completion next-up, AI rewrites, weekly review, dedup, From overrides, failure isolation, graceful no-op) plus a 5-step health check for post-deploy validation.
  - Modified: `pushoverNotifications.js`, `pushNotifications.js`, `emailNotifications.js`, `server.js`, `Dockerfile`
  - New: `notifAi.js`, `wiki/Testing-Notification-Stack.md`

- feat(notifications): web-push subscription dedup + email From overrides [S]
  - **Why dedup.** User reported duplicate web push notifications. Server-side throttling is per-(channel, type), so the dispatcher itself isn't double-firing. Cause: stale `push_subscriptions` rows from PWA reinstalls / iOS subscription evictions / re-granted permissions. Each ghost row got every notification.
  - **`upsertPushSubscription`** now deletes any prior rows with matching `(p256dh, auth)` keys before inserting. The keypair uniquely identifies a device-browser-permission combo, so collisions on those keys mean it's the same client re-subscribing.
  - **One-time cleanup script** at `scripts/dedupe-push-subscriptions.js` for installs that already accumulated dupes. Run with `DB_PATH=/data/boomerang.db node scripts/dedupe-push-subscriptions.js`. Reports duplicate-group count and rows removed; safe to run multiple times.
  - **Why email From overrides.** Default From falls back to SMTP_USER which often hits spam. Two new settings: `email_from_address` (override the literal address — should be on a domain you control with SPF/DKIM/DMARC) and `email_from_name` (display name, default "Boomerang Digest"). Resolution priority: settings → env (`SMTP_FROM`) → SMTP user.
  - **Settings UI** — From-name + From-address fields under Email notifications with inline helper text linking to deliverability practices.
  - **Configuration.md and CLAUDE.md** — new "Email deliverability" sections covering SPF/DKIM/DMARC, recommended providers (Postmark / Resend / Mailgun / SES), `mail-tester.com` validation. CLAUDE.md picks up the full notification feature surface from this batch (engagement analytics, adaptive throttling, inline actions, post-completion suggestion, curated digest, tag-based wake-me bypass, dedup, deliverability).
  - **Deferred to a future commit:** tone-aware AI rewrites (one notification body per dispatcher tick, ~$0.001/day), Quokka weekly pattern review (cross-task avoidance detection via the existing chat surface), centralized notification dispatcher refactor.
  - Modified: `db.js`, `emailNotifications.js`, `src/store.js`, `src/components/Settings.jsx`, `wiki/Configuration.md`, `CLAUDE.md`
  - New: `scripts/dedupe-push-subscriptions.js`

- feat(notifications): inline web-push actions + post-completion next-up suggestion [M]
  - **Inline web-push actions.** Web push notifications for tasks now render Snooze 1h and Done buttons directly on the notification. Tapping Snooze postpones the task for an hour without opening the app; Done marks it complete. Both also stamp the underlying notification log as tapped so engagement analytics credit the channel.
  - **Why these aren't anti-North-Star.** The North Star is "pull me back to ACT on tasks I have to act on." Snooze and Done are closing-the-loop on a decision the user has *already made* — forcing a full app round-trip just to dismiss a low-stakes ping breeds avoidance. The bare tap (notification body) still opens the app on the relevant task for the cases where context matters.
  - **Service worker** (`public/boomerang-sw.js`) — adds `actions: [{action:'snooze1h'}, {action:'done'}]` to the `showNotification` call when the payload has a `taskId` and isn't flagged `no_actions`. New `notificationclick` branches handle each action by POSTing to the new endpoints.
  - **Server endpoints:** `POST /api/notifications/action/snooze` (sets `snoozed_until = now + N hours`, increments `snooze_count`) and `POST /api/notifications/action/done` (sets `status = done`, `completed_at = now`). Both stamp the notification log and `bumpVersion()` so other clients see the change.
  - **Post-completion "Next up" toast.** When the user completes a task, the completion toast now includes a tappable "Next up: <title>" suggestion. Selection heuristic: high-priority +100, due today/overdue +50, XS/S size +20, sorted descending. Tapping opens the suggested task. Toast stays on screen 8 seconds (vs the usual 4) when a suggestion is offered.
  - Modified: `public/boomerang-sw.js`, `server.js`, `src/App.jsx`, `src/components/Toast.jsx`

- feat(notifications): adaptive throttling + per-back-off feedback validation [M]
  - **Why.** Analytics detects signal degradation (tap-rate dropping); without a closing loop, the dispatcher keeps firing into a void anyway. Adaptive throttling closes that loop: a (channel, type) that's been ignored 10 times in a row backs off progressively (1.5×, 2.25×, … capped at 8×) until something taps, then resets to 1×.
  - **Migration 021** — `throttle_decisions` table records each back-off event (channel, type, old multiplier, new multiplier, decided_at, optional feedback + override-until).
  - **`getEffectiveThrottleMultiplier(channel, type)`** in `db.js` — looks at last 10 notifications for that combination. Any conversion → 1.0×. All ignored → step up by 1.5× from the most recent decision, capped at 8×. Inserts a new `throttle_decisions` row when the multiplier changes.
  - **`adaptiveFreq()`** wrapper in `pushoverNotifications.js` multiplies the configured base frequency by the effective multiplier. Wired into all five throttled categories (high-priority, overdue, stale, nudge, size, pile-up).
  - **Per-back-off feedback validation.** Behavioral inference (tap = useful, no tap = useless) is coarse — a user might silently read and act in the app without tapping. The Analytics panel now shows recent unreviewed back-off decisions as chips with 👍 / 👎 buttons:
    - 👍 marks the decision reviewed (no-op).
    - 👎 reverts the back-off (synthetic decision row putting multiplier back) and sets `user_overridden_until = now + 7d` on that combination — adaptive throttling backs off itself for that combination for 7 days.
  - **New endpoints:** `GET /api/analytics/throttle-decisions?days=N` lists the rolling history; `POST /api/analytics/throttle-decisions/:id/feedback` posts thumbs feedback.
  - **UI** — chips appear inside the existing Notification Engagement panel only when there are unreviewed decisions (silent when nothing to review).
  - Modified: `db.js`, `server.js`, `pushoverNotifications.js`, `src/api.js`, `src/components/Analytics.jsx`
  - New: `migrations/021_adaptive_throttle.sql`

- feat(notifications): tag-based quiet-hours bypass via "wake-me" label [S]
  - **Why.** The original Pushover plan had priority 1+2 always bypass quiet hours. User correctly pushed back: "very few things need to wake me at 2am — let me opt in per-task." Default is now silence; only labeled tasks override.
  - **Default `wake-me` label** added to `DEFAULT_LABELS` in `src/store.js` with red `#FF6240` color. Existing installs see it on first label load.
  - **`quiet_hours_bypass_label` setting** (default `wake-me`). Free-text in Settings → Quiet hours so users can rename.
  - **Bypass logic** in `pushoverNotifications.js` `taskHasBypassLabel()`. During quiet hours: priority 0 always silent, priority 1+2 silent **unless** the task carries the bypass label. Generic multi-task overdue summaries are silent during quiet hours regardless (no per-task to check).
  - **EditTaskModal "Wake me up for this" checkbox** below the Labels section — toggles the bypass label cleanly without making users hunt the label dropdown.
  - **Settings UI** — bypass-label name field appears under quiet-hours time pickers when quiet hours is enabled.
  - Modified: `pushoverNotifications.js`, `src/store.js`, `src/components/EditTaskModal.jsx`, `src/components/Settings.jsx`

- feat(analytics): notification engagement panel [S]
  - **Why.** Phase 2a wired up tap and completion stamping; this surfaces the data in the existing Analytics dashboard so it's actually visible. North-Star alignment: the post-2-week review can now see "Pushover tap-rate is X%, completion-rate is Y%" instead of guessing.
  - **New collapsible "Notification engagement" section** in `Analytics.jsx`, between the heat map and the Completed Tasks search.
  - **By channel** breakdown — for each of email, push, pushover: sent count, tap-rate %, completion-rate % (where completion = task done within 24h of notification).
  - **By notification type** breakdown — same fields per notification kind (high_priority, overdue, stale, nudge, digest, size, pileup, package_*).
  - **Empty state** — friendly message explaining what'll appear once notifications start firing, instead of an empty grid.
  - Range follows the same `range` selector as the rest of the Analytics page (default 30 days).
  - Modified: `src/components/Analytics.jsx`

- feat(notifications): curated daily digest with positive reinforcement [M]
  - **Why.** A counts-only digest ("5 open · 2 due today · 3 overdue") informs but doesn't pull — it's debt, not invitation. The North Star is "pull me back into the app to act." A digest that opens with yesterday's wins and surfaces tappable tasks is the soft re-engagement primitive.
  - **`digestBuilder.js`** — shared module used by all three transports. Exports `buildDigest(settings)` returning `{ hasContent, subject, textBody, htmlBody }`. Sections: friendly lead-in → yesterday recap + streak → Today (overdue rolled in, gentle phrasing like "due 2 days ago") → Coming up → Carrying ("carrying for 5 days", not "stale") → Quick wins → Weather. Skips the send if no section has content.
  - **Tappable HTML** — every task in the digest is wrapped in `<a href="{publicAppUrl}/?task=…">`. Powers the deep-link tap tracking added in 2a.
  - **`digest_style: 'curated'`** is the new default. Setting it to `'counts'` preserves the legacy counts-only output for users who preferred it.
  - **Pushover digest** — new `pushover_digest_enabled` setting (off by default), priority-0, includes `url` field for tap-through.
  - **Test endpoint** — `POST /api/digest/test` (via `sendDigestNow()` in `pushoverNotifications.js`) builds the digest once, dispatches via every enabled channel (email + web push + Pushover), bypasses time-of-day and 23h throttle. Returns `{ fired: [...], skipped: [...] }`. Settings UI gets a "Test daily digest" button.
  - **Refactor.** `pushNotifications.js` `checkPushDigest()` and `emailNotifications.js` `checkDigest()` are now thin wrappers around the shared builder. ~80 lines of duplicated build logic deleted.
  - **New helper exports:** `sendDigestEmail(digest)` and `sendDigestPush(digest)` for the manual test path to reuse the existing transporter / VAPID setup.
  - **Settings UI.** Style dropdown (curated / counts), three channel toggles (Email, Web Push, Pushover), time picker (existing), Test button with "Sent via X, Y" feedback.
  - Modified: `pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, `server.js`, `Dockerfile`, `src/api.js`, `src/store.js`, `src/components/Settings.jsx`
  - New: `digestBuilder.js`

- feat(notifications): deep links + tap tracking + engagement analytics endpoint [M]
  - **North Star — pull me back into the app to act.** Notifications without an action path are dead-ends. Every notification now deep-links into the relevant task; the system tracks which notifications convert to in-app engagement so we can tune by data, not vibes.
  - **Migration 020** adds `tapped_at` and `completed_after` columns to `notification_log`. Index on `task_id` for the new lookups.
  - **`PUBLIC_APP_URL`** env var + `public_app_url` setting field (Settings → Pushover section). Pushover sends include `url` and `url_title: "Open in Boomerang"` whenever it's set.
  - **Deep link handler.** `App.jsx` already had a `?task=` handler — extended to also fire `markNotificationTap()` so analytics knows the user converted from a notification to an in-app open.
  - **Side-effect: tap cancels Pushover Emergency.** When a user taps the deep link of a task that has an outstanding priority-2 alarm, the receipt is cancelled server-side. The user has engaged; the alarm has done its job.
  - **`POST /api/notifications/tap`** stamps the most recent matching `notification_log` row within 10 minutes. Idempotent.
  - **Completion stamping.** `db.js` `updateTaskPartial` now stamps `completed_after` on recent (last 24 h) notifications when a task transitions to `done`/`completed`. Powers the conversion-rate metric.
  - **`GET /api/analytics/notifications?days=N`** returns aggregated `byChannel` and `byType` engagement data with `sent`, `tapped`, `completed`, `tap_rate`, `completion_rate`. Foundation for the dashboard panel landing in 2c.
  - **`logNotifPush` now takes a channel arg.** Lets `pushoverNotifications.js` log with `channel='pushover'` so analytics can distinguish channels. Default 'push' preserves existing call sites.
  - Modified: `db.js`, `server.js`, `pushoverNotifications.js`, `src/App.jsx`, `src/api.js`, `src/store.js`, `src/components/Settings.jsx`, `.env.example`, `docker-compose.yml`, `docker-compose.dev.yml`
  - New: `migrations/020_notification_engagement.sql`

- feat(notifications): pushover transport with emergency priority [M]
  - **Problem.** iOS Safari throttles web push aggressively — notifications get buried, sometimes only deliver when the app is foregrounded, and sometimes drop entirely. The escalation alarms that matter most are unreliable on the device that matters most. Pushover has a dedicated iOS app with full APNs entitlements and supports priority-2 (Emergency) which repeats every 30s for up to 1h and bypasses Do Not Disturb / silent mode.
  - **New module `pushoverNotifications.js`.** Mirrors `pushNotifications.js` shape — 60s `setInterval` loop, same throttling/quiet-hours/active-task helpers, dispatches to all six notification types (high-pri, overdue, stale, nudge, size, pile-up) plus package events. Native `fetch` only — no new npm deps.
  - **Priority mapping:** stage 1 high-pri / nudge / stale / size / pile-up → 0 (normal). Stage 2 high-pri / generic overdue → 1 (`pushover` sound, bypasses quiet hours). Stage 3 high-pri / avoidance + Stage 3 → 2 (`persistent` Emergency, bypasses quiet hours and DND).
  - **Receipt cancellation.** Priority-2 sends save the receipt id to a new `tasks.pushover_receipt` column. When the user resolves the task (status change to done/cancelled/projects/backlog, future-snooze, due-date-forward, reframe added) or deletes it, `db.js` `updateTaskPartial`/`deleteTask` fires `cancelEmergencyReceipt` — alarm stops as soon as the user acts. Single insertion catches both HTTP routes and Quokka adviser tools.
  - **Test endpoints.** `POST /api/pushover/test` (priority-0 hello), `POST /api/pushover/test-emergency` (real priority-2 alarm with 90s auto-cancel so it doesn't ring for an hour), `GET /api/pushover/status`. Settings UI exposes both test buttons with a confirm dialog on the Emergency one.
  - **Migration 019.** `ALTER TABLE tasks ADD COLUMN pushover_receipt TEXT` plus `db.js` schema constants/UPSERT/row mapping updated.
  - **Settings UI.** New Pushover section with masked User Key + App Token inputs, helper text explaining the priority levels and quiet-hours bypass, eight per-type toggles (high-pri, overdue, stale, nudge, size, pile-up, package delivered, package exception), Test Pushover and Test Emergency buttons. Defaults: enabled toggles for high-pri, overdue, pile-up, package delivered, package exception (the avoidance-prone tiers); off by default for stale/nudge/size to keep noise down on day one.
  - **Env fallback.** Optional `PUSHOVER_DEFAULT_APP_TOKEN` for self-hosted installs that want a single shared app token; per-user keys still required. `Settings.jsx` indicates when the App Token is coming from env.
  - **Package events.** `sendPackagePushover` invoked alongside email + web push on delivered/exception/out-for-delivery/signature events. Exception and signature events go priority 1; delivered/out-for-delivery go priority 0.
  - **Classification: enhancement, not blocking.** Web push and email continue to work as-is. Users without Pushover credentials experience zero behavior change; the dispatcher is its own loop and failures are isolated.
  - New: `pushoverNotifications.js`, `migrations/019_add_pushover_receipt.sql`
  - Modified: `server.js`, `db.js`, `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `src/api.js`, `src/store.js`, `src/components/Settings.jsx`, `CLAUDE.md`, `README.md`, `wiki/Configuration.md`, `wiki/Docker.md`, `wiki/Architecture.md`, `wiki/Features.md`, `wiki/Getting-Started.md`

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
