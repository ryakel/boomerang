# TestFlight + Xcode Cloud — the "no more Mac builds" plan

Goal: merge to `main` → Apple's cloud builds, signs, and ships the app to the
phone via TestFlight. The Mac leaves the loop entirely (after one final setup
session). Xcode Cloud's free tier (25 compute-hours/month) covers this many
times over; cloud-managed signing means no certificates to export or renew.

**Division of labor:** Phase 0 is repo work Claude does from a session. Phases
1–5 are Apple-UI + one-Mac-session work only the account holder can do.

---

## Phase 0 — repo prep (DONE 2026-07-16)

All landed:

1. **`ios/App/ci_scripts/ci_post_clone.sh`** — installs Node via Homebrew if
   missing, then `npm ci && npm run build && npx cap sync ios` from
   `CI_PRIMARY_REPOSITORY_PATH`, and stamps `CI_BUILD_NUMBER` into the project
   via `agvtool new-version -all` so every cloud build uploads with a fresh
   build number. Local builds keep the static value (the agvtool step only
   runs when `CI_BUILD_NUMBER` is set).
2. **Entitlements split** — `App.Release.entitlements`
   (`aps-environment: production`) wired to `CODE_SIGN_ENTITLEMENTS` in the
   App target's `Release` + `Release-Dev` configs only (verified per-block);
   Debug sideloads keep sandbox via the original `App.entitlements`.
3. **`ITSAppUsesNonExemptEncryption = false`** in Info.plist — no manual
   export-compliance questionnaire per build.
4. Everything validated: plists parse (dev=development, release=production),
   pbxproj parses via mod-pbxproj, script `sh -n` clean.

## Phase 1 — App Store Connect app record (you, ~5 min)

- appstoreconnect.apple.com → My Apps → **+ New App**: platform iOS, name
  "Boomerang" (or a variant if the name is taken — TestFlight-only, so the
  public name barely matters), bundle id **`ryakel.boomerang.app`** (already
  registered to team `L7JZ99D6K5` from the first ⌘R), any SKU, language.
- No screenshots/description needed for internal TestFlight — that's only for
  App Store review.

## Phase 2 — connect the repo (you, ~5 min)

- App Store Connect → Xcode Cloud (or Xcode → Report Navigator → Cloud) →
  grant the **Xcode Cloud GitHub app** access to `ryakel/boomerang`.

## Phase 3 — create the workflow (you, the ONE Mac session, ~20 min)

- Xcode → Product → Xcode Cloud → **Create Workflow**:
  - Scheme **App**, configuration Release
  - Start condition: **branch changes on `main`**
  - Action: **Archive — iOS**
  - Post-action: **TestFlight Internal Testing** distribution
- First run will prompt to create cloud signing assets — accept. App Groups
  (`group.ryakel.boomerang`) is already registered on the App ID, so the
  cloud-managed profile picks it up.
- Watch the first build's logs: the likely first-run failure is the
  `ci_post_clone.sh` Node install (fixable from a Claude session — paste the
  log).

## Phase 4 — server APNs environment flip (you, ~2 min, AFTER Phase 5 works)

- TestFlight builds receive **production** APNs tokens; the prod container
  must send to `api.push.apple.com`: set **`APNS_ENV=production`** on the
  PROD container only.
- ⚠️ **Sequencing matters:** the moment prod flips to `production`, the old
  Xcode-sideloaded prod app (sandbox tokens) stops receiving pushes — its
  stale tokens fail `BadDeviceToken` and get auto-pruned. So: install the
  TestFlight build FIRST, tap "Enable on this device" in it, then flip the
  env and Send test.
- The DEV container stays `sandbox` — Boomerang Dev remains an Xcode-sideload
  test harness (its whole job is trying unpromoted work, which TestFlight
  can't do anyway).

## Phase 5 — TestFlight on the phone (you, ~5 min)

- App Store Connect → Users → make sure your Apple ID is on the team →
  TestFlight → Internal Testing group → add yourself.
- Install the **TestFlight app** on the phone → accept the invite → install
  Boomerang from TestFlight. It replaces the sideloaded prod app (same bundle
  id; app data + connection config survive the swap).

---

## Steady state

- Merge/promote to `main` → Xcode Cloud builds → TestFlight notifies the
  phone → update in two taps. No Mac.
- TestFlight builds expire after **90 days**; any push to `main` resets the
  clock — a non-issue at this repo's cadence.
- **Boomerang Dev stays a local sideload** (`npm run ios:dev`) — it exists to
  test unpromoted/dev-server work, which is inherently a Mac loop. If it ever
  wants TestFlight too: its own app record (`ryakel.boomerang.app.dev`) + a
  workflow on `dev`, and `APNS_ENV=production` on the dev container.

## Known risks / gotchas

- **Mixed APNs environments** are the classic trap — see Phase 4 sequencing.
  Symptom of getting it wrong: `Send test` reports sent but nothing arrives,
  server logs show `BadDeviceToken`.
- Xcode Cloud runner images update Xcode versions on Apple's schedule; a
  major-Xcode bump can need a `LastUpgradeVersion`/setting nudge (same class
  of thing as local Xcode upgrades).
- The App Store Connect app record requires the 1024 icon (already in the
  asset catalog) — nothing else for internal testing.
