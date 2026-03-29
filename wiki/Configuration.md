# Configuration

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Server port |
| `DB_PATH` | No | `/data/boomerang.db` | SQLite database file path |
| `ANTHROPIC_API_KEY` | No | — | Default Claude API key (users can override in UI) |
| `NOTION_INTEGRATION_TOKEN` | No | — | Default Notion token (users can override in UI) |

None are strictly required — the app starts without API keys and users can add their own in Settings.

## API Key Priority

For each request, the server resolves keys in this order:

1. **User-provided key** (sent via request header from UI Settings)
2. **Environment variable** (set on the server/container)

If neither is set, AI and Notion features return a helpful error message.

## Settings (in-app)

All settings are accessible via the gear icon in the header:

- **API Keys** — Anthropic and Notion keys (stored locally, sent as headers)
- **AI Custom Instructions** — shapes all AI output (import/export as .md)
- **Staleness threshold** — days before a task is marked stale (default: 2)
- **Reframe trigger** — snooze count before reframe is required (default: 3)
- **Labels** — custom labels with color picker
- **Notifications** — enable/disable, frequency, type toggles
