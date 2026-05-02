# Boomerang

A personal ADHD task manager that won't let things disappear. Tasks always come back.

## Quick Start

```bash
docker run -d -p 3001:3001 -v boomerang-data:/data ghcr.io/ryakel/boomerang:latest
```

Open `http://localhost:3001` and add your API keys in Settings.

## Features

- **Persistent nagging** — snooze requires "then when", reframe after too many snoozes
- **AI-powered assistance** — task suggestions, note polishing, date inference, reframing, and "What Now?" task picker
- **Energy/capacity tagging** — AI-inferred energy type (desk, people, errand, creative, physical) and drain level (1-3) on every task, tap-to-cycle override
- **AI toast messages** — pre-generated contextual one-liners on task complete/reopen, speed-aware
- **Recurring tasks** (routines) with automatic scheduling and AI-suggested due dates
- **Checklists** — multiple named checklists per task with drag-and-drop reordering
- **File attachments** — attach files to tasks, auto-included in AI research queries
- **Notion integration** — pull sync from parent page, ongoing bidirectional sync for linked tasks
- **Trello integration** — push tasks with native checklists and attachments, ongoing bidirectional sync
- **Google Calendar integration** — bidirectional sync with AI-inferred event times, OAuth 2.0
- **Package tracking** — track packages with auto carrier detection, status-colored cards, delivery/exception notifications, signature-required auto-task creation
- **Pushover integration** — reliable iOS notifications via the Pushover app's APNs entitlements, with priority-2 (Emergency) for the highest-stakes alarms (bypasses Do Not Disturb, repeats every 30s)
- **Offline support** — mutation queue with auto-replay on reconnect, sync status indicator
- **Real-time sync** — cross-client sync via Server-Sent Events (SSE)
- **Desktop UI** — kanban board with drag-and-drop, responsive modals, hover states
- **Mobile-first PWA** — installable to home screen, swipe gestures (left for Edit/Done, right to delete)
- **Dark mode**, custom labels, due dates, high-priority escalation

### Notifications

Configurable notification types with ADHD-friendly defaults:

| Type | Description | Default frequency |
|------|-------------|-------------------|
| High priority | Escalating reminders — before due (24h), on due date (1h), overdue (0.5h) | 3-stage escalation |
| Overdue | Alerts for past-due tasks | configurable (hours) |
| Stale | Nudges for tasks that haven't been touched | configurable (hours) |
| Nudges | General ADHD-friendly pokes | configurable (hours) |
| Size-based | Reminders scaled by task size | configurable (hours) |
| Pile-up warnings | Alerts when too many tasks accumulate | configurable (hours) |

All frequencies are set in hours (supports fractional values, e.g. `0.25` = 15 minutes). Quiet hours, notification history, and avoidance boost (confrontation/errand tasks get nagged more frequently) included.

Three transports run independently: web push (browser/PWA), email (SMTP), and Pushover (iOS APNs via the Pushover app). Pushover adds priority-2 (Emergency) for stage-3 high-priority overdue and avoidance-flagged overdue tasks — repeats every 30 seconds for up to 1 hour and bypasses Do Not Disturb / silent mode. Setup: create a Pushover account, buy the iOS app ($5 one-time), paste User Key + App Token in Settings → Pushover.

## Configuration

API keys can be set via environment variables or in the UI Settings:

```bash
docker run -d -p 3001:3001 \
  -v boomerang-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e NOTION_INTEGRATION_TOKEN=ntn_... \
  -e TRELLO_API_KEY=your_api_key \
  -e TRELLO_SECRET=your_trello_token \
  -e TRACKING_API_KEY=your_17track_key \
  -e PUSHOVER_DEFAULT_APP_TOKEN=your_pushover_app_token \
  ghcr.io/ryakel/boomerang:latest
```

`PUSHOVER_DEFAULT_APP_TOKEN` is optional — it provides a default app token so you don't have to paste it in the UI for every install. Per-user keys are always entered in the Settings UI.

## Tech Stack

- **Frontend:** React 19, Vite, PWA (vite-plugin-pwa)
- **Backend:** Express, SQLite (sql.js), SSE
- **AI:** Anthropic Claude API
- **Integrations:** Notion API, Trello API, Google Calendar API, 17track API
- **Deployment:** Docker (multi-arch: amd64/arm64), GitHub Actions CI/CD, GHCR

See the [wiki](https://github.com/ryakel/boomerang/wiki) for full documentation.

## Development

```bash
npm install
cp .env.example .env
node server.js &
npm run dev
```

## License

MIT
