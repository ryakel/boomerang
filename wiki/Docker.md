# Docker

## Architecture

Single container running Node.js 22 on Alpine Linux. Serves both the static React frontend and the Express API server.

```
Container (node:22-alpine)
  └── Express server
        ├── Static files (React PWA from /app/dist)
        ├── API proxy (Claude, Notion)
        ├── Data persistence (SQLite at /data/boomerang.db)
        └── Listening on $PORT (default 3001)
```

## Quick Start

```bash
docker compose up --build -d
```

## docker-compose.yml

```yaml
services:
  boomerang:
    build: .
    ports:
      - "${PORT:-3001}:${PORT:-3001}"
    environment:
      - PORT=${PORT:-3001}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - NOTION_INTEGRATION_TOKEN=${NOTION_INTEGRATION_TOKEN:-}
      - DB_PATH=/data/boomerang.db
    volumes:
      - boomerang-data:/data
    restart: unless-stopped

volumes:
  boomerang-data:
```

## Multi-Architecture

Images are built for both `linux/amd64` and `linux/arm64`:

- **amd64**: Standard x86 servers
- **arm64**: Apple Silicon Macs, ARM servers (Raspberry Pi, Graviton, etc.)

The CI pipeline builds both automatically via `docker buildx`.

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
docker pull ghcr.io/ryakel/boomerang:main
```

Tags:
- `main` — latest from main branch
- `v1.0.0` — specific release
- `sha-abc1234` — specific commit
