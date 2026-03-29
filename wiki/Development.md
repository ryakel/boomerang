# Development

## Prerequisites

- Node.js 20+
- npm

## Setup

```bash
git clone https://github.com/ryakel/boomerang.git
cd boomerang
npm install
cp .env.example .env
# Edit .env with your API keys (or add them in the UI later)
```

## Running Locally

Two processes needed:

```bash
# Terminal 1: API server
node server.js

# Terminal 2: Vite dev server (hot reload)
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` requests to the Express server on port 3001.

## Project Structure

```
boomerang/
├── server.js              # Express API server
├── db.js                  # SQLite data layer
├── src/
│   ├── App.jsx            # Main app component
│   ├── App.css            # All styles
│   ├── api.js             # API client (Claude, Notion, data sync)
│   ├── store.js           # Data model, localStorage, helpers
│   ├── components/
│   │   ├── AddTaskModal    # Task creation with notes, polish, Notion
│   │   ├── EditTaskModal   # Task editing with recurring conversion
│   │   ├── TaskCard        # Individual task display
│   │   ├── SnoozeModal     # Snooze options
│   │   ├── ReframeModal    # AI task reframing
│   │   ├── ExtendModal     # Due date extension
│   │   ├── WhatNow         # AI task suggestions
│   │   ├── Routines        # Recurring task management
│   │   ├── DoneList        # Completion history
│   │   ├── Settings        # App settings + API keys
│   │   ├── Toast           # Motivational toasts
│   │   ├── AdminPanel      # (future) User management
│   │   └── Logo            # Boomerang icon component
│   └── hooks/
│       ├── useTasks        # Task state management
│       ├── useRoutines     # Routine state management
│       ├── useSync         # localStorage ↔ SQLite sync
│       └── useNotifications # Browser push notifications
├── public/
│   ├── favicon.svg         # Boomerang icon
│   ├── icon-192.svg        # PWA icon
│   └── icon-512.svg        # PWA icon
├── wiki/                   # Documentation (synced to GitHub Wiki)
├── Dockerfile              # Multi-stage, multi-arch
├── docker-compose.yml
└── .github/workflows/
    ├── build-and-publish.yml  # CI + GHCR publish
    └── wiki-sync.yml          # Wiki content sync
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | Build production frontend to dist/ |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |

## Tech Stack

- **Frontend**: React 19, Vite, PWA (vite-plugin-pwa)
- **Backend**: Express 5, sql.js (SQLite)
- **AI**: Anthropic Claude API (claude-sonnet-4-20250514)
- **Integrations**: Notion API
- **Deployment**: Docker (node:22-alpine), GitHub Actions, GHCR
