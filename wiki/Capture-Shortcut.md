# Voice Capture — "Hey Siri, Boomerang Capture"

Get a thought out of your head and into Boomerang hands-free: **"Hey Siri,
Boomerang Capture"** → dictate a phrase → the task appears in Boomerang within
seconds. Works from iPhone, Apple Watch, and CarPlay because it's Siri-invoked
and needs no app UI. No native app required — the Shortcut talks to the
`POST /api/capture` endpoint over HTTPS.

Capture is deliberately dumb: no project, no due date, no priority — capture is
not triage. The background auto-sizer refines size/energy afterward like every
other create path, and the task carries `capture_source: "siri"` so future
surfaces (e.g. a digest) can call out voice-captured items.

> Looking for the share-sheet shortcut ("select text → Share → Add to
> Boomerang")? That's the sibling recipe in [iOS-Shortcut](iOS-Shortcut.md),
> which targets `/api/intake`. This page is the dictation-first variant.

## Prerequisites

1. Boomerang reachable over **HTTPS** at a stable URL (or via an always-on
   VPN/Tailscale).
2. **Auth enabled** with an API token. On the server:
   ```sh
   node scripts/auth-setup.js
   ```
   Copy the printed `API_TOKEN` and set it (plus `AUTH_PASSWORD_HASH`) in your
   host's environment, then redeploy. See `.env.example` → *Authentication*.

> The Shortcut authenticates with the **API token**, not your password. Treat
> the token like a password. Rotate it by re-running `auth-setup.js` and
> updating the env var + the Shortcut. The route is rate-limited (30/min) so a
> leaked token can't become a spam cannon, and auth failures are logged
> server-side.

## The endpoint

```
POST https://YOUR_HOST/api/capture
Authorization: Bearer YOUR_API_TOKEN
Content-Type: application/json

{ "text": "order more PETG", "source": "siri" }
```

- `text` (required) — the dictated phrase. Trimmed; empty → `400`; capped at
  2,000 chars. Long dictation keeps the first 500 chars as the title and
  preserves the full text in the task's notes — nothing is silently lost.
- `source` (optional) — provenance tag, e.g. `siri` | `shortcut` | `manual`.
  Defaults to `api`. Stored on the task as `capture_source`.

Responses: `201` with the created task, `400` on empty text, `401` on a
missing/bad token, `429` when rate-limited. If the server can't create the
task you get a `5xx` and the Shortcut shows an error — captures are never
silently dropped.

## Build it in the Shortcuts app (~2 minutes)

1. Open **Shortcuts** → **+** (new shortcut) → name it **Boomerang Capture**.
   The name *is* the Siri phrase.
2. Add action **Dictate Text** — language English, *Stop Listening:* **After
   Pause**.
3. Add action **Get Contents of URL**:
   - **URL:** `https://YOUR_HOST/api/capture`
   - **Method:** `POST`
   - **Headers** (add two):
     - `Authorization` → `Bearer YOUR_API_TOKEN`
     - `Content-Type` → `application/json`
   - **Request Body:** `JSON`
     - `text` (Text) → the **Dictated Text** variable
     - `source` (Text) → `siri`
4. (Recommended) Add **Show Notification** — "Captured: *Dictated Text*".
   Confirmation matters; silent success feels like failure.
5. Tap the **(i)** info button → make sure **Show on Apple Watch** is on.
6. Test: **"Hey Siri, Boomerang Capture"** → speak → check the Boomerang inbox.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 Authentication required` | Missing/wrong `Authorization` header. Must be `Bearer <API_TOKEN>` exactly, and `API_TOKEN` must be set on the server. |
| `400 text is required` | Dictation came back empty — check the `text` field is bound to the Dictated Text variable. |
| `429` | More than 30 captures in a minute — wait and retry. |
| Works on Wi-Fi, not cellular/CarPlay | Host isn't publicly reachable / not on HTTPS. Use an internet-facing host or an always-on VPN (Tailscale). |
| Siri doesn't recognize the phrase | The shortcut name is the phrase — rename collisions with other shortcuts/apps break invocation. |

## Phase 2 (later, not built)

A native **App Intent** in the iOS app already covers the one-utterance path
("Add Boomerang task" via Siri — see [iOS-Native-App](iOS-Native-App.md)).
Remaining Phase-2 work is tracked in
[UPCOMING_FEATURES](UPCOMING_FEATURES.md): parameterized capture phrases and
an offline queue-and-sync when the server is unreachable. The HTTP endpoint
stays the API surface either way.
