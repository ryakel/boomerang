# Auth Phases A/B — Per-Device Tokens & Device Attestation

**Status:** Phase A built (2026-07-25, shipped v2.38.0). Phase B native half built (2026-07-26, BoomerangKit); server-side verification still an honest 501 stub pending an on-device test vector.
**Sequence context:** step 3 of: ~~task model~~ → ~~digest reshape~~ → **auth A/B** → ~~shared Swift package~~ → App Intents → watch UI.

## Why

Today every machine credential is ONE static `API_TOKEN` — the iPhone app, a future watch app, and any Shortcut all present the same long-lived secret. That means: no per-device revocation (rotating the token logs out every device), no theft detection (a copied token is indistinguishable from the real device), and nothing for the watch/App-Intents work to build on. The digest reshape's allowed-loud list already reserved a slot for exactly this: **auth security alerts (refresh-reuse, attest failures) are the one category allowed to be loud.**

Threat model stays honest to Security-Notes.md: single-user, self-hosted, usually tailnet-only. Phase A is not enterprise IAM — it is per-device revocation + stolen-refresh detection with ~200 lines of dependency-free crypto, opt-in-by-use, and zero behavior change for existing setups.

## Phase A — per-device rotating token pairs (BUILT)

### Model

Each device enrolls once and receives a **token pair**:

- **Access token** — `bda_<deviceId>.<secret>`, TTL 1 hour. Presented exactly like the legacy token (`Authorization: Bearer`, `x-api-token`, or `?api_token=` for SSE). The embedded device id makes verification an O(1) lookup, not a registry scan.
- **Refresh token** — `bdr_<deviceId>.<secret>`, single-use, rotating. `POST /api/auth/device/refresh` exchanges it for a fresh pair and invalidates it.

Only **SHA-256 hashes** of secrets are stored server-side (`app_data.auth_devices` carve-out — never the synced settings blob). All comparisons are timing-safe.

### Refresh rotation + reuse detection (the security core)

Every refresh rotates the pair and remembers the hash of the token it replaced. If a **superseded** refresh token is ever presented again, that is the classic stolen-token signature — the legitimate device already rotated past it, so a second presenter means two holders of the secret:

1. The device is **revoked immediately** (`revoked_reason: 'refresh_reuse'`).
2. A **security alert** fires via push + email (`sendSecurityAlertPush`/`Email` — the allowed-loud category; still dev-muzzled like every background send).
3. The response is a plain 401 — the attacker learns nothing beyond "invalid".

A revoked device's access and refresh tokens are dead; the device re-enrolls with the bootstrap credential if it was a false positive.

### Endpoints

| Endpoint | Gate | Purpose |
|---|---|---|
| `POST /api/auth/device/enroll` | gated (session cookie, legacy `API_TOKEN`, or an existing device token) | `{name?, platform?}` → `{device_id, access_token, refresh_token, access_expires}` |
| `POST /api/auth/device/refresh` | **open** (the access token is expired by definition when you need this) — rate-limited 20/min | `{refresh_token}` → new pair. Reuse → revoke + alert + 401. |
| `GET /api/auth/devices` | gated | Registry for the Settings UI (name, platform, created, last_seen, revoked; secrets never returned) |
| `POST /api/auth/device/revoke` | gated | `{device_id}` → immediate revocation |

### Compatibility

- The **legacy static `API_TOKEN` keeps working unchanged** — it is the bootstrap credential (first enrollment authenticates with it) and the fallback if device tokens are cleared. Retiring it later is just unsetting the env var once every device is enrolled.
- Everything is inert until `AUTH_PASSWORD`/`AUTH_PASSWORD_HASH` is set, same as the rest of the gate.
- Web/PWA (same-origin, session cookie) is untouched.

### Client (native shell)

`src/apiConfig.js`:
- New storage: `boom_device_id/access/refresh/expires` (alongside the legacy `boom_api_token`).
- The fetch interceptor now reads credentials **per call** (the old one captured the token once at install — a rotated token would never be picked up). Prefers the device access token; proactively refreshes when <5 min from expiry; on a 401 does one single-flight refresh and retries once. If the refresh itself 401s (revoked/reused), device tokens are cleared and the legacy token takes over — or the Connection screen surfaces if there is none.
- SSE gets the current access token per connection (reconnects pick up rotations).
- `ConnectionSetup` auto-enrolls after a successful save (names the device from the platform).

Settings → Data → **Devices & security**: the device registry with per-device Revoke and a this-device marker (plus the native-only App Attest check, below).

### Native storage — BoomerangKit (2026-07-26)

`ios/App/BoomerangKit` is a local Swift package linked by the App and ShareExtension targets (and any future extension/watch target). It owns all native credential access:

- **Base URL** → App Group `UserDefaults` (not a secret; unchanged location).
- **Legacy `API_TOKEN`** → shared **Keychain** (`kSecAttrAccessGroup` = the App Group id, `AfterFirstUnlock`). First read migrates the token out of the plaintext App Group defaults where pre-BoomerangKit builds mirrored it, and scrubs the old copy.
- **Device token pair** → shared Keychain, mirrored by the WebView (`BoomerangNative.setDeviceTokens`) on every enroll/rotate. The mirror also serves as **recovery**: if the WebView's evictable localStorage loses the config, boot restores it from native storage (`restoreNativeCredentials()` in `src/apiConfig.js`) instead of stranding the user on the Connection screen.

**INVARIANT — native surfaces never refresh the pair.** The refresh token is single-use; the WebView owns rotation. If an extension refreshed concurrently, the app's stored token would become superseded and the app's next refresh would trip reuse detection *on ourselves* (auto-revoke + loud alert). `SharedCredentials.bestToken` therefore uses the mirrored access token only while it's fresh (60s slack) and falls back to the legacy token — it never calls `/api/auth/device/refresh`.

### Acceptance (verified live)

- Enroll via legacy token → access token passes the gate; expired/garbage tokens 401.
- Refresh rotates; the OLD refresh token replayed → 401 + device revoked + security alert logged; the device's still-valid-looking access token is now rejected.
- Revoke endpoint kills a device immediately; registry lists honest state.
- Legacy token unaffected throughout; gate-off deployments see zero change.
- Unit suite (`scripts/deviceauth.test.mjs`): rotation, reuse, expiry, revocation, hashed-at-rest.

## Phase B — Apple App Attest device binding (SPEC — needs Mac/device session)

**Goal:** enrollment (and optionally high-value calls) proves the request comes from the genuine Boomerang app on genuine Apple hardware, not just something holding a token.

1. **Enrollment attestation.** The native app generates an App Attest key (`DCAppAttestService.generateKey`), the server issues a one-time challenge (`POST /api/auth/device/challenge`), the app calls `attestKey` over `SHA256(challenge)`, and sends the attestation object with its enrollment. The server verifies: CBOR-decode → certificate chain to the **Apple App Attest root CA** (pinned) → nonce == SHA256(authData ‖ clientDataHash) → App ID (`<teamId>.ryakel.boomerang.app`) matches → counter/aaguid sanity (`appattestdevelop`/`appattest`). Store `{key_id, public_key, counter}` on the device record.
2. **Assertions (optional hardening).** Refresh calls can carry `generateAssertion` output over the request body; the server verifies signature + monotonic counter. Counter regression = cloned key → revoke + alert.
3. **Failure = loud.** A failed attestation or assertion fires the same security-alert path as refresh reuse.
4. **Enforcement flag.** `AUTH_REQUIRE_ATTEST=1` makes enrollment refuse un-attested devices (default off — Shortcuts and the web can't attest; they stay on password/legacy-token paths).

**Native half (BUILT 2026-07-26, `BoomerangKit/AppAttestClient.swift`):** the full client flow is implemented — fetch challenge → `generateKey` (persisted in the shared Keychain, cleared if `attestKey` poisons it) → `attestKey` over `SHA256(challenge)` → POST `/api/auth/device/attest` with `{key_id, challenge, attestation, device_id}`. Run it from Settings → Data → Devices & security → **App Attest → Run check** (native shell only). Outcome mapping is honest: `server_pending` (HTTP 501) is today's expected good result — it proves the native side works end-to-end on real hardware and produces the test vector the server verifier needs; `verified` is reserved for an actual 2xx once Phase B server verification exists.

**Why the server verifier is still not built:** verification requires parsing Apple's CBOR attestation format and validating against Apple's cert chain — until a real device has produced a valid test vector (see Run check above), *unverifiable security code is worse than absent security code*. `/api/auth/device/challenge` issues real challenges; `/api/auth/device/attest` returns 501 with this doc referenced.

## Known limitations

- **Native-side secrets now live in the shared Keychain** (BoomerangKit). Inside the WebView, tokens still transit localStorage as the synchronous runtime cache — moving the WebView fully onto async Keychain reads is future work; the Keychain mirror already covers durability (storage eviction) and extension access.
- One user — device identity is for revocation and theft detection, not multi-tenancy.
- Refresh reuse detection covers the immediately-superseded token (the standard rotation scheme); a token stolen and used *before* the legitimate device ever refreshes is indistinguishable until the next rotation collides.
