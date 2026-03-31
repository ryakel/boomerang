# Boomerang

A personal ADHD task manager that won't let things disappear. Tasks always come back.

## What It Does

Boomerang is built around the idea that dismissal is never free. Every "not now" requires a "then when." Tasks that go untouched become stale. Tasks that get snoozed too many times trigger an AI-powered reframe. Optional AI features help you polish notes, pick what to work on, and break down stuck tasks. Integrates with Notion and Trello for bidirectional sync. Multiple clients stay in sync in real time via Server-Sent Events.

## Quick Start

```bash
# Docker (recommended)
docker pull ghcr.io/ryakel/boomerang:latest
docker run -p 3001:3001 -v boomerang-data:/data ghcr.io/ryakel/boomerang:latest

# Or with docker-compose
git clone https://github.com/ryakel/boomerang.git
cd boomerang
docker compose up -d
```

Open `http://localhost:3001` and start adding tasks. API keys are optional — add them in Settings or via environment variables to enable AI and Notion features.

## Pages

- [Getting Started](Getting-Started) — setup, configuration, first run
- [Features](Features) — what Boomerang does
- [Configuration](Configuration) — environment variables, API keys, settings
- [Docker](Docker) — container setup, volumes, healthcheck, multi-arch
- [Development](Development) — local dev setup, project structure
- [Architecture](Architecture) — how it works under the hood
