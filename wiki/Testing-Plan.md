# Testing Plan

Comprehensive testing plan for all features implemented in the April 2026 sprint (issues #3–#18 plus header menu refactor). Work through each section, checking off items as you go.

---

## Setup

- [ ] `git pull origin main`
- [ ] `npm install`
- [ ] `SEED_DB=1 node server.js` — seed with test data
- [ ] Open app in browser at both viewports:
  - Mobile: Chrome DevTools → responsive mode, 375px wide
  - Desktop: full browser window (≥ 768px)

---

## 1. TaskActionsContext (#3)

Context replaces 13 callback props on TaskCard with 3 (`task`, `expanded`, `onToggleExpand`).

### Mobile Task List
- [ ] Tap task → expands (notes, checklists, toolbar visible)
- [ ] Tap expanded task → collapses
- [ ] Toolbar: Done button → task completes, toast shows
- [ ] Toolbar: Snooze button → snooze modal opens
- [ ] Toolbar: Edit button → EditTaskModal opens
- [ ] Toolbar: Extend button → extend modal opens
- [ ] Toolbar: Status cycle button → cycles not_started → doing → waiting
- [ ] Swipe left → Edit + Complete buttons appear
- [ ] Swipe right → delete animation, task removed
- [ ] Checklist toggle from expanded card → saves immediately

### Search Results
- [ ] Search for a task → results appear
- [ ] Tap result to expand → all toolbar actions work
- [ ] Complete from search results → toast shows, Trello sync fires (if linked)

### Projects View
- [ ] Open Projects (menu → Projects)
- [ ] Tasks render, can expand, all actions work
- [ ] ProjectsView has its own expand state (expanding here doesn't affect main list)

### Desktop Kanban
- [ ] Click any card → EditTaskModal opens as drawer
- [ ] Hover card → Complete (✓) and Snooze (💤) buttons appear
- [ ] Hover actions work correctly
- [ ] Drag task between columns → status changes

### Gmail Pending (if available)
- [ ] Gmail-imported tasks show yellow border + envelope badge
- [ ] Expand → "Keep" and "Dismiss" buttons visible and functional

---

## 2. EditTaskModal Side Drawer (#4)

### Desktop (≥ 768px)
- [ ] Click any task → drawer slides in from the right
- [ ] Drawer is 480px wide, full viewport height
- [ ] Overlay covers left side (semi-transparent)
- [ ] Click overlay → drawer closes
- [ ] No drag handle visible
- [ ] Close button (✕) works
- [ ] All sections render correctly in 480px width:
  - [ ] Title editing
  - [ ] Notes textarea
  - [ ] Tags selector
  - [ ] Due date picker
  - [ ] Size/energy selectors
  - [ ] Checklists (add, toggle, reorder)
  - [ ] Comments
  - [ ] Attachments
  - [ ] Research
  - [ ] Notion/Trello connections
- [ ] Auto-save pill visible and functional

### Mobile (< 768px)
- [ ] Task edit → bottom sheet slides up
- [ ] Drag handle visible at top
- [ ] Pull handle down → sheet dismisses
- [ ] All sections functional

---

## 3. Keyboard Shortcuts (#5)

All tests on desktop only.

### Navigation
- [ ] Press `j` → first task highlights with blue outline
- [ ] Press `j` again → next task selected
- [ ] Press `k` → previous task selected
- [ ] `↓` / `↑` arrows → same as j/k
- [ ] Selection auto-scrolls into view
- [ ] Selection resets when view changes

### Actions on Selected Task
- [ ] `Enter` → EditTaskModal opens for selected task
- [ ] `e` → same as Enter
- [ ] `x` → selected task completes (toast shows)
- [ ] `s` → snooze modal opens for selected task

### Global
- [ ] `n` → AddTaskModal opens
- [ ] `/` → search input focuses
- [ ] `?` → shortcut help overlay appears
- [ ] `?` again → help overlay closes
- [ ] `Escape` with modal open → closes topmost modal
- [ ] `Escape` with selection, no modal → clears selection
- [ ] `Escape` with header menu open → closes menu

### Guards
- [ ] Click into search input, type `n` → types "n", doesn't open AddTaskModal
- [ ] Click into quick-add input, type `j` → types "j", doesn't navigate
- [ ] Press `Escape` in input → blurs input
- [ ] Cmd+K, Ctrl+T, etc. → browser shortcuts still work (not hijacked)

### Mobile
- [ ] None of the shortcuts fire on mobile viewport

---

## 4. Richer Desktop Cards (#6)

### Desktop
- [ ] Task with notes → muted text preview below title (max 120 chars + "...")
- [ ] Task without notes → no preview row
- [ ] Task with checklists → thin green progress bar + "3/7" count
- [ ] Task with all items complete → bar is 100% green
- [ ] Task without checklists → no progress bar
- [ ] Tags always visible on card (no expand needed)

### Mobile
- [ ] Notes only show when card is expanded
- [ ] No progress bar on collapsed cards
- [ ] Tags show in expanded view only

---

## 5. Markdown Import (#14)

### Paste Flow
- [ ] Menu → Import Markdown → modal opens
- [ ] Paste `- [ ] Task one\n- [ ] Task two` → click "Preview Tasks" → 2 tasks shown
- [ ] Paste `- Bullet item` → parsed as task
- [ ] Paste `1. Numbered item` → parsed as task
- [ ] Paste `- [x] Done item` → skipped
- [ ] Paste plain paragraph → skipped
- [ ] Paste with `## Section` → section shows as group label in preview
- [ ] All tasks selected by default
- [ ] Uncheck one → "Import N Tasks" count updates
- [ ] "All" / "None" links toggle selection
- [ ] "Import" → tasks created, modal closes
- [ ] Verify tasks appear in task list

### File Upload
- [ ] Click "Upload .md" → file picker opens
- [ ] Select .md file → content loaded, auto-parsed, preview shows
- [ ] Select .txt file → same behavior
- [ ] "Back" button → returns to paste view

### Edge Cases
- [ ] Empty paste → "Preview Tasks" button disabled
- [ ] Paste with no parseable content → "No tasks found" message
- [ ] 0 tasks selected → "Import" button disabled

---

## 6. Notion Database Sync (#8)

*Requires Notion integration token.*

### Settings UI
- [ ] Settings → Integrations → Notion → connect
- [ ] "Database Sync" section visible below Notion Sync
- [ ] Paste raw 32-char database ID → click "Connect" → verifies
- [ ] Paste Notion database URL → extracts ID, connects
- [ ] Invalid ID → error message shown
- [ ] Connected state shows database name + "Sync Now" + "Disconnect"
- [ ] "Disconnect" → clears `notion_db_id` and `notion_db_title`

### Sync
- [ ] "Sync Now" → fetches rows, creates tasks
- [ ] Tasks have `notion_page_id` and `notion_url` set
- [ ] Second sync → no duplicates
- [ ] Page sync and database sync can run simultaneously

---

## 7. Notion Routine Suggestions (#9)

*Requires Notion integration + Anthropic API key.*

### Suggestion Flow
- [ ] Notion page with recurring content (e.g., "Change furnace filter every 3 months")
- [ ] Sync Notion → AI detects `is_recurring` pattern
- [ ] Purple suggestion banner appears below header
- [ ] Banner shows title + cadence
- [ ] Click "Create" → routine created, banner disappears
- [ ] Verify routine appears in Routines view with correct cadence
- [ ] Click "✕" → banner disappears
- [ ] Refresh page → dismissed suggestion doesn't reappear

### Without AI
- [ ] No API key → pages create regular tasks, no suggestion banners

---

## 8. GCal Recurring Events (#10)

*Requires Google Calendar integration.*

### Push Sync (Routines → GCal)
- [ ] Create a weekly routine
- [ ] Wait for task to spawn (or manually trigger)
- [ ] Task syncs to GCal → verify event is recurring (check in Google Calendar)
- [ ] Next routine spawn → task links to existing recurring event (no new event created)
- [ ] Routine with end date → recurring event has UNTIL in RRULE

### Pull Sync (GCal → Boomerang)
- [ ] Create a recurring event in Google Calendar directly
- [ ] Sync Now → only one task created (not one per instance)
- [ ] Task has `gcal_event_id` set

### Cadence Verification
- [ ] Daily routine → FREQ=DAILY
- [ ] Weekly → FREQ=WEEKLY
- [ ] Biweekly → FREQ=WEEKLY;INTERVAL=2
- [ ] Monthly → FREQ=MONTHLY

---

## 9. Morning Digest (#15)

### Settings
- [ ] Settings → Notifications → "Morning Digest" section visible
- [ ] Email digest toggle works
- [ ] Push digest toggle works
- [ ] Time picker updates `digest_time`

### Functionality
- [ ] Set digest time to current minute → within 60s, digest fires
- [ ] Email: subject "Morning Digest: X open tasks", body has counts
- [ ] Push: title "Morning Digest", body has open/overdue/stale/due-today
- [ ] Doesn't re-fire on next check (23-hour throttle)
- [ ] No open tasks → no digest fires

---

## 10. AI Email Nudges (#16)

### With API Key
- [ ] Wait for nudge email → message is contextual/AI-generated (not generic)
- [ ] References a specific task

### Without API Key
- [ ] Nudge email → static message ("Got 5 min? Try: ...")
- [ ] No errors in server logs

---

## 11. Notification Batching (#17)

### Email Batch Mode
- [ ] Settings → Email Notifications → enable "Batch mode"
- [ ] Multiple notification types trigger → one combined email sent
- [ ] Email has sections with dividers
- [ ] Disable batch mode → individual emails resume

---

## 12. Trello Multi-List Sync (#18)

*Requires Trello integration.*

### Settings UI
- [ ] Settings → Trello → connect board
- [ ] "Sync from lists" section appears with checkboxes
- [ ] All board lists shown
- [ ] Default list pre-checked
- [ ] Check additional lists → `trello_sync_list_ids` updates
- [ ] Uncheck a list → setting updates

### Sync
- [ ] Check multiple lists → Sync Now → tasks from all checked lists imported
- [ ] Deselect a list → subsequent sync skips it
- [ ] Status mapping still works

---

## 13. Header Menu Refactor

### Layout
- [ ] Header shows: logo + Packages icon + Settings gear + "..." menu trigger
- [ ] Only 3 icons visible (not 4+)

### Menu
- [ ] Click "..." → dropdown opens below
- [ ] Menu contains: Projects, Import Markdown, Analytics, Activity Log
- [ ] Click any item → view opens, menu closes
- [ ] Click outside menu → menu closes
- [ ] Escape key → menu closes

### Icon Actions
- [ ] Packages icon → Packages view opens
- [ ] Settings gear → Settings opens

---

## 14. Cross-Cutting Regression Tests

### Core Flows
- [ ] Add task via quick-add → appears in list immediately
- [ ] Add task via full modal → all fields save correctly
- [ ] Complete task → toast shows with undo button
- [ ] Undo within 4 seconds → task reopened
- [ ] Snooze → task moves to Snoozed section
- [ ] Extend due date → date updates
- [ ] Delete task → removed from list
- [ ] Status change → task moves between sections

### Dark Mode
- [ ] Toggle dark mode in Settings
- [ ] All new UI elements styled correctly:
  - [ ] Keyboard shortcut help overlay
  - [ ] Markdown import modal
  - [ ] Header dropdown menu
  - [ ] Desktop notes preview
  - [ ] Checklist progress bar
  - [ ] Keyboard selection outline
  - [ ] Routine suggestion banners
  - [ ] Notion database sync UI
  - [ ] Morning digest settings
  - [ ] Batch mode toggle
  - [ ] Trello multi-list checkboxes

### Performance
- [ ] 50+ tasks → scrolling smooth on both mobile and desktop
- [ ] Desktop kanban with many cards → drag-and-drop responsive
- [ ] Expanding one task → other cards don't visibly re-render

### Data Integrity
- [ ] Refresh page → all data persists
- [ ] Open second tab → SSE sync works (edit in one, appears in other)
- [ ] Kill server, make changes, restart → offline queue replays

### Migration
- [ ] Fresh database → migration 014 runs (check server logs for `gcal_recurring_event_id`)
- [ ] Existing database → migration 014 applies cleanly

---

## Done?

When all items are checked, the sprint is fully tested. File issues for any failures found.
