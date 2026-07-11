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

Seed realistic test data with `SEED_DB=1 node server.js` (wipes + reloads on boot), or hit `POST /api/dev/seed` / Settings → Data → "Reseed dev database" without restarting. Both are hard-gated to non-production builds (`APP_VERSION` must be `dev`/`dev-<sha>`).

## Project Structure

The v1 UI (a separate `src/AppV1.jsx` + its own `src/components/` tree, ~18k lines) was deleted 2026-06-10. `AppV2.jsx` (internal name "v2"; the shipped UI is branded **Kept**) is the only interface today.

```
boomerang/
├── server.js                          # Express API server — routes, SSE broadcast, notification loops, health check
├── auth.js                            # Optional password/token gate (inert unless AUTH_PASSWORD/API_TOKEN set)
├── db.js                              # SQLite data layer (sql.js) — per-record CRUD, migrations runner
├── seed.js                            # Dev seed data (SEED_DB=1 / POST /api/dev/seed)
├── aiModels.js                        # Centralized model ids (SONNET_MODEL, HAIKU_MODEL)
├── emailNotifications.js              # Email notification dispatcher (60s loop)
├── pushNotifications.js               # Web push dispatcher
├── pushoverNotifications.js           # Pushover dispatcher (priority 0/1/2 escalation)
├── digestBuilder.js                   # Shared daily-digest builder, used by all three channels above
├── notifAi.js                         # AI-generated nudge/toast copy
├── gmailSync.js                       # Gmail inbox scanner (task + tracking-number extraction)
├── weatherSync.js                     # Open-Meteo forecast cache sync
├── notionMCP.js / notionMCPProxy.js   # Notion MCP client + REST/MCP dual-path proxy
├── knowledgeSync.js                   # Knowledge-base CRUD (Notion-backed)
├── patternDetection.js                # Weekly routine-suggestion scanner
├── tagSuggestions.js                  # Weekly tag-suggestion scanner
├── growthAreas.js                     # Growth-area daily rotation logic
├── adviserTools*.js                   # Quokka (AI adviser) — registry + tool modules by domain
├── migrations/                        # Numbered SQL migrations, run in order on boot
├── scripts/                           # dates.test.mjs, cycles.test.mjs, smoke-test.sh, one-off maintenance scripts
├── src/
│   ├── main.jsx, App.jsx              # Entry point; App.jsx renders AppV2 unconditionally in an ErrorBoundary
│   ├── AppV2.jsx                      # Root app — state, Standard/Kept theme routing, top-level handlers
│   ├── api.js                         # API client (Claude AI, Notion, Trello, GCal, data sync helpers)
│   ├── store.js                       # Data model, localStorage, settings defaults, computeStreak
│   ├── scoring.js                     # Points/budget/streak-credit math
│   ├── dates.js                       # Canonical local-date module — unit-tested in npm test
│   ├── theme.js                       # Theme registry, system-theme resolution, applyTheme()
│   ├── badges.js                      # Achievement definitions
│   ├── apiConfig.js                   # iOS Capacitor runtime API config (inert on web)
│   ├── components/                    # Shared UI — modals, TaskCard, ModalShell/EmptyState, Standard-theme Kanban
│   ├── kept/                          # Kept-only surfaces — KeptShell/KeptDesktop, TodayView/LoopsView/TasksViewKept,
│   │                                  #   FlightTrail/MonthDots/DensityRibbon/DayArc, palette.css
│   ├── contexts/                      # TaskActionsContext (task callbacks via context, not prop drilling)
│   ├── hooks/                         # useTasks, useRoutines, useServerSync, useExternalSync, useNotifications,
│   │                                  #   useAdviser (Quokka), useSizeAutoInfer, and the rest
│   └── utils/                         # carrierDetect and other small pure helpers
├── public/                            # PWA icons, push-sw.js (custom service worker), carrier logos
├── wiki/                              # Documentation (synced to GitHub Wiki via .github/workflows/wiki-sync.yml)
├── Dockerfile                         # 3-stage build (build → deps → production), explicit runtime COPY list
├── docker-compose.yml                 # Compose config with healthcheck
├── vite.config.js                     # Vite config with PWA plugin, version injection, API proxy
└── .github/workflows/
    ├── build-and-publish.yml          # main → :latest, GHCR publish
    ├── build-and-publish-dev.yml      # dev → :dev, GHCR publish (boomerang-dev:3002)
    └── wiki-sync.yml                  # Wiki content sync
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | Build production frontend to dist/ |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm test` | Unit tests (`scripts/dates.test.mjs`, `scripts/cycles.test.mjs`) + `scripts/smoke-test.sh` (build + boot + health check + bundle-parses check) |
| `npm run build:mobile` | `vite build && cap sync ios` — iOS Capacitor shell (see `wiki/iOS-Native-App.md`) |

A pre-push git hook (installed via `npm run prepare`) runs lint + the full test suite before every push.

## Tech Stack

- **Frontend**: React 19, Vite, PWA (vite-plugin-pwa)
- **Backend**: Express 5, sql.js (SQLite in-process)
- **AI**: Anthropic Claude API — model ids centralized in `aiModels.js` (`SONNET_MODEL`, `HAIKU_MODEL`)
- **Integrations**: Notion (MCP + REST), Trello REST API, Google Calendar/Gmail (OAuth), 17track, Open-Meteo, Pushover
- **Deployment**: Docker (node:22-alpine), GitHub Actions, GHCR
