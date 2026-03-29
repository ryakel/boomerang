# Boomerang

A personal ADHD task manager that won't let things disappear. Tasks always come back.

## Quick Start

```bash
# Docker (recommended)
docker pull ghcr.io/ryakel/boomerang:main
docker run -p 3001:3001 -v boomerang-data:/data ghcr.io/ryakel/boomerang:main

# Or with docker-compose
git clone https://github.com/ryakel/boomerang.git
cd boomerang
cp .env.example .env
docker compose up --build
```

Open `http://localhost:3001` — add your API keys in Settings or via environment variables.

## Pages

- [Getting Started](Getting-Started) — setup, configuration, first run
- [Features](Features) — what Boomerang does
- [Configuration](Configuration) — environment variables, API keys, settings
- [Docker](Docker) — container setup, volumes, multi-arch
- [Development](Development) — local dev setup, project structure
- [Architecture](Architecture) — how it works under the hood
