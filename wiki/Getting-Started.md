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
  ghcr.io/ryakel/boomerang:main
```

Open `http://localhost:3001`.

## Adding API Keys

API keys can be configured two ways:

### Option 1: Environment Variables (server-wide default)

```bash
docker run -d \
  -p 3001:3001 \
  -v boomerang-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e NOTION_INTEGRATION_TOKEN=ntn_... \
  ghcr.io/ryakel/boomerang:main
```

### Option 2: In the UI (per-user override)

1. Open Settings (gear icon)
2. Under "API Keys", paste your Anthropic and/or Notion keys
3. Keys are stored locally and sent with each request

UI keys override environment variables.

## First Tasks

1. Type a task in the quick-add bar at the bottom and hit Enter
2. Tap the "+" button with empty text to open the full Add Task modal with notes, labels, and due dates
3. Tap a task to expand it — Done, Snooze, Extend, and Edit actions appear
4. Try "What can I do right now?" for AI-powered task suggestions
