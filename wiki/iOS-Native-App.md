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
(phone-side `WCSessionDelegate`; activated in `SceneDelegate`, which also
pushes a snapshot as the application context on foreground so a wrist-raise has
real content immediately), and the watch's `WatchStore` / `TodayView`. The
watch caches the last payload in its own `UserDefaults` (task titles only) and
labels it "showing last synced" until a fresh fetch lands.

**Icons** live in `BoomerangWatch/Assets.xcassets` as `AppIcon` / `AppIcon-Dev`
(the dev configs select the latter, mirroring the phone app), generated from the
phone artwork at 1024×1024. watchOS app icons must be **opaque** — the Dev
source PNG carries an alpha channel, so it is flattened onto its own plate
colour rather than copied straight across. A watch icon set declared with no
`filename` builds fine and silently ships the grey placeholder crosshair, so
verify on-device rather than trusting a green build (2026-07-26).

**Rebuild note:** this adds a NEW target, so the first build is the one case
where the one-liners may not be enough — see "First build of a new capability"
above. `buildImplicitDependencies` is on in both schemes, so `npm run ios:prod`
/ `ios:dev` build and embed the watch app automatically; if automatic signing
balks at the new `…watchkitapp` bundle id, run once interactively in Xcode
(⌘R) to register it, then the one-liners work headlessly again. The watch app
appears in the Watch app on the phone under Available Apps.

---

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
