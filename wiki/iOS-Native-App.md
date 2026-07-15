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

Until the in-app Connection settings screen lands (Phase 1.5), set the two keys
from Safari Web Inspector (Develop → your device → the app's WebView console),
or temporarily hardcode for testing. (The WebView is explicitly marked
inspectable via `webContentsDebuggingEnabled: true` in `capacitor.config.ts` —
required for this step; if Safari says "No Inspectable Applications", bring the
app to the foreground and relaunch Safari with the simulator already running.)

```js
localStorage.setItem('boom_api_base', 'https://YOUR-HOST.tailnet.ts.net')
localStorage.setItem('boom_api_token', 'YOUR_API_TOKEN')
location.reload()
```

After reload the shim points all `/api` calls (and the SSE sync stream) at your
server with the token attached. Confirm tasks load + sync works.

> Re-run `npm run build:mobile` after any web change to re-bundle + sync into the
> iOS project.

---

## Phase 1.5 — in-app Connection screen (next)

A small first-run setup screen (server URL + API token, stored via
`setApiConfig()` in `src/apiConfig.js`) so there's no Web-Inspector step. The
interceptor reads config at startup, so the app reloads the WebView after the
token is saved.

## Phase 2 — Share Extension (the headline feature)

A native Swift **Share Extension** target so "share a Message/email/page →
**Add to Boomerang**" creates a task. It reads the shared text and POSTs to
`POST /api/intake` with the `API_TOKEN`. Token + base URL are shared with the
main app via an **App Group** (so they're entered once). Source + Xcode wiring
will be added in that PR.

## Phase 3 — App Intents

Swift **App Intents** exposing "Add Boomerang task" to Siri, the Shortcuts app,
Spotlight, the Action button, and Back Tap — same `/api/intake` target.

## Phase 4 (optional, later)

- Native **APNs push** via a Capacitor push plugin (more reliable than web push
  in a WKWebView). Until then, keep Pushover / web push.
- Deep links (`boomerang://task/<id>`) for notification taps.

---

## Notes

- **No Dockerfile / server-build impact.** `apiConfig.js` ships in the Vite
  bundle; `capacitor.config.ts` + `ios/` are dev/Mac-only. The server's runtime
  `COPY` list is unchanged. The web/PWA build is byte-for-byte unaffected (the
  interceptor is inert with no config).
- **`ios/` is generated on the Mac.** Pods and the synced `public/` assets are
  gitignored; commit the rest of `ios/App` if you want the native project under
  version control.
- **Token handling.** The `API_TOKEN` lives in `localStorage` (and, in Phase 2,
  an App Group / Keychain) on the device — not in the repo or the app bundle.
  Rotate it by re-running `scripts/auth-setup.js` and updating the device.
