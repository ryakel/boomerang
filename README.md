# Boomerang

A personal ADHD task manager that won't let things disappear. Tasks always come back.

## Quick Start

```bash
docker run -d -p 3001:3001 -v boomerang-data:/data ghcr.io/ryakel/boomerang:main
```

Open `http://localhost:3001` and add your API keys in Settings.

## Features

- Persistent nagging — snooze requires "then when", reframe after too many snoozes
- AI-powered task suggestions, note polishing, date inference, and reframing
- Recurring tasks (routines) with automatic scheduling
- Notion integration — link or create pages for tasks
- Trello integration — bidirectional sync with AI-inferred list mapping and auto-dedup
- iMessage-style swipe gestures — swipe left for Edit/Done, swipe right to delete
- Custom labels, due dates, extension system
- Real-time cross-client sync via Server-Sent Events (SSE)
- Dark mode toggle, mobile-first PWA — installable to home screen
- iOS-style toggle switches for all on/off settings

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

All frequencies are set in hours (supports fractional values, e.g. `0.25` = 15 minutes).

- **Quiet hours** — configurable DND window with start/end times
- **Notification history** — last 200 notifications stored in localStorage
- **Throttle persistence** — timestamps persist in localStorage across reloads (no duplicate notifications on refresh)
- **Test notification button** in settings for verifying setup

### iOS / PWA

- Full-square PNG icons (180, 192, 512) for proper iOS home screen display
- `apple-touch-icon.png` included
- Installable as a PWA on all platforms

### Infrastructure

- Version check on every view/modal navigation (hits `/api/health`)
- Docker multi-stage build with QEMU-safe arm64 support
- `sharp` used as a devDependency for icon generation

## Configuration

API keys can be set via environment variables or in the UI Settings:

```bash
docker run -d -p 3001:3001 \
  -v boomerang-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e NOTION_INTEGRATION_TOKEN=ntn_... \
  -e TRELLO_API_KEY=your_api_key \
  -e TRELLO_SECRET=your_trello_token \
  ghcr.io/ryakel/boomerang:main
```

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
