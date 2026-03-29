# Docker Containerization Plan — Boomerang

## Current Phase: Phase 1 — Docker + Storage

Get the app running in a container with persistent storage. Single user, no auth. Use it from phone anywhere via internal hosting.

## Future Phases (not now)
- Phase 2: Statuses (not_started/doing/waiting/done) + checklists + comments
- Phase 3: Auth (multi-user, admin/user roles)
- Phase 4: Trello bidirectional sync

---

## Architecture

```
Browser ──> Express (port from $PORT)
              ├── /api/data/*        (task/routine/settings/labels CRUD)
              ├── /api/messages      (Claude proxy)
              ├── /api/notion/*      (Notion proxy)
              └── /*                 (static frontend from dist/)

SQLite (/data/boomerang.db)
  └── app_data (collection TEXT PK, data_json TEXT)
```

No auth, no users table. One flat table stores the same JSON blobs localStorage uses today.

---

## Changes

### 1. Replace hardcoded localhost URLs → relative paths

**`src/api.js`** — 5 replacements:
- `'http://localhost:3001/api/messages'` → `'/api/messages'`
- `'http://localhost:3001/api/notion/search'` → `'/api/notion/search'`
- `'http://localhost:3001/api/notion/pages'` → `'/api/notion/pages'`
- `` `http://localhost:3001/api/notion/pages/${pageId}` `` → `` `/api/notion/pages/${pageId}` ``
- `'http://localhost:3001/api/notion/status'` → `'/api/notion/status'`

**`src/hooks/useNotifications.js`** — 1 replacement:
- `'http://localhost:3001/api/messages'` → `'/api/messages'`

### 2. Add dev proxy to vite.config.js

```js
server: {
  proxy: { '/api': 'http://localhost:3001' }
}
```

### 3. SQLite data layer

**New file: `db.js`**

Single table:
```sql
app_data (
  collection TEXT PRIMARY KEY,  -- 'tasks' | 'routines' | 'settings' | 'labels'
  data_json TEXT NOT NULL
)
```

Exports:
- `initDb()` — create table if not exists
- `getData(collection)` — returns parsed JSON or null
- `setData(collection, json)` — upsert
- `getAllData()` — returns {tasks, routines, settings, labels}
- `setAllData(data)` — replaces all collections
- `clearAllData()` — deletes everything

### 4. Refactor server.js

- Read env vars from `process.env`, fall back to `.env` file for local dev
- `PORT` from env var (default 3001)
- Initialize SQLite on startup
- Add data routes:
  - `GET /api/data` — returns all collections
  - `PUT /api/data` — replace all collections
  - `PATCH /api/data/:collection` — update one collection
  - `DELETE /api/data` — clear all data
- Serve static files from `dist/` with SPA fallback (after all API routes)

### 5. Frontend sync hook

**New file: `src/hooks/useSync.js`**

- On app load: `GET /api/data`, hydrate localStorage
- On every localStorage write: debounced `PUT /api/data` (300ms debounce)
- localStorage stays as fast cache, SQLite is persistence layer

### 6. package.json

- Add `"start": "node server.js"`
- Add dependency: `sql.js`

### 7. Dockerfile

Multi-arch support: builds for both `linux/amd64` (servers, older machines) and `linux/arm64` (Apple Silicon Macs, ARM servers). `node:22-alpine` and `sql.js` both support both architectures natively.

```dockerfile
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps \
    && npm cache clean --force
COPY server.js db.js ./
COPY --from=build /app/dist ./dist
RUN mkdir -p /data

ENV PORT=3001
ENV DB_PATH=/data/boomerang.db
EXPOSE ${PORT}
VOLUME /data

CMD ["node", "server.js"]
```

Build for both architectures:
```bash
# Single arch (local use):
docker compose up --build

# Multi-arch (push to registry for use on any machine):
docker buildx build --platform linux/amd64,linux/arm64 -t boomerang .
```

### 8. .dockerignore

```
node_modules
dist
.env
.env.local
.git
.DS_Store
*.log
```

### 9. docker-compose.yml

```yaml
services:
  boomerang:
    build: .
    ports:
      - "${PORT:-3001}:${PORT:-3001}"
    environment:
      - PORT=${PORT:-3001}
      - VITE_ANTHROPIC_API_KEY=${VITE_ANTHROPIC_API_KEY}
      - NOTION_INTEGRATION_TOKEN=${NOTION_INTEGRATION_TOKEN}
      - DB_PATH=/data/boomerang.db
    volumes:
      - boomerang-data:/data
    restart: unless-stopped

volumes:
  boomerang-data:
```

---

## Verification

```bash
# Local dev (same workflow, just uses relative URLs now):
node server.js &
npm run dev
# → http://localhost:5173, API calls proxy through to 3001

# Docker:
docker compose up --build
# → http://localhost:3001 serves the full app
# → Data persists in boomerang-data volume

# Persistence test:
docker compose down && docker compose up
# → All tasks/settings still there
```
