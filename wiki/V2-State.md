# V2 — Current State and Future Work

The v2 redesign was built between 2026-05-03 and 2026-05-09. This doc captures
where v2 stands today, what's shipped, what's still pending, and how to pick
up the work in a future session.

---

## TL;DR

- **v2 is the default UI** since `b1f2e76` (PR6 cutover, 2026-05-03). `?ui=v1` reverts.
- **Every v1 surface has a v2 implementation.** All 8 Settings tabs, all task-flow modals, KanbanBoard on desktop, swipe gestures on mobile, weather badges, Trello status push, routine cadence advancing on complete, multi-list checklists. As of 2026-05-09, all six v2-polish ship-blockers + all seven medium-priority items have landed (skip-this-cycle, sort+filter pills, search, Pushover credentials, Anthropic key, manual sync triggers, channel test buttons, notification history, EditTaskModal Comments/Research/Attachments/Extract-Text, weather geocode, Notion link/create on tasks, Trello/GCal/Gmail picker UIs, Notion DB sync config). Visual bugs from screenshots all fixed. Polish + lower-priority items still pending; final-mile cherry-picks + dev → main merge prep are next.
- **Dev-merge workflow is locked in.** Direct push to `refs/heads/dev` still 403s on the local proxy (status as of 2026-05-09). The MCP-PR-and-rebase-merge loop documented in CLAUDE.md is the canonical way work lands on `dev` — fully automated end-to-end with no GitHub-UI clicks.
- **Dark-mode QA was deferred** at the user's request until light-mode sizes/positions/colors are dialed.

---

## What's shipped on `origin/dev` (= `:dev` image)

### Visual foundation
- v2 design tokens (`src/v2/tokens.css`) — single accent, muted alerts, pastel energy palette, three named easings/durations, off-white→true-white background, dark-mode variant defined but unaudited.
- Shared primitives in `src/v2/components/`: `ModalShell`, `EmptyState`, `Header`, `SectionLabel`, `TaskCard`, `WeatherBadge`, `BalanceRadar`, `Toast`.

### Task surfaces
- Task list with sections (Doing / Stale / Up next / Waiting / Snoozed) on mobile.
- KanbanBoard with drag-drop status changes on desktop (≥768px).
- TaskCard: title-dominant hierarchy, energy as single icon-plus-bolts chip, status economy (only overdue + high-pri get a colored left border; stale → inline meta; low-pri → opacity 0.78).
- Swipe-left-to-reveal Edit + Done actions on mobile cards.
- Weather badges in meta line for tasks with `due_date` in the 7-day forecast window.

### Modals (all on `ModalShell`)
- AddTaskModal (lean form: title, notes + Polish, due, priority, size + Auto, energy type/level, labels)
- EditTaskModal (same form + status + delete + backlog/projects + convert-to-routine + multi-list checklists)
- SnoozeModal (with reframe-threshold escalation)
- ReframeModal (AI-suggested replacement tasks)
- WhatNowModal (multi-step time → energy → capacity → suggestions)
- SettingsModal (8 tabs: General, AI, Labels, Integrations, Notifications, Data, Logs, Beta)
- ProjectsView (status='project' tasks)
- DoneList (paginated `/api/tasks?status=done` with Reopen)
- ActivityLog (filter All/Deleted, Restore for deleted snapshots)
- RoutinesModal (active/paused, hairline-list, expandable rows with Spawn/Edit/Pause/Delete)
- PackagesModal (carrier auto-detect, status pills, expandable timeline)
- AdviserModal (Quokka chat with multi-chat history, plan preview, confirm bar)
- AnalyticsModal (range pills, daily chart, dow pattern, **Balance radar** with Tags/Energy toggle, breakdowns, 52-week heatmap)

### Settings tabs (functional in v2)
- ✅ General — theme + default-due-days + staleness + reframe-threshold + max-open-tasks
- ✅ AI — custom instructions textarea + Import/Export/Clear (API key entry still v1)
- ✅ Labels — CRUD with up/down reorder + 5×col color picker (drag-drop reorder still v1)
- ✅ Integrations — connection-status panel for 7 integrations + inline keys for Anthropic + 17track (OAuth flows still v1)
- ✅ Notifications — channel masters + per-type × per-channel matrix + frequency inputs + high-pri escalation + quiet hours + bypass label (digest config + test buttons + history + adaptive throttle still v1)
- ✅ Data — Export/Import JSON + danger zone with v2-styled confirm dialog
- ✅ Logs — server-side log tail with filter pills
- ✅ Beta — v1↔v2 toggle (currently inverted: "Use legacy v1 interface") + static `__APP_VERSION__` build identifier

### Background hooks (running while v2 mounted)
- `useTasks`, `useRoutines` + `spawnDueTasks` effect, `useNotifications`, `useServerSync` + `hydrateFromServer`, `useExternalSync` (Trello/Notion outbound), `useSizeAutoInfer`, `useToastPrefetch`, `usePackages` + `usePackageNotifications`, `useAdviser`, `useIsDesktop`, `useWeather`, `useTrelloSync` (for status push on complete/uncomplete/status-change/delete).

### Feedback + recovery
- Toast on completion — AI copy, points, Undo, next-up suggestion, routine cadence advances.
- SW null-response hotfix (cache `/index.html` on install + synthetic 503 page when offline).
- Light-mode bg pure white. Desktop modals slide in from right edge as drawers.
- Header tinted icons (Quokka purple, Packages amber) + colored More-menu icons.

---

## What's on `claude/v2-pending-merge` (this branch — to merge into dev)

```
origin/dev (9581adb) ─── a87103e (checklists) ─── HEAD (this doc)
```

- **`a87103e` feat(ui): v2 EditTaskModal — multi-list checklists [M]**
  - Multi-list checklist editing in v2 EditTaskModal (add/rename/delete lists, add/check/rename/delete items, hide-completed toggle, per-list progress bar). Same data shape v1 saves (`task.checklists`).
  - Bonus: v2 TaskCard's checklist count was reading the legacy `task.checklist_items` field; switched to `task.checklists` summed across all lists.
  - Drag-drop reorder is the notable omission vs v1; defer until missed.
- **(this commit) docs(v2): current state + roadmap**

---

## What's pending — recommended next session

Categorized by priority. The future session should pick from this list.

### Ship-blockers before merging dev → main

These are daily-use gaps that users would notice:

- [x] ~~**Skip-this-cycle button in v2 RoutinesModal.**~~ Landed 2026-05-09. `skipCycle` ported from main into `useRoutines.js`; v2 wiring through `AppV2.jsx` + `RoutinesModal.jsx` (FastForward icon, "Skip cycle" button next to Spawn now, hidden for paused routines).
- [x] ~~**Sort dropdown** above v2 task list.~~ Landed 2026-05-09 in `TaskListToolbar`. Persists via `settings.sort_by`. Options: age / due-date / size / name.
- [x] ~~**Tag filter pills** above v2 task list.~~ Landed 2026-05-09 in `TaskListToolbar`. Horizontal pill row: All + each user label (active pill takes the label's color) + Routines (opens RoutinesModal). Empty-state messaging updated for filtered-to-zero.
- [x] ~~**Search bar + results view** in v2.~~ Landed 2026-05-09 in `TaskListToolbar`. Search icon next to sort flips the toolbar into search mode (input + close, Esc closes). Debounced 300ms fetch to `/api/tasks?q=`; results render as a single section with count chip in place of the regular task list. Searches every task (active, done, backlog, project) per the v1 endpoint behavior.
- [x] ~~**Pushover credential entry + test buttons** in v2 Integrations.~~ Landed 2026-05-09. Inline user-key + app-token password fields, "Test" (priority-0) and "Test emergency" (priority-2 with v2 confirm dialog) buttons, status feedback, env-override notice. Pushover moved out of the OAuth-deferred bucket since it's actually credential-only.
- [x] ~~**Anthropic API key entry + status check** in v2 AI tab.~~ Landed 2026-05-09. New `AnthropicKeyBlock` in the AI tab: env-var notice OR password input with show/hide toggle, "Test" button (calls `callClaude("ok")` ping), Disconnect, status feedback (Checking… / Connected ✓ / error message). Integrations panel's Anthropic row now points users at the AI tab via "Configure in AI" rather than punting to v1. **Model picker** dropped from scope — neither v1 nor server-side has a user-facing model selector today (both `ADVISER_MODEL` and other call sites are hardcoded). When that work happens, the picker can land in the same block.
- [x] ~~**Manual sync triggers** (Trello / Notion / GCal / Gmail Sync-Now buttons) in v2 Integrations.~~ Landed 2026-05-09. AppV2 now mounts `useNotionSync` + `useGCalSync` (previously missing — the dev image was silently not running inbound Notion/GCal pull-sync), and exposes `syncTrello` / `syncNotion` / `syncGCal` to SettingsModal. IntegrationsPanel renders a "Sync now" button (RefreshCw icon, spinner while syncing) on each integration row when its inbound sync is configured: Trello (gated on `trello_sync_enabled`), Notion (gated on `notion_sync_parent_id`), GCal (gated on `gcal_pull_enabled`), Gmail (gated on connection status, calls `gmailSync(scan_days)` directly with task/package counts shown after).

### Medium priority

- [x] ~~**Channel test buttons** (Test push / Test email / Test Pushover priority-0 / Test Pushover Emergency / Test digest) in v2 Notifications.~~ Landed 2026-05-09. Each button gates on its channel master + credential availability; per-button state machine (idle / sending / sent ✓ / error). Emergency goes through a v2 confirm dialog before firing. Digest button surfaces which channels actually fired (e.g. "Sent via push, email").
- [x] ~~**Notification history list** in v2 (currently v1-only — stored in `notification_log` table).~~ Landed 2026-05-09 as a collapsible section at the bottom of the Notifications tab. Loads last 50 entries from `getNotifLog(50)` on first expand, with Refresh + Clear toolbar. Hairline list with channel chip + type + time + title + body per entry.
- [x] ~~**Comments + AI Research + Attachments + Extract-Text** in v2 EditTaskModal.~~ Landed 2026-05-09. Research pill next to Polish opens an inline prompt input that calls `researchTask(...)` with the current title/notes/attachments. Attachments section uses the `useTaskForm` attachments support (already there but unwired in v2) — file picker, list with name+size+remove, 5MB total cap. "Extract text" pill on attachments calls `extractAttachmentText(...)` and appends the result to notes. Comments section is a hairline-bordered list with timestamped entries + add-input row.
- [x] ~~**Notion DB sync configuration** in v2 Settings — parent-page picker.~~ Landed 2026-05-09. New `inline: 'notion-config'` mode on the Notion row (when connected). Unconfigured state shows a search box that calls `notionSearch()` with a results list; picking a result writes `notion_sync_parent_id` + `notion_sync_parent_title` and fetches the child-page count. Configured state shows "📄 Syncing from <name>" with the child count + last-sync timestamp + "Change page" button. Sync-now button on the row still fires `syncNotion()` per PR #31. Database sync (separate from page sync) deferred to a future PR.
- [x] ~~**Notion search/link/create on tasks** in v2 EditTaskModal.~~ Landed 2026-05-09. New Connections section that drives `useTaskForm`'s existing `notionState` / `notionResult` / `handleNotionSearch` / `handleNotionCreate` / `handleNotionLink` (none of which were rendered in v2 before). When unlinked: "Notion" pill triggers a search; results list lets the user pick an existing page or "Create new Notion page." When linked: shows "Notion ↗" pill linking to the page with an unlink ✕. `handleSave` persists `notion_page_id` + `notion_url` so ongoing sync picks up the link.
- [x] ~~**Trello board/list pickers + GCal calendar picker + Gmail scan controls** in v2 Integrations.~~ Landed 2026-05-09. Each integration row exposes inline config when connected: Trello shows board + default-list dropdowns (lazy-loads via `trelloBoards()` / `trelloBoardLists(boardId)`); GCal shows calendar dropdown + push/pull toggles (lazy-loads via `gcalListCalendars()`); Gmail shows auto-scan toggle + scan-window days input. Multi-list sync checkboxes + GCal status filter checkboxes deferred — basic pickers cover the common path.
- [x] ~~**Weather geocode/location picker** in v2 Settings.~~ Landed 2026-05-09 as an inline `inline: 'weather'` row in IntegrationsPanel. Search box → `geocodeWeather(query)` → results list → pick a result writes `weather_latitude`/`longitude`/`location_name`/`timezone` and triggers a forced server cache refresh. Configured state shows "📍 Location" with a "Change location" button to clear and re-pick.

### Polish + lower priority

- [x] ~~**Header chrome restoration**: MiniRings + done-today counter + sync status indicator in v2 header.~~ Landed 2026-05-09. New `.v2-header-stats` cluster between brand and primary actions. MiniRings opens Analytics; "today" pill (count + "today" label, falls back to "Done" link when empty) opens DoneList; sync indicator shows synced/saving/offline with colored Cloud / pulsing CloudOff. Mobile: today label collapses to count only; wordmark hides ≤380px.
- [x] ~~**Keyboard shortcuts on desktop** (`useKeyboardShortcuts`).~~ Landed 2026-05-09. Hook wired in AppV2 with the same modal-stack-aware Esc behavior v1 uses. v2 TaskCard accepts a `selected` prop that adds an accent-colored ring (also threaded through KanbanBoard so j/k highlights the right card). New `?` help dialog renders the full shortcut list as `<kbd>` chips (n / / / j↓ / k↑ / Enter·e / x / s / Esc / ?).
- [x] ~~**Routine suggestion banner** (Notion-driven recurring-pattern detection, accept/dismiss).~~ Landed 2026-05-09. Banner row appears between the toolbar and task list when `useNotionSync` detects a recurring pattern. Each suggestion shows the proposed title + cadence chip + Create button (accepts → creates routine + marks pattern accepted) + dismiss ✕. Hidden during search mode.
- [ ] **ExtendModal + FindRelatedModal + MarkdownImportModal** in v2 (rare flows).
- [x] ~~**Adaptive-throttle 👍/👎 chips** on v2 Analytics.~~ Landed 2026-05-09. New "Adaptive throttle decisions" section appears at the bottom of v2 Analytics when there are unreviewed back-off decisions in the last 30 days. Each row shows channel + type + before→after multiplier + decision date with 👍 / 👎 buttons that call `markThrottleFeedback(id, 'up'|'down')`. Approving keeps the back-off; rejecting undoes it and sets a 7-day auto-tune skip on that combination.
- [x] ~~**Email From overrides + batch mode + weather notification toggles** in v2 Notifications.~~ Landed 2026-05-09. New "Email deliverability" block (From name + From address inputs + Batch mode toggle, gated on email channel being enabled) and a "Weather notifications" block (master + per-channel push/email toggles, gated on `weather_enabled` + each channel's master). Trailing v1-pointer narrowed to digest schedule + adaptive throttle chips + Pushover priority routing helper.
- [x] ~~**7-day forecast widget + weather-hidden toggle + GCal duration override** in v2 EditTaskModal.~~ Landed 2026-05-09. Forecast widget appears between Notes and Due when the task qualifies (outdoor energy or matching keyword/tags) — uses the shared `WeatherSection` + `resolveWeatherVisibility` from v1. Drawer mode shows a collapsed "🌤 7-day forecast" toggle that expands inline. Per-card "Hide weather on this card" checkbox writes `weather_hidden`. GCal duration override input appears when a due date is set; placeholder shows the size-derived default (XS=15 / S=30 / M=60 / L=120 / XL=240).

### Deferred — wait for above to settle

- [ ] **Dark-mode QA pass** across every v2 surface. Tokens defined; surfaces not visually audited at `data-theme="dark"`. The dark-mode toggle desync was fixed (see Bug 4 in resolved list below) but a full surface-by-surface audit at `data-theme="dark"` is still pending.

### Known visual bugs (resolved 2026-05-09)

All five bugs the user logged from device screenshots have been addressed:

- [x] ~~**Bug 1 — Notification matrix cut off on narrow screens.**~~ Replaced the table with a card-per-type list. Each card shows the type label + freq input on top, a 3-column grid of channel toggles (Push / Email / Pushover) below. Works at any viewport width without horizontal scroll.
- [x] ~~**Bug 2 — Quiet hours START/END inputs overlapping; bypass-label oversized.**~~ START/END now sit side-by-side as 110px-wide tight inputs (`.v2-settings-time-input`). Bypass-label is a 140px compact input on the right of a labeled row.
- [x] ~~**Bug 3 — Quiet hours time selectors feel weird.**~~ Same fix as Bug 2 — tighter widths + smaller padding pull the START/END pair together visually. Native `<input type="time">` retained (a custom picker is over-engineering for a self-hosted personal app).
- [x] ~~**Bug 4 part A — Dark-mode toggle desyncs from actual theme.**~~ AppV2 mount-effect now applies `data-theme` from `loadSettings().theme` so the toggle's reading and the rendered UI agree. Toggle's default also flipped from `(theme || 'dark')` to `theme === 'dark'` — v2 tokens default to light without `data-theme`, so the previous default-to-dark assumption was the desync source.
- [x] ~~**Bug 4 part B — General-tab number inputs full-width.**~~ Restructured each numeric setting from a vertical stack (label / hint / full-width input) to a labeled row (label + hint on the left, 80px right-aligned input on the right). Same for the Bypass label text input (140px).
- [x] ~~**Bug 5 — Danger zone buttons inconsistent.**~~ Both buttons now full-width-stacked (`.v2-settings-btn-block`) inside `.v2-settings-danger-actions` flex column. Outline-red "Clear completed tasks" sits above filled-red "Clear all data" — same width, same height, intentional fill-intensity step indicating destructiveness.

### Future-direction parking lot

- [ ] **Terminal-aesthetic theme toggle.** Inspiration: [init.habits](https://inithabits.com) — monospace + ASCII-style checkboxes `[ ] / [✓]`, command-prompt header (`user@init.habits $ daily`), tabbed nav (habits / stats / profile), fire-emoji streak indicator, calendar-row date picker, soft glow on a deep-blue terminal palette. Could ship as a third tier beyond light/dark — likely a new `data-ui` mode (e.g. `data-ui="terminal"`) that swaps `tokens.css` for a terminal-specific palette + monospace font stack, leaving the layout/component contracts untouched. Not a v2 ship item; revisit after the dev → main merge.

### Final-mile cleanup

- [ ] **Cherry-pick remaining main-only commits onto dev**: `c8ef380` (drop legacy `task.checklist` column), `3cdd943` (delete orphan API routes). Each is a separate small PR via the MCP loop. The npm-audit cherry-pick (`c00d520`) already landed on dev as `9b48196` (PR #22, 2026-05-09). The skip-this-cycle hook change from `422c2ff` was ported manually as part of PR #24 (v2 RoutinesModal Skip button); v1 wiring intentionally skipped since v1 is frozen and gets deleted in the end-state cleanup below.
- [ ] **End-state cleanup** (per `/root/.claude/plans/ui-redesign-ideas-i-iridescent-wren.md`): once v2 is validated, delete `src/AppV1.jsx` + `src/components/` and rename `src/v2/components/` → `src/components/`. Leave `?ui=v1` working for one release for safety.
- [ ] **Stranded `test-push-probe` branch** on origin can't be deleted via the proxy or MCP — needs the GitHub UI. Pointed at `a87103e` from the original 2026-05-03 diagnostic.

---

## How work lands on dev

Direct `git push origin dev` returns HTTP 403 from the local proxy ("Unable to parse branch information from push data"). Same bug class blocks `git push origin --delete <branch>`. Workaround loop is fully automated end-to-end:

```
# 1. Sync local dev
git fetch origin && git checkout dev && git reset --hard origin/dev

# 2. Branch + commit
git checkout -b <local-branch-name>
# … make changes, commit …

# 3. Push to a fresh remote ref (proxy accepts these)
git push origin <local-branch-name>:refs/heads/claude/v2-<thing>

# 4. PR + merge via MCP (zero GitHub-UI clicks)
mcp__github__create_pull_request  base="dev"  head="claude/v2-<thing>"
# wait for user approval
mcp__github__merge_pull_request   merge_method="rebase"

# 5. Resync local
git fetch origin && git reset --hard origin/dev
```

The rebase-merge auto-deletes the source branch on the remote (verified by PR #22, 2026-05-09 — `claude/v2-cherry-npm-audit` was gone from origin immediately after merge), so step 6 is normally just pruning the stale local tracking ref via `git fetch --prune`.

**Cherry-picking from main onto dev** uses the same loop. Conflicts typically appear in `wiki/Version-History.md` since both branches add entries to the top — keep dev's entries, add main's below, then `git cherry-pick --continue`.

---

## Why MCP PR-and-merge instead of direct push

Direct pushes to `refs/heads/dev` started failing with HTTP 403 / "Unable to parse branch information from push data" sometime between `7c6ddcf` (last successful direct push, 2026-05-03) and the next push attempt. Re-tested 2026-05-09 — still broken with the same error. Pushes to fresh branch refs continue to work; only `dev` (and presumably any other already-existing branch ref) is affected. Ref **deletions** also 403, hence the inability to clean up stranded refs from the local environment. Cause undiagnosed — not a GitHub branch protection rule per the user's check; possibly a proxy-level ACL, session token scope, rate limit, or quota. Investigation is open as a separate task; it's not blocking because the MCP loop covers every workflow we need.

---

## File / structure reference

```
src/
  App.jsx                  ← thin router (reads localStorage.ui_version)
  AppV1.jsx                ← legacy v1 component (unchanged)
  v2/
    tokens.css             ← --v2-* design tokens (namespaced)
    AppV2.jsx              ← v2 shell + hook orchestration
    AppV2.css
    components/
      Header, ModalShell, EmptyState, SectionLabel    ← primitives
      TaskCard, WeatherBadge                          ← list-card surface
      AddTaskModal, EditTaskModal, SnoozeModal        ← task-flow modals
      ReframeModal, WhatNowModal, Toast
      SettingsModal, ProjectsView, DoneList           ← secondary surfaces
      ActivityLog, RoutinesModal, PackagesModal
      AdviserModal, AnalyticsModal, BalanceRadar
      KanbanBoard                                     ← desktop only
      TaskListToolbar                                 ← sort + filter pills above the list
```

All v2 components consume tokens from `tokens.css` (gated by `:root[data-ui="v2"]`). Nothing in v2 imports v1 component files; v2 reuses v1 hooks (`useTasks`, `useRoutines`, etc.), `store.js`, `api.js`, `db.js`, and `utils/` directly. v1 stays untouched.

Per-device opt-in via `localStorage.ui_version` (`'v1'` or `'v2'`). URL escape hatches `?ui=v1` and `?ui=v2` set the flag and strip themselves from the URL so deep-link params (`?task=X` from notifications) survive.
