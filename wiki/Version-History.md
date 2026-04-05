# Version History

Commit-level changelog for Boomerang, grouped by date. Sizes: `[XS]` trivial, `[S]` small, `[M]` medium, `[L]` large, `[XL]` extra-large.

---

## 2026-04-05

### Dev Tooling
- feat(server): add dev seed system for realistic test data [M]
  - `SEED_DB=1` at container startup wipes DB and loads messy ADHD-realistic test data
  - Primary: calls Claude API to generate fresh data; fallback: static `scripts/seed-data.json`
  - 53 tasks (mixed statuses, overdue, heavily snoozed, missing fields), 7 routines, 12 labels
  - `scripts/generate-seed-data.js` for standalone regeneration with API key
  - New files: `seed.js`, `scripts/seed-data.json`, `scripts/generate-seed-data.js`
  - Modified: `server.js`, `docker-compose.dev.yml`, `Dockerfile`
- feat(api): add POST /api/dev/seed endpoint for on-demand re-seeding [XS]
  - Modified: `server.js`
- chore(ci): publish :dev container and isolate dev environment [S]
  - Dev CI workflow now publishes `ghcr.io/ryakel/boomerang:dev` on push to `dev` branch
  - `docker-compose.dev.yml` uses port 3002, `boomerang-dev` container/volume names, pulls `:dev` image
  - Tailscale + Portainer redeploy via `PORTAINER_DEV_WEBHOOK_URL`
  - PR builds still validate without pushing
  - Renamed `dev-ci.yml` → `build-and-publish-dev.yml` to match prod naming
  - Modified: `.github/workflows/build-and-publish-dev.yml`, `docker-compose.dev.yml`

### UI Consistency
- `b48bf40` fix(ui): unified label picker dropdown with colored pills across all modals [M]
- `pending` fix(ui): fix date pickers across entire app — consistent sizing and native styling [S]

### Labels & Filters
- `c093a69` feat(ui): drag-to-reorder labels and mobile label dropdown [M]

### Google Calendar Integration
- feat(gcal): add bidirectional Google Calendar sync with OAuth 2.0 [XL]
  - OAuth flow with server-side token management and auto-refresh
  - Push sync: tasks with due dates create calendar events with AI-inferred times
  - Pull sync: calendar events imported as tasks with AI deduplication
  - Settings UI with calendar picker, status filter, timed/all-day toggle
  - Migration 007: add `gcal_event_id` column to tasks table
  - New files: `src/hooks/useGCalSync.js`, `migrations/007_add_gcal_columns.sql`
  - Modified: `server.js`, `db.js`, `src/store.js`, `src/api.js`, `src/hooks/useExternalSync.js`, `src/components/Settings.jsx`, `src/App.jsx`
- feat(gcal): add per-task duration override and event buffer [M]
  - Per-task `gcal_duration` field in EditTaskModal (shown when due date is set)
  - Duration priority: task override → AI inference → size-based → global default
  - 15-min buffer checkbox in Settings adds breathing room around calendar events
  - Migration 008: add `gcal_duration` column to tasks table
  - Modified: `db.js`, `src/store.js`, `src/hooks/useExternalSync.js`, `src/components/EditTaskModal.jsx`, `src/components/Settings.jsx`

### Snooze
- `fe40289` fix(ui): overhaul snooze options with context-aware labels and custom picker [M]

### Settings
- `e0c5897` fix(ui): show version number in desktop settings window [XS]

### Routines
- `5268c16` feat(routines): add optional end date for routines and fix priority layout [M]

### CI/CD
- `2ba388f` chore(ci): add wiki path exclusion and dev branch pipeline [S]

### Toast Messages (AI Pre-generated)
- `f49ca71` fix(store): add toast_messages and trello_sync_enabled to DB schema [S]
- `f078d25` feat(ui): backfill toast messages for pre-existing tasks on load [S]
- `7f37ae6` feat(ui): pre-generate AI toast messages on task create/update [M]
- `f9d342b` fix(ui): fix double toast and stuck toast bugs [S]
- `a5cb9fc` fix(ui): prevent double toast on AI message arrival [S]

### Ongoing Sync (Trello + Notion)
- `d1b931e` feat(sync,ui): add Notion ongoing sync and AI-powered toast messages [L]
- `1631cb2` chore(sync): add server-side trello sync logging [XS]
- `e346774` fix(sync): fix trello sync guard and add change detection logging [S]
- `1f50654` fix(sync): hydrate Trello IDs for pre-existing linked tasks and fix push race [S]
- `b765270` fix(sync): remove unused import and fix ref cleanup lint errors [XS]

### CSS Monolith Split
- `756a762` refactor(ui): split App.css monolith into per-component CSS files [L]

### Trello Sync
- `d1b9d26` feat(trello): add ongoing bidirectional sync for linked cards [L]
- `2921d04` feat(trello): sync native checklists and attachments to Trello [M]

### Notion Sync
- `d00a76f` feat(notion): full sync with checklists, attachments, and metadata [L]

### File Attachments + Research
- `64d9ffb` feat(tasks): auto-research when attachments are added [S]
- `65a211f` feat(api): wire file attachments into research task flow [S]

### Snooze/Due Date Fix
- `fe11268` fix(tasks): prevent snooze past due date and show both dates on card [M]

### Offline Mutation Queue
- `e104416` feat(sync): add offline mutation queue with auto-replay [M]

### iOS PWA Fix
- `fc90478` fix(ui): use 100dvh to eliminate PWA bottom dead space [S]

### Docs
- `b410e29` chore: remove outdated design.md spec [XS]
- `86e202a` docs: update README with current features and tech stack [S]
- `1c22abe` docs(sync): update CLAUDE.md, wiki features/architecture/version-history [M]
- `5f086d5` docs(sync): update CLAUDE.md with completed technical debt items [M]
- `7bf3eae` docs(sync): mark offline mutation queue as done in CLAUDE.md [XS]

---

## 2026-04-04

### Bottom Bar Spacing
- `d497eb2` fix(ui): tighten bottom bar spacing and add fade/separator [S]
- `b03efc8` fix(ui): reduce bottom bar dead space and add separator [S]
- `b017949` fix(ui): halve bottom bar dead space and add subtle separator [XS]
- `b213440` fix(ui): reduce bottom bar dead space below quick-add [XS]
- `6f78981` Revert "fix(ui): reduce bottom bar dead space further [XS]"
- `48daf55` fix(ui): reduce bottom bar dead space further [XS]

### Desktop UI
- `cc2ffef` docs: update CLAUDE.md with completed desktop modal work [XS]
- `11972f1` fix(ui): fix Routines +New button using giant submit-btn style [XS]
- `e9bb35f` feat(ui): desktop Analytics uses sheet-overlay modal pattern [S]
- `c0bf373` feat(ui): desktop Settings/Routines use sheet-overlay modal pattern [M]
- `b36489a` fix(ui): fix settings modal transparent bg in light mode, update docs [XS]
- `4098fc8` fix(ui): fix desktop overlays, hide mobile bottom bar, update tech debt [S]
- `9205fb8` fix(ui): desktop WhatNow modal, hide redundant quick-add, cleanup [S]
- `295b1c4` feat(ui): fix desktop bugs + add kanban drag-and-drop [M]
- `14bde8c` feat(ui): content-sized kanban columns with per-column add-card [S]
- `19f334c` feat(ui): add desktop kanban board view with 5 columns [L]
- `cee56b1` feat(ui): add desktop layout and hover states via media queries [M]
- `b4533c3` fix(ui): tighten mobile bottom bar spacing [XS]

### Checklists
- `0e11ca1` fix(tasks): persist checklists to database, fix Trello push [M]
- `f8eea88` feat(tasks): add Trello-style multiple named checklists with drag-and-drop [L]

### Integrations UI
- `e9fdb86` feat(ui): auto-test env integrations on load, add disconnect/test buttons [M]
- `78b4cbe` feat(ui): redesign integrations tab as accordion with status dots [M]
- `a134a45` feat(ui): make Notion template and Trello board/list sections collapsible [S]
- `d3c56db` fix(ui): show Notion template without connect, fix button overflow, add loading pill [M]

### Notion Templates
- `2c0f1e6` fix(notion): resolve tag IDs to display names in page template [S]
- `b779821` feat(notion): add metadata placeholders and rich text to page template [M]
- `2a5132d` feat(notion): add configurable page template with rich block types [M]

### Database Migration (JSON → SQL)
- `9609148` perf(server): transaction-wrap bulk writes, remove git dependency [S]
- `de10f42` fix(server): copy migrations dir into Docker image and guard seed [XS]
- `9853a2f` feat(store): migrate database from JSON blobs to proper SQL tables [XL]
- `7e71216` feat(store): migrate database from JSON blobs to proper SQL tables [XL]

### Server-Side Features
- `6a7b5a9` feat(api): add server-side analytics, done pagination, and task search [L]

### Icons
- `0c6a10e` fix(ui): replace emoji icons with Lucide, add search clear button [S]

### Config
- `6aac59e` chore(config): move git rules to top of CLAUDE.md, add session hook, bump lodash [M]

### Energy UI Refinement
- `028399c` fix(ui): align drain buttons and priority button in same row [XS]
- `5da5021` fix(ui): priority label above ! button, right-aligned next to Energy Drain [XS]
- `76cf174` fix(ui): move priority button right-aligned next to Energy Drain label [S]
- `09c7da5` feat(ui): remove confrontation energy type, redesign priority button, rename drain level [M]
- `8b74716` fix(ui): restore energy type labels under icons in modal selectors [S]
- `e8246b4` fix(ui): fix drain level button centering, swap remaining emoji with Lucide icons [S]
- `2960261` feat(ui): replace CSS hack icons with Lucide vector icons [S]
- `bf48fb3` fix(ui): replace broken CSS shape icons with colored letter circles [S]
- `8cc5a56` fix(ui): normalize all energy type icons to same 16x16 size [XS]
- `a311c9e` fix(ui): icon-only energy selectors, fix people and physical icons [S]

---

## 2026-04-03

### Energy/Capacity Tagging + Notion Pull Sync
- `9cf96da` feat(tasks): merge energy tagging, Notion sync, and architecture refactor [XL]
- `15a2fb1` feat(tasks): add energy/capacity tagging and Notion pull sync [XL]
- `3a49177` refactor(ui): extract shared hooks and deduplicate modal/sync logic [L]

### Performance
- `4ad38e3` perf(ui): wrap TaskCard in React.memo to prevent unnecessary re-renders [XS]

### Energy UI
- `8cb3c45` fix(ui): replace emoji with CSS/text, redesign energy indicators [M]
- `0691a26` fix(ui): restore non-energy emoji that were incorrectly removed [XS]
- `4dc5969` fix(ui): replace text labels with CSS icons, move energy to right side [M]
- `93c8db5` fix(ui): move energy badge below date on its own right-aligned row [XS]
- `c732d3a` fix(ui): energy badge in tags row, right-aligned opposite tags [XS]

### Docs
- `77f1249` docs: require user confirmation before pushing to main [XS]
- `ac75121` docs: enforce push-to-main workflow, prevent feature branch conflicts [XS]
- `37e7785` docs: add technical debt tracking and migration plans to CLAUDE.md [S]

---

## 2026-04-02

### Core Features
- `52d3eb6` fix(ui): only one task card expanded at a time [S]
- `c870524` feat(ui): add Doing section at top of task list [S]

### Trello
- `9e36f99` fix(trello): add logging and archive fallback for Trello push failures [S]
- `ad7e35e` feat(trello): add bidirectional reconciliation during sync [M]
