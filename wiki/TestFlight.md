# Shipping Boomerang to TestFlight (Capacitor iOS wrap)

Boomerang is a server-backed PWA. To get it onto TestFlight we wrap the web
app in a native iOS shell with [Capacitor](https://capacitorjs.com). Capacitor
8.x is already added as a dev dependency, and `capacitor.config.json` lives at
the repo root. The native `ios/` project is **generated on a Mac** — it can't
be created in the Linux CI container — so the steps below run on your machine.

---

## How the native app reaches the backend (the one architectural decision)

Boomerang's frontend talks to its own Express backend (same origin: `/api/*`
plus the `/api/events` SSE stream). Two ways to wire the native app:

### Option A — load the hosted prod URL (the scaffolded default) ✅

`capacitor.config.json` sets `server.url` to your production domain. The
WebView loads the live app exactly as Safari would, so `/api` + SSE + auth all
"just work" with zero CORS and the app is always in sync with prod.

- **Pro:** simplest, nothing to keep in sync, SSE works out of the box.
- **Con:** needs network (no offline shell — fine for Boomerang, whose state
  lives server-side anyway), and a pure-webview wrapper can draw Apple
  Guideline **4.2 (minimum functionality)** scrutiny on *public* App Store
  review. For **TestFlight** (you + invited testers) this is not a blocker.

**This is the recommended path for getting to TestFlight fast.** Edit
`capacitor.config.json` → set `server.url` to your prod domain (the same value
as the `public_app_url` setting), keep `cleartext: false` (HTTPS).

### Option B — bundle the web assets + absolute API base

Ship `dist/` inside the app (`webDir: dist`, remove the `server.url` block) and
point the frontend's API calls at an absolute prod base URL. More robust for a
public App Store release, but it requires an absolute API base (the frontend
currently uses relative `/api`) + server CORS for the `capacitor://localhost`
origin. Defer this until/unless you go for public release.

---

## Prerequisites (one-time)

- A **Mac** with **Xcode** (latest) + Command Line Tools.
- **CocoaPods**: `sudo gem install cocoapods` (or `brew install cocoapods`).
- A paid **Apple Developer Program** membership ($99/yr).
- In [App Store Connect](https://appstoreconnect.apple.com): you'll create an
  app record with the bundle ID below.

---

## Bundle identifier + app name

Set in `capacitor.config.json`:

```json
{
  "appId": "com.ryakel.boomerang",   // ← must be unique + registered to your Apple Dev account
  "appName": "Boomerang",
  "webDir": "dist",
  "server": { "url": "https://YOUR-PROD-DOMAIN", "cleartext": false }
}
```

`appId` is your reverse-DNS bundle identifier. Change it to whatever you
register in the Apple Developer portal (Certificates, IDs & Profiles →
Identifiers). It must match the bundle ID in Xcode and in App Store Connect.

---

## First-time setup (on the Mac)

```bash
# 1. Get the branch + install deps
git checkout claude/terminal-theme-ui-rewrite-RAHyM   # (or wherever this lands)
npm install

# 2. Set capacitor.config.json: appId + server.url (your prod domain). Save.

# 3. Build the web bundle Capacitor copies in
npm run build

# 4. Generate the native iOS project (one time). Runs `pod install`.
npx cap add ios

# 5. (Optional but recommended) generate iOS icons + splash from a 1024px source
#    Put a 1024×1024 PNG at assets/icon.png first.
npx @capacitor/assets generate --ios

# 6. Open the project in Xcode
npm run ios:open
```

## In Xcode

1. Select the **App** target → **Signing & Capabilities**:
   - Check **Automatically manage signing**, pick your **Team**.
   - Confirm **Bundle Identifier** matches `appId`.
2. **General → Identity:** set **Version** (e.g. `0.12.0`) and **Build** (e.g. `1`).
   Bump **Build** on every upload.
3. **Deployment Info:** set a Minimum Deployments target (iOS 16.4+ is a safe
   floor — matches the PWA's web-push baseline).
4. Verify the **AppIcon** asset is populated (step 5 above fills it).
5. The header already pads for the status bar via `env(safe-area-inset-top)`,
   so no extra safe-area work is needed.

## Archive + upload to TestFlight

1. In Xcode, set the run destination to **Any iOS Device (arm64)**.
2. **Product → Archive**. When the Organizer opens, select the archive →
   **Distribute App → App Store Connect → Upload**.
3. In **App Store Connect → your app → TestFlight**: the build appears after
   processing. Fill in **Test Information**, then add internal/external testers
   (external testers need a short Beta App Review).

## Re-deploying after web changes

Because Option A loads the live site, **most updates need no new build** — push
to prod and the WebView picks them up. You only re-archive when you change
native config (icons, capabilities, bundle ID) or bump the native version.

```bash
npm run ios:sync   # vite build && cap sync ios  (copies config + assets)
npm run ios:open   # then archive in Xcode
```

---

## iOS gotchas specific to Boomerang

- **Web push won't get native APNs** inside a WKWebView wrapper. Per
  `CLAUDE.md`, the reliable iOS push path is **Pushover** — make sure Pushover
  credentials are configured (Settings → Pushover) for notifications on device.
- **SSE** (`/api/events`) works natively in WKWebView over HTTPS — no change.
- **App Transport Security:** loading an HTTPS prod URL is ATS-compliant out of
  the box. Only if you ever point at plain HTTP do you need `cleartext: true` +
  an Info.plist exception.
- **Deep links** (`/?task=…`, `/?adviser=…`) work since the WebView loads your
  origin; for universal links into the app you'd add an Associated Domains
  capability later (not required for TestFlight).
