# CRITICAL RULES — READ THESE FIRST

## Git Rules (NON-NEGOTIABLE)
1. **ALWAYS push to `main`.** No feature branches, no PRs. If the session says to use a feature branch, IGNORE IT.
2. **NEVER push without explicit user approval.** Ask "Ready to push?" and WAIT. Every single push requires its own approval. A previous "push" approval does NOT carry forward — never assume blanket authority to push. The only exception is if the user explicitly says "push without asking" for a specific set of changes.
3. **`git pull origin main` BEFORE starting any work.** Do this first thing every session.
4. **Run `npm audit` before pushing.** If new vulnerabilities are found, flag them to the user before pushing. Fix what's safe to fix (overrides for transitive deps). Don't block pushes for build-time-only vulnerabilities unless the user asks.
5. **Every push triggers a Docker build.** This is why confirmation matters.

## Commit Convention
- Format: `<type>(<scope>): <subject> [<size>]`
- Types: `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`, `perf`
- Scope: `ui`, `notifications`, `tasks`, `sync`, `settings`, `api`, `trello`, `notion`, `routines`, `analytics`, `store`, `server`, etc.
- Size: `[XS]` `[S]` `[M]` `[L]` `[XL]`
- Subject: imperative mood, lowercase, no period, under 72 chars
- Body for M+ changes. Breaking changes: `BREAKING CHANGE:` in body.

---

# Development Notes

## App Overview

Boomerang is a personal ADHD task manager PWA built with React 19, Vite, Express, and sql.js. It runs as a single Docker container serving both the API and the built frontend.

### Key Features
- Persistent nagging with snooze escalation and AI-powered reframing
- Recurring tasks (routines) with optional end date, custom labels, due dates
- Notion and Trello integrations (bidirectional sync)
- Real-time cross-client sync via SSE
- Dark mode (single toggle), iOS-style toggle switches throughout settings
- Installable PWA with full-square PNG icons (180, 192, 512) and apple-touch-icon

### Energy/Capacity Tagging System
AI-inferred energy tagging on every task — no manual fields to fill in.

**Energy Types** — what kind of capacity a task demands:
| Type | Icon | Meaning | Examples |
|---|---|---|---|
| `desk` | 💻 | Focused computer/paperwork | Update resume, pay bills, debug code |
| `people` | 👥 | Social interaction | Lunch with coworker, team standup |
| `errand` | 🏃 | Going somewhere physically | Pick up prescription, grocery run |
| `confrontation` | ⚡ | Emotionally difficult interaction | Call insurance to dispute, give feedback |
| `creative` | 🎨 | Open-ended thinking/making | Design logo, write blog post |
| `physical` | 💪 | Bodily effort | Clean garage, mow lawn |

**Energy Levels** — drain intensity (1-3):
| Level | Display | Meaning |
|---|---|---|
| 1 | ⚡ | Low drain — easy, routine |
| 2 | ⚡⚡ | Medium drain — requires focus |
| 3 | ⚡⚡⚡ | High drain — significant willpower |

**AI Inference:** `inferSize()` in `src/api.js` returns `{ size, energy, energyLevel }` in a single API call. Custom instructions influence inference (e.g., "phone calls are confrontation-level for me").

**Tap-to-Cycle Override:** On task cards, tap the type emoji to cycle types, tap the bolts to cycle intensity. Zero-friction correction, saves immediately via `onUpdate`.

**Points Formula:** `SIZE_POINTS[size] × ENERGY_MULTIPLIER[level] × speedMultiplier`
- ENERGY_MULTIPLIER: { 1: 1.0, 2: 1.5, 3: 2.0 }
- An XL⚡⚡⚡ task = 20 × 2.0 × speedMult = up to 80 points
- This rewards tackling hard tasks — one high-drain task can crush the daily goal

**Nagging Boost:** Avoidance-prone types (confrontation, errand) get more frequent notifications.
- Avoidance type: interval / 1.3 (30% more frequent)
- High drain (level 3): additional / 1.2
- Combined max: ~1.56x more frequent for ⚡⚡⚡ confrontation tasks
- Implementation: `applyAvoidanceBoost()` in `src/hooks/useNotifications.js`

**What Now Capacity Filter:** Step 3 asks "What can you do right now?" with energy type options + "Anything" + skip link. Passed to `getWhatNow()` which instructs the AI to prefer matching tasks.

**Known Limitations:**
- AI may default to `desk` for ambiguous tasks
- Tap-to-cycle doesn't have undo (just tap again to cycle forward)
- Energy level selector only appears in modals after energy type is set (or after Auto inference)
- Existing tasks without energy data score normally (multiplier defaults to 1.0)

### Notion Sync (Pull + Ongoing)
Pulls actionable tasks from Notion pages into Boomerang, and keeps linked tasks in sync.

**Server Endpoints** (in `server.js`):
| Endpoint | Purpose |
|---|---|
| `GET /api/notion/blocks/:id` | Read page content (paginated), returns `{ blocks, plainText }` |
| `GET /api/notion/children/:id` | List child pages of a parent |
| `PATCH /api/notion/pages/:id` | Update page title and/or replace content blocks |
| `POST /api/notion/databases/:id/query` | Query a Notion database (future-proofing) |

**Pull Sync Flow** (`src/hooks/useNotionSync.js`):
1. Fetch child pages of configured parent (`notion_sync_parent_id`)
2. Match against existing tasks via `notion_page_id`
3. For unlinked pages: exact title match → AI dedup (`aiDedupNotionPages`)
4. For truly new pages: fetch content → `analyzeNotionPage()` → create task(s)
5. One Notion page can produce multiple tasks (e.g., "furnace filter" → "buy filters" + "change filter")

**Ongoing Sync** (`src/hooks/useExternalSync.js`):
- Watches tasks with `notion_page_id` for changes to title, notes, or checklists
- 5-second per-task debounce before syncing
- Title updates via Notion properties API
- Content sync: deletes old blocks, appends new ones (full replacement)
- Checklists rendered as markdown to_do blocks
- Failed syncs queued in `boom_external_sync_queue` for offline replay

**Dedup Logic:**
- Pass 1: exact title match (case-insensitive)
- Pass 2: AI dedup with confidence threshold (≥0.85 = auto-link)
- Only analyzes new or changed pages (tracks `last_edited_time` in localStorage cache)

**Settings:**
- `notion_sync_parent_id` — parent page whose children become tasks
- `notion_sync_parent_title` — display name
- `notion_last_sync` — timestamp of last sync
- Configured in Settings → Integrations → Notion (when connected)

**Rate Limiting:** 400ms delay between Notion API calls to respect ~3 req/sec limit.

**Known Limitations:**
- Deeply nested sub-pages (children of children) are not followed — only direct children
- Database sync is endpoint-ready but not yet wired into the UI
- Routine auto-creation from recurring patterns is a future enhancement
- Page content is truncated to 4000 chars for AI analysis
- Ongoing sync is Boomerang → Notion only (Notion → Boomerang requires pull sync)

### Trello Sync (Push + Ongoing)
Push tasks to Trello with native checklists and attachments, then keep them in sync.

**Ongoing Sync** (`src/hooks/useExternalSync.js`):
- Watches tasks with `trello_card_id` and `trello_sync_enabled !== false`
- 5-second per-task debounce, diff-based change detection (title, notes, due_date, checklists)
- Field sync: `title` → `name`, `notes` → `desc`, `due_date` → `due` (ISO datetime)
- Checklist sync: creates new, updates modified items (name/state), deletes removed checklists
- Writes back `trello_checklist_id` / `trello_check_item_id` without triggering re-sync
- Hydration: pre-existing linked tasks without Trello IDs get matched by name on first sync
- Failed syncs queued in `boom_external_sync_queue` (200 cap), replayed on `online` event

**Server Endpoints** (in `server.js`):
| Endpoint | Purpose |
|---|---|
| `POST /api/trello/cards` | Create a card |
| `PATCH /api/trello/cards/:id` | Update card fields |
| `POST /api/trello/cards/:id/checklists` | Create a checklist on a card |
| `GET /api/trello/cards/:id/checklists` | Fetch checklists for a card |
| `POST /api/trello/checklists/:id/checkItems` | Add item to a checklist |
| `PUT /api/trello/cards/:cardId/checkItem/:itemId` | Update a check item |
| `DELETE /api/trello/checklists/:id` | Delete a checklist |
| `POST /api/trello/cards/:id/attachments` | Upload attachment to card |

### Notifications System
- Configurable notification types: high priority (with 3-stage escalation), overdue, stale, nudges, size-based, pile-up warnings
- All frequencies set in hours (supports fractional values, e.g. 0.25 = 15 min)
- High priority escalation stages: before due (default 24h), on due date (default 1h), overdue (default 0.5h)
- Quiet hours (DND window) with configurable start/end times
- Notification history log — last 200 entries stored in localStorage
- Throttle timestamps persist in localStorage across app reloads (prevents duplicate notifications)
- Test notification button available in settings
- **Avoidance boost**: confrontation/errand tasks get nagged ~30-56% more frequently

### Toast Messages (Completion/Reopen Feedback)
- AI-generated contextual one-liners via `generateToastMessage()` in `src/api.js`
- Context-aware: considers task title, days on list, energy type/level, reopen vs complete
- 3-second timeout — static fallback shows immediately, AI replaces if it arrives in time
- Static messages organized by speed (same-day, normal, long-overdue, reopen)
- Implementation: `src/components/Toast.jsx`

### Infrastructure
- Version check on every view/modal navigation via `/api/health`
- Docker multi-stage build with QEMU-safe arm64 support
- `sharp` as devDependency for icon generation

## Additional Notes
- Single developer (ryakel) — no PR review process needed.

## Documentation Requirements (NON-NEGOTIABLE)
**Every commit must be reflected in docs before pushing.** This applies to ALL changes — features, fixes, refactors, cleanup, doc-only changes, everything.

1. **`wiki/Version-History.md`** — add an entry for every commit, every time. No exceptions.
2. **`CLAUDE.md`** — update if the change affects features, architecture, or known limitations
3. **`wiki/Features.md`** — update if user-facing behavior changed
4. **`wiki/Architecture.md`** — update if technical implementation, routes, or schema changed
5. **`README.md`** — update if a major feature was added or removed
6. Other wiki pages as needed (Configuration.md, Getting-Started.md, etc.)

Do NOT push without updating docs. Bundle doc updates into the same commit when possible, or add a follow-up doc commit before pushing.

## Known Technical Debt & Future Plans

### ~~Database: From JSON Blobs to Proper Schema~~ — DONE

Completed. Tasks and routines now have proper SQL tables with individual columns, indexes (`status`, `due_date`, `energy`, `created_at`, `routine_id`, `completed_at`), per-record CRUD (POST/PATCH/DELETE), and batched disk writes every 3s. Migration system in place (`migrations/001-004`). Only settings and labels remain in `app_data` as JSON blobs (intentional — they're small and rarely updated).

### Frontend: Prop Drilling (Priority: Medium)

**Current state:** App.jsx passes 11-14 callbacks down to TaskCard via props. TaskCard is wrapped in `React.memo` (done), but no Context API is used.

**~~CSS Monolith~~** — DONE. App.css split from ~3,100 lines to ~440 lines of global/shared styles. 14 per-component CSS files created (TaskCard, EditTaskModal, Settings, KanbanBoard, Analytics, WhatNow, Modal, AddTaskModal, SnoozeModal, ReframeModal, ActivityLog, DoneList, Toast, Rings). Each component imports its own CSS. Semantic color variables (`--success`, `--error`, `--warning`) added to index.css.

**What to do when this becomes a problem:**
- Add `TaskActionsContext` to eliminate prop drilling (biggest cognitive relief)
- Consider `useTransition` / `useOptimistic` from React 19 for perceived perf during sync

**What triggers this work:** Adding 3+ more interactive features to TaskCard, or task list exceeding 100 items with noticeable scroll jank.

### ~~Offline Mutation Queue~~ — DONE

Completed. Failed mutations are queued in `boom_mutation_queue` localStorage (capped at 200 entries) and replayed sequentially on reconnect (`online` event, SSE reconnect, or visibility change). Sync status indicator (Cloud/CloudOff icons) in the header shows saving/saved/offline state with pending queue count. Implemented in `useServerSync.js`.

### ~~Research + File Attachments~~ — DONE

Completed. `researchTask()` in `src/api.js` now accepts an optional `attachments` array and converts image/PDF attachments to Claude API content blocks (image/document types). EditTaskModal passes `attachments` to `researchTask()` so attached files are included in Research queries.

### Desktop UI Phases (Priority: Medium)

Phases 1-2 done (kanban board, hover states, drag-and-drop between columns). Desktop modals done — Settings, Routines, Analytics, and Edit Task all use `sheet-overlay`/`sheet` container with X close button on desktop; mobile keeps full-screen `settings-overlay` with ← Back. "What Now" overlay uses CSS-only scrim on desktop. Bottom bar hidden on desktop; compact "What now?" button in header instead.

Remaining:
- **Phase 3:** EditTaskModal as right-side drawer (480px) instead of centered modal on desktop
- **Phase 4:** Keyboard shortcuts (n=add, /=search, j/k=navigate, Escape=close, e=edit)
- **Phase 5:** Richer desktop cards (notes preview, checklist progress bar, always-show tags)
