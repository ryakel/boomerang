# Getting Started

## Prerequisites

- Docker and Docker Compose (recommended), OR
- Node.js 20+ for local development

## Quick Start with Docker

```bash
docker run -d \
  --name boomerang \
  -p 3001:3001 \
  -v boomerang-data:/data \
  ghcr.io/ryakel/boomerang:latest
```

Open `http://localhost:3001`.

## API Keys (Optional)

Both the Anthropic API key and the Notion integration token are **optional**. The app works fully without them — you just won't have access to AI features or Notion integration.

**Without an Anthropic API key**, the following features are disabled:
- Polish (AI cleanup of messy notes)
- What Now (AI task recommendations based on time and energy)
- Reframe (AI breakdown of repeatedly-snoozed tasks)
- Date inference (extracting due dates from natural language)
- Size inference (AI-estimated T-shirt sizing during polish)
- Smart nudges (AI-generated notification messages)

**Without a Notion token**, Notion search, page linking, and page creation are disabled.

**Without Trello credentials**, Trello board sync, card pushing, and bidirectional status sync are disabled.

### Option 1: Environment Variables (server-wide default)

```bash
docker run -d \
  -p 3001:3001 \
  -v boomerang-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e NOTION_INTEGRATION_TOKEN=ntn_... \
  -e TRELLO_API_KEY=your_api_key \
  -e TRELLO_SECRET=your_trello_token \
  ghcr.io/ryakel/boomerang:latest
```

### Option 2: In the UI (per-user override)

1. Open Settings (gear icon in the header)
2. Under "API Keys", paste your Anthropic and/or Notion keys
3. Keys are stored in your browser's localStorage and sent as request headers

**Priority**: Keys set in the UI take precedence over environment variables. If an environment variable is already set, the Settings UI shows a notice instead of the input field.

## First Tasks

1. Type a task in the quick-add bar at the bottom and hit Enter
2. Tap the "+" button with empty text to open the full Add Task modal with notes, labels, due dates, size, Notion linking, and file attachments
3. Tap a task to expand it — Done, Snooze, Extend, Edit, Backlog, and Delete actions appear
4. Swipe a task right-to-left to reveal Edit and Done buttons, or left-to-right to delete
5. Try "What can I do right now?" for AI-powered task suggestions (requires Anthropic API key)
6. Check the activity rings in the header to see your daily progress on tasks, points, and streak
7. Tap the chart icon in the header to open the Analytics screen for detailed stats and streak management
