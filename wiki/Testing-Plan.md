# Testing Plan

Testing checklist for all features from the April 2026 sprint. Covers issues #3–#18, analytics overhaul, header menu refactor, and scheduling row fix.

---

## Setup

- [ ] `git pull origin main`
- [ ] `npm install`
- [ ] `SEED_DB=1 node server.js` — seed with test data
- [ ] Open in both viewports:
  - **Mobile:** Chrome DevTools responsive mode, 375px
  - **Desktop:** full window ≥ 768px

---

## 1. Header Layout

### Icons
- [ ] Header shows: Packages (box icon) + Settings (gear) + overflow ("...")
- [ ] Packages icon → Packages view opens
- [ ] Settings gear → Settings opens

### Overflow Menu
- [ ] Click "..." → dropdown appears below with: Projects, Import Markdown, Analytics, Activity Log
- [ ] Click any item → view opens, menu closes
- [ ] Click outside menu → menu closes
- [ ] Press Escape → menu closes
- [ ] Menu doesn't overflow off screen on mobile

---

## 2. TaskActionsContext (#3)

### Mobile Task List
- [ ] Tap task → expands (notes, checklists, toolbar visible)
- [ ] Tap expanded task → collapses
- [ ] Done button → task completes, toast shows
- [ ] Snooze button → snooze modal opens
- [ ] Edit button → EditTaskModal opens
- [ ] Extend button → extend modal opens
- [ ] Status cycle → not_started → doing → waiting
- [ ] Swipe left → Edit + Complete buttons
- [ ] Swipe right → delete
- [ ] Checklist toggle from expanded card → saves immediately

### Search Results
- [ ] Search a task → expand result → all actions work
- [ ] Complete from search → toast shows, Trello sync fires (if linked)

### Projects View
- [ ] Menu → Projects → tasks render, expand works, all actions work
- [ ] ProjectsView has its own expand state (independent of main list)

### Desktop Kanban
- [ ] Click card → EditTaskModal opens as drawer
- [ ] Hover card → Complete + Snooze buttons appear and work
- [ ] Drag task between columns → status changes

---

## 3. EditTaskModal Side Drawer (#4)

### Desktop
- [ ] Click any task → drawer slides in from right (480px wide)
- [ ] Overlay covers left side
- [ ] Click overlay → drawer closes
- [ ] No drag handle visible on desktop
- [ ] Close button (✕) works
- [ ] All sections render in 480px width:
  - [ ] Title, notes, tags, due date, size/energy
  - [ ] Checklists (add, toggle, reorder)
  - [ ] Comments, attachments, research
  - [ ] Notion/Trello connections
- [ ] Auto-save pill visible and functional

### Mobile
- [ ] Edit → bottom sheet slides up
- [ ] Drag handle visible, pull-to-close works

### Scheduling Row (the fix)
- [ ] Due date, Duration, Priority all on one row
- [ ] All three inputs are the same height (36px)
- [ ] Labels (DUE, DUR, PRI) align above their inputs
- [ ] Inputs align at bottom edge — no floating/misalignment
- [ ] Duration only appears when a due date is set
- [ ] Nothing overflows or overlaps

---

## 4. Keyboard Shortcuts (#5)

Desktop only.

### Navigation
- [ ] `j` → first task highlights with blue outline
- [ ] `j` again → next task
- [ ] `k` → previous task
- [ ] `↓`/`↑` arrows → same as j/k
- [ ] Selection auto-scrolls into view

### Actions
- [ ] `Enter` or `e` → EditTaskModal opens for selected task
- [ ] `x` → selected task completes
- [ ] `s` → snooze modal opens

### Global
- [ ] `n` → AddTaskModal opens
- [ ] `/` → search input focuses
- [ ] `?` → help overlay toggles
- [ ] `Escape` with modal open → closes topmost
- [ ] `Escape` with selection → clears selection

### Guards
- [ ] Typing in search input → shortcuts don't fire (except Escape)
- [ ] Typing in quick-add → shortcuts don't fire
- [ ] Cmd/Ctrl+key → browser shortcuts not hijacked
- [ ] None of the shortcuts fire on mobile

---

## 5. Richer Desktop Cards (#6)

### Desktop
- [ ] Task with notes → muted preview below title (max 120 chars + "...")
- [ ] Task without notes → no preview row
- [ ] Task with checklists → thin green progress bar + "3/7" count
- [ ] Task without checklists → no progress bar
- [ ] Tags always visible on card face

### Mobile
- [ ] No notes preview or progress bar on collapsed cards

---

## 6. Markdown Import (#14)

### Paste Flow
- [ ] Menu → Import Markdown → modal opens
- [ ] Paste `- [ ] Task one` → Preview → shows parsed task
- [ ] `- Bullet item` → parsed
- [ ] `1. Numbered item` → parsed
- [ ] `- [x] Done item` → skipped
- [ ] Plain paragraph → skipped
- [ ] `## Section` → shows as group label
- [ ] All tasks selected by default
- [ ] Uncheck tasks → count updates
- [ ] "Import" → tasks created, modal closes

### File Upload
- [ ] "Upload .md" → file picker → content loaded + auto-parsed
- [ ] "Back" button returns to paste view

### Edge Cases
- [ ] Empty paste → "Preview" disabled
- [ ] No parseable content → "No tasks found"
- [ ] 0 selected → "Import" disabled

---

## 7. Notion Database Sync (#8)

*Requires Notion token.*

### Settings UI
- [ ] Settings → Notion → connect → "Database Sync" section visible
- [ ] Paste 32-char database ID → Connect → verifies
- [ ] Paste Notion database URL → extracts ID, connects
- [ ] Invalid ID → error shown
- [ ] Connected → shows name + Sync Now + Disconnect
- [ ] Disconnect → clears settings

### Sync
- [ ] Sync Now → creates tasks from database rows
- [ ] Tasks have `notion_page_id` and `notion_url`
- [ ] Second sync → no duplicates
- [ ] Page sync + database sync can coexist

---

## 8. Notion Routine Suggestions (#9)

*Requires Notion token + Anthropic API key.*

- [ ] Notion page with recurring pattern → sync → purple suggestion banner
- [ ] Banner shows title + cadence
- [ ] "Create" → routine created, banner gone
- [ ] "✕" → dismissed permanently (survives refresh)
- [ ] Without API key → no suggestions, pages become regular tasks

---

## 9. GCal Recurring Events (#10)

*Requires Google Calendar integration.*

### Push
- [ ] Weekly routine → spawned task pushes to GCal → event is recurring
- [ ] Next spawn → links to existing recurring event (no duplicate)
- [ ] Routine with end date → RRULE has UNTIL

### Pull
- [ ] Recurring GCal event → Sync Now → one task per series (not per instance)

---

## 10. Morning Digest (#15)

### Settings
- [ ] Settings → Notifications → "Morning Digest" section visible
- [ ] Email/push toggles work independently
- [ ] Time picker updates setting

### Functionality
- [ ] Set time to current minute → digest fires within 60s
- [ ] Doesn't re-fire next check (23h throttle)
- [ ] No tasks → no digest

---

## 11. AI Email Nudges (#16)

- [ ] With API key → nudge email is AI-generated (contextual)
- [ ] Without API key → static fallback, no errors

---

## 12. Notification Batching (#17)

- [ ] Settings → Email → enable "Batch mode"
- [ ] Multiple notifications trigger → one combined email
- [ ] Disable → individual emails again

---

## 13. Trello Multi-List (#18)

*Requires Trello integration.*

- [ ] Settings → Trello → connect board → "Sync from lists" checkboxes visible
- [ ] Default list pre-checked
- [ ] Check additional lists → setting updates
- [ ] Sync Now → tasks from all checked lists imported

---

## 14. Analytics Dashboard

### Rings + Stats
- [ ] Activity rings show tasks/points/streak progress
- [ ] 4 stat cards: current streak, longest streak, best points, best tasks
- [ ] Vacation mode and free day buttons work
- [ ] Reset streaks (double confirmation) works

### Time Range + Daily Chart
- [ ] Range picker: 7d, 30d, 90d, All
- [ ] Default: 30d
- [ ] Bar chart shows daily completions
- [ ] Toggle Tasks (green) / Points (orange)
- [ ] Summary line shows total tasks + points for period
- [ ] "All" groups by week (not individual days)
- [ ] Empty period → "No completions" message

### Day of Week
- [ ] 7-bar chart, one per day
- [ ] Current day highlighted (outline)
- [ ] "Best day: [name]" insight shown

### Breakdowns
- [ ] **By Tag** — bars with label colors, sorted by count
- [ ] **By Energy** — bars with energy icons
- [ ] **By Size** — XS through XL with point totals
- [ ] All breakdowns respect the Tasks/Points toggle
- [ ] Empty breakdowns don't render

### Heat Map
- [ ] 52-week grid displays (GitHub contribution style)
- [ ] Tasks toggle → green cells
- [ ] Points toggle → orange cells
- [ ] Color intensity scales with daily volume
- [ ] Month labels along top
- [ ] DOW labels on left (Mon, Wed, Fri)
- [ ] Less/More legend at bottom right
- [ ] Future dates are transparent (not colored)
- [ ] Hover/tap a cell → tooltip with date + count
- [ ] Mobile: horizontal scroll shows full year

### Completed Tasks
- [ ] Section is collapsed by default
- [ ] Click to expand → search + filters appear
- [ ] Search by title → filters in real time
- [ ] Energy filter works
- [ ] Size filter works
- [ ] Tag filter works
- [ ] Each result card shows: title, date, size pill, energy icon, tags
- [ ] Empty results → "No completed tasks found"

---

## 15. Cross-Cutting Regression Tests

### Core Flows
- [ ] Add task (quick-add + full modal) → appears
- [ ] Complete → toast + undo
- [ ] Snooze → moves to Snoozed
- [ ] Delete → removed
- [ ] Status change → moves between sections

### Dark Mode
- [ ] Toggle dark mode → verify all new UI elements:
  - [ ] Heat map cells
  - [ ] Bar charts
  - [ ] Breakdown bars
  - [ ] Header menu dropdown
  - [ ] Keyboard help overlay
  - [ ] Markdown import modal
  - [ ] Scheduling row inputs
  - [ ] Routine suggestion banners
  - [ ] Analytics search/filters
  - [ ] Notion database sync UI
  - [ ] Morning digest settings

### Data Integrity
- [ ] Refresh → all data persists
- [ ] Two tabs → SSE sync works
- [ ] Migration 014 runs cleanly on fresh DB (check server logs)

---

## Done?

When all items are checked, the sprint is fully tested. File issues for any failures.
