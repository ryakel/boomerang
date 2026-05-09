# V2 — Current State and Future Work

The v2 redesign was built between 2026-05-03 and 2026-05-09. This doc captures
where v2 stands today, what's shipped, what's still pending, and how to pick
up the work in a future session.

---

## TL;DR

- **v2 is the default UI** since `b1f2e76` (PR6 cutover, 2026-05-03). `?ui=v1` reverts.
- **Every v1 surface has a v2 implementation.** All 8 Settings tabs, all task-flow modals, KanbanBoard on desktop, swipe gestures on mobile, weather badges, Trello status push, routine cadence advancing on complete, multi-list checklists.
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
- [ ] **Manual sync triggers** (Trello / Notion / GCal / Gmail Sync-Now buttons) in v2 Integrations. Background syncs run; manual one-shots don't have UI.

### Medium priority

- [ ] **Channel test buttons** (Test push / Test email / Test Pushover priority-0 / Test Pushover Emergency / Test digest) in v2 Notifications.
- [ ] **Notification history list** in v2 (currently v1-only — stored in `notification_log` table).
- [ ] **Comments + AI Research + Attachments + Extract-Text** in v2 EditTaskModal. Common power-user features in v1 EditTaskModal still v1-only.
- [ ] **Notion search/link/create + DB sync configuration** in v2.
- [ ] **Trello board/list pickers + GCal calendar picker + Gmail scan controls** in v2 Integrations.
- [ ] **Weather geocode/location picker** in v2 Settings.

### Polish + lower priority

- [ ] **Header chrome restoration**: MiniRings + done-today counter + sync status indicator in v2 header. v2 currently has none of these.
- [ ] **Keyboard shortcuts on desktop** (`useKeyboardShortcuts`) — `j`/`k` navigate, `x` complete, `s` snooze, `n` new, `e` edit, `?` help, Esc close.
- [ ] **Routine suggestion banner** (Notion-driven recurring-pattern detection, accept/dismiss).
- [ ] **ExtendModal + FindRelatedModal + MarkdownImportModal** in v2 (rare flows).
- [ ] **Adaptive-throttle 👍/👎 chips** on v2 Analytics (currently v1-only).
- [ ] **Email From overrides + batch mode + weather notification toggles** in v2 Notifications.
- [ ] **7-day forecast widget + weather-hidden toggle + GCal duration override** in v2 EditTaskModal.

### Deferred — wait for above to settle

- [ ] **Dark-mode QA pass** across every v2 surface. Tokens defined; surfaces not visually audited at `data-theme="dark"`. Bug 4 below is the canonical instance — toggling the dark-mode switch in v2 → General doesn't actually flip the theme on adjacent surfaces.

### Known visual bugs (deferred — captured 2026-05-09 from device screenshots)

These are real bugs the user logged from the live `:dev` build, intentionally parked until light-mode sizes/positions/colors stabilize. None of them block functionality; they're styling and layout polish. Pick from this list when revisiting v2 visual fit-and-finish.

- [ ] **Bug 1 — Notification matrix cut off on narrow screens.** Settings → Notifications → "Notification types" type×channel table on mobile (dark mode). Header row is `TYPE / PUSH / EMAIL / PUSHOVER / EVERY` and the EVERY (frequency input) column gets clipped past the viewport's right edge. Whole table needs a rethink for ≤480px — likely options: stacked rows-per-type with channel chips inline, an accordion per type, or the freq input moved into an expansion drawer behind a tap-to-edit affordance. Reference: `NotificationsPanel` in `src/v2/components/SettingsModal.jsx`.
- [ ] **Bug 2 — Quiet hours START/END time inputs overlapping; bypass-label input oversized.** Settings → Notifications → Quiet hours section. Native `<input type="time">` boxes appear to overlap on iOS Safari and the bypass-label text input spans the full content width when it only needs ~10 chars. Inputs in general feel too large in this section.
- [ ] **Bug 3 — Quiet hours time selectors feel weird.** Same section as Bug 2. The native iOS time picker doesn't fit the v2 hairline aesthetic and the START/END pair feels disconnected. Consider a custom time picker (e.g. two number-spin inputs side by side) or at minimum tighter container styling.
- [ ] **Bug 4 — Dark-mode toggle visual state desyncs from actual theme + General-tab number inputs are full-width.** Settings → General. Dark-mode toggle reads "ON" (orange filled track) but the modal body + underlying app render in light mode — toggling doesn't reach every surface (related to the broader Dark-mode QA item above). Separately: the number inputs (default due days, staleness, reframe, max open tasks) span the full content width when they only need to fit one or two digits. On small screens they'd read better small (~80px) and right-aligned in the row, with the label on the left.
- [ ] **Bug 5 — Danger zone buttons look odd.** Settings → Data → Danger zone. The pink-bordered card holds two buttons of inconsistent visual weight: outline-style "Clear completed tasks" stacked above a solid red filled "Clear all data." Different button styles + left-justified pill stacking feel unbalanced. Either match button styles (both filled or both outline with the destructive variant differentiated by color only), or rethink the layout (full-width row, side-by-side, etc.).

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
