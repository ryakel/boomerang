# Version History

Commit-level changelog for Boomerang, grouped by date. Sizes: `[XS]` trivial, `[S]` small, `[M]` medium, `[L]` large, `[XL]` extra-large.

---

## 2026-04-13

- refactor(ui): add TaskActionsContext to eliminate prop drilling [M]
  - New `src/contexts/TaskActionsContext.jsx` provides all task callbacks via React Context
  - TaskCard signature reduced from 13 props to 3: `task`, `expanded`, `onToggleExpand`
  - KanbanBoard simplified — no longer passes 7 callback props through KanbanColumn
  - ProjectsView simplified — only receives `tasks` and `onClose` props
  - Fixed broken search results TaskCard: was using wrong handlers (`completeTask` instead of `handleComplete`) and non-existent props (`onExpand`, `expanded`)
  - Removed unused `onBacklog` and `onFindRelated` props from mobile TaskCard calls
  - Wrapped `handleSnooze` in `useCallback` for context value stability
  - Bonus: `expanded` prop is now a boolean (was `expandedId` string comparison), so React.memo can skip re-rendering unaffected cards
  - Modified: `src/App.jsx`, `src/components/TaskCard.jsx`, `src/components/KanbanBoard.jsx`, `src/components/ProjectsView.jsx`
  - New: `src/contexts/TaskActionsContext.jsx`
- feat(notion): wire database sync into UI [M]
  - New "Database Sync" section in Settings → Notion (when connected)
  - Paste database ID or URL → verifies connection → syncs rows as tasks
  - Extended useNotionSync hook with `pullFromDatabase()` — queries all database rows with pagination
  - Deduplication uses same two-pass system (exact title + AI fuzzy match)
  - Database rows are Notion pages — reuses existing `notion_page_id` field
  - New `notionQueryDatabase()` API function in api.js
  - Settings: `notion_db_id`, `notion_db_title`
  - Modified: `src/api.js`, `src/hooks/useNotionSync.js`, `src/components/Settings.jsx`
- feat(ui): markdown import for bulk task creation [M]
  - New import button (FileDown icon) in header opens markdown import modal
  - Paste markdown or upload .md/.txt files
  - Parses: checkboxes (`- [ ] task`), bullets (`- task`), numbered lists (`1. task`)
  - Sections (`## Header`) become group labels in preview
  - Two-step flow: paste/upload → preview with select/deselect → import
  - Skips completed checkboxes (`- [x]`) and plain text paragraphs
  - New: `src/utils/markdownImport.js`, `src/components/MarkdownImportModal.jsx`
  - Modified: `src/App.jsx`
- feat(ui): richer desktop task cards with notes preview and checklist progress [S]
  - Desktop cards now show truncated notes preview (first 120 chars, muted text)
  - Checklist progress bar with done/total count on cards with checklists
  - Tags were already always visible on desktop (no change needed)
  - Modified: `src/components/TaskCard.jsx`, `src/components/TaskCard.css`
- feat(ui): desktop keyboard shortcuts for task navigation and actions [M]
  - New `src/hooks/useKeyboardShortcuts.js` — centralized keyboard handler
  - Shortcuts: `n` (new task), `/` (search), `j`/`k`/arrows (navigate), `Enter`/`e` (edit), `x` (complete), `s` (snooze), `Escape` (close/deselect), `?` (help)
  - Visual highlight on keyboard-selected card via `keyboard-selected` CSS class
  - Auto-scroll selected task into view
  - Escape key closes topmost modal/overlay with stack-aware ordering
  - Shortcuts disabled when typing in inputs/textareas
  - Help overlay accessible via `?` key
  - Modified: `src/App.jsx`, `src/App.css`, `src/components/TaskCard.jsx`, `src/components/TaskCard.css`
  - New: `src/hooks/useKeyboardShortcuts.js`
- feat(ui): EditTaskModal renders as right-side drawer on desktop [M]
  - On desktop (≥768px), EditTaskModal slides in from the right as a 480px side drawer instead of bottom sheet
  - Overlay covers the left side (click to dismiss), no drag handle on desktop
  - New CSS classes: `sheet-overlay-drawer`, `sheet-drawer` with `slideInRight` animation
  - Mobile behavior unchanged (bottom sheet with pull-to-close handle)
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/Modal.css`
- docs(cleanup): fix stale entries and create tracking issues for untracked work [S]
  - CLAUDE.md: removed stale "Phase 2 Gmail not yet implemented" from Package Tracking
  - CLAUDE.md: added issue cross-references to known limitations, added #14-18 to tech debt list
  - CLAUDE.md: added TaskActionsContext to architecture notes
  - UPCOMING_FEATURES.md: removed GCal sync (already shipped), added AI email nudges, notification batching
  - Created issues: #15 (morning digest), #16 (AI email nudges), #17 (notification batching), #18 (Trello multi-list UI)

## 2026-04-12

- fix(sync): gcal pull filter diagnostic logging, larger filter input [XS]
  - Added detailed logging showing how many events filtered by Boomerang-managed, title filter, and remaining to import
  - Filter input changed from `settings-input` to `add-input` for a larger typing area
  - Modified: `src/hooks/useGCalSync.js`, `src/components/Settings.jsx`
- chore(settings): remove USPS Direct Tracking section from integrations [XS]
  - USPS API requires IP agreement for third-party tracking and was never functional
  - Removed the entire USPS settings UI (client ID/secret fields)
  - Modified: `src/components/Settings.jsx`
- feat(sync): title filter for Google Calendar pull sync [S]
  - New "Filter by title" text field in Settings → Google Calendar → Pull Sync
  - When set, only calendar events whose title contains the filter text (case-insensitive) are imported
  - Empty filter = import everything (existing behavior)
  - Modified: `src/components/Settings.jsx`, `src/hooks/useGCalSync.js`

## 2026-04-11

- feat(routines): Notion page search/create/link in routine add/edit form [M]
  - Routines can now find or create a Notion page directly from the add/edit form
  - Search existing pages, link to a match, or create a new page with `isRecurring` metadata (frequency included)
  - Linked Notion pages are shown on routine cards ("Open in Notion") and inherited by spawned tasks
  - Unlinking clears `notion_page_id` and `notion_url` on save
  - Wired `updateRoutineNotion` through App.jsx → Routines prop
  - Modified: `src/components/Routines.jsx`, `src/App.jsx`
- fix(ui): pull-to-close on handle only, routine deep link, scheduling alignment [S]
  - Pull-to-close touch handlers moved from entire sheet body to just the handle element — fixes choppy scrolling caused by touch interception
  - Removed `overscroll-behavior: contain` from sheet CSS
  - Routine link in EditTaskModal now passes routine ID → Routines view auto-opens the edit form for that specific routine
  - Scheduling row uses `align-items: flex-end` with natural heights instead of forced `height: 36px` — fixes priority being too low
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`, `src/components/Routines.jsx`, `src/App.jsx`, `src/components/EditTaskModal.css`, `src/components/Modal.css`
- fix(ui): smooth ref-based pull-to-close, duration/priority alignment [S]
  - Pull-to-close rewritten to use refs + direct DOM manipulation instead of React state, eliminating re-render jank during drag
  - Scheduling row uses `align-items: stretch` with explicit `height: 36px` on all three controls (date, duration, priority) so labels and inputs align perfectly
  - Priority toggle uses fixed `width: 76px` instead of `min-width` — no more row resizing when cycling states
  - Duration input background matches date input styling
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`, `src/components/EditTaskModal.css`
- fix(ui): pull-to-close isolation, duration styling, fixed-width priority toggle [S]
  - Pull-to-close now calls `stopPropagation` + `preventDefault` on touch move to prevent background pull-to-refresh from triggering simultaneously
  - Sheet CSS gets `overscroll-behavior: contain` to block scroll chaining
  - Duration input gets matching background, border-radius, and font-size so it aligns visually with date input
  - Priority toggle gets `min-width: 72px` and `justify-content: center` so the row doesn't resize when cycling between Normal/High/Low
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`, `src/components/EditTaskModal.css`, `src/components/Modal.css`
- fix(ui): fluid pull-to-close, scheduling row card, routine link [M]
  - Pull-to-close on modals is now fluid with visual tracking (translateY + opacity fade during drag) instead of threshold-only detection
  - "Part of routine" at top of EditTaskModal is now a tappable link that opens the Routines view
  - Scheduling row (due date + duration + priority) wrapped in a subtle card (`.scheduling-row`) with `justify-content: space-between` so fields spread evenly with breathing room
  - Date input uses `width: auto` so it sizes to content instead of expanding to fill
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/EditTaskModal.css`, `src/components/AddTaskModal.jsx`, `src/App.jsx`
- fix(ui): second pass form polish — spacing, button consistency, Trello clarity [M]
  - Due date on its own line; Duration + Priority on a second row with breathing room (no longer smashed together)
  - Labels section gets 16px bottom margin to visually separate from the categorization form-group
  - Normalized collapsible section buttons: empty sections show "+ Add" button, sections with content show chevron + count badge — applies to Attachments, Checklists, and Comments
  - Trello list picker now prefixed with "Trello list" label so it's clear what the dropdown is for
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`
- fix(ui): polish form layout — priority/date/duration row, pull-to-close, autosave position [M]
  - Priority moved to the Due Date + Duration row in EditTaskModal and AddTaskModal (out of the form-group)
  - Due date input made smaller (compact padding/font)
  - Autosave pill repositioned to float next to close button (informational, not in title row)
  - Attachments section uses "+" icon instead of chevron
  - Pull-to-close: swipe down on sheet to dismiss (EditTaskModal + AddTaskModal)
  - Energy Drain no longer wrapped in drain-priority-row since priority moved out
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`, `src/components/Modal.css`
- refactor(ui): redesign mobile form layouts for consistency and compactness [L]
  - **Routines form**: Priority + End Date on one inline row; priority as visible labeled toggle ("! High"/"Normal"); frequency + custom days inline; Notion as compact connection button instead of full section
  - **EditTaskModal**: Due Date + Duration on one inline row; Size/Energy Type/Drain/Priority grouped in a `.form-group` card; Checklists, Comments, and Attachments are collapsible sections (auto-expand if content exists, collapsed when empty); section headers show count badges
  - **AddTaskModal**: Same form-group pattern for categorization; Attachments + Notion as compact inline connection row instead of separate sections
  - New CSS patterns in EditTaskModal.css: `.form-inline-row`, `.form-inline-field`, `.form-group`, `.section-header`, `.section-badge`, `.section-chevron`, `.priority-toggle`, `.duration-inline`
  - Consistent label spacing (marginBottom: 4px) across all three forms
  - Modified: `src/components/Routines.jsx`, `src/components/EditTaskModal.jsx`, `src/components/AddTaskModal.jsx`, `src/components/EditTaskModal.css`
- fix(ui): restore native date/time picker appearance on mobile [S]
  - Date and time inputs shared `.routine-select` CSS which set `appearance: none` and added a SVG dropdown chevron — stripping native picker styling on iOS and making inputs look like blank select boxes
  - Overrode with `appearance: auto`, `-webkit-appearance: auto`, and `background-image: none` for `input[type="date"]` and `input[type="time"]` so native mobile date/time pickers render properly
  - Affects all 5 date inputs across the app: AddTaskModal, EditTaskModal, SnoozeModal, ExtendModal, Routines
  - Modified: `src/components/Settings.css`
- fix(routines): don't auto-complete task when converting to routine [XS]
  - `handleConvertToRoutine` was calling `completeTask(taskId)`, which closed the original task and fired completion side effects (toast, points, Trello sync)
  - Now links the existing task to the newly-created routine via `routine_id` so it stays active as the first instance
  - When the user later completes it, `handleComplete` logs the completion on the routine and `spawnDueTasks` takes over for future instances (it already skips routines that have an active task)
  - Modified: `src/App.jsx`

## 2026-04-08

- feat(packages): USPS direct tracking API — bypasses 17track for USPS packages [L]
  - OAuth 2.0 client credentials flow with 8-hour token caching
  - `pollUSPS()` calls USPS v3 tracking API with full event parsing
  - All USPS packages route to direct API: background poll, single refresh, initial create
  - Non-USPS packages (UPS, FedEx, etc.) continue using 17track
  - Status mapping, ETA extraction, signature detection, delivery notifications
  - Settings UI: "USPS Direct Tracking" section in Integrations with client ID/secret fields
  - Env vars: `USPS_CLIENT_ID`, `USPS_CLIENT_SECRET`
  - Modified: `server.js`, `store.js`, `Settings.jsx`, `.env.example`
- refactor(packages): normalize USPS 420+ZIP prefix at storage time [S]
  - Tracking numbers are now stripped of 420+ZIP routing prefix before saving to DB
  - Applies to manual add, Gmail import, and carrier detect endpoints
  - Startup fixup normalizes any existing packages in the database and clears `last_polled` to force re-registration
  - Removed the re-registration workaround since numbers are now clean at source
  - Modified: `server.js`, `gmailSync.js`
- fix(packages): re-register USPS 420-prefix packages with normalized number [S]
  - Background poll only registered never-polled packages, so USPS numbers registered under the old full 420+ZIP format were never re-registered with the normalized number
  - Now re-registers any package where `normalize17trackNumber` produces a different value
  - Modified: `server.js`
- fix(sync): improve tracking number extraction from HTML emails [S]
  - Extract tracking numbers from ALL link URLs (not just known carrier domains)
  - Added Shopify to tracked URL domains
  - Added debug logging for regex scan phase to diagnose misses
  - Modified: `gmailSync.js`
- fix(packages): strip USPS 420+ZIP prefix before sending to 17track [S]
  - 17track API rejects USPS numbers with the 420+ZIP routing prefix
  - New `normalize17trackNumber()` strips prefix for register, poll, and changecarrier calls
  - Result matching updated to handle normalized vs stored number mismatch
  - Modified: `server.js`
- feat(ui): server logs viewer in Settings with copy-all button [M]
  - Intercepts console.log/error/warn into 500-entry circular buffer
  - New `/api/logs` endpoint serves buffered logs
  - New "Logs" tab in Settings with monospace log viewer
  - Filter buttons: All, Gmail, GCal, Push, Email, DB, SSE, Errors
  - "Copy All" button copies full log text to clipboard
  - "Refresh" button to re-fetch latest logs
  - Errors shown in red, warnings in yellow
  - Modified: `server.js`, `Settings.jsx`, `Settings.css`
- fix(sync): fix pending flag on packages created before SQL fix [S]
  - Rescan now detects packages created with broken SQL (gmail_pending=0) and fixes their pending flag
  - Modified: `gmailSync.js`
- fix(sync): Gmail pending state not showing + duplicate packages [M]
  - `rowToTask`/`rowToPackage` and `taskToRow`/`packageToRow` in db.js were missing `gmail_message_id` and `gmail_pending` fields — pending state was never sent to client
  - Added yellow border + envelope badge to PackageCard for gmail_pending packages
  - Added tracking number dedup: checks existing packages before creating (both regex and AI phases)
  - Modified: `db.js`, `gmailSync.js`, `PackageCard.jsx`, `Packages.css`
- feat(sync): regex-based tracking number extraction before AI analysis [M]
  - Phase 1: scan email text for tracking number patterns (USPS, UPS, FedEx, Amazon, DHL)
  - Shipping context keywords (shipped, tracking, on the way, etc.) gate ambiguous patterns to reduce false positives
  - Packages found via regex skip AI entirely — instant, free, no API key needed
  - Auto-generates label from email subject/sender
  - Phase 2: remaining emails still go to AI for task extraction
  - Gmail sync now works without Anthropic key (regex-only mode for packages)
  - Modified: `gmailSync.js`
- fix(sync): improve Gmail email parsing for tracking number detection [S]
  - Extract tracking URLs from HTML link hrefs before stripping tags
  - Preserve HTML structure (br/p/div → newlines) instead of collapsing to whitespace
  - Append extracted tracking URLs as hints for AI analysis
  - Increase body truncation limit from 4000 to 6000 chars
  - Add USPS 420+ZIP prefix format to AI prompt
  - Modified: `gmailSync.js`
- feat(sync): Gmail integration — AI-powered email scanning for tasks and packages [XL]
  - OAuth flow using same Google credentials as GCal, separate token with gmail.readonly scope
  - Server-side scanning engine (`gmailSync.js`) fetches inbox, sends to Claude for analysis
  - AI extracts actionable tasks (title, due date, notes) and package tracking numbers (carrier auto-detect)
  - Pending review flow: Gmail-imported items show yellow border + envelope badge, expand to Keep/Dismiss
  - Pending items excluded from all notification engines (client, email, push)
  - Settings UI: connect/disconnect, scan days config, manual "Scan Now", auto-scan toggle
  - 5-minute server-side polling when auto-scan enabled
  - `gmail_processed` table for deduplication, `gmail_message_id`/`gmail_pending` columns on tasks + packages
  - New: `gmailSync.js`, `migrations/012_create_gmail_tables.sql`
  - Modified: `server.js`, `db.js`, `api.js`, `store.js`, `Settings.jsx`, `TaskCard.jsx`, `TaskCard.css`, `App.jsx`, `useNotifications.js`, `emailNotifications.js`, `pushNotifications.js`
- fix(ui): center Projects view title in mobile header [XS]
  - Modified: `ProjectsView.jsx`
- fix(ui): remove redundant analytics button from header [XS]
  - Analytics is already accessible via the MiniRings in the header stats row
  - Modified: `App.jsx`
- feat(tasks): add Projects space for longer-term tasks [M]
  - New `project` status — tasks moved here are fully excluded from all notifications (client, email, push)
  - Dedicated Projects view accessible via folder icon in header (purple, #A78BFA)
  - Mobile: full-screen overlay; Desktop: sheet modal + Kanban column
  - "Move to Projects" button in EditTaskModal, "Activate" to return to active
  - Projects excluded from GCal sync (events removed when moved), Trello status sync, and What Now
  - Stale/overdue visual indicators suppressed in Projects view
  - Separate from backlog — projects are intentional long-term work, backlog is someday/maybe
  - Modified: `store.js`, `App.jsx`, `App.css`, `EditTaskModal.jsx`, `TaskCard.jsx`, `KanbanBoard.jsx`, `useExternalSync.js`, `useTrelloSync.js`
  - New: `ProjectsView.jsx`, `ProjectsView.css`
- fix(notifications): test email always reported success even on failure [S]
  - `sendTestEmail()` ignored `sendEmail()` return value, always returned `{ success: true }`
  - Now performs SMTP send directly and propagates actual error messages to the UI
  - Modified: `emailNotifications.js`
- feat(notifications): Web Push notifications — background alerts even when app is closed [L]
  - Server-side push loop mirrors email notification logic (same types, frequencies, throttling, quiet hours)
  - VAPID keys auto-generated on first startup and persisted in database (no config needed)
  - Custom service worker (`push-sw.js`) handles push events and notification clicks
  - `push_subscriptions` DB table stores browser subscription endpoints
  - Settings UI: per-device enable, per-type toggles, test push button, disable button
  - Package status change push notifications (delivered, exception, out for delivery, signature)
  - Works on iOS 16.4+ (Home Screen PWA), all Android browsers, all desktop browsers
  - Server endpoints: `/api/push/status`, `/api/push/vapid-key`, `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/test`
  - Expired subscriptions (410/404) auto-cleaned from DB
  - Modified: `pushNotifications.js` (new), `push-sw.js` (new), `usePushSubscription.js` (new), `server.js`, `db.js`, `Settings.jsx`, `api.js`, `migrations/011`
- feat(notifications): SMS gateway detection for email notifications [S]
  - Detects SMS gateway recipients (tmomail.net, vtext.com, txt.att.net, etc.)
  - Sends text-only, 140-char truncated, minimal-header emails to phone numbers
  - Covers T-Mobile, Verizon, AT&T, Sprint, Metro, Cricket, Google Fi, Ting, Republic, US Cellular, Boost, TracFone
  - Status endpoint includes `sms_mode` flag
  - Modified: `emailNotifications.js`
- fix(notifications): test email always reported success even on failure [S]
  - `sendTestEmail()` ignored `sendEmail()` return value, always returned `{ success: true }`
  - Now performs SMTP send directly and propagates actual error messages to the UI
  - Modified: `emailNotifications.js`
- fix(notifications): env var NOTIFICATION_EMAIL now takes priority over UI setting [XS]
  - Previously UI-saved `email_address` overrode the env var
  - Modified: `emailNotifications.js`
- fix(ui): show effective email recipient when env var is set [XS]
  - Email field shows read-only env value instead of stale database value
  - Modified: `Settings.jsx`
- fix(ui): package tracking view uses desktop dialog on wide screens [M]
  - Packages was the only overlay still using mobile-only `settings-overlay` on desktop
  - Added `isDesktop` prop + `sheet-overlay/sheet` rendering pattern (matching Settings, Routines, Analytics)
  - Added desktop CSS with wider sheet (720px), hover states on cards
  - Modified: `Packages.jsx`, `Packages.css`, `App.jsx`

## 2026-04-07

- fix(notifications): specific error messages for email config status [XS]
  - Startup log now says exactly what's missing (e.g. "missing: NOTIFICATION_EMAIL")
  - Settings UI distinguishes between "SMTP not configured" vs "No recipient email"
  - Modified: `emailNotifications.js`, `Settings.jsx`
- fix(packages): fix single-package refresh being blocked by downgrade guard [S]
  - Downgrade guard was blocking ALL status updates on user-initiated refresh, not just downgrades
  - Removed guard from single-package refresh (user explicitly wants fresh data)
  - Guard remains on automated polling loop and refresh-all (background protection)
  - Also: skip 5-min throttle for pending packages so user can retry immediately
  - Modified: `server.js`
- fix(packages): show refresh result feedback on individual package cards [S]
  - Card refresh button shows green checkmark when updated, "Up to date" when throttled
  - Detail modal refresh button shows same feedback
  - No more silent flash-and-grey with no visible change
  - Modified: `PackageCard.jsx`, `PackageDetailModal.jsx`
- fix(packages): prevent status downgrade from stale 17track responses [M]
  - 17track intermittently returns `NotFound` for packages that already have valid tracking data
  - Added status rank guard in all three poll paths (polling loop, refresh-all, single refresh)
  - Packages at `in_transit` or higher will never be reverted to `pending`/`Not found yet`
  - Modified: `server.js`
- fix(packages): aggressive polling for newly added packages with no data [XS]
  - Packages stuck at "Not found yet" (pending, no events) now poll every 5min instead of 30min
  - Once 17track returns real tracking data, normal intervals resume
  - Modified: `server.js`
- fix(packages): show cooldown timer on refresh button [S]
  - 5-minute cooldown after refresh with visible `M:SS` countdown next to icon
  - Cooldown persists in localStorage across page reloads
  - Button disabled with tooltip showing remaining time
  - Modified: `src/components/Packages.jsx`
- chore: close GitHub issues #2 (routine infinite loop) and #7 (wiki reorg) — both resolved
- docs(claude): update technical debt section, remove closed issues, fix DB write interval
- fix(packages): add offline localStorage cache for packages [S]
  - Packages now persist in `boom_packages_v1` localStorage key
  - Instant render from cache on app open, then server fetch overwrites
  - If server is down, cached packages still display instead of empty list
  - Modified: `src/hooks/usePackages.js`
- fix(notifications): add emailNotifications.js to Docker image [XS]
  - Dockerfile stage 3 COPY line was missing the new file
  - Modified: `Dockerfile`
- feat(notifications): add email notification system [L]
  - Server-side notification engine mirrors client-side push logic (overdue, stale, nudge, high-priority, size, pileup)
  - Nodemailer transport with SMTP env var configuration (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
  - Gracefully tolerant: no-op when SMTP not configured, no errors, no broken UI
  - Per-type email toggles in Settings → Notifications (matches existing push notification UI pattern)
  - Package tracking email notifications (delivered, exception)
  - Dark-themed HTML email templates matching app aesthetic
  - Database migration for server-side notification throttle and log tables
  - Test email button and SMTP status indicator in settings
  - Docker compose files updated with SMTP env vars
  - DB persistence interval reduced from 3s to 1s for faster package tracking writes
  - New files: `emailNotifications.js`, `migrations/010_create_email_notification_tables.sql`
  - Modified: `server.js`, `db.js`, `src/store.js`, `src/api.js`, `Settings.jsx`, `docker-compose.yml`, `docker-compose.dev.yml`, `package.json`
- fix(packages): open tracking links in browser instead of PWA [XS]
  - PWAs intercept `target="_blank"` links within app scope
  - Use explicit `window.open()` to force external browser tab
  - Modified: `PackageCard.jsx`, `PackageDetailModal.jsx`
- fix(packages): update ALL duplicate packages, not just first match [S]
  - `batch.find()` only matched the first package with a given tracking number — duplicates never got updated
  - Changed to `batch.filter()` in both polling loop and refresh-all endpoint
  - Modified: `server.js`
- fix(packages): auto-refresh from 17track on app open [S]
  - Load cached data from DB first (instant render), then silently fire background refresh-all
  - SSE broadcast updates UI automatically when poll completes — no stale "Pending" cards
  - Modified: `src/hooks/usePackages.js`
- fix(packages): immediate poll on package create [S]
  - Package create now registers, waits 1.5s, polls 17track before responding
  - Card shows real status from the start instead of requiring manual refresh
  - Modified: `server.js`
- style(packages): shorten verbose carrier status on dashboard cards [XS]
  - "Shipper created a label..." → "Label created, package pending", etc.
  - Detail modal still shows full carrier text
  - Modified: `src/components/PackageCard.jsx`
- fix(packages): broaden ETA extraction for UPS [XS]
  - Check `estimated_delivery_date.from`, `.to`, and `scheduled_delivery_date` as fallbacks
  - Log `time_metrics` when no ETA found for diagnosis
  - Modified: `server.js`
- feat(packages): show ETA in detail status banner [XS]
  - ETA displayed on right side of status banner (e.g. "In Transit ... Tue, Apr 8")
  - Modified: `src/components/PackageDetailModal.jsx`, `src/components/Packages.css`
- style(ui): multi-colored analytics bar chart icon [XS]
  - Three colored bars: blue, amber, green
  - Modified: `src/App.jsx`
- fix(packages): animated swipe actions + colored header icons [S]
  - Rewrote swipe to track finger position in real-time (matching TaskCard pattern)
  - Header icons: analytics (multi-color), packages (amber), settings (muted)
  - Modified: `src/components/PackageCard.jsx`, `src/components/Packages.css`, `src/App.jsx`, `src/App.css`
- feat(packages): show duplicate badge on cards with same tracking number [XS]
  - Yellow "Duplicate" badge helps identify entries to clean up
  - Modified: `src/components/PackageCard.jsx`, `src/components/Packages.jsx`, `src/components/Packages.css`
- fix(packages): invalid date display + deduplicate registration calls [S]
  - ETA could be full ISO datetime — now strips time portion before parsing
  - Deduplicates tracking numbers in register17track
  - Modified: `src/components/PackageCard.jsx`, `src/components/PackageDetailModal.jsx`, `server.js`
- fix(packages): refresh-all registers ALL packages, not just unpolled [XS]
  - Modified: `server.js`
- fix(packages): auto-fix carrier for already-registered 17track numbers [S]
  - When register returns -18019901 (already registered), calls changecarrier to update
  - Modified: `server.js`
- fix(packages): pull-to-refresh on scroll container [XS]
  - Moved touch handlers to `.settings-overlay` (actual scroll container)
  - Modified: `src/components/Packages.jsx`
- feat(packages): batch refresh-all + carrier codes in 17track registration [M]
  - New `POST /api/packages/refresh-all` batches all active packages in one API call
  - Refresh button in header and pull-to-refresh trigger batch refresh
  - 17track numeric carrier IDs (UPS=100002, FedEx=100003, etc.) sent during registration
  - Modified: `server.js`, `src/api.js`, `src/hooks/usePackages.js`, `src/App.jsx`, `src/components/Packages.jsx`
- fix(packages): use 17track API v2.4 instead of v2.2 [XS]
  - API key was bound to v2.4 — v2.2 endpoints were returning empty results
  - Modified: `server.js`
- fix(packages): wrong request body format + status mapping for 17track v2.4 [M]
  - `gettrackinfo` was sending `{ number: [...] }` but v2.4 expects bare JSON array
  - Fixed status mapping to use `latest_status.status` object (not plain string)
  - Modified: `server.js`
- chore(config): add TRACKING_API_KEY to docker-compose and .env.example [XS]
  - Modified: `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`
- fix(packages): add 17track registration step — tracking wasn't working [M]
  - 17track API requires numbers to be registered via `/register` before `gettrackinfo` returns data
  - New `register17track()` called on package create, manual refresh, and first poll cycle
  - Added response logging to diagnose API parsing issues
  - Modified: `server.js`
- fix(packages): tracking env key not seen by frontend — missing from getKeyStatus [XS]
  - `getKeyStatus()` was dropping the `tracking` field from the server response
  - Modified: `src/api.js`, `src/components/Settings.jsx`
- fix(packages): tracking API key not reaching server + add connect/test button [M]
  - `getApiHeaders()` was missing the `x-tracking-key` header — UI-provided key never sent to server
  - `getTrackingApiKey()` now falls back to DB-stored settings (not just env var + header)
  - Polling loop uses `getTrackingApiKey()` instead of only `envTrackingApiKey`
  - `keys/status` endpoint now checks DB-stored key too
  - New `POST /api/packages/test-connection` endpoint uses free quota check (no tracking query consumed)
  - Settings integration section now has Test Connection button, status dot, retry on error
  - Auto-tests on mount when env var is configured
  - Modified: `src/api.js`, `server.js`, `src/components/Settings.jsx`
- style(packages): official carrier logos served as static SVG files [S]
  - Logo SVGs in `public/carriers/` for UPS, FedEx, USPS, DHL, Amazon, OnTrac, LaserShip
  - `CarrierLogo` component loads via `<img>` tags (drop-in replaceable files)
  - Used in PackageCard, PackageDetailModal, and add form carrier detection
  - New files: `src/components/CarrierLogo.jsx`, `public/carriers/*.svg`
  - Modified: `src/components/PackageCard.jsx`, `src/components/PackageDetailModal.jsx`, `src/components/Packages.jsx`
- style(packages): match Settings integration layout to other integrations [XS]
  - Package Tracking now uses the same collapsible row pattern as Anthropic/Notion/Trello/GCal
  - Expandable via `expandedIntegration` state, status dot, credential toggle, env var detection
  - Modified: `src/components/Settings.jsx`
- feat(packages): add duplicate tracking number detection [XS]
  - Client-side: live check as you type, shows warning with existing label, disables Add button
  - Server-side: 409 response if tracking number already exists
  - Case-insensitive comparison
  - Modified: `src/components/Packages.jsx`, `src/components/Packages.css`, `server.js`
- feat(packages): add sort options — by status, delivery date, or carrier [S]
  - Sort dropdown in header (same pattern as task sort)
  - Status (default): groups by Issues/Active/Delivered with ETA sub-sort
  - Delivery date: flat list sorted by ETA, then status
  - Carrier: grouped by carrier name, status sub-sort within each group
  - Modified: `src/components/Packages.jsx`, `src/components/Packages.css`

### Notifications
- fix(notifications): fix broken notification system — wrong status filter + stale settings closure [M]
  - All notification types except high-priority were filtering `status === 'open'` (a legacy status that no longer exists) instead of `not_started`/`doing`/`waiting` — making overdue, stale, nudge, size-based, and pile-up notifications completely dead
  - Settings were captured once in the useEffect closure and never re-read — toggling notifications or changing frequencies required a task change (via SSE hydration) to take effect
  - Rewrote to use a single always-running 1-minute interval that reads settings fresh each tick, uses a ref for current tasks, and filters by actual active statuses
  - Modified: `src/hooks/useNotifications.js`

### Package Tracking
- feat(packages): add package tracking with 17track API integration [XL]
  - New `packages` table (migration 009) with full tracking lifecycle
  - Server-side adaptive polling loop with batched 17track API queries (up to 40 per request)
  - Carrier auto-detection via regex patterns (USPS, UPS, FedEx, DHL, Amazon, OnTrac, LaserShip)
  - Carrier website fallback links on every card (works without API key)
  - Status-colored cards: pending (gray), in_transit (blue), out_for_delivery (teal), delivered (green), exception (red)
  - Full tracking timeline in detail modal with event history
  - Signature-required detection with auto-creation of high-priority errand task (full nagging escalation)
  - Delivery/exception/out-for-delivery/signature notifications (respects quiet hours)
  - Configurable auto-cleanup of delivered packages (default: 3 days)
  - API quota exhaustion handling with in-app banner and automatic recovery at midnight UTC
  - Manual refresh with 5-minute per-package throttle
  - Package Tracking settings in Integrations tab (API key, retention, notification toggles)
  - Package icon in header bar between Analytics and Settings
  - SSE broadcast on package updates for cross-client sync
  - New files: `migrations/009_create_packages_table.sql`, `src/utils/carrierDetect.js`, `src/components/Packages.jsx`, `src/components/Packages.css`, `src/components/PackageCard.jsx`, `src/components/PackageDetailModal.jsx`, `src/hooks/usePackages.js`, `src/hooks/usePackageNotifications.js`
  - Modified: `server.js`, `db.js`, `src/api.js`, `src/App.jsx`, `src/store.js`, `src/components/Settings.jsx`

---

## 2026-04-06

### Google Calendar
- fix(server): add trust proxy for correct protocol behind nginx [XS]
  - `req.protocol` now returns `https` behind reverse proxy, fixing OAuth redirect_uri mismatch
  - Modified: `server.js`
- style(ui): make GCal Disconnect and Remove All Events buttons more visible [XS]
  - Outlined buttons with clear text instead of blending into background
  - Remove All Events uses accent color to signal destructive action
  - Modified: `src/components/Settings.jsx`, `src/components/Settings.css`
- style(ui): replace native confirm() with in-app confirm dialog [S]
  - Custom styled dialog matching app design (dark theme, rounded corners)
  - Used for "Remove All Events" and "Clear all data" confirmations
  - Modified: `src/components/Settings.jsx`, `src/components/Modal.css`
- chore(docs): move technical debt and future plans to GitHub Issues [S]
  - Created issues #2-#10 for bugs, enhancements, and docs work
  - CLAUDE.md now references issues instead of inline task tracking
  - Modified: `CLAUDE.md`
- fix(gcal): push existing tasks to calendar on sync enable + new task create [M]
  - Initial sync picks up all tasks with due dates (today or future) when push sync is first enabled
  - New tasks with due dates now create calendar events immediately (was silently skipped)
  - 1-second stagger between initial sync events to avoid Google rate limits
  - Past due dates excluded from initial sync to avoid calendar clutter
  - Modified: `src/hooks/useExternalSync.js`
- fix(ui): hide Sync Now button unless pull sync is enabled [XS]
  - Button was confusing when user only wanted push sync
  - Modified: `src/components/Settings.jsx`
- feat(gcal): add bulk delete for Boomerang-managed calendar events [M]
  - New endpoint `POST /api/gcal/events/bulk-delete` — finds and deletes all events with "Managed by Boomerang" marker
  - "Remove All Events" button in Settings → Google Calendar section
  - Also clears `gcal_event_id` from all tasks to fully unlink
  - Confirmation dialog before executing, shows result count
  - Modified: `server.js`, `src/api.js`, `src/components/Settings.jsx`, `wiki/Architecture.md`

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
