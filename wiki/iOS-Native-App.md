# iOS Native App (Capacitor)

Boomerang's native iOS app wraps the existing React/Vite web app in a
[Capacitor](https://capacitorjs.com/) shell and adds native iOS surfaces — a
**Share Extension** (create a task from a shared Message/email/page), **App
Intents** (Siri / Shortcuts / Action button), and a Home Screen presence — while
keeping a single codebase.

**Model: bundled assets + OTA updates (2026-07-21).** The app ships the Vite
build (`dist/`) inside the binary and talks to your server's API over the
network. It does **not** load the UI live from the server, so the PWA's offline
behavior (mutation queue + cached shell) is preserved. The API base URL + token
are configured **at runtime** — never baked into the bundle.

On top of that, the shell now **live-updates its web bundle from your server**:
on boot and app foreground it compares `GET /api/bundle/manifest` (the server's
`APP_VERSION`) against the running bundle and, when newer, downloads
`/api/bundle/download` (a zip of the server's own `dist`, produced by the
Docker build) and swaps to it via `@capgo/capacitor-updater` (manual mode —
no Capgo cloud involvement; auto-rollback if a swapped bundle fails to boot).
Result: pushing to `dev`/`main` updates the matching app on next launch —
**Xcode rebuilds are only needed for native-side changes** (plugins,
entitlements, Swift, Info.plist). Because each install updates from whatever
server it's pointed at, one binary works for any self-hosted instance — the
reason this model was chosen over a study-style `server.url` live WebView,
whose `WKAppBoundDomains` requirement bakes the server domain in at build
time.

⚠️ Getting the updater plugin itself into the binary takes one final ordinary
rebuild: `npm install && npx cap sync ios` + build both schemes.

**Connectivity: Tailscale.** The server stays private (LAN/VPN only). Put the
server on your tailnet and run Tailscale on the iPhone; the app reaches the
tailnet hostname from anywhere with no public exposure. The `API_TOKEN` gates
every request.

**⚠️ iCloud Private Relay breaks Siri/Shortcuts/Share (2026-07-16, verified
on-device).** The hostname only resolves through Tailscale's DNS, and iOS
routes DNS for *background/system-initiated* requests — the App Intent run
from Siri/Shortcuts, the Share Extension — through Apple's Private Relay DNS
proxy, which bypasses the tunnel's resolver entirely. Symptom: the intent
fails with **"A server with the specified hostname could not be found"** while
Safari and the app itself reach the same hostname fine on the same phone at
the same moment (foreground app traffic resolves on-host through the tunnel).
Confirmed culprit: **Settings → Apple ID → iCloud → Private Relay** (the
per-network **Limit IP Address Tracking** toggle triggers the same path).
Fixes, either works:
- Turn Private Relay off (or Limit IP Address Tracking off for your networks).
- **Durable:** add a *public* A record for the hostname pointing at the
  server's Tailscale `100.x` IP. Every resolver (including Apple's proxy) then
  returns the right answer; routing still requires the tunnel, and `100.x` is
  unreachable off-tailnet, so nothing is exposed. This survives iOS updates
  and lets Private Relay stay on.

This is a resolver-selection issue in iOS, not fixable from app code — the
intent just calls `URLSession` and iOS picks the DNS path per context.

**Off-tailnet no longer white-screens (2026-07-21).** The shell used to show
a blank screen whenever the server was unreachable — not an asset/caching
failure (the bundle loads from the binary fine) but the boot auth probe in
`src/App.jsx`: a fetch to an unreachable `100.x` host hangs 60+ seconds
instead of rejecting, and the gate rendered `null` the whole time. The probe
now times out at 4s (failing open to the cached UI), skips probing entirely
when offline, and renders a brand-mark splash while pending. Same hang class
as the App Intent's 10s URLSession timeout above.

---

## The standard rebuild (start here every time)

```bash
git checkout main && git pull
npm run ios:prod    # scheme "App"     → Boomerang      (point it at tasks.kfam.in)
npm run ios:dev     # scheme "App Dev" → Boomerang Dev  (point it at tasks-dev.kfam.in)
```

Phone plugged in and unlocked. Each one-liner runs `npm install` → web build →
`cap sync` → `xcodebuild` → install + launch, and **refuses to install** if the
built bundle id doesn't match the scheme (so a scheme mixup can never overwrite
the wrong app).

**Which branch do I build from?** The branch picks the *code*; the scheme picks
the *app flavor*. These are independent:

- **Default: build BOTH apps from `main`.** Boomerang Dev exists so you can
  test against the dev *server and its data* — it does not require the dev
  *branch*. After a promotion, `main` and `dev` are content-identical anyway.
- Build from the **`dev` branch** only when something landed on dev that hasn't
  been promoted yet and you want it on the phone before it ships to prod.

**Am I on the latest build?** Settings → General → **App build** shows
`git describe` of the commit you built from. Compare against the repo:

```bash
git fetch origin --tags
git describe --tags origin/main   # what a fresh main build will stamp (e.g. v2.24.3)
git describe --tags origin/dev    # what a fresh dev build will stamp
```

A clean tag (`v2.24.3`) means the tip is exactly the tagged release;
`v2.24.3-1-g<sha>` means one commit past it — the trailing hash is the commit
that's actually in your binary. The **Server version** row on the same screen
shows what the container is running (client and server versions differ by
design in the native shell — the bundled client never matches the Docker
`APP_VERSION`, which is why the version-mismatch reload is disabled there).

**First build of a new capability** (a new App Group, push entitlement, new
extension target): run it once interactively in Xcode (⌘R) so automatic signing
registers it with Apple — after that the one-liners work headlessly again.

---

## Prerequisites

- A **Mac with Xcode 26+** (Capacitor 8's floor; current betas work). No
  CocoaPods needed — Capacitor 8's iOS template uses Swift Package Manager.
  An **Apple Developer Program** membership (a free Apple ID also works for
  personal sideloads; builds expire after 7 days).
- **Auth enabled on the server** (`AUTH_PASSWORD_HASH` + `API_TOKEN` — see
  `wiki/Security-Notes.md` → Authentication). The app authenticates with
  `API_TOKEN`.
- **Tailscale** on both the server and the iPhone (or another always-reachable
  HTTPS route to the server).

---

## Phase 1 — scaffold (DONE — merged to `dev`)

The scaffold + connection plumbing is in the repo and ready; it is **inert in
production** until a device is configured (below). Already in place:
- `@capacitor/core`, `@capacitor/ios` (deps) + `@capacitor/cli` (dev) in
  `package.json` — **Capacitor 8** (bumped from 6 on 2026-07-15; the v8 iOS
  template is SPM-based, no CocoaPods). `typescript` 5.x is a devDep — the
  Capacitor CLI needs it to parse `capacitor.config.ts`, and TypeScript ≥6
  breaks the CLI's config loader, so don't float it to latest.
- `capacitor.config.ts` (bundled model: `webDir: 'dist'`, no `server.url`).
- `src/apiConfig.js` — runtime connection config + a fetch/EventSource shim that
  prefixes relative `/api` URLs with the configured base and attaches the token.
  **Inert on the web** (nothing configured → installs nothing).
- Server accepts the token via `?api_token=` for the SSE stream (EventSource
  can't set headers); the `Authorization: Bearer` / `x-api-token` header is
  preferred for everything else.
- `npm run build:mobile` = `vite build && cap sync ios`.

### Generate the iOS project (on the Mac)

```sh
npm install
npm run build                 # produce dist/
npx cap add ios               # creates ios/ (SPM-based project, no CocoaPods)
npx cap sync ios              # copies dist/ + plugins into the iOS project
npx cap open ios              # opens Xcode
```

In Xcode: select the **App** target → Signing & Capabilities → pick your Team,
set a unique **Bundle Identifier** (matches `appId` in `capacitor.config.ts`;
change both to your own reverse-DNS id). Run on a simulator first, then your
device.

### Configure the connection (first run)

On first launch in the native shell the app shows the **Connection screen**
(`src/components/ConnectionSetup.jsx`): enter the server URL, paste the
`API_TOKEN`, hit **Test & save**. It verifies `/api/health` (base URL) and
`/api/auth/status` with the token before saving, then reloads into the app.
Change it later via **Settings → Data → Change server…**, from the login
screen's "Change server or API token…" link, or with `?connect=1` on the web
build.

After the reload the shim points all `/api` calls (and the SSE sync stream) at
your server with the token attached. Confirm tasks load + sync works.

> Re-run `npm run build:mobile` after any web change to re-bundle + sync into the
> iOS project.

Fallback: the same two values can still be set manually from Safari Web
Inspector (Develop → your device → the app's WebView console) —
`localStorage.boom_api_base` / `localStorage.boom_api_token` + reload. The
WebView is explicitly marked inspectable via `webContentsDebuggingEnabled:
true` in `capacitor.config.ts`; if Safari says "No Inspectable Applications",
bring the app to the foreground and relaunch Safari with the simulator already
running.

---

## Phase 1.5 — in-app Connection screen (DONE 2026-07-15)

First-run setup screen (server URL + API token, stored via `setApiConfig()` in
`src/apiConfig.js`) — no Web-Inspector step. The interceptor reads config at
startup, so the app reloads the WebView after saving. Note the login screen is
a dead end in the native shell (cross-origin fetches can't carry the session
cookie, so password login only works on the web) — the API token is the native
credential, which is why the login screen links back to the Connection screen.

## Phase 2 — Share Extension (the headline feature)

A native Swift **Share Extension** target so "share a Message/email/page →
**Add to Boomerang**" creates a task. It reads the shared text and POSTs to
`POST /api/intake` with the `API_TOKEN`. Token + base URL are shared with the
main app via an **App Group** (so they're entered once). Source + Xcode wiring
will be added in that PR.

## Phase 3 — App Intents

Swift **App Intents** exposing "Add Boomerang task" to Siri, the Shortcuts app,
Spotlight, the Action button, and Back Tap.

### ⚠️ Voice is gated behind a prompt that tapping never reveals (2026-07-29)

App Shortcuts show up in the **Shortcuts app and run correctly when tapped**
long before Siri will match any of their phrases **by voice**. iOS gates voice
invocation behind a one-time, per-app prompt — *"Turn on 'Boomerang' shortcuts
with Siri?"* — and until it is accepted every spoken phrase falls through to
Apple's own apps. "Add milk to the grocery list" answers with Reminders'
*"I didn't find a 'Grocery' list. Do you want to create one?"*, which reads
exactly like a phrase-matching or registration bug in our code.

It is not. Nothing in the app can detect or trigger this; only the user can
accept it.

Things that look like the cause and are not:

- **Settings → Siri → Apps → Boomerang.** Its three switches — Learn from this
  App, Show on Home Screen, Suggest App — are about suggestions and learning.
  There is **no "Use with Ask Siri" toggle**, so finding all three already on
  proves nothing about voice.
- **Credentials, App Group, keychain, entitlements, tailnet reachability.** A
  *tapped* shortcut returning "Caught it" is a real HTTP 2xx against a gated
  route, which proves the whole chain end to end. If tapping works, stop
  looking at the plumbing.
- **The `\(.applicationName)` rule.** Real, but a separate constraint. Even the
  correct phrasing does nothing while the prompt is unanswered.

A fresh install appears to reset this, and dev builds reinstall on every
deploy — so expect to meet it again rather than treating a recurrence as a
regression.

The diagnosis that actually works: **has the prompt been accepted?** Ask before
inspecting anything else. On 2026-07-29 this cost an evening spent verifying
signed entitlements, App Group parity, keychain access groups, ATS posture and
the orphan filter, all of which were healthy the whole time.

**Upgraded to the real voice-capture path (2026-07-19):** the intent now POSTs
to **`/api/capture`** with `source: "siri"` (instead of `/api/intake`) — so
native captures carry `capture_source` provenance and get the server-side
long-dictation handling (first 500 chars → title, FULL text preserved in
notes; nothing silently truncated). Two reliability fixes shipped with it, both
in `BoomerangIntents.swift`:

- **10s request timeout** — an unreachable tailnet host used to hang Siri for
  the 60s URLSession default before erroring.
- **Offline queue-and-sync (`CaptureQueue`)** — a capture must never be lost.
  On network failure (or a 429) the capture is stored in the App Group
  (`boom_capture_queue`, capped at 50, oldest dropped) and Siri says "saved on
  this device — it'll sync next time." The queue drains oldest-first on the
  next intent run (before the new capture, preserving spoken order) and on
  every app foreground (`sceneDidBecomeActive` in `SceneDelegate.swift`).
  Items are removed only AFTER a successful send — a crash mid-flush re-sends
  (duplicate task, annoying) rather than losing a capture (trust-destroying);
  the same tradeoff means a rare concurrent flush (app opening at the exact
  moment a Siri capture runs) could double-send. A 400 response drops the item
  (permanently bad content must not wedge the queue); 401/403/5xx keep it and
  stop the flush.

Siri phrase constraint (unchanged, platform-level): a free-form String can't
appear in the spoken trigger, so "Add order PETG to Boomerang" in ONE
utterance is impossible — Siri asks "What's the task?" as a follow-up. The
phrase list covers "Add a task to Boomerang", "Boomerang capture", etc. The
HTTP-Shortcut recipe (`wiki/Capture-Shortcut.md`) remains as the fallback and
the reference for the raw endpoint contract.

**Expansion (2026-07-26) — the real action set.** Four new intents join the
capture intent, all authenticated via BoomerangKit (`BoomerangAPI` — device
access token first, legacy fallback, 10s timeouts, never refreshes the pair):

- **`BoomerangTaskEntity`** — the first DYNAMIC entity. Siri resolves "which
  task?" against `GET /api/intents/tasks` (`intentTaskRows` in
  `server/taskModel.js`): title substring search, exact-ids resolution, and a
  suggestion list; actionable states only (committed → boomeranged → open →
  shelved, done/archived never match), capped at 12. Because the entity is
  resolvable, task titles CAN appear in spoken phrases ("Mark ⟨task⟩ done in
  Boomerang") — the free-text constraint above only applies to plain Strings.
- **Complete** — `POST /api/tasks/:id/complete`; idempotent ("was already
  done") and relays server refusals verbatim.
- **Commit** — `POST /api/tasks/:id/commit`; the three-task ceiling 409
  message is read aloud as-is ("Three tasks are already committed…").
- **Snooze** — `POST /api/tasks/:id/shelve` with `snooze_until`; optional
  date parameter, defaulting to tomorrow 05:00 local (lands before rollover +
  digest, so the task is simply back in tomorrow's pool).
- **Today** — reads `GET /api/today`; read-only summary of the committed
  three (with first steps), gently-returned count, and pool size. Works from
  CarPlay/HomePod.

Server errors and unreachable-tailnet failures all resolve to spoken dialogs
(no silent failures); the capture intent keeps its offline queue — the verb
intents deliberately do NOT queue (acting on a stale task state later is
worse than asking again).

## Phase 4 (DONE 2026-07-15 — 4a pipeline + 4b full coverage)

**4a — the pipeline:** `apnsNotifications.js` (server, zero new deps: Node
`http2` + `crypto`, ES256 JWT) + `src/nativePush.js` (client: permission →
APNs register → `POST /api/apns/register`; banner-tap handler routes the
payload `url` into `applyDeepLink()`). Env-only config:
`APNS_KEY_P8` / `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_TOPIC` (default
`ryakel.boomerang.app`; the dev server sets `ryakel.boomerang.app.dev`) /
`APNS_ENV` (`sandbox` default = Xcode sideloads; `production` for
TestFlight/App Store builds). One `.p8` key serves both apps — keys are
team-scoped; the topic selects the app.

**4b — full coverage (how it works):** APNs is a **second delivery leg of the
Push channel**, not a separate engine. `sendPush()` in `pushNotifications.js`
is the single choke point every push notification funnels through — crisis,
escalation, high-priority, overdue, stale, nudges, size-based, pile-up, habit
pace, routine suggestions, the daily digest, package events, Quokka
plan-ready, and the test button. It now sends native APNs first, web push
second, with arbitration:

- Native lands on ≥1 device → **Apple** web-push endpoints (Safari /
  Home-Screen PWA) are skipped, so one phone never gets the same banner
  twice. Desktop Chrome/Firefox endpoints always receive.
- Native sends 0 (unconfigured, no devices, bad key) → full web push runs.
  Native can only reduce duplication, never drop a notification.
- `settings.push_web_alongside_native` (default off; appears in Settings →
  Notifications → Channels once a device is registered) keeps Apple web-push
  endpoints firing — for a PWA on a *different* Apple device (iPad/Mac).

APNs rides the **Push** master toggle, the per-type `push_notif_*` matrix,
and the `push_` throttle keys — no parallel settings. Deep links carry the
same `?task=` URLs, so notification engagement analytics work unchanged.
To go native-only on the phone: register the device (Settings → Notifications
→ Native iOS (APNs) → Enable on this device), then turn the Pushover master
off when you're satisfied.

## Phase 5 — BoomerangKit shared Swift package (2026-07-26)

`ios/App/BoomerangKit/` — a local SPM package (same mechanism as `CapApp-SPM`)
linked by **both** the App and ShareExtension targets, and by any future
extension or watch target. It deliberately has **no Capacitor dependency** so
extension targets can link it bare; the WebView bridge stays in
`App/BoomerangNative.swift`.

What it owns:
- **`BoomerangShared`** — App Group resolution (still via the Info.plist
  `BoomerangAppGroup` key ← `BOOMERANG_APP_GROUP` build setting, never
  hardcoded) + the non-secret base URL in App Group defaults.
- **`BoomKeychain` / `SharedCredentials`** — the shared **Keychain** store
  (access group = the App Group id) for the legacy `API_TOKEN` (auto-migrated
  out of the plaintext App Group defaults on first read) and the auth-Phase-A
  device token pair (mirrored from the WebView). `bestToken` = fresh device
  access token, else legacy token. **Native code never refreshes the pair** —
  see the invariant in `wiki/Auth-Device-Tokens.md`.
- **`AppAttestClient`** — the Phase B native half (challenge → generateKey →
  attestKey → POST `/attest`), runnable from Settings → Data → Devices &
  security → App Attest. `server_pending` (501) is today's expected good
  outcome; details in `wiki/Auth-Device-Tokens.md`.

The WebView additionally gained a **recovery path**: on boot with no config
(localStorage evicted), it restores base/token/device-pair from native storage
before falling back to the Connection screen (`restoreNativeCredentials()`).

**Rebuild note:** this is a native-side change — it needs one ordinary rebuild
of both schemes (`npm run ios:prod` / `ios:dev`). Xcode resolves the local
package automatically; no new capability, so no interactive ⌘R needed. On
first run after the rebuild, the legacy token silently migrates from App Group
defaults into the Keychain.

## Phase 6 — Apple Watch app (2026-07-26)

`ios/App/BoomerangWatch/` — a single-target watchOS app (watchOS 10+, no
separate WatchKit extension) embedded in the iPhone app's bundle, so it
installs with the phone app and needs no separate distribution. One screen:
**today's commitments**, each with its first step and a Done button, plus the
gently-returned count and pool size.

**⚠️ The watch never speaks HTTP — the phone proxies every request.** This is
the central design decision, and it follows from the tailnet: there is no
Tailscale client for watchOS, and traffic the watch tunnels through the paired
iPhone does not carry the phone's VPN routes, so a watch app calling
`tasks.kfam.in` directly could not reach the `100.x` address. Instead the watch
sends a small message over **WatchConnectivity**, the phone calls the API via
BoomerangKit, and replies. Consequences:

- **No credentials on the watch, ever.** App Groups and Keychains are
  per-device, so a direct-HTTP watch app would have needed its own copy of a
  token shipped over the air. This design has nothing to steal.
- The watch works only with the phone in range. That's the normal companion
  tradeoff; the UI says "Phone not reachable" plainly instead of spinning.
- Mutations reply with a **fresh `/api/today` payload**, so the watch redraws
  from server truth rather than guessing locally.

Pieces: `Shared/WatchProtocol.swift` (the message contract — ONE file compiled
into *both* targets so the two sides can't drift), `App/WatchBridge.swift`
(phone-side `WCSessionDelegate`), and the watch's `WatchStore` / `TodayView`.
`SceneDelegate` pushes a snapshot as the application context on foreground so a
wrist-raise has real content immediately. The watch caches the last payload in
its own `UserDefaults` (task titles only) and labels it "showing last synced"
until a fresh fetch lands.

**Activate `WCSession` in `AppDelegate.didFinishLaunchingWithOptions`, never in
`SceneDelegate`.** When the watch calls `sendMessage`, iOS launches the phone
app in the **background** to answer it — and a background launch connects no UI
scene, so `scene(_:willConnectTo:)` never runs. Activation lived there
originally, which meant the phone-side session was inactive for exactly the
launches that existed to serve the watch. The message had nowhere to land and
came back as `WCError.deliveryFailed`, rendered on the wrist as:

> Payload could not be delivered.

The tell that it is this and not a range/pairing problem: `WatchStore.send()`
guards on `session.isReachable` first and would otherwise say "Phone not
reachable". Reachable-but-undeliverable means the phone was there and not
listening. The other tell is that it works fine while the phone app is open in
the foreground — which is the one condition under which the whole proxy design
is pointless.

`didFinishLaunchingWithOptions` runs on every launch, background included.
`WatchBridge.activate()` is idempotent so overlapping launch paths are safe, and
`sessionDidDeactivate` clears the flag before re-activating so watch switching
still re-registers the delegate.

### ⛔ OPEN (2026-07-26): the watch still can't reach the phone

**Status: unresolved, paused mid-diagnosis.** Both flavors' watch apps install,
launch and render on an Apple Watch Ultra 3 (watchOS 26.5). Every request from
the watch fails with **"Payload could not be delivered."** — `WCError`
`deliveryFailed`, surfaced verbatim by `WatchStore.send()`'s error handler. The
activation fix above (`30600ce`) did **not** resolve it.

**Verified correct, do not re-investigate:**

- `Shared/WatchProtocol.swift` is compiled into *both* targets (two `PBXBuildFile`
  entries, one file reference) — the message contract cannot have drifted.
- `WatchBridge.swift` is in the App target's Sources phase.
- Phone side implements `session(_:didReceiveMessage:replyHandler:)`, and every
  path through `handle()` returns a dictionary, so the reply handler always fires.
- The watch's `WKCompanionAppBundleIdentifier` resolves to the right flavor
  (`ryakel.boomerang.app` / `…app.dev`), confirmed in the built bundles.
- The failure is **not** range or pairing: `send()` guards on
  `session.isReachable` first and would say "Phone not reachable" instead.
  Reachable-but-undeliverable means the phone was there and not listening.

**The decisive unanswered question** — it splits the problem in half and every
next step depends on which way it goes:

> With the Boomerang phone app open in the **foreground**, does Refresh on the
> watch work?
>
> - **Works** → the phone side is sound and this really is specific to the
>   background launch, meaning the `AppDelegate` activation is either not in the
>   running binary or is insufficient on its own.
> - **Fails** → the background-launch theory is wrong entirely and the fault is
>   elsewhere. Do not keep building on it.

**Unrun checks, in order:**

1. Is iOS launching the app at all? Force-quit Boomerang, tap Refresh, then
   `xcrun devicectl device info processes --device <iphone-udid> | grep -i boomerang`.
   Absent = iOS is not launching it, which points at companion pairing rather
   than session activation.
2. Is it crashing on background launch? Phone → Settings → Privacy & Security →
   Analytics & Improvements → Analytics Data, look for `Boomerang` entries. A
   crash during background launch fails delivery exactly like this and no session
   code will fix it.
3. Wedged WatchConnectivity pairing state. This watch went through many
   install/uninstall cycles in one day, which is known to wedge it. Rebooting
   both devices is a legitimate reset here, not a shrug — but only after 1 and 2,
   because it destroys the evidence.

**Method note, earned twice in this session.** Two confident theories — "the
paired watch isn't a registered development device" and "the profile must list
watchOS in `Platform`" — were each argued from a plausible mechanism, never
tested against reality, and both were wrong; the second was baked into a doctor
check that then misdirected weeks of work. Measure before asserting, and when a
single cheap observation would split the hypothesis space, get that observation
first.

**Icons** live in `BoomerangWatch/Assets.xcassets` as `AppIcon` / `AppIcon-Dev`
(the dev configs select the latter, mirroring the phone app), generated from the
phone artwork. Two traps, both hit on 2026-07-26:

1. An icon set declared with **no `filename`** builds green and silently ships
   the grey placeholder crosshair — and on watchOS a missing icon is also a
   plausible cause of "App could not be installed at this time" (unlike iOS,
   which tolerates it). A passing build proves nothing here; look on-device.
2. The Xcode-15+ **single `1024x1024` "universal / platform: watchos" entry did
   NOT produce an icon** on Xcode 26 / watchOS 26.5 — still the placeholder
   after a clean rebuild. The set now provides **every size explicitly**
   (`idiom: watch` with `role`/`subtype`: notificationCenter 24/27.5/33,
   companionSettings 29@2x+29@3x, appLauncher 40/44/46/50/51/54, quickLook
   86/98/108/117/129, plus `watch-marketing` 1024), so nothing depends on Xcode
   generating sizes.

3. **`GENERATE_INFOPLIST_FILE = NO`** on this target, so nothing injected
   `CFBundleIconName` for us. Asset-catalog icons are looked up *by name* at
   runtime; with no name in the bundle plist there is nothing to look up and the
   result is — again — the placeholder. The plist now carries
   `CFBundleIconName = $(ASSETCATALOG_COMPILER_APPICON_NAME)`, which resolves
   per-flavor from the one file. (Ruling this out earlier by "the phone app has
   no `CFBundleIconName` either and its icon works" was wrong reasoning: the
   phone target gets the key merged in from actool's generated plist, which only
   helps a target whose asset catalog actually recompiled.)
4. Edits *inside* an `.appiconset` have repeatedly failed to invalidate Xcode's
   asset-catalog task — a rebuild reuses the old `Assets.car` and no
   `CompileAssetCatalog` line appears in the log at all. `scripts/ios-deploy.sh`
   now deletes the previous watch product before building, so the outputs are
   missing and actool is forced to run.

watchOS app icons must also be **opaque** — the Dev source PNG carries an alpha
channel, so it is flattened onto its own plate colour rather than copied across.

### The watch must be in the signing profile

Separate failure, same symptom, and the one that actually blocked installing:
automatic signing gave `BoomerangWatch.app` the **iOS wildcard** profile —

```
CodeSign .../Debug-watchos/BoomerangWatch.app
    Provisioning Profile: "iOS Team Provisioning Profile: *"    (1 devices)
```

The phone app got its own real profile, so `xcodebuild` succeeded,
`ValidateEmbeddedBinary` passed, the phone installed fine, and only the watch
refused, with a bare "App could not be installed at this time".

> **Retracted:** this section used to say the defect was that the profile's
> `Platform` is `[iOS, xrOS, visionOS]` with **no watchOS**. That is not a
> defect — a watch app embedded in an iOS companion is provisioned as part of
> the iOS app family, and that array is correct for it. The real defect is the
> `(1 devices)`: the wildcard covered only the phone. Once the watch was
> registered and the profile carried 2 devices, the **same bundle with the same
> `Platform` array installed on the wrist**. See "What actually gates a watch
> install" below.

Xcode falls back to that wildcard whenever it cannot issue a watchOS profile,
which is the case until the paired Watch is a **registered development device**.
That much was right. The conclusion drawn from it — "fix is on the Mac, not in
the repo" — was wrong, and cost several rounds of Mac-side errands that changed
nothing. Developer Mode was already on and the watch was already registered in
the portal. The repo was what kept the registration from happening; see the
stale-cache trap below.

Read the profile straight out of any built bundle:

```
security cms -D -i <bundle>/embedded.mobileprovision | plutil -p - | grep -A 4 Platform
```

The doctor does this automatically now.

**A watch that `devicectl` can see is not a registered device.** `xcrun devicectl
list devices` showing `available (paired)` only means Developer Mode is on and
the Mac can talk to it. Building the `Watch` / `Watch Dev` scheme against the
watch is what makes Xcode *request* a watchOS profile for it — but that request
fails unless the device is already registered:

```
error: Device "Ryan's Apple Watch" isn't registered in your developer account.
       The device must be registered in order to be included in a provisioning
       profile. (in target 'BoomerangWatch' from project 'App')
```

**`-allowProvisioningUpdates` does not register unknown devices.** It renews
profiles and mints certificates; it will not add a device, and it fails with the
message above instead. Register the UDID by hand at
[developer.apple.com/account/resources/devices/list](https://developer.apple.com/account/resources/devices/list)
under platform **watchOS** — a separate device class from iOS, so a watch filed
under iOS does not count. The giveaway that this was outstanding: the wildcard
profile reported **1 devices**, the phone.

Developer Mode on the wrist is necessary and not sufficient. Those are two
independent facts, they fail identically, and conflating them cost this
investigation several rounds.

### What actually gates a watch install

**Device coverage, not platform.** watchOS refuses a development-signed app
whose embedded profile does not list that watch in `ProvisionedDevices`. That
is the whole rule, and it is what the doctor now checks. Read it straight out
of any bundle:

```
security cms -D -i <bundle>/embedded.mobileprovision \
  | plutil -extract ProvisionedDevices json -o - -
```

The transition, same project, same Platform array, nothing else changed:

```
before registration:  iOS Team Provisioning Profile: *                        (1 devices)
after  registration:  iOS Team Provisioning Profile: ...dev.watchkitapp       (2 devices)
```

and the "after" bundle installed:

```
$ xcrun devicectl device install app --device 00008310-... \
    ios/build/Build/Products/Debug-Dev-iphoneos/App.app/Watch/BoomerangWatch.app
App installed:
• bundleID: ryakel.boomerang.app.dev.watchkitapp
```

(A first attempt returned `Failed to allocate RSD device
(com.apple.mobiledevice error -402653181)` — a transient tunnel error, not a
signing problem. Retry before investigating it.)

**The doctor's old `platform WRONG` check was a fabrication** and is the reason
this took as long as it did. It asserted watchOS had to appear in the profile's
`Platform`, was never once tested against a real install, failed every build for
weeks, and sent several rounds of work at satisfying a condition that did not
exist. Every other check in that script came from a real observed failure. This
one came from a guess. When adding a check, verify the thing it asserts actually
breaks an install first.

**`ios-deploy.sh` handles the whole watch side itself** — there is no separate
command to remember. Each run: builds the watch app (it is already a target
dependency), checks the bundle, and if the check fails while a physical watch is
visible, registers the watch, rebuilds once so the phone app embeds the
re-signed watch app, re-checks, and finally installs the watch app on the watch
directly. Registration is harmless when it was not the problem — it only builds
a target that was going to build anyway. The watch install is best-effort:
failing it never fails the run, since the phone app is already on by then and a
watch-side refusal is not a build problem.

`npm run ios:watch-register [config]` remains as a standalone escape hatch, and
`scripts/find-watch.sh` holds the device-selection rules so `ios-deploy.sh` and
`watch-register.sh` cannot drift apart on which watch they mean.

### `devicectl list devices` lies about Developer Mode

This is the root cause of everything above, and it took every other theory being
disproven by measurement before it turned up. The two commands disagree about
the same watch, at the same moment:

```
$ xcrun devicectl list devices          # cached record
watchOS  physical  disabled   Ryan's Apple Watch  30B4B8C9-...

$ xcrun devicectl device info details --device 30B4B8C9-...   # live query
• Developer Mode Status: Enabled (1)
```

`find-watch.sh` filtered on the cached `deviceProperties.developerModeStatus`,
so it returned an empty string. Everything downstream is guarded by
`[ -n "$WATCH_ID" ]`, so the register-and-rebuild branch silently never ran, the
watch was never used as a build destination, it never registered with the
account, no watchOS profile was ever issued, and signing stayed on the iOS
wildcard permanently. A green build, a passing `ValidateEmbeddedBinary`, and a
watch that refuses to install — all from one stale boolean.

**Never gate anything on the listing's copy of device state.** Enumerate with
`list devices`, confirm with a live `device info details` per candidate. Reject
only on an explicit live `Disabled`; a watch that gives no answer (asleep, off
the network) is returned anyway so the caller fails with a real error from
xcodebuild instead of vanishing.

**Two ids per device, and they are not interchangeable.** devicectl reports
`identifier` (a GUID, `30B4B8C9-…`) and `hardwareProperties.udid` (the real one,
`00008310-001605683C40E01E`). devicectl accepts either; `xcodebuild -destination
"id=…"` matches **only the UDID**, and `watch-register.sh` passes this script's
output straight to xcodebuild. An earlier comment in `find-watch.sh` claimed
watch UDIDs are plain UUIDs and the iPhone finder's hardware-UDID shape "does
not transfer" — a real Apple Watch Ultra 3 reports the same `00008310-…` shape
as the iPhone.

And the UDID is **not in the listing** for a watch — `list devices` populates
`hardwareProperties.udid` for the iPhone but leaves it empty for the watch,
which is exactly what makes "just read it from the JSON like the iPhone finder
does" look correct and fail silently. It appears only in the live response:

```
$ xcrun devicectl device info details --device 30B4B8C9-...
    • UDID: 00008310-001605683C40E01E
```

So `identifier` is the *query key* and the UDID is the *answer*: enumerate with
the listing, query live, return what the live response says.

Also worth knowing when reading profiles by hand: Xcode 16+ moved them out of
`~/Library/MobileDevice/Provisioning Profiles`. Prefer reading
`embedded.mobileprovision` out of the built bundle, which is what the doctor
does and what is actually signed.

The two watch schemes exist for exactly this reason — without a scheme whose
buildable is `BoomerangWatch.app`, nothing in the project can target the watch
as a destination, so the device can never register and automatic signing is
stuck on the iOS wildcard forever.

### Measure the bundle, not the build log

Every one of the traps above ends in BUILD SUCCEEDED and collapses into one of
two on-wrist symptoms — placeholder crosshair, or "App could not be installed at
this time" — which is why several fixes were shipped off log-reading and
screenshots and every one of them was wrong.
`npm run ios:watch-doctor [config]` (`scripts/watch-icon-doctor.sh`) inspects
the built bundle instead: bundle id, companion id, the embedded provisioning
profile's **name, platform list and device count**, `CFBundleIconName`,
`Assets.car` presence and size, and — via `assetutil --info` — whether the named
icon is genuinely compiled in. It checks both the standalone watch product and
the copy embedded at `App.app/Watch/`, since the embed phase will happily ship a
stale standalone product. `ios-deploy.sh` runs it after each build and warns
loudly (non-fatally — the phone app is still worth installing) when the watch
app has no usable icon.

Note for future artwork work: watchOS masks app icons to a **circle**, so
anything near the corners is clipped. The prod glyph clears the inscribed
circle; the Dev badge's full-width banner does not, and its ends are cut.

**Rebuild note:** this adds a NEW target, so the first build is the one case
where the one-liners may not be enough — see "First build of a new capability"
above. `buildImplicitDependencies` is on in both schemes, so `npm run ios:prod`
/ `ios:dev` build and embed the watch app automatically; if automatic signing
balks at the new `…watchkitapp` bundle id, run once interactively in Xcode
(⌘R) to register it, then the one-liners work headlessly again. The watch app
appears in the Watch app on the phone under Available Apps.

---

## Phase 7 — location-triggered tasks (📋 REQUESTED 2026-07-29)

**The ask.** "I have a task I need to do first thing when I get home. When I get
home, the app should detect that and notify me." The pattern exists in Reminders
and Things.

**Only the native shell can do this.** There is no usable web equivalent — the
PWA cannot monitor regions in the background. So this is an iOS-only capability
in a product whose feature set has otherwise stayed platform-neutral, and it
needs **Always** location authorization, which is the heaviest permission the app
would ask for. Worth being deliberate about: it is a real privacy ask for a
convenience feature.

### The constraint that shapes the whole design

iOS caps an app at **20 monitored regions**. Attaching a geofence per *task*
hits that wall immediately and then needs a prioritisation scheme nobody can
reason about — "why didn't it remind me?" becomes unanswerable.

So don't geofence tasks. **Geofence places.** A small `places` table (Home,
Work, the hardware store) with lat/lon/radius; tasks reference a place. You then
monitor ~5 regions regardless of how many tasks exist, and on entry the app asks
"what's waiting at this place?" That collapses the cap problem entirely and
matches how the request is actually phrased — "when I get home", not "when I get
to this one specific coordinate for this one task".

It also makes the common edit sane: move house once, not across forty tasks.

### Decisions to settle before code

- **Arrival is not an event, it is a routine.** You get home most days, often
  several times. A naive fire-on-entry means the same nudge every single
  evening until the task is done — which is precisely the alert fatigue the
  2026-07-24 Great Alert Deletion existed to end. Needs at minimum
  once-per-arrival-per-day, and probably "only when the task is actually live"
  (due, committed, or explicitly flagged for that place).
- **This is a LOCAL notification, not a server send.** iOS fires it on-device
  via `UNLocationNotificationTrigger` or the region-enter delegate — it never
  touches `pushNotifications.js`, so `notifsMuzzled` and the digest pipeline do
  not apply. That is a genuine architectural exception to "every send goes
  through the stack" and should be called out rather than discovered later.
  The *spirit* of the one-digest rule still binds: this has to earn its ping.
- **Quiet hours still apply**, and the app has to enforce them itself, because
  the OS won't.
- **Who owns the geofence set?** The server holds the truth; the phone syncs
  down the active regions. A task completed on the laptop must stop firing on
  the phone, which means the sync is part of the feature, not an afterthought.
- **Precise vs coarse.** iOS lets the user grant reduced accuracy. Home-sized
  geofences need precise location; the feature has to degrade honestly rather
  than silently never firing.

### Where it touches what exists

There is currently **no places concept anywhere** — the only coordinates in the
system are `weather_latitude` / `weather_longitude`, a single pair in settings.
So this is greenfield: new table, new native code, new permission flow, and a
new sync path. Not a small feature.

Nearest existing relatives are the `inside` / `outside` context tags and
`energy: 'errand'`, which already express "where does this happen" in a coarse,
manual way. Worth deciding whether places supersede or complement those before
building both.

### Away mode — the dangerous half (📋 REQUESTED 2026-07-29)

**The ask.** Detect being away from home and stop home tasks from nagging —
"if I leave the state, anything that is a home task should shut up while I'm
gone." Possibly also defer them by moving due dates. The owner flagged this as
needing more design because it could be trouble; that instinct is correct, and
this section exists to say exactly *which* trouble.

#### The failure that matters

**A false "away" silences your life, and silence is unfalsifiable.** If
detection misfires — phone off, Always authorization downgraded to When In Use,
reduced accuracy granted, a region event simply not delivered (which iOS does) —
the app goes quiet about everything home-shaped, and from the inside that is
**indistinguishable from having nothing due**. You would not notice for days.

This is the same failure shape as `last_sync_error` and the share-sheet list
fetch: an absent signal must never be silently rendered as a negative state.
Whatever ships, the digest has to *say* "12 home tasks suppressed — you're
away", never just show a short list. A suppression you can't see is a bug that
looks like a quiet week.

The inverse matters too: **exit and entry are not equally reliable.** If
returning home fails to clear the state, you stay muted at home, which is the
same catastrophe with a different trigger.

#### Never auto-change due dates for this

Suppression is reversible and leaves the data untouched. Rewriting due dates is
destructive: it mutates recorded intent on a *guess about your location*, and
per the data-durability invariant the original is gone unless provenance is
stamped at the moment of the change. A misfire that silently rewrites forty
dates is not recoverable by turning the feature off.

If bulk deferral is wanted, it belongs as an **explicit action on return** —
"you were away 6 days; move 12 overdue home tasks to this week?" — where a human
confirms once and the change is attributable. Location proposes; it never
disposes.

#### The design that defuses it: a mode, not a location rule

Do **not** wire geofences directly to notification suppression. Make the
primitive an explicit, server-side, platform-neutral **mode** (`away`), and let
location be one thing that can *propose* it:

- The mode is visible, manually settable, and manually clearable. A failed
  geofence then degrades to "set it yourself" rather than "the feature is
  broken."
- It generalises beyond location — travel, a sick day, a hospital stay all want
  the same suppression without a coordinate anywhere near them.
- It gives the whole feature an off switch that doesn't require revoking a
  location permission.
- The web app keeps working, since the mode isn't iOS-only even though one of
  its triggers is.

Automatic entry should **suggest, not act**: "Looks like you're away — mute home
tasks?" One confirmation converts a risky inference into a cheap, attributable
decision. For an ADHD tool this matters more than usual — the product only works
if it is trusted, and an app that silently reshuffles your commitments based on
a guess spends that trust faster than it earns it.

#### Scale, which the naive version gets wrong

A home-radius geofence reports "not at home" the moment you leave for milk.
That is not *away*. Distinguishing "out for an hour" from "out of state for a
week" needs distance **and** duration thresholds, and those are exactly the
knobs that will be wrong for the first several months. Another argument for
suggest-then-confirm over silent action.

#### What it must not break

- `isNotifiable()` remains the single opt-in gate. Away mode is a *further*
  suppression on top, never a second parallel gate.
- The escalation ladder must pause rather than continue accruing while
  suppressed, or you come home to a fully escalated backlog for tasks you had
  no way to do.
- Crisis-class notifications must ignore the mode entirely.

## Notes

- **No Dockerfile / server-build impact.** `apiConfig.js` ships in the Vite
  bundle; `capacitor.config.ts` + `ios/` are dev/Mac-only. The server's runtime
  `COPY` list is unchanged. The web/PWA build is byte-for-byte unaffected (the
  interceptor is inert with no config).
- **`ios/` is committed to the repo** (since 2026-07-15). It carries two
  iOS-26/27-SDK fixes Capacitor 8's stock template lacks: the **UIScene
  lifecycle migration (TN3187)** — `SceneDelegate.swift` + the
  `UIApplicationSceneManifest` in `Info.plist` — without which the SDK refuses
  to launch the app (`EXC_BREAKPOINT` at startup), and
  **`BoomerangViewController.swift`** (the storyboard's root VC) which zeroes
  the auto-populated `obscuredContentInsets` so the layout viewport isn't
  shrunk by the safe areas (the app's CSS owns that via `env()`, same as the
  PWA). Do NOT regenerate with `npx cap add ios` — that resurrects the broken
  template; `npx cap sync ios` is the normal refresh path. Build output and synced assets (`public/`,
  `capacitor.config.json`, Pods/build/DerivedData/xcuserdata) stay gitignored.
  Signing (Team + bundle id) is per-Mac state in the pbxproj — set it once in
  Xcode after the first pull.
- **Token handling.** The `API_TOKEN` lives in `localStorage` (and, in Phase 2,
  an App Group / Keychain) on the device — not in the repo or the app bundle.
  Rotate it by re-running `scripts/auth-setup.js` and updating the device.
