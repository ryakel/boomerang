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
# Edit .env with your API keys (or add them in the UI later — both are optional)
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
├── server.js              # Express API server (Claude proxy, Notion proxy, data routes, health check)
├── db.js                  # SQLite data layer (sql.js, JSON blob storage)
├── src/
│   ├── App.jsx            # Main app component (task list, sections, bottom bar, modals)
│   ├── App.css            # All styles
│   ├── api.js             # API client (Claude AI, Notion, key status, data sync)
│   ├── store.js           # Data model, localStorage, helpers (tasks, routines, settings, labels)
│   ├── components/
│   │   ├── AddTaskModal.jsx    # Task creation with notes, polish, size, due date, labels, Notion
│   │   ├── EditTaskModal.jsx   # Task editing with all fields + convert-to-routine option
│   │   ├── TaskCard.jsx        # Individual task display with hover actions, expanded actions
│   │   ├── SnoozeModal.jsx     # Snooze options (tonight, tomorrow, weekend, next week)
│   │   ├── ReframeModal.jsx    # AI task reframing when snooze threshold exceeded
│   │   ├── ExtendModal.jsx     # Due date extension (+1d, +1w, +2w, custom date)
│   │   ├── WhatNow.jsx         # AI task suggestions (time + energy → recommendations)
│   │   ├── Routines.jsx        # Recurring task management (add, pause, resume, delete)
│   │   ├── DoneList.jsx        # Completion history grouped by date, with reopen
│   │   ├── Settings.jsx        # App settings, API keys, labels, notifications, data export/import
│   │   ├── Toast.jsx           # Motivational completion/reopen toasts
│   │   └── Logo.jsx            # Boomerang icon SVG component
│   └── hooks/
│       ├── useTasks.js         # Task state management (add, complete, snooze, update, uncomplete)
│       ├── useRoutines.js      # Routine state management (add, delete, pause, spawn)
│       ├── useSync.js          # localStorage ↔ SQLite sync (hydrate on load, debounced push)
│       └── useNotifications.js # Browser push notifications (overdue, stale, AI nudges)
├── public/
│   ├── favicon.svg         # Boomerang icon
│   ├── icon-192.svg        # PWA icon
│   └── icon-512.svg        # PWA icon
├── wiki/                   # Documentation (synced to GitHub Wiki)
├── Dockerfile              # Multi-stage, multi-arch build with APP_VERSION arg
├── docker-compose.yml      # Compose config with healthcheck
├── vite.config.js          # Vite config with PWA plugin, version injection, API proxy
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
- **Backend**: Express 5, sql.js (SQLite in-process)
- **AI**: Anthropic Claude API (claude-sonnet-4-20250514)
- **Integrations**: Notion API
- **Deployment**: Docker (node:22-alpine), GitHub Actions, GHCR
