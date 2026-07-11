# Boomerang

A personal ADHD task manager that won't let things disappear. Tasks always come back.

## What It Does

Boomerang is built around the idea that dismissal is never free. Every "not now" requires a "then when." Tasks that go untouched become stale. Tasks that get snoozed too many times trigger an AI-powered reframe. Optional AI features help you polish notes, pick what to work on, and break down stuck tasks. Integrates with Notion and Trello for bidirectional sync. Multiple clients stay in sync in real time via Server-Sent Events.

<img src="images/kept-mobile-today.png" alt="Kept mobile Today view" width="390">

*Today: Day Arc hero, "What now?" prompt, dated tasks, and today's loops.*

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

**Getting started**
- [Getting Started](Getting-Started) — setup, configuration, first run
- [Features](Features) — what Boomerang does
- [Configuration](Configuration) — environment variables, API keys, settings
- [Docker](Docker) — container setup, volumes, healthcheck, multi-arch
- [Development](Development) — local dev setup, project structure

**How it works**
- [Architecture](Architecture) — how it works under the hood
- [Kept Design Language](Kept-Design-Language) — the shipped design language (tokens, components, motion, IA)
- [Notion Integration](Notion-Integration) — MCP + REST dual-path architecture, tool schemas, endpoint reference

**Feature deep-dives**
- [Sequences](Sequences) — follow-up task chains (completion-triggered, distinct from routines)
- [Activity Prompts](Activity-Prompts) — auto-roll routines, habit mode, pattern-detected routine suggestions
- [Growth Areas](Growth-Areas) — standing personal-coaching reminders
- [Escalation Ladder](Escalation-Ladder) — contact-persistence tracking for unresponsive people/organizations

**Mobile & platform**
- [iOS Native App](iOS-Native-App) — Capacitor shell, Share Extension / App Intents roadmap
- [iOS Shortcut](iOS-Shortcut) — quick task capture via the Shortcuts app

**Testing**
- [Activity Prompts Testing](Activity-Prompts-Testing) — manual test checklist for auto-roll/habit-mode/pattern-detection
- [Testing Notification Stack](Testing-Notification-Stack) — end-to-end test sequence for the notification stack
- [Local Verification Harness](Local-Verification-Harness) — running + screenshotting the app headlessly inside a session
- [Screenshot Shot List](Screenshot-Shot-List) — capture instructions/checklist for documentation screenshots

**Operations & reference**
- [Security Notes](Security-Notes) — credential storage, threat model, what's protective and what isn't
- [Version History](Version-History) — commit-level changelog
