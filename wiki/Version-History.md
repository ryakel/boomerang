# Version History

Commit-level changelog for Boomerang, grouped by date. Sizes: `[XS]` trivial, `[S]` small, `[M]` medium, `[L]` large, `[XL]` extra-large.

---

## 2026-05-09

- feat(ui): v2 channel test buttons + notification history in Notifications tab [M]
  - **Why.** Two of the medium-priority items from V2-State knocked out together since they share the same panel. v2 Notifications had no way to fire a one-off test (Push / Email / Pushover priority-0 / Pushover Emergency / Digest) and no surface for the historical `notification_log` rows — both lived only in v1.
  - **Test buttons.** New "Test channels" block with five buttons. Each button gates on its channel master being on (and Pushover additionally on credentials being saved). Per-button state machine: idle → sending → sent ✓ → idle (4s auto-reset) or error with inline message. Digest test surfaces which channels actually fired (e.g. "Sent via push, email"). Pushover Emergency gates behind a v2 confirm dialog since it triggers the priority-2 alarm.
  - **Notification history.** Collapsible block at the bottom of the panel. First expand triggers `getNotifLog(50)` and renders a hairline list of recent entries: channel chip + type + time on the meta row, then title + body. Refresh button (with spinner) and Clear button (calls `clearServerNotifLog()`) in a small toolbar. Capped at 50 entries; max-height 360px with internal scroll.
  - **Polish.** Trailing "More notification options" pointer narrowed — no longer mentions test buttons or history (those landed); now points at digest schedule + style, adaptive throttling 👍/👎 chips, email From overrides + batch mode, Pushover priority routing helper, and weather-notification toggles as the remaining v1-only surfaces.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 715KB precache (up from 710KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- fix(ui): v2 visual bugs from device screenshots — notif cards, quiet hours, settings rows, dark-mode init, danger zone [M]
  - Five fixes for visual bugs the user logged from the live `:dev` build earlier today.
  - **Bug 1 — notification matrix cut off on narrow screens.** Replaced the type×channel `<table>` with a card-per-type list. Each `.v2-notif-card` has type label + freq input on top, a 3-column grid of channel toggles (Push / Email / Pushover) below — labeled chips so the channel name doesn't need a header row. Works at any width without horizontal scroll. Same data shape, same toggles, same settings keys; just a different render.
  - **Bug 2 + 3 — quiet hours inputs.** New `.v2-settings-quiet-times` flex row with `.v2-settings-time-input` (110px wide, 8px/10px padding) for the START/END time inputs. Bypass label moved into a labeled row using the new `.v2-settings-compact-input-wide` (140px). Native `<input type="time">` retained — a custom time picker is over-engineering for the use case.
  - **Bug 4A — dark-mode toggle desyncs from actual theme.** Two-part fix. `AppV2.jsx` mount effect now reads `loadSettings().theme` and applies `data-theme` + `meta[name="theme-color"]` so the rendered UI matches whatever the toggle reads. Settings toggle default also flipped from `(theme || 'dark') === 'dark'` to `theme === 'dark'` — v2 tokens default to light when `data-theme` is unset, so the previous "default to dark in the toggle" assumption was the source of the desync.
  - **Bug 4B — General-tab number inputs full-width.** Each numeric setting (default due days, staleness, reframe trigger, max open tasks) restructured from a vertical block (label / hint / full-width input) to a `.v2-settings-row` (label + hint on the left, 80px right-aligned `.v2-settings-compact-input` on the right). Reads cleaner on mobile.
  - **Bug 5 — danger-zone buttons inconsistent.** Both buttons now stack full-width (`.v2-settings-btn-block`) inside `.v2-settings-danger-actions` flex column. Outline-red "Clear completed tasks" sits above filled-red "Clear all data" — same width, same height, intentional fill-intensity step indicating destructiveness.
  - **Other.** Removed the orphan `@media (max-width: 600px)` rule that referenced the now-deleted `.v2-notif-matrix*` classes.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 710KB precache (up from 709KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 manual sync triggers (Trello / Notion / GCal / Gmail) in Integrations [M]
  - **Why.** Last v2 ship-blocker. v2 had no manual "Sync now" UI for any of the four pull-sync integrations — users had to flip back to v1 to trigger a one-shot sync. Worse: AppV2 wasn't even mounting `useNotionSync` or `useGCalSync`, so the auto-on-mount + visibility-change syncs that v1 runs were silently disabled on dev. This commit fixes both.
  - **AppV2 hook wiring.** Added `useNotionSync(tasks, setTasks)` and `useGCalSync(tasks, setTasks)` imports and call sites alongside the existing `useTrelloSync`. Pulled `syncTrello` / `syncing: trelloSyncing` from the existing useTrelloSync call (was previously only consuming `pushStatusToTrello`). Threaded all three sync functions + their busy flags through to `<SettingsModal>` as new props.
  - **IntegrationsPanel "Sync now" buttons.** New `sync` field on each integration descriptor — `{ fn, busy }`. Trello gated on `trello_sync_enabled`, Notion on `notion_sync_parent_id`, GCal on `gcal_pull_enabled`. Button uses `RefreshCw` icon with `v2-spinner` class while busy and "Syncing…" / "Sync now" labels.
  - **Gmail.** Doesn't have a hook — handled inline via `runGmailSync()` in IntegrationsPanel. Dynamic-imports `gmailSync(gmail_scan_days)`, then surfaces a `syncResult` line under the row ("N task(s), M package(s)" or "Error: …") that auto-fades after 6 seconds.
  - **Row layout.** `.v2-integrations-row-actions` is a vertical flex column on the right side of each row holding the Sync now button stacked above the existing Configure / Manage button. `.v2-integrations-sync-result` lives at the bottom of the meta column for the Gmail post-sync summary.
  - **Behavior fix.** AppV2 now runs Notion + GCal pull-sync on mount + on visibility-change, matching v1 — fixes a silent regression where the dev image wasn't pulling inbound from those integrations at all.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 709KB precache (up from 707KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- docs(v2): park "terminal-aesthetic theme" idea (init.habits inspiration) [XS]
  - User shared a screenshot of [init.habits](https://inithabits.com) — monospace + ASCII checkboxes + terminal palette + command-prompt header. Logged as a future-direction parking-lot bullet in V2-State.md: a possible third theme tier beyond light/dark via a new `data-ui` mode that swaps `tokens.css`. Explicitly not a v2 ship item; post-dev→main experiment.
  - Modified: `wiki/V2-State.md`

- docs(v2): log 5 known visual bugs from device screenshots [XS]
  - User reported 5 visual bugs from the live `:dev` build via screenshots: Notifications matrix cut off on narrow screens (Bug 1), Quiet hours time inputs overlap + bypass-label input oversized (Bug 2), time selectors feel disconnected (Bug 3), Dark-mode toggle desyncs from actual theme + General-tab number inputs full-width (Bug 4), Danger zone buttons inconsistent (Bug 5). Captured in V2-State.md "Known visual bugs (deferred)" with reproduction context and fix-direction hints. None block functionality — parked until light-mode polish settles. Also updated the dark-mode QA bullet to reference Bug 4 as the canonical instance, and the final-mile cherry-pick bullet to drop `422c2ff` from the skip-cycle entry (the hook port already landed via PR #24).
  - Modified: `wiki/V2-State.md`

- feat(ui): v2 Anthropic key entry + status check in AI tab [S]
  - **Why.** Ship-blocker. AI tab had a "Open v1 → AI" punt button for the entire API-key flow; users couldn't configure Claude from v2 at all. Notion/Trello-class punts make sense (heavy OAuth flows); Anthropic doesn't (pure key entry).
  - **`AnthropicKeyBlock`.** New sub-component in the AI tab. Loads `getKeyStatus()` on mount to detect `ANTHROPIC_API_KEY` env var. If env-set: read-only notice + a Test button. If user-set: password input (with show/hide toggle for verifying paste), Test button, Disconnect button (clears the key + resets status). Test calls `api.callClaude('Respond with just "ok".', 'ping')`. Status states: null / 'checking' / 'connected' / 'error', surfaced as a live status line below the controls.
  - **Integrations panel split.** Anthropic row in IntegrationsPanel previously had its own inline api-key input (duplicating what the AI tab now has). New `manageInTab` field on the integration descriptor — Anthropic's row now reads "Configure in AI" and clicking flips the active tab. `setActiveTab` threaded into IntegrationsPanel.
  - **OAuth-deferral copy updated.** The intro hint at the top of Integrations now reads "Anthropic is configured in the AI tab. Simple key-only integrations (17track, Pushover) can be set inline below."
  - **Model picker dropped.** Original ship-blocker text said "API key entry + model picker + status check." Dropped the picker — server-side `ADVISER_MODEL` and all other call sites are hardcoded today, so there's nothing for a UI picker to drive. Easy to add later if model selection becomes user-controllable.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 707KB precache (up from 705KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 Pushover credential entry + test buttons in Integrations [S]
  - **Why.** Pushover can't be set up from v2 at all today — clicking the row just punted to v1. But Pushover is credential-only (user_key + app_token, no OAuth flow), so the v1 punt was overkill. Ship-blocker on the v2 polish list.
  - **Inline form.** Reclassified Pushover from OAuth-deferred to `inline: 'pushover'` in `IntegrationsPanel`. Two password inputs (user_key + app_token), with the app_token field placeholder + disabled state respecting `pushoverStatus.app_token_from_env`. Hint copy points users at the Notifications tab for type-by-type Pushover toggles.
  - **Test buttons.** "Test" (priority-0, fires immediately) and "Test emergency" (priority-2, opens a v2 confirm dialog first since it triggers the bypass-DND alarm). Both show transient sending → sent ✓ → idle states; errors render inline in v2-alert-overdue red. Wired through dynamic-imported `testPushover` / `testPushoverEmergency` from api.js so the panel doesn't pull the test functions into the main bundle.
  - **OAuth-deferral copy updated.** "OAuth-heavy integrations" line at the top + "OAuth flows for Notion / Trello / Google Calendar / Gmail / Pushover" line at the bottom both drop Pushover from the punt list. Anthropic + 17track + Pushover are now the three inline-credential integrations.
  - **CSS.** `.v2-integrations-inline` now flex-column with gap so multiple inputs stack cleanly. New `.v2-integrations-actions` (flex row, wraps) and `.v2-integrations-error` (small alert-red copy).
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 705KB precache (up from 703KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 search bar + results view [S]
  - **Why.** Daily-use ship-blocker. v1 had a magnifier in the header; v2 had nothing — users had to flip back to v1 to find an old task by keyword.
  - **Search lives in TaskListToolbar.** Added a Search icon button next to the sort button. Click flips the toolbar into search mode: pills + sort + search-icon hidden, replaced by a Search-icon-prefixed input + X close button in the same row real estate (no layout shift). Esc closes too.
  - **Debounced fetch.** AppV2 owns `searchOpen` / `searchQuery` / `searchResults`. `handleSearchChange` debounces 300ms then hits `GET /api/tasks?q=<query>` (same endpoint v1 uses; covers every task — active, done, backlog, project). `searchResults === null` means "search mode active, but no query / not yet fetched"; an empty array means "no matches"; a populated array renders.
  - **Results render.** When `searchOpen`, the regular section list is replaced by a single SectionLabel ("N result(s)") + TaskCard list. Wired through the same TaskActionsContext-style handlers as the regular list — Complete / Edit / Snooze all work from results.
  - **Empty states.** "Type to search" while idle, "No matches" when the query returns nothing.
  - **`onCloseSearch`.** Resets query + results + clears the debounce timer. Toolbar still renders even when there are zero tasks if search is open (so the close button is reachable).
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 703KB precache (up from 701KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/TaskListToolbar.jsx`, `src/v2/components/TaskListToolbar.css`, `wiki/V2-State.md`

- feat(ui): v2 TaskListToolbar — sort dropdown + tag filter pills [M]
  - **Why.** v2's task list was hardcoded to `'age'` sort with no filter UI — every-page gap that pushed users back to v1 just to focus on a tag or change the sort key. Last two ship-blockers from the v2 polish list landed together since they share the toolbar surface.
  - **New `TaskListToolbar` component.** `src/v2/components/TaskListToolbar.{jsx,css}`. Renders above the task list (and above KanbanBoard on desktop). Horizontal pill row: All + each user label + Routines (visual divider, opens RoutinesModal). Active label pill takes the label's color. Sort dropdown on the right: ArrowUpDown icon → menu with age / due-date / size / name. Click-outside closes. Pills row scrolls horizontally without a visible scrollbar when overflowing.
  - **AppV2 wiring.** Three new state pieces — `activeFilter` (default `'all'`), `sortBy` (initialized from `settings.sort_by` or `'age'`), `labels` (lifted up so the toolbar sees user-edited labels — settings close handler refreshes via `setLabels(loadLabels())`; cross-client hydrate also pushes new labels into state). `filterTasks(list)` filters on `tag` membership. All seven section arrays (doing/stale/up next/waiting/snoozed/backlog/projects) now go through `filterTasks` then `sortTasks(_, sortBy)`. Projects keeps its `name` sort when sortBy is `'age'` (visual consistency with v1 — projects lean alphabetical).
  - **Persistence.** `handleSortChange` writes `settings.sort_by` and triggers a sync flush so the change rides the standard server path. Filter is in-memory (matches v1 — same intent, transient view state).
  - **Empty-state nuance.** When filter is active and yields zero matches, the empty state copy switches to "No tasks match this filter" with a "Show all" CTA that resets the filter. When unfiltered list is genuinely empty, the original "Nothing on your plate" + "Add task" message stays.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 701KB precache (up from 697KB — new component + CSS).
  - New: `src/v2/components/TaskListToolbar.jsx`, `src/v2/components/TaskListToolbar.css`
  - Modified: `src/v2/AppV2.jsx`, `wiki/V2-State.md`

- feat(ui): v2 RoutinesModal — skip-this-cycle button [S]
  - **Why.** Top ship-blocker on the v2 polish list. Without it, vacation/illness/"the lawn doesn't need mowing this week" forces the user to spawn-now then immediately complete, which both pollutes the active task list and double-counts the cycle. Main has the feature (commit `422c2ff`, 2026-05-09 earlier in the day); dev didn't pick it up because the original landing path was a failed merge that was reverted before reaching dev.
  - **Hook port.** Ported `skipCycle(routineId)` callback from main's `useRoutines.js` verbatim. Stamps `completed_history` with `now()` so `getNextDueDate()` rolls forward by one cadence interval. No DB schema change, no server endpoint — pure local-state mutation flushed via the existing routine sync. Skips count toward the "Nx completed" total — close enough for a personal app, no separate skip log.
  - **v2 wiring.** `AppV2.jsx` destructures `skipCycle` from `useRoutines()` and passes `onSkipCycle={skipCycle}` into `<RoutinesModal>`. `RoutinesModal.jsx` adds `FastForward` lucide import, threads `onSkipCycle` through both `RoutineRow` (active and paused lists) and the modal-level component, and renders a "Skip cycle" action button right next to "Spawn now" in the expanded routine card. Title attribute: "Skip this cycle (advance schedule, no task)".
  - **Hidden for paused routines.** Same logic v1 uses — paused routines don't have a current cycle to skip, so the button doesn't render when `routine.paused` is true. Spawn now stays available since you can still ad-hoc spawn from a paused routine.
  - **v1 untouched.** `src/AppV1.jsx` and `src/components/Routines.jsx` deliberately not changed. v1 on dev stays as the legacy escape hatch (per the v2 plan, v1 is frozen and gets deleted in the final-mile cleanup). The cherry-pick from main that brought App.jsx + v1 Routines.jsx changes was aborted because dev's App.jsx is now the thin router, not the v1 component.
  - **Verification.** `npm run lint` clean (warnings only), pre-push smoke test passes.
  - Modified: `src/hooks/useRoutines.js`, `src/v2/AppV2.jsx`, `src/v2/components/RoutinesModal.jsx`, `wiki/V2-State.md`

- docs: lock in MCP PR-and-merge as canonical dev workflow [S]
  - **Why.** Direct `git push origin dev` is still 403'ing on the local proxy as of 2026-05-09 (re-tested today, same error as 2026-05-03). Ref deletions also 403. Rather than treat the workaround as a temporary fallback, the MCP-PR-and-rebase-merge loop is now the documented canonical workflow until/unless the proxy bug gets diagnosed. Fully automated end-to-end with no GitHub-UI clicks — verified by PR #22, which exercised the entire loop including the auto-delete-on-rebase-merge behavior.
  - **`CLAUDE.md` Git Rules rewrite.** Rule 1 changed from "ALWAYS push to main" (the v1-era directive) to "`dev` is active; `main` is production." Rule 2 renamed from "never push without approval" to "never merge a PR without approval" — same intent, current mechanics. Rule 3 swapped `git pull origin main` for `git fetch && checkout dev && reset --hard origin/dev`. Rule 6 split push-triggers-build into "merge to dev/main triggers Docker build." New "Workflow: how dev work lands" subsection captures the 6-step loop verbatim.
  - **`wiki/V2-State.md` updates.** Replaced the stale "Branch / merge instructions" section (which still referenced `claude/v2-pending-merge` as if it were a live branch) with a generalized "How work lands on dev" how-to. Updated "Why this branch instead of direct push" → "Why MCP PR-and-merge instead of direct push" with current bug status. TL;DR section now calls out the workflow as locked in. Final-mile cleanup updated: removed npm-audit (already cherry-picked), kept the remaining main-only commits as separate cherry-pick targets, added a note about the stranded `test-push-probe` ref.
  - **Branch hygiene.** `claude/v2-cherry-npm-audit` auto-deleted on PR #22 rebase-merge. `claude/v2-polish-session-HTNSN` deleted locally (was at `dfb27fc`, no unique commits). Stale `origin/claude/v2-cherry-npm-audit` tracking ref pruned via `git fetch --prune`. `test-push-probe` on origin can't be deleted via proxy or MCP — flagged for user to delete via GitHub UI.
  - Modified: `CLAUDE.md`, `wiki/V2-State.md`, `wiki/Version-History.md`

- feat(ui): v2 EditTaskModal — multi-list checklists [M]
  - **Why.** Biggest daily-use gap in v2 EditTaskModal — no way to add/manage checklist items, so users had to flip back to v1 to edit any task with a checklist. Ships the multi-list shape v1 already uses (`task.checklists = [{ id, name, items: [{id,text,completed}], hideCompleted }]`). Migration 018 promoted `task.checklist_items` → `task.checklists` server-side; v2 TaskCard count was reading the legacy field — also fixed.
  - **Scope.** Add/rename/delete checklists, add/check/rename/delete items, hide-completed toggle (+ "N completed hidden" footer), per-list progress bar, "Add another checklist" affordance. Modeled on v1's section but with the v2 hairline + accent palette.
  - **Deferred (vs v1).** Drag-drop reorder of items within a list and reorder of lists themselves. Use case is rare enough to defer; if it gets missed, can come back as a separate commit. The data shape is identical so reorder UI can drop in without migrations.
  - **TaskCard fix.** v2 TaskCard expanded view summary now reads from `task.checklists` (sums items across all lists) instead of the legacy `task.checklist_items`. Renders correctly for the new shape.
  - **`handleSave`.** Serializes `checklists` into the patch sent to the shared `updateTask`. No server-side change — same shape v1 saves.
  - **Verification.** `npm run build` clean (852KB precache), `npm run lint` clean, `npm test` smoke test passes.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/v2/components/TaskCard.jsx`

- chore(deps): clear 2 high-severity npm-audit vulnerabilities [XS]
  - `fast-uri` 3.1.0 → 3.1.2 (path-traversal + host-confusion via percent-encoded sequences; transitive via ajv → MCP SDK).
  - `@babel/plugin-transform-modules-systemjs` 7.29.0 → 7.29.4 (arbitrary code generation on malicious input; transitive via vite-plugin-pwa workbox; build-time only).
  - `npm audit` clean afterward. Smoke test passes.
  - Cherry-picked from main onto dev as the proxy-push diagnostic payload (2026-05-09 session).
  - Modified: `package-lock.json`

---

## 2026-05-08

- fix(db): delete legacy tasks/routines JSON-blob ghost-revive path [S]
  - **Why.** Post-incident audit flagged `seedFromJsonBlobs()` in `db.js` as a ghost-revive vector. On every server boot, if the SQL `tasks` / `routines` tables were empty, the function read `app_data.tasks` and `app_data.routines` JSON blobs and re-populated the SQL tables. That blob hadn't been written to since migrations 002 + 003 landed months ago — anything in it was a months-stale snapshot. Any future event that emptied the SQL tables (corruption, accidental drop, restore-with-empty-arrays) would silently re-hydrate from this stale snapshot instead of surfacing the failure obviously.
  - **Removed:** `seedFromJsonBlobs()` function, the `seedFromJsonBlobs()` call from `initDb()`, and the `if (row.collection === 'tasks' || row.collection === 'routines') continue` skip clauses in `getAllData()` (no longer needed once the legacy rows are gone).
  - **Added migration 022** (`migrations/022_drop_legacy_task_routine_blobs.sql`) — `DELETE FROM app_data WHERE collection IN ('tasks', 'routines')` to clean up the orphan rows.
  - **Verified.** Smoke test passes. Bundle parses. Server boots clean (migration 022 runs once, deletes the rows, marks itself complete).
  - Modified: `db.js`, `wiki/Architecture.md`
  - New: `migrations/022_drop_legacy_task_routine_blobs.sql`

- fix(ui): v2 SettingsModal restore uses in-app confirm modal [XS]
  - Mirror of the v1 change. v2 already had a `confirmDialog` state pattern matching v1's, so the swap is purely call-site — replace browser-native `confirm()` in `handleImportData` with `setConfirmDialog()`. Invalid JSON and restore failures also surface in-app now.
  - Modified: `src/v2/components/SettingsModal.jsx`

- fix(settings): use in-app confirm modal for restore-from-backup [XS]
  - The restore confirmation was using browser-native `confirm()`, which on iOS shows the awkward "[hostname] says..." prefix and doesn't match the rest of the app. `Settings.jsx` already has a `confirmDialog` state pattern with matching markup at the bottom of the component — wired the restore flow to use it. Bonus: invalid-JSON and restore-failure paths also use the modal now instead of `alert()`.
  - Modified: `src/components/Settings.jsx`

- fix(ci): bump tag on refactor/perf/chore commits, expand restoreFromBackup doc [XS]
  - The previous `custom_release_rules` listed only `feat`/`fix`/`breaking`/`major`/`minor`/`patch`. Today's `refactor(server)` commit didn't bump the tag because `refactor` wasn't mapped — workflow ran but produced no new image. Added `refactor`, `perf`, `chore`, `style`, `docs`, `test` all → `patch` so future non-feat/non-fix commits trigger deploys reliably. Doc expansion on `restoreFromBackup` in `src/api.js` is the trigger to bypass `paths-ignore` (`.github/**` is ignored, so a workflow-only change wouldn't fire CI).
  - Modified: `.github/workflows/build-and-publish.yml`, `src/api.js`

- refactor(server): retire bulk task/routine/package writes, add restore endpoint [M]
  - **Why.** Post-incident audit found that `setAllData()` still routed `tasks`/`routines`/`packages` keys through `syncTasksFromArray()` / `syncRoutinesFromArray()` / `syncPackagesFromArray()` — bulk delete-and-replace helpers that were the wipe vector. Today's earlier fix added a 409 guard against empty/>50%-shrink task arrays, but routines had **no shrink guard at all**, and a future regression could re-introduce the same bug at any scale.
  - **Server-side closure.** `setAllData()` now throws if it sees a `tasks`/`routines`/`packages` key. `PUT/POST /api/data` reject those keys at the request level with 400 + clear `bulk_path_does_not_accept_arrays` error. Bulk path is settings + labels only. `syncTasksFromArray` / `syncRoutinesFromArray` / `syncPackagesFromArray` deleted entirely (~80 lines of dead code).
  - **New `POST /api/data/restore` endpoint.** Explicit wipe-and-replace semantics for backup restoration. Requires `confirm: "wipe-and-replace"` in body. Replaces tasks and routines per-record (delete-then-upsert), overwrites settings + labels blobs. Does NOT touch OAuth tokens, push subscriptions, notification logs, weather cache, adviser chats, or any other infrastructure — restore is intentionally narrower than the old `PUT /api/data` flow which would silently nuke OAuth tokens etc via `clearAllData()` then write whatever was in the backup.
  - **Settings UI updated.** Both `Settings.jsx` and `v2/SettingsModal.jsx` `handleImportData` now call `restoreFromBackup()` from `api.js` (which hits the new endpoint with the confirm field). UI also shows a confirmation dialog with task/routine counts before restoring. Previous implementation was silently broken anyway — it sent the bulk PUT without `_clientId`, which `guardStaleClient` rejected as no-op, so nothing was actually being restored.
  - **`seed.js` updated.** Test seed (`SEED_DB=1`) was the last legitimate caller of bulk task/routine writes. Now uses `upsertTask` / `upsertRoutine` per record, `setData` for settings/labels blobs.
  - **Verified.** `node --check` clean across `seed.js`, `server.js`, `db.js`, `src/api.js`, `src/components/Settings.jsx`, `src/v2/components/SettingsModal.jsx`. Smoke test passes.
  - Modified: `db.js`, `server.js`, `seed.js`, `src/api.js`, `src/components/Settings.jsx`, `src/v2/components/SettingsModal.jsx`

- fix(sync): strip tasks/routines from bulk PUT — close the wipe vector client-side [S]
  - **Why.** The 2026-05-07 wipe was a 3-layer failure: Portainer bouncing the container, client hydrate-then-flush race, server bulk-PUT with no destructive-write guard. The server guard from earlier today closes layer 3. This commit closes layer 2 — the client no longer puts the entire tasks/routines arrays into the bulk PUT payload at all. The class of bug is gone from the client side, server guard becomes belt-and-suspenders rather than the only line of defense.
  - **Change.** `buildPayload()` in `src/hooks/useServerSync.js` no longer reads tasks/routines. The bulk PUT carries only `settings` and `labels` (which still live as JSON blobs in `app_data`). All four call sites updated: `pushBulkState`, `pushChanges` no-prev fallback, `fetchAndHydrate` empty-server branch, and the `beforeunload` handler.
  - **`pushChanges` no-prev fallback hardened.** Previously, when `prevTasks`/`prevRoutines` were null (hydrate hadn't completed yet), pushChanges fell back to `pushBulkState(tasks, routines)` which sent the unverified local state to the server. That was the exact wipe vector. Now: skip the push entirely with a log line — local state isn't authoritative until hydrate succeeds. Settings/labels changes still flush via the manual `flush()` path.
  - **Lost capability.** The "server empty, push local state" fallback in `fetchAndHydrate` now only seeds settings/labels — not tasks/routines. In practice this branch was dead code (server always responds with at least `_version`) so the loss is theoretical. Per-record `/api/tasks` API remains the supported path for legitimate task creation.
  - Modified: `src/hooks/useServerSync.js`

- fix(ci): pipeline now logs Portainer response + verifies deploy actually landed [S]
  - **Why.** Even with the fail-loud fix from earlier today, a successful workflow only proves the webhook returned 2xx — it doesn't prove the container actually redeployed. After Portainer self-updates (like the 2026-05-06 23:54:47 bounce that triggered the wipe), the stack's webhook URL can change, the auto-update-on-webhook flag can reset, or the registry-pull policy can be wrong. Workflow goes green, image sits in GHCR, container keeps running stale code.
  - **Diagnostic logging.** The Trigger Portainer step now captures the webhook's HTTP status and response body and prints both. Non-2xx fails the step with a hint to re-check the webhook URL secret + Portainer's auto-update setting.
  - **End-to-end verify.** New "Verify deploy" step polls a `HEALTH_CHECK_URL` (or `HEALTH_CHECK_DEV_URL` for dev) every 20s for up to 2 minutes, checking that `/api/health` reports the expected `appVersion`. Fails the workflow if the server hasn't picked up the new image. Skipped silently if the secret isn't set, so this opts in cleanly per environment.
  - Modified: `.github/workflows/build-and-publish.yml`, `.github/workflows/build-and-publish-dev.yml`

- fix(ci): Portainer auto-deploy fails loudly instead of skipping silently [XS]
  - **Bug.** When Tailscale failed to connect (OAuth secret stale, network blip, anything), the workflow swallowed the error (`continue-on-error: true` on the Tailscale step) and the Portainer redeploy step was silently skipped via the `steps.tailscale.outcome == 'success'` gate. Workflow showed green, image was in GHCR, but the running container never got the new image. Bit us with v0.97.9 where the build succeeded but Portainer never redeployed — old container kept running stale code until a manual pull.
  - **Fix.** Portainer step now runs unconditionally on main pushes (and dev pushes). If Tailscale didn't succeed, it emits `::error::` with a clear message and exits 1, turning the workflow red. Image publish is unaffected (Tailscale step still has `continue-on-error: true`, so transient infra failures don't block image builds).
  - Modified: `.github/workflows/build-and-publish.yml`, `.github/workflows/build-and-publish-dev.yml`

- chore(test): clean up backup file leftovers from smoke test [XS]
  - After the daily DB snapshot landed, every `sh scripts/smoke-test.sh` run leaves a `test-smoke.db.YYYY-MM-DD.bak` in the repo root because the new `runBackup()` runs on server boot. Updated the smoke test's `cleanup()` trap to remove `test-smoke.db.*.bak` alongside `test-smoke.db`. Added `*.db.*.bak` to `.gitignore` as a safety net.
  - Modified: `scripts/smoke-test.sh`, `.gitignore`

- chore(deps): clear 4 moderate npm-audit vulnerabilities [XS]
  - `npm audit fix` resolved 4 moderate transitive vulnerabilities — `ip-address` (XSS in unused Address6 HTML methods), `express-rate-limit` (depended on the bad ip-address), `hono` (bodyLimit bypass for chunked requests), `postcss` (XSS via unescaped `</style>` in CSS Stringify, build-time only). All four resolved by lockfile updates only — no `package.json` change. Smoke test green.
  - Modified: `package-lock.json`

- fix(server): guard bulk PUT/POST `/api/data` against destructive task wipes [M]
  - **Bug.** On 2026-05-07 a client opened the app, its initial `GET /api/data` failed with `Load failed`, so the local task list was empty (0 tasks). The user changed a setting/label which triggered the existing "manual flush" code path, which issues a bulk `PUT /api/data` containing the **entire** local tasks array. The server's `setAllData` → `syncTasksFromArray` deletes every existing row whose ID is missing from the incoming array. Result: 153 tasks → 0. Stale-version guard didn't catch it because the client's `_version` matched the server's at push time.
  - **Fix.** New `guardBulkTaskWrite(req, res)` helper in `server.js` runs before `setAllData` on both PUT and POST `/api/data` handlers. Rejects with HTTP 409 when:
    - `body.tasks` is an array, AND
    - `existingCount > 0`, AND
    - either `incoming.length === 0` (any non-empty → empty wipe), OR
    - `existingCount >= 10 && incoming.length < existingCount * 0.5` (>50% shrink, with a 10-row floor so small task lists aren't false-positives)
  - Settings-only pushes (no `tasks` key in the body) are unaffected. Per-record `/api/tasks` mutations are unaffected — they're the supported path for legitimate bulk deletes.
  - Modified: `server.js`

- feat(ops): nightly DB snapshot + recovery script [M]
  - **`scripts/backup-db.js`** — copies `$DB_PATH` to `${DB_PATH}.YYYY-MM-DD.bak` once per day, prunes snapshots older than `BACKUP_RETENTION_DAYS` (default 7). Idempotent — re-running the same day is a no-op. Importable (`runBackup()`) and CLI-runnable.
  - **Wired into `server.js`** — runs once on boot, then every 24h via `setInterval`. Failures log to console but never crash the server.
  - **`scripts/recover-from-notification-log.js`** — read-only diagnostic. Queries `notification_log` (which survives `setAllData` since it's not in the bulk-PUT collection list) for distinct `task_id` rows with most-recent title, channels, count, and a flag indicating whether each task ID is still present in the live `tasks` table. Used to recover task titles + IDs after the 2026-05-07 wipe. Outputs human-readable text by default; `--json` for machine consumption.
  - Both scripts ship via the existing `COPY scripts ./scripts` line in the Dockerfile — no Dockerfile change needed.
  - New: `scripts/backup-db.js`, `scripts/recover-from-notification-log.js`
  - Modified: `server.js`

- fix(logging): ISO timestamps on every server log line [XS]
  - **Why.** Triaging the 2026-05-07 wipe was harder than necessary because the terminal log lines had no timestamps. Couldn't tell when the empty PUT happened, couldn't measure debounces, couldn't correlate across services.
  - **Fix.** The `console.log/.error/.warn` wrappers in `server.js` now prepend `[ISO-8601]` to the args passed to the underlying console call. Format: `[2026-05-08T14:23:01.123Z] [SYNC] push: ...`. The in-memory `serverLogs` buffer (exposed via `/api/logs`) was already timestamped per-row, so its shape is unchanged.
  - Modified: `server.js`

---

## 2026-05-03

- fix(ui): v2 light-mode bg goes pure white + desktop modals slide in as right drawers [S]
  - **Bug 1 — light bg too creamy.** `--v2-bg: #FAFAF7` had a faint warm/yellow tint that read as off-white instead of clean white. Switched to `--v2-bg: #FFFFFF`. Cards keep `--v2-surface: #FFFFFF` so they blend with the page bg, with hairline borders + subtle shadows doing the structural separation work — Wheneri-aesthetic. Dark mode untouched.
  - **Bug 2 — desktop modals floated unmoored.** All v2 modals on desktop appeared as centered floating sheets, which the user described as "mobile pop-overs that don't attach to anything." Switched the desktop ModalShell behavior (≥768px, matching `useIsDesktop`) to right-side drawers: `align-items: stretch; justify-content: flex-end` puts the modal flush against the right edge, full-viewport-height, with only the left corners rounded (`20px 0 0 20px`). Soft-dim overlay (rgba 0.30) so the main task list stays partially visible behind. Slide-in animation translates from `100%` to `0` over `--v2-dur-emphasis`.
  - **Width caps preserved.** `width: narrow` drawers cap at 480px; `width: wide` drawers cap at 640px (down from 720px so the drawer doesn't dominate). Width 100% within the cap so they always span the right side.
  - **Mobile unchanged.** Below 768px, modals stay as bottom-sheets sliding up from the bottom — the original mobile-first behavior.
  - **Verification.** `npm run build` clean (842KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: on desktop, tap any header icon → modal slides in from the right edge, attaches there, dim overlay reveals task list behind. On mobile, modals still bottom-sheet up.
  - Modified: `src/v2/tokens.css`, `src/v2/components/ModalShell.css`

- fix(ui): v2 header — equal-size action circles + colored destination icons [XS]
  - **Bug 1.** "What now?" target circle was 36px tall while the "+" circle was 38×38, and on narrow screens (≤480px) the target collapsed to icon-only with horizontal padding instead of becoming a perfect circle. Result: two adjacent orange circles that visibly didn't match. Fixed: bumped What-now? to 38px height across all viewports; on narrow screens it now switches to `width: 38px; padding: 0` so the orange "+" and orange target read as identical visual weight.
  - **Bug 2.** v1 header has tinted icons (`packages-color: #F59E0B`, `adviser-color: #A78BFA`) so Quokka/Packages stay recognizable at a glance. v2 had stripped them to plain `--v2-text-meta` grey, merging them into the icon row. Fixed: ported the same color values as `.v2-header-icon-quokka` (purple) + `.v2-header-icon-packages` (amber). Hover state shifts to a soft tinted background of the same hue.
  - **Bonus.** Same color hint pattern brought into the More-menu rows: Projects purple, Routines green, Done green, Analytics blue. Settings + Activity log stay neutral grey since they're meta-actions.
  - **Verification.** `npm run build` clean, `npm run lint` clean, `npm test` smoke test passes. Manual: header circles match in size on phone + desktop; Quokka + Packages icons are tinted; ⋯ menu rows show the brand color cues.
  - Modified: `src/v2/components/Header.jsx`, `src/v2/components/Header.css`, `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- feat(ui): v2 Integrations status panel (PR8e of 8) [M]
  - **Why.** Last placeholder Settings tab. Full OAuth flows for Notion / Trello / GCal / Gmail / Pushover each have 4–8 UI states (consent prompt, callback, picker, scope error, env-var override, disconnect confirm) — duplicating that for v2 isn't worth the maintenance burden when the resulting tokens are already shared between v1 and v2 anyway. PR8e ships a status-summary panel that covers the 80%: see what's connected, set simple key-only integrations inline, click through to v1 for OAuth-heavy flows.
  - **`IntegrationsPanel`** in SettingsModal. Status row per integration: green-glow dot (connected) or muted dot (unconfigured) + name + email/account sub-line where applicable + brief capability hint + Manage/Connect-in-v1 button. Seven entries: Anthropic, Notion, Trello, Google Calendar, Gmail, 17track, Pushover.
  - **Inline credential entry for key-only integrations.** Anthropic + 17track expose a password input field directly. Both check `getKeyStatus()` for env-var override; when the env var is present, the field is replaced with a "Provided via env var, configure server-side" notice (read-only).
  - **Connection-status fetch.** Mounts hit `getKeyStatus()` + `notionStatus()` + `trelloStatus()` + `gcalStatus()` + `gmailStatus()` + `pushoverStatus()` in parallel via dynamic imports (matches v1 lazy pattern; failures silent so dots fall back to grey). Pushover uses `configured` flag; others use `connected`.
  - **OAuth deferral copy.** Bottom of the tab explains why OAuth flows live in v1 + reassures users that tokens are shared so connecting once benefits both interfaces.
  - **PLACEHOLDER_TABS now empty.** All 8 Settings tabs have v2 implementations as of this commit. Beta tab still shows the v1↔v2 toggle.
  - **Verification.** `npm run build` clean (840KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: Settings → Integrations → see all seven rows with status dots. Connected ones glow green; unconfigured ones are grey. Anthropic + 17track accept inline keys (with env-var override note when relevant). Connect/Manage buttons flip back to v1 for the OAuth cases.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `CLAUDE.md`

- feat(ui): v2 Notifications tab (PR8d of 8) [M]
  - **Why.** Second-to-last placeholder Settings tab. The full v1 Notifications tab is 600+ lines (test buttons, digest config, adaptive throttling, Pushover priority routing, weather notifications, deliverability overrides). v2 ports the most-touched controls and points at v1 for everything else.
  - **`NotificationsPanel`** in SettingsModal. Three sections: **Channels** (master toggles for web push / email / Pushover with hint copy), **Notification types** (compact per-type × per-channel matrix table with freq input — Overdue / Stale / Nudges / Size-based / Pile-up + Package delivered / Package exception across Push / Email / Pushover, individual toggles disabled when their channel master is off), **High-priority escalation** (master toggle + 3-stage frequency inputs), **Quiet hours** (master toggle + start/end time inputs + bypass-label override).
  - **Defer pointer.** Bottom of the tab calls out morning digest config, channel test buttons, notification history, adaptive throttling controls, and Pushover priority routing as v1-only for now.
  - **Disabled toggle styling.** New `.v2-settings-toggle-disabled` class drops opacity to 0.4 + disables pointer events when a row's parent channel master is off — same UX hint v1 uses.
  - **Verification.** `npm run build` clean (835KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: Settings → Notifications → toggle channel masters, watch dependent toggles enable/disable. Edit a freq input — auto-saves with the standard 300ms debounce. Quiet hours expand on enable.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`

- feat(ui): v2 Labels CRUD tab (PR8c of 8) [S]
  - **Why.** Labels was one of the three remaining placeholder tabs in v2 Settings (along with Integrations + Notifications). Most-used of the three — users add/rename/recolor tags routinely.
  - **`LabelsPanel`** in SettingsModal. Hairline-row list: each label has a color swatch (clickable `<details>` reveals a 5-column color picker grid using shared `LABEL_COLORS`), inline-editable name input, up/down reorder arrows, and a delete button with inline confirm. Add row at the bottom: color picker + name input + Add button. Auto-cycles to the next color after each add (same UX v1 has).
  - **What's NOT in v2 Labels (vs v1):** drag-drop reordering. Up/down arrows are simpler and reliable across mobile + desktop without the touch-event juggling v1 needs.
  - **Verification.** `npm run build` clean (826KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: Settings → Labels → swatch opens color picker, name edits inline, arrows reorder, delete asks for confirm. Add a new label cycles through colors. New labels show up in the task-card filter pills.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`

- feat(ui): v2 swipe-to-reveal task actions on mobile (PR8b of 8) [S]
  - **Why.** v2 TaskCard required tap-to-expand → tap action button to do anything other than read. Mobile one-handed use suffered. v1 has full swipe gestures (left → reveal Edit + Complete, right → delete). v2 ports a leaner version: swipe-left only.
  - **Approach.** Each TaskCard owns its own swipe state. `touchstart` records origin + base swipeX; `touchmove` translates the card horizontally if horizontal motion dominates (vertical scroll wins after >12px); `touchend` snaps to either the open position (-120px revealing the action panel) if past the 60px threshold, or back to 0. Action panel sits absolutely-positioned behind the card on the right, clipped by the swipe wrap's `overflow: hidden`. Tap the card while swipe is open → close swipe; tap a revealed button → execute action + close.
  - **Two actions only: Edit + Done.** v1 has a swipe-right-to-delete; v2 keeps destructive actions explicit (Delete lives in EditTaskModal with an inline confirm). Edit button is a soft-grey panel; Done is the primary accent fill. Both 80px wide, full-card-height, with a label + icon stacked vertically.
  - **Animation.** While dragging, the card has `transition: none` so it tracks the finger 1:1. On release, the v2 standard easing kicks back in for the snap. Same pattern v1 uses but with the v2 motion tokens.
  - **Verification.** `npm run build` clean, `npm run lint` clean, `npm test` smoke test passes. Manual: on mobile, swipe a card left → Edit + Done panel reveals → tap Done → task completes + toast shows. Swipe back right or tap card → closes. Vertical scroll past the card does not start a horizontal swipe.
  - Modified: `src/v2/components/TaskCard.jsx`, `src/v2/components/TaskCard.css`

- feat(ui): v2 Trello status push + weather badges on TaskCard (PR8a of 8) [S]
  - **Why.** Two finishing touches deferred from earlier PRs. Trello-linked tasks weren't pushing status changes from v2 (cards stayed put on the Trello board even after the task moved here). Weather badges were absent from v2 cards even though the data is already cached server-side.
  - **`src/v2/components/WeatherBadge.jsx`.** Direct port of v1's WeatherBadge — same WMO-code → emoji + label table. Renders a small `🌧️ 65°` chip in the meta line for tasks with `due_date` in the cached forecast window. Hover/aria title carries condition + precipitation %.
  - **TaskCard wiring.** New `weatherByDate` prop (the same `byDate` shape v1 uses). Renders the badge in the meta row with a bullet separator. Plumbed through KanbanBoard and ProjectsView so it shows everywhere v2 renders cards.
  - **AppV2 — `useWeather` + `useTrelloSync`.** Hook calls added at the App level (matching v1 placement). Weather data flows down to all card-rendering surfaces. Trello sync exposes `pushStatusToTrello` for the action handlers.
  - **`handleComplete` / `handleStatusChange` / `handleUncomplete` / `handleDelete`.** Each now mirrors v1's full Trello chain: `done` on complete, the new status on status-change, `not_started` on uncomplete, and `closed: true` (archive) on delete via `trelloUpdateCard`. All gated on `task.trello_card_id` so non-linked tasks are unaffected. EditTaskModal's onDelete now routes through the new `handleDelete` so delete-from-edit also archives Trello.
  - **What's NOT in PR8a.** GCal status push on complete (`useExternalSync` already handles GCal event removal via `gcal_remove_on_complete` setting — works automatically; no extra wiring needed). Notion status push (Notion DBs don't have a universal status column; v1 doesn't push either).
  - **Verification.** `npm run build` clean (818KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: complete a Trello-linked task in v2 → card moves to the done list on the Trello board. Tasks with due_date in the next 7 days show a weather badge in the meta line. Drag-status-change on Kanban also pushes to Trello.
  - New: `src/v2/components/WeatherBadge.jsx`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/{TaskCard.jsx,TaskCard.css,KanbanBoard.jsx,ProjectsView.jsx}`

- feat(ui): v2 Toast + routine completion logging (PR7 of 8) [M]
  - **Why.** v2 was completing tasks silently — no feedback toast, no Undo, no "next up" suggestion. Routine cadence wasn't advancing on complete because v2's handleComplete didn't call `completeRoutine` (deferred from PR3 with a TODO). PR7 closes both gaps + adds the v2 Toast component.
  - **`src/v2/components/Toast.jsx` + `.css`.** Direct port of v1's Toast logic with v2 styling. Same static-message tiers (quick / normal / long / reopen) + AI-rewrite override via `task.toast_messages`. Same `computeTaskPoints` integration so the subtitle reads "Same-day finish · +12 pts". Same auto-dismiss timing (4s, 8s with next-task suggestion). Same Undo affordance for completes. Visual: pill-shaped, fixed bottom-center, dark-text-on-bg surface (or accent on reopen variant), slides up via `--v2-ease-emphasis`/`--v2-dur-emphasis`.
  - **AppV2 `handleComplete` rebuild.** Now mirrors v1's full chain: complete the task, close WhatNow if open, log completion on the parent routine via shared `completeRoutine` (this fixes the cadence bug — routines weren't advancing for tasks completed in v2), score next-best candidate (high_priority +100, due-today/overdue +50, XS/S +20 — same heuristic v1 uses), set toast with the completed task + next-task suggestion. Trello status push on complete is still deferred to PR8 (needs `useTrelloSync`).
  - **AppV2 `handleUncomplete` rebuild.** Now sets a reopen-variant toast so the user sees "Surprise! It's back." with the task title. Trello status push back to active deferred to PR8.
  - **`todayCount` derivation.** `tasks.filter(status==='done' && completed_at on today).length` — used by the toast subtitle when more than one task has been completed today.
  - **Motion audit.** Walked every v2 CSS file. All transitions and animations already use `--v2-ease-emphasis|standard|quick` + `--v2-dur-emphasis|standard|quick`. No ad-hoc easing or duration values remain. The token discipline from PR1 held up.
  - **What's NOT in PR7:** Trello status push on complete/uncomplete, post-completion next-up navigation drawer (toast already shows the next task — separate drawer would be redundant).
  - **Verification.** `npm run build` clean (815KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: complete a task → toast slides up with witty copy + points + Undo + next-up suggestion → tap Undo or wait 4s → toast dismisses. Complete a routine-spawned task → routine `completed_history` advances and next-due ticks forward. Reopen a done task from DoneList → reopen-variant accent toast shows.
  - New: `src/v2/components/{Toast}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 KanbanBoard (desktop) + v2 default cutover (PR6 of 8) [M]
  - **Why.** v2 had no desktop affordance — the column real estate was just a wider mobile list. v1's KanbanBoard fills that gap with horizontal status columns + drag-drop. PR6 ports it. Also: user requested **v2 becomes the default** mid-build, ahead of the originally-planned 1-2 week opt-in window.
  - **`src/v2/components/KanbanBoard.jsx` + `.css`.** Six columns: Doing / Up next / Waiting / Snoozed / Backlog / Projects. Each column is a hairline-bordered tile with `--type-section` ALL-CAPS title + count chip. Empty state in each unfilled column shows "Empty" or "Drop here" when an active drag is over it. Tasks render as v2 TaskCards inside draggable wrappers — tap to expand still works, drag to a new column triggers `onStatusChange`. **Stale tasks redistribute** back into their actual status column (same logic v1 uses) so the natural status grouping is preserved on desktop. Inline `+ Add task` per column (collapses to dashed pill, expands to inline input on click).
  - **AppV2 wiring.** Imports `useIsDesktop` from the shared hook. `tasks.filter(t => t.status === 'backlog' | 'project')` derives the two extra buckets v2 doesn't render on mobile yet. Main body renders `<KanbanBoard>` when `isDesktop`, otherwise the existing mobile list. `v2-main-kanban` class disables vertical overflow on the main container so the columns can scroll horizontally if needed.
  - **v2 default flip.** `src/App.jsx readVersion()` now returns `'v2'` unless `localStorage.ui_version === 'v1'` is explicitly set. Existing users on v1 keep their preference (their flag is `'v1'`). New users + users who never opted in get v2. URL escape hatch (`?ui=v1` / `?ui=v2`) works the same.
  - **Beta-tab toggle inverted.** v2 Settings → Beta now shows "Use legacy v1 interface" with a default-unchecked toggle. Body copy: "You're on v2 — the redesigned interface. It's the default. If you want the legacy v1 interface, toggle below; you can flip back any time." Toggling on flips to v1 + reloads. v1's Beta tab toggle still works (flips to v2).
  - **What's NOT in v2 KanbanBoard yet:** virtualized rows for very long columns, mobile-drag-drop polyfill, swipe gestures inside columns. None blocking — the column drag works on desktop via native HTML5 drag.
  - **Verification.** `npm run build` clean (810KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: load on desktop → six columns render with current task buckets; drag a card across columns → status changes correctly; tap "+ Add task" inside a column → creates a task with that column's default status. Load on mobile → still the v2 list view. Default users now load v2; v1 reachable via `?ui=v1` or Settings → Beta toggle.
  - New: `src/v2/components/{KanbanBoard}.{jsx,css}`
  - Modified: `src/App.jsx`, `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `src/v2/components/SettingsModal.jsx`, `CLAUDE.md`

- feat(ui): v2 Settings General + AI + Data + Logs tabs (PR5g of 8) [M]
  - **Why.** PR5a only shipped the Beta tab. This fills out the four most-used Settings tabs in v2 idiom — General, AI, Data, Logs — so users don't have to flip back to v1 to change daily-use prefs. Labels, Integrations, and Notifications stay as guided fallbacks (heaviest tabs; Integrations alone has 6 OAuth flows; Notifications is a full type×channel matrix).
  - **General tab.** Dark-mode toggle (iOS-style track/thumb) — also re-applies `data-theme` + theme-color meta tag immediately. Default-due-days, staleness-days, reframe-threshold, max-open-tasks as narrow numeric inputs with calm hint copy. Each field auto-saves with the same 300ms debounce + flush v1 uses.
  - **AI tab.** Custom-instructions textarea (140px min) with Import / Export / Clear buttons. Hint copy explains the scope ("shapes every AI feature — task reframes, polish, what-now, Quokka tone, notification rewrites"). API-key entry ports in a later release (multi-state form: env vs user-provided, status check, model picker) — the section currently has a "Open v1 → AI" CTA pointing back.
  - **Data tab.** Backup section with Export / Import (JSON, full state). Activity-log shortcut button (closes Settings, opens ActivityLog). Danger zone in a soft-red bordered block: Clear completed (one-click) + Clear all data (opens a v2-styled confirm dialog above the modal — overlay z-index 200, 380px max-width, accent buttons). Confirm dialog reuses the v2 ModalShell visual language.
  - **Logs tab.** Inline `ServerLogsPanel` — fetches `/api/logs`, renders with v2 typography. Toolbar: Refresh (with spinner) + Copy all. Filter pills: All, Gmail, GCal, Push, Email, DB, SSE, Errors (active filter inverted to text-on-bg). Stream is a max-480px scroll area with monospace 11px font, hairline-bordered rows, alert-tinted backgrounds for warn/error. Counter at the bottom ("Showing N of M entries").
  - **Save plumbing.** `update(key, value)` writes to localStorage + debounce-flushes to server (300ms). `onFlush` prop comes from AppV2's `useServerSync().flush`. Closing the modal also flushes once for safety.
  - **Confirm dialog.** Custom v2 component rendered above ModalShell with its own overlay. Used for "Clear all data" only — exit the destructive action through an explicit acknowledgment.
  - **AppV2 wiring.** Pulled `clearCompleted` + `clearAll` out of `useTasks`, captured `flush` from `useServerSync`. SettingsModal now receives `onFlush`, `onClearCompleted`, `onClearAll`, `onShowActivityLog`.
  - **What's deferred to PR5h+.** Labels CRUD with drag-drop reorder. Integrations (Trello / Notion MCP / GCal / Gmail / 17track / Pushover OAuth + status panels). Notifications (per-channel × per-type matrix, quiet hours, digest config, Pushover priority routing). All currently render as v2-styled EmptyState pointing to the matching v1 tab.
  - **Verification.** `npm run build` clean (805KB precache), `npm run lint` clean, `npm test` smoke test passes. Manual: Settings → General toggles theme, fields auto-save with debounce. AI tab loads custom instructions, import/export work. Data tab exports a JSON file with tasks+routines+settings+labels; Clear all opens the confirm dialog. Logs tab fetches the server log tail with filters.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `src/v2/AppV2.jsx`, `wiki/Version-History.md`

- feat(ui): v2 AnalyticsModal + Balance radar (PR5f of 8) [L]
  - **Why.** Last of the major v2 surface ports. Brings Boomerang's signature 52-week heatmap, daily completion patterns, and tag/energy/size breakdowns into v2 — and ships the **Balance radar** that was the single net-new analytics piece in the original plan (mapped from the green coaching app's "Coaching Wheel"). Last placeholder ("Analytics — soon" in the More menu) is gone; PLACEHOLDER_COPY scaffolding deleted entirely from AppV2.
  - **`src/v2/components/BalanceRadar.jsx` + `.css`.** Pure SVG radar/spider chart, no chart library. Props: `spokes` array of `{label, value, color?}`, optional `comparison` array for previous-period dashed polygon, `size`, `onSpokeClick`. Renders 4 concentric guide rings + spoke lines + filled accent polygon for current period + optional dashed-grey comparison polygon + colored vertex dots + labels with values. Anchored top-of-circle, clockwise, evenly spaced. Empty state when no spokes.
  - **`src/v2/components/AnalyticsModal.jsx` + `.css`.** Wide ModalShell. Top toolbar: range pills (7d / 30d / 90d / 1y / All) + Tasks/Points metric toggle. Big summary number + label below ("142 tasks · last 30 days"). Sections: **Daily completions** bar chart, **By day of week** horizontal-bar pattern, **Balance** with the new radar (Tags/Energy toggle — tags use top-8 by value with the user's tag colors; energy uses the 6 fixed types with energy-type colors), **By tag / By energy / By size** breakdowns as horizontal bar lists with colored fills, **52-week pattern** heatmap (column-per-week, accent gradient by intensity, month labels above).
  - **Reuses existing endpoints.** `/api/analytics/history?days=N` for the active range, `/api/analytics/history?days=365` for the heatmap. Same data shape v1 consumes — no server changes.
  - **What's NOT in v2 Analytics yet (PR8 polish if user wants):** notification engagement panel, adaptive throttle 👍/👎 chips, completed-task search (DoneList already covers that surface), records (best day / current streak via `FullRings`). Lean version focuses on the most-glanceable patterns + the new Balance radar.
  - **`src/v2/AppV2.jsx`.** Imports `AnalyticsModal`. New `showAnalytics` state. More-menu Analytics row now has a chevron and opens the real modal (was a "soon" tag). **Removed** the placeholder ModalShell + `PLACEHOLDER_COPY` constant + `openModal` state — every header surface and More-menu row is now a real v2 modal. AppV2 is meaningfully cleaner.
  - **PR5 batch summary.** Modals batch 2 is complete except for the remaining Settings tabs (General, AI, Labels, Integrations, Notifications, Data, Logs — PR5g). v2's main surfaces all have first-class implementations: Settings (Beta tab), Projects, Done, Activity log, Routines, Packages, Quokka, Analytics. Background hooks (notifications, server sync, external sync, package polling, AI inference) all run while v2 is mounted.
  - **Verification.** `npm run build` clean (789KB precache), `npm test` smoke test passes. Manual: ⋯ → Analytics → modal opens with summary + daily chart + dow pattern + radar (toggle Tags/Energy) + breakdowns + heatmap. Range pills filter all sections; metric toggle swaps tasks↔points. Balance radar renders correctly at any spoke count from 1-8.
  - New: `src/v2/components/{AnalyticsModal,BalanceRadar}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 AdviserModal — Quokka (PR5e of 8) [M]
  - **Why.** Quokka was the lone header icon (✨) still pointing at a placeholder. It's the most-used surface for users running heavy automation, so it deserves a real port.
  - **`src/v2/components/AdviserModal.jsx` + `.css`.** Wide ModalShell. Reuses the shared `useAdviser` hook and the `renderMarkdown` utility — no fork. State for chat history + active chat + streaming + plan + commit comes from the hook unchanged. Composer auto-grows up to 200px max.
  - **Layout.** Top toolbar: chat-count chip + primary "+ New chat" button. Below: either the chat list view OR the conversation view (toggled by tapping the chat-count chip). Conversation view shows: optional expiry banner (chat will be deleted in N days unless starred), scrollable messages, status indicators (thinking / applying changes), confirm-bar when a plan is staged (full-width accent, white buttons), composer at the bottom.
  - **Message bubbles.** User messages right-aligned in accent fill. Assistant messages left-aligned in muted bg. Tool-call log renders as a compact stacked list with status icons (running spinner / done check / error X / staged dot), step name in capitalized human form. Plan preview is a dashed-accent card with `›` bullets; once committed it transitions to a green-bordered "Applied N changes" card.
  - **Confirm-bar.** Full-width accent (#FF6240) at the bottom of the messages area when a plan is awaiting confirmation. Carries the change count + Cancel / Apply N changes buttons. Cancel is ghost (transparent w/ white border on accent), Apply is white-fill accent-text — strongest possible visual hierarchy for "this is the action you want to take."
  - **Empty state.** "G'day from Quokka" with the sparkle icon in an accent-tinted circle, body explaining the scope, and four prompt suggestions (rescheduling, weather-aware moves, what-now, cleanup) as ghost cards. Tapping a suggestion populates the input.
  - **Chat history view.** Hairline rows: title + last-update + msg count + star/expiring meta. Star toggle on the right (filled when starred), Delete on the far right. Empty state when no chats yet.
  - **`src/v2/AppV2.jsx`.** Imports `useAdviser` (state lives at the App level so the conversation survives modal close — same pattern v1 uses) + `AdviserModal`. Header ✨ icon now opens it. Removed the `adviser` PLACEHOLDER_COPY entry — it was the last placeholder for a header icon; PLACEHOLDER_COPY now only contains `analytics`.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: tap ✨ → modal opens → empty state shows suggestions → tap a suggestion → text appears in composer → send → see streaming "thinking" + tool-call log + plan preview → tap Apply → "Changes applied" bar. Chat history toggle works; star/unstar/delete work.
  - New: `src/v2/components/{AdviserModal}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 PackagesModal (PR5d of 8) [M]
  - **Why.** v2 had a 📦 icon in the header that opened a placeholder. Packages is a primary surface — daily check for ADHD users tracking deliveries — so it earns a real port.
  - **`src/v2/components/PackagesModal.jsx` + `.css`.** Wide ModalShell. Top toolbar: "Refresh all" + "Track new" (primary accent toggles the add form). Inline add form: tracking number input + label input + live carrier auto-detect chip (uses shared `detectCarrier` from `utils/carrierDetect`) + "Track package" submit. List below: each package as a hairline row with carrier logo + label + monospace tracking number underneath + status pill on the right. Status pill colors mirror v1 (pending/in-transit/out-for-delivery/delivered/exception) but use the v2 muted alert palette so the colors don't shout.
  - **Inline expand instead of separate detail modal.** v1 has a separate `PackageDetailModal`; v2 collapses it into the row's expand state — tap a row, see ETA / delivered-at / last location, then a vertical timeline of the latest 8 events with accent-glow on the most recent dot, then Refresh + Delete actions (Delete has inline confirm). Skips the separate modal layer entirely.
  - **Sort.** Out-for-delivery → in transit → exception → pending → delivered, then ETA ascending, then label alphabetical. Same ordering rationale as v1: surface what needs attention first.
  - **`src/v2/AppV2.jsx`.** Imports `usePackages` + `usePackageNotifications` so background polling and delivery notifications run while v2 is mounted (v1 had this; v2 was previously missing it). Header 📦 icon now opens the real modal (was a placeholder); removed the `packages` PLACEHOLDER_COPY entry.
  - **What's NOT in v2 PackagesModal yet (port later if needed):** swipe-to-reveal actions on rows, API quota status banner, refresh cooldown timer, sort dropdown, gmail-pending visual treatment. Most of these are PR8 polish — the lean version is fully functional.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: tap 📦 → modal opens → "Track new" → enter tracking number → carrier auto-detected → Track package → row appears with status pill → tap row → events timeline expands → Refresh/Delete work.
  - New: `src/v2/components/{PackagesModal}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- fix(sw): handle offline/redeploy without returning null Response [S]
  - **Bug.** `public/boomerang-sw.js` fetch handler did `fetch(req).catch(() => caches.match('/index.html'))`. The cache was never populated by the install step, so `caches.match` returned `undefined`, which made `respondWith()` reject with `FetchEvent.respondWith received an error: Returned response is null.` Safari surfaced this as "Safari can't open the page" until site data was cleared.
  - **Trigger.** Every push to dev triggers Portainer to redeploy, which briefly disconnects the device. Any navigation request during that window fell through to the broken catch branch. The bug is latent — it pre-dates the v2 work — but the v2 PR cadence is tripping it because deploys are frequent.
  - **Fix.** Three coordinated changes in the SW:
    1. **Install step** now opens `boomerang-shell-v2` cache and adds `/index.html` so the offline fallback actually has something to serve on first run + best-effort.
    2. **Activate step** cleans up old `boomerang-shell-*` caches via prefix match so the SW can be versioned by bumping `SHELL_CACHE`.
    3. **Fetch handler** now opportunistically refreshes the cached shell on every successful navigation (so the cache stays fresh), and on network failure falls back to cached `/index.html` OR a synthetic 503 offline page that styles itself to match the app's dark theme and offers a Retry button. **Critically: never resolves with null.**
  - **User unblock for stuck devices.** Users who already hit the broken state need to clear site data once (iOS Safari → Settings → Safari → Advanced → Website Data → Remove) or reinstall the home-screen PWA. After that, the new SW installs cleanly and the bug is gone going forward.
  - **Why on dev only for now.** This is technically a v1+v2 infrastructure fix (the SW serves both UIs) and ought to land on main. Pushed to dev first per the in-flight v2 workflow; cherry-picking to main is the user's call.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: clear site data → reload → SW installs → kill the container → reload → see styled 503 offline page with Retry → bring container back → Retry → app loads. Repeated dev redeploys no longer trigger the null-response error.
  - Modified: `public/boomerang-sw.js`

- feat(ui): v2 RoutinesModal + EditTaskModal bug fixes (PR5c of 8) [M]
  - **Why.** Routines was the next-most-important v2 surface to port (recurring tasks are core to the app), and shipping it lets the v2 plan explicitly showcase the **hairline-list aesthetic** the design tokens were built for. Bundled two reported EditTaskModal bugs into the same commit so the dev image picks both up at once.
  - **`src/v2/components/RoutinesModal.jsx` + `.css`.** Wide ModalShell with a list view + form view (toggled via local `view` state). **List view:** active routines as hairline rows (title left, cadence + day-of-week right, e.g. "weekly · Fri"); paused routines collapsed under a SectionLabel'd PAUSED section. Tap a row to expand inline — shows last done ("done 12d ago"), next due ("next May 8"), complete count, plus action buttons: Spawn now (primary accent, mirrors v1's manual one-off), Edit, Pause/Resume, Delete (with inline confirm). Bottom of the list has a dashed "+ New routine" button. **Form view:** title, frequency dropdown, on-day dropdown (any day / Sun-Sat snap), custom-N-days input (only shown for `custom` cadence), end date (optional), priority toggle, notes, labels. Reuses the shared `.v2-form-*` classes from AddTaskModal for visual consistency. Back button at the top to return to the list.
  - **AppV2 wiring.** Added Routines to the More menu (between Projects and Done) with a chevron — the menu is now 6 functional rows + 1 "soon" (Analytics). New state: `showRoutines`, `editRoutineId`. `useRoutines` consumed for `addRoutine`/`deleteRoutine`/`togglePause`/`updateRoutine`/`spawnNow`/`spawnDueTasks`. `editRoutineId` opens RoutinesModal directly into edit form for a specific routine — same hook v1 uses (e.g. EditTaskModal "Open routine" jumps here).
  - **Bug fix #1 — EditTaskModal Status row "multiple selected" misread.** The Done button had a permanent `--v2-accent` border + text, so adjacent to the inverted-active "Doing" button it looked like both were selected. Done is a one-shot transition action (not a status the task currently has), so neutral at rest is correct. Fix: dropped the persistent accent — Done now uses `--v2-text-meta` color and the regular `.v2-form-seg` chrome at rest, with accent fill only on hover. The leading `✓` glyph already reads as an action.
  - **Bug fix #2 — Due/Priority columns colliding on iOS.** `.v2-form-row` was using flex with `flex: 1; min-width: 0` on each field. Safari/iOS renders empty `<input type="date">` at a collapsed intrinsic width, so the date input shrank below 50% and the Priority button overflowed into its space. Fix: switched `.v2-form-row` to CSS Grid with `grid-template-columns: 1fr 1fr` so each column is exactly half the available width regardless of intrinsic content. Also bumped `.v2-form-pri-toggle` height from 42px → 44px to match the input's natural height.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: ⋯ → Routines → list of active/paused routines renders; tap row to see "done 5d ago · next May 8 · 12× completed" + actions; "+ New routine" → form with all fields → Create → returns to list. EditTaskModal: Status row no longer has dual-selected look; Due/Priority columns sit cleanly side-by-side with no overlap.
  - New: `src/v2/components/{RoutinesModal}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/AddTaskModal.css`, `src/v2/components/EditTaskModal.{jsx,css}`

- feat(ui): v2 Projects + DoneList + ActivityLog (PR5b of 8) [M]
  - **Why.** Three small read-mostly views from v1's overflow menu, all under 130 lines each in v1, ported together. Fills out three of the More-menu placeholders so v2's nav is no longer dominated by "soon" tags.
  - **`src/v2/components/ProjectsView.jsx` + `.css`.** Wide ModalShell that renders status='project' tasks using v2 TaskCard (so card actions are consistent). Calm subtitle calls out the count + "no notifications, take your time". Empty state uses v1's tone: "Move longer-term tasks here so they stop nagging you."
  - **`src/v2/components/DoneList.jsx` + `.css`.** Wide ModalShell with hairline-row aesthetic (no full TaskCard chrome — done tasks don't need edit/snooze affordances, just a Reopen pill). Title gets a strikethrough at `--v2-text-faint` so the visual reads "completed." Sections use SectionLabel (Today + per-day groups). 50-per-page pagination via the existing `/api/tasks?status=done&sort=completed_at` endpoint; fresh fetch every time the modal reopens. Empty state when no completions yet.
  - **`src/v2/components/ActivityLog.jsx` + `.css`.** Wide ModalShell. Toolbar across the top: All / Deleted segmented filter + a small "Clear history" outlined button that confirms before wiping. Each entry is a hairline row with an action label tinted in the v2 muted alert palette (so "Deleted" reads in `--v2-alert-overdue`, "Edited" in `--v2-alert-high-pri`, etc.) + relative timestamp + task title. Deleted entries with a snapshot get a Restore pill.
  - **`src/v2/AppV2.jsx`.** Imports the three new modals + lucide `CheckCircle2`. New state: `showProjects`, `showDone`, `showActivityLog`. New callbacks: `handleUncomplete` (called from DoneList), `handleRestore` (called from ActivityLog — same logic as v1: clone snapshot, reset status, new uuid, prepend to tasks). Includes `setTasks` and `uncompleteTask` from useTasks. Removed unused PLACEHOLDER_COPY entries for projects + activityLog (analytics still placeholder until PR5f).
  - **More menu refresh.** Now contains 5 rows: Settings, Projects, Done, Analytics (still "soon"), Activity log. Functional rows show a chevron; the analytics one keeps the "soon" tag. Done is a new entry in v2 — v1 surfaces it via the "X done today" header link instead.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: ⋯ → Projects opens with project tasks (or warm empty state), Done shows your completed task list with Reopen on each row, Activity log shows recent edits with the muted action palette and Restore on deleted entries.
  - New: `src/v2/components/{ProjectsView,DoneList,ActivityLog}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 SettingsModal + More menu (PR5a of 8) [M]
  - **Why.** User-prioritized: without v2 Settings, the only way to flip back to v1 from inside v2 was the URL hatch (`?ui=v1`). PR5a ships the Settings shell + a fully functional Beta tab so the v2/v1 toggle lives where it belongs. Other Settings tabs port progressively (PR5b/f).
  - **`src/v2/components/SettingsModal.jsx` + `.css`.** v2 Settings on `ModalShell` (wide variant). Pill-style tab bar with the same tab list as v1: General, AI, Labels, Integrations, Notifications, Data, Logs, Beta. Active tab gets the inverted (text-on-bg) treatment so it's unmistakable. **Beta tab is fully functional**: large heading + body explaining the v2 state, an iOS-style toggle that flips back to v1 on uncheck and reloads, the static `__APP_VERSION__` build identifier in monospace, and a "What's coming" roadmap list. **Other tabs render an EmptyState** with the tab name, a one-liner description of what'll port there, and a "Open v1" CTA that flips back so the user can configure those for now.
  - **`src/v2/AppV2.jsx`.** Imports `SettingsModal` + lucide icons for the More menu items. New state: `showMenu`, `showSettings`. The Header `⋯` button now opens a real **More menu sheet** (using `ModalShell`) listing four items in hairline-list style: Settings (functional, opens SettingsModal), Projects (placeholder), Analytics (placeholder), Activity log (placeholder). Each non-functional row carries a small "soon" tag pill; Settings has a chevron indicating it actually goes somewhere. Removed the old `menu` placeholder copy.
  - **PLACEHOLDER_COPY refresh.** `menu` removed (it's now a real menu). New entries for `projects`, `analytics`, `activityLog` so each placeholder modal can call out which PR will deliver it.
  - **CSS.** New `.v2-more-menu` / `.v2-more-row` / `.v2-more-row-tag` rules in `AppV2.css` for the hairline-list menu rows. Tab styling, beta-tab block layout, and an iOS-style toggle live in `SettingsModal.css`.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: tap `⋯` → More menu sheet → tap Settings → SettingsModal opens on the Beta tab → toggle flips to v1 cleanly. Other tabs show their EmptyState with v1 fallback CTA.
  - New: `src/v2/components/SettingsModal.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- feat(ui): v2 ReframeModal + WhatNowModal + Header What now? button (PR4d of 8) [M]
  - **Why.** Final PR in modals batch 1. ReframeModal closes the loop on the snooze→reframe escalation pattern (without it, v2 just kept piling up snooze counts forever). WhatNowModal brings Boomerang's signature "what should I do right now?" feature to v2.
  - **`src/v2/components/ReframeModal.jsx` + `.css`.** Built on `ModalShell`. Subtitle calls out the snooze count + task title. Single textarea for "what's blocking you?" → calls shared `reframeTask()` API → renders the AI-suggested replacement tasks as a clean hairline list with `→` accent bullets. "Looks good" button calls `replaceTask` to swap the original out for the reframed set.
  - **`src/v2/components/WhatNowModal.jsx` + `.css`.** Multi-step flow on `ModalShell` — title stays "What now?", subtitle changes per step. **Step 1:** time picker (5–10 min / 30 min / a couple hours, each with a sub-label). **Step 2:** energy level (Running on fumes / Moderate / I've got it). **Step 3:** capacity grid — energy types (with the type's color icon) + Anything + Skip. **Step 4:** AI-returned picks rendered as cards with tappable Done buttons; stretch suggestion appears below as a dashed-accent card. Reuses shared `getWhatNow()` and `getWeather()` APIs and the same `buildWeatherSummaryFromCache()` formatter v1 uses (small enough to inline).
  - **`src/v2/components/Header.jsx`.** Added optional `onOpenWhatNow` prop. When provided, renders a primary-accent pill button (`Target` icon + "What now?" label) at the start of the actions cluster. On screens ≤480px the label collapses to icon-only to keep the header from wrapping. Header now hosts 5 actions when fully wired: What now? · + · ✨ · 📦 · ⋯.
  - **`src/v2/AppV2.jsx`.** Imports both modals + `loadSettings`. New state: `reframeTarget`, `showWhatNow`. `handleSnooze` now reads `reframe_threshold` from settings and routes to ReframeModal instead of SnoozeModal when a task has been snoozed enough times — same logic as v1. Header `onOpenWhatNow` opens the WhatNow modal which uses the shared `tasks` array + `handleComplete` so completing from a suggestion threads through the same path (toast prefetch, routine completion, etc., as those land).
  - **PR4 batch summary.** Modals batch 1 is complete. v2 now supports the full task lifecycle in-app: add, edit, complete, snooze, reframe-on-overload, "what now?" suggestions. Editing still defers checklists/comments/research/attachments/Notion-Trello-GCal state visualization to PR5/PR8. Header is at its final affordance count for v1-parity (modulo Settings which lands in PR5).
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: Snooze a task past `reframe_threshold` → Reframe modal opens with the same task; type a blocker → AI returns replacement tasks → Looks good replaces original. Tap "What now?" → step through time/energy/capacity → suggestions render with Done buttons.
  - New: `src/v2/components/{ReframeModal,WhatNowModal}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/Header.jsx`, `src/v2/components/Header.css`

- feat(ui): v2 EditTaskModal — lean port (PR4c of 8) [M]
  - **Why.** Third of four mini-PRs. v1 EditTaskModal is 1275 JSX + 892 CSS lines with checklists, comments, research, attachments, Notion/Trello/GCal/weather state, drag-drop, and more. Porting all of that in one PR would consume the rest of the v2 schedule. PR4c ships the most-used 80% — same form fields as Add + status / delete / backlog / projects / convert-to-routine — and explicitly defers the rest.
  - **`src/v2/components/EditTaskModal.jsx` + `.css`.** Reuses `useTaskForm` hydrated from the task, plus separate state for status, delete-confirm, and routine cadence. Same lean form layout as AddTaskModal (and reuses its CSS via shared classes) so the typography rhythm is identical. Adds: status segmented row (Not Started / Doing / Waiting / + ✓ Done as a primary-tinted button), `Convert to routine` opt-in with cadence picker, and an actions row at the bottom (Backlog, Projects, Delete with inline confirm). Save button persists everything via the shared `updateTask` and closes.
  - **What's NOT in v2 EditTaskModal yet (port progressively):** checklists with drag-drop, comments, AI Research, attachments + extract-text, Notion search/link/create state visualization, Trello link state, GCal duration override, weather-hidden flag, 7-day forecast widget, "open routine parent" link. v1 EditTaskModal still handles all of these — flip to v1 if needed. The shared form hook keeps the state plumbing reusable when these port.
  - **`src/v2/AppV2.jsx`.** Imports `EditTaskModal`. New `editTarget` state holds the task being edited. TaskCard's Edit button now opens the real modal. Wired action handlers: `handleStatusChange` (delegates Done to the existing complete chain), `handleBacklog`/`handleProject` (status update + last_touched bump), `handleConvertToRoutine` (creates routine via shared `addRoutine`, links task). Removed the `edit` placeholder copy.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: open a task → fields hydrate from current values → change anything → Save → list reflects changes immediately. Status row swaps the section the card lives in. Delete asks "Delete? Yes/No" inline before destroying. Convert to routine creates the routine and links the current task.
  - New: `src/v2/components/EditTaskModal.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 AddTaskModal + Header `+ New` button (PR4b of 8) [M]
  - **Why.** Second of four mini-PRs porting v1's task-flow modals. Without an add path, v2 was read-only — users had to flip back to v1 just to create a task.
  - **`src/v2/components/AddTaskModal.jsx` + `.css`.** Lean v2 form built on `ModalShell`. Reuses the shared `useTaskForm` hook so polish/size-infer/labels/attachments state machinery isn't duplicated. Fields: title (auto-focused, Enter to submit), notes (with Polish AI pill), due date, priority cycle (Normal → High → Low), size segmented buttons + Auto, energy type pill grid (appears when energy or size is set, with active-pill border in the type's color), energy drain segmented buttons (when type is set), labels pill grid (multi-select). Primary accent submit at the bottom.
  - **What's NOT in v2 AddTaskModal yet (port later):** attachments + extract-text, Notion search/create. These are advanced flows that v1 still handles; user can flip to v1 if needed. `useTaskForm` exposes the state for these, so wiring them in PR4c (EditTaskModal, which shares the same form skeleton) or PR8 (polish) is straightforward.
  - **`src/v2/components/Header.jsx`.** Added an optional `onOpenAdd` prop. When provided, renders a 4th icon button (the `+`) in primary accent style at the start of the header actions cluster — the calm rest state goes from 3 → 4 affordances. Header still conditionally renders the button so it doesn't appear on shells that haven't wired it yet.
  - **`src/v2/AppV2.jsx`.** Imports `AddTaskModal` + `useToastPrefetch` + `inferSize`. New `showAdd` state opens the modal from the Header's `+` button. `handleAddTask` mirrors v1's add path: create task via shared `addTask`, kick off background AI inference for size/energy when not manually set, prefetch the completion-toast copy. Empty state CTA changes from "Back to v1" to "Add task" so first-run users have an obvious next step.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: tap Header `+` → modal opens with title focused → fill fields → Add task → task appears in correct section, AI inference fills size/energy a moment later (visible if you re-expand).
  - New: `src/v2/components/AddTaskModal.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/Header.jsx`, `src/v2/components/Header.css`

- feat(ui): v2 SnoozeModal + Beta-tab build number (PR4a of 8) [S]
  - **Why.** First of four mini-PRs that port v1's task-flow modals to v2 (PR4 in the build plan). Snooze is the smallest and was already broken in v2 (the TaskCard Snooze button opened a placeholder pointing back to v1). Bundling a small DX fix while we're touching Settings.
  - **`src/v2/components/SnoozeModal.jsx` + `.css`.** v2 SnoozeModal built on `ModalShell` + the hairline-list aesthetic. Reuses the shared `getSnoozeOptions()` / `getSnoozeOptionsShort()` from `store.js` and the same due-date filtering logic v1 has. Each option is a hairline-divided row with a left-aligned primary label + right-aligned meta (e.g. "Tomorrow · Tue, Apr 16 9 AM"). "Pick a date…" toggles to a custom date+time picker with an accent-pill confirm button. Mobile bottom-sheet, desktop centered panel — both inherit the ModalShell circular-pill close.
  - **AppV2 wiring.** New `snoozeTarget` state holds the task being snoozed. `TaskCard.onSnooze` now passes the full task; AppV2 routes it to the real `SnoozeModal` instead of the "coming soon" placeholder. Uses the shared `useTasks().snoozeTask` so v1 and v2 see the same result via SSE.
  - **Beta tab: static build identifier.** User flagged that the autosave indicator at the top of Settings keeps replacing the version label, making it hard to confirm which dev build is running. Added a "Build" line to the Beta tab — monospace, text-color, never overwritten by autosave state. Reads `__APP_VERSION__` (Vite-defined; on dev builds it's `dev-<sha>` from `build-and-publish-dev.yml`).
  - **What still uses placeholders in v2.** Edit, header icons (Quokka / Packages / More) — they still open ModalShell + EmptyState pointing back to v1.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual: tap Snooze on a v2 card → real modal opens with options + custom picker → choose option → task moves to Snoozed section. Open Settings → Beta in either v1 or v2 (when Settings ports) → "Build" line shows the running build.
  - New: `src/v2/components/SnoozeModal.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/components/Settings.jsx` (Beta tab)

- feat(ui): v2 task list — TaskCard + section labels (PR3 of 8) [M]
  - **Why.** Third piece of the v2 maturity refresh. Brings the calm typography + status-color economy to the most-seen surface (the task list) and wires v2 against the real data hooks so it's no longer a placeholder shell.
  - **`src/v2/components/SectionLabel.jsx` + `.css`.** Tiny presentational component for "Doing / Stale / Up next / Waiting / Snoozed" headers. `--type-section` style: 11px DM Sans 600 ALL-CAPS with 0.08em letter-spacing, accent-colored sparkle bullet, optional right-aligned count. Wheneri's HOME / HOME MAINTENANCE pattern, applied to status sections.
  - **`src/v2/components/TaskCard.jsx` + `.css`.** Lean v2 card. Title is the dominant element (16px DM Sans 600). Meta line uses `--text-meta` with bullet separators. Energy renders as a single chip — lucide icon + N small `Zap` glyphs in the energy-type color, replacing v1's icon + colored-dot stack. **Status economy:** only `overdue` and `high_priority` get a 2px colored left border; `stale` becomes inline meta (`12d on list`); `low_priority` reduces opacity to 0.78. Tap to expand reveals notes preview, checklist progress, and an action toolbar (Done / Snooze / Edit). Done is wired via the shared `completeTask`; Snooze + Edit open ModalShell placeholders that tell the user the v2 modals land in PR4.
  - **`src/v2/AppV2.jsx`.** Replaced the welcome placeholder with the real shell. Wires the same hook stack v1 uses: `useTasks`, `useRoutines` + `spawnDueTasks` effect, `useNotifications`, `useServerSync` + `hydrateFromServer`, `useExternalSync` (Trello/Notion outbound), `useSizeAutoInfer`. Renders sections in v1's order (Doing, Stale, Up next, Waiting, Snoozed), sorted by age. EmptyState shows when there are zero active + zero snoozed tasks. Service worker re-registration on version mismatch matches v1 behavior.
  - **What's intentionally NOT in v2 yet.** Routine-completion logging on Done, Trello status push on Done, sort dropdown, search, tag-filter pills, backlog/projects sections, swipe-to-reveal actions, weather badges, drag-and-drop, keyboard shortcuts, Gmail-pending visual treatment, post-completion next-up toast, manual quick-add input, packages background hooks, GCal/Notion/Trello inbound syncs (manual triggers in v1 Settings still work). All of these port in subsequent PRs (4–8).
  - **Verification.** `npm run build` clean, `npm test` smoke test passes. Manual smoke: flip to v2 → real tasks render in sections → tap card to expand → Done removes task → Snooze/Edit show v2 placeholder modals → flip back to v1 → all changes persist (shared store + server sync).
  - New: `src/v2/components/{SectionLabel,TaskCard}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- feat(ui): v2 shell — Header + ModalShell + EmptyState (PR2 of 8) [S]
  - **Why.** Second piece of the v2 maturity refresh (see PR1 commit for context). Establishes the modal language and the calm-at-rest header so users opting into v2 see the design rhythm immediately.
  - **`src/v2/components/ModalShell.jsx` + `.css`.** Reusable modal wrapper with the Wheneri close affordance: a 36×36 circular pill X in the top-right of every modal (no handle bar — X is sufficient). Mobile: bottom-sheet with rounded top corners. Desktop: centered panel (480px narrow / 720px wide via `width` prop). Title in `--type-h1` (Syne 700 32px) with 40px top padding for breathing room. Hairline below the title, body padding 24px. Escape closes; clicking the overlay closes; body overflow locks while open and restores on close.
  - **`src/v2/components/EmptyState.jsx` + `.css`.** Reusable empty-state matching the calm tone of v1's ProjectsView. Soft circular icon backdrop (lucide stroke 1.5), `--type-h2` title (Syne 700 22px), muted meta body, optional ghost CTA. Single component used for both the v2 main empty state and the placeholder modal contents.
  - **`src/v2/components/Header.jsx` + `.css`.** The calm 4-affordance header: logo + wordmark on the left; Quokka ✨, Packages 📦, More ⋯ on the right. No stats bar, no sort/search/sync chrome at rest — that staging lands in a later PR. Sticky to the top of the v2 viewport with a hairline divider.
  - **`src/v2/AppV2.jsx`.** Replaced the welcome placeholder with the real shell. Header at top, EmptyState body ("Welcome to v2"), ModalShell wired to all three header icons rendering "Coming soon in v2 / Use v1 for this" placeholder content. Pressing any v2 icon now demonstrates the modal close affordance and typography rhythm — the actual surface (Quokka, Packages, etc.) ports in later PRs.
  - **Reuse.** v2 imports `src/components/Logo.jsx` (just an SVG, no v1-specific styling) and `lucide-react` icons. No other v1 component code is pulled in.
  - **What does NOT change in this PR.** v1 untouched. The v2 task list, real Quokka, Packages, Settings, Analytics, Routines, Projects, ActivityLog, EditTaskModal/AddTaskModal/SnoozeModal/ReframeModal/WhatNowModal, KanbanBoard, and Toast all remain placeholder/v1-only.
  - **Verification.** `npm run build` clean, `npm test` smoke test passes, manual smoke: flip Beta toggle → v2 shell renders; tap any header icon → ModalShell opens with EmptyState; X / overlay click / Escape all close; flip back to v1 → unchanged.
  - New: `src/v2/components/{Header,ModalShell,EmptyState}.{jsx,css}`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- feat(ui): v2 opt-in shell — design tokens, router, Beta tab toggle [M]
  - **Why.** UI/UX maturity refresh inspired by Wheneri and a green-themed coaching app. The four maturity dimensions in scope: typography + color discipline, card breathing + status economy, modal/affordance consistency, header staging + empty-state tone + motion. Delivered as a v2 shell behind an opt-in toggle so v1 stays exactly as-is and users can flip back any time.
  - **Architecture.** `src/App.jsx` becomes a thin router that reads a `ui_version` flag from localStorage (default `v1`) and renders either `AppV1` (the existing 1042-line component, renamed) or `AppV2` (new placeholder shell). URL escape hatch: `?ui=v2` and `?ui=v1` set the flag and strip themselves from the URL so deep-link params (`?task=X`) don't keep flipping it. `data-ui-version` is mirrored on the documentElement for analytics/debugging. `data-ui="v2"` is set when v2 mounts so namespaced tokens key off it.
  - **Design tokens** (`src/v2/tokens.css`). Single accent (`--v2-accent: #FF6240`), muted alert palette (`--v2-alert-overdue: #E8443A`, `--v2-alert-high-pri: #F2A100`), pastel-ified energy types (desk/people/errand/confrontation/creative/physical), off-white background `#FAFAF7` (light) and existing `#0B0B0F` (dark). Typography: Syne 700 display, DM Sans body. Three named easings + durations (`--v2-ease-emphasis/standard/quick`, `240ms/180ms/120ms`). All variables namespaced `--v2-*` so they cannot leak into v1 styles by accident.
  - **`src/v2/AppV2.jsx`.** Placeholder welcome page that loads `tokens.css` + `AppV2.css`. Shows "v2 is on the way" with a Back to v1 button and a meta line documenting the URL escape hatch. Subsequent PRs (Header, TaskCard, ModalShell, etc.) will replace the placeholder.
  - **Settings → Beta tab.** New top-level tab in Settings (alongside General/AI/Labels/Integrations/Notifications/Data/Logs). Single toggle: "Use v2 interface" — flips localStorage and reloads. Reserved for future opt-in experiments too.
  - **Shared infra.** v2 reuses every server endpoint, every hook, every context, `api.js`, `store.js`, `db.js` — only the React component tree and CSS fork. No migrations, no DB changes, no new endpoints.
  - **What does NOT change in this PR.** v1 visuals are untouched. No changes to TaskCard, Header, modals, or any user-facing behavior unless the Beta toggle is flipped.
  - **Verification.** `npm run build` clean (no new warnings), `npm test` smoke test passes (build + server + health endpoint + JS bundle parse), Beta toggle in Settings flips the flag, `?ui=v2`/`?ui=v1` URL escape hatch works. Default load is v1 — zero behavior change for anyone who doesn't opt in.
  - New: `src/AppV1.jsx` (renamed from `src/App.jsx`), `src/v2/tokens.css`, `src/v2/AppV2.jsx`, `src/v2/AppV2.css`
  - Modified: `src/App.jsx` (rewrote as router), `src/components/Settings.jsx` (Beta tab), `wiki/Version-History.md`, `CLAUDE.md`, `wiki/Architecture.md`

---

## 2026-05-02

- fix(settings): notion shows as disconnected when only MCP is connected [XS]
  - **Bug.** `Settings.jsx` mount-time fetch gated `notionStatus()` behind `keys.notion`, which is only true when the legacy `NOTION_INTEGRATION_TOKEN` env var is set. Users who connected via MCP (the recommended path) and don't have the env var configured saw `notionConnected = null` → "unconfigured" gray dot, even though the server correctly reports `connected: true` via the MCP token. The Notion Sync settings section (gated on `notionConnected.connected`) also failed to render in this state.
  - **Fix.** Removed the `if (keys.notion)` gate. Always call `notionStatus()` on mount — the server's status endpoint resolves whichever auth path is live (MCP or legacy) and returns `{connected: false}` cleanly when nothing is configured, so the gate added no value and broke the MCP-only case.
  - Modified: `src/components/Settings.jsx`

- refactor(settings): split Pushover across Integrations + Notifications tabs [S]
  - **Why.** Pushover settings were originally lumped into one block in the Notifications tab — credentials, public app URL, helper text, per-type toggles, and test buttons all together. That mixed two distinct concerns: *configuring the integration* (a one-time setup) and *choosing which notifications fire over it* (an ongoing preference). User correctly flagged this — Trello, Notion, GCal, Gmail all have their integration settings in the Integrations tab; Pushover should match that pattern.
  - **Integrations tab → Pushover** now hosts: master toggle, Public app URL field, User Key + App Token credentials, priority-level helper text, Test Pushover and Test Emergency buttons. Includes a hint pointing to the Notifications tab for per-type toggles.
  - **Notifications tab → Pushover** is reduced to just the eight per-type toggles (high priority, overdue, stale, nudges, size, pile-up, package delivered, package exception). When Pushover isn't yet enabled or credentials aren't configured, shows a hint pointing back to the Integrations tab instead of dead toggles.
  - No behavioral changes — same settings keys, same dispatcher logic, same defaults. Pure UX cleanup.
  - Modified: `src/components/Settings.jsx`

- docs(security): credential storage notes + Quokka blocklist patch [S]
  - **Patch.** Added `pushover_user_key` and `pushover_app_token` to the Quokka adviser's secret blocklist in `adviserToolsMisc.js`. Both `get_settings` (now redacts them) and `update_settings` (now refuses to write them) match the same handling as Anthropic / Notion / Trello / GCal / 17track keys. Closes a gap from the Pushover transport commit — those settings were stored in the same plaintext blob as other secrets but weren't protected from adviser exfiltration.
  - **Documentation.** New `wiki/Security-Notes.md` — honest accounting of where every secret lives (plaintext SQLite, browser localStorage, env vars), what's protective (OAuth tokens server-only, SMTP env-only, Quokka blocklist, HTTPS in transit), what isn't (no encryption at rest, no master-key separation, localStorage XSS-readable), and when the threat model breaks down (multi-tenant, untrusted hosting, sensitive backups). Documents practical hygiene and lists future-hardening options that aren't on the roadmap.
  - **README.md** — short "Security note" paragraph linking to the new doc so prospective users know what they're getting before they decide whether to deploy.
  - **CLAUDE.md** — new "Security Posture" section documenting the secret storage layout and the blocklist invariant ("keep this list in sync when adding new secret-shaped settings"). Future contributors won't need to re-derive this.
  - **wiki/Home.md** — links to both new docs (Security Notes, Testing Notification Stack).
  - Modified: `adviserToolsMisc.js`, `README.md`, `CLAUDE.md`, `wiki/Home.md`, `wiki/Version-History.md`
  - New: `wiki/Security-Notes.md`

- feat(notifications): tone-aware AI rewrites + Quokka weekly pattern review + test docs [M]
  - **Tone-aware AI notification rewrites.** New `notifAi.js` module exports `rewriteNotifBody(task, body)` that calls Claude Haiku 4.5 with the user's `ai_custom_instructions`. The model rewrites the static notification body in the user's preferred tone — e.g. a user who said "phone calls are confrontation-level for me" gets call-related overdue notifications framed more gently.
  - **Cost-bounded.** `canRewriteThisTick(channel)` allows at most one rewrite per dispatcher tick (60s) per channel. ~$0.001/day at typical volume.
  - **Always falls back gracefully** to the static body: no Anthropic key, no custom instructions, 2.5s timeout, malformed response, or any error all return the original body. Never throws.
  - **Skipped for Pushover Emergency** (priority 2) — `shouldRewrite({priority})` returns false for those. Urgency matters more than tone there.
  - Wired into all three transports' high-priority body construction (Pushover, web push, email).
  - **Quokka weekly cross-task pattern review.** New `runWeeklyPatternReview()` job in `server.js` runs hourly, fires only between 10am–11am on Sundays (gated by throttle key `weekly_pattern_review` with 6.5-day TTL). Queries active tasks with `snooze_count >= 3` and `last_touched` within 14 days. If 2+ qualifying, creates a new Quokka chat titled "Weekly pattern review" with a seeded user message listing the avoidance patterns and asking whether they're worth keeping / reframing / removing.
  - **Pushover ping** for the new chat — priority 0, deep-links to `PUBLIC_APP_URL`, body: "N tasks you've been pushing past — let's talk about them in Quokka when you have a minute."
  - **Skipped silently** if 0 or 1 qualifying tasks (no spam).
  - **Test sequence documented** at `wiki/Testing-Notification-Stack.md` — 17 end-to-end test cases covering every notification feature shipped in this batch (Pushover, Emergency, deep links, tap tracking, digest, analytics, adaptive throttling, wake-me, inline web-push actions, post-completion next-up, AI rewrites, weekly review, dedup, From overrides, failure isolation, graceful no-op) plus a 5-step health check for post-deploy validation.
  - Modified: `pushoverNotifications.js`, `pushNotifications.js`, `emailNotifications.js`, `server.js`, `Dockerfile`
  - New: `notifAi.js`, `wiki/Testing-Notification-Stack.md`

- feat(notifications): web-push subscription dedup + email From overrides [S]
  - **Why dedup.** User reported duplicate web push notifications. Server-side throttling is per-(channel, type), so the dispatcher itself isn't double-firing. Cause: stale `push_subscriptions` rows from PWA reinstalls / iOS subscription evictions / re-granted permissions. Each ghost row got every notification.
  - **`upsertPushSubscription`** now deletes any prior rows with matching `(p256dh, auth)` keys before inserting. The keypair uniquely identifies a device-browser-permission combo, so collisions on those keys mean it's the same client re-subscribing.
  - **One-time cleanup script** at `scripts/dedupe-push-subscriptions.js` for installs that already accumulated dupes. Run with `DB_PATH=/data/boomerang.db node scripts/dedupe-push-subscriptions.js`. Reports duplicate-group count and rows removed; safe to run multiple times.
  - **Why email From overrides.** Default From falls back to SMTP_USER which often hits spam. Two new settings: `email_from_address` (override the literal address — should be on a domain you control with SPF/DKIM/DMARC) and `email_from_name` (display name, default "Boomerang Digest"). Resolution priority: settings → env (`SMTP_FROM`) → SMTP user.
  - **Settings UI** — From-name + From-address fields under Email notifications with inline helper text linking to deliverability practices.
  - **Configuration.md and CLAUDE.md** — new "Email deliverability" sections covering SPF/DKIM/DMARC, recommended providers (Postmark / Resend / Mailgun / SES), `mail-tester.com` validation. CLAUDE.md picks up the full notification feature surface from this batch (engagement analytics, adaptive throttling, inline actions, post-completion suggestion, curated digest, tag-based wake-me bypass, dedup, deliverability).
  - **Deferred to a future commit:** tone-aware AI rewrites (one notification body per dispatcher tick, ~$0.001/day), Quokka weekly pattern review (cross-task avoidance detection via the existing chat surface), centralized notification dispatcher refactor.
  - Modified: `db.js`, `emailNotifications.js`, `src/store.js`, `src/components/Settings.jsx`, `wiki/Configuration.md`, `CLAUDE.md`
  - New: `scripts/dedupe-push-subscriptions.js`

- feat(notifications): inline web-push actions + post-completion next-up suggestion [M]
  - **Inline web-push actions.** Web push notifications for tasks now render Snooze 1h and Done buttons directly on the notification. Tapping Snooze postpones the task for an hour without opening the app; Done marks it complete. Both also stamp the underlying notification log as tapped so engagement analytics credit the channel.
  - **Why these aren't anti-North-Star.** The North Star is "pull me back to ACT on tasks I have to act on." Snooze and Done are closing-the-loop on a decision the user has *already made* — forcing a full app round-trip just to dismiss a low-stakes ping breeds avoidance. The bare tap (notification body) still opens the app on the relevant task for the cases where context matters.
  - **Service worker** (`public/boomerang-sw.js`) — adds `actions: [{action:'snooze1h'}, {action:'done'}]` to the `showNotification` call when the payload has a `taskId` and isn't flagged `no_actions`. New `notificationclick` branches handle each action by POSTing to the new endpoints.
  - **Server endpoints:** `POST /api/notifications/action/snooze` (sets `snoozed_until = now + N hours`, increments `snooze_count`) and `POST /api/notifications/action/done` (sets `status = done`, `completed_at = now`). Both stamp the notification log and `bumpVersion()` so other clients see the change.
  - **Post-completion "Next up" toast.** When the user completes a task, the completion toast now includes a tappable "Next up: <title>" suggestion. Selection heuristic: high-priority +100, due today/overdue +50, XS/S size +20, sorted descending. Tapping opens the suggested task. Toast stays on screen 8 seconds (vs the usual 4) when a suggestion is offered.
  - Modified: `public/boomerang-sw.js`, `server.js`, `src/App.jsx`, `src/components/Toast.jsx`

- feat(notifications): adaptive throttling + per-back-off feedback validation [M]
  - **Why.** Analytics detects signal degradation (tap-rate dropping); without a closing loop, the dispatcher keeps firing into a void anyway. Adaptive throttling closes that loop: a (channel, type) that's been ignored 10 times in a row backs off progressively (1.5×, 2.25×, … capped at 8×) until something taps, then resets to 1×.
  - **Migration 021** — `throttle_decisions` table records each back-off event (channel, type, old multiplier, new multiplier, decided_at, optional feedback + override-until).
  - **`getEffectiveThrottleMultiplier(channel, type)`** in `db.js` — looks at last 10 notifications for that combination. Any conversion → 1.0×. All ignored → step up by 1.5× from the most recent decision, capped at 8×. Inserts a new `throttle_decisions` row when the multiplier changes.
  - **`adaptiveFreq()`** wrapper in `pushoverNotifications.js` multiplies the configured base frequency by the effective multiplier. Wired into all five throttled categories (high-priority, overdue, stale, nudge, size, pile-up).
  - **Per-back-off feedback validation.** Behavioral inference (tap = useful, no tap = useless) is coarse — a user might silently read and act in the app without tapping. The Analytics panel now shows recent unreviewed back-off decisions as chips with 👍 / 👎 buttons:
    - 👍 marks the decision reviewed (no-op).
    - 👎 reverts the back-off (synthetic decision row putting multiplier back) and sets `user_overridden_until = now + 7d` on that combination — adaptive throttling backs off itself for that combination for 7 days.
  - **New endpoints:** `GET /api/analytics/throttle-decisions?days=N` lists the rolling history; `POST /api/analytics/throttle-decisions/:id/feedback` posts thumbs feedback.
  - **UI** — chips appear inside the existing Notification Engagement panel only when there are unreviewed decisions (silent when nothing to review).
  - Modified: `db.js`, `server.js`, `pushoverNotifications.js`, `src/api.js`, `src/components/Analytics.jsx`
  - New: `migrations/021_adaptive_throttle.sql`

- feat(notifications): tag-based quiet-hours bypass via "wake-me" label [S]
  - **Why.** The original Pushover plan had priority 1+2 always bypass quiet hours. User correctly pushed back: "very few things need to wake me at 2am — let me opt in per-task." Default is now silence; only labeled tasks override.
  - **Default `wake-me` label** added to `DEFAULT_LABELS` in `src/store.js` with red `#FF6240` color. Existing installs see it on first label load.
  - **`quiet_hours_bypass_label` setting** (default `wake-me`). Free-text in Settings → Quiet hours so users can rename.
  - **Bypass logic** in `pushoverNotifications.js` `taskHasBypassLabel()`. During quiet hours: priority 0 always silent, priority 1+2 silent **unless** the task carries the bypass label. Generic multi-task overdue summaries are silent during quiet hours regardless (no per-task to check).
  - **EditTaskModal "Wake me up for this" checkbox** below the Labels section — toggles the bypass label cleanly without making users hunt the label dropdown.
  - **Settings UI** — bypass-label name field appears under quiet-hours time pickers when quiet hours is enabled.
  - Modified: `pushoverNotifications.js`, `src/store.js`, `src/components/EditTaskModal.jsx`, `src/components/Settings.jsx`

- feat(analytics): notification engagement panel [S]
  - **Why.** Phase 2a wired up tap and completion stamping; this surfaces the data in the existing Analytics dashboard so it's actually visible. North-Star alignment: the post-2-week review can now see "Pushover tap-rate is X%, completion-rate is Y%" instead of guessing.
  - **New collapsible "Notification engagement" section** in `Analytics.jsx`, between the heat map and the Completed Tasks search.
  - **By channel** breakdown — for each of email, push, pushover: sent count, tap-rate %, completion-rate % (where completion = task done within 24h of notification).
  - **By notification type** breakdown — same fields per notification kind (high_priority, overdue, stale, nudge, digest, size, pileup, package_*).
  - **Empty state** — friendly message explaining what'll appear once notifications start firing, instead of an empty grid.
  - Range follows the same `range` selector as the rest of the Analytics page (default 30 days).
  - Modified: `src/components/Analytics.jsx`

- feat(notifications): curated daily digest with positive reinforcement [M]
  - **Why.** A counts-only digest ("5 open · 2 due today · 3 overdue") informs but doesn't pull — it's debt, not invitation. The North Star is "pull me back into the app to act." A digest that opens with yesterday's wins and surfaces tappable tasks is the soft re-engagement primitive.
  - **`digestBuilder.js`** — shared module used by all three transports. Exports `buildDigest(settings)` returning `{ hasContent, subject, textBody, htmlBody }`. Sections: friendly lead-in → yesterday recap + streak → Today (overdue rolled in, gentle phrasing like "due 2 days ago") → Coming up → Carrying ("carrying for 5 days", not "stale") → Quick wins → Weather. Skips the send if no section has content.
  - **Tappable HTML** — every task in the digest is wrapped in `<a href="{publicAppUrl}/?task=…">`. Powers the deep-link tap tracking added in 2a.
  - **`digest_style: 'curated'`** is the new default. Setting it to `'counts'` preserves the legacy counts-only output for users who preferred it.
  - **Pushover digest** — new `pushover_digest_enabled` setting (off by default), priority-0, includes `url` field for tap-through.
  - **Test endpoint** — `POST /api/digest/test` (via `sendDigestNow()` in `pushoverNotifications.js`) builds the digest once, dispatches via every enabled channel (email + web push + Pushover), bypasses time-of-day and 23h throttle. Returns `{ fired: [...], skipped: [...] }`. Settings UI gets a "Test daily digest" button.
  - **Refactor.** `pushNotifications.js` `checkPushDigest()` and `emailNotifications.js` `checkDigest()` are now thin wrappers around the shared builder. ~80 lines of duplicated build logic deleted.
  - **New helper exports:** `sendDigestEmail(digest)` and `sendDigestPush(digest)` for the manual test path to reuse the existing transporter / VAPID setup.
  - **Settings UI.** Style dropdown (curated / counts), three channel toggles (Email, Web Push, Pushover), time picker (existing), Test button with "Sent via X, Y" feedback.
  - Modified: `pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, `server.js`, `Dockerfile`, `src/api.js`, `src/store.js`, `src/components/Settings.jsx`
  - New: `digestBuilder.js`

- feat(notifications): deep links + tap tracking + engagement analytics endpoint [M]
  - **North Star — pull me back into the app to act.** Notifications without an action path are dead-ends. Every notification now deep-links into the relevant task; the system tracks which notifications convert to in-app engagement so we can tune by data, not vibes.
  - **Migration 020** adds `tapped_at` and `completed_after` columns to `notification_log`. Index on `task_id` for the new lookups.
  - **`PUBLIC_APP_URL`** env var + `public_app_url` setting field (Settings → Pushover section). Pushover sends include `url` and `url_title: "Open in Boomerang"` whenever it's set.
  - **Deep link handler.** `App.jsx` already had a `?task=` handler — extended to also fire `markNotificationTap()` so analytics knows the user converted from a notification to an in-app open.
  - **Side-effect: tap cancels Pushover Emergency.** When a user taps the deep link of a task that has an outstanding priority-2 alarm, the receipt is cancelled server-side. The user has engaged; the alarm has done its job.
  - **`POST /api/notifications/tap`** stamps the most recent matching `notification_log` row within 10 minutes. Idempotent.
  - **Completion stamping.** `db.js` `updateTaskPartial` now stamps `completed_after` on recent (last 24 h) notifications when a task transitions to `done`/`completed`. Powers the conversion-rate metric.
  - **`GET /api/analytics/notifications?days=N`** returns aggregated `byChannel` and `byType` engagement data with `sent`, `tapped`, `completed`, `tap_rate`, `completion_rate`. Foundation for the dashboard panel landing in 2c.
  - **`logNotifPush` now takes a channel arg.** Lets `pushoverNotifications.js` log with `channel='pushover'` so analytics can distinguish channels. Default 'push' preserves existing call sites.
  - Modified: `db.js`, `server.js`, `pushoverNotifications.js`, `src/App.jsx`, `src/api.js`, `src/store.js`, `src/components/Settings.jsx`, `.env.example`, `docker-compose.yml`, `docker-compose.dev.yml`
  - New: `migrations/020_notification_engagement.sql`

- feat(notifications): pushover transport with emergency priority [M]
  - **Problem.** iOS Safari throttles web push aggressively — notifications get buried, sometimes only deliver when the app is foregrounded, and sometimes drop entirely. The escalation alarms that matter most are unreliable on the device that matters most. Pushover has a dedicated iOS app with full APNs entitlements and supports priority-2 (Emergency) which repeats every 30s for up to 1h and bypasses Do Not Disturb / silent mode.
  - **New module `pushoverNotifications.js`.** Mirrors `pushNotifications.js` shape — 60s `setInterval` loop, same throttling/quiet-hours/active-task helpers, dispatches to all six notification types (high-pri, overdue, stale, nudge, size, pile-up) plus package events. Native `fetch` only — no new npm deps.
  - **Priority mapping:** stage 1 high-pri / nudge / stale / size / pile-up → 0 (normal). Stage 2 high-pri / generic overdue → 1 (`pushover` sound, bypasses quiet hours). Stage 3 high-pri / avoidance + Stage 3 → 2 (`persistent` Emergency, bypasses quiet hours and DND).
  - **Receipt cancellation.** Priority-2 sends save the receipt id to a new `tasks.pushover_receipt` column. When the user resolves the task (status change to done/cancelled/projects/backlog, future-snooze, due-date-forward, reframe added) or deletes it, `db.js` `updateTaskPartial`/`deleteTask` fires `cancelEmergencyReceipt` — alarm stops as soon as the user acts. Single insertion catches both HTTP routes and Quokka adviser tools.
  - **Test endpoints.** `POST /api/pushover/test` (priority-0 hello), `POST /api/pushover/test-emergency` (real priority-2 alarm with 90s auto-cancel so it doesn't ring for an hour), `GET /api/pushover/status`. Settings UI exposes both test buttons with a confirm dialog on the Emergency one.
  - **Migration 019.** `ALTER TABLE tasks ADD COLUMN pushover_receipt TEXT` plus `db.js` schema constants/UPSERT/row mapping updated.
  - **Settings UI.** New Pushover section with masked User Key + App Token inputs, helper text explaining the priority levels and quiet-hours bypass, eight per-type toggles (high-pri, overdue, stale, nudge, size, pile-up, package delivered, package exception), Test Pushover and Test Emergency buttons. Defaults: enabled toggles for high-pri, overdue, pile-up, package delivered, package exception (the avoidance-prone tiers); off by default for stale/nudge/size to keep noise down on day one.
  - **Env fallback.** Optional `PUSHOVER_DEFAULT_APP_TOKEN` for self-hosted installs that want a single shared app token; per-user keys still required. `Settings.jsx` indicates when the App Token is coming from env.
  - **Package events.** `sendPackagePushover` invoked alongside email + web push on delivered/exception/out-for-delivery/signature events. Exception and signature events go priority 1; delivered/out-for-delivery go priority 0.
  - **Classification: enhancement, not blocking.** Web push and email continue to work as-is. Users without Pushover credentials experience zero behavior change; the dispatcher is its own loop and failures are isolated.
  - New: `pushoverNotifications.js`, `migrations/019_add_pushover_receipt.sql`
  - Modified: `server.js`, `db.js`, `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `src/api.js`, `src/store.js`, `src/components/Settings.jsx`, `CLAUDE.md`, `README.md`, `wiki/Configuration.md`, `wiki/Docker.md`, `wiki/Architecture.md`, `wiki/Features.md`, `wiki/Getting-Started.md`

---

## 2026-04-23

- feat(quokka): multi-chat with 30d TTL + star-to-keep + 7d unstar grace [L]
  - **Problem.** Quokka had a single "current thread" — every topic piled into the same conversation with no separation. History was a rolling 30-entry archive only populated when you hit "Start over" or left idle for 24h, and you could only rehydrate one at a time (losing the current on switch).
  - **New model.** `app_data.adviser_chats` holds an array of independent chats; `app_data.adviser_active_chat_id` tracks which one Quokka is currently reading/writing. Each chat: `{id, title, messages, sessionId, starred, createdAt, updatedAt, expiresAt}`. Switching between chats preserves state across the board.
  - **Lifetime rules.** On create or message activity, non-starred chats get `expiresAt = now + 30d` (rolling). Starring clears `expiresAt`; unstarring sets it to `now + 7d` and surfaces an orange banner in the chat: "This chat will be deleted in N days. Star to keep." A sweep runs on every list call, deleting anything past `expiresAt`.
  - **Migration.** One-shot on first access after upgrade: the old `adviser_thread` becomes the active chat *pre-starred* (so the upgrade can't silently lose your in-flight conversation), and every `adviser_archive` entry becomes a peer chat with a fresh 30d TTL clock. Legacy keys are zeroed out so migration only runs once.
  - **Server endpoints (replace old thread/archive routes):**
    - `GET /api/adviser/chats` — list summaries + activeId (sweep runs here)
    - `GET /api/adviser/chats/active` — active chat full content
    - `GET /api/adviser/chats/:id` — single chat full content
    - `POST /api/adviser/chats` — create new empty chat, auto-activate
    - `PATCH /api/adviser/chats/:id` — update messages/title/sessionId; bumps `updatedAt` + rolls 30d TTL
    - `DELETE /api/adviser/chats/:id` — delete; clears active if it was the active chat
    - `POST /api/adviser/chats/:id/activate` — switch active
    - `POST /api/adviser/chats/:id/star` — `expiresAt = null`
    - `POST /api/adviser/chats/:id/unstar` — `expiresAt = now + 7d`
  - **Client.** `useAdviser.js` rewritten: hydrates on mount by fetching chat list + active chat body, persists active chat's messages/sessionId debounced at 400ms (same as before), exposes `newChat`, `switchChat`, `deleteChat`, `starChat`, `unstarChat`. `Adviser.jsx` replaces the History panel with a full chat-list panel — star icon per row (filled = starred), delete icon, active indicator, "expires in Nd" meta when within 7 days of expiry. A `+` icon in the header creates a new chat.
  - **Expiry banner** in the active chat when `expiresAt - now < 7d && !starred`: one tap "star to keep" button makes it infinite. Covers both the normal 30d winding down and the unstar 7d grace.
  - Removed helpers: `adviserGetThread`, `adviserSaveThread`, `adviserClearThread`, `adviserListArchive`, `adviserGetArchivedThread`, `adviserDeleteArchivedThread`, `adviserRehydrateThread`. Replaced by the `adviser*Chat*` family in `src/api.js`.
  - Modified: `server.js`, `src/api.js`, `src/hooks/useAdviser.js`, `src/components/Adviser.jsx`, `src/components/Adviser.css`, `CLAUDE.md`, `wiki/Architecture.md`, `wiki/Features.md`

- refactor(notion): rip dead Stage 1 OAuth + duplicate quokka tools + legacy UI [M]
  - Stage 1's public-integration OAuth was never used — the flow required users to register a Notion "Public" integration with privacy policy / TOS / support email, which was absurd for a personal self-hosted app. Stage 2 (MCP with DCR) sidesteps that entirely, so Stage 1 was dead code.
  - Removed server-side: `NOTION_OAUTH_TOKENS_KEY`, `refreshNotionToken()`, `getNotionOAuthClientId()`, `envNotionOAuthClientId`, `envNotionOAuthClientSecret`, `/api/notion/oauth/auth-url`, `/api/notion/oauth/callback`, `/api/notion/oauth/status`, `/api/notion/oauth/disconnect`, plus `notion_oauth` field from `GET /api/keys/status`. `getNotionAccessToken(req)` simplified to MCP-first with legacy-token fallback (the Stage 1 OAuth check is gone).
  - Removed client-side: `notionOAuthAuthUrl`, `notionOAuthDisconnect` from `src/api.js`; Stage 1 OAuth state / handlers / postMessage listener / Settings UI section.
  - Removed duplicate Quokka Notion REST tools: `notion_search` and `notion_get_page` were registered on boot alongside the MCP-bridged `notion_mcp_*` tools — the model would pick REST unpredictably, causing the filament-inventory confusion (REST used the legacy integration token while MCP had user-scoped access). MCP's native `search` and `fetch` tools do the same job, so the duplicates are gone. `notion_query_database` stays — no MCP equivalent.
  - Simplified Settings UI: Notion section now shows only the MCP panel (primary path). Legacy integration-token input field + "Connect with token" button are gone; the server-side `NOTION_INTEGRATION_TOKEN` env var still works as a fallback and surfaces as a small inline note when MCP isn't connected.
  - `/api/notion/status` response cleaned up: was `{connected, auth: 'oauth'|'legacy', oauth, legacy, workspace_name, bot}`, now `{connected, auth: 'mcp'|'legacy', mcp, legacy, bot}`.
  - Modified: `server.js`, `src/api.js`, `src/components/Settings.jsx`, `adviserToolsIntegrations.js`

- fix(notion): let MCP OAuth token back all REST endpoints [XS]
  - Symptom: after connecting via MCP, Quokka would find the filament database via `notion_mcp_notion_search` (user-scoped access works) but then fall through to the REST `notion_query_database` tool, which was hitting the legacy integration token and returning "database not shared with integration" errors. MCP and REST were authing separately.
  - Fix: `getNotionAccessToken(req)` in `server.js` now checks `notion_mcp_tokens.access_token` first. Notion's MCP flow issues a standard OAuth access token (via Dynamic Client Registration), which is also valid as a bearer token against Notion's REST API — so every REST endpoint + Quokka's REST-backed tools now inherit MCP's user-scoped access automatically.
  - `notionMCP.js` now stamps `saved_at: Date.now()` on every token save so the server-side resolver can decide freshness without duplicating the MCP SDK's refresh logic. The SDK still owns refresh; the resolver just avoids using obviously-stale tokens.
  - Modified: `server.js`, `notionMCP.js`

- fix(docker): include notionMCP.js in production image [XS]
  - Stage 2's `notionMCP.js` was missing from the Dockerfile's explicit `COPY` list, so the production container crashed on startup with `ERR_MODULE_NOT_FOUND: Cannot find module '/app/notionMCP.js'`. Pre-push smoke test didn't catch it because it runs `node server.js` from the full repo checkout (where the file exists), not against a built Docker image. Added `notionMCP.js` to line 24.
  - Modified: `Dockerfile`, `wiki/Version-History.md`

- feat(notion): MCP client — Stage 2 of MCP migration [L]
  - **Why.** Stage 1's public-integration OAuth required the user to register a Notion "Public" integration (privacy policy, TOS, support email, etc.) — absurd friction for a personal self-hosted app. Notion's hosted MCP server sidesteps this entirely: it uses OAuth 2.0 + PKCE + Dynamic Client Registration (RFC 7591), so the client registers itself programmatically at the first auth attempt. No app pre-registration, no public-integration red tape.
  - **New module `notionMCP.js`.** Wraps `@modelcontextprotocol/sdk` v1.29. Implements `OAuthClientProvider` backed by `app_data` (three keys: `notion_mcp_client` for DCR result, `notion_mcp_tokens` for access/refresh, `notion_mcp_pkce` for transient PKCE state). Singleton `Client` + `StreamableHTTPClientTransport` against `https://mcp.notion.com/mcp`. Lazy reconnect, `autoReconnect()` on server startup if tokens exist.
  - **New endpoints:** `POST /api/notion/mcp/connect` (returns auth URL; the module captures Notion's redirect URL via `redirectToAuthorization()` during the aborted first connect), `GET /api/notion/mcp/callback` (calls `transport.finishAuth(code)`, reconnects, closes popup via postMessage), `GET /api/notion/mcp/status`, `GET /api/notion/mcp/tools`, `POST /api/notion/mcp/disconnect`.
  - **Dynamic Quokka tool registration.** After MCP connects and tool list is fetched, every read-only MCP tool (`annotations.readOnlyHint === true`) is bridged into Quokka's registry with a `notion_mcp_` prefix. Quokka now sees the full native Notion MCP tool surface in real time — no hardcoded wrappers. MCP tool results are normalized: JSON-text content is parsed, multi-text content is joined, errors throw. Mutations (non-readOnly) are skipped in Stage 2 — the existing REST-backed `notion_create_page` / `notion_update_page` tools keep running with their existing compensation/rollback logic. Stage 3 will migrate writes.
  - **Settings UI.** New "Notion MCP (recommended)" panel at the top of the Notion integration section. One button — "Connect via MCP" — opens Notion's OAuth popup. On successful callback, postMessage triggers a status refresh showing `Connected — N tools discovered`. Stage 1 public-integration OAuth and legacy integration-token paths drop below as fallbacks.
  - **Scope.** Stage 2 is read-only Quokka tools via MCP + user auth via MCP. The legacy REST proxy endpoints (used by `useNotionSync` / `useExternalSync`) remain unchanged — still authenticate via `getNotionAccessToken(req)` which falls back to the legacy integration token. Stage 3 will migrate those background sync paths to MCP and delete the REST proxy code.
  - New: `notionMCP.js`, `@modelcontextprotocol/sdk` dependency
  - Modified: `server.js`, `src/api.js`, `src/components/Settings.jsx`, `package.json`, `CLAUDE.md`, `wiki/Architecture.md`, `wiki/Features.md`

- feat(notion): OAuth auth + database-query tool — Stage 1 of MCP migration [M]
  - **Why.** The legacy internal-integration token model requires every page/database to be explicitly shared with the integration via Connections, and doesn't expose database-row querying through Quokka. Blocks both the unified-workspace-access goal and concrete use cases like surfacing filament-inventory rows inside the app.
  - **OAuth connection.** New `/api/notion/oauth/auth-url`, `/api/notion/oauth/callback`, `/api/notion/oauth/status`, `/api/notion/oauth/disconnect`. Server-side token storage at `app_data.notion_oauth_tokens` mirrors the GCal pattern (access + refresh + expiry). Client-side popup flow in Settings listens for `notion-connected` postMessage and refreshes status.
  - **Token resolution precedence.** `getNotionAccessToken(req)` prefers the OAuth access token (refreshing with 5-min buffer via HTTP Basic auth against `https://api.notion.com/v1/oauth/token`), falling back to the legacy integration token (`x-notion-token` header / `NOTION_INTEGRATION_TOKEN` env). All 13 existing `/api/notion/*` endpoints now use the async resolver, so switching to OAuth requires zero changes to existing sync code paths.
  - **Database queries, flattened.** `/api/notion/databases/:id/query` now returns `properties` as a plain flat map (title/rich_text → string, number → number, select/multi_select/status → name(s), date → {start, end}, checkbox → bool, etc.) via a new `flattenNotionProperties()` helper, so callers don't have to re-interpret Notion's property schema.
  - **Quokka tool.** New `notion_query_database` tool in `adviserToolsIntegrations.js` with the same flattened-property shape. Accepts `database_id`, optional Notion `filter` / `sorts` / `page_size` / `start_cursor`. 50 tools now (was 49).
  - **Settings UI.** The Notion block leads with an OAuth "Connect with Notion" button (when `NOTION_OAUTH_CLIENT_ID` + `NOTION_OAUTH_CLIENT_SECRET` are configured via env). Legacy integration-token path is collapsed under a "Use a legacy integration token instead" disclosure. Users with a legacy token connected see an "Upgrade to OAuth" nudge with an explanation of the per-page-sharing limitation.
  - **Sequencing.** This is Stage 1 of three. Stage 2 will migrate Quokka's 4 Notion tools (`notion_search`, `notion_get_page`, `notion_create_page`, `notion_update_page`) to call the hosted Notion MCP server via an MCP client, building reusable MCP-client infrastructure. Stage 3 will migrate `useNotionSync` + `useExternalSync` + the server REST proxy to MCP, deleting the legacy Notion REST code. After Stage 1 alone, both goals (no per-page-sharing friction, database queries) are already met for OAuth-connected users; stages 2-3 are architectural purity rather than user-visible capability.
  - Env vars: `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET` (new). Legacy `NOTION_INTEGRATION_TOKEN` still honored.
  - Modified: `server.js`, `adviserToolsIntegrations.js`, `src/api.js`, `src/components/Settings.jsx`, `CLAUDE.md`, `wiki/Architecture.md`, `wiki/Features.md`

---

## 2026-04-22

- feat(adviser): multi-part tasks + research tool + web search + checklist cruft cleanup [L]
  - **Multi-part tasks.** `create_task` now accepts `checklist_items` (array of `{text, checked?}`) and optional `checklist_name`. Staged one umbrella task with a populated sub-list instead of 8 bouncing independent tasks. System prompt rule #9 tells Quokka to prefer this shape when the user says "break this down" or "plan for X."
  - **Research tool.** New `research_task` (50 tools now). Takes a `task_id` + optional `focus`, makes its own Claude call with Anthropic's server-side web_search enabled, appends the result to the task's notes under a dated `--- Research (YYYY-MM-DD) ---` divider. Existing notes preserved. Compensation restores the pre-research notes on plan rollback.
  - **Web search in the main chat loop.** Added `{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }` to Quokka's tools array. Anthropic runs the search server-side during the API call and returns results inline — we surface the activity via SSE `tool_call` / `tool_result` events so the user sees "web_search: <query>" in the tool log. System prompt rule #8 tells Quokka when to use it.
  - **Checklist format cleanup.** The app had two coexisting checklist formats: a legacy flat `task.checklist` and a newer named `task.checklists` (multi-list). EditTaskModal migrated flat → named on read, but TaskCard + store.js + EditTaskModal's save path still wrote to the old field, and every DB row carried both columns. Cruft.
    - New migration `018_migrate_legacy_checklist.sql` converts any task with legacy items + no new-format data into a single named "Checklist" entry; leaves tasks that already have named checklists alone.
    - `src/components/TaskCard.jsx` now only reads `task.checklists` (the fallback wrapper around `task.checklist` is dead code post-migration) and the checkbox handler only writes to `checklists`.
    - `src/components/EditTaskModal.jsx` no longer writes `checklist: []` on save — the field stays `[]` naturally now that nothing populates it.
    - `adviserToolsTasks.js` `create_task` writes to `checklists` directly, not the legacy field.
    - `checklist_json` column stays in the DB (SQLite column drops are painful, will be inert going forward).
  - **Parked: attachment uploads.** No way to hand Quokka a PDF/image and say "make tasks from this" yet. Noted in CLAUDE.md under "Parked (future)."
  - Modified: `server.js`, `adviserToolsTasks.js`, `src/components/TaskCard.jsx`, `src/components/EditTaskModal.jsx`, `CLAUDE.md`
  - New: `migrations/018_migrate_legacy_checklist.sql`
- docs(adviser): fill architecture gaps — thread/archive endpoints + SSE resilience [XS]
  - `wiki/Architecture.md` routes table was missing the 7 thread/archive endpoints added across recent commits. Added them.
  - Added an "SSE resilience" paragraph to the AI Adviser architecture section covering the priming comment + `res.flush()`, 15s heartbeat, 90s per-turn timeout, and verbose logging — all introduced while debugging the iOS "Load failed" issue but never documented.
  - Added a "Thread persistence + archive" paragraph explaining the `app_data.adviser_thread` + `app_data.adviser_archive` storage model, 24h TTL auto-archive, 30-entry cap, 60-char title generation, and the rehydrate flow.
  - Modified: `wiki/Architecture.md`
- fix(adviser): tasks moved back to active via Quokka don't show up stale [XS]
  - `isStale()` in `src/store.js` computes staleness from `last_touched`. The manual UI flow (App.jsx:293) already sets `last_touched` on every status transition, so moving a task Backlog → Active via the UI resets the staleness timer correctly. Quokka's tools (`update_task`, `complete_task`, `reopen_task`, `move_to_projects`, `move_to_backlog`, `activate_task`, `snooze_task`, `create_task`, `spawn_routine_now`) were only writing `updated_at` — so a task pulled out of backlog after a week would land on the active list already flagged stale.
  - Fix: every adviser task mutation now writes `last_touched = now` alongside `updated_at`, matching what the manual UI does. Backlog → Active via Quokka now resets the stale timer the same way it would if you'd clicked Activate in the app.
  - Modified: `adviserToolsTasks.js`
- feat(adviser): archive past Quokka chats + rehydrate from history [M]
  - Previously: hitting "Start over" deleted the thread. Any prior conversation was gone.
  - Now: "Start over" (and the 24-hour idle TTL expiry) archive-then-clear. Past chats land in `app_data.adviser_archive`, a rolling list capped at 30 entries, newest first. Auto-generated title from the first user message (60-char truncation).
  - New endpoints: `GET /api/adviser/archive` (summaries), `GET /api/adviser/archive/:id` (full thread), `DELETE /api/adviser/archive/:id`, `POST /api/adviser/archive/:id/rehydrate` (archives the current thread, restores the selected one, removes it from the archive list so there are no duplicates). Rehydrate drops `sessionId` — a new server-side adviser session is minted on the next `/chat` call.
  - History UI: a small History icon next to "Start over" in the Adviser header (desktop + mobile). Opens an in-modal panel listing past chats with title, timestamp, message count, and a per-row trash button. Tapping a chat rehydrates it. Intentionally tucked away behind an icon — matches "doesn't need to be easy to get to but it should be possible."
  - Related fixes: added `console.error('[Quokka] stream error', err)` in the SSE onError handler so the next Load failed leaves a trace visible in Safari remote debugging (user-facing banner still shows the short message). Added a system-prompt rule (#7) telling Quokka to BATCH tool calls in a single assistant turn for bulk operations — serial tool-use loops over 15+ turns are the most likely cause of mobile Load failed.
  - Modified: `server.js`, `src/api.js`, `src/hooks/useAdviser.js`, `src/components/Adviser.jsx`, `src/components/Adviser.css`, `CLAUDE.md`
- feat(adviser): render markdown in Quokka messages [S]
  - Quokka's replies contain markdown (`**bold**`, bullet lists, headings) but we were rendering them as plain text, so the UI showed literal `**Apr 23**` stars and raw `- ` bullets. Hideous.
  - Added a tiny dependency-free markdown renderer at `src/utils/renderMarkdown.js` that handles the subset Claude actually emits: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`, `#`-headings, `-`/`*` bullet lists, numbered lists, and paragraph breaks. Returns React nodes (no `dangerouslySetInnerHTML`).
  - Added matching styles in `Adviser.css` with tight vertical rhythm so a whole message still reads as one block, not a document.
  - User bubbles stay plain text (no processing) — user input isn't markdown.
  - New: `src/utils/renderMarkdown.js`
  - Modified: `src/components/Adviser.jsx`, `src/components/Adviser.css`
- feat(adviser): thread persistence lives server-side, not localStorage [M]
  - Previously: Quokka's conversation lived in React state in App.jsx, which iOS Safari aggressively evicts when the PWA is backgrounded, switched away from, or inactive. User switches to Gmail to check something, comes back, thread is gone. Unusable.
  - Now: thread stored in `app_data.adviser_thread` inside the container. Three new endpoints: `GET /api/adviser/thread`, `POST /api/adviser/thread` (writes `{messages, sessionId, updatedAt}`), `DELETE /api/adviser/thread`. 24-hour idle TTL drops abandoned threads on next GET.
  - Client (`useAdviser`): hydrates from server on mount; persists on every `messages`/`sessionId` change with a 400ms debounce so a streaming response doesn't hammer the save endpoint; clears server thread on "Start over."
  - Messages capped to last 40 bubbles server-side to prevent the blob from ballooning.
  - Modified: `server.js`, `src/api.js`, `src/hooks/useAdviser.js`, `CLAUDE.md`
- fix(adviser): plan previews show names instead of raw IDs [S]
  - Before: "Update task 15c85061-8088-4829-b9f4-8fb1670df39e: due_date" — unreadable, you have no idea which task Quokka is about to touch.
  - After: "Update \"Buy furnace filters\": due_date" — the preview reads like English.
  - For local tasks/routines: added `taskLabel(id)` / `routineLabel(id)` helpers in `adviserToolsTasks.js` that do a sync DB lookup and return the title (truncated to 60 chars). All 13 task/routine preview strings now use them.
  - For external resources (GCal events, Notion pages, Trello cards) there's no local title to look up, so added optional `summary_hint` / `title_hint` / `name_hint` / `card_name_hint` fields to the respective tool schemas. Marked the fields explicitly as "not sent to the external API" — they only feed the preview string. Updated the Quokka system prompt to require hints on every external update/delete/archive call so the user never sees an opaque ID again.
  - Modified: `adviserToolsTasks.js`, `adviserToolsIntegrations.js`, `server.js`, `wiki/Version-History.md`
- feat(adviser): Quokka naming + thread persistence + debug logging + composer fix [M]
  - **Renamed to Quokka.** User-facing strings ("AI Adviser" → "Quokka") in the modal title, empty-state heading/subtitle, and header icon tooltip. System prompt now gives Claude the persona: a cheerful quokka-mascot vibe named after the perpetually-smiling Australian marsupial, with light Aussie warmth ("g'day", "no worries") kept deliberately restrained. Internal code (module filenames, `/api/adviser/*` endpoints, `.adviser-*` CSS classes, `showAdviser` state) stays as `adviser` — renaming plumbing adds churn without value.
  - **Thread now persists across modal close/reopen.** `useAdviser()` moved up to `App.jsx` so conversation state survives the user closing the modal. They can step away, check something, and come back to the same thread. The server session's 10-minute TTL still reclaims truly abandoned sessions; `adviserAbort()` only fires when the page actually unmounts.
  - **Composer textarea auto-grows.** Was stuck at `rows=1` so multi-line suggestions (like the "I've rescheduled my FAA exam" preset) got clipped at the bottom. Added an effect that syncs height to scrollHeight on every input change, plus bumped min-height 40→44, max-height 140→160, and added `env(safe-area-inset-bottom)` padding to the composer so it clears the iOS home indicator.
  - **Verbose server logging + timeouts.** The chat endpoint was silent — when something hung, `docker logs` showed nothing. Added `[Adviser <8char>]`-prefixed logs at every step (chat start, per-turn model call with latency, stop_reason, each tool call + result + timing, session end with staged-step count, errors). Added a 90-second per-turn timeout on Claude calls via a nested `AbortController` so the model can't hang indefinitely. Added a 15s heartbeat (`: heartbeat` comment line) to keep long-lived SSE connections alive through proxies. Primed the stream with `: connected\n\n` + `res.flush()` so iOS Safari / CDN layers commit the chunked response immediately instead of buffering the first KB.
  - Modified: `src/App.jsx`, `src/components/Adviser.jsx`, `src/components/Adviser.css`, `src/hooks/useAdviser.js`, `server.js`, `CLAUDE.md`, `wiki/Features.md`
- chore(deps): pin `serialize-javascript` >= 7.0.5 to close 4 high-sev advisories [XS]
  - Transitive dep of `vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-terser`. Versions <= 7.0.4 are vulnerable to RCE via RegExp.flags / Date.prototype.toISOString and to CPU-exhaustion DoS via crafted array-likes. Build-time only (never shipped to browsers), but GitHub Dependabot was flagging it on `main`.
  - Fix: added `"serialize-javascript": "^7.0.5"` to the existing `overrides` block in `package.json` (same pattern used for `lodash`). Preferred over `npm audit fix --force` because the latter would downgrade `vite-plugin-pwa` from 1.2.0 → 0.19.8 (breaking). `npm audit` now reports 0 vulnerabilities.
  - Modified: `package.json`, `package-lock.json`
- feat(adviser): AI Adviser — free-form natural-language control surface across every app capability [XL]
  - **Server-side engine (`adviserTools.js`)** — in-memory tool registry + session-scoped plan storage (10-min TTL, 1-min sweep). `registerTool()`, `handleToolCall()`, `commitPlan()`. Read-only tools run live during the tool-use loop; mutation tools return a preview string + stage a step. Plans commit atomically with LIFO compensation rollback on any step failure.
  - **49 tool definitions** across four modules:
    - `adviserToolsTasks.js` — 17 task + routine tools (search, CRUD, complete/reopen, snooze, move between statuses, routine CRUD + spawn-now)
    - `adviserToolsIntegrations.js` — 12 GCal + Notion + Trello tools (list/get/create/update/delete events, search pages, create/update pages, card + checklist operations)
    - `adviserToolsMisc.js` — 20 Gmail + packages + weather + settings + analytics tools
  - **Endpoints:**
    - `POST /api/adviser/chat` — SSE streaming. Runs the Claude tool-use loop (max 15 turns), emits `session`, `turn`, `message`, `tool_call`, `tool_result`, `plan`, `done`, `error` events live.
    - `POST /api/adviser/commit` — executes the staged plan. Coalesces SSE broadcast into a single version bump after success.
    - `POST /api/adviser/abort` — cancels the in-flight Claude request + clears the session.
    - `GET /api/adviser/tools` — diagnostic tool list.
  - **Rollback compensation:** local DB creates delete, updates restore captured pre-state, deletes re-insert. External API creates delete/archive the resource; updates capture pre-state via GET then PATCH back; external deletes log a warning (can't be restored).
  - **Search-first context:** no task dump in the system prompt. Model explores via `search_tasks`/`list_routines`/`gcal_list_events`/`notion_search` — same prompt size at 10 tasks or 1000.
  - **Security:** secret keys (API tokens) redacted in `get_settings` output, blocked from `update_settings` writes. Auth tokens pass through a per-request `deps` closure — Claude never sees them.
  - **Client (`src/components/Adviser.jsx` + `Adviser.css` + `src/hooks/useAdviser.js` + additions to `src/api.js`)** — chat modal (sheet on desktop, full-screen on mobile), live tool-call progress log, plan preview with Apply/Cancel bar, streaming SSE reader, abort button, prompt suggestions on empty state.
  - **Header reshuffle:** the ✨ sparkle AI Adviser icon takes the slot where the Settings gear used to be. Settings moves into the overflow `⋯` menu alongside Projects / Import / Analytics / Activity Log.
  - **Dockerfile:** `COPY` line updated to include all four adviser server modules.
  - New: `adviserTools.js`, `adviserToolsTasks.js`, `adviserToolsIntegrations.js`, `adviserToolsMisc.js`, `src/components/Adviser.jsx`, `src/components/Adviser.css`, `src/hooks/useAdviser.js`
  - Modified: `server.js`, `Dockerfile`, `src/App.jsx`, `src/api.js`
- fix(ui): priority toggle height mismatches on Routines + EditTaskModal [S]
  - `.priority-toggle` had no explicit height so it rendered ~28px tall next to ~36-40px date inputs — visible mismatch on the Priority / End Date row in the routine add/edit form. Added `min-height: 40px` + explicit horizontal padding so it matches siblings everywhere it's used.
  - In the EditTaskModal's three-column DUE / DUR (MIN) / PRI row, iOS renders `type="date"` a couple pixels taller than neighboring inputs due to its native picker chrome. Forced the row's inputs to `height: 40px` (was 36) and added `-webkit-appearance: none` + normalized `line-height` on the date input so all three fields share exactly the same exterior size.
  - Modified: `src/components/EditTaskModal.css`

---

## 2026-04-20

- feat(tasks): extract text from attachments via Claude vision/documents [S]
  - New `extractAttachmentText(attachments)` in `src/api.js` — sends images through Claude vision and PDFs through the documents API to pull verbatim text. Plain-text files (`text/*`) are decoded directly without a round-trip. Multi-file results get a `--- filename ---` separator.
  - "Extract text" button appears next to "+ Attach" in AddTaskModal and in the EditTaskModal attachments section once an attachment exists. Output is appended to the task's notes — useful for screenshots of receipts, photos of handwritten lists, or PDF instructions.
  - Modified: `src/api.js`, `src/hooks/useTaskForm.js`, `src/components/AddTaskModal.jsx`, `src/components/EditTaskModal.jsx`
- fix(tasks): photo attachments no longer crash the app [S]
  - Attaching a photo (especially from an iPhone) could crash Boomerang to a blank screen. Typical iPhone photos are 2-5 MB raw, which inflates to ~2.7-6.7 MB as base64. That blew past the server's 2 MB `express.json()` body limit on sync, past iOS Safari's ~5 MB `localStorage` quota when `saveTasks` ran, and could OOM the tab during `JSON.stringify`. Since there's no React ErrorBoundary, any of those threw a white screen.
  - New util `src/utils/imageCompress.js` — `processAttachment(file)` downscales image attachments through a canvas (max 1600px on the long edge, JPEG quality 0.82). Typical phone photos drop to 200-400 KB, fitting comfortably in all three limits. Non-image files go through a hardened FileReader wrapper that actually handles `onerror` and null `result`.
  - Both attachment entry points (quick-add via `useTaskForm`, edit modal's inline upload) now run through the util. HEIC or other undecodable images fall back to the raw base64 path so the attachment still works even if the browser can't re-encode it.
  - Modified: `src/hooks/useTaskForm.js`, `src/components/EditTaskModal.jsx`
  - New: `src/utils/imageCompress.js`

---

## 2026-04-17

- feat(routines): day-of-week scheduling + manual "Create Now" button [M]
  - New optional `schedule_day_of_week` column on routines (migration 017). When set (0=Sun … 6=Sat), `getNextDueDate()` computes the cadence interval end, then snaps forward to the first occurrence of that weekday. Example: weekly + Fri → spawn every Friday; quarterly + Sat → spawn on the first Saturday after the 3-month mark (may drift up to 6 days from the exact quarter, which is fine for "air filter on a weekend" style routines).
  - "Daily" cadence ignores the weekday anchor (daily fires every day anyway, so a weekday filter makes no sense).
  - New "On" dropdown in the routine add/edit form next to Frequency. Default "Any day" preserves current behavior.
  - Scheduled weekday is surfaced on the routine card's cadence meta (e.g. "weekly · Fri").
  - New "Create now" button in the expanded routine toolbar — bypasses the schedule and immediately spawns a one-off task with due date today. Does NOT add to `completed_history`, so the cadence clock is untouched until the task is completed. Useful for "I want to mow today even though it's not Friday."
  - New: `migrations/017_add_routine_schedule_day.sql`
  - Modified: `db.js`, `src/store.js`, `src/App.jsx`, `src/hooks/useRoutines.js`, `src/components/Routines.jsx`
- feat(tasks): background auto-sizer — every task gets sized regardless of create path [M]
  - Auto-sizing was only firing on the quick-add + add modal + Gmail-approve paths, plus the manual "Auto" button. Tasks from routines, Notion sync, Trello sync, GCal pull, markdown import were silently staying null-sized — breaking the points formula (`SIZE_POINTS[null] || 1` = 1 point instead of the intended 5 for a default M).
  - New column `size_inferred` on tasks (migration 016). Existing tasks with a non-null size are marked as already-inferred so they won't be re-processed.
  - `createTask` now defaults size to `'M'` instead of `null`, so points always compute correctly immediately. The background hook refines it later.
  - New hook `useSizeAutoInfer(tasks, updateTask)` in `src/hooks/useSizeAutoInfer.js` — on every render, picks the first active task with `size_inferred = false` that hasn't been attempted this session, waits 500ms, calls `inferSize`, then updates `{ size, energy, energyLevel, size_inferred: true }`. On API failure, leaves the flag false so the next page load retries. Throttled per render, so a just-migrated DB with dozens of un-inferred tasks doesn't hammer Anthropic.
  - Manual user size pick in EditTaskModal / AddTaskModal now marks `size_inferred = true` so the background hook doesn't override. Deselecting falls back to `'M'` + `size_inferred = false` to re-trigger auto-infer.
  - `addTask` marks `size_inferred = true` whenever the caller provides an explicit size (e.g. quick-add's inline inferSize call that updates the task).
  - New: `migrations/016_add_size_inferred.sql`, `src/hooks/useSizeAutoInfer.js`
  - Modified: `db.js`, `src/store.js`, `src/App.jsx`, `src/hooks/useTasks.js`, `src/hooks/useTaskForm.js`, `src/components/EditTaskModal.jsx`
- fix(weather): due-date badge in card top row also respects visibility [XS]
  - The little weather badge next to "due in 6d" was rendering for inside-tagged tasks because it was on a separate render path that didn't consult `resolveWeatherVisibility`
  - Gated the badge so it only renders when visibility is `'visible'` — `inside` tag, `weather_hidden`, or auto-detected indoor now hide the badge in addition to the expanded weather UI
  - Modified: `src/components/TaskCard.jsx`
- feat(weather): per-card hide control with persistence [M]
  - New `weather_hidden` boolean on tasks (migration 015) — persists per task and syncs across devices
  - Per-card X button on the weather line on each card → click to collapse weather into the drawer for that specific task
  - "Hide weather on this card" checkbox in the EditTaskModal mirrors the same flag
  - Inside the drawer, when the hide was explicit (weather_hidden), a "Show weather on this card" button appears to flip it back
  - Clicking the "Weather" text in the drawer header toggles the drawer open/closed (the whole button is the click target)
  - Visibility rule priority reordered so per-card hide wins over the `outside` tag (per-card is more explicit)
  - New: `migrations/015_add_weather_hidden.sql`
  - Modified: `db.js`, `src/components/WeatherSection.jsx`, `src/components/TaskCard.jsx`, `src/components/TaskCard.css`, `src/components/EditTaskModal.jsx`
- refactor(weather): drop global hide-on-cards toggle — per-task tag control only [XS]
  - Previous commit added a system-wide `weather_cards_drawer` setting, but the intent was per-card control only
  - Removed the Settings toggle and the `defaultHidden` param from `resolveWeatherVisibility`
  - Per-task override via `inside` / `outside` tags remains the only way to adjust weather visibility beyond auto-detect
  - Modified: `src/components/WeatherSection.jsx`, `src/components/Settings.jsx`, `src/components/TaskCard.jsx`
- feat(weather): tag-based + global visibility control with drawer fallback [M]
  - The auto-detect heuristic was over-eager — tasks like "Gardyn Tank Refresh" (energy=physical, indoor garden) were getting weather UI they didn't need. New `resolveWeatherVisibility()` in `WeatherSection.jsx` consolidates the rules:
    1. Task tagged `outside`/`outdoor` → always shown
    2. Task tagged `inside`/`indoor` → in a collapsible drawer
    3. Global setting `weather_cards_drawer` true → drawer for everything (except `outside` tag)
    4. Auto-detected outdoor → shown
    5. Otherwise → hidden
  - Drawer is a small "🌤 Weather" disclosure button — collapsed by default, click to open. Applies to both the card best-days line and the modal 7-day forecast.
  - New Settings → Weather → "Hide weather on cards" toggle (`weather_cards_drawer`) with hint about the `inside`/`outside` tag overrides.
  - Fixed: 7-DAY FORECAST label in the edit modal was scrunched against the Status pills above it. Added 16px top margin.
  - Removed duplicate outdoor-detection code from TaskCard + EditTaskModal — both now share `resolveWeatherVisibility` and `isOutdoorTaskShape` from `WeatherSection.jsx`
  - Modified: `src/components/WeatherSection.jsx`, `src/components/TaskCard.jsx`, `src/components/TaskCard.css`, `src/components/EditTaskModal.jsx`, `src/components/Settings.jsx`
- refactor(weather): swap card and modal — best days on card, 7-day forecast in edit modal [S]
  - Previous placement had the full 7-day forecast taking too much room on outdoor cards
  - Cards (quick-expand on the main list) now show only the compact "Best days: …" line with a sun icon. No forecast widget.
  - Full 7-day forecast widget (3+4 layout with wind) now lives in the EditTaskModal, above the Notes field, only for outdoor tasks
  - The forecast reacts to in-modal edits of title + energy
  - Modified: `src/components/TaskCard.jsx`, `src/components/EditTaskModal.jsx`
- fix(ui): scheduling row — due/dur/pri columns no longer overlap on narrow screens [XS]
  - Explicit classes `scheduling-due`, `scheduling-dur`, `scheduling-pri` with fixed flex-basis for duration (76px) and priority (88px), so the "DUR (MIN)" label doesn't bleed into the date column
  - Date column flexes with `min-width: 0` so the native date input shrinks cleanly
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/EditTaskModal.css`
- fix(weather): best-days belongs in the expanded card view, not the full edit modal [XS]
  - Previous commit put the best-days line in EditTaskModal; intent was the expanded inline card view (the "quick-edit" you get by tapping a card on the main list)
  - Forecast widget stays on the card as a section, best-days line (with sun icon) now renders in the expanded section above the notes
  - Modified: `src/components/TaskCard.jsx`, `src/components/EditTaskModal.jsx`
- refactor(weather): card forecast widget reshaped, best-days moved to edit modal [S]
  - Forecast section is now always visible on outdoor task cards (not gated on expand) so the layout is glanceable from the list
  - Reshaped layout: centered row of 3 days (larger) + centered row of 4 days (smaller) below — less visual weight per card
  - Best-days line removed from the card and now lives in the EditTaskModal, just above the Notes field, with a sun icon to make the recommendation feel like a tip
  - Best-days computation in the modal reacts to live edits to title + energy (e.g. retag "mow" with people energy and the line disappears)
  - Modified: `src/components/WeatherSection.jsx`, `src/components/TaskCard.jsx`, `src/components/TaskCard.css`, `src/components/EditTaskModal.jsx`
- feat(weather): 7-day forecast section + best-days recommendation on outdoor task cards [M]
  - New `WeatherSection` component renders a 7-day forecast grid in the mobile expanded view: condition icon, high/low, wind speed per day, with the task's due date highlighted
  - New best-days recommendation line shown just above the notes: picks up to 3 days within the forecast window scored for outdoor suitability (clear/partly cloudy, low precip, moderate wind, comfortable temp). Rendered alongside notes, not written into the `notes` field — always fresh as the forecast changes
  - Only shown for outdoor-leaning tasks: `energy === 'physical' || energy === 'errand'` OR title matches outdoor keywords (mow, yard, garden, paint deck, wash car, shovel snow, hike, etc.)
  - Added `wind_speed_10m_max` + `wind_gusts_10m_max` to the Open-Meteo fetch so daily wind is available
  - New: `src/components/WeatherSection.jsx`
  - Modified: `weatherSync.js`, `src/components/TaskCard.jsx`, `src/components/TaskCard.css`
- fix(docker): include weatherSync.js in production image [XS]
  - The Dockerfile's explicit server-file COPY list was missing `weatherSync.js`, causing the container to crash on startup with `ERR_MODULE_NOT_FOUND`
  - Added `weatherSync.js` to the production stage COPY line
  - Modified: `Dockerfile`
- feat(weather): weather-aware suggestions, notifications, and card badges [L]
  - New `weatherSync.js` server module — fetches a 7-day forecast from Open-Meteo (free, no API key) every 30 min, caches in `app_data.weather_cache`
  - Manual location: user searches by city/zip in Settings → Integrations → Weather; geocoding via Open-Meteo's free search endpoint
  - Weather-aware "What Now?" — the AI prompt is enriched with today/tomorrow/weekend outlook so outdoor tasks get suggested on nice days before bad weather and indoor tasks get prioritized on rough days
  - Forecast badges on task cards — tasks with a `due_date` inside the 7-day forecast window render a small weather icon + high temperature next to the due-date meta
  - Weather notifications — detects three event types (rare-nice-day, rough-weekend, nice-stretch-incoming), de-duped per event via `notification_throttle`, delivered via push and/or email. No daily cap — multiple weather events in a day will all notify; the same event won't re-fire for ~18h
  - Morning digest (push + email) now includes a weather summary line when configured
  - New server endpoints: `GET /api/weather`, `POST /api/weather/refresh`, `POST /api/weather/geocode`, `POST /api/weather/clear-cache`
  - New settings: `weather_enabled`, `weather_latitude`, `weather_longitude`, `weather_location_name`, `weather_timezone`, `weather_notifications_enabled`, `weather_notif_push`, `weather_notif_email`
  - Graceful degradation — module is a complete no-op when disabled or no location set
  - Changing the location invalidates the cache and triggers an immediate refresh
  - New: `weatherSync.js`, `src/hooks/useWeather.js`, `src/components/WeatherBadge.jsx`
  - Modified: `server.js`, `emailNotifications.js`, `pushNotifications.js`, `src/api.js`, `src/App.jsx`, `src/contexts/TaskActionsContext.jsx` (via taskActions value), `src/components/TaskCard.jsx`, `src/components/TaskCard.css`, `src/components/Settings.jsx`, `src/components/WhatNow.jsx`

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
- docs: full documentation audit and testing plan rebuild [S]
  - UPCOMING_FEATURES.md: removed 4 completed items (morning digest, AI nudges, batching, Trello multi-list)
  - Architecture.md: added GET /api/analytics/history route to route table
  - CLAUDE.md: added keyboard shortcuts and analytics dashboard to architecture notes
  - Features.md: added Header Layout section describing Packages + Settings + overflow menu
  - Testing-Plan.md: rebuilt from scratch — 15 sections, added full analytics coverage (charts, heat map, breakdowns, search), scheduling row fix, header menu tests
- fix(ui): scheduling row alignment — due, duration, priority fields properly aligned [XS]
  - All three fields now use `align-items: flex-end` so labels sit above and inputs line up at bottom
  - Consistent 36px input height across date, duration, and priority toggle
  - Duration input uses dedicated `dur-input` class (was using `add-input` with wrong sizing)
  - Removed inline style overrides that caused misalignment
  - Modified: `src/components/EditTaskModal.jsx`, `src/components/EditTaskModal.css`
- feat(analytics): GitHub-style activity heat map and collapsible completed section [M]
  - 52-week heat map showing daily task or point density with color intensity scaling
  - Metric toggle (Tasks/Points) changes heat map coloring (green/orange)
  - Horizontal scroll on mobile for full year view
  - Month labels along top, DOW labels on left
  - Less/More legend for color scale
  - Completed tasks section now collapsible — click to expand, data fetched on demand
  - Modified: `src/components/Analytics.jsx`, `src/components/Analytics.css`
- feat(analytics): comprehensive analytics page with charts, breakdowns, search [L]
  - New `GET /api/analytics/history?days=30` endpoint — single SQL query aggregates all data server-side
  - Daily completion bar chart with tasks/points toggle and time range picker (7d/30d/90d/All)
  - Day-of-week productivity patterns chart with "best day" insight
  - Breakdowns by tag (with label colors), energy type (with icons), and size (with colored bars)
  - Completed tasks search with filters (energy type, size, tag)
  - All-time view groups by week to avoid hundreds of bars
  - Pure CSS bar charts — no charting libraries
  - Added `size` filter to `queryTasks` in db.js
  - Modified: `db.js`, `server.js`, `src/components/Analytics.jsx`, `src/components/Analytics.css`
- docs: add comprehensive Testing Plan to wiki [XS]
  - New `wiki/Testing-Plan.md` — checklist for all features from the April 2026 sprint
  - Updated `wiki/Features.md` — added markdown import, morning digest, desktop keyboard shortcuts, side drawer, richer cards, database sync, routine detection, recurring events, multi-list Trello, AI email nudges, batch mode
  - Updated `wiki/Architecture.md` — recurring event RRULE in external sync docs
  - Updated `CLAUDE.md` — header menu change noted
- style(ui): keep Packages and Settings visible, overflow the rest into menu [XS]
  - Header now shows: Packages icon + Settings gear + "..." overflow menu
  - Overflow menu contains: Projects, Import Markdown, Analytics, Activity Log
  - Modified: `src/App.jsx`
- refactor(ui): consolidate header icons into dropdown menu [S]
  - Replaced 4 individual icon buttons (Import, Projects, Packages, Settings) with a single "..." menu button
  - Menu also includes Analytics and Activity Log (previously only accessible from other views)
  - Click-outside to dismiss, Escape key closes menu
  - Cleaner header: just logo + menu trigger
  - Modified: `src/App.jsx`, `src/App.css`
- feat(notifications): morning digest, AI nudges, batch mode, Trello multi-list [L]
  - Morning digest (#15): scheduled daily summary via email and/or push at configurable time
  - AI email nudges (#16): nudge messages now use Claude AI when API key available, static fallback
  - Batch mode (#17): new `email_batch_mode` setting combines all notifications into one email
  - Trello multi-list sync (#18): checkbox list selector in Settings for syncing from multiple Trello lists
  - Settings UI: new Morning Digest section with email/push toggles and time picker, batch mode toggle, Trello multi-list checkboxes
  - Modified: `emailNotifications.js`, `pushNotifications.js`, `src/components/Settings.jsx`
- feat(sync): Google Calendar recurring event support [L]
  - Push sync: routine-spawned tasks now create recurring events with RRULE
  - Cadence mapping: daily, weekly, biweekly, monthly, quarterly, annually, custom → RRULE
  - Recurring event ID stored on routine (`gcal_recurring_event_id`) — subsequent spawned tasks link to it
  - Pull sync: recurring event instances collapsed by `recurringEventId` — only one task per series
  - Server returns `recurringEventId` on fetched events for recurring detection
  - Migration 014: `gcal_recurring_event_id` column on routines table
  - Modified: `src/hooks/useExternalSync.js`, `src/hooks/useGCalSync.js`, `src/store.js`, `server.js`
  - New: `migrations/014_add_gcal_recurring_id.sql`
- feat(notion): auto-suggest routines from recurring patterns in Notion pages [M]
  - During page-based Notion sync, AI analysis already returns `is_recurring` and `recurrence` fields
  - Recurring tasks now appear as purple suggestion banners instead of regular tasks
  - "Create" button creates a routine with the inferred cadence; "✕" dismisses permanently
  - Dismissed patterns stored in localStorage (`boom_notion_dismissed_patterns`)
  - Modified: `src/hooks/useNotionSync.js`, `src/App.jsx`
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
