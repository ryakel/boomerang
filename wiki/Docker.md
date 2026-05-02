# Docker

## Architecture

Single container running Node.js 22 on Alpine Linux. Serves both the static React frontend and the Express API server.

```
Container (node:22-alpine)
  └── Express server
        ├── Static files (React PWA from /app/dist)
        ├── API proxy (Claude, Notion, Trello)
        ├── Data persistence (SQLite at /data/boomerang.db)
        ├── Health check endpoint (/api/health)
        └── Listening on $PORT (default 3001)
```

## Quick Start

```bash
docker compose up -d
```

## docker-compose.yml

The compose file sets the project name to `boomerang`:

```yaml
name: boomerang

services:
  boomerang:
    image: ghcr.io/ryakel/boomerang:latest
    ports:
      - "${PORT:-3001}:${PORT:-3001}"
    environment:
      - PORT=${PORT:-3001}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - NOTION_INTEGRATION_TOKEN=${NOTION_INTEGRATION_TOKEN:-}
      - TRELLO_API_KEY=${TRELLO_API_KEY:-}
      - TRELLO_SECRET=${TRELLO_SECRET:-}
      - PUSHOVER_DEFAULT_APP_TOKEN=${PUSHOVER_DEFAULT_APP_TOKEN:-}
      - DB_PATH=/data/boomerang.db
    volumes:
      - boomerang-data:/data
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:${PORT:-3001}/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped

volumes:
  boomerang-data:
```

## Healthcheck

The container includes a healthcheck that pings `/api/health` using `wget`. The health endpoint returns `{"status": "ok"}` when the server is ready.

- **Interval**: 30 seconds
- **Timeout**: 5 seconds
- **Retries**: 3
- **Start period**: 10 seconds (grace period for initial startup)

## Dockerfile

Multi-stage build with an `APP_VERSION` build argument:

- **Stage 1 (build)**: Installs all dependencies, runs `npm run build` to produce the Vite frontend bundle. The `APP_VERSION` arg is passed through so the frontend can display the version.
- **Stage 2 (production)**: Copies only production dependencies, `server.js`, `db.js`, and the built `dist/` folder. Runs `node server.js`.

```bash
# Build with a specific version
docker build --build-arg APP_VERSION=v1.2.3 -t boomerang .
```

## Multi-Architecture

Images are built for both `linux/amd64` and `linux/arm64`:

- **amd64**: Standard x86 servers
- **arm64**: Apple Silicon Macs, ARM servers (Raspberry Pi, Graviton, etc.)

The Dockerfile uses `--platform=$BUILDPLATFORM` for the build stage, and the CI pipeline builds both architectures via `docker buildx`.

## Volume

Data is persisted in a Docker named volume at `/data`. The SQLite database file is at `/data/boomerang.db`.

```bash
# Backup
docker cp boomerang:/data/boomerang.db ./backup.db

# Restore
docker cp ./backup.db boomerang:/data/boomerang.db
```

## Pulling from GHCR

```bash
docker pull ghcr.io/ryakel/boomerang:latest
```

Tags:
- `latest` — latest release
- `main` — latest from main branch
- `v1.0.0` — specific release
- `sha-abc1234` — specific commit
