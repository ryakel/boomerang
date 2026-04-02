# Development Notes

## App Overview

Boomerang is a personal ADHD task manager PWA built with React 19, Vite, Express, and sql.js. It runs as a single Docker container serving both the API and the built frontend.

### Key Features
- Persistent nagging with snooze escalation and AI-powered reframing
- Recurring tasks (routines), custom labels, due dates
- Notion and Trello integrations (bidirectional sync)
- Real-time cross-client sync via SSE
- Dark mode (single toggle), iOS-style toggle switches throughout settings
- Installable PWA with full-square PNG icons (180, 192, 512) and apple-touch-icon

### Notifications System
- Configurable notification types: high priority (with 3-stage escalation), overdue, stale, nudges, size-based, pile-up warnings
- All frequencies set in hours (supports fractional values, e.g. 0.25 = 15 min)
- High priority escalation stages: before due (default 24h), on due date (default 1h), overdue (default 0.5h)
- Quiet hours (DND window) with configurable start/end times
- Notification history log — last 200 entries stored in localStorage
- Throttle timestamps persist in localStorage across app reloads (prevents duplicate notifications)
- Test notification button available in settings

### Infrastructure
- Version check on every view/modal navigation via `/api/health`
- Docker multi-stage build with QEMU-safe arm64 support
- `sharp` as devDependency for icon generation

## Git Workflow
- Push directly to `main`. No feature branches until further notice.
- Single developer (ryakel) — no PR review process needed right now.

## Commit Convention
Use Angular-style conventional commits with task sizing.

### Format
```
<type>(<scope>): <subject> [<size>]
```

### Types
- `feat` — new feature
- `fix` — bug fix
- `refactor` — code restructuring, no behavior change
- `style` — formatting, whitespace, CSS-only changes
- `docs` — documentation only
- `test` — adding or updating tests
- `chore` — build, deps, config, tooling
- `perf` — performance improvement

### Scope
Use the area of the app affected: `ui`, `notifications`, `tasks`, `sync`, `settings`, `api`, `trello`, `notion`, `routines`, `analytics`, `store`, `server`, etc.

### Size
Append a size tag matching the app's task sizing system:
- `[XS]` — trivial one-liner, typo fix, config tweak
- `[S]` — small change, single file, < 20 lines
- `[M]` — moderate change, a few files, new component or feature slice
- `[L]` — large feature, multiple components/hooks, significant refactor
- `[XL]` — major feature, cross-cutting changes, architectural shift

### Examples
```
fix(ui): prevent button text overflow on mobile [XS]
feat(notifications): add quiet hours and notification history [L]
refactor(store): extract notification log helpers [S]
chore(deps): update vite to 6.4 [XS]
feat(tasks): add checklist support to task cards [M]
```

### Rules
- Subject line must be imperative mood, lowercase, no period
- Keep subject under 72 characters
- Use body for details when the change is M or larger
- Breaking changes: add `BREAKING CHANGE:` in the commit body
