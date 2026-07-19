# iOS Shortcut — "Add to Boomerang"

Create a task in Boomerang from anywhere on iOS: the **share sheet** (select a
Message, an email, a webpage, highlighted text → Share → *Add to Boomerang*),
**Siri** ("Hey Siri, Add to Boomerang"), the **Action button**, or the Home
Screen. No native app required — the Shortcut talks to the `POST /api/intake`
endpoint over HTTPS.

> For hands-free **voice capture** (dictate a thought via Siri from phone,
> Watch, or CarPlay), see the sibling recipe: [Capture-Shortcut](Capture-Shortcut.md).
> It targets the dedicated `POST /api/capture` endpoint, which stamps the
> task's provenance (`capture_source`) and is rate-limited.

## Prerequisites

1. Boomerang reachable over **HTTPS** at a stable URL (e.g. `https://boomerang.example.com`).
2. **Auth enabled** with an API token. On the server:
   ```sh
   node scripts/auth-setup.js
   ```
   Copy the printed `API_TOKEN` and set it (plus `AUTH_PASSWORD_HASH`) in your
   host's environment, then redeploy. See `.env.example` → *Authentication*.

> The Shortcut authenticates with the **API token**, not your password. Treat the
> token like a password — anyone holding it can create tasks. Rotate it by
> re-running `auth-setup.js` and updating the env var + the Shortcut.

## The endpoint

```
POST https://YOUR_HOST/api/intake
Authorization: Bearer YOUR_API_TOKEN
Content-Type: application/json

{ "title": "text of the task", "notes": "optional", "high_priority": false }
```

`title` (or `text`) is required; everything else is optional. The server fills
in id / status / timestamps and flags the task for background AI sizing/energy
inference. Optional fields: `notes`, `due_date` (`"YYYY-MM-DD"`),
`high_priority` (bool), `tags` (array of label ids).

## Build it in the Shortcuts app

1. Open **Shortcuts** → **+** (new shortcut) → name it **Add to Boomerang**.
2. Tap the **(i)** info button → enable **Show in Share Sheet**. Under *Share
   Sheet Types* leave **Text** and **URLs** on (turn the rest off if you like).
   This is what makes it appear when you share a Message/email/webpage.
3. Add action **Get Contents of URL**:
   - **URL:** `https://YOUR_HOST/api/intake`
   - **Method:** `POST`
   - **Headers** (add two):
     - `Authorization` → `Bearer YOUR_API_TOKEN`
     - `Content-Type` → `application/json`
   - **Request Body:** `JSON`
     - `title` (Text) → set to the **Shortcut Input** variable (the shared text).
       Tip: wrap it as `Shortcut Input` so a shared Message body becomes the title.
     - (optional) `high_priority` (Boolean) → `false`
4. (Optional) Add a **Show Notification** action after it with text "Caught it ✓"
   for confirmation.
5. Done. Test by running it once (it'll use clipboard/empty input), then from a
   Message: long-press a bubble → **Share** → **Add to Boomerang**.

### Wiring it to Siri / Action button

- **Siri:** the shortcut name *is* the phrase — "Hey Siri, Add to Boomerang".
- **Action button** (iPhone 15 Pro+): Settings → Action Button → Shortcut →
  *Add to Boomerang*.
- **Back Tap:** Settings → Accessibility → Touch → Back Tap → Double Tap →
  *Add to Boomerang*.

## "Type a quick task" variant

For a shortcut that prompts you for text instead of taking shared input, insert
an **Ask for Input** (Text) action first and feed *Provided Input* into the
`title` field instead of *Shortcut Input*.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 Authentication required` | Missing/wrong `Authorization` header. Must be `Bearer <API_TOKEN>` exactly, and `API_TOKEN` must be set on the server. |
| `400 title (or text) is required` | The JSON `title` field is empty — check the variable feeding it. |
| Nothing happens from share sheet | "Show in Share Sheet" not enabled, or the shared type (e.g. an image) isn't Text/URL. |
| Works on Wi-Fi, not cellular | Host isn't publicly reachable / not on HTTPS. The endpoint must be internet-facing (or use a VPN/Tailscale that's always on). |
