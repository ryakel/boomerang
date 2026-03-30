# Configuration

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Server port |
| `DB_PATH` | No | `./boomerang.db` (local) or `/data/boomerang.db` (Docker) | SQLite database file path |
| `ANTHROPIC_API_KEY` | No | — | Default Claude API key for AI features (users can override in UI) |
| `NOTION_INTEGRATION_TOKEN` | No | — | Default Notion integration token (users can override in UI) |
| `APP_VERSION` | No | `dev` | Version string injected at build time (used if git tags are unavailable) |

**None are required.** The app starts and works fully without API keys. AI features (Polish, What Now, Reframe, date inference, size inference, smart nudges) are disabled without an Anthropic key. Notion features are disabled without a Notion token.

The server also reads from a `.env` file if present, supporting both `ANTHROPIC_API_KEY` and `VITE_ANTHROPIC_API_KEY` (legacy) formats.

## API Key Priority

For each request, the server resolves keys in this order:

1. **User-provided key** (sent via `x-anthropic-key` or `x-notion-token` request header from the UI)
2. **Environment variable** (`ANTHROPIC_API_KEY` or `NOTION_INTEGRATION_TOKEN`)

If neither is set, AI and Notion API calls return a 400 with a descriptive error message. The rest of the app continues to function normally.

When an environment variable is set, the Settings UI shows a status message ("Anthropic API key set by environment variable") instead of the input field, since the env var is already providing the key.

## Settings (in-app)

All settings are accessible via the gear icon in the header:

### API Keys
- **Anthropic API key** — for AI features. Stored in localStorage, sent as `x-anthropic-key` header. Hidden when env var is set.
- **Notion integration token** — for Notion features. Stored in localStorage, sent as `x-notion-token` header. Hidden when env var is set.

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

### Data
- **Export** — download JSON backup of all tasks, routines, settings, and labels
- **Import** — upload a JSON backup to restore data

### Danger Zone
- **Clear completed tasks** — removes all done tasks
- **Clear all data** — deletes all tasks, routines, settings, labels, and history (requires confirmation)
