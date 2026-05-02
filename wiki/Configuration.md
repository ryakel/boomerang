# Configuration

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` (prod) / `3002` (dev) | Server port |
| `DB_PATH` | No | `./boomerang.db` (local) or `/data/boomerang.db` (Docker) | SQLite database file path |
| `ANTHROPIC_API_KEY` | No | — | Default Claude API key for AI features (users can override in UI) |
| `NOTION_INTEGRATION_TOKEN` | No | — | Default Notion integration token (users can override in UI) |
| `TRELLO_API_KEY` | No | — | Trello API key for card sync (users can override in UI) |
| `TRELLO_SECRET` | No | — | Trello API token for card sync — despite the name, this is the **token** from the authorize URL, NOT the "Secret" from the Trello admin page (users can override in UI) |
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth Client ID for Calendar sync (users can add in UI) |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth Client Secret for Calendar sync (users can add in UI) |
| `TRACKING_API_KEY` | No | — | 17track API key for package tracking (users can add in UI). Free tier: 100 queries/day. Get key at [api.17track.net](https://api.17track.net) |
| `PUSHOVER_DEFAULT_APP_TOKEN` | No | — | Pushover application token used as fallback if not set in Settings UI. Per-user keys are still required. Get a token at [pushover.net](https://pushover.net). |
| `PUBLIC_APP_URL` | No | — | Public URL where Boomerang is reachable (e.g. `https://boomerang.example.com`). Used to build deep-link URLs in notifications so tapping opens the relevant task. Without this, notifications still send but aren't tappable. |
| `APP_VERSION` | No | `dev` | Version string injected at build time (used if git tags are unavailable) |
| `SEED_DB` | No | `0` | Set to `1` to wipe and seed the database on startup with realistic test data. Uses Claude API if `ANTHROPIC_API_KEY` is set, otherwise falls back to static `scripts/seed-data.json`. Only exposed in `docker-compose.dev.yml`. |

**None are required.** The app starts and works fully without API keys. AI features (Polish, What Now, Reframe, date inference, size inference, smart nudges) are disabled without an Anthropic key. Notion features are disabled without a Notion token.

The server also reads from a `.env` file if present, supporting both `ANTHROPIC_API_KEY` and `VITE_ANTHROPIC_API_KEY` (legacy) formats.

## API Key Priority

For each request, the server resolves keys in this order:

1. **User-provided key** (sent via `x-anthropic-key` or `x-notion-token` request header from the UI)
2. **Environment variable** (`ANTHROPIC_API_KEY` or `NOTION_INTEGRATION_TOKEN`)

If neither is set, AI and Notion API calls return a 400 with a descriptive error message. The rest of the app continues to function normally.

When an environment variable is set, the Settings UI shows a "Set by environment variable" status message instead of the input field, since the env var is already providing the key. This applies to Anthropic, Notion, and Trello credentials.

## Settings (in-app)

All settings are accessible via the gear icon in the header:

### API Keys
- **Anthropic API key** — for AI features. Stored in localStorage, sent as `x-anthropic-key` header. Hidden when env var is set.
- **Notion integration token** — for Notion features. Stored in localStorage, sent as `x-notion-token` header. Hidden when env var is set.
- **Trello API key + token** — for Trello card sync. Stored in localStorage, sent as `x-trello-key` and `x-trello-token` headers. Hidden when env vars are set. After entering credentials, click Connect to select a board and list.
- **Google Calendar Client ID + Secret** — for Google Calendar sync. Stored in localStorage, sent as `x-google-client-id` and `x-google-client-secret` headers. Hidden when env vars are set. After entering credentials, click Connect to complete OAuth flow and select a calendar.

### AI Custom Instructions
- Free-text field that shapes all AI output (Polish, What Now, Reframe, smart nudges)
- Import from `.md` or `.txt` file
- Export to `.md` file
- Clear button when instructions are set

### Task Behavior
- **Default due date** — days from now for new tasks (default: 7, set to 0 to disable)
- **Staleness threshold** — days before a task is marked stale (default: 2, range: 1-30)
- **Reframe trigger** — snooze count before reframe is required instead of snooze (default: 3, range: 1-20)

### Display
- **Task count display** — controls the header task count format:
  - **Open only** — just the non-snoozed open count
  - **Active** — fraction of non-snoozed open / (open + backlog)
  - **All** — fraction of non-snoozed open / (open + done)

### Labels
- Create custom labels with names and colors (10 color options)
- Delete existing labels
- Default labels: inside (blue), outside (green), follow-up (orange)

### Notifications
- Enable/disable browser push notifications
- Check frequency: 15m, 30m, 1h, 2h (default: 30m)
- Toggles for: overdue tasks, stale tasks, general nudges
- Stale task percentage threshold — configurable percentage at which a warning notification fires

### Pushover (reliable iOS notifications)
- Solves the iOS Safari web-push throttling problem — Pushover has a dedicated iOS app with full APNs entitlements
- **Setup:** create account at [pushover.net](https://pushover.net), buy the iOS app ($5 one-time), copy the User Key, create an Application named "Boomerang" and copy the API Token, paste both in Settings → Pushover
- **Priority levels:**
  - 0 (normal) — nudges, stale, size, pile-up, high-priority Stage 1 (before due) — honors quiet hours
  - 1 (high) — generic overdue, high-priority Stage 2 (on due day) — bypasses quiet hours, plays an alert sound
  - 2 (Emergency) — high-priority Stage 3 (overdue), avoidance + Stage 3 — repeats every 30 seconds for up to 1 hour, bypasses Do Not Disturb
- **Receipt cancellation:** Emergency alarms automatically stop when you resolve the task (complete, snooze forward, move due date forward, delete, reframe). Pushover stops retrying at the 1-hour mark even without explicit cancel.
- **Per-type toggles:** high priority, overdue, stale, nudges, size, pile-up, package delivered, package exception
- **Test buttons:** "Test Pushover" (priority 0) and "Test Emergency" (priority 2 with 90-second auto-cancel) — to validate the channel without waiting for a real trigger
- **Optional env fallback:** `PUSHOVER_DEFAULT_APP_TOKEN` lets you skip the App Token field for everyone using this self-hosted instance; User Key is still per-user

## Email Deliverability

Digest emails to your inbox (not spam) require sender authentication. The default From address falls back to your SMTP_USER which often gets flagged.

**Best practice:**
1. **Use a domain you control.** Generic relay defaults (`@sendgrid.net`, personal `@gmail.com`, etc.) frequently hit spam.
2. **Configure SPF, DKIM, and DMARC** for the sending domain on your SMTP relay.
3. **Set the From name and address** in Settings → Email Notifications → From address. Settings UI override beats env var beats SMTP user.
4. **Test with [mail-tester.com](https://mail-tester.com)** — score 9+/10 if SPF/DKIM/DMARC are correctly set up.
5. **Avoid `noreply@` addresses** — providers increasingly downrank these.

**Recommended providers** that make custom-domain auth easy:
- [Postmark](https://postmarkapp.com), [Resend](https://resend.com), [Mailgun](https://www.mailgun.com), [AWS SES](https://aws.amazon.com/ses/)

### Data
- **Export** — download JSON backup of all tasks, routines, settings, and labels
- **Import** — upload a JSON backup to restore data

### Activity Rings and Goals
- **Daily task goal** — number of tasks to complete per day for the Tasks ring (default: configurable)
- **Daily points goal** — point target per day for the Points ring (default: configurable)
- **Vacation mode** — freeze your streak with a duration picker (3, 5, 7 days, or custom). Auto-expires when the end date passes.
- **Free day** — pause streak for a single day without entering vacation mode

### Danger Zone
- **Clear completed tasks** — removes all done tasks
- **Reset streaks** — clears all streak and analytics data (requires double confirmation)
- **Clear all data** — deletes all tasks, routines, settings, labels, and history (requires confirmation)
