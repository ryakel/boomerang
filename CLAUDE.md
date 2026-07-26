# Boomerang — Claude Development Guide

Personal ADHD task manager PWA. React 19 + Vite frontend, Express + sql.js backend, one Docker container serving both. Single developer (ryakel), single user — no PR review process, no multi-tenancy. Major subsystems: Quokka (AI adviser with staged-execution tools), Notion/Trello/GCal/Gmail integrations, package tracking, and a notification stack (web push / email / Pushover / APNs) reshaped around one morning digest.

This file holds only the invariants and gotchas you can't infer from the tree. Deep implementation notes live in `wiki/` and load on demand — index at the bottom. Procedural workflows live in `.claude/skills/`.

## Git model — `dev` integrates, `main` is production

- All development lands on `dev`. `main` only ever receives merge commits from `dev`: never commit to `main` directly, never branch a feature off `main`, never cherry-pick or rebase between the two. `main` must stay an ancestor-subset of `dev` (`git rev-list --count origin/dev..origin/main` == 0; if it's ever > 0 the trunk has forked — stop and relink with a content-neutral merge of `main` into `dev`).
- Sync first thing every session: `git fetch origin && git checkout dev && git reset --hard origin/dev`.
- The local proxy 403s direct pushes to `dev`, so work lands via fresh ref → PR → merge: `git push origin <branch>:refs/heads/claude/<thing>`, PR with `base: "dev"`, merge with `merge_method: "rebase"` (linear history on `dev`).
- Never merge a PR without explicit user approval — ask "Ready to merge?" and wait. Each merge needs its own approval.
- A push to `dev` auto-builds and deploys `boomerang-dev` on port 3002 (the one staging surface); a push to `main` deploys prod via Portainer — which is why merge approval matters.
- Promoting `dev → main` has its own hard rules (fresh release branch, merge-commit only, pre-flight cleanup) — load the `promote-release` skill before doing it.
- Run `npm audit` before opening a PR; flag new vulnerabilities.

## Commit convention

`<type>(<scope>): <subject> [<size>]` — types `feat|fix|refactor|style|docs|test|chore|perf`; size `[XS]`–`[XL]`; subject imperative, lowercase, no period, under 72 chars. Body for M+ changes; `BREAKING CHANGE:` in body when applicable.

## Documentation requirements

Every commit updates docs before pushing:
- `wiki/Version-History.md` — an entry for every commit, no exceptions. The file is `merge=union` (see `.gitattributes`) and must stay append-only/additive near the top.
- `CLAUDE.md` (invariants/gotchas only), `wiki/Features.md`, `wiki/Architecture.md`, the `wiki/Claude-Notes-*.md` page for the affected area, `README.md` — whichever the change touches. Feature-level narrative belongs in the wiki, not this file.

## Debugging posture

When prod breaks, suspect freshly-shipped code first: read the error and stack trace, trace it to recent commits, and form a code-side hypothesis before asking the user to run infra diagnostics. Verify data-dependent fixes against the user's actual data shape (post-wipe DB, pending-only records), not just the seed's — and confirm the deploy actually landed before saying "test it now."

## Invariants and gotchas

Each of these encodes a real incident or trap. Full context in the linked wiki pages.

**Data durability**
- Never derive a user-visible earned value (streak, records, lifetime totals) solely from live task rows — persist provenance metadata at observation time (the `settings.streak_anchor` pattern). Before shipping any stat, ask "what happens to this number when its rows are deleted?"; the only acceptable answer is "nothing."
- The bulk settings sync is whole-blob last-writer-wins. Keys that must survive across devices need a server-side merge guard (`mergeDurableStreakSettings()` / `preserveAbsentSettings()` in `server/server.js`); booleans that must never revert get their own `app_data` carve-out with dedicated endpoints instead of riding the blob. Load the `add-setting` skill before adding any setting.
- `PUT/POST /api/data` rejects payloads that would empty the tasks table or shrink it >50% (the 2026-05-07 wipe guard). Per-record `/api/tasks` mutations are the supported path for legitimate bulk deletes.
- Any new refetch/hydrate path must FLUSH pending local mutations before overwriting local state — never cancel the debounce. Any code path that cancels the per-record debounce timer must either push the pending changes itself or leave the push snapshots alone.
- Deleting a task must not delete its completion-day evidence (`deleteTask()` stamps `settings.completion_days`).

**Lists (Trello checklist sync)**
- The merge lives in `server/listMerge.js` and is PURE — no db, no network. Every rule about whose edit survives is pinned in `scripts/lists.test.mjs`; change one, run those first. The `shadow_*` columns are the 3-way baseline (what both sides last agreed on); without them a two-way diff can't tell your edit from hers and silently eats one per poll.
- This is someone else's data. A merge must NEVER delete on Trello — only an explicit Boomerang delete (tombstone) propagates. Never hard-delete a row that still holds a `trello_check_item_id`: a hard delete is indistinguishable from an item Trello hasn't sent yet, so the next poll resurrects it. A poll missing >50% of synced items is a bad response, not a mass delete.
- When you can't prove which side moved (null shadow), the OTHER side wins — pushing unproven local state is the only direction that can destroy her data.
- `clearAllData()` (the dev seed's reset) must NEVER be extended to `lists`/`list_items`. Dev runs `SEED_DB=1`, so every push to `dev` reseeds on restart — wiping lists there would drop the Trello linkage on every deploy and silently stop a list the other person is still relying on.
- A dev-shaped server merges inbound but never writes back (`DEV_LIST_SYNC_WRITES=1` opts in); two servers fighting over one real family list looks exactly like a sync bug. Held writes must surface in the UI via `last_sync_error` — from inside the app a held push is indistinguishable from a broken one, and a shared list that silently stops propagating is this feature's worst failure. Any new reason a push is skipped needs the same treatment.

**Server & deploys**
- Server runtime modules live in `server/`; the Dockerfile copies the directory wholesale. Only a genuinely NEW top-level directory needs a Dockerfile `COPY`. Dev-only files (tests, previews, eslint/vite configs) stay out of the image.
- A dev-shaped server (`APP_VERSION` = `dev`/`dev-*`) is notification-muzzled (`notifsMuzzled` in server.js) — any new background send path must check it. Test endpoints stay live.
- Routine spawn dedup lives on the `POST /api/tasks` route, NOT inside `upsertTask` — Quokka's rollback compensation restores through `upsertTask` and must never be silently dropped.
- Server logs auto-prefix ISO timestamps — don't add manual ones.

**AI calls**
- Never read `content[0].text` from a Claude response — use `claudeText()` from `aiModels.js` (Sonnet 5+ may lead with a thinking block). Cheap utility calls spread `...NO_THINKING`. Never send `temperature`/`top_p`/`top_k` to Sonnet 5+ (400s).
- Model ids and tier routing live only in `aiModels.js` / `server/aiGateway.js` (`resolveTierModel`). Gate AI features on `aiConfigured(tier)`, never on an Anthropic key directly (OpenAI-only setups must keep working). New AI calls go through `aiComplete({tier, …, feature})` so usage lands in the `ai_usage` table.

**Notifications**
- The product is ONE morning digest plus a short list of intentionally rare pings (the 2026-07-24 "Great Alert Deletion"). Any new background send must justify itself against that surviving list. Load the `add-notification-type` skill before touching this area.
- `isNotifiable()` in `server/db.js` is the single opt-in gate (`due_date || nag_allowed || active escalation`, plus crisis). Per-type channel toggles must never LOOK on when their channel master is off.

**Auth**
- Machine auth is per-device rotating token pairs (`server/deviceAuth.js`, spec `wiki/Auth-Device-Tokens.md`); the static `API_TOKEN` is the bootstrap/fallback only. Secrets are stored hashed; a superseded refresh token replayed = auto-revoke + security alert (the one loud notification category). `/api/auth/device/refresh` is an OPEN path by design (self-authenticating, rate-limited) — don't gate it. App Attest verification is REAL (`server/appAttest.js`, pinned Apple root) — never weaken a check to make a client pass; a failed verification from an authenticated caller fires the loud `attest_failure` alert.
- The client interceptor (`src/apiConfig.js`) reads credentials per call — never capture a token at install time; device tokens rotate hourly.

**Notion**
- Never write Notion MCP code without the actual OpenAPI spec, and remember the MCP OAuth token does NOT work as a REST bearer token — they are two independent auth paths. Load the `notion-dev` skill before touching Notion code.

**Client & iOS**
- Never call `localStorage.setItem` raw — use `safeSetItem()` in `src/store.js`. The `capacitor://` origin's quota is small and an unhandled overflow crashes the render with no recovery path.
- Native code (extensions, intents) reads credentials ONLY via BoomerangKit's `SharedCredentials` and must NEVER call `/api/auth/device/refresh` — the refresh token is single-use and the WebView owns rotation; a native refresh races the app and trips reuse detection on ourselves. Secrets on the native side live in the shared Keychain, never App Group `UserDefaults`.
- Activate the phone-side `WCSession` in `AppDelegate.didFinishLaunchingWithOptions`, never in `SceneDelegate` — a watch `sendMessage` launches the phone app in the BACKGROUND, where no UI scene connects, so scene-based activation leaves the session inactive for exactly the launches that exist to serve the watch. Symptom: `WCError.deliveryFailed` → "Payload could not be delivered" on the wrist, while everything works whenever the phone app happens to be open. Reachable-but-undeliverable is always this; genuinely out of range says "Phone not reachable" instead.
- The watch app holds NO credentials and makes NO HTTP calls — watchOS has no Tailscale client and watch traffic tunneled via the phone doesn't carry its VPN routes, so every watch request is proxied by the phone over WatchConnectivity (`Shared/WatchProtocol.swift`, `App/WatchBridge.swift`). Keep it that way; anything the watch needs gets a message op, not a token.
- Never run `npx cap add ios` (it would regenerate away the committed UIScene-lifecycle migration) — always `npx cap sync ios`. TypeScript stays pinned <6 (the Capacitor CLI's config loader breaks on 6+).
- Watch app problems are never diagnosable from the build log — an empty icon set, a stale asset catalog, a missing `CFBundleIconName`, and a provisioning profile that doesn't cover watchOS all end in BUILD SUCCEEDED and collapse into the same two on-wrist symptoms. Run `npm run ios:watch-doctor` and read the bundle. Targets with `GENERATE_INFOPLIST_FILE = NO` must carry `CFBundleIconName` themselves; what actually gates a watch install is whether the embedded profile's `ProvisionedDevices` lists that watch — not the profile's `Platform` array, which reads `["iOS","xrOS","visionOS"]` for a watch app embedded in an iOS companion and is *correct* that way (measured: the bundle installed unchanged once the watch joined the profile). A doctor check asserting watchOS in `Platform` was invented from theory, never verified against an install, and misdirected the diagnosis for weeks — only assert what you've watched matter. Until the watch's UDID is registered in the portal (type **Apple Watch**), signing falls back to the team wildcard, the watch isn't in the profile, and watchOS refuses with a bare "App could not be installed at this time". `-allowProvisioningUpdates` renews profiles and mints certificates but will **not** register an unknown device — it fails with `Device "…" isn't registered in your developer account`. Developer Mode on the wrist is a separate prerequisite and does not substitute.
- `xcrun devicectl list devices` serves a CACHED record — its `developerModeStatus` read `disabled` for a watch that `devicectl device info details` reported live as `Enabled (1)`. Never gate anything on the listing's copy; confirm with a live per-device query. That one stale field was the root cause of the entire watch-install saga: it made `find-watch.sh` return nothing, which silently skipped device registration, which left signing on the iOS wildcard. Related: devicectl reports two ids per device and `xcodebuild -destination "id=…"` matches only `hardwareProperties.udid`, never the `identifier` GUID — watch UDIDs are the same `00008310-…` shape as iPhones', not plain UUIDs. The listing omits `hardwareProperties.udid` for watches (but not for iPhones), so the UDID has to come out of the live `device info details` response.
- A device-discovery helper that returns empty on failure disables every branch guarded by `[ -n "$ID" ]` without printing a word. Prefer returning a best guess and letting the real tool produce a real error over a silent empty string.
- Version-mismatch reload is gated OFF in the native shell (`VERSION_CHECKS_ENABLED` in `useServerSync.js`); any future "stale client → reload" logic needs the same gate. Boot-blocking fetches carry `AbortSignal.timeout` + offline fail-open (the tailnet-host hang trap).
- The App Group identifier and URL scheme flow through build settings → Info.plist/entitlements substitution — never hardcode them in Swift.
- Quokka secret blocklist (`adviserToolsMisc.js`): every new secret-shaped setting joins it (write-blocked + read-redacted).
- Theme migration shims (`terminal*`/`wallaby*` → kept, in `store.js` + the index.html pre-paint script) stay until prod data can't contain old values.

**Releases**
- Delete `wiki/wallaby-reference/` (external loggd.life reference assets) from `dev` before promoting to `main` — they must not ship to prod.
- Dev seed/reseed endpoints are hard-gated to `isDevEnv` — keep it that way; prod must never be wipeable by them.

## Where the detail lives (load on demand)

| Area | Read |
|---|---|
| Feature systems — energy/impact tagging, critical tag, DIY check, routines/loops/stacks/sequences, projects, task model, notes, growth areas, escalation ladder | `wiki/Claude-Notes-Features.md`; user-facing behavior in `wiki/Features.md` |
| Integrations — Notion, Trello, GCal, Gmail, packages/17track/Shippo, weather, knowledge base | `wiki/Claude-Notes-Integrations.md`, `wiki/Notion-Integration.md` |
| Shared lists — the server-side bidirectional Trello checklist sync, distinct from the client-side task→card push | `wiki/Claude-Notes-Integrations.md` → Trello List Sync; merge rules in `server/listMerge.js` + `scripts/lists.test.mjs` |
| Notifications — digest pipeline, the three engines, channels, what survived the reshape | `wiki/Claude-Notes-Notifications.md`, `wiki/Testing-Notification-Stack.md` |
| Quokka adviser — architecture, tool registry, sessions/plans, health check | `wiki/Claude-Notes-Quokka.md` |
| Platform — UI history (Kept), auth, iOS native app, security posture, data-durability detail, tech-debt ledger | `wiki/Claude-Notes-Platform.md`, `wiki/iOS-Native-App.md`, `wiki/Architecture.md`, `wiki/Security-Notes.md` |
| Per-commit history and incident narratives | `wiki/Version-History.md` |

Skills in `.claude/skills/`: `promote-release` (dev→main), `notion-dev` (Notion code rules), `add-notification-type` (new send checklist), `add-setting` (settings-blob hazards).
