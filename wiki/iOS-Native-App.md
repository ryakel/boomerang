# iOS Native App (Capacitor)

Boomerang's native iOS app wraps the existing React/Vite web app in a
[Capacitor](https://capacitorjs.com/) shell and adds native iOS surfaces — a
**Share Extension** (create a task from a shared Message/email/page), **App
Intents** (Siri / Shortcuts / Action button), and a Home Screen presence — while
keeping a single codebase.

**Model: bundled assets.** The app ships the Vite build (`dist/`) inside the
binary and talks to your server's API over the network. It does **not** load the
UI live from the server, so the PWA's offline behavior (mutation queue + cached
shell) is preserved. The API base URL + token are configured **at runtime** —
never baked into the bundle.

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
Spotlight, the Action button, and Back Tap — same `/api/intake` target.

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
