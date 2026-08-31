# Claude Dev Notes — Platform (UI, iOS, Auth, Security, Durability)

> Moved out of `CLAUDE.md` (2026-07-25) in the context-engineering restructure: `CLAUDE.md` now holds only invariants and gotchas, and deep implementation notes live here, loaded on demand. Content below is preserved from the former CLAUDE.md "Development Notes" and stays maintained — update it the same way CLAUDE.md used to be updated.

## Derived-Stat Durability Rules (NON-NEGOTIABLE, born 2026-06-10 streak incident)
1. **Never derive a user-visible earned value (streak, records, lifetime totals) solely from live task rows.** Deleting a row destroys the evidence: `computeStreak`'s walk-back floor came from the oldest *surviving* task's `created_at`, so dismissing old Gmail imports retroactively shortened the rally 36 → 27. Persist compact provenance metadata at observation time, while the source rows still exist (the fix: `settings.streak_anchor`, a backward-only 'YYYY-MM-DD' floor stamped on every app load).
2. **When adding any stat/gamification feature, answer "what happens to this number when its underlying rows are deleted?" before shipping.** The acceptable answer is "nothing changes." If the answer is anything else, persist whatever metadata makes it "nothing."
3. **`/api/analytics/history` is NOT an independent survivor record.** It aggregates `status='done'` rows from the same tasks table — it can't see pending/deleted rows and dies with them. `notification_log` is the only collection that genuinely survives bulk wipes. Don't design a recovery path on top of analytics history again.
4. **Repair path for lost floors:** `streak_anchor` is an ordinary (non-secret) setting, writable via Quokka `update_settings` ("Set streak_anchor to YYYY-MM-DD"). Quokka writes go through `setData()` directly, bypassing the sync-path guard below — so a deliberate repair (or deliberate forward correction) always sticks.
5. **The bulk settings sync is whole-blob last-writer-wins — cross-device-merged keys need a SERVER-side guard.** *(2026-07-15 update: `preserveAbsentSettings()` in `server.js` now guards the whole class for plain values — any key ABSENT from an incoming blob keeps its stored value, so a pre-feature bundle can no longer erase a key it doesn't know about (the `pushover_open_native` "toggle never saves" incident). Explicit values, including `false`, still win. Monotonic/merge keys (anchor, unions) still need their stronger per-key guards below.)* Round 2 of the incident: the Quokka-set repair anchor was erased within seconds by a stale client's `pagehide` sendBeacon pushing its anchor-less localStorage blob over the server's. Client-side merge guards can't fix this (any device that hasn't hydrated yet is a loaded gun). `mergeDurableStreakSettings()` in `server.js` guards every streak-evidence key on every bulk PUT/POST: `streak_anchor` backward-only, `completion_days`/`free_days` union, `easter_egg_wins` key-union. When adding any future setting that must survive across devices (anchors, high-water marks, earned values), give it the same server-side merge treatment — do not trust the blob.
6. **Deleting a task must not delete its completion-day evidence.** Round 3 of the incident (the actual prod mechanism): the dismissed import carried the ONLY completion on 2026-05-14; deleting it turned that day into a fault day and the walk broke there — no floor/anchor can fix a fault-day break. `deleteTask()` in `db.js` now stamps the dying task's completion day (done `completed_at` / waiting `waiting_at`, bucketed in `settings.user_timezone`) into `settings.completion_days`; `computeStreak` credits those days as completions. Manual repair for evidence already lost: add the hollow day(s) to `free_days` via Quokka.


### Infrastructure
- Version check on every view/modal navigation via `/api/health`
- Docker multi-stage build with QEMU-safe arm64 support
- `sharp` as devDependency for icon generation
- Dev seed system: `SEED_DB=1` populates DB with realistic ADHD test data at startup (Claude API or static fallback). On-demand reseed via `POST /api/dev/seed` (wipes + reloads). Both the endpoint and the **Settings → Data → "Reseed dev database"** button are hard-gated to the dev environment — `isDevEnv` in `server.js` is true only when `APP_VERSION` is `dev` or `dev-<sha>` (prod builds use `v1.x.x` git tags), exposed to the client via `isDev` on `/api/health`. The endpoint 403s and the button is hidden anywhere else, so prod can't be wiped by it.

### UI v2 (2026-05-03; sole UI since the v1 purge, 2026-06-10)
v2 is the only interface. The legacy v1 UI (`src/AppV1.jsx` + `src/components/`, ~18k lines) was deleted on 2026-06-10 after a month as an unused escape hatch.

**Routing.** `src/App.jsx` renders `AppV2` (in `src/AppV2.jsx`) unconditionally inside the ErrorBoundary. The old `localStorage.ui_version` flag and `?ui=` URL escape hatch are ignored; `data-ui-version="v2"` is still mirrored on the documentElement. Shared components that v2 used from the old v1 tree (`Logo`, `Rings`, `CarrierLogo`, `WeatherSection`) were moved into `src/components/`; the `.weather-*` styles WeatherSection needs were extracted into `src/components/WeatherSection.css` (they used to ride along in v1's TaskCard.css). The `src/components/` → `src/components/` rename from the original end-state plan is deferred — pure churn, no behavior.

**Tokens.** v2 design tokens live at `src/tokens.css`, all namespaced `--v2-*` so they cannot leak into v1. Activated by `data-ui="v2"` (set by AppV2 on mount). Dark variant keys off the existing `data-theme="dark"` attribute.

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

**Reusable v2 primitives** (in `src/components/`):
- `ModalShell` — sheet/panel wrapper. Props: `open`, `onClose`, `title`, `subtitle?`, `width: 'narrow' | 'wide'`, `children`. Circular-pill X top-right, hairline below title, body padding 24px.
- `EmptyState` — calm empty/placeholder. Props: `icon` (lucide component), `title`, `body?`, `cta?`, `ctaOnClick?`. Soft circular icon backdrop, ghost CTA.
- `Header` — calm 4-affordance header. Props: `onOpenAdviser`, `onOpenPackages`, `onOpenSystemMenu`, `systemMenuOpen`. Logo + wordmark left, three icon buttons right (sparkle / package / ⚙). The legacy `MoreVertical` ⋯ slot was replaced by the ⚙ Settings glyph that toggles the `SystemMenu` popover (2026-05-22).
- `SectionLabel` — `--type-section` ALL-CAPS label with sparkle bullet + optional count chip.
- `TaskCard` — v2 list card. Status economy: only overdue + high-pri get a colored left border; stale → inline meta; low-pri → opacity 0.78. Energy as a single chip (lucide icon + N small Zap glyphs in the type color).
- `BottomTabs` — mobile-only bottom navigation. Four buttons: Today | New | What now | Spaces. Each button has a distinct color (blue, green, orange, purple). Today + Spaces are navigation tabs; New short-tap opens inline quick-add input, long-press opens full AddTaskModal; What now opens WhatNowModal. Hidden on desktop (≥769px) by both AppV2 render gate AND a CSS @media — desktop keeps Kanban + side drawer + FloatingCapture FABs.
- `SystemMenu` — anchored popover off the ⚙ icon. Hosts low-frequency system surfaces: Settings, Analytics, Done, Suggestions, Activity log. Same row treatment as the brand popover so the two header popovers feel like siblings.
- `SpacesHub` — modal-sheet picker for Projects / Routines / Knowledge. Tapping a row closes the hub and launches the existing dedicated modal. Future C-upgrade swaps the picker rows for live preview cards (session counts, last-edited timestamps) without changing the launcher contract.

The first five primitives are the v2 task-surface language. The last three (added 2026-05-22) are the v2 mobile-navigation language. Every subsequent v2 surface uses them — never reach for a one-off chrome.

**Mobile navigation model (2026-05-22).** The legacy ⋯ More menu (8 items, single sheet) was retired in favor of three separate surfaces, each sized to its frequency:
1. **BottomTabs (mobile only)** — Today | New | What now | Spaces. Persistent across the app; one tap to switch contexts or trigger actions. FloatingCapture (inline quick-add + time-picker FABs) is desktop-only now that these actions live in the bottom bar.
2. **SystemMenu (popover off ⚙)** — Settings, Analytics, Done, Suggestions, Activity log. Low-frequency system stuff.
3. **SpacesHub (modal from Spaces tab)** — Projects, Routines, Knowledge. Each row launches the existing dedicated modal.

The Boomerang wordmark popover (Analytics + Done, top-left) was already in place and remains the brand-zone shortcut. `activeTab` state plus a safety-net `useEffect` snap the tab indicator back to 'today' whenever every spaces-related surface (hub + Projects/Routines/Adviser-from-knowledge) is closed. Desktop is unaffected — Kanban + side drawer was never under the ⋯ menu's discoverability problem.

**Branch model.** v2 work lands on the `dev` branch (auto-builds `:dev` Docker image via `.github/workflows/build-and-publish-dev.yml`, deploys to `boomerang-dev` container on port 3002 via `docker-compose.dev.yml`). Once v2 stabilizes, dev gets merged into main.

**Legacy plumbing (removed 2026-06-10).** The Settings → Legacy tab, the `v1_disabled` setting, and the `ui_version` localStorage flag are gone along with v1 itself. A stale `v1_disabled` key in stored settings is harmless (nothing reads it).

**Global error logging.** `window.onerror` + `unhandledrejection` handlers log errors to the Activity Log as `error` entries. React ErrorBoundary render crashes also logged. Activity Log has an "Errors" filter tab. `logSystemError(message, detail)` in store.js is the shared function.

**End state — reached 2026-06-10.** v1 deleted (`src/AppV1.jsx`, all of the old `src/components/`, `src/App.css`); the `src/v2/` → `src/` flattening landed with Kept K0 (2026-06-10).

### Terminal Theme (REMOVED 2026-06-10, Kept K0)

The terminal theme experiment (GitHub Dark/Light palettes, `> verb` modal
titles, ASCII flourishes, density signals) was fully torn out in the Kept K0
demolition: `src/terminal/` (formerly `src/terminal/`) deleted,
`useTerminalMode` deleted, `terminalTitle`/`terminalCommand`/
`terminalConfirmLabel` props stripped from ModalShell/EmptyState/ConfirmDialog
and every call site, the terminal-only TaskCard density signals (checkbox,
`[X/Y]` counter, 🔥N streak, notes preview) removed from markup, both
`check:terminal-*` smoke scripts dropped, and all `[data-theme^="terminal"]`
CSS purged. The ONLY survivors are the theme migration shims (`loadSettings()`
in store.js + the index.html pre-paint script) that silently upgrade stored
`terminal`/`terminal-dark`/`terminal-light` values to wallaby equivalents —
keep those until prod data can't contain terminal values anymore.

### Wallaby Theme + IA Remap (REMOVED 2026-06-12, K6 teardown)

Wallaby (the loggd.life-inspired navy heatmap dashboard) was fully torn out
in the K6 demolition: `src/wallaby/` deleted (shell, Home/Habits/Tasks/
Profile/Goals/Notifications views, nav, header, ContributionHeatmap,
shared.css de-pill overrides, wallaby palette blocks), the Wallaby family
removed from the theme picker / theme.js / index.html pre-paint, and every
`[data-theme^="wallaby"]` gate stripped. **Survivors relocated to
`src/kept/`** (they were load-bearing for Kept):
- `heatmapUtils.js` (historyByDay/currentStreak/etc.)
- `WallabyEditTask` → **`src/kept/QuickEditTask.{jsx,css}`** — the Kept
  mobile quick editor (still wb-classed; bm-first rebuild is future polish)
- `modals.css` / `forms.css` / `settings.css` / `analytics.css` — the
  full-page-modal + form/settings/analytics override sheets, gates narrowed
  to `[data-theme^="kept"]`
- `wb-compat.css` — the base `--wb-*` token defaults + the Quokka toolbar
  `.wb-icon-btn` rules, kept so wb-token components resolve in every theme
  (dies when QuickEditTask is rebuilt bm-first)

**Theme migration shims** (keep until prod data can't contain old values):
`loadSettings()` in store.js + the index.html pre-paint script silently
collapse any stored `terminal*`/`wallaby*` theme onto `kept-dark`/`kept-light`.

**System-follow theme option (2026-07-04):** `settings.theme` can hold a
`'system'` or `'kept-system'` sentinel (per family) meaning "match the OS
color scheme" — resolved live via `prefers-color-scheme`, not frozen to
whatever the OS said at first load. `src/theme.js` is the source of truth:
`resolveTheme()` maps a sentinel to its concrete `light`/`dark` equivalent,
`isSystemTheme()` detects one, `applyTheme()` resolves-then-paints, and
`watchSystemTheme(getTheme)` subscribes to `prefers-color-scheme` changes
and re-applies the theme live while the app is open (wired in `AppV2.jsx`'s
mount effect) — so an OS-level light/dark switch (e.g. automatic sunset
dark mode) repaints the app without a reload. `index.html`'s pre-paint
script mirrors the same sentinel-resolution table (inline scripts can't
import modules) so there's no flash of the wrong theme before React mounts.
Settings → General's Mode picker is now a three-way Light/Dark/System
segmented control (previously two-way); `store.js`'s "unset theme" default
for new installs is now the literal `'kept-system'` sentinel rather than a
resolved snapshot, so new installs keep tracking the OS scheme going
forward instead of freezing to whatever it said at first launch. Existing
users' explicit theme choices are untouched — this only changes the
default for a genuinely unset `settings.theme`.

### Kept — the public-facing design language (2026-06-10, approved direction)

Wallaby is too visually close to its loggd.life inspiration to take public.
**Kept** is the original replacement: full rebrand (arc-into-catch mark,
`boomerang.` Fraunces wordmark, ember-orange hero on warm-neutral "Smoke"/"Linen"
palettes — revised 2026-06-10 from the original green-ink+gold after it read
too earthy; gold survives as the rally/feather accent), arcs-not-grids data viz (Flight Trail with streak arcs, Month Dots,
Density Ribbon, Day Arc gauge — NO contribution heatmaps), 4-tab + center-Throw
mobile IA with Quokka in the header, and a desktop "command center" (sidebar +
work surface + Today rail, ⌘K throw, Kanban demoted to a Board view-mode).
Naming is hybrid: plain nouns for nav (plus Loops = routines, Arcs = projects,
Flight log = profile), metaphor in moments ("Caught it.", "↩ returns Tue",
"↻ N-day rally"). Full spec: **`wiki/Kept-Design-Language.md`** (tokens
`--bm-*`, components, motion, a11y, the loggd-distinction table, and the K1–K6
migration plan). Prototypes: `kept-preview.html` (mobile), `kept-desktop.html`
(desktop), `brand-board.html` (the 3-direction exploration) — dev-only render
harnesses, never shipped. Wallaby remains the daily driver until Kept lands.
**Progress:** K0 (demolition: terminal teardown, src/v2 flattening, theme.js) +
K1 (brand assets app-wide, `src/kept/palette.css` `--bm-*` tokens, theme
registration, Fraunces, `--energy-*` single-source) + K2 (`src/dates.js`
canonical date module WITH unit tests in `npm test`; FlightTrail / MonthDots /
DensityRibbon / DayArc in `src/kept/`) + K3 (KeptShell mobile IA — Today with
Day Arc hero, Loops with trail cards, Tasks + action sheet, More, ThrowSheet;
`useMobilePages` + `:is()`-gated modals.css serve both shells; shared
`toggleHabitDay` handler) + K5-v1 (KeptDesktop command center: sidebar +
⌘K Throw + shared Kept views; Today rail / Board / Timeline modes are the
K5 continuation) + K6 cutover (NEW installs default to Kept system-follow;
existing themes untouched) are MERGED. **Kept is now the default experience
for new installs on both mobile and desktop.** Remaining: K5 continuation
(Today rail, Board/Timeline, detail panel), K4 polish (Arcs/Flight log as
Kept-native surfaces), and the K6 completion — Wallaby teardown once the
user confirms Kept as the daily driver.

**Known design debt (2026-07-04, Fable-driven audit — see `wiki/Version-History.md` for the fixed half of this pass):** the edit-modal family (`EditTaskModal.jsx`, `RoutinesModal.jsx`) has real card-in-card nesting where later feature sections (Escalation, Sequences) got bolted onto `src/kept/forms.css`'s layered Wallaby→Kept override passes rather than a single design pass — visible as 3-4 different treatments for equivalent controls (remove buttons, action pills, selected-chip colors) in one modal. `src/kept/QuickEditTask.jsx` (the mobile quick task editor, formerly `WallabyEditTask`) is still entirely styled in the torn-out Wallaby theme's `wb-*` class vocabulary (purple accents where Kept uses ember, square checkboxes where Kept uses circles, card-on-card backgrounds) — kept functional only by the `wb-compat.css` token bridge, never rebuilt bm-first (this was already flagged above under "Wallaby Theme + IA Remap"). Also unaddressed: a broad color-token sweep (~90+ raw hex/rgba values across `src/components/*.css` that bypass the token system — a stale pre-Kept accent hue, four different green/amber "status" colors with no minted token, an unminted Quokka-purple reused by hex everywhere it appears), an icon stroke-width split between `src/components/` (mostly 1.75) and `src/kept/` (mostly 2), and the fact that Escape-key handling across `ModalShell`/`ConfirmDialog`/Kept's sheets isn't coordinated into a single stack — two stacked modals can both close on one Escape press. None of this was fixed in the 2026-07-04 pass; it needs a dedicated design pass with actual visual verification (this session's Playwright couldn't reach even `localhost` in the sandbox), not a blind mechanical sweep.

## Additional Notes
- Single developer (ryakel) — no PR review process needed.

## Authentication (2026-06-19, opt-in)
**Off by default; turn on before public hosting.** `auth.js` (root module, in the Dockerfile runtime COPY list) adds an `authGate` middleware over every `/api` route — INERT unless `AUTH_PASSWORD` or `AUTH_PASSWORD_HASH` is set in env, so existing self-hosted instances are unchanged until configured. Two credential types share the gate:
- **Humans** → `POST /api/auth/login {password}` → httpOnly+SameSite=Lax+Secure session cookie `boom_session` (30-day rolling, persisted in `app_data.auth_sessions` so restarts don't log you out). Cookies ride every same-origin fetch + the SSE stream automatically, so the client is gated by ONE boot check: `src/App.jsx` calls `GET /api/auth/status` and renders `src/components/LoginScreen.jsx` when `authEnabled && !authenticated`. Fails OPEN on a flaky status probe (the server is the real enforcement; client gate is just UX). **The probe is time-bounded (2026-07-21):** `AbortSignal.timeout(4s)` + immediate fail-open when `navigator.onLine === false`, and the pending state renders `BootSplash` instead of `null` — an unreachable tailnet host doesn't reject the fetch (iOS drops packets silently, 60s+ hang), which used to hold the whole app on a blank screen off-VPN/offline and made the asset cache look broken. Any future boot-blocking fetch must carry the same cap.
- **Machines** (iOS Shortcut, future native app) → static `API_TOKEN` env as `Authorization: Bearer <token>` or `x-api-token: <token>`.

Passwords verified with `scrypt` + timing-safe compare (hash format `scrypt$<saltHex>$<hashHex>`); API token timing-safe compared. `scripts/auth-setup.js [password]` prints `AUTH_PASSWORD_HASH` + a fresh `API_TOKEN`. Cookie `Secure` auto-detects via `req.secure` (`trust proxy` is on) or force with `COOKIE_SECURE=1`/`0`.

**Open paths even when gated:** `GET /api/health`, `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout` (login/status must be reachable pre-auth). `POST /api/auth/device/refresh` joined the open list with auth Phase A (it authenticates itself with the refresh token and is rate-limited 20/min in-route).

**Per-device tokens (auth Phase A, 2026-07-25 — full spec `wiki/Auth-Device-Tokens.md`):** `server/deviceAuth.js` mints per-device pairs — access token `bda_<id>.<secret>` (1h TTL, presented like the legacy token incl. `?api_token=` for SSE) + single-use rotating refresh `bdr_<id>.<secret>`. Registry in the `auth_devices` app_data carve-out, secrets stored SHA-256-hashed only. A SUPERSEDED refresh token presented again = the stolen-token signature → device auto-revoked + security alert (`sendSecurityAlertPush`/`Email` — the one loud category the digest reshape allows; not silenceable by per-type toggles, still dev-muzzled). Endpoints: enroll (gated; bootstrap = legacy API_TOKEN), refresh (open), devices/revoke/delete (gated), challenge (real, single-use, 5-min TTL) + attest (REAL verification since 2026-07-26 — `server/appAttest.js`, dependency-free CBOR/DER/X509 against the pinned Apple root `server/appleAppAttestRootCA.pem`; App IDs via `APP_ATTEST_APP_IDS`; failure from an authenticated caller = loud `attest_failure` alert; synthetic-chain tests in `scripts/appattest.test.mjs`). Legacy `API_TOKEN` unchanged as bootstrap/fallback. Client: `src/apiConfig.js` reads credentials PER CALL (the old interceptor captured the token at install — rotation would have broken it), proactively refreshes <5 min from expiry, single-flight 401-retry; `ConnectionSetup` auto-enrolls; Settings → Data → Devices & security lists/revokes.

**Watch app (2026-07-26, `ios/App/BoomerangWatch/`):** single-target watchOS 10+ app embedded in the iPhone bundle; one Today screen (committed three + first steps + Done, gently-returned count, pool size). **It never speaks HTTP and holds no credentials** — no Tailscale on watchOS and watch-via-phone traffic doesn't carry the phone's VPN routes, so `WatchBridge.swift` (phone, `WCSessionDelegate`) proxies every call through BoomerangKit and replies with a fresh `/api/today` payload after mutations. Contract lives in `Shared/WatchProtocol.swift`, compiled into BOTH targets so they can't drift. Phone pushes a snapshot as application context on foreground; watch caches the last payload (titles only) and marks it "showing last synced". New Xcode target — `buildImplicitDependencies` makes the existing schemes build it, but a first interactive ⌘R may be needed to register the `…watchkitapp` bundle id.

**BoomerangKit (2026-07-26, `ios/App/BoomerangKit/`):** local SPM package shared by App + ShareExtension (no Capacitor dep). Native credential store: legacy token + device pair in the shared **Keychain** (access group = App Group id; legacy token auto-migrates out of plaintext App Group defaults), base URL stays in defaults. `SharedCredentials.bestToken` = fresh device access token else legacy token — **native code NEVER refreshes the pair** (single-use refresh + WebView-owned rotation; a native refresh would trip reuse detection on ourselves). `AppAttestClient` = Phase B native half (challenge→generateKey→attestKey→POST /attest; 501 → `server_pending` is the expected-good outcome). WebView boot restores evicted config from native storage (`restoreNativeCredentials()`).

**Quick intake endpoint:** `POST /api/intake {title|text, notes?, due_date?, high_priority?, tags?}` — authed by the gate (API token or cookie), builds a full task with server-side defaults + `size_inferred=false` so the background auto-sizer refines it. This is the iOS Shortcut's target. Recipe: `wiki/iOS-Shortcut.md`.

**Voice capture endpoint (2026-07-19, migration 046):** `POST /api/capture {text, source?}` → 201 with the created inbox task — the "Hey Siri, Boomerang Capture" dictation Shortcut's target (recipe: `wiki/Capture-Shortcut.md`). Distinct from `/api/intake`: dictation-shaped (2,000-char cap, long text keeps first 500 chars as title + FULL text in notes — never silently truncate a capture), stamps `tasks.capture_source` (`'siri'`/`'shortcut'`/`'manual'`, default `'api'`; NULL = not capture-created) for a future digest to identify voice-captured items, and rate-limited 30/min in-route (sliding window in `server/capture.js`, which also holds the pure `normalizeCapture()` — both unit-tested in `scripts/capture.test.mjs`, wired into `npm test` along with real-HTTP 401/201/400 tests against a spawned server). Capture is deliberately dumb (no due date/priority/AI parsing). `authGate` now logs rejected requests (path + IP, never the credential). **Native App Intent upgraded same day (Phase 2):** `BoomerangIntents.swift` now targets `/api/capture` with `source:'siri'` (was `/api/intake`), carries a 10s request timeout (Siri no longer hangs 60s on an unreachable tailnet host), and gains `CaptureQueue` — an App-Group-persisted offline queue (`boom_capture_queue`, 50-cap) that stores a capture on network failure/429 and drains oldest-first on the next intent run AND on every app foreground (`sceneDidBecomeActive` in `SceneDelegate.swift`); items removed only after a successful send (crash mid-flush re-sends rather than loses), 400 drops the item, 401/5xx keep-and-stop. One-utterance "Add X to Boomerang" is a platform impossibility (phrases can't embed free-form Strings — needs the AppEntity work queued in `wiki/UPCOMING_FEATURES.md`). Swift changes need a Mac/Xcode build to compile-verify.

**Not serverless-friendly** (persistent notification loops + SSE + in-memory Quokka runner + local SQLite + session store all assume one always-on instance) — host on a small always-on box, NOT Lambda.

## iOS Native App (2026-06-21, Capacitor — in progress)
Wrapping the existing web app in a Capacitor shell to add native surfaces (Share Extension, App Intents) for creating tasks from Messages/Siri. **Decisions locked:** Capacitor (not a rewrite); **bundled-assets** model (ships `dist/` in the binary, talks to the API remotely — keeps the PWA offline mutation queue + cached shell, unlike a live-WebView wrapper); **Tailscale** connectivity (server stays private, app reaches the tailnet host, `API_TOKEN` gates it); local Xcode build loop.

**Rebuild command (Mac):** `npm run ios` (`scripts/ios-rebuild.sh`) = `npm install` + `npm run build` + `cap sync ios` + `cap open ios`. **Standard rebuild: build BOTH schemes from `main`** — the branch picks the code, the scheme picks the flavor (Boomerang vs Boomerang Dev); the dev APP targets the dev SERVER, not the dev branch. Build from `dev` only to test unpromoted work. Verify via Settings → General → App build vs `git describe --tags origin/<branch>` (fetch tags first — prod releases are auto-tagged). Full doc: `wiki/iOS-Native-App.md` → "The standard rebuild". **One-liner deploys (no Xcode UI):** `npm run ios:dev` / `npm run ios:prod` (`scripts/ios-deploy.sh`) build the "App Dev"/"App" scheme via `xcodebuild` and install+launch on the first connected iPhone via `xcrun devicectl`; first-ever use of a new capability may need one interactive ⌘R to register, then CLI-only. This is the standard "I pulled a branch, put it on my phone" command — it runs `npm install` first so a branch that added a dependency doesn't fail the Vite build with "failed to resolve import" (the trap `build:mobile` alone hits, since it skips install).

**Phase 1 (scaffold — DONE):** `@capacitor/core`+`@capacitor/ios` deps + `@capacitor/cli` dev — **Capacitor 8** as of 2026-07-15 (requires Xcode 26+; iOS template is SPM-based, no CocoaPods) with `typescript` ^5.9 as a devDep (the Capacitor CLI needs TS to parse `capacitor.config.ts`, and TS ≥6 breaks its config loader — keep TS pinned <6); `capacitor.config.ts` (`webDir: 'dist'`, no `server.url`); `npm run build:mobile` = `vite build && cap sync ios`. `src/apiConfig.js` holds the runtime connection config (`boom_api_base`/`boom_api_token` in localStorage — NO secrets in the bundle) + a `window.fetch`/`EventSource` shim that prefixes relative `/api` URLs with the configured base and attaches the token; **inert on the web** (nothing configured → installs nothing), installed once in `src/main.jsx`. Cross-origin can't ride the `boom_session` cookie → Bearer token; the SSE stream uses `?api_token=` because EventSource can't set headers, so `auth.js` `bearerFromReq` accepts `?api_token=` (query) alongside the header. **No Dockerfile/server-build impact** — `apiConfig.js` rides the Vite bundle; `capacitor.config.ts` is dev-only. **`ios/` is COMMITTED as of 2026-07-15** (build output/synced assets gitignored): it carries the **TN3187 UIScene-lifecycle migration** (`SceneDelegate.swift` + `UIApplicationSceneManifest` in Info.plist) without which the iOS 27 SDK aborts launch (`EXC_BREAKPOINT`) — Capacitor 8's stock template is still AppDelegate-only, so NEVER regenerate with `npx cap add ios` (use `npx cap sync ios`).

**Quota-safe localStorage (2026-07-15, born of the native-shell overflow crash):** every localStorage write goes through `safeSetItem()` in `src/store.js` — on QuotaExceededError it evicts the rebuildable convenience caches (`boom_activity_log_v1`/`boom_notif_log_v1`/`boom_packages_v1`), retries once, then warns and continues in-memory. NEVER call `localStorage.setItem` raw in app code — the `capacitor://` origin's quota is small and an unhandled quota error crashes the render via the ErrorBoundary with no recovery path (clear-and-reload re-hydrates into the same overflow). Activity-log snapshots are slimmed (`slimSnapshot()`: no attachment bodies, notes capped) — full task snapshots with base64 attachments were the main quota consumer. Offline-cache-to-IndexedDB is the durable upgrade path (parked).

**Native-shell behavior gates:** version-mismatch reload is DISABLED in the shell (`VERSION_CHECKS_ENABLED = !isNativeShell()` in `useServerSync.js`) — the bundled client's `git describe` version never matches the server's Docker `APP_VERSION`, and a WebView reload can't fetch a new bundle anyway, so the web update flow becomes an infinite boot loop there (2026-07-15 fix). Any future "stale client → reload" logic must carry the same gate.

**OTA bundle updates (2026-07-21) — web changes no longer need Xcode rebuilds.** The shell keeps the bundled model + runtime config (deliberately NOT study-style `server.url` live-WebView: iOS `WKAppBoundDomains` must be static at build time, which would bake the server domain into the binary and kill "one binary, any self-hosted server"). Instead: the Docker build produces `dist.zip`; `GET /api/bundle/manifest` + `/api/bundle/download` (auth OPEN_PATHS — same public assets the SPA serves) expose it; `src/otaUpdater.js` (wired in `main.jsx`, native-only via `isNativeShell()` + dynamic import) checks on boot + resume and swaps newer bundles in via `@capgo/capacitor-updater` (manual mode, `autoUpdate:false` in capacitor.config — never contacts Capgo's cloud). `notifyAppReady()` every boot arms auto-rollback so a bad bundle reverts. Each app updates from its own configured server (`boom_api_base`), so dev/prod pairing is automatic. Rebuilds are now only for native-side changes (plugins, entitlements, Swift, Info.plist).

**Phase 1.5 (in-app Connection screen — DONE 2026-07-15):** `src/components/ConnectionSetup.{jsx,css}` replaces the Web-Inspector localStorage step entirely. Auto-shows in the native shell when no `boom_api_base` is configured (gate in `src/App.jsx`, ahead of the auth check — the `/api` probes would otherwise fail against `capacitor://localhost`); tests before saving (`/api/health` validates the base URL, `/api/auth/status` + `x-api-token` validates the token) and reloads on save so the interceptor re-installs. Reachable later via Settings → Data → "Change server…" (native-only block), a "Change server or API token…" escape hatch on the login screen (which in the native shell is otherwise a dead end — cross-origin fetches can't carry the session cookie, so password login can't work there; the token is the native credential), and `?connect=1` on the web build. Native detection = `location.protocol === 'capacitor:'` (`isNativeShell()` in `src/apiConfig.js`); reopen plumbing = a one-shot sessionStorage flag (`requestConnectionSetup()`/`consumeConnectionSetupRequest()`).

**Phase 0 (native token bridge — DONE 2026-07-15):** `ios/App/App/BoomerangNative.swift` (`CAPBridgedPlugin`, `setSharedConfig`/`getSharedConfig`) mirrors `boom_api_base`/`boom_api_token` from the WebView's localStorage into an App Group container (`group.in.kfam.boomerang` — the single shared identifier every native target uses; change the literal + the capability together if the bundle id differs). Swift-side surfaces (Share Extension, App Intents, native APNs) read the config from there instead of the unreadable WebView localStorage. `src/apiConfig.js` `mirrorConfigToNative()` pushes on every `setApiConfig()` + once on interceptor install. Inert until the App Group capability is provisioned (paid account) — the plugin resolves `stored:false` rather than erroring, so it never breaks a build.

**Phase 4a (native APNs push pipeline — DONE 2026-07-15):** `apnsNotifications.js` (root runtime module, in the Dockerfile COPY list) — APNs HTTP/2 sender, zero new deps (Node `http2`+`crypto`), ES256 JWT auth (45-min cache). Env-only config like SMTP: `APNS_KEY_P8`/`APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_TOPIC` (default bundle id)/`APNS_ENV` (`sandbox` default = Xcode debug builds); unconfigured = no-op. Device tokens in the `apns_devices` app_data carve-out; stale tokens pruned on send. Endpoints: `GET /api/apns/status`, `POST /api/apns/register|unregister|test`. Client: `src/nativePush.js` (`enableNativePush()` permission→register→POST token; `wireNativePushTapHandler()` routes banner taps' payload `url` into the shared `applyDeepLink()`); Settings → Notifications native-only APNs block (status/Enable/Send test); `@capacitor/push-notifications@8`. Native: AppDelegate remote-notification forwarding methods, `App/App.entitlements` `aps-environment` wired via CODE_SIGN_ENTITLEMENTS, `PushNotifications.presentationOptions` in capacitor.config.ts. **Phase 4b (DONE 2026-07-15):** full notification-type coverage — APNs is a **second delivery leg of the Push channel**, not a 4th engine: `sendPush()` in `pushNotifications.js` (the single choke point every push-type notification funnels through — crisis/escalation/high-pri/overdue/stale/nudge/size/pile-up/habit/suggestions/digest/packages/Quokka plan-ready/test) sends native APNs first, then web push. **Arbitration:** when the native leg lands on ≥1 device, Apple web-push endpoints (`push.apple.com` — Safari/Home-Screen PWA) are skipped so one phone never gets two banners; non-Apple endpoints (desktop Chrome/Firefox) always receive; native sending 0 (unconfigured/no devices/bad key) falls through to full web push, so native can only reduce duplication, never drop a notification. Escape hatch `settings.push_web_alongside_native` (default off, exposed in Settings when devices are registered) keeps Apple endpoints firing for a PWA on a *different* Apple device. APNs rides the Push master + per-type `push_notif_*` toggles and the `push_` throttle keys (no new settings matrix), and deep links carry the same `?task=` URLs so engagement analytics work unchanged. The APNs Settings row is now visible from any client when configured (Enable button stays native-shell-only); `sendTestPush` works native-only (zero web subs). The long-planned "centralized dispatcher" shrank to this — the 4th transport didn't add a 4th loop. NOTE: production (TestFlight/App Store) builds need `aps-environment: production` + `APNS_ENV=production`; Xcode debug sideloads use the committed `development` + default `sandbox`.

**Phase 2 Share Extension + Phase 3 App Intents + Dev app (ALL ON DEV, 2026-07-15 — one Mac session pending):** the Share Extension target (rebased from PR #660, superseded) and `BoomerangIntents.swift` (in-app AppIntents, iOS 16+, no extra target: "Add Boomerang task" via Siri/Shortcuts/Action button → App Group config → `POST /api/intake`) are committed, plus a **side-by-side Dev app**: `Debug-Dev`/`Release-Dev` configs on project + both targets and a shared "App Dev" scheme building `ryakel.boomerang.app.dev` ("Boomerang Dev", scheme `boomerang-dev`, App Group `group.ryakel.boomerang.dev`, DEV-badged `AppIcon-Dev`). Branding flows through `BOOMERANG_APP_GROUP`/`BOOMERANG_URL_SCHEME`/`BOOMERANG_DISPLAY_NAME` build settings → Info.plist/entitlements substitution → Swift reads `BoomerangAppGroup` from `Bundle.main`; NEVER hardcode the group/scheme in Swift again. Server: `buildDeepLink()` picks `boomerang-dev://` when `APP_VERSION` is dev-shaped; dev server should set `APNS_TOPIC=ryakel.boomerang.app.dev`. Xcode: pick scheme "App" (prod) or "App Dev"; each needs its App Group registered once via Signing & Capabilities on first build.

**Roadmap:** Mac session (build both schemes + App Groups capability + test Share/Siri/APNs incl. a real nag arriving natively). Paid Apple Developer Program required. Full build guide + Mac steps: `wiki/iOS-Native-App.md`.

## Security Posture (2026-05-02)
**Threat model:** single-user self-hosted, user controls the machine. See `wiki/Security-Notes.md` for the full breakdown.

**Secret storage layout:**
- User-provided keys (Anthropic, OpenAI, Notion, Trello, GCal Client Secret, 17track, Pushover User Key + App Token) live plaintext in `app_data.settings` (server) AND `localStorage` (client).
- OAuth refresh tokens (GCal / Gmail / Notion MCP) live plaintext in `app_data` server-side only — never round-tripped to the browser.
- VAPID private key lives in `app_data.vapid_keys` server-side only.
- SMTP credentials are env-only by design — never written to DB.
- Web push subscription keys live in `push_subscriptions` table.

**Quokka secret blocklist** (`adviserToolsMisc.js`): the adviser's `update_settings` tool refuses to write, and `get_settings` redacts: `anthropic_api_key`, `openai_api_key`, `notion_token`, `trello_api_key`, `trello_secret`, `gcal_client_secret`, `tracking_api_key`, `shippo_api_token`, `pushover_user_key`, `pushover_app_token`. Keep this list in sync when adding new secret-shaped settings.

**No encryption at rest.** SQLite plaintext. Anyone who can read `/data/boomerang.db` reads everything. Acceptable for self-hosted single-user; *not* acceptable for multi-tenant.

## Data Durability (2026-05-08)

**Daily snapshot.** `scripts/backup-db.js` runs on server boot and every 24h. Copies `$DB_PATH` → `${DB_PATH}.YYYY-MM-DD.bak` (idempotent), prunes snapshots older than `BACKUP_RETENTION_DAYS` (default 7). Snapshots live alongside the live DB in `/data`.

**Bulk-write guard.** `PUT/POST /api/data` rejects (HTTP 409) any payload where `body.tasks` is an array AND would empty the table OR shrink it >50% (with a 10-row floor). This is the durability fix for the 2026-05-07 wipe — a client whose initial GET failed pushed `tasks: []` via the manual-flush code path and obliterated 153 rows. Per-record `/api/tasks` mutations are unaffected; that's the supported path for legitimate bulk deletes.

**Recovery diagnostic.** `scripts/recover-from-notification-log.js` (read-only) queries `notification_log` (which survives `setAllData` since it's not in the bulk-PUT collection list) for unique `(task_id, most_recent_title)` pairs and flags which IDs are still present in the live `tasks` table. Up to 500 rows of history.

**Flush-before-hydrate (2026-06-21).** A local mutation (completing a task, an edit) is written to state instantly but its server push is debounced (`DEBOUNCE_MS = 300` in `useServerSync.js`). `fetchAndHydrate` must **flush** that pending push before overwriting local state with the server's copy — NOT cancel it. The original code cancelled the pending push, so any refetch landing inside the 300ms window (`visibilitychange` app-refocus, an `sse-update` from another device, `pull-refresh`) discarded the user's change and the task resurfaced ("I checked it off and it came back"). `pushChanges` is awaitable; `fetchAndHydrate` awaits it, then fetches the merged per-record result (push-then-fetch is order-safe because tasks/routines are per-record). Corollary rule: **any new refetch/hydrate path must flush local mutations first** — never blind-overwrite local state that may hold an unpushed change. The post-hydrate echo-suppression window must also never *drop* a real edit made inside it (reschedule past the window; the per-record diff already neutralizes the echo).

**Activity log is server-side (2026-08-31, migration 058).** It used to live only in `boom_activity_log_v1`, where it was `QUOTA_EVICT_KEYS[0]` — the first key `safeSetItem` evicts under quota pressure. With 1500 tasks and 500 entries each carrying a near-full task snapshot, the `capacitor://` origin was permanently over, so the log was evicted and silently rebuilt forever ("activity logs are completely empty"). Wrong placement twice over: it is the RECOVERY log, discarded precisely when the question it answers gets asked, and it was per-device so desktop work never showed on the phone. Now `GET`/`POST`/`DELETE /api/activity` over an `activity_log` table. `logActivity` stays SYNCHRONOUS (it is called inside `setTasks` updaters) and queues to a 1s-coalesced batch shipper; the server does `INSERT OR IGNORE` on the client uuid so a retried batch can't duplicate. **The POST does not bump the version or broadcast** — activity is not task state and broadcasting it would recreate the hydrate storm. `ActivityLog.jsx` renders local first, then server truth, and falls back to local on a failed fetch (empty must mean "nothing happened", not "the fetch failed"). Local cap dropped 500 → 200; the server keeps 5000.

**Single-flight hydration + no-op hydrates (2026-08-31).** Two more members of the same family. (1) `fetchAndHydrate` had no in-flight guard, and SSE-update / `visibilitychange` / pull-refresh / the spawn-dedupe rehydrate all call it — with two clients awake they overlap constantly. Un-serialized, an OLDER response can land last and overwrite both local state *and* the `prevTasks`/`prevRoutines` push baseline with stale server data, which the next per-record diff then pushes back as genuine changes: version bump → broadcast → the other client hydrates → repeat. That loop is what the user experiences as "double syncing". Overlapping calls now collapse into a single queued follow-up (`inFlight` / `queuedHydrate` in `useServerSync.js`), so N triggers cost at most two round-trips and can never apply out of order. (2) `hydrateTasks`/`hydrateRoutines` wrote state unconditionally, so an echo carrying nothing new still handed React a fresh array reference — re-running every effect keyed on `tasks`/`routines`, **including AppV2's routine spawn pass, the only code path in the app that manufactures tasks**. Both now return the previous reference when the payload is identical (`sameJson` in `src/utils/sameJson.js`). It uses the same `JSON.stringify` comparison `pushChanges` uses on purpose: if the two disagreed, a change could be swallowed at hydrate and re-pushed at diff.

**Flush-before-bulk-push (2026-07-18, same bug class as above).** The manual settings/labels `flush()` used to CANCEL the pending per-record debounce, and `pushBulkState`'s success handler advanced `prevTasks`/`prevRoutines` to current state — so a task added within 300ms of any settings write (prod shape: first-ever task add → streak-anchor effect saves settings → flush) was marked "already pushed" without ever reaching the server. Fixed: `flush()` runs the pending `pushChanges` before the bulk push, and `pushBulkState` only bootstraps the per-record snapshots when they're still null (fresh-empty-server path) — a bulk push carries settings/labels only and must NEVER claim tasks/routines as pushed. Corollary of the corollary rule: any code path that cancels the per-record debounce timer must either push the pending changes itself or leave the snapshots alone.

**Server log timestamps.** Every `console.log/.error/.warn` call gets an ISO-8601 timestamp prefix automatically (wrappers in `server.js` near line 161). Don't add manual timestamps to log lines.

**Streak anchor (2026-06-10).** `settings.streak_anchor` ('YYYY-MM-DD') is the persisted floor for `computeStreak`'s walk-back — provenance metadata that survives deletion of the tasks that established it. Maintained backward-only by a one-time-per-load effect in `AppV2.jsx` (min of oldest task `created_at` and earliest active analytics day); manually repairable via Quokka `update_settings`. See "Derived-Stat Durability Rules" at the top of this file for the general principle.


## Technical Debt & Future Plans

Tracked in [GitHub Issues](https://github.com/ryakel/boomerang/issues). Key items:

- **⛔ OPEN — watch app can't reach the phone (2026-07-26).** Both flavors install and launch on the wrist; every WatchConnectivity request fails with `WCError.deliveryFailed` ("Payload could not be delivered"). Paused mid-diagnosis. Full state, what's already verified correct, and the one unanswered question that splits the problem are in `wiki/iOS-Native-App.md` → "⛔ OPEN: the watch still can't reach the phone". **Read that before touching the watch bridge** — two confident theories were already disproven the expensive way.

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
- **#17** — ~~Notification grouping/batching~~ DONE, then REMOVED 2026-07-24 (batch mode died with the flood — the digest IS the batch)
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
- **Analytics dashboard:** `GET /api/analytics/history?days=N` returns aggregated completion data (daily counts, by-tag, by-energy, by-size, by-DOW). Client renders daily bar chart, day-of-week patterns, tag/energy/size breakdowns, 52-week GitHub-style heat map (UTC-aligned to match server bucketing), and collapsible completed task search. Pure CSS charts, no charting libraries.
- **Achievements (`src/badges.js` + `src/components/BadgesGrid.{jsx,css}`):** locally-derived badges with DURABLE earned state (`settings.badges_earned`, key-union guarded — deleting rows never un-earns). Each badge has a `tier` (bronze/silver/gold) that drives the card tint; the grid header carries a tier legend so the colors read. Cards are equal-height (`grid-auto-rows: 1fr`) with bottom-pinned footers so earned dates / progress bars align. Tapping a card opens a detail overlay (`BadgeDetail`): earned date or progress + "N to go", plus a done/outstanding **checklist** for set-shaped badges (e.g. Balanced Diet → the six energy types with this-week checks, via `checklist`/`checklistTitle` on the badge). Rendered by AnalyticsModal's Overview tab (2026-07-17: the separate Kept Flight log surface was merged INTO Analytics — one stats surface; `src/kept/FlightLog.jsx` deleted, trend icon + sidebar + More all open AnalyticsModal; the More row was later removed in the 2026-07-19 consolidation — mobile reaches Analytics via the header avatar).
- **AI-assisted search (Done + Activity Log):** Both modals have a search bar with instant local substring filter + debounced AI semantic search via `POST /api/search/ai`. Uses Claude Haiku for cost efficiency. Falls back to LIKE search (done) or local filter (activity) without an API key. Server endpoint accepts `{ query, scope, items? }` — `scope: 'done'` queries DB + AI ranking, `scope: 'activity'` ranks provided items.
- **Claude response parsing (`claudeText`/`NO_THINKING` in `aiModels.js`, 2026-07-17, born of the Polish-button crash):** Claude Sonnet 5 runs ADAPTIVE THINKING BY DEFAULT when the request omits the `thinking` param — responses can lead with a `thinking` block (empty text under the default display), so `data.content[0].text` is undefined: client sites crashed (`undefined is not an object ... .match`), `?.`-chained server sites silently returned `''` and degraded (Gmail classify, growth-area rephrasing, AI nudges, pattern/tag scans). NEVER read `content[0].text` — use `claudeText(data)` (collects all text blocks) from `aiModels.js`, which both bundles import. Cheap utility calls (inference, classification, one-liners) also spread `...NO_THINKING` (`thinking: {type:'disabled'}`) into the request body — restores pre-Sonnet-5 cost/latency and stops thinking eating small `max_tokens` budgets (the 100-token nudge calls) from the inside. Sonnet 5 also REJECTS non-default sampling params with a 400 — the Gmail classifier's `temperature: 0` had silently killed classification entirely; never send `temperature`/`top_p`/`top_k` to Sonnet 5+. Deliberately left on default adaptive thinking: the Quokka adviser loop (appends `response.content` wholesale, so thinking blocks echo back correctly) and the `research_task`/ladder-draft tools (already filter text blocks; reasoning helps there).
- **Multi-provider AI + usage dashboard (2026-07-17, migration 043):** the utility-AI surfaces route through two TIERS instead of hardcoded models — `workhorse` (classification, inference, polish, scans, Gmail classify, nudges) and `quick` (one-liners, AI search, push nudges) — resolved by `resolveTierModel(tier, settings)` in `aiModels.js` from `settings.ai_model_workhorse`/`ai_model_quick` (catalog id, or `provider:model-id` for anything newer; defaults Sonnet 5 / Haiku 4.5). **`server/aiGateway.js`** is the single door: `aiComplete({tier, system, user, maxTokens, feature})` routes to Anthropic or OpenAI (chat completions, `max_completion_tokens`, `reasoning_effort:'low'` on gpt-5-family so reasoning doesn't eat the budget — the OpenAI twin of the Sonnet 5 thinking trap) and logs every call into the `ai_usage` table (`logAiUsage`/`getAiUsageSummary` in db.js; cost estimated at insert from `MODEL_CATALOG` pricing, longest-prefix matched because providers echo DATED model ids). Client utility calls go through `POST /api/ai/complete` (headers `x-anthropic-key`/`x-openai-key`, fall back to settings/env `OPENAI_API_KEY`); usage dashboard at `GET /api/ai/usage` renders as Analytics → AI tab (est. cost / calls / tokens + per-provider/model/feature tables). **Pinned Anthropic, NOT tier-routed:** Quokka's agent loop (tool-use shaped), `research_task`/ladder-draft tools, and the vision surfaces (`/api/messages` — attachment OCR `_feature:'ocr'`, research `_feature:'research'`); all of these still LOG usage at their own call sites (feature `quokka` etc.). Modules gate AI features on `aiConfigured(tier)` — never on an Anthropic key directly, or an OpenAI-only setup silently loses every feature. OpenAI key: Settings → Integrations → OpenAI (probe = free GET /v1/models, also in `check_integrations`); model pickers: Settings → Tasks → AI models. `openai_api_key` is IN the Quokka secret blocklist.
- **Centralized model ids (`aiModels.js`, 2026-07-11):** every AI feature's model id used to be a literal string repeated at each call site (server AND client) — an upgrade meant grep-and-replace across a dozen files. `aiModels.js` (root module, no Node-specific deps, in the Dockerfile runtime COPY list) exports `SONNET_MODEL` (workhorse tier: Quokka adviser, Gmail classification, Growth Areas inference, pattern detection, tag suggestions, AI nudge/toast messages, task research, escalation-ladder generation, size/energy inference) and `HAIKU_MODEL` (cheap/fast tier: AI-assisted search, push notification message generation). Imported by both server modules (`import ... from './aiModels.js'`) and the client bundle (`src/api.js`, `src/hooks/useNotifications.js`, via relative path — Vite bundles it fine since it's a plain ESM literal file). A model upgrade is now a one-line edit in this file.
