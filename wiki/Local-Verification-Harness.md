# Local Verification Harness (run + screenshot the app in a session)

How to spin up a real Boomerang server **inside a Claude Code session** and drive
it headlessly to verify UI changes — render before claiming a surface works. This
is the exact workflow used to build/QA the Wallaby reskin. Every step here has a
non-obvious trap; read the **Gotchas** at the end before improvising.

> TL;DR: build with a **matching `APP_VERSION`**, launch the server **seeded** in
> the background, then drive it with **puppeteer run from the repo root**, loading
> with `domcontentloaded` and clicking via `page.evaluate` (not `elementHandle`).

---

## 1. Build (version MUST match the server)

Vite bakes `__APP_VERSION__` from `process.env.APP_VERSION || 'dev'` (see
`vite.config.js`). The client compares its baked version to `/api/health`'s
`appVersion` and, on mismatch, throws up a full-screen **update overlay**
(`.v2-update-overlay`) that intercepts every click — so a plain `npm run build`
(which bakes `'dev'`) against a git-versioned server will silently block all
interaction in the headless browser.

Always build and launch with the **same** version:

```bash
VER=$(git describe --tags --always)
APP_VERSION=$VER npm run build
```

The static server serves `dist/` on every request, so after a rebuild you do
**not** need to restart the server for client-only changes — but the version
must still match (rebuild with the same `$VER`).

## 2. Launch a seeded server in the background

`SEED_DB=1` wipes + loads realistic ADHD test data (`seed.js`). It uses a static
fallback when no `ANTHROPIC_API_KEY` is set, so it works offline. `makeSeedCurrent()`
rebases dates to today, so heatmaps / Today's Pulse / Analytics have recent data.

```bash
VER=$(git describe --tags --always)
rm -f boomerang.db boomerang.db.*          # start clean
APP_VERSION=$VER SEED_DB=1 DB_PATH=./boomerang.db PORT=3001 node server.js > /tmp/qaserver.log 2>&1
```

Launch it with the Bash tool's **`run_in_background: true`** (NOT a trailing `&`
in a normal call — backgrounding with `&`/`pkill` trips exit code 144 in this
harness). Then poll for readiness:

```bash
for i in $(seq 1 15); do curl -fsS http://localhost:3001/api/health >/dev/null 2>&1 && { echo "ready ${i}s"; break; }; sleep 1; done
curl -fsS http://localhost:3001/api/health    # confirm {"appVersion": "<VER>", ...}
```

(The background task may report "completed" once the launching shell returns —
the node process keeps listening. Confirm with the health curl, not the task
status.)

## 3. Force a specific theme / UI version (client-side)

Settings live server-side, and `seed.js` doesn't set a `theme`, so the app boots
in the default skin. The robust way to preview a specific theme (e.g. Wallaby) is
to inject a **complete** settings blob into `localStorage` with a far-future
modified timestamp so local settings win over server hydration. Fetch the real
settings first so you don't drop defaults:

```js
await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded' })
await page.evaluate(async () => {
  const d = await fetch('/api/data').then(r => r.json())
  localStorage.setItem('boom_settings_v1', JSON.stringify({ ...(d.settings || {}), theme: 'wallaby-dark' }))
  localStorage.setItem('boom_last_modified', String(Date.now() + 1e7)) // local newer than server
  localStorage.setItem('ui_version', 'v2')
})
await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded' }) // reload with settings applied
```

Keys (from `src/store.js`): `boom_settings_v1`, `boom_last_modified`,
`ui_version`. Themes: `wallaby-dark` / `wallaby-light` / `terminal-dark` /
`terminal-light` / `dark` / (default light). Verify it took with
`document.documentElement.getAttribute('data-theme')`.

## 4. Drive it with puppeteer

Puppeteer is already in `node_modules` (installed `--no-save`). **Run the script
from the repo root** (`node _scratch.mjs` in `/home/user/boomerang`) so the
`import puppeteer` resolves — a script in `/tmp` cannot find the package.

```js
import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }) // iPhoneish
// ...theme injection from step 3...
await page.waitForSelector('.wb-shell', { timeout: 15000 }) // wait for a known root, not networkidle
await new Promise(r => setTimeout(r, 1500))                 // let lazy fetches resolve
await page.screenshot({ path: '/tmp/shot.png' })
await browser.close()
```

Then **Read** the PNG to actually look at it. Conventions that matter:

- **`waitUntil: 'domcontentloaded'`**, never `networkidle0` — the app holds an
  SSE connection open, so the network never goes idle and `networkidle0` times
  out.
- **Click via `page.evaluate`, not `elementHandle.click()`** — the bottom nav and
  FABs are `position: fixed`; puppeteer's coordinate-based click mis-fires on
  fixed elements and silently no-ops. Use in-page `.click()`:
  ```js
  const navTab = i => page.evaluate(i => document.querySelectorAll('.wb-nav-tab')[i]?.click(), i)
  const clickText = (sel, t) => page.evaluate((sel, t) =>
    [...document.querySelectorAll(sel)].find(e => e.textContent.toLowerCase().includes(t.toLowerCase()))?.click(), sel, t)
  ```
- **Capture errors** so a "looks fine" screenshot doesn't hide a console blow-up:
  ```js
  const errs = []
  page.on('pageerror', e => errs.push(['pageerror', e.message]))
  page.on('console', m => m.type() === 'error' && errs.push(['console', m.text()]))
  page.on('response', r => r.url().startsWith('http://localhost') && r.status() >= 400 && errs.push(['http'+r.status(), r.url()]))
  ```

### Diagnosing layering / click-through bugs

`document.elementFromPoint(x, y)` tells you what's actually on top at a pixel —
invaluable for "taps leak behind the modal" bugs. Walk up to a meaningful class:

```js
await page.evaluate(() => [40,250,600,835].map(y => {
  let n = document.elementFromPoint(195, y), m = ''
  while (n && n !== document.body) { const c = (n.className?.toString?.()||'')
    const hit = c.split(/\s+/).find(x => /^wb-|^v2-modal/.test(x)); if (hit){m=hit;break} n=n.parentElement }
  return `${y}: ${m}`
}))
```

## 5. Clean up

```bash
rm -f boomerang.db boomerang.db.*    # don't commit the seed DB
rm -f /home/user/boomerang/_*.mjs    # scratch scripts (keep them out of git)
```

Stop the background server via the task controls (or just let the container
reclaim it). `pkill -f "node server.js"` works but returns exit 144 in this
harness — harmless, the process does die.

---

## Gotchas (each one cost a debugging loop)

| Symptom | Cause | Fix |
|---|---|---|
| Every click hits `.v2-update-overlay`; nothing works | Client baked `'dev'`, server reports a git version → version-mismatch update modal | Build with `APP_VERSION=$(git describe --tags --always)` matching the server launch |
| `networkidle0` navigation times out | App keeps an SSE connection open | `waitUntil: 'domcontentloaded'` + `waitForSelector` |
| Nav/FAB clicks do nothing | `elementHandle.click()` mis-handles `position: fixed` | Click in-page via `page.evaluate(... .click())` |
| `Cannot find package 'puppeteer'` | Script in `/tmp` | Run from `/home/user/boomerang` |
| `POST /api/messages 400` in console | No `ANTHROPIC_API_KEY` (toast/AI inference path) | Expected/benign in a keyless sandbox — not a bug |
| Empty heatmaps / Today's Pulse | Stale seed dates | `makeSeedCurrent()` already rebases to today; just reseed (`SEED_DB=1` or `POST /api/dev/seed`) |
| `env(safe-area-inset-*)` reads as 0 | Headless Chromium has no notch | Insets are 0 in the harness; test inset-dependent layout by temporarily hardcoding a value if needed |
| Background launch returns exit 144 | `&`/`pkill` under the Bash tool | Use Bash `run_in_background: true`; ignore the 144 on kill |
| Theme won't switch | Server settings override local on hydration | Inject full `boom_settings_v1` + far-future `boom_last_modified` (step 3) |

## Dev-only reseed (running dev container, not this harness)

On a deployed dev environment (`boomerang-dev:3002`): `POST /api/dev/seed` wipes +
reloads, or use **Settings → Data → "Reseed dev database"** (dev-gated; the
endpoint 403s and the button hides outside dev — `isDevEnv` in `server.js`).

## Related

- `wallaby-preview.html` + `src/wallaby-preview.jsx` — a lighter, dev-only render
  harness that mounts a single Wallaby view in isolation with mock data (not
  imported by `index.html`, never ships).
- The `run` / `verify` skills cover the general "launch and confirm a change"
  pattern; this page is the Boomerang-specific runbook with the traps spelled out.
