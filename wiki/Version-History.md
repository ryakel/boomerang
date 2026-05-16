# Version History

Commit-level changelog for Boomerang, grouped by date. Sizes: `[XS]` trivial, `[S]` small, `[M]` medium, `[L]` large, `[XL]` extra-large.

---

## 2026-05-16

- docs(spec): activity prompts — auto-roll, habits, historic suggestions [S]
  - **Why.** User: three related needs surfaced in one ask — "prompt me to add things based on historic activities," "prompt me to work out a couple times a week (not ready for it to be a routine)," and "I need to be better about taking my pills, not sure routine is the right shape." Designed all three together first per user request before any code lands.
  - **Unifying shape.** "Suggest, don't spawn." Today's routines fire on cadence whether you wanted a task or not. The three needs all want softer behavior — the schedule knows when something *might* happen; spawning is decided per-instance.
  - **Three independent mechanisms, three PRs.**
    1. **`auto_roll` flag on routines.** Solves pills. If a non-terminal instance already exists when the schedule fires, roll its `due_date` forward instead of stacking a duplicate. You can't take two sets of pills to make up for the missed one.
    2. **`spawn_mode: 'habit'` on routines.** Solves workouts. Target N per week/month, no cadence-locked schedule, no auto-spawn. Always-visible routine card with "+ Log it" button for retroactive logging. Behind-pace web-push nudge mid-week, escalating Fri/Sat, never Pushover. Per-period streak tracking.
    3. **Pattern detection → `pattern_suggestions` table.** Solves historic prompts. Weekly Sunday 3am scan over 12 months of completed tasks, normalizes titles, detects cadence (daily / weekly / monthly / quarterly / annually) by interval mean+stddev, optional AI clustering pass for near-duplicate titles. Surfaces as new `routine_suggestion` notification type (web push default-on, email/Pushover default-off) deep-linking to a review screen.
  - **Durability lesson encoded.** `pattern_suggestions` lives server-side, outside the bulk-PUT path used by `/api/data` — same posture as `notification_log` after the 2026-05-07 wipe. A future wipe can't take suggestions out.
  - **Schema deltas planned.** Migrations 025 (`auto_roll` + `spawn_mode` + `target_count` + `target_period` on routines) and 026 (`pattern_suggestions` table). PR 1 only needs the `auto_roll` column; the habit columns can land with PR 2 cleanly.
  - **Open questions deferred to PR time** documented in the spec — cadence inference for accepted suggestions, annual cadence detection with only 2 occurrences, "not yet" auto-dismiss after 3 weeks, retroactive habit log dates, habit + sequences interaction.
  - **No code yet.** Spec-first per user request: "Spec first, then PR 1." Implementation lands in three follow-up PRs starting with PR 1 (auto-roll + pills).
  - Added: `wiki/Activity-Prompts.md`
  - Modified: `wiki/Version-History.md`, `wiki/Features.md`

---

## 2026-05-12

- feat: relocate Easter-egg triggers (build row + Quokka phrase) [S]
  - **Why.** User: "Let's actually put it on the build number so I don't accidentally edit something. Also I want to trigger it with quokka if I say 'Want to play a game'." Original 7-tap location (EditTaskModal title) was too easy to fat-finger while editing real tasks.
  - **TicTacToe lifted to AppV2.** Top-level state + render. Any modal can call `openEasterEgg()` to launch it. Removed from EditTaskModal entirely (title-tap counter, state, render, import).
  - **Build row trigger.** Settings → Logs → Build code (`__APP_VERSION__`) gets a 7-tap counter inside a rolling 2s window. Same Android-build-number metaphor, just on the version display where accidental triggering doesn't matter.
  - **Quokka phrase intercept.** AdviserModal's `handleSubmit` checks user input against `/\b(?:want to|wanna|let'?s|shall we) play (?:a |an )?game\b/i` before sending to the AI. Match → fire `onOpenEasterEgg`, clear input, skip the network call. No chat entry recorded; on game close, user is back in Quokka with a clean input. WarGames reference baked into the regex variants.
  - **ModalShell `onTitleTap` prop removed** — no callers now that EditTaskModal doesn't use it.
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/ModalShell.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/AdviserModal.jsx`, `wiki/Version-History.md`

---

## 2026-05-11

- feat: no-fault streak + hidden tic-tac-toe Easter egg [M]
  - **No-fault streak.** User: "Not every day is going to have something that needs to make it to the list, and gaming the list just to put something on it to check it off seems antithetical to the goal." Right. `computeStreak` now treats "empty days" (zero completions + zero active tasks on that calendar date) as no-fault — the streak walks across them instead of breaking. Manual `free_days` still respected.
  - **`hadActiveTasksOnDay(tasks, date)` helper.** A task counts as actionable on day D if: status is active (not in backlog/projects/cancelled), `created_at <= end-of-D`, `snoozed_until` null or `<= end-of-D`, and not already completed before start-of-D. If no tasks meet this on D and D has no completions, it's a no-fault day.
  - **Easter egg — hidden tic-tac-toe.** New `TicTacToe.jsx` component. Triggered by 7-tapping the EditTaskModal title within a rolling 2s window (Android build-number metaphor — works fine in PWAs, just JS click handlers + timing). On the player's first win each day, stamps `settings.easter_egg_wins[YYYY-MM-DD] = true` and contributes +1 task + +1 point to that day's `computeDailyStats`. Subsequent wins same day: no point. Win days also count as completion days for `computeStreak`.
  - **AI difficulty:** intentionally moderate, not unbeatable. Always takes a winning move, blocks the player's winning move 70% of the time, otherwise random. Means ~30% of player threats slip through — beatable without being trivial.
  - **Persistence:** stampWin writes to localStorage via `saveSettings`, then calls `onPointEarned` which is wired to `useServerSync.flush()` so the new wins map syncs to the server immediately (otherwise a subsequent SSE hydrate would wipe the local-only change).
  - **Discoverability:** zero user-facing copy mentions the egg. Power users find it by mashing the modal title — the same way Android users discover developer options.
  - Modified: `src/store.js`, `src/scoring.js`, `src/v2/AppV2.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/ModalShell.jsx`, `wiki/Version-History.md`
  - Added: `src/v2/components/TicTacToe.jsx`, `src/v2/components/TicTacToe.css`

- style+fix: terminal stats `◎` + WhatNow icon swapped to Compass [XS]
  - **Bug.** Brand popover's stats row still rendered the colored MiniRings SVG in terminal mode — the only ring of color in an otherwise monochrome popover. User flagged it as "hasn't migrated to the new look."
  - **Fix.** Terminal CSS hides the SVG and renders `◎` (bullseye glyph) in accent color + glow via `::before` on `.mini-rings`. Rings concept preserved (per user request "I want to keep the rings concept for stats"), look matches the rest of the terminal idiom.
  - **Identity collision.** The WhatNow FAB at the lower-right used `Target` (concentric rings), the same visual identity as Stats. User: "Come up with a new icon for what's next that's not a +." Replaced `Target` → `Compass` in `FloatingCapture.jsx` (both render slots: the idle button and the open-card anchor). Compass reads as "find direction / pick a path forward" — semantically right for "what should I do now?" without overlapping with stats or with the `+` add affordance. `WhatNowModal`'s internal "Anything" capacity button keeps `Target` — semantically distinct (open-ended, no constraint).
  - Modified: `src/v2/components/FloatingCapture.jsx`, `src/v2/terminal/sections.css`, `wiki/Version-History.md`

- fix+style: EditTaskModal CTA → "Close" + restore section-count alignment [XS]
  - **CTA rename.** With autosave back (#134) and the AutosaveIndicator showing "✓ Saved" feedback (#136), the `[ Save changes ]` button no longer commits anything new — it just closes the modal. Relabeled to `Close` so the affordance reads honestly. RoutinesModal kept as-is (still explicit-save; no autosave there).
  - **Count regression.** Collapsible sections (#138) introduced `.v2-section-label-toggle .v2-section-label-count { margin-left: 0 }` to make room for the chevron — that stranded the count flush-left next to the section text instead of pushed right. The chevron also had `margin-left: auto`, which became redundant. Fix: drop the count override, drop the chevron's auto, give it an 8px gap. Count returns to the right; chevron sits beside it.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/SectionLabel.css`, `wiki/Version-History.md`

- fix+feat: label visual selection + tightened Polish + collapsible sections [M]
  - **Three bundled changes.** All client-side polish surfacing issues the user flagged in one batch.
  - **Bug — label selection invisible (especially in terminal).** `.v2-form-label-pill` in terminal CSS used `background: transparent !important` + `color: var(--v2-text-meta) !important`, which beat the inline `style={{ background, color }}` set by the active state in JSX. The user saw no visual distinction between picked and unpicked labels, and couldn't tell which were "really" selected. Fix: each pill now exposes its color as a CSS custom property `--label-color` via inline style; new `.v2-form-label-pill-active` rules read the var in both light/dark (fill the pill) and terminal (color the bracketed text + a glow). Saves were already wired correctly — the perceived save bug was the visual bug masquerading.
  - **Bug — Polish over-suggests checklists + hallucinates labels.** `polishNotes()` system prompt rewritten: explicit "DEFAULT TO null" instruction on `suggestedChecklist`, with concrete examples that do vs don't warrant one (4+ discrete actionable steps in order). Label hint rewritten to be strict: labels MUST be copy-pasted verbatim from the user's existing list; no inventing, abbreviating, pluralizing, or paraphrasing. Empty list of labels → `suggestedLabels` MUST be `[]`. Also added: "Do NOT mention labels, tags, or categories inside the notes text" so the polished body doesn't have a stray `Labels:` line referencing things that won't apply.
  - **Feature — collapsible task sections.** Tap any section header (Doing / Stale / Up next / Waiting / Snoozed) to collapse it; chevron flips `▾` / `▸`. State persists via a new `collapsed_sections` setting (map of section name → bool), so the preference survives reloads and syncs across devices via the standard `/api/data` round-trip. Use case: keep Snoozed collapsed when there's nothing time-sensitive in it; expand to peek when needed.
  - **`SectionLabel` API.** Optional `onToggle` callback flips the component into a `<button>` (vs `<div>`), adds `aria-expanded`, and renders the chevron. Existing callers without `onToggle` (search results) render as before.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/AddTaskModal.css`, `src/v2/terminal/init.css`, `src/v2/terminal/sections.css`, `src/api.js`, `src/store.js`, `src/v2/AppV2.jsx`, `src/v2/components/SectionLabel.jsx`, `src/v2/components/SectionLabel.css`, `wiki/Version-History.md`

- feat(ui): v2 AutosaveIndicator — restored everywhere v1 had it [S]
  - **Why.** User: "I used to have a save indicator at the top of the places I would edit in v1. For each theme that should come back." Then: "I want it everywhere it was in v1." v1 had the `.autosave-pill` at the top of `EditTaskModal` (driven by local `justSaved`) and `Settings.jsx` (driven by `syncStatus`). Both restored.
  - **`AutosaveIndicator` component.** Single `saved` boolean prop. Idle state reads "Autosave"; flash state reads "✓ Saved" for 2s.
  - **Light/dark.** Pill chrome: rounded, soft `rgba(text, 0.06)` bg, meta-color text. Saved flash uses the green success color (`#52C97F` on 15% bg) matching v1's `.autosave-pill-saved` palette.
  - **Terminal.** Drops pill chrome entirely. Renders as `// autosave` / `// ✓ saved` — same comment idiom used throughout terminal mode. Saved flash uses `--v2-accent` + glow.
  - **`ModalShell` `headerSlot` prop.** New optional render-prop slot positioned at the same top-row as the close X (offset 64px to its left to avoid overlap). Mirrors v1's `.autosave-pill-floating` placement.
  - **EditTaskModal wiring.** `justSaved` flag flips true inside the autosave effect's setTimeout (right after `onSave` fires), back to false after 2s. Cleanup useEffect clears the timer on unmount.
  - **SettingsModal wiring.** Same `justSaved` flag, flipped inside the existing 300ms `flushDebounceRef` debounce after `onFlush()` runs. Every settings change → debounced save → 2s flash. Cleanup mirrored.
  - Modified: `src/v2/components/ModalShell.jsx`, `src/v2/components/ModalShell.css`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/SettingsModal.jsx`, `wiki/Version-History.md`
  - Added: `src/v2/components/AutosaveIndicator.jsx`, `src/v2/components/AutosaveIndicator.css`

- fix(ui): v2 EditTaskModal — restore field autosave (v1 parity) [S]
  - **Why.** User: "Everything else used to auto save before v2. This was a regression." Correct — v1 EditTaskModal autosaved every form change on blur/onChange. v2 shipped with an explicit `[ Save changes ]` button intentionally (per the source comment: "less surprising for the new UI, easier to reason about. PR8 polish can add per-field autosave if it feels natural in use"), but in practice the modal partially autosaved anyway: status changes and the manage actions (`> archive`, `> delete --confirm`, etc.) fired immediately, while form fields (title, notes, tags, due date, size, energy, priority, checklists, attachments, comments, weather-hidden, gcal-duration) only persisted on explicit Save. The mixed behavior trained the user to expect autosave for everything; checklist edits silently dropped when they closed the modal via X.
  - **Fix.** Single `useMemo`-built `savePayload`, watched by a debounced (500ms) autosave effect. JSON-string ref-compare so reference churn on array/object state (e.g. `selectedTags`) doesn't fire spurious saves. Empty-title guard preserved. `last_touched` removed from the payload — `useTasks.updateTask` already stamps it.
  - **Unmount flush.** A separate effect with empty deps fires on unmount: if the latest payload differs from the last-saved baseline, save synchronously before the modal goes away. Closing via X / route change within the 500ms window no longer strands edits.
  - **Save button kept.** Still wired to `handleSave` — explicit flush-and-close affordance. Updates `lastSavedJson` ref so the autosave doesn't double-fire.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `wiki/Version-History.md`

- release: v0.11.0 — terminal theme + v2 milestone to main [L]
  - **What's in this release.** First merge of `dev` → `main` since the v2 cutover. Bundles every PR from 2026-05-10 + 2026-05-11. Highlights:
    - **Terminal theme family** (PR A–H) — Light, Dark, Terminal Dark (GitHub Dark), Terminal Light (GitHub Light) palettes; ASCII flourishes, monospace stack, `> verb` modal headers, `// section` labels, bracket toggles, density signals on TaskCard.
    - **No-button-chrome philosophy** in terminal — every settings control, every notification card, every modal CTA, every "add" pill flattened to sigil+text or bracket-radio idiom. Update-available modal included.
    - **Home stats line** (`📅 Sun, May 10 ▾ · 🔥 N days · ✓ N/goal today`) where the calendar date is the WeekStrip show/hide toggle.
    - **WeekStrip** lost its internal range-toggle + `today N/goal` summary (folded into home stats line). GoalProgressBar removed entirely — today's count lives in WeekStrip's today cell.
    - **EditTaskModal "add" pills** (`+ add checklist`, `+ attach files`, `+ notion`, `+ add comment`) — dashed borders dropped, flat `+ verb noun` idiom matching the `// manage` section.
    - **Markdown import** moved from overflow menu to Settings → Data.
    - Click-to-complete `[ ]` checkboxes on task cards (terminal); urgency as title text color; 700ms `[✓]` confirmation pulse.
    - Sequential typing demo on Quokka empty state; `[ object Object ]` bug fixed.
    - Theme persistence rewrite — local theme survives server hydration.
    - DateField component — `[ due date ]` opens native picker, renders `[ YYYY-MM-DD ]` filled.
    - Smoke tests for terminal-title + terminal-button coverage in pre-push hook.
  - **Audit.** `npm audit` reports 0 vulnerabilities.
  - **Decision criterion clock starts now.** Per CLAUDE.md → "Terminal Theme Stress Test", 30 days of daily terminal use → consider Light/Dark deprecation. All four palettes stay live + equal in the picker until that date.
  - Bumped: `package.json` 0.10.0 → 0.11.0, `package-lock.json` to match
  - Modified: `wiki/V2-State.md` (status flip), `wiki/Features.md` (`>` prefix, home stats line, WeekStrip behavior), `CLAUDE.md` (terminal section header)

- style(ui): terminal — flatten update-available modal [XS]
  - **Why.** User: "The reload module still has a button." The version-mismatch modal (`v2-update-overlay` / `v2-update-modal`) still rendered with rounded-modal chrome + a filled accent reload pill in terminal mode.
  - **Modal.** Drop the border-radius + drop-shadow chrome. Add a hairline border + soft accent glow ring. Match the terminal flat-card idiom used elsewhere.
  - **Title.** "Update available" → `// update available` in monospace meta.
  - **Sub copy.** "Refreshing automatically…" → `// refreshing automatically…` matching the comment idiom.
  - **Version.** Rendered in monospace accent with glow.
  - **Reload button.** `Reload now` → `[ reload now ]` — flat bracketed accent text, no fill, no pill radius. Matches every other terminal CTA (`[ Save changes ]`, `[ Done ]`, etc).
  - Modified: `src/v2/AppV2.css`, `wiki/Version-History.md`

- feat(ui): terminal — WeekStrip toggle moves to home-stats calendar date [S]
  - **Why.** User: "The weekstrip makes no sense anyway when the dates are hidden. Remove the today N and hide the '// Month dd-dd' with the dates below that are already hidden with the toggle. Make the calendar icon and the date next to it as the hide/show button." Right call — the WeekStrip had its own internal range-toggle while the home stats line above already showed today's count, so toggling the days alone left an orphan header. And the `today 3/3` in the header duplicated `✓ 3/3 today` in the stats line one row up.
  - **Behavior.** Default in terminal mode: the home stats line shows `📅 Sun, May 10 ▾ · 🔥 1 day · ✓ 3/3 today`. The WeekStrip is entirely hidden. Tapping `📅 Sun, May 10 ▾` reveals the strip (header + day cells together); chevron flips to `▴` and the date+chevron tint accent. Tap again to hide.
  - **WeekStrip simplified.** Dropped the internal `userExpanded` state, the range-label-as-button, the `today N/goal` summary, and the `alwaysOpen` prop. The component is now a "dumb display" — when mounted, it renders fully. Visibility is owned by AppV2.
  - **Light/dark unchanged.** `show_week_strip` setting still gates the strip in light/dark mode (always-visible when opted in). The new click-to-toggle behavior is terminal-only. Setting label clarified: "Show 7-day strip (light/dark)".
  - **`week_strip_always_open` preserved** — terminal users who want the strip permanently visible can flip it in Settings → General → Home screen. When on, the date-toggle button disables (no chevron) and the strip renders permanently.
  - Modified: `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`, `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — flatten EditTaskModal "add" pills [XS]
  - **Why.** Screenshot showed `+ Add checklist`, `📎 attach files`, `🔍 notion`, `+ add comment` still rendering as dashed-border boxes in terminal mode. The dashed chrome was a holdover from an earlier pass that meant to drop borders but didn't go far enough — they read as boxes, not commands.
  - **Treatment.** All four classes (`.v2-edit-add-pill`, `.v2-edit-checklist-new`, `.v2-edit-connection-pill`) collapse to flat `+ verb noun` text. Border, radius, padding chrome all dropped. Inline SVG icons hidden — the `+ ` sigil via `::before` replaces them. Hover swaps text + sigil to accent + glow, same idiom as the `// manage` section rows. Disabled state fades to 0.4 opacity.
  - **Notion search.** Stays as `+ notion` — uniform `+` sigil reads as "add this thing to the task" across all four. The button's actual behavior (search/link/create) is intact; just visually it joins the family.
  - **Light/dark unchanged.** Base CSS dashed-border treatment kept — this is terminal-only.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- feat(ui): WeekStrip days collapse by default, click range to toggle [S]
  - **Why.** User: "I want to be able to click on the calendar on the main page and have it hide/show the days under the weekly summary. It should be hidden by default and can [be] enabled permanently in settings." The strip was always-open, taking 60+px of vertical space on every load even when the user just wants the task list.
  - **Behavior.** WeekStrip default state is collapsed — only the header row renders, showing `< May 4-10 · today 3/5 ▾ >`. Clicking the range label toggles the day grid below. Nav arrows still shift the visible week; they don't fold/unfold.
  - **`week_strip_always_open` setting.** New Settings → General → Home screen toggle ("Keep day cells expanded"). When on, days stay rendered permanently and the range label loses its toggle affordance (chevron hidden, no hover bg). When off (default), the toggle works.
  - **Collapsed-header summary.** When collapsed, the header gains `· today N/goal` right after the range so users still see today's progress without expanding. Hidden when there's no today cell in the visible week (i.e., user navigated to a past/future week).
  - **Visual.** Light/dark: range becomes a hover-tinted pill, chevron rotates 180° when expanded. Terminal: range stays flat, chevron swaps to `▾` (collapsed) / `▴` (expanded) ASCII via `::after` on the toggle, accent color when expanded. Today summary renders accent color in both themes.
  - **A11y.** Toggle button has `aria-expanded` + `aria-controls` pointing at the day list. Days list gets `id="v2-week-strip-days"`. Reading the collapsed header conveys today's progress aloud.
  - Modified: `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`, `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/store.js`, `wiki/Version-History.md`

- refactor(ui): drop GoalProgressBar, fold count into WeekStrip's today cell [S]
  - **Why.** User: "Let's move the completion bar up to the top. I thought we were using the shaded boxes for that." Right — WeekStrip's intensity fill on each day cell already encodes `count vs goal` (0/some/met/2×met). GoalProgressBar duplicated the signal underneath, so the home screen had two indicators for the same number. Recommended dropping the bar and folding the exact `N/goal` count into today's cell; user approved.
  - **WeekStrip.** Today's cell gets a new `.v2-week-strip-count` line between the date number and the intensity bar, rendered only when `isToday`. Light/dark: 11px medium meta-color, accent on today. Terminal: 11px monospace accent. The intensity fill still does the at-a-glance week scan; the count gives the exact number for today without breaking the 7-cell grid rhythm.
  - **GoalProgressBar gone.** `src/v2/components/GoalProgressBar.{jsx,css}` deleted. Render removed from `AppV2.jsx`, import line dropped. `show_goal_progress` setting removed from `src/store.js` defaults + Settings → General → Home screen toggle. No migration needed — settings are a JSON blob, stale keys are silently ignored.
  - **Trade-off accepted.** Linear-percent visual is gone. Reading exact progress now means reading the fraction inside today's box. Fine — boxes are already the right shape, and one indicator beats two.
  - Modified: `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`, `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/store.js`, `wiki/Version-History.md`
  - Deleted: `src/v2/components/GoalProgressBar.jsx`, `src/v2/components/GoalProgressBar.css`

- refactor(ui): move markdown import from overflow menu to Settings → Data [XS]
  - **Why.** User: "Let's move import markdown to the data tab. I'm not positive it's going to live long. But I have it built for now. It's a rarely used function." Crowding the top-level overflow menu with a feature that may be deprecated isn't worth the slot.
  - **Settings → Data.** New "Markdown import" block sits between Activity and Danger zone. Bracketed `[ import from markdown ]` button (terminal idiom inherited from `.v2-settings-btn` class) opens the existing `MarkdownImportModal` after closing Settings.
  - **Wiring.** `SettingsModal` gains an `onShowMarkdownImport` prop, mirroring the existing `onShowActivityLog` pattern. `AppV2` passes `() => setShowMarkdownImport(true)`.
  - **Overflow menu.** "Import from markdown" row removed from the `…` menu. `Upload` lucide icon dropped from `AppV2.jsx` import list (no longer used there).
  - **No behavior change** beyond placement — the modal itself is untouched.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/AppV2.jsx`, `wiki/Version-History.md`, `wiki/Architecture.md`

---

## 2026-05-10

- fix(ui): terminal — markdown import button row alignment [XS]
  - **Why.** User: "Alignment on the buttons here is fucked." `[ preview tasks ]` and `[ upload .md ]` sat in a row but `[ preview tasks ]` was centered awkwardly in its half.
  - **Root cause.** Base CSS on `.v2-md-import-primary` sets `flex: 1` so the button expands to fill remaining space. With chrome stripped in terminal mode, the bracketed text floats centered in an invisible-but-expanded button slot. Visual mismatch with `[ upload .md ]` (which uses `.v2-settings-btn`, natural width).
  - **Fix.** Override `flex: 0 0 auto` + `margin-right: 18px` in terminal mode so the preview button takes natural width and the two buttons sit side-by-side from the row's start, with a comfortable gap between.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — DoneList reopen + load-more buttons [XS]
  - **Why.** User: "Done list reopen are buttons. Import markdown preview is a button." The markdown preview button was already fixed in #123 — the user is seeing a cached PWA build. Done-list reopen + load-more genuinely weren't touched.
  - **`.v2-done-reopen`** (per-row "Reopen" button on each completed task): hairline-bordered pill → bracketed accent text `[ reopen ]`. Hover deepens the glow.
  - **`.v2-done-load-more`** (bottom "Load more" pagination): same treatment, meta-text inactive, accent on hover.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — notif cards + logs view + analytics brackets + markdown CTA [XS]
  - **Why.** Four screenshots in quick succession (per the new batching rule):
    1. Notif cards rendered each frequency type as a bordered card with surface-bg fill — "these don't fit with the aesthetic"
    2. Logs filter chips had pill chrome + the log-stream wrapper had card border + radius — "Logs of all things should look like terminal"
    3. Stats range buttons wrapped mid-button — closing `]` orphaned on next line, "alignment on the braces looks like shit in stats"
    4. Markdown import "Preview tasks" CTA still rendered as filled-blue pill — "Import markdown preview is a button"
  - **Notification cards** (`.v2-notif-card`): bordered surface-bg card → flat row with hairline-bottom separator. Channel toggle wrapper (`.v2-notif-card-channel`) drops its tinted bg + radius. Disabled state fades opacity. `.v2-notif-cards` gap zeroed since hairlines now separate.
  - **Logs filter chips** (`.v2-settings-filter`): pill chrome → bracket-radio idiom matching `.v2-form-seg` and `.v2-settings-segment-btn`. Inactive `[ ] all`, active `[•] all` with accent + glow.
  - **Logs stream** (`.v2-settings-logs-stream`): bordered card with rounded corners + faint bg → bare div. Log rows drop their 4px radius, gain a dashed bottom hairline so consecutive entries read as a log feed. Empty state gets `// ` prefix.
  - **Stats range/metric buttons** (`.v2-analytics-range-btn`, `.v2-analytics-metric-btn`): `white-space: nowrap` + `flex-shrink: 0` so `[ 7d ]` etc. stay on one line. Parent `.v2-analytics-range` / `.v2-analytics-metric` get `flex-wrap: wrap` + `gap: 4px 8px` so the row wraps at button boundaries instead of inside buttons.
  - **Markdown import primary CTA** (`.v2-md-import-primary`): the audit miss — used by "Preview tasks" and "Import N tasks" buttons. Filled-blue pill → bracketed accent text matching `.v2-form-submit` convention.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- fix(ui): ship-prep batch — Quokka send button + autofocus + docs [XS]
  - **Why.** User feedback: "Quokka seems fixed. The paper airplane should probably be adjusted to p10k or true word only send button. There is also a bug in PWA where it drops me immediately into the text box and the keyboard covers up half the stuff." Plus the heads-up that `DateField` + `TypingSuggestions` weren't yet in `wiki/Architecture.md`.
  - **Send button** (`.v2-adviser-send`) — was rendering an airplane SVG flanked by `[` `]` brackets in terminal mode (the JSX child is `<Send>` lucide; my bracket-wrap `::before`/`::after` rules wrapped the SVG). Hidden the SVG in terminal mode via `display: none` and replaced with `[ send ]` text via `::before` content. Matches the bracketed-CTA convention used by `.v2-form-submit`, `.v2-confirm-btn-primary`, etc.
  - **Autofocus bug** — `useEffect(() => { if (open && !showHistory) inputRef.current?.focus() }, ...)` was firing the keyboard immediately on modal open, covering half the empty-state typing demo + suggestion buttons on iOS PWA. Removed. Focus moves into the input naturally when the user taps it or picks a suggestion (the existing `inputRef.current?.focus()` inside the `onSelect` callback still works).
  - **wiki/Architecture.md** — `DateField` and `TypingSuggestions` added to the v2 component family list with notes on what they do + their terminal-mode treatment. Also bumped the convention-smoke-test mention to reference both `check:terminal-titles` AND `check:terminal-buttons`.
  - Modified: `src/v2/components/AdviserModal.jsx`, `src/v2/terminal/init.css`, `wiki/Architecture.md`, `wiki/Version-History.md`

- fix(sync): terminal theme persistence — REAL fix (AppV2's hydrate also clobbered local) [XS]
  - **Bug.** PR #109 added a theme-preservation guard inside `useServerSync.js`, but the persistence bug came back. User: "The terminal setting isn't sticking still."
  - **Why #109 was incomplete.** `AppV2.jsx`'s `hydrateFromServer` callback ALSO wrote `saveSettings(data.settings)` directly — and it ran BEFORE the protected save in useServerSync. So the order on every hydrate was: (1) onHydrate clobbers local theme with server's stale value; (2) useServerSync reads localStorage to get "the local theme" — which is now the stale server value just written; (3) "preserves" it — i.e. writes it back as a no-op. Net effect: local pick gets overwritten.
  - **Fix.** Drop the `saveSettings(data.settings)` call from `hydrateFromServer`. useServerSync owns the localStorage write for settings (with the theme-preservation guard from #109). The hydrate callback now only mirrors downstream React state — `setSortBy(data.settings.sort_by)` — and lets useServerSync handle persistence.
  - Modified: `src/v2/AppV2.jsx`, `wiki/Version-History.md`

- fix(ui): quokka — typing demo types each phrase once, sequentially, no loop [XS]
  - **Bug.** Typing-prompt was effectively looping the same phrase. User: "You should b typing each line sequentially once. Not the same one over and over."
  - **Rewrite.** Each phrase types once, in order. As it finishes, it moves into a `completed[]` array (rendered as a static line) and the next phrase starts typing below it. After the last phrase, `phase` flips to `'done'` — no more animation, all phrases visible as a stack. The cursor sits on the active line during typing; completed lines fade to meta-text so the eye lands on the typing one.
  - **State model** simplified: `{ completed: string[], currentIdx, currentText, phase: 'typing' | 'holding' | 'done' }`. No erase phase, no loop.
  - **`prefers-reduced-motion`** sets `completed = phrases` immediately, no animation.
  - **Terminal mode** adds a `> ` prefix per line via `.v2-typing-prompt-line::before`; completed-line prefix fades to meta.
  - **NOTE:** PR #118 was a false-positive merge — pushed against a stale local branch ref so the diff was empty against base. This is the real ship.
  - Modified: `src/v2/components/TypingPrompt.jsx`, `src/v2/components/TypingPrompt.css`, `src/v2/components/AdviserModal.css`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- fix(ui): quokka — horizontal overflow + missed toolbar buttons [XS]
  - **Bug.** Quokka modal scrolling expanded the page horizontally — text in the empty state body, the typing-prompt line, and the suggestion buttons all extended past the visible viewport. Plus the "+ New chat" and "Chats" toolbar buttons still rendered as filled-blue / outlined-blue pills in terminal mode (audit miss — they use `.v2-adviser-tool-btn` not `.v2-adviser-btn`).
  - **Root cause #1 — `white-space: pre` on `.v2-typing-prompt`.** The longest suggestion phrase rendered as a non-wrapping single line, forced its parent wide, and cascaded the overflow up through the empty state into the modal body. **Fix:** changed to `white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word`. Preserves the visible spaces in the typed phrase but wraps when needed.
  - **Root cause #2 — audit miss on toolbar buttons.** `.v2-adviser-tool-btn` only had a font-size override in terminal mode. The base CSS still rendered borders/fills. Added explicit chrome strip: bare lowercase text, `-primary` variant gets accent color + glow.
  - **Suggestion buttons** also flattened in terminal mode: dashed bottom hairline, `> ` prefix on each row, full-width with `word-break: break-word` so long prompts wrap.
  - **Empty state** got safety constraints: `max-width: 100%`, `padding: 24px 4px 16px` (less horizontal), and `overflow: hidden; text-overflow: ellipsis` on the demo line as a fallback.
  - Modified: `src/v2/components/TypingPrompt.css`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- feat(ui): quokka — typing-prompt demo above example suggestions [XS]
  - **Why.** User: "Can you do typing text? I'd love to see that added to the examples in quokka." Adds a CLI-demo feel to Quokka's empty state — Quokka literally types out what you could ask, cycling through `PROMPT_SUGGESTIONS`.
  - **New `TypingPrompt` component.** Character-by-character typing with a blinking cursor (`_`). Cycles through provided phrases: type → hold (~1.6s) → erase → next phrase. Configurable `typeMs` / `eraseMs` / `holdMs` / `pauseBetweenMs` props. `prefers-reduced-motion` short-circuits to a static render of the longest phrase, no animation.
  - **Wiring.** Rendered inside AdviserModal's empty state, between the intro body text and the static suggestion buttons below. Standard themes give it a faint background tint + rounded corners (callout look). Terminal mode swaps to a left-hairline + `> ` prompt prefix in accent green-blue with glow, so it reads as a live CLI demo.
  - **Static buttons still ship.** The typing line is a demo; the four clickable suggestion buttons under it still give users a one-tap shortcut to populate the input.
  - Modified: `src/v2/components/AdviserModal.jsx`, `src/v2/components/AdviserModal.css`, `wiki/Version-History.md`
  - Added: `src/v2/components/TypingPrompt.jsx`, `src/v2/components/TypingPrompt.css`

- style(ui): terminal — audit-pass cleanup (settings tabs, Kanban sigils, WeatherBadge, hover glow) [S]
  - **Why.** User: "go through and look for any inconsistencies in the terminal layouts. Check everything so as to minimize what I need to tell you to go fix." Five issues found and fixed; two genuine design forks asked and confirmed as "keep both" (action vocab: sigil+text on cards vs bracketed on modal CTAs; picker idiom: underline toolbar pills vs bracket settings segments).
  - **Settings tabs** (`.v2-settings-tab` — General/AI/Labels/Integrations/etc.) had no terminal override beyond font-size; still rendered as bordered pills. Now flat text-tabs with bottom-border accent underline-on-active, matching the toolbar pill idiom (both are "navigate between sub-views" tabs).
  - **Kanban column sigils** were uniform `✦` while mobile sections used per-section sigils. Threaded a `sigil` prop through `KanbanColumn` JSX + new `data-sigil` attribute on `.v2-kanban-col-title`. Terminal CSS reads it via `attr()` so desktop matches mobile:
    - `→ doing`, `+ up next`, `… waiting`, `z snoozed`, `≈ backlog`, `§ projects`
  - **WeatherBadge** (`🌧 64°` on task meta) had no terminal treatment — picked up default font + color. Added explicit `var(--v2-font-body)` monospace + meta-text color so it blends into the rest of the card meta line.
  - **Hover glow normalization** — most accent-colored interactive elements used hardcoded rgba glows of varying intensity (6px 0.45, 8px 0.55, 12px 0.65, 14px 0.7). Standardized on `var(--v2-glow)` everywhere the color is accent. Errand-green (`✓ done` action, `[✓]` tap-active), overdue-red (`[ delete ]`), and high-pri-amber (`↷ skip`) keep their non-accent hardcoded glows intentionally — they signal a color identity distinct from "primary interactive."
  - **Two design forks confirmed as "keep both" (no action):**
    - Action vocab: card actions stay sigil+text (`☾ snooze`, `✎ edit`, `✓ done`); modal CTAs stay bracketed (`[ Save ]`, `[ apply ]`, `[ send ]`). Reads as "row-level vs commit-level."
    - Picker idiom: toolbar filter pills stay underline-tab style; settings family/mode segments stay bracket-radio style. Reads as "navigate between views vs pick one value."
  - Modified: `src/v2/components/KanbanBoard.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — `$` prompt prefix → `>` everywhere [XS]
  - **Why.** User: "Replace the terminal $ with >". `$` reads as shell-prompt; `>` reads as more universal CLI-prompt (matches our `→` section sigils + the chevron-y feel of the rest of the language).
  - **Bulk replace across all terminal-mode prompt strings:**
    - `terminalTitle` props on 15 modal call sites: `$ task --new` → `> task --new`, `$ snooze` → `> snooze`, `$ settings` → `> settings`, `$ stats` → `> stats`, etc.
    - `data-terminal-cmd` attributes on the More menu + EditTaskModal manage cluster: `$ archive` → `> archive`, `$ delete --confirm` → `> delete --confirm`, etc.
    - Header popover: `open $ stats` → `open > stats`
    - Wordmark CSS: `content: "$ "` → `content: "> "` (so the `$ boomerang_` brand wordmark becomes `> boomerang_`)
    - CLAUDE.md convention doc updated to reference `> verb` as the canonical form
  - **No JSX shape change**, just literal text. Light + dark themes don't see any of these — they remain the modal's regular `title` prop value.
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/SnoozeModal.jsx`, `src/v2/components/ReframeModal.jsx`, `src/v2/components/WhatNowModal.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/PackagesModal.jsx`, `src/v2/components/AnalyticsModal.jsx`, `src/v2/components/ProjectsView.jsx`, `src/v2/components/DoneList.jsx`, `src/v2/components/ActivityLog.jsx`, `src/v2/components/AdviserModal.jsx`, `src/v2/components/MarkdownImportModal.jsx`, `src/v2/components/Header.jsx`, `src/v2/terminal/wordmark.css`, `CLAUDE.md`, `wiki/Version-History.md`

- style(ui): terminal — settings segments → bare brackets + double completion-fade duration [XS]
  - **Why.** Settings → General Theme picker (Standard/Terminal + Light/Dark rows) still rendered as bordered button boxes despite the bare-bracket idiom used everywhere else. And user feedback on the completion fade: "Could stand to have the card and check stay a little longer. What if you double that."
  - **Settings segments.** `.v2-settings-segment-btn` overrides in flatten.css rewritten to match the `.v2-form-seg` style:
    - Inactive: `[ ] standard` (faint bracket + meta text)
    - Active: `[•] standard` (accent bracket + accent text + glow)
    - No background, no border, lowercase, monospace
    - 16px gap between options (horizontal flex-wrap)
    Reads identical to status/energy/size/etc. pickers now.
  - **Completion fade 350ms → 700ms.** TaskCard's `completeTimer` setTimeout bumped to 700ms; CSS keyframe `v2-card-completing-out` matched. The `[✓]` checkmark now holds at full opacity for the first 60% of the window (~420ms) before the slide+fade kicks in. Total time on screen for user confirmation: roughly twice as long. Reduced-motion path unchanged.
  - Modified: `src/v2/components/TaskCard.jsx`, `src/v2/terminal/flatten.css`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- fix(ui): terminal — checkbox `[✓]` persists with row fade-out on complete [XS]
  - **Bug.** When the user tapped `[ ]` to complete a task, the `[✓]` only rendered during `:active` (finger held down). The moment they lifted their finger, React processed `onComplete`, the parent filtered the task out of the active list, the card unmounted — and the user never saw a confirmation. The check felt non-existent.
  - **Fix.** Add a local `completing` state to TaskCard. On checkbox tap: `setCompleting(true)` immediately, then `setTimeout(onComplete, 350)`. While completing:
    - The card root gets `v2-card-completing` class → CSS animates a 350ms opacity-out + slight rightward slide
    - The checkbox `::before` flips to `[✓]` (errand-green + glow) via a class-based rule that wins over the default `[ ]`
    - `pointer-events: none` while fading so accidental double-taps can't re-fire
    - 350ms timer hits → `onComplete(task.id)` fires → task removed from active list → card unmounts cleanly
  - **Cleanup.** `useEffect` clears the timer if the card unmounts for some other reason (parent removes the task, navigation, etc.) so the callback can't fire on a stale instance.
  - **Light/dark unchanged.** Their Done button + swipe-to-Done paths still remove the row immediately. The fade is terminal-only — it's specifically the answer to "the checkbox tap feels invisible because the checkmark doesn't stay long enough."
  - **Reduced motion.** `prefers-reduced-motion` reduces the animation to a flat `opacity: 0.5` while fading.
  - Modified: `src/v2/components/TaskCard.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — urgency moves from checkbox glyph to title color [XS]
  - **Why.** User: "Why are you dropping the urgency? Shit is that what those were? I thought they were done check boxes." The leading `[!]` (overdue) and `[*]` (high-pri) glyphs on the checkbox were misreading as alternate checkbox states rather than urgency markers — especially now that the checkbox is a real tappable button. Suggested fix: title color for urgency.
  - **What changed.** The `.v2-card-overdue .v2-card-checkbox::before` and `.v2-card-high-pri .v2-card-checkbox::before` overrides removed. Checkbox now reads `[ ]` always (or `[✓]` on tap-active). Urgency signal moves to the title text:
    - Overdue → `.v2-card-title { color: var(--v2-alert-overdue) }` (red)
    - High-pri → `.v2-card-title { color: var(--v2-alert-high-pri) }` (amber)
    - Both (overdue + high-pri) → red wins (overdue is the more urgent of the two)
  - **Clean separation now:** `[ ]` is state (tap to complete); title color is urgency. No more "is this a different kind of checkbox?" confusion.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- feat(ui): terminal — clickable `[ ]` checkbox + drop duplicate done affordances [S]
  - **Why.** User: "I should be able to click on the empty check box squares on the tasks page and have them be marked as done. I know that is duplicative of the done slider and done button. Wondering if it actually mitigates the need for those. Thoughts? Edit and done on click AND slide already feel a little duplicative." Locked-in answer after a 2-question round: tap `[ ]` toggles done; drop `✓ done` from expanded actions; drop swipe-left gestures entirely. Terminal mode only.
  - **JSX.** Added a `<span role="button" className="v2-card-checkbox">` before the title text in TaskCard. Click handler stops propagation (so taps don't also expand the card) and calls `onComplete(task.id)`. Keyboard accessible via Enter/Space. Used `<span role="button">` rather than `<button>` because TaskCard's outer `.v2-card-main` is already a `<button>` and HTML doesn't allow nested buttons. Light/dark mode hides the element via `display: none`.
  - **CSS.** The existing `[ ]` / `[!]` / `[*]` glyphs that previously rendered on `.v2-card-title::before` moved to `.v2-card-checkbox::before` (so the user is tapping a real DOM element, not a pseudo-element). Hover lifts the bracket to accent + glow. Active state flips to `[✓]` errand-green so the tap lands visibly before the task disappears from the list. `.v2-card-action-primary` (the `✓ done` button in expand) is `display: none` in terminal — duplicate of the checkbox. `.v2-card-swipe-actions` panel hidden too.
  - **Gesture.** `handleTouchStart` and `handleTouchMove` short-circuit when `useTerminalMode()` is true so the swipe gesture itself never engages. Light/dark themes keep swipe.
  - **Expand actions in terminal now show:** `☾ snooze` + `✎ edit` (+ `↷ skip` for chain tasks). Done is no longer here — the checkbox at the top is the canonical way.
  - **Tap target.** Checkbox has `min-width: 32px` and `min-height: 32px` with negative `margin-left: -4px` to extend the hit zone slightly past the visual `[ ]` width without changing layout.
  - Modified: `src/v2/components/TaskCard.jsx`, `src/v2/terminal/cards.css`, `src/v2/terminal/flatten.css`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- fix(sync): preserve local theme on server hydration [XS]
  - **Bug.** Terminal mode preference didn't persist on refresh. User picks Terminal in Settings → Theme; refresh; back to the previous theme.
  - **Root cause.** `useServerSync.js` hydration path called `saveSettings(data.settings)` unconditionally on every SSE-triggered server fetch. If a refresh landed within the ~300ms debounce window between a local theme pick and the server flush — OR if the server was briefly unreachable when the flush fired — the hydration would overwrite the just-saved local theme with stale server data. The preference appeared to revert.
  - **Fix.** Theme is now device-local: hydrate preserves whatever local theme value was set before the hydrate ran. The reasoning: different devices have different ergonomics (laptop vs phone vs tablet) and the user might genuinely want terminal on one device and light on another. First-install case (no local theme yet) still adopts the server's theme — only an explicitly-set local theme blocks server overwrite.
  - Other settings (notification preferences, integration tokens, etc.) still sync through the bulk path. Theme is the only key the hydrate now ignores from the server.
  - Modified: `src/hooks/useServerSync.js`, `wiki/Version-History.md`

- fix(ui): edit modal — done status didn't show active state [XS]
  - **Bug.** In EditTaskModal's status row, the `✓ Done` button never showed as "selected" even when the task's current status was `done`. The user reported it as "done checkmark doesn't show up when checked; selected vs not may be inverted."
  - **Root cause.** `STATUS_OPTIONS` only contains `['not_started', 'doing', 'waiting']`, and the JSX threads the active class via `currentStatus === s ? ' v2-form-seg-active' : ''` only on the map. The `✓ Done` button is rendered outside the map as a separate "mark complete" affordance and hardcodes `className="v2-form-seg v2-edit-status-done"` with no active-state branch. Result: when `status === 'done'`, none of the four options showed the `[•]` radio dot — nothing read as currently selected.
  - **Fix.** Add `${currentStatus === 'done' ? ' v2-form-seg-active' : ''}` to the done button's className. Terminal CSS gains an override so the `v2-edit-status-done.v2-form-seg-active` state stays in the errand-green family (`[•]` dot + stronger green glow) rather than flipping to the generic accent-blue from `.v2-form-seg-active`.
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- chore(ui): terminal — root-cause + sweep 32 missed button classes + add coverage guard [S]
  - **Why.** User asked why energy/auto/research/priority got missed in earlier "comprehensive button strip" passes and to proactively scan for others. Root cause analysis below; sweep covers everything found; new smoke test prevents it happening again.
  - **Root cause.** When earlier passes "generalized" the button strip, they only targeted **shared** classes (`.v2-form-seg`, `.v2-card-action`, `.v2-form-input`). v2 has several **custom-class** button shapes that exist as their own class because they needed unique sizing/icon rules: `.v2-form-energy-pill` (flex sharing), `.v2-form-ai-pill` (sparkle icon variant), `.v2-form-pri-toggle` (cycling state), `.v2-analytics-range-btn`, `.v2-adviser-history-btn`, `.v2-package-action`, etc. The generic rules never matched them. Plus I never opened AnalyticsModal, full ReframeModal, the Labels CRUD modal, or notification settings rows during this session — so their entire button surfaces never got swept.
  - **Sweep — 32 classes added in this PR:**
    - **Adviser**: `.v2-adviser-btn`, `.v2-adviser-history-btn`, `.v2-adviser-chat-icon-btn`, `.v2-adviser-chat-row`
    - **Analytics**: `.v2-analytics-range-btn` (+ active), `.v2-analytics-metric-btn` (+ active), `.v2-analytics-bd-row`, `.v2-analytics-dow-row`
    - **EditTaskModal subviews**: `.v2-edit-add-pill`, `.v2-edit-connection-pill`, `.v2-edit-checklist-toggle`, `.v2-edit-routine-toggle`, `.v2-edit-routine-row`, `.v2-edit-comment-input-row`
    - **Settings**: `.v2-integrations-toggle-row`, `.v2-notif-test-row`, `.v2-settings-log-row`, `.v2-labels-row`, `.v2-labels-icon-btn`, `.v2-notif-history-toggle`, `.v2-notif-history-chev`
    - **List rows**: `.v2-done-row`, `.v2-shortcut-row`, `.v2-snooze-custom-row`, `.v2-activity-row`
    - **Modal-specific**: `.v2-reconcile-suggestion-row`, `.v2-reframe-result-row`, `.v2-package-action`, `.v2-routine-new-btn`, `.v2-routine-action`, `.v2-activity-action`, `.v2-header-popover-row`
  - **New guard: `scripts/check-terminal-buttons.js`.** Greps every CSS file in `src/v2/components/` for class definitions matching `.v2-*-{btn|pill|toggle|seg|chip|tab|option|action|row|cta|trigger}` and asserts each one is referenced from at least one rule inside `src/v2/terminal/*.css` OR from a terminal-gated rule inside the component's own CSS (so per-component overrides like `DateField.css`'s terminal block count). Layout-only containers can be exempt-listed at the top of the script — currently 24 exemptions for things like `.v2-form-row`, `.v2-settings-row`, etc. that are pure flex containers with no chrome of their own. Run via `npm run check:terminal-buttons`. Wired into `.githooks/pre-push` between the existing terminal-titles check and the smoke test. Catches drift on every push.
  - **Baseline.** 58 button-shaped classes covered, 0 missed.
  - **Bundle.** CSS 248.6KB gzip 35.5KB (+~4.5KB sweep). JS unchanged.
  - Modified: `src/v2/terminal/init.css`, `package.json`, `.githooks/pre-push`, `wiki/Version-History.md`
  - Added: `scripts/check-terminal-buttons.js`

- feat(ui): terminal — DateField + form polish (energy/auto/research/priority as labels) [S]
  - **Why.** User feedback: "Center up the calendar row at the top. Energy type should look like labels. Same with auto, research and priority. I think date should just be the word [due date] and have it open a calendar picker. Once picked, Date format should be YYYY-MM-DD. Give me an option to clear the due date."
  - **`DateField` (new component).** Replaces the bare `<input type="date">` in AddTaskModal + EditTaskModal. Renders as a `[ due date ]` placeholder when empty, `[ YYYY-MM-DD ]` when filled, with an inline `× clear` button (only visible when filled). Tap the trigger → calls `.showPicker()` on a hidden off-screen `<input type="date">`; falls back to focus+click for older browsers. Modern support is iOS 16.4+ / Chrome 99+ / Firefox 101+, which covers what Boomerang targets. Same UX in light/dark (looks like a regular input rect with the placeholder/value text inside) and terminal (collapses to bare bracketed text).
  - **Energy type, Auto, Research, Priority → bracketed labels.** Earlier passes only stripped some of these. This pass generalizes:
    - `.v2-form-energy-pill` → `[ desk ]` / `[ people ]` / `[ errand ]` / etc. — active state keeps the inline energy-type color (so the segment legend on the form matches the chip color on the card row)
    - `.v2-form-ai-pill` (Auto, Polish, Research toggle) → `[ auto ]` / `[ polish ]` / `[ research ]` accent text + glow
    - `.v2-edit-research-go` (the inline "Go" inside the research input row) → `[ go ]` accent
    - `.v2-form-pri-toggle` → `[ normal ]` / `[ ↑ high ]` / `[ ↓ low ]` bracket text; hover lifts to accent + glow
  - **Center home-stats line.** `.v2-terminal-home-stats` was left-aligned by the default `flex` flow. Added `justify-content: center` + `text-align: center` so the date · streak · today line sits centered above the calendar.
  - **Bundle.** CSS 244.0KB gzip 35.0KB (+~3KB for energy/ai-pill/priority/date-field overrides). JS 810.5KB gzip 224.4KB (+~1KB for the new DateField component).
  - Modified: `src/v2/components/AddTaskModal.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`
  - Added: `src/v2/components/DateField.jsx`, `src/v2/components/DateField.css`

- fix(adviser): render assistant markdown as React nodes, not HTML [XS]
  - **Bug.** Quokka assistant messages were rendering as the literal string `[object Object]` whenever the message content was non-empty. Reproduced consistently on multi-step plan responses (the screenshot the user reported was a "Combine the two UPS drop off tasks" plan where the assistant text bubble between the tool calls and the planned changes showed `[object Object]`).
  - **Root cause.** `AdviserModal.jsx` used `dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}`, but `renderMarkdown()` (in `src/utils/renderMarkdown.js`) returns **React nodes**, not an HTML string. Assigning a React element to `innerHTML` calls the element's `toString()` which produces `[object Object]`.
  - **Fix.** Render `renderMarkdown(...)` as JSX children of the bubble div. Also defensive-coerce `message.content` to a string if a legacy/persisted chat happened to store it as anything else (the JS-on-server-and-client paths both currently produce strings, but the coercion is cheap insurance for stored-chat migrations or future server changes).
  - Modified: `src/v2/components/AdviserModal.jsx`, `wiki/Version-History.md`

- style(ui): terminal — comprehensive button strip across all modals [S]
  - **Why.** "We should get rid of all of the buttons when in terminal but also be aware that most of how we interact with this is mobile, so real estate is limited." Previous passes hit task-card actions + segmented controls + manage cluster + more menu, but several modal surfaces still shipped with filled / bordered button chrome.
  - **What got stripped this pass:**
    - **SnoozeModal** option rows (`.v2-snooze-row`): card chrome → flat hairline-separated rows; label rendered as `[ later today ]` accent-bracketed text. Custom-time toggle button → text-only.
    - **WhatNowModal** option list + capacity buttons + skip link: same flat-row treatment with `[ 5 min ]` bracketed labels.
    - **ConfirmDialog** buttons: cancel becomes plain meta text, danger becomes `[ delete ]` red text + glow on hover, primary becomes `[ apply ]` accent.
    - **Settings buttons** (`.v2-settings-btn` family): Connect / Test / Save / Disconnect / etc. → `[ verb ]` accent text. Danger variants get red bracket text. Strong-danger gets bold red.
    - **AddTaskModal**: priority toggle becomes a bottom-bordered transparent text pill that lights up on hover; label pills become `[ +tag ]` faint-bracketed text rows.
    - **AdviserModal** send button: `[ send ]` accent text + glow.
    - **PackagesModal** toolbar buttons: `[ refresh all ]`, `[ + add tracking ]` accent text.
    - **EditTaskModal** research button + inline edit-research input row: `[ research ]` accent text.
  - **Mobile real-estate awareness.** Where buttons were stacked vertically (snooze options, whatnow options), keep that layout because each option needs a full tap target — but with `min-height: 44px` for touch and zero card chrome, the row is denser. Where buttons were inline (settings, package toolbar, manage cluster), keep them inline; flat text wraps cleanly without extra padding.
  - **Tap-target preserved.** All flat-text buttons keep a `min-height: 32–44px` so the actual click target stays comfortable on phones — the visual flatness doesn't shrink the hit zone.
  - **Convention:** primary actions get accent + glow + brackets `[ verb ]`; secondary actions get meta-text without brackets; destructive actions get the appropriate red/amber + brackets.
  - **Bundle.** CSS 240.3KB gzip 34.5KB (+~7.8KB). JS unchanged.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — checkbox idiom inline, not stacked [XS]
  - **Why.** Last PR replaced the status segmented control's filled buttons with `[•] doing` checkbox notation but stacked the options vertically. User: "Buttons don't make sense in terminal but we need to not just stack everything vertically when we eliminate them." The fix: keep horizontal layout, just swap chrome for inline `[ ]` / `[•]` per option.
  - **Generalized to ALL segmented controls.** Previous rule only targeted `.v2-edit-status-row .v2-form-seg`; new rule targets every `.v2-form-seg` instance. So status, priority (Normal/High/Low), size (XS/S/M/L/XL/Auto), energy type (desk/people/errand/creative/physical), energy drain (low/medium/high) all get the same inline checkbox treatment in terminal mode.
  - **Layout: `flex-wrap: wrap` keeps horizontal flow.** Options sit on one line at desktop widths, wrap to additional lines on narrow phones. `gap: 4px 14px` (row × column) gives breathing room without ballooning vertically.
  - **Per-option text:**
    - Inactive: `[ ] xs` in faint bracket + meta text
    - Active: `[•] xs` in accent + cyan glow
    - Hover: text color lifts from meta to text on inactive options
  - The `✓ Done` row in EditTaskModal status keeps errand-green so it still reads as the completion action.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal — toolbar buffer + checkbox-style status idiom [XS]
  - **Why.** Two specific feedback items: (1) the filter pill scroll-strip at the top of the home was sitting flush against the viewport edge — needed left/right padding to breathe; (2) the EditTaskModal status row (`not started / doing / waiting / done`) still rendered as filled segmented buttons even in terminal mode, which "made zero sense" against the rest of the bare-text aesthetic.
  - **Toolbar padding.** `padding: 8px 0` from the earlier flatten was too aggressive — restored to `padding: 8px 16px`. The first tab no longer sits flush; the scroll-strip has room to breathe.
  - **Status row → `[ ]` / `[•]` checkbox column.** In terminal mode, the segmented buttons strip all chrome, become a vertical column of bracketed text rows:
    - `[•] doing` (active — accent radio dot + glow)
    - `[ ] not started` (inactive — empty bracket, faint)
    - `[ ] waiting`
    - `[ ] done` (kept as its own row from the JSX; green errand-color since it's the completion state)
  - Mutually exclusive single-pick uses `[•]` (radio dot) rather than `[x]` (checkbox). Hover lifts inactive rows from meta to text color.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- feat(ui): terminal — init treatment for modals + theme picker reorg + global Analytics→stats [M]
  - **Why.** "Now put that same treatment on the edit menus, routines, and packages. Also globally replace analytics with stats in the terminal themes." Plus a follow-up: theme picker should be `Standard / Terminal` family with a `Light / Dark` mode underneath, not a flat 4-option strip.
  - **More menu rows** (`AppV2.jsx` + `init.css`). Each row label gets a `data-terminal-cmd` attribute (`$ settings`, `$ projects`, `$ routines`, `$ done`, `$ stats`, `$ log`, `$ import --markdown`). Terminal CSS hides the visible label text (`font-size: 0`) and renders the `$ verb` form via `attr(data-terminal-cmd)` on `::before`. Same pattern as PR F's manage-cluster labels. Hover lights the row's command text in accent + glow. Card chrome on the row dropped — flat with hairline separator below.
  - **Header popover "Open Analytics"** (`Header.jsx` + `init.css`). Span gets `data-terminal-cmd="open $ stats"`; same CSS treatment swaps the visible text in terminal mode.
  - **AnalyticsModal empty state** (`AnalyticsModal.jsx`). Wired the existing `terminalCommand` prop on EmptyState to show `// loading stats — pulling completion data` and `// no completions yet — finish a task to start seeing patterns`.
  - **Routines list rows** flatten in terminal mode. Card chrome dropped; rows become bare flat rows with hairline below. Routine title gets a `↻ ` accent prefix. Cadence/meta in monospace, no chip bg. Notes prefixed with `// `. Action buttons (pause/edit/delete/spawn) become bare lowercase text-buttons with hover glow.
  - **Packages rows** flatten. Card chrome dropped; same row pattern. Label gets a `📦 ` prefix. Status text loses its colored pill bg, becomes bracketed colored text (`[ in transit ]`, `[ delivered ]`) inheriting the existing per-status colors. Add-form panel flattens to dashed-border rect.
  - **EditTaskModal form labels** (`v2-form-label`) get the `// ` comment prefix in terminal mode + lowercase. Section headers like "Notes", "Checklist", "Attachments", "Connections" read as `// notes`, `// checklist`, etc.
  - **Theme picker reorg** (`SettingsModal.jsx`). Replaced the flat 4-option `[Light] [Dark] [Term Dark] [Term Light]` segmented control with two stacked rows:
    - **Family**: `[Standard] [Terminal]`
    - **Mode**: `[Light] [Dark]`
    Combined value still maps to the four `theme` settings: `light`, `dark`, `terminal-light`, `terminal-dark`. Helper closure derives `family` + `mode` from `settings.theme` and the click handler reconstructs the full value before saving + applying. Reads more naturally — pick a family, pick a canvas.
  - **Bundle.** CSS 231.3KB gzip 33.9KB (+~4KB modal overrides + theme picker rework). JS 809.5KB gzip 224.0KB (+~1KB JSX touches).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/Header.jsx`, `src/v2/components/AnalyticsModal.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- feat(ui): terminal — home stats line (date · streak · today) + auto-enable WeekStrip + restore brand mark [S]
  - **Why.** User's focus shifted to the main section: bring init's calendar + date-progress + fire-streak signals up there. PR-H opt-in surfaces (WeekStrip + GoalProgressBar) get auto-enabled in terminal mode so users don't have to toggle them. New segmented status line at the top renders date + streak + today's progress as three powerlevel10k cells.
  - **`📅 Sun, May 10  ·  🔥 14 days  ·  ✓ 3/5 today`.** New `.v2-terminal-home-stats` div rendered above the WeekStrip (only in terminal mode). Each cell has a meaningful color: date in muted text, streak in high-pri amber (the fire color, with soft amber glow), today in errand-green (success, with soft green glow). Separators in faint text. Streak comes from existing `computeStreak(tasks, settings)`; today comes from `dailyStats.tasksToday` / `daily_task_goal`. Pluralization handled (`1 day`, `N days`).
  - **WeekStrip + GoalProgressBar auto-enable in terminal mode.** Previously gated behind `settings.show_week_strip` / `settings.show_goal_progress` (default off). Now `(setting || isTerminal)` flips the gate — terminal mode always renders both. Light/dark users still opt-in via Settings → General → Home screen.
  - **`useTerminalMode` hook imported in AppV2.** Already existed for `terminalTitle` / `terminalCommand`; now drives the auto-enable + the new stats line.
  - **Brand `v` logo restored.** Earlier same day it was hidden ("modern brand on CLI aesthetic" misfit), but user's call: keep as a deliberate idiosyncrasy. One drop of brand color next to the prompt is fine.
  - **Bundle.** CSS 226.7KB gzip 33.5KB (+~0.4KB stats-line CSS). JS 808.2KB gzip 223.8KB (+~0.6KB stats-line JSX + useTerminalMode hook).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal theme — hide brand logo + add section dividers [XS]
  - **Why.** Side-by-side check vs init showed two remaining misfits: the orange `v` brand SVG sitting next to the `$ boomerang` prompt (modern brand mark on a CLI aesthetic — wrong vibe) and section spacing relying on whitespace alone, which wasn't doing enough visual work to separate groups (init uses a thin rule above each section).
  - **Brand logo hidden.** `.v2-header-brand > svg { display: none }` in terminal mode. The `$ boomerang_` text prompt is identity enough; the visual payload of the SVG conflicts with the bare-text feel everywhere else.
  - **Section hairlines.** Any `.v2-section-label` preceded by a `.v2-card` or `.v2-card-swipe-wrap` gets `border-top: 1px solid hairline` + extra top padding. The first section in a list (which has no preceding card) doesn't get the rule, so the page top stays clean.
  - Modified: `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal theme — per-section sigils + sigil+text action buttons [S]
  - **Why.** Locked-in design decisions from a four-question round: per-section sigils to differentiate sections at a glance (vs the uniform `✦`), and sigil+text action buttons to read as powerlevel10k segments (vs flat bracketed text). Energy chip stays top-right; status indicators stay leading-bracket — those were already right.
  - **`SectionLabel.jsx` accepts a `sigil` prop.** Defaults to `✦` (light/dark see uniform sparkle, no behavior change). The bullet span renders `✦` as inline text AND carries `data-sigil={sigil}` as an attribute. Light/dark CSS shows the inline text. Terminal CSS reads `attr(data-sigil)` via `::before`. Cost: one prop, JSX stays minimal.
  - **Per-section sigils on the home screen:**
    - `→ doing` (active, in-progress)
    - `~ stale` (squiggle, languishing)
    - `+ up next` (queued)
    - `… waiting` (pending external)
    - `z snoozed` (sleep)
    - Kanban columns keep uniform `✦` for now (different code path; a follow-up could differentiate those too)
  - **Card action buttons → sigil + text, no brackets.** Lucide icons hidden via CSS. Each action gets a meaningful glyph prefix:
    - `☾ snooze` (moon, rest)
    - `✎ edit` (pencil)
    - `↷ skip` (rotation arrow, advance chain)
    - `✓ done` (check; primary; replaces the `[ ]` bracket wrap from PR C)
  - The Done bracket wrap from PR C dropped — `::before` content goes from `[ ` to `✓ `, `::after` content empties out. Reads as `✓ done` in accent green/blue with the existing glow on hover.
  - **Bundle.** CSS 226.0KB gzip 33.4KB (unchanged — content swaps, not additions). JS +0.06KB (the SectionLabel sigil prop + AppV2 renderSection signature change).
  - Modified: `src/v2/components/SectionLabel.jsx`, `src/v2/AppV2.jsx`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal theme — revert palette to GitHub Dark/Light + powerlevel10k energy segments [S]
  - **Why.** User: "Stick with GitHub light and dark color palettes. So you don't need to completely strip everything. Incorporate our add ons like energy and whatever into the init design. Think like powerlevel10k or similar." — and a follow-up: "We can have a terminal look without losing all of the features."
  - **Palette reverted.** terminal-dark back to canonical GitHub Dark blue (`#58A6FF` accent, `#0D1117` canvas, `#C9D1D9` text, cyan glow). terminal-light back to GitHub Light blue (`#0969DA`). The structural language (powerlevel10k segments, bracketed text, bare rows, lowercased section labels with `✦` prefix) carries the init feel; the palette stays canonical.
  - **Energy chip restored as powerlevel10k segment.** Init.habits hides per-row energy info, but for Boomerang energy is real signal. Render it as a colored segment instead of a pill: emoji prefix per type + `⚡`-character bolts per level, in the energy-type color, on transparent. Lucide icon + Zap SVGs hidden via CSS. Emoji + bolt-text rendered via attribute selectors (`[title^="Desk"]`, `[title*="level 2"]`, etc.) since `task.energy`/`task.energyLevel` don't surface to the DOM. Per-type color applied to the whole segment so the prefix + bolts read as one cell:
    - 💻 desk → `var(--v2-energy-desk)`
    - 👥 people → `var(--v2-energy-people)`
    - 🏃 errand → `var(--v2-energy-errand)`
    - 🎨 creative → `var(--v2-energy-creative)`
    - 💪 physical → `var(--v2-energy-physical)`
    - ⚡ confrontation → `var(--v2-energy-confrontation)`
  - **Convention reaffirmed.** Don't strip features to chase the aesthetic. When something doesn't fit init's exact look, find the powerlevel10k-style monospace re-render (sigil + colored text segment) instead of `display: none`. Same pattern can apply to any other surface where the init reflex says "remove" but the feature is actually useful.
  - Modified: `src/v2/terminal/palette-dark.css`, `src/v2/terminal/palette-light.css`, `src/v2/terminal/init.css`, `wiki/Version-History.md`

- style(ui): terminal theme — full init aesthetic pass [M]
  - **Why.** User: "Done fucking around. Go full init aesthetic. Fuck the duplication and deviation comments from earlier." Stress test is over — the call is to commit. PR pushes the rest of the way to look like init.habits.
  - **Palette swap.** GitHub Dark blue accent → terminal green (`#7EE787`). Canvas darkened with a subtle green tint (`#0D1117` → `#0B1110`); text shifts cool gray → light green-gray (`#C9D1D9` → `#C2D1C5`). Hairlines pick up the green. Glow shadow shifts cyan → green. terminal-light gets matching green accent (`#0969DA` → `#1F8E3A`). Radii zeroed across the board (`pill: 6px → 0`, `card: 4px → 0`, `modal: 6px → 0`).
  - **Card action buttons → text buttons.** Lucide icons hidden via CSS. CSS attribute selectors render bracketed text buttons:
    - `aria-label="Snooze"` → `[snooze]`
    - `aria-label="Edit"` → `[edit]`
    - `aria-label*="Skip"` → `[skip]` (amber)
    - `aria-label="Mark done"` → `[ done ]` (existing PR C bracket prefix retained, lowercased + green)
  - Hover shifts color to bright accent + glow text-shadow.
  - **Energy chip hidden.** Init habits don't carry per-row energy badges; the title speaks for itself. `display: none` via `!important`.
  - **Section labels: lowercase + smaller + sparkle prefix.** `> DOING [6]` → `✦ doing [6]`. The chevron `>` from PR B's section bullet replaced with `✦` (init's section sparkle). Text lowercased, font dropped to 13px, count badge dimmed to faint.
  - **Wordmark tightened.** `$ boomerang_` text drops 2px more (15 → 13). Letters use accent green with glow. `$` prefix stays meta-color.
  - **Header icons** lose any background/border, become bare 16px lucide icons in meta-text color, hover to accent + glow.
  - **Filter pills further tightened.** Smaller font (12px), lowercase, gap dropped between tabs.
  - **Kanban (desktop) gets the same treatment.** Column headers lowercase + sparkle prefix + accent. Count badges bracketed. "Add task" inline button becomes `[+] add task` text. Inline add input becomes a bottom-bordered transparent field.
  - **Notes preview indented** to match init's `// description` indent under each habit (24px left padding, 11px font).
  - **Floating capture position** tightened (right: 16px → 12px) so the bare `+` glyph hugs the corner.
  - **Architecture.** New `src/v2/terminal/init.css` (~220 lines). Imported last in `terminal/index.css` so its rules override anything from earlier files. All under `[data-theme^="terminal"]`. `!important` used liberally where component CSS / inline styles would otherwise win — JSX stays untouched per the stress-test convention but the convention's "be conservative" guideline is loosened: user's call is explicit.
  - **Bundle.** CSS 223.9KB gzip 33.1KB (+~5KB). JS unchanged.
  - Modified: `src/v2/terminal/palette-dark.css`, `src/v2/terminal/palette-light.css`, `src/v2/terminal/index.css`, `wiki/Version-History.md`
  - Added: `src/v2/terminal/init.css`

- style(ui): terminal theme — deeper flatten (no row borders, bare buttons, text-tab filters) [S]
  - **Why.** First flatten pass (PR earlier today) kept hairline row separators on cards, kept thin borders on action buttons, kept the FAB as a small bordered square. Side-by-side with init.habits, all of that still reads as "modern app chrome" — init has zero borders on individual rows, zero borders on action buttons (just bracketed `[add]` text), zero borders on filter chips (just text-tabs with underline-on-active).
  - **TaskCard rows.** Top hairline `border-top` removed. Hover background tint removed. Expanded-state background tint removed. Cards become bare text on the page bg, separated by line-height alone. Status `[!]`/`[*]` glyph leading characters from the previous PR continue to do the work for overdue/high-pri.
  - **Card action buttons.** All borders dropped via `!important` (the existing `.v2-card-action` rules used inline borders that needed an override push). Snooze/Edit/Skip become bare icons with a hover color shift only. Done becomes `[ Done ]` text with cyan text-shadow glow on hover (no box, no border, no fill). The skip-advance keeps amber but loses its border too.
  - **Filter pills → text-tabs.** `.v2-toolbar-pill` background + border + border-radius wiped via `!important` (TaskListToolbar.jsx applies inline `style={{ background: label.color, borderColor: label.color, color: '#fff' }}` to active label-color filters; only `!important` defeats inline styles). Replaced with bottom-border indicator: inactive tabs are `--v2-text-meta`, active tab gets accent color + 2px accent underline + glow text-shadow. Reads like the `habits / stats / profile` tab strip in init.
  - **Toolbar icons.** Sort + search buttons drop borders entirely. Bare icons with accent-color glow on hover. The sort dropdown menu becomes a flat panel with accent border + cyan glow.
  - **FAB.** Borders removed entirely. The `+` and target glyphs render as bare 22px icons in accent color; hover gets a brighter cyan text-shadow glow only. No square, no border, no fill — just the glyph. Drops the previous "thin square" treatment.
  - **Section labels.** `border-bottom` hairline from yesterday's flatten dropped. The section label text (`> DOING [6]`) is the heading; the rule was overkill and made labels look like underlined chips. Replaced with `padding: 16px 0 6px` so vertical whitespace creates the section break.
  - **EditTaskModal manage cluster.** Border removed; buttons become text rows with hover color shift + glow. Delete still red-text, hover gets red glow.
  - **Modal close X.** Border removed. Bare icon with accent-glow hover.
  - **Form submit.** Border removed; just `[ Save ]` accent text with glow. Hover deepens the glow rather than adding a fill.
  - **Architecture.** Rewrote `src/v2/terminal/flatten.css` (now ~370 lines). All overrides under `[data-theme^="terminal"]`. `!important` used deliberately on selectors that need to defeat component-level inline styles (TaskListToolbar's label-color, FloatingCapture's accent fills) — JSX stays untouched per the stress-test convention; the CSS battle is the right tradeoff.
  - **Bundle.** CSS 218.8KB gzip 32.4KB (+~2KB from the rewrite). JS unchanged.
  - Modified: `src/v2/terminal/flatten.css`, `wiki/Version-History.md`

- style(ui): terminal theme — strip modern app chrome (flatten) [M]
  - **Why.** PR A–I shipped terminal text + ASCII flourishes on top of a fundamentally modern card-based UI: rounded card surfaces with borders, filled accent buttons, glowing FAB, drop-shadowed modals, pill-shaped action chrome. Reads as "modern app in monospace," not as a CLI tool. User feedback after first in-browser look: didn't go far enough. PR J flattens the chrome.
  - **TaskCard.** Surface bg dropped, border + border-radius dropped, box-shadow dropped. Cards become flat rows on `var(--v2-bg)`, separated by a single hairline `border-top` (skipped on the first card after a section label or at top of list). Hover gets a faint 2% bg tint instead of an accent border. Expanded card uses a slightly elevated 2.5% bg tint so the open row reads as the focused one without pretending to be a card. Status colors no longer ride a 2px left border — overdue + high-pri override the existing `[ ]` title prefix to `[!] ` (red) / `[*] ` (amber) so status reads as a leading character on the title line, not as a chrome decoration.
  - **Card actions.** Snooze/Edit/Skip lose their pill chrome — flat 1px hairline boxes, square corners, no hover bg fill. The Done primary button drops the accent fill + brand glow box-shadow + brightness-filter hover; becomes bordered `[ Done ]` text in accent color with a soft cyan text-shadow glow and a 0.08 opacity wash on hover. Skip-advance keeps amber but flattens the same way.
  - **Energy chip.** Pill bg removed; becomes inline icon + bolts only.
  - **ModalShell.** Sheet bg shifts to `var(--v2-bg)` (matches page) with a 1px hairline border instead of the surface elevation. Border-radius zeroed at all breakpoints, box-shadow zeroed (desktop drawer no longer floats with a shadow). Overlay scrim deepened from 0.45 to 0.70 so the modal reads as a takeover, not a card. Close X button squares off too.
  - **FAB.** 48px circle → 36px square. Accent fill → transparent with thin accent border. Box-shadow + hover lift removed. Hover gets a 0.10 accent wash, active gets 0.18. Same flattening for both `+` (add) and target (what-now) variants. The FC card panel that expands from the FAB switches to flat-rect with accent border + cyan glow text-shadow.
  - **Form submit primary.** "Save changes" / "Add task" fills replaced with bordered `[ verb ]` text — uses `::before` `[ ` and `::after` ` ]` brackets with the same accent color as the button text. No fill, no shadow, no transform on click.
  - **Form inputs + textarea + title.** Border-radius 10px → 0. Border-color stays hairline; focus state still flips to accent.
  - **EditTaskModal manage cluster.** Pill-shaped `Backlog` / `Projects` / `Make recurring` / `Delete` buttons → flat squared boxes. Delete border colors with overdue red. Confirm-yes button drops its red fill, becomes red-bordered transparent text.
  - **Settings segmented control.** Rounded-pill cluster → joined-border tab strip. Adjacent buttons share a border (right-border collapsed except on the last child); active button gets accent border + accent text + glow text-shadow. No background fill on active.
  - **Section labels.** Add a thin hairline `border-bottom` so the label reads as a listing header. Padding-bottom 4px so the rule sits close to the text but not flush.
  - **ConfirmDialog + ChainReconcileModal.** Same flattening — bg matches page, border becomes hairline, radius zeroed, shadow removed, deeper overlay.
  - **Toast.** Pill bg → bordered flat rect with accent border + cyan glow text-shadow.
  - **Architecture.** New `src/v2/terminal/flatten.css` (~330 lines). Imported via `terminal/index.css` between `typography.css` and the existing structural override files. All selectors gated on `[data-theme^="terminal"]`. Light + dark are completely untouched. Deleting the file restores the modern chrome to terminal mode entirely.
  - **Bundle.** CSS 217KB gzip 32.2KB (+~9KB from the new file's coverage). JS unchanged.
  - Modified: `src/v2/terminal/index.css`, `wiki/Version-History.md`
  - Added: `src/v2/terminal/flatten.css`

- style(ui): terminal theme — typography scale-down [S]
  - **Why.** First in-browser look at the merged terminal aesthetic showed text feeling chunky — task titles dominating the column, modal headers eating half the screen. Monospace is denser per-character than proportional fonts at the same point size, but the v2 sizes were originally tuned for Syne + DM Sans. Swapping to JetBrains Mono at the same numeric sizes overshoots.
  - **Approach.** New `src/v2/terminal/typography.css` with size overrides under `[data-theme^="terminal"]`. Light + dark stay at the calm Wheneri-tuned sizes. Dedicated file (not inline per component) so "what does terminal change about text?" is one grep, and graduating the smaller scale to all themes (if that's where we land) is one block to delete or de-gate.
  - **Major reductions:** modal title 32px Syne → 22px mono; empty title 22px Syne → 16px mono; card title 16px → 14px; card meta + notes preview + density spans 12px → 11px; form input/textarea 14px → 12px; form title 18px → 15px; settings row label 14px → 12px; settings row hint → 11px; ConfirmDialog title 16px monospace; Adviser chat → 12px.
  - **Held steady.** Section labels (already 11px), week-strip range/label (already 11/10px), edit-manage label, header wordmark range — these were already tuned for monospace and stayed.
  - **Bundle.** CSS 208KB gzip 31.2KB (+~3KB from 100 lines of override rules). JS unchanged.
  - Modified: `src/v2/terminal/index.css`, `wiki/Version-History.md`
  - Added: `src/v2/terminal/typography.css`

- chore(ui): terminal theme PR I — stress-test convention + smoke test + docs [S]
  - **Why.** PR A–H built four palettes + extensive terminal-only treatments (CSS overrides, `terminalTitle`/`terminalCommand` props on 16 modals + 7 empty states, three TaskCard density signals hidden from light/dark, bracket toggles, manage-section reflow). The user's working hypothesis: "terminal might become the default forever — let's stress-test that, but be careful about creating more divergence in the meantime." PR I writes that down so subsequent work doesn't accidentally widen the gap.
  - **CLAUDE.md → "Terminal Theme Stress Test" section.** Documents the working hypothesis + the convention while we stress-test:
    1. Don't widen JSX divergence for new features — existing plumbing is enough; new features go terminal-first OR theme-agnostic, not theme-branched
    2. CSS overrides under `[data-theme^="terminal"]` are still cheap; use them for visual flourishes
    3. New `<ModalShell>` call sites must include `terminalTitle` (smoke test enforces)
    4. Density signals on TaskCard are terminal-only by user preference (PR G); graduate criteria documented — drop the gate if usage validates
    5. Decision criterion for "terminal forever": ~30 days of daily use in `terminal-*` → terminal becomes default; Light/Dark deprecation timeline starts
    6. Structural plan for both pivots: "terminal forever" (lock in, deprecate light/dark, drop CSS gates) and "terminal didn't stick" (rm -rf src/v2/terminal/, drop variants from picker, delete useTerminalMode + theme-aware props)
  - **Smoke test: `scripts/check-terminal-titles.js`.** Scans every v2 component for `<ModalShell` JSX and asserts each call site carries a `terminalTitle=` prop. Uses a brace-counting parser (not naive regex) so JSX with embedded arrow functions like `onClose={() => setOpen(false)}` doesn't trip on the inner `>`. Wired into:
    - `npm run check:terminal-titles` script in package.json
    - `.githooks/pre-push` between lint and smoke test, with a clear failure message pointing to the CLAUDE.md section
    - Run on PR I baseline: clean — all 15 `<ModalShell>` call sites have `terminalTitle`
  - **wiki/V2-State.md.** Flipped "Terminal-aesthetic theme toggle" parking-lot bullet from `[ ]` to `[x]` with a full PR A–I summary + the stress-test note pointing to CLAUDE.md.
  - **wiki/Architecture.md.** Added "Theme palette family" subsection under Component Architecture documenting the four `data-theme` values, the directory layout (`src/v2/terminal/`), the migration shim, the theme-aware JSX hooks/props (`useTerminalMode`, `terminalTitle`, `terminalCommand`, `data-terminal-cmd`), and the smoke-test convention.
  - **wiki/Features.md.** New "Themes" section near the top with a 4-row table covering Light / Dark / Terminal Dark / Terminal Light, plus a paragraph on `$ verb` modal headers and the opt-in home-screen surfaces (week strip + goal bar).
  - **No code shipped beyond the smoke test.** This is the lockdown PR — code is the docs + the guardrail. Visual QA pass is a manual session in browser, not a code change.
  - Modified: `CLAUDE.md`, `wiki/V2-State.md`, `wiki/Architecture.md`, `wiki/Features.md`, `wiki/Version-History.md`, `package.json` (added `check:terminal-titles` script), `.githooks/pre-push` (added the check between lint and smoke test)
  - Added: `scripts/check-terminal-titles.js`

- feat(ui): terminal theme PR H — home-screen 7-day strip + goal progress bar (opt-in) [M]
  - **Why.** init.habits puts a daily-rhythm strip at the top of its main view and a goal progress bar at the bottom — both surface "where am I in my day?" without the user having to open Analytics or do math. PR H adds those two surfaces to v2's home screen, opt-in (default off) and theme-aware so they fit any palette.
  - **`WeekStrip` component (new).** 7-day calendar row rendered above the first task section. Each day cell shows day-of-week label + date number + an activity-intensity indicator. Today is highlighted; future days dim to 0.55 opacity. Activity intensity buckets:
    - 0 (no completions) — empty
    - 1 (some completions but below daily goal) — pale dot/pale block
    - 2 (met goal, up to 2× goal) — accent dot at 0.55 opacity / `▃` block
    - 3 (≥2× goal — over-achievement) — full accent dot / `█` block
    - `< prev` / `next >` arrows on the row header navigate weeks. State managed locally; defaults to current week. Range label reads as "May 4–10" (or "Apr 27–May 3" if straddling a month boundary).
    - Tap a day = no-op for v1. Hook reserved for future "filter to that day" / "jump to that day" interactions.
  - **`GoalProgressBar` component (new).** Renders below the last task section. Shows `tasksToday / daily_task_goal` as a horizontal progress bar with caption row underneath. Bar fills 100% at goal, then a thin amber "stretch" segment past 100% indicates over-achievement. Caption: "Goal: N tasks" + count `3/5 · 60%`.
  - **Theme-aware visuals (CSS-only, same JSX both modes):**
    - Light/dark — rounded card-style day cells with hairline border, soft accent-colored intensity bar; pill-shape progress track with rounded fill
    - Terminal — bare monospace strip (no card chrome), today's date number gets a `*` prefix, intensity rendered as block characters (`▁ ▃ █`); progress bar uses `[N/N]` brackets in the count + `// goal:` comment-prefixed caption + glow shadow on the fill
  - **Settings.** New "Home screen" subhead in General tab with three rows: 7-day strip toggle, goal progress toggle, daily task goal numeric input. The subhead renders as small uppercase "HOME SCREEN" caption in light/dark and `// home screen` lowercase comment in terminal — same `.v2-settings-subhead` class with terminal-mode CSS override.
  - **Default state.** Both `show_week_strip` and `show_goal_progress` ship as `false`. Existing users see no change until they opt in. New users start without them so the calm minimal home screen is the first impression.
  - **Wiring.** AppV2's mobile list (the `<div className="v2-list">`) renders `<WeekStrip>` above the first `renderSection` call when `show_week_strip` is true, and `<GoalProgressBar>` after the last `renderSection` call when `show_goal_progress` is true. Both inside the scroll container so they move with the list. Desktop Kanban view doesn't render either — Kanban is already dense; revisit in PR I if usage warrants.
  - **Bundle.** CSS 204.2KB gzip 30.9KB (+~5.5KB from the two new component CSS files + subhead override). JS 807KB gzip 223.6KB (+~5KB from the two components + memoized completion bucketing).
  - Modified: `src/store.js` (added `show_week_strip` + `show_goal_progress` defaults), `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/Version-History.md`
  - Added: `src/v2/components/WeekStrip.jsx`, `src/v2/components/WeekStrip.css`, `src/v2/components/GoalProgressBar.jsx`, `src/v2/components/GoalProgressBar.css`

- feat(ui): terminal theme PR G — TaskCard density (terminal-only) [S]
  - **Why.** init.habits packs more information per row than v2's calm card does — checklist completion at a glance, notes preview without expanding, streak indicator for recurring tasks. PR G ports those three signals into TaskCard, gated on terminal mode so light/dark stay calm.
  - **Inline `[X/Y]` checklist counter.** When a task has any checklist items, the title row gets a small `[3/5]` counter span after the title. CSS-gated to terminal mode — light/dark hide it via `display: none`.
  - **One-line notes preview.** When a task has notes, the collapsed card renders a clamped first-line preview as a sub-row under the title (with a `// ` comment prefix so it reads as inline notes attached to the task). Trims to 140 chars + first newline cut so multi-line notes render as a single sentence. CSS-gated to terminal mode + collapsed state — expanded view still shows full notes via the existing `.v2-card-notes` block.
  - **Routine streak indicator.** Tasks with `task.routine_id` show a small `🔥N` indicator after the title (or after the checklist counter if both present). New `computeRoutineStreak(routine)` in `src/store.js` walks `completed_history` from newest to oldest, counting consecutive entries spaced ≤1.5× the cadence interval. Cadence intervals: daily=1d, weekly=7d, monthly=30d, quarterly=91d, annually=365d, custom=N×days. Returns 0 for never-completed routines.
  - **`routineStreaks` prop.** AppV2 builds a memoized `Record<routineId, number>` map from the live `routines` array via `useMemo`, threads it down through `renderSection` (mobile list), `KanbanBoard` (desktop), `ProjectsView`, and the search-results path. Recomputed only when `routines` changes — completing a routine instance bumps the array, which rebuilds the map.
  - **CSS architecture.** All three new spans (`.v2-card-checklist-inline`, `.v2-card-routine-streak`, `.v2-card-notes-preview`) ship with `display: none` in the base CSS. Terminal-mode CSS in `src/v2/terminal/cards.css` flips them to `display: inline` (or `display: -webkit-box` for the clamped notes line). Adding to light/dark later is a one-line change (drop the data-theme prefix scope).
  - **Bundle.** CSS 198.6KB gzip 30.1KB (+~1KB from the density rules). JS 802KB gzip 222KB (+~1KB from the streak computation + map build).
  - Modified: `src/store.js`, `src/v2/components/TaskCard.jsx`, `src/v2/components/KanbanBoard.jsx`, `src/v2/components/ProjectsView.jsx`, `src/v2/AppV2.jsx`, `src/v2/terminal/cards.css`, `wiki/Version-History.md`

- feat(ui): terminal theme PR F — control language (bracket toggles, $ verb modal headers, // manage section) [M]
  - **Why.** PR A–E got terminal mode looking right (palette, monospace, ASCII flourishes, sub-palettes). PR F gets it speaking right — modal headers read as commands, settings toggles read as switch states, destructive actions in EditTaskModal read as a CLI subcommand cluster.
  - **`useTerminalMode` hook.** New `src/v2/hooks/useTerminalMode.js` — subscribes to the documentElement's `data-theme` attribute via MutationObserver, returns `true` when the theme starts with `terminal-`. Used wherever JSX needs to swap copy or rendering (not pure CSS overrides).
  - **`$ verb --flag` modal headers.** ModalShell accepts a new optional `terminalTitle` prop; when set + terminal-mode is active, that's rendered instead of the regular `title`. Wired across every v2 modal:
    - AddTaskModal: `$ task --new`
    - EditTaskModal: `$ task --edit`
    - SnoozeModal: `$ snooze`
    - ReframeModal: `$ reframe`
    - WhatNowModal: `$ what-now`
    - SettingsModal: `$ settings`
    - PackagesModal: `$ packages`
    - AnalyticsModal: `$ stats`
    - ProjectsView: `$ projects`
    - DoneList: `$ done --list`
    - ActivityLog: `$ log`
    - RoutinesModal: `$ routines` / `$ routine --new` / `$ routine --edit` (state-dependent)
    - AdviserModal: `$ quokka`
    - MarkdownImportModal: `$ import --markdown`
    - AppV2 More menu: `$ menu`
    - AppV2 Help modal: `$ help --keys`
    - ConfirmDialog: prop added, no callers wiring it for now (chain-confirm contextual titles like "Stop the follow-up chain?" carry better signal than a generic `$ confirm`)
  - **`// manage` section reflow in EditTaskModal.** Destructive + admin actions (Backlog / Projects / Make recurring / Delete) moved into a labeled cluster under a new "Manage" sub-header. Light/dark renders the label as a small uppercase "MANAGE" caption with letter-spacing 0.08em; terminal renders as `// manage` (lowercase, monospace, comment prefix). The hairline + label do the visual grouping; in terminal mode `data-terminal-cmd` attributes on inner spans swap each button's label to its CLI form (`$ archive`, `$ move-to-projects`, `$ make-recurring`, `$ delete --confirm`) via CSS `attr()`. Light/dark show the regular "Backlog" / "Projects" / "Make recurring" / "Delete" labels.
  - **Bracket-toggle CSS-only override.** `[off] [on]` bracket pairs replace iOS-pill toggles in terminal mode. The existing `<input>+<track>+<thumb>` markup stays unchanged; CSS in `terminal/controls.css` hides the thumb, blanks the track background, and renders both labels via `::before` and `::after` on the track. The active state matches the input's `:checked` state via the sibling combinator. Active label gets the accent color + glow; inactive reads as faded text. Light/dark themes are completely untouched.
  - **EmptyState `terminalCommand` prop.** `EmptyState` accepts a new optional prop that, when provided + terminal mode is active, short-circuits the icon + title + body + CTA tree to render as a single `// comment` line — same vibe as a CLI "no results" output. Wired into 7 callers covering the main empty-state surfaces:
    - Home screen (no tasks): `// no active tasks. that's either bold or concerning. press + to add.`
    - Search empty: `// type a query — searches active, done, backlog, projects`
    - Search no matches: `// no matches for "..."`
    - DoneList: `// no completions yet — they show up here as you finish tasks`
    - ActivityLog: `// log empty — edits, completions, and deletes will appear here`
    - ProjectsView: `// no projects — move long-haul tasks here to stop the nag`
    - PackagesModal: `// no packages tracked — paste a tracking number above`
    - RoutinesModal: `// no routines yet. recurring tasks live here — dentist, oil change, water plants.`
    Other empty-state callers (Settings sub-tabs, AdviserModal, AnalyticsModal) keep the regular icon-and-body layout — those reads are dense enough that the comment form would lose information.
  - **Architecture.** New `src/v2/terminal/controls.css` joins the directory; imported via `terminal/index.css`. Holds the bracket-toggle override + empty-state-terminal renderer. Selectors all use `[data-theme^="terminal"]` so both `terminal-dark` and `terminal-light` pick up the same treatment.
  - **Bundle.** CSS 197.8KB gzip 30.0KB (+~2KB from controls.css + manage section + new pseudo-element rules). JS 801KB gzip 222KB (+~3KB from useTerminalMode hook + threaded props across modals).
  - **What's not in this PR.** Tap-to-cycle interactions on TaskCard (planned for PR G with the density features), home-screen week strip + goal bar (PR H), polish + visual QA (PR I).
  - Modified: `src/v2/components/ModalShell.jsx`, `src/v2/components/ConfirmDialog.jsx`, `src/v2/components/EmptyState.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/SnoozeModal.jsx`, `src/v2/components/ReframeModal.jsx`, `src/v2/components/WhatNowModal.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/PackagesModal.jsx`, `src/v2/components/AnalyticsModal.jsx`, `src/v2/components/ProjectsView.jsx`, `src/v2/components/DoneList.jsx`, `src/v2/components/ActivityLog.jsx`, `src/v2/components/RoutinesModal.jsx`, `src/v2/components/AdviserModal.jsx`, `src/v2/components/MarkdownImportModal.jsx`, `src/v2/AppV2.jsx`, `src/v2/terminal/index.css`, `wiki/Version-History.md`
  - Added: `src/v2/hooks/useTerminalMode.js`, `src/v2/terminal/controls.css`

- refactor(ui): terminal theme PR E — palette family + directory split [M]
  - **Why.** Terminal theme shipped as a single `data-theme="terminal"` value with one navy/cyan palette baked into `tokens.css` and `terminal.css`. To go deeper into the aesthetic and let the theme branch into sub-palettes (GitHub Dark, GitHub Light), the structure had to grow up. This PR is the foundation for the rest of the v2-polish-terminal-v2 set.
  - **Two sub-palettes.** Single `'terminal'` value retired in favor of:
    - `'terminal-dark'` — GitHub Dark colors (#0D1117 canvas, #58A6FF blue accent, #F85149/#D29922/#7EE787 alarm colors). Reads as "code editor in dark mode."
    - `'terminal-light'` — GitHub Light colors (#FFFFFF canvas, #F6F8FA panel, #0969DA blue accent, #1F2328 text). Reads as "code editor in light mode." Same monospace + ASCII flourishes, white canvas. Different brain, different lighting.
  - **Migration.** `loadSettings()` upgrades stored `theme: 'terminal'` → `'terminal-dark'` on first read and saves back. `index.html` pre-paint script does the same migration in localStorage so the right tokens are scoped before React mounts. AppV2's mount-time theme effect understands all four values. Idempotent — once migrated, the old value never reappears.
  - **Architecture.** Split the monolithic `src/v2/terminal.css` (273 lines) into `src/v2/terminal/` directory:
    - `palette-dark.css` — GitHub Dark tokens (45 lines)
    - `palette-light.css` — GitHub Light tokens (45 lines)
    - `wordmark.css` — `$ boomerang_` cursor + sync-state animations (95 lines)
    - `sections.css` — chevron section bullets, bracketed counts, popover bracket dot (50 lines)
    - `cards.css` — `[ ] ` task-title prefix, `[ Done ]` button brackets, modal buttons (75 lines)
    - `index.css` — `@import` aggregator (5 lines)
  - **Selector convention.** Structural overrides switched from `[data-theme="terminal"]` to `[data-theme^="terminal"]` so both sub-variants pick up the ASCII flourishes uniformly. Adding a new sub-palette later is one drop-in `palette-*.css` file plus an @import.
  - **Picker UI.** SettingsModal Theme picker grew from 3 options to 4 (Light / Dark / Term Dark / Term Light). New `.v2-settings-segment-4` modifier tightens padding so all four labels fit a one-row segmented control down to ~320px viewport.
  - **Theme-color meta.** Pre-paint and AppV2 effect both extend the theme-color map to all four values. terminal-light → `#FFFFFF` (white status bar to match white canvas). terminal-dark → `#0D1117` (true GitHub Dark canvas, slightly lighter than the previous `#0A0E1A`).
  - **Glow token.** terminal-dark keeps `--v2-glow: 0 0 8px rgba(88, 166, 255, 0.45)` (signature GitHub Dark blue). terminal-light sets `--v2-glow: none` — glow on white reads as a blur artifact, not an effect, so light-canvas variants intentionally drop it.
  - **Bundle.** CSS bundle is 195.5KB (gzipped 29.7KB), up ~2KB from the second palette + 4-option picker styles. JS unchanged.
  - **Visual QA.** Cycling through Light → Dark → Term Dark → Term Light reloads cleanly, settings persist, no FOUC, status-bar color matches each canvas.
  - Modified: `src/store.js`, `index.html`, `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `src/v2/tokens.css`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/Version-History.md`
  - Added: `src/v2/terminal/palette-dark.css`, `src/v2/terminal/palette-light.css`, `src/v2/terminal/wordmark.css`, `src/v2/terminal/sections.css`, `src/v2/terminal/cards.css`, `src/v2/terminal/index.css`
  - Removed: `src/v2/terminal.css` (split into the directory above)

- feat(ui): terminal theme PR D — sync animations [S]
  - **Why.** Light/dark themes use a letter-by-letter wave bounce + green flash for the saving / just-synced sync states. Brand-y, slightly playful — wrong vibe for terminal. PR D replaces those with status conventions terminals actually use.
  - **Sync states in terminal mode.**
    - `saving` → cycling spinner glyph at the cursor position (`| / - \` — the universal CLI loading indicator). 0.6s `steps(4)` rotation, cyan accent color.
    - `just-synced` → static `✓` (green via `--v2-energy-errand`) for the 700ms hold, then back to idle cursor.
    - `idle` → blinking `_` cursor (PR B).
    - `degraded` → blinking `_` in amber (PR B).
    - `offline` → blinking `_` in red (PR B).
  - **Letter behavior.** The bounce wave and green flash on individual letters are muted in terminal mode for both `saving` and `just-synced`. Letters stay solid; the spinner / checkmark at the cursor position is the sole channel for state. Reads as a CLI status line, not a brand animation.
  - **Implementation.** Uses CSS `content` animation — `@keyframes` cycle through `|` / `/` / `-` / `\\`. Modern-browser support landed 2022-2023 (Chrome 105+, Safari 16.4+, Firefox 110+). Older browsers fall back to the static `|` from the `::after` content declaration.
  - **Reduced-motion.** Spinner glyph stays static at `*` instead of cycling.
  - **Bundle.** 779KB precache (CSS-only, ~1KB source).
  - **Terminal theme is now feature-complete for the PR set in V2-State.md.** Future polish (e.g. `[OK]/[ERR]/[BUSY]` badges next to the wordmark, command-prompt style for the brand popover, alternate cadences) can land as smaller follow-ups based on usage.
  - Modified: `src/v2/terminal.css`, `wiki/Version-History.md`

- feat(ui): terminal theme PR C — TaskCard ASCII flourishes [S]
  - **Why.** Cards picked up the theme's palette + radii from PR A, but they still read as "v2 cards in dark blue." PR C makes them feel like rows in CLI task-list output.
  - **Title prefix.** `[ ] ` checkbox affordance prepended to every task title via `.v2-card-title::before`. Universal terminal TODO marker — Active tasks still aren't done so they always show the empty checkbox; once they complete they leave the active list anyway, so a `[✓]` state isn't needed in this view.
  - **Primary action button.** "Done" wraps in `[ Done ]` brackets via `::before` / `::after`, plus a subtle cyan `--v2-glow` box-shadow so the primary affordance pulses with the accent — the one place the theme allows itself a little ornament beyond pure characters.
  - **Skip-advance button.** Amber outline + faint amber background fill so it reads as a peer command in the action row (instead of feeling out of place against the cyan primary).
  - **Meta separator.** `·` → `|` via `font-size: 0` + `::before`. Pipe reads as terminal output column separator.
  - **Modal buttons.** Same `[ ... ]` bracket treatment applies to `ConfirmDialog`'s danger button and `ChainReconcileModal`'s primary button so destructive confirms and Quokka apply-suggestions reads as one visual language with the in-card primary. Reconcile primary also gets the cyan glow.
  - **Bundle.** 779KB precache (terminal.css gained ~1KB CSS source, no measurable bundle change after compression).
  - **What's still pending.** Sync-state animations: ASCII spinner per letter on saving, `[OK]/[ERR]/[BUSY]` bracketed status flashes (PR D — last theme PR).
  - Modified: `src/v2/terminal.css`, `wiki/Version-History.md`

- feat(ui): terminal theme PR B — wordmark prompt + section bullets [S]
  - **Why.** PR A swapped the palette + font; PR B layers the actual ASCII flourishes that make the theme feel like a CLI instead of just "v2 in dark blue."
  - **Wordmark.** `BOOMERANG` becomes `$ boomerang_` in terminal mode. Lowercase via `text-transform`, leading `$ ` prompt prefix as `::before`, blinking trailing `_` cursor as `::after` (1.1s `steps(2)` blink — hard on/off cut, not smooth fade). Cursor color picks up the cyan accent in idle state, switches to amber/red when sync goes degraded/offline. Existing letter-span saving wave still fires unchanged because the pseudo-elements aren't part of the spans.
  - **Section labels.** `✦ DOING                3` becomes `> DOING               [3]`. Sparkle character hidden via `font-size: 0`; chevron prompt rendered as `::before` on the bullet span; brackets wrap the count via `::before` + `::after` on the count span. Reads as a CLI listing row.
  - **Brand popover sync row.** The `●` indicator gets bracketed: `[●] Synced ✓` for status-line vibes.
  - **Empty-state icon backdrop** rounds to the smaller terminal `--v2-radius-card` (4px) so the soft circle becomes a boxy square — matches the theme's overall geometry.
  - **Architecture choice.** All terminal overrides live in a single new `src/v2/terminal.css` (imported from `AppV2.css`) instead of being scattered across each component's stylesheet. Two reasons: (1) easier to audit "what does terminal mode change?", (2) component CSS stays neutral so light + dark remain canonical.
  - **Reduced-motion.** Cursor blink respects `prefers-reduced-motion` — solid cursor instead of animation.
  - **Bundle.** 779KB precache (unchanged — terminal.css adds ~3KB of CSS source that compresses into the existing chunk).
  - **What's still pending.** Bracket buttons, `[ ]/[✓]` checkboxes on TaskCard (PR C). Sync wordmark spinner + `[OK]/[ERR]/[BUSY]` flashes (PR D).
  - New: `src/v2/terminal.css`
  - Modified: `src/v2/AppV2.css`, `wiki/Version-History.md`

- feat(ui): terminal theme PR A — palette, monospace stack, 3-way picker [M]
  - **Why.** Light + dark covered the calm-product end of the aesthetic spectrum, but the user wanted a third mode that reads as "this app is a tool, not a product" — inspired by [init.habits](https://inithabits.com) and classic dev-tool dark themes. Deep navy bg, monospace everywhere, cyan accents with a soft glow. Layout/component contracts are unchanged; this PR is purely tokens + the picker.
  - **Token block.** New `:root[data-ui="v2"][data-theme="terminal"]` variant in `tokens.css`. Bg `#0A0E1A`, surface `#0F1424`, text `#D8DEF0`, accent cyan `#4FC3F7`. Energy types desaturated to fit the navy palette without competing with the accent. Radii dropped from `999px / 14px / 20px` to `6px / 4px / 6px` so cards/pills read "terminal box" instead of "iOS pill." New `--v2-glow` token (subtle cyan blur) reserved for opt-in use by sync/wordmark/buttons in the next theme PRs.
  - **Font stack.** `JetBrains Mono` from Google Fonts as the primary, `'SF Mono' / 'Cascadia Code' / 'Fira Code' / ui-monospace` fallbacks. Both `--v2-font-display` and `--v2-font-body` collapse to the same monospace stack — no mixed font weights, the typographic flat-out reads as terminal.
  - **Picker.** Settings → General "Dark mode" toggle becomes a 3-way segmented control (Light / Dark / Terminal). Stacked layout because three pills don't fit alongside the row label on phone width. Wires through to `update('theme', value)` + `data-theme` attr + `meta[name="theme-color"]`. Defaults to `light` when unset (existing users keep their light/dark choice).
  - **Pre-paint application.** `index.html` inline script extended to recognize `'terminal'` alongside `'light'`/`'dark'` so the navy bg paints before React mounts (no white-flash on terminal theme load).
  - **Bundle.** 779KB precache (+1KB from token block + segmented control CSS).
  - **What this PR doesn't do.** ASCII flourishes (bracket buttons, `[ ] / [✓]` checkboxes, `>` section bullets), cursor-blink/spinner sync animations, and command-prompt header styling all land in PR B / C / D as the theme builds out.
  - Modified: `src/v2/tokens.css`, `src/v2/AppV2.jsx`, `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `index.html`, `wiki/Version-History.md`

- feat(adviser): Sequences PR 5 — Quokka tools for chain editing [S]
  - **Why.** Quokka could read routines but couldn't edit a chain template — no atomic ops on `follow_ups`. Users had to open RoutinesModal manually to add/remove/reorder steps. Now natural-language commands like *"add a 'rinse the brushes' step to the mop routine right after auto-clean"* can do the work.
  - **Four new tools** in `adviserToolsTasks.js`, each capturing the routine's pre-state in their compensation closure for rollback:
    - `add_follow_up({routine_id, title, offset_minutes, [step_index], [energy_*], [notes]})` — append or insert. Returns the new `step_id` so chained tool calls can reference it.
    - `edit_follow_up({routine_id, step_id|step_index, [title, offset_minutes, energy_*, notes]})` — update a single step's fields. `null` for energy_type/level/notes clears that field.
    - `remove_follow_up({routine_id, step_id|step_index})` — delete one step.
    - `reorder_follow_ups({routine_id, step_ids[] OR (from_index, to_index)})` — full reorder by id list, or single-step move by indices. Validates length match for the array form.
  - **Visibility into chain steps.** `summarizeRoutine` now serializes `follow_ups` with `step_index` + `step_id` + fields per step so `get_routine` and `list_routines` give the model what it needs to address steps without a separate fetch. Cost: a few hundred bytes per routine in the tool response.
  - **Tool count.** `50 → 54`. CLAUDE.md updated.
  - **Scope.** Template-only (matching PR 4). Already-spawned task instances carry their own `follow_ups` snapshot from PR 1's spawn copy and aren't retroactively mutated by template edits — the model can't accidentally rewrite a chain that's already mid-flight.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 778KB precache (server-side only — no client bundle change).
  - Modified: `adviserToolsTasks.js`, `CLAUDE.md`, `wiki/Sequences.md`

- feat(routines): Sequences PR 4 — AI chain reconciliation [M]
  - **Why.** Editing a step in a multi-step chain often makes the OTHER steps read inconsistently — rename "Empty the dirty tank" to "Drain the rinse tank" and the "Put dry tanks back" step at the end now sounds slightly off. Without reconciliation, the user has to remember to revisit each downstream step manually. Now Quokka does the cross-step pass on demand.
  - **Behavior.** When the routine form saves an EXISTING chain with edits/additions/removals, a `ChainReconcileModal` intercepts. Three states: `review` (summary of the user's changes + "Ask Quokka" / "Save without scan" buttons) → `loading` (Quokka spinner) → `diffs` (per-suggestion accept/reject toggles + "Apply selected" / "Skip all" buttons). Brand-new chains skip the gate — no point reconciling steps you just drafted. Title-only trigger; offset/notes/energy edits don't propagate linguistically.
  - **AI prompt.** Conservative-by-default. The system prompt explicitly says "empty list is the right answer most of the time" and "don't suggest changes for taste alone." Returns `[{stepIndex, suggestedTitle, reasoning}]`. Defensive parsing: ignores out-of-range indices, drops suggestions that match the current title, falls back to `[]` on any error so a flaky API never blocks the save flow.
  - **Implementation.** New `aiReconcileChain(originalChain, currentChain, parentTitle)` in `src/api.js` — uses the existing `/api/messages` proxy with a focused prompt. New `src/v2/components/ChainReconcileModal.jsx` + `.css` (state machine + per-suggestion checkboxes + accessible close + reduced-motion fallback). Hooked into `RoutineForm.handleSave` via `pendingSave` state.
  - **Scope deferred.** Live in-flight chain editing (Scenario B in `wiki/Sequences.md`) is parked. Editing a chain-step task's title in EditTaskModal doesn't yet trigger reconciliation against the queued steps. Template-only (Scenario A) is the MVP that ships here; live-edit reconciliation lands in a follow-up PR if the use case shows up enough.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 778KB precache (+7KB from the modal + AI helper).
  - New: `src/v2/components/ChainReconcileModal.jsx`, `src/v2/components/ChainReconcileModal.css`
  - Modified: `src/api.js`, `src/v2/components/RoutinesModal.jsx`, `wiki/Sequences.md`

- feat(routines): Sequences PR 3 — skip & advance [S]
  - **Why.** Sometimes a chain-step task isn't gonna happen this cycle ("I forgot to clean the mop after I finished mopping the floors") but the rest of the chain still needs to fire (the auto-clean cycle still has to happen so the dirty tank gets emptied). Without skip-advance, the user's only options were complete-as-if-done (lies in analytics) or cancel (kills the chain). Skip-advance threads the needle: this step is abandoned, but the chain advances.
  - **Behavior.** New amber `SkipForward` icon button in the expanded TaskCard action row, only renders when `task.follow_ups.length > 0`. Tap → optimistic local update marks the task `cancelled` + `skipped=true` + `completed_at=now`, fires `serverSkipAdvanceTask` which atomically persists those fields server-side AND runs `spawnNextChainStep`. New spawned step arrives via SSE-triggered refetch.
  - **Server.** `POST /api/tasks/:id/skip-advance` — single endpoint that does the cancel-mark + spawn in one DB pass, broadcasts an SSE update on success.
  - **Schema.** Migration 024 adds `skipped INTEGER DEFAULT 0` to `tasks`. Wired through `taskToRow` / `rowToTask` / `UPSERT_TASK_SQL` / `runUpsertTask` (column 36 in the upsert tuple).
  - **Activity log.** `logActivity('skipped', task)` fires from the optimistic-update path so DoneList / ActivityLog can render skipped vs cancelled differently in future polish (PR 3 doesn't change those views; the data is just queryable now).
  - **Idempotency.** PATCH and skip-advance can race; both end at the same canonical state. PATCH only spawns on transitions to `done`/`completed`, so a concurrent PATCH-cancel doesn't double-spawn. SkipAdvance handles its own spawn; second-try is a no-op since the task is already cancelled.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 771KB precache (+1KB from SkipForward icon + handler).
  - New: `migrations/024_add_task_skipped.sql`
  - Modified: `db.js`, `server.js`, `src/api.js`, `src/v2/AppV2.jsx`, `src/v2/components/TaskCard.jsx`, `src/v2/components/TaskCard.css`, `src/v2/components/KanbanBoard.jsx`, `wiki/Sequences.md`

- feat(routines): Sequences PR 2 — chain-break confirmation [S]
  - **Why.** PR 1 shipped follow-up chains, but a user could silently kill a chain by deleting the parent task / moving it to backlog / cancelling it without realizing the queued steps wouldn't spawn. After running mop chains for a few days the user wanted an explicit warning before destructive actions on chain-bearing tasks.
  - **Behavior.** Any task with `follow_ups.length > 0` triggers a `ConfirmDialog` before delete / cancel / move-to-backlog / move-to-projects: *"Stop the follow-up chain? This task has N follow-up step(s) queued. {Action} will stop the chain — the queued step(s) won't spawn."* Two options: confirm-with-stop (red destructive button) or "Keep task" (cancel). Completion is intentionally ungated since `done` ADVANCES the chain via `spawnNextChainStep` — completing isn't "breaking" the chain, it's how the chain walks forward.
  - **Implementation.** `gateOnChainBreak(task, actionLabel, confirmLabel, proceed)` helper in `AppV2.jsx` wraps the four destructive handlers (`handleDelete` / `handleBacklog` / `handleProject` / `handleStatusChange` for `cancelled`). Empty-chain tasks short-circuit and proceed immediately — no behavior change. State lives in `chainConfirm` set on `AppV2`.
  - **Reusable confirm primitive.** Extracted the dialog pattern from `SettingsModal.jsx`'s inline confirm into `src/v2/components/ConfirmDialog.jsx` + `.css`. Props: `open` / `title` / `body` / `confirmLabel` / `cancelLabel` / `tone` (`'danger'` or `'primary'`) / `onConfirm` / `onCancel`. Escape-to-close. Future destructive flows (skip-and-advance, clear-all-data, etc.) can reuse it.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 770KB precache (up from 768KB).
  - New: `src/v2/components/ConfirmDialog.jsx`, `src/v2/components/ConfirmDialog.css`
  - Modified: `src/v2/AppV2.jsx`, `wiki/Sequences.md`

- fix(ui): v2 header — iOS status bar overlap on PWA [XS]
  - **Bug.** With `apple-mobile-web-app-status-bar-style: black-translucent` (set in `index.html`), iOS PWA in standalone mode renders the system status bar (clock, signal, battery) OVER the app's content — the BOOMERANG wordmark area got the iPhone's clock display rendered on top of it, producing the "B 22:25 MERANG" overlap visible in v1.0.0 prod.
  - **Fix.** `.v2-header` `padding-top` now uses `max(14px, env(safe-area-inset-top, 0px))` (and `max(16px, ...)` on the `min-width: 601px` desktop variant) so our header content sits below the iOS status bar instead of behind it. The `viewport-fit=cover` meta tag is already in place. Header background remains a solid `var(--v2-bg)` so the status bar's text reads on a contrasting surface.
  - Modified: `src/v2/components/Header.css`

---

## 2026-05-09

- fix(ui): v2 FloatingCapture — target icon stays visible when what-now card opens [XS]
  - The target FAB was being replaced by a generic X close button when the card opened — making it look like the FAB had been "covered" by the card. Now the target icon stays at the right end of the card (same role as the `+` icon at the right of the quick-add input pill — visually persistent affordance, tap to toggle closed). Same orange-fill / black-rings treatment as the standalone FAB. Removed the unused X import.
  - Modified: `src/v2/components/FloatingCapture.jsx`, `src/v2/components/FloatingCapture.css`

- fix(ui): v2 FloatingCapture — what-now card inflates from FAB footprint [XS]
  - The taller what-now card (85px) was using the same scaleX-only animation as the 48px add card. Result: at frame 1 the full vertical height appeared instantly while only the width animated, reading as a "slam" instead of an emergence. Added a separate `v2-fc-card-whatnow-in` keyframe that scales BOTH axes from the FAB footprint (`scaleX(0.13) scaleY(0.55) → 1`) with `transform-origin: right bottom`. The card now visually inflates out of the FAB's last position. Add card unchanged.
  - Modified: `src/v2/components/FloatingCapture.css`

- fix(ui): v2 FloatingCapture — align in-card buttons with standalone FABs [XS]
  - Card had 4px right padding which inset the trailing in-card button (`+` / `X`) by that much. With the other slot still showing a standalone FAB flush against the wrap edge, the two orange circles fell out of vertical alignment. Drop right padding to 0 on both card variants so every button shares the same x-axis regardless of which slot is expanded.
  - Modified: `src/v2/components/FloatingCapture.css`

- style(ui): v2 FloatingCapture — heading on what-now card [XS]
  - Five unlabeled time chips ("5 min", "15 min", …) didn't communicate intent on their own — what does tapping a number do? Added a small heading "How much time do you have?" above the chip row. Card grows from a single-row 48px pill into a stacked 80-90px card with rounded-card border-radius (20px instead of 999px); close button aligns to top so it doesn't float against multi-line content.
  - Modified: `src/v2/components/FloatingCapture.jsx`, `src/v2/components/FloatingCapture.css`

- fix(ui): v2 FloatingCapture — orange what-now + iOS keyboard occlusion fix [S]
  - **What-now FAB orange w/ black rings.** Originally hairline-bordered neutral so it didn't compete with the accent-filled `+`. User feedback: both should be brand-accent. Now both circles share the orange fill; what-now uses black `currentColor` so the target/dartboard rings read against the orange (white-on-orange would have lost contrast on the inner ring weights).
  - **iOS keyboard occlusion.** When the soft keyboard opened, the floating capture sat at `bottom: 16px` of the layout viewport — but the keyboard covered the bottom ~40% of the screen, so the input landed behind it and the user typed blind. Now uses the `visualViewport` API to measure how much of the bottom is occluded and translates the wrapper upward by that amount; `resize` listener handles keyboard show/hide and orientation changes. CSS transition smooths the lift so it rides up with the keyboard slide-in instead of snapping.
  - Modified: `src/v2/components/FloatingCapture.jsx`, `src/v2/components/FloatingCapture.css`

- fix(ui): v2 update-modal — drop `v` prefix on sha-style versions [XS]
  - `<div className="v2-update-version">v{updateVersion}</div>` rendered `vdev-e1ba2aa` on non-tagged builds. Changed to a conditional prefix: only prepend `v` when the version starts with a digit (i.e. semver like `0.10.0` → `v0.10.0`); sha-style versions like `dev-e1ba2aa` render bare. Future-proof for tagged releases without uglying up the dev sha display.
  - Modified: `src/v2/AppV2.jsx`

- feat(ui): v2 right-edge speed-dial — FloatingCapture for quick-add + what-now [M]
  - **Why.** Header was crowded (5 affordances on iPhone width) and v1's bottom bar didn't aesthetically fit the v2 calmer language. New pattern: right-edge speed-dial with two stacked floating circles. Tap a circle, it expands leftward into a slim card with the relevant input. Tap-outside or Escape collapses.
  - **Quick-add (+).** Lower circle, accent-filled. Tap → expands into a 320px input pill anchored to the right edge. Enter or tap + creates a task with just the title (size auto-infer hook fills in energy on the next render). Card stays open after submit so rapid-fire capture is one tap, type, Enter, type, Enter — not modal open/close churn.
  - **What-now (target).** Upper circle, neutral. Tap → expands into a 360px card with capacity chips (`5 min` / `15 min` / `30 min` / `1 hr` / `2 hr+`). Tap a chip → opens WhatNowModal seeded with that capacity preset (preset wiring deferred — for now the chip just opens WhatNowModal, capacity arg is accepted by the handler but ignored downstream).
  - **Header cleanup.** Removed `+ Add` orange circle and `What now?` inline pill from the Header. Also dropped now-unused `Plus` and `Target` imports + the `onOpenAdd`/`onOpenWhatNow` props. Header is now: logo · BOOMERANG · ✨ · 📦 · ⋯ — calmer, room to breathe.
  - **Positioning.** `position: fixed; right: 16px; bottom: max(16px, env(safe-area-inset-bottom, 0px))` so the bottom row sits above the iOS PWA home-bar gesture indicator. Z-index 50 — above task list, below modals (which use 99999). `pointer-events: none` on the wrapper so the gap between circles doesn't block list scroll.
  - **Animation.** Scale-in transform-origin: right center keeps the right edge anchored, card grows leftward from the button. Respects `prefers-reduced-motion` (fade only, no scale).
  - **Reduce-motion-friendly + iOS-safe focus.** iOS Safari needs focus to chain through a user-tap event handler — we route the `<input>` focus through the click handler, with a useEffect safety net for keyboard-only users. autoFocus on the input handles desktop.
  - New: `src/v2/components/FloatingCapture.jsx`, `src/v2/components/FloatingCapture.css`
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/Header.jsx`

- fix(ui): v2 header pill + swipe slider + routine spawn-now feedback [S]
  - **Header today-count pill removed.** The "10 today" pill in the header was crowding the BOOMERANG wordmark on iPhone width AND duplicating the "X done today" line in the wordmark-tap popover. Dropped the pill from the action nav; the popover keeps the count, accessible via tap-the-wordmark. Header is now: wordmark · What now? · + · ✨ · 📦 · ⋯. (Bigger header redesign deferred to a separate planning conversation — too dense for a snap fix.)
  - **Swipe slider clipping.** `SWIPE_OPEN_OFFSET` (-120px) didn't match `.v2-card-swipe-actions` width (160px), so when the card snapped open the leftmost 40px of the action panel stayed under the card — Edit's "E" got eaten and the user saw "dit". Bumped the offset to -160 so the card translates exactly the panel width.
  - **Routine "Spawn now" feedback.** No visual confirmation on tap meant the user tapped 10 times and got 10 duplicate tasks. Two-part fix: (1) AppV2's `onSpawnNow` handler now refuses the spawn if an instance of that routine is still active on the list (returns null silently); (2) RoutineRow takes a `hasActiveTask` prop and renders the button as a disabled "Already on list" state in that case. On a successful tap, the button briefly shows ✓ + "Spawned" for 1500ms before reverting. `activeRoutineIds` Set is memoized in AppV2 from `tasks` and threaded through `RoutinesModal` → each `RoutineRow`.
  - Modified: `src/v2/components/Header.jsx`, `src/v2/components/TaskCard.jsx`, `src/v2/components/RoutinesModal.jsx`, `src/v2/components/RoutinesModal.css`, `src/v2/AppV2.jsx`

- style(ui): v2 follow-ups unit picker — readable abbreviations (min / hr / day) [XS]
  - Single-letter `h` and `d` looked stranded next to `min`. Switched the unit dropdown to `min` / `hr` / `day`. Internal value tokens stay the same (`'min'`/`'h'`/`'d'`) so existing data and conversion logic are unaffected.
  - Modified: `src/v2/components/RoutinesModal.jsx`

- fix(ui): v2 RoutinesModal — drop duplicate header on form view [XS]
  - The form view rendered its own `← Back · New routine` bar below the ModalShell header (which had an empty title slot). Stacked headers wasted vertical space and looked wrong on iPhone width. Fix: pass the form title (`New routine` / `Edit routine`) into ModalShell so it renders in the modal's normal title slot. Removed the duplicate `<h2 class="v2-routine-form-title">` and its wrapper. Back link kept as a small inline pill above the title input so users can still return to the list view without closing the modal.
  - Modified: `src/v2/components/RoutinesModal.jsx`, `src/v2/components/RoutinesModal.css`

- feat(routines): Sequences PR 1 — completion-triggered follow-up chains [M]
  - **What.** Routines can hold an ordered template of follow-up steps. When a routine spawns a task instance, the template is copied onto the spawned task. Completing the spawned task spawns the next step with `due_date` derived from `now + step.offset_minutes`, and the chain walks forward as each step is completed. Use case (the user's mop): clean floors → auto-clean mop (offset 0) → empty tanks (30 min) → put back (2 days).
  - **Schema.** Migration 023 adds `follow_ups_json TEXT DEFAULT '[]'` to both `tasks` and `routines`. Step shape: `{id, title, offset_minutes, energy_type?, energy_level?, notes?}`. Routines hold the template; tasks hold the live in-flight chain. PR 1 editor exposes title + offset only — energy/notes can be added later or filled in by the background size-inference hook.
  - **Spawn logic.** `db.js` `spawnNextChainStep(parentTask)` runs from `updateTaskPartial` whenever a task transitions to `done`/`completed` AND has non-empty `follow_ups`. Sub-day offsets set `snoozed_until = trigger time` so the new task doesn't surface until the cycle is up; ≥1-day offsets land on the future date directly (no snooze, appears naturally on its due day). New task inherits `routine_id` from the parent so the chain stays grouped under the source routine for `completed_history` + activity log + analytics.
  - **Routine-instance copy.** Both spawn paths in `src/hooks/useRoutines.js` (`spawnNow` for manual + `spawnDueTasks` for cadence-driven) copy `routine.follow_ups` onto the spawned task. `addRoutine` signature gains an optional `followUps` parameter.
  - **Editor UI.** New Follow-ups section on the routine form (between Notes and Labels). `FollowUpStepRow` sub-component with title input, offset value + unit dropdown (min/h/d), reorder up/down chevrons, remove ×. Steps with empty title get filtered on save. The form drives both create + edit; `initial.follow_ups` seeds the editor when editing.
  - **State propagation.** Server-side spawn happens during the existing `PATCH /api/tasks/:id` request; the broadcast that wraps that PATCH already fires SSE → connected clients refetch and pick up the new chain step in the same round-trip. No additional broadcast plumbing.
  - **Roadmap parked in `wiki/Sequences.md`:** PR 2 delete prompt for mid-chain tasks, PR 3 skip-and-advance, PR 4 AI-mediated edit reconciliation, PR 5 Quokka tools. Sequence parking-lot entry in V2-State.md superseded by this PR — Sequences moves from "future direction" to "shipped (PR 1 of 5)".
  - New: `migrations/023_add_follow_ups.sql`, `wiki/Sequences.md`
  - Modified: `db.js`, `src/hooks/useRoutines.js`, `src/v2/components/RoutinesModal.jsx`, `src/v2/components/RoutinesModal.css`, `CLAUDE.md`

- fix(ui): v2 Notifications + Header bug pass + Beta → Legacy rename [S]
  - **Escalation row.** Single inline row from PR #63 wrapped awkwardly on iPhone width (Before due + On due fit row 1, Overdue dropped to row 2 alone with the input far left). Replaced `.v2-notif-stages-inline` flex layout with `.v2-notif-stages-grid` — three equal columns (label-above, centered input below) that fit symmetrically on iPhone-mini width without wrap. Per-cell "h" units removed; unit appears once in the section hint copy.
  - **Quiet hours.** Same redundant-title-row treatment as escalation: hoisted toggle into the section header row alongside the "Quiet hours" label + hint, dropped the duplicate "Enable quiet hours" sub-row.
  - **More notification options block removed.** Stale v1 deferral pointer at the bottom of NotificationsPanel ("Morning digest schedule + style, adaptive throttling 👍/👎 feedback chips, Pushover priority routing helper text still live in v1") deleted — those configurations are surfaced in v2 surfaces (digest in NotificationsPanel, throttle chips in AnalyticsModal, Pushover priority hint in Pushover row of IntegrationsPanel).
  - **Beta tab → Legacy.** `Beta` was a v2 onboarding artifact when v2 was opt-in; now that v2 is the default, the tab's only remaining purpose is the v1 escape hatch. Renamed to `Legacy`, dropped the stale "What's coming" roadmap (all items shipped), reworded copy to frame v1 as an escape hatch rather than a "legacy interface".
  - **Wordmark dark-mode contrast.** During the `saving` state the BOOMERANG letters were dimmed to `--v2-text-meta` (55% alpha), which reads fine in light mode but poorly against dark-mode bg. Removed the color override — bounce animation alone signals state, dim-on-top was redundant double-encoding.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `src/v2/components/Header.css`

- docs(v2): park Sequences feature + better Logs filter UX as post-v2 follow-ups [XS]
  - Documented "Smart follow-up sequences" (completion-triggered task chains; user's mop example: clean → auto-clean → empty tanks → put back) under V2-State Future-direction parking lot, including the two implementation shapes considered (standalone Sequence primitive vs `follow_ups` array on Tasks/Routines) and open questions on cancel/snooze semantics.
  - Documented "Better Logs filter UX" — current chips are hand-curated string matches; ideas include auto-discovering tag prefixes from the log stream and/or moving to structured logs (`{level, tag, msg}` objects) so chips reflect reality without hand-maintenance.
  - Modified: `wiki/V2-State.md`

- style(ui): v2 Settings polish — escalation row, Logs Google filter, build version, 17track gate [S]
  - **Notifications → High-priority escalation.** Three-stage cadence collapsed to a single inline row (`Before due [24] h · On due [1] h · Overdue [0.5] h`). The enable toggle moves up alongside the section label so the whole control fits without burning vertical space on a separate "Enable escalation" row. New `.v2-notif-stages-inline` flex layout in CSS; the old `.v2-notif-stages` grid remains for any other call site.
  - **Logs filter.** Combined the separate `Gmail` and `GCal` filter chips into a single `Google` chip that matches `[Gmail]`, `[GCal]`, and `[GCalSync]` log lines. Verified against actual log call sites — the two real prefixes (`[Gmail]`, `[GCal]`) cover every Google integration log line that either old chip would have caught.
  - **Build version moved to General.** Was in the Beta tab as a heading + paragraph + code chip; now lives as a row in the General tab next to the other settings, using `.v2-settings-row` styling for visual parity. Beta tab no longer surfaces `__APP_VERSION__`.
  - **17track row gate fix.** Added `'api-key'` to the IntegrationsPanel action-button allow-list so the 17track row no longer renders the "Connect/Manage in v1" fallback button alongside the inline API-key field. Removed the stale "Why v1 for OAuth?" trailing note now that Trello / GCal / Gmail all have native v2 connect flows. Status panel copy updated to drop the "OAuth-heavy integrations are configured in v1" disclaimer.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`

- feat(ui): v2 ErrorBoundary + early data-ui/data-theme application [S]
  - **Why.** The 2026-05-09 TDZ bug rendered a black screen with no surfaced error because React unmounts on uncaught render exceptions and v2's :root tokens fall through to dark fallback bg with no content. Adding a top-level error boundary at AppV2's wrapper means render-time failures show a recoverable fallback instead of a dead app, AND the stack hits `/api/logs/client-error` for triage.
  - **`ErrorBoundary.jsx` + `.css`.** Class component (React error boundaries require classes). `getDerivedStateFromError` + `componentDidCatch`. Fallback UI: 🪃 + "Boomerang hit a snag" + collapsible details (message, stack, component stack) + Reload button (also unregisters service worker) + "Clear local state & reload" button (wipes localStorage with a confirm before doing so). All token-driven so it adapts to dark mode; falls back to inline defaults if `data-ui` somehow isn't set yet.
  - **`src/App.jsx` wiring.** v2 path wraps `<AppV2>` in `<ErrorBoundary>`. v1 stays unwrapped — legacy surface, no need to add behavior.
  - **`server.js` `/api/logs/client-error` endpoint.** Receives `{message, stack, componentStack, url, userAgent, appVersion}` from the boundary and prints to the server log via the `[CLIENT-ERROR]` prefix. Best-effort — no DB write, just visibility for triage.
  - **`index.html` early-paint script** now applies both `data-ui="v2"` (when not opted into v1) AND `data-theme` (when settings.theme is set, light OR dark) BEFORE React mounts. Without this, an error during AppV2's first render would show the boundary in light mode regardless of user preference, since data-ui was previously only set in AppV2's mount effect.
  - **Dark-mode audit.** Walked every v2 surface for hardcoded colors that wouldn't swap. All `var(--v2-*)` token references adapt cleanly. `#fff` text is always paired with `var(--v2-accent)` filled buttons (orange + white reads on both modes). Hardcoded RGB tints (alert-tinted card backgrounds, hover tints, etc.) are low-alpha and read on both modes. Active-state pattern (`background: var(--v2-text); color: var(--v2-bg)`) inverts cleanly across modes. No surface flagged for follow-up.
  - **Verification.** `npm run lint` clean. `npm test` smoke passes. Bundle: 762KB precache (up from 759KB).
  - New: `src/v2/components/ErrorBoundary.jsx`, `src/v2/components/ErrorBoundary.css`
  - Modified: `src/App.jsx`, `index.html`, `server.js`

- docs(v2): park "web push deprecation trial" decision for after v2 → main merge [XS]
  - Pushover is now the recommended primary on iOS but web push is still live with all its plumbing. Logged a parking-lot bullet that explicitly schedules a tap-rate / completion-rate review in Engagement Analytics 2 weeks post-v2-merge, with concrete go / no-go criteria and a rough scope estimate (~250-400 LOC net delete) if go.
  - Modified: `wiki/V2-State.md`

- feat(ui): v2 Integrations — Trello / GCal / Gmail connect flows ported out of v1 [M]
  - Removed the "Connect in v1" / "Manage in v1" punt for the three OAuth-style integrations. Each integration row now renders its own connect UI inline when not connected.
  - **Trello.** New `inline: 'trello-connect'` mode. Hint links to `trello.com/app-key`; "Enter credentials" reveals API key + Token password inputs. Connect button calls `trelloStatus()` to verify; on success populates the boards list. Disconnect button in the connected (`trello-config`) state clears `trello_api_key` + `trello_secret` and resets cached status.
  - **Google Calendar.** New `inline: 'gcal-connect'` mode. Hint links to Google Cloud console + shows the redirect URI to add. Client ID + secret inputs. Connect opens an OAuth popup via `gcalGetAuthUrl()`; the success callback posts `{type: 'gcal-connected'}` which a postMessage listener in the panel picks up to refresh status. Disconnect via `gcalDisconnect()`.
  - **Gmail.** New `inline: 'gmail-connect'` mode — reuses GCal credentials (same Google Cloud project, per Boomerang's existing pattern). One Connect button if creds set, else a "Configure Google Calendar credentials first" hint. Same popup + postMessage flow as GCal. Disconnect via `gmailDisconnect()`.
  - Action-button gate updated so all six new modes (`*-connect`, `*-config`) skip rendering the right-side "Connect/Manage in v1" fallback. Trello's `username` surfaces as the row's `sub` line when connected.
  - Fixes the "Settings → Integrations" section being unable to onboard new users without flipping back to v1.
  - Modified: `src/v2/components/SettingsModal.jsx`

- fix(ui): v2 Settings blocks have padding-top so labels don't butt against the divider above [XS]
  - `.v2-settings-block` was `padding-bottom: 24px + border-bottom` only — sibling blocks rendered their first label flush against the previous block's divider. Added `.v2-settings-block + .v2-settings-block { padding-top: 24px }` to give every non-first block breathing room.
  - Modified: `src/v2/components/SettingsModal.css`

- docs(v2): note terminal-flavored loading animations on the parking-lot terminal-theme bullet [XS]
  - The wordmark-wave from PR #58 is exactly the kind of ambient state-feedback that the terminal theme should preserve. Added an idea-bank sub-bullet to V2-State's terminal-aesthetic entry: ASCII spinner glyphs per letter, cursor blink on the trailing `_`, `[OK]/[ERR]/[BUSY]` bracketed flashes, `loading…` ellipsis cycling, output-line scroll. Same `animState` state machine drives a different visual vocabulary.
  - Modified: `wiki/V2-State.md`

- style(ui): v2 AI tab — Anthropic key UI moves to Integrations, AI shows pointer note [XS]
  - Anthropic key UI was duplicated across the AI tab (full editable block) and the Integrations row (which routed back to AI). Consolidated: Integrations row now embeds the editable block directly via a new `inline: 'anthropic'` mode; AI tab drops the full block and shows a one-line pointer ("Get a key at console.anthropic.com, then configure under Settings → Integrations") with a clickable inline link that flips active tab to Integrations. Fixes the visual cramming where the ANTHROPIC API KEY header was butted against the Custom-instructions Clear button.
  - `AnthropicKeyBlock` gains an `embedded` prop that strips the outer block wrapper + the redundant header/hint when rendered inside the Integrations row.
  - New `.v2-settings-inline-link` utility for tab-link-as-anchor styling.
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`

- fix(ui): v2 wordmark wave completes a full pass before restarting [S]
  - Bug. Fast syncs (saving → synced under ~200ms) flipped `data-sync-state` back to idle before the bounce wave reached the G — only the B and the first O ever moved.
  - Fix. Header now runs a small state machine: when saving starts, the visual state is held at "saving" for a minimum 1300ms (one full wave traversal + margin). If sync completes mid-wave, the green "just-synced" flash queues to fire after the hold, instead of clobbering the in-flight wave. Subsequent saves during the hold restart the timer cleanly.
  - Replaces the old `justSynced` boolean with an `animState` (`idle | saving | just-synced`) that's the single source of truth for wave / flash timing. `deriveSyncVisualState` reads animState, so the visible behavior matches the timing intent regardless of how quickly the underlying sync resolves.
  - Modified: `src/v2/components/Header.jsx`

- style(ui): v2 labels back to flex-wrap (5-wide grid was wrong for dynamic content) [XS]
  - Reverted PR #56's 5-column grid: with variable label counts the last row's leftover chips stretched to 1fr each (looked busted), and ellipsis-truncating long custom names ("low-energy", "phone-call") was unfriendly. Back to flex-wrap with content-sized chips. Kept the energy-type chip typography (12px font, 32px height, lowercase) so labels still read as the same kind of control as the energy chips above; just no rigid column grid.
  - `title` attr on each chip from PR #56 stays (harmless, useful as accessible name).
  - Modified: `src/v2/components/AddTaskModal.css`

- style(ui): v2 labels grid → 5 wide to match energy-type row [XS]
  - `.v2-form-label-grid` switched from flex-wrap to `grid-template-columns: repeat(5, minmax(0, 1fr))` and chips picked up the energy-type sizing (12px font, 0 8px padding, 32px height, gap 4px). Same width math, same lowercase aesthetic. Long custom-label names ellipsis-truncate; full name available via `title` attribute.
  - Modified: `src/v2/components/AddTaskModal.css`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/EditTaskModal.jsx`

- style(ui): v2 energy-type row fits all five chips on a single line [XS]
  - Was wrapping to two rows on iPhone (`desk / people / errand` then `creative / physical`). New layout: `flex: 1 1 0` per chip with `min-width: 0` so they share equal slices of the row, smaller font (12px) + tighter padding (0 8px) + height 32px + gap 4px. Five-chip width fits ≤375px viewports without ellipsis. `flex-wrap: nowrap` enforces one line.
  - Modified: `src/v2/components/AddTaskModal.css`

- style(ui): v2 chip controls — energy type matches energy drain shape, lowercase chip text [XS]
  - Energy type pills now share the `.v2-form-seg` shape: full pill (`var(--v2-radius-pill)`), 36px height, flex-wrap layout (was 96px-min grid columns with rounded-rect 10px corners). The per-type color treatment in the active state still distinguishes Desk / People / Errand / Creative / Physical via inline border + text colors.
  - Added `text-transform: lowercase` to both `.v2-form-seg` and `.v2-form-energy-pill` so all chip controls read like the user's lowercase labels (Status / Size / Energy type / Energy drain).
  - Modified: `src/v2/components/AddTaskModal.css`

- fix(ui): v2 date input collapses with `appearance: none` — force block + min-height [S]
  - PR #52 stripped iOS Safari's native `<input type="date">` chrome to fix the overflow into Priority. Side effect: with native chrome gone, iOS gives an empty date input zero intrinsic dimensions, so the rendered border collapsed to padding-only and no longer matched the Priority button's width.
  - Fix: `display: block` forces it out of inline layout (where iOS computes width against content); explicit `min-height: 44px` matches `.v2-form-pri-toggle` so the row aligns vertically too. Cleaned up a duplicate `min-width: 0` block while editing.
  - Modified: `src/v2/components/AddTaskModal.css`

- fix(ui): v2 EditTaskModal — strip native date-input chrome + unified add-pill style [S]
  - **Due/Priority STILL overlapped** despite the `minmax(0, 1fr)` fix in PR #51. Root cause was iOS Safari rendering native chrome on `<input type="date">` that bleeds *outside* the styled border into the adjacent grid column. `-webkit-appearance: none; appearance: none;` on `.v2-form-input` strips the native UI and leaves only the styled box; the picker still triggers on tap.
  - **Add-affordance pills were inconsistent.** "+ Add checklist" (dashed, transparent), "Attach files" (gray-fill), "Notion" (gray-fill), "+ Add comment" (gray-fill) — three different visual treatments for four structurally-identical "tap to add" empty-state pills. New shared `.v2-edit-add-pill` class with the dashed-border treatment; applied to all four. Existing `.v2-edit-checklist-new` aliased to the same selector to keep the original markup working.
  - **Verification.** `npm run lint` clean. `npm test` smoke passes. Bundle: 752KB precache (unchanged).
  - Modified: `src/v2/components/AddTaskModal.css`, `src/v2/components/EditTaskModal.css`, `src/v2/components/EditTaskModal.jsx`

- fix(ui): v2 EditTaskModal — Due/Priority overlap + Checklists empty-collapse + Connections moves up [S]
  - **Due/Priority overlap (iOS Safari).** `.v2-form-row` was `grid-template-columns: 1fr 1fr`. `1fr` is shorthand for `minmax(auto, 1fr)`, where `auto` falls back to the cell's intrinsic content size. iOS Safari's `<input type="date">` has a wide intrinsic content size when filled (~150px+), which expanded the Due column past its half-share and overlapped the Priority column. Fix: `minmax(0, 1fr) minmax(0, 1fr)` lets columns shrink below intrinsic. Added `min-width: 0` to `.v2-form-input` / `.v2-form-textarea` defensively.
  - **Checklists section empty-collapse.** CHECKLISTS label only renders when at least one checklist exists. Empty state is just the "+ Add checklist" pill with the tighter `.v2-form-section-compact` margin. Same pattern Attachments / Comments / Connections already use.
  - **Connections moved up.** Block now sits between Attachments and Labels (instead of below Comments). Groups the three "linking content" affordances together: Checklists / Attachments / Connections. Comments stays where it is — it's a task-internal thread, not external linking.
  - **Verification.** `npm run lint` clean. `npm test` smoke passes. Bundle: 752KB precache (unchanged).
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/AddTaskModal.css`

- fix(ui): v2 header trim + EditTaskModal density pass [M]
  - **Why.** Two surfaces became dense as v2 polish piled on. Header had 7 right-side affordances pushing the More button off-screen on iPhone (Settings unreachable). EditTaskModal had Notes pills overlapping DUE labels, Attachments pills bleeding into Energy buttons, an oversized "Convert to routine" full-width button, and unbalanced bottom action row with Delete styled as a loud destructive primary.
  - **Header — animated wordmark replaces sync icon.** Each letter of "BOOMERANG" wraps a span with a per-letter animation delay (60ms stagger). `data-sync-state` on the wordmark drives: `idle` (default), `saving` (staggered Y-bounce, 1100ms loop), `just-synced` (700ms green flash on saving→synced transition), `degraded` (yellow letters when queue is building / SSE reconnecting), `offline` (red letters steady). Removed the cloud / cloud-off icon entirely.
  - **Header — brand-tap popover.** Wordmark is a button now. Tap reveals a popover anchored under the brand with MiniRings (full-size, since they're not crammed into the header strip anymore), today-count shortcut, sync-status text. MiniRings + cloud icon removed from the always-visible header. Frees four slots; More button reachable again.
  - **Header — kept inline.** Today pill (count + "today" label) survives because it's actionable. What now? / + / Sparkles / Package / More cluster fits comfortably.
  - **EditTaskModal — Notes pills moved out of the textarea wrap.** Polish + Research no longer absolute-positioned at the textarea's bottom-right. New `.v2-edit-notes-toolbar` flex row below the textarea uses the `-inline` ai-pill variant. No more overlap with typed text or the next form section.
  - **EditTaskModal — Attach pills go inline.** Attach files / Extract text use `-inline` so they don't escape into surrounding sections.
  - **EditTaskModal — empty sections collapse.** ATTACHMENTS / COMMENTS / CONNECTIONS labels only render when the section has content (or is explicitly opened). Empty state is just the inline "+ Attach files" / "+ Add comment" / "Notion" pill, with a tighter `.v2-form-section-compact` margin so empty sections don't pad out the modal.
  - **EditTaskModal — Convert to routine compacted.** Big full-width dashed button gone. Trigger is a small "Make recurring" pill in the bottom action shelf (RotateCw icon). Cadence picker only renders when actively converting, then disappears after Convert / Cancel.
  - **EditTaskModal — bottom action row rebalanced.** All four pills (Backlog / Projects / Make recurring / Delete) share the neutral `.v2-edit-action` style. Delete only goes loud-red on confirm via `v2-edit-action-confirm-yes`. Row is `justify-content: center` so they spread evenly instead of packing left.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke passes. Bundle: 752KB precache.
  - Modified: `src/v2/components/Header.jsx`, `src/v2/components/Header.css`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/v2/components/AddTaskModal.css`

- feat(ai): polish suggests checklists + labels; next-up toast follow-up-aware [M]
  - **Why.** Two enhancement requests. (1) Polish was just a notes rewrite — it didn't notice when notes described a multi-step process that should become a checklist, or when content matched an existing label. (2) Next-task suggestion on complete used a flat heuristic (high-pri / due-today / size) without considering follow-up signals like same routine, same Notion page, shared tags, or "follow up: X" titles.
  - **Polish enhancements.** `polishNotes(title, rawNotes, availableLabels)` now also returns `suggestedChecklist: { name, items: [{text}, …] } | null` and `suggestedLabels: [labelName, …]`. The system prompt tells the AI to only suggest labels that match exactly from the provided list (never invent), and to suggest a checklist only when the notes describe a multi-step process. Both fields are optional — old behavior preserved for callers that ignore them.
  - **`useTaskForm.handlePolish`.** Loads `availableLabels` and threads them to the API. On response, applies suggested labels by case-insensitive name match against the user's existing labels (never adds new label rows). Stores the proposed checklist on `form.suggestedChecklist` for the consumer to apply. Surfaces a `polishApplied` summary so the UI can confirm what changed.
  - **v2 EditTaskModal — apply UI.** Soft-purple "Polish added X labels" pill plus a checklist suggestion row with an "Apply" button (consumes the suggestion + appends to checklists) and a ✕ dismiss. AddTaskModal shows the labels-applied note + a "Save and reopen to apply checklist" hint (no checklist field at create time).
  - **v1 EditTaskModal — auto-apply.** v1's `handlePolish` now applies suggested labels the same way and auto-inserts the suggested checklist when the task has none yet (v1 has no apply UI, so auto-apply is the cleanest behavior).
  - **Next-up follow-up scoring (v2).** Base score (high_priority +100 / due-today +50 / XS-S +20) preserved. New follow-up signal capped at +90 total: `+40` same `routine_id` (next instance of same recurring task), `+25` same `notion_page_id` (same doc context), `+30` per shared tag (capped at +60), `+35` if title contains follow-up keyword (`follow up`, `follow-up`, `next step`, `reply to`, `respond to`, `after `), `+50` if title mentions the completed task's title verbatim. The cap means a wildly-overdue stranger task can still beat a same-tag low-pri future task — follow-up tunes the order, doesn't dominate.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 750KB precache (up from 746KB).
  - Modified: `src/api.js`, `src/hooks/useTaskForm.js`, `src/v2/AppV2.jsx`, `src/v2/components/AddTaskModal.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `src/components/EditTaskModal.jsx`

- fix(ui): v2 version-refresh modal [S]
  - **Why.** v2's `onVersionMismatch` handler unregistered the service worker and triggered `window.location.reload()` after 1s, but rendered no UI between detection and reload. Users on slow connections saw the page seemingly hang then snap-reload — the v1 `update-modal` ("Update available: v0.99 · Refreshing automatically… [Reload now]") wasn't ported.
  - **`v2-update-overlay` + `.v2-update-modal`.** New full-viewport overlay (z-index 9999, fade-in) holding a centered modal with the version label, "Refreshing automatically…" subtitle, and an explicit "Reload now" button for users who don't want to wait the 1s. Service-worker unregister still fires either way.
  - **`checkVersion` polling.** Wired the version-check trigger v1 has — opening any of Settings / Done / Analytics / Routines / Activity Log / Packages / Projects / Adviser / Add / WhatNow / EditTask / MarkdownImport polls `checkVersion()`, which surfaces a stale-client modal without waiting for the next SSE round-trip.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 746KB precache (unchanged).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`

- feat(routines): "Skip this cycle" button on expanded routine cards [S]
  - **Why.** Vacation, illness, the lawn doesn't need mowing this week — there was no way to advance a routine's cadence without spawning a task and immediately completing it. Now there's a fast-forward button next to the "+" spawn-now control.
  - **Behavior.** Stamps `completed_history` with today's ISO timestamp, which makes `getNextDueDate()` roll forward by one cadence interval. Skips count toward the "Nx completed" total — close enough for a personal app, no separate skip log needed.
  - **UI.** Only shows on non-paused routines (paused routines don't have a current cycle to skip). Title text: "Skip this cycle (advance schedule, no task)".
  - Added: `skipCycle` to `useRoutines.js`, `onSkipCycle` prop wiring through `App.jsx` → `Routines.jsx` → `RoutineCard`.
  - Cherry-picked from main onto dev as part of the v2 → main milestone merge (2026-05-09).
  - Modified: `src/hooks/useRoutines.js`, `src/components/Routines.jsx`, `src/App.jsx`, `CLAUDE.md`, `wiki/Features.md`

- chore(server): delete orphan API routes + dead client wrappers [S]
  - Post-wipe-incident orphan sweep: 4 routes had no callers, 3 client wrappers had no callers. Deleting now to shrink the surface area before someone wires them to something fragile.
  - **Routes deleted (server.js):** `PATCH /api/data/:collection`, `DELETE /api/data`, `POST /api/weather/clear-cache`, `POST /api/trello/sync`. The first two were bulk-blob escape hatches from before the per-record API took over; `weather/clear-cache` was an early debugging endpoint; `trello/sync` is single-list while the working code uses `trello/sync-all-lists`.
  - **Client wrappers deleted (src/api.js):** `trelloSyncCards`, `serverFetchTasks`, `fetchPackage`. None had callers anywhere in `src/` or `public/`.
  - **Kept:** `clearAllData()` in `db.js` is still used by `seed.js`; `clearWeatherCache()` is still used internally on weather-location changes.
  - Cherry-picked from main onto dev (final-mile cleanup, 2026-05-09).
  - Modified: `server.js`, `src/api.js`, `wiki/Architecture.md`

- refactor(db): drop legacy `task.checklist` serialization [S]
  - Migration 018 emptied the legacy flat `checklist_json` column months ago and replaced it with the named `checklists_json` (multi-list) format. The serialization paths still wrote `task.checklist || []` on every upsert and the read path still parsed it into a `checklist` field on every row → JS object trip. Pure cleanup.
  - Removed: `task.checklist` reads/writes in `db.js` `taskToRow`/`rowToTask`/`UPSERT_TASK_SQL`, the `checklist: []` default in `src/store.js` `createTask`, the legacy fallback wrapper in `src/components/TaskCard.jsx`, the legacy migrate-on-read in `src/components/EditTaskModal.jsx`, the inert `checklist_json: '[]'` in `gmailSync.js`'s task constructor.
  - **Column kept.** `checklist_json` stays in the schema (SQLite column drops are painful). It's inert — never read, never written. Existing rows retain their `'[]'` value via the schema default.
  - Cherry-picked from main onto dev (final-mile cleanup, 2026-05-09).
  - Modified: `db.js`, `gmailSync.js`, `src/store.js`, `src/components/TaskCard.jsx`, `src/components/EditTaskModal.jsx`

- feat(ui): v2 MarkdownImportModal + skip ExtendModal/FindRelatedModal as superseded [S]
  - **Why.** Final polish item from V2-State. v1 has three "rare flow" modals — Extend (date preset shortcut), FindRelated (Notion search to link a task), MarkdownImport (bulk task creation from markdown). Audit found Extend + FindRelated are redundant in v2: EditTaskModal's date input already covers Extend's use case, and the inline Notion search in EditTaskModal Connections (PR #36) already covers FindRelated. MarkdownImport is the only one with an actual gap.
  - **`MarkdownImportModal.jsx` + `.css`.** Direct port of v1's component into v2 idiom — wide ModalShell, paste-or-upload first step, preview-and-toggle-tasks second step, "Import N task(s)" CTA. Uses the existing `parseMarkdown` util. Bullets (`- item`), checkboxes (`- [ ] item`), and section headings (`## Section`) all supported; headings become group labels on each parsed task.
  - **More menu wiring.** New "Import from markdown" row in the v2 More menu (Upload icon). State + render wired in AppV2 with the same shape as other secondary modals.
  - **Extend + FindRelated explicitly skipped.** V2-State updated to mark both as "superseded by existing v2 flows" rather than pending. If a future workflow re-introduces a need for fast-preset extending or standalone Notion-search, they can land then.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 746KB precache (up from 743KB).
  - New: `src/v2/components/MarkdownImportModal.jsx`, `src/v2/components/MarkdownImportModal.css`
  - Modified: `src/v2/AppV2.jsx`, `wiki/V2-State.md`

- feat(ui): v2 Analytics — adaptive-throttle 👍/👎 feedback chips [S]
  - **Why.** Analytics polish item from V2-State. v1 surfaced a row of back-off decisions ("Push overdue: 1.0× → 1.5×") with thumbs-up / thumbs-down buttons letting users approve or revert auto-tuning; v2 had no surface, so users couldn't curate the adaptive throttle from v2 at all.
  - **New section.** "Adaptive throttle decisions" at the bottom of v2 Analytics, only renders when there are unreviewed decisions in the last 30 days. Hairline list with channel chip (capitalized), type label, multiplier-before → multiplier-after, decision date, and 👍 / 👎 chip buttons.
  - **Wiring.** `getThrottleDecisions(30)` loads on modal open + after each feedback action; `markThrottleFeedback(id, 'up'|'down')` records the answer. Both functions are dynamic-imported so the test surface stays light.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 743KB precache (up from 741KB).
  - Modified: `src/v2/components/AnalyticsModal.jsx`, `src/v2/components/AnalyticsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 routine suggestion banner [XS]
  - **Why.** `useNotionSync` was already returning `routineSuggestions` / `dismissSuggestion` / `acceptSuggestion` to v2 (PR #31's wiring), but v2 wasn't rendering the suggestion banner — the recurring-pattern detection ran but had no surface.
  - **Banner.** New `.v2-routine-suggestions` row between the TaskListToolbar and the task list. Each suggestion shows "Create routine: **Title** [cadence chip]" with a primary Create button (calls `addRoutine(...)` then `acceptSuggestion`) and a ✕ dismiss button. Soft purple background matches v1's coloring for the banner.
  - **Search-aware.** Hidden when search mode is active so the search results view stays focused.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 741KB precache (up from 740KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `wiki/V2-State.md`

- feat(ui): v2 Notifications — Email deliverability + weather notification toggles [S]
  - **Why.** Three notifications-tab items grouped under one V2-State bullet. Until now `email_from_name`/`email_from_address`/`email_batch_mode`/`weather_notifications_enabled`/`weather_notif_push`/`weather_notif_email` were all v1-only; users had to flip back to v1 to override From, enable batch mode, or toggle weather alerts.
  - **Email deliverability block.** Two compact `.v2-settings-row` entries with `.v2-settings-compact-input-wide` (140px right-aligned) for From name + From address. Batch-mode toggle below with explainer ("Bundles eligible notifications into a single digest-style email instead of sending one per event"). All three gated on `email_notifications_enabled === true`.
  - **Weather notifications block.** Master toggle (gated on `weather_enabled` so it disables when no location is set) + per-channel push/email toggles (gated on the master + each channel's master). Same Toggle-row pattern the rest of the panel uses.
  - **Trailing pointer narrowed.** Now points users at digest schedule + style, adaptive throttling 👍/👎 feedback chips, and Pushover priority routing helper as the only remaining v1-only Notifications surfaces.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 740KB precache (up from 737KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `wiki/V2-State.md`

- feat(ui): v2 EditTaskModal — 7-day forecast widget + weather-hidden + GCal duration override [S]
  - **Why.** Three power-user EditTaskModal items grouped under one V2-State bullet. v2 had no forecast widget on outdoor tasks, no per-task weather hide control, and no GCal-duration override (the size-mapping default was the only value users could get).
  - **Forecast widget.** Reuses the shared `WeatherSection` + `resolveWeatherVisibility` from v1 (no v2 fork needed — they're presentation-pure). Shows when `weather.enabled` and `forecast.days.length > 0` and the task qualifies (outdoor energy / matching keyword / tagged outside). Drawer mode renders a collapsed "🌤 7-day forecast" toggle button that expands inline.
  - **Per-task hide.** Checkbox below the forecast (or inside the drawer) writes `task.weather_hidden`. Same flag used to suppress weather chips on TaskCard.
  - **GCal duration override.** Number input (5-480 minutes, step 5) appears in its own form section when a due date is set. Placeholder shows the size-derived default (XS=15 / S=30 / M=60 / L=120 / XL=240). Empty value falls back to size mapping at sync time.
  - **Wiring.** AppV2 passes the existing `weather` hook value as a prop to EditTaskModal. `weather_hidden` and `gcal_duration` are persisted in `handleSave` so the changes round-trip through `updateTask`.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 737KB precache (up from 735KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `wiki/V2-State.md`

- feat(ui): v2 header chrome — MiniRings + done-today + sync indicator + keyboard shortcuts [M]
  - **Why.** Two polish items from V2-State, both daily-visibility. v2 had no MiniRings (opens Analytics in v1), no done-today counter (opens DoneList in v1), no sync status indicator (saving/offline/synced cloud icon), and no keyboard shortcut wiring. Bundled together since the keyboard shortcuts also touch the header (helper modal + Esc closing).
  - **Header stats cluster.** New `.v2-header-stats` slot between brand and primary actions. Renders MiniRings (24px SVG with the same daily-task / daily-points / streak-divided-by-7 progress arcs v1 uses), a "today" pill (count + label, falls back to a "Done" link when no completions today but some history), and a sync icon (`Cloud` for saving/synced, `CloudOff` for offline; pulsing accent-colored animation while saving; alert-red while offline; subtle green while synced). Mobile collapses the "today" label to the bare count; wordmark hides ≤380px to make room.
  - **Keyboard shortcuts.** Wired `useKeyboardShortcuts` in AppV2: `n` new, `/` search, `j/k` navigate, `e/Enter` edit, `x` complete, `s` snooze, `Esc` close, `?` help. Computed a flat `visibleTasks` list (doing → stale → up-next → waiting → snoozed → backlog → projects) gated on `isDesktop`. v2 TaskCard accepts a new `selected` prop that adds `.v2-card-selected` (accent-colored border + soft glow). KanbanBoard threads `selectedTaskId` through to its inner Column for the desktop drag-drop surface.
  - **Modal-stack-aware Esc.** AppV2 builds an `activeModals` array each render in deepest-first order (snooze < reframe < edit < add < whatnow < settings < projects < done < activitylog < routines < packages < adviser < analytics < menu < search) and `closeTopModal` pops the deepest one. Same pattern v1 uses; lets `Esc` traverse stacked surfaces predictably.
  - **`?` help dialog.** New ModalShell at `showHelp` rendering a hairline list with `<kbd>` chips per shortcut. Toggleable via the `?` key.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 735KB precache (up from 732KB).
  - Modified: `src/v2/AppV2.jsx`, `src/v2/AppV2.css`, `src/v2/components/Header.jsx`, `src/v2/components/Header.css`, `src/v2/components/TaskCard.jsx`, `src/v2/components/TaskCard.css`, `src/v2/components/KanbanBoard.jsx`, `wiki/V2-State.md`

- feat(ui): v2 Integrations — Notion parent-page sync configuration [S]
  - **Why.** Last item on the v2-medium-priority list. v2 had no UI for picking the Notion parent page that drives pull-sync — users had to flip back to v1 to set or change it. Now the Notion row exposes a parent-page picker inline.
  - **`inline: 'notion-config'` mode on the Notion row** (when connected). Unconfigured state: search input + Search button. Calls `notionSearch(query)`; results render in the same hairline scroll list pattern Weather + Trello pickers use. Picking a result writes `notion_sync_parent_id` + `notion_sync_parent_title` and immediately fetches `notionGetChildPages(id)` to surface the child count.
  - **Configured state.** "📄 Syncing from **Page name**" with child count + last-sync timestamp underneath; "Change page" button to clear and re-pick. The Sync-now button on the row continues to fire `syncNotion()` (already wired via PR #31).
  - **Mount-time hydration.** New effect re-fetches the child-page count on settings open whenever a parent ID is configured + Notion is connected. Cleanup-flag pattern matches the other status-gated lazy loaders in the panel.
  - **Database sync** (querying a Notion database directly rather than walking a parent's children) deferred — that's a separate config flow with its own quirks.
  - **All seven medium-priority items now done.** Channel test buttons + notification history (PR #33), weather geocode (PR #34), EditTaskModal Comments/Research/Attachments/Extract-Text (PR #35), Notion link/create on tasks (PR #36), Trello/GCal/Gmail picker UIs (PR #37), and Notion DB sync config (this PR). V2-State TL;DR updated.
  - **Verification.** `npm run lint` clean. `npm test` smoke test passes. Bundle: 732KB precache (up from 729KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `wiki/V2-State.md`

- feat(ui): v2 Integrations — Trello board/list, GCal calendar, Gmail scan-window pickers [M]
  - **Why.** Final piece of the v2-Integrations medium-priority list. Connected Trello/GCal/Gmail rows previously just showed status + a "Manage in v1" button. Now they expose the most-touched settings inline so users don't need v1 for daily picker tweaks.
  - **Trello config.** When `statuses.trello.connected` is true, the row's inline area shows a Board dropdown (loaded once via `trelloBoards()`) and — once a board is picked — a Default list dropdown (loaded via `trelloBoardLists(boardId)` whenever the board changes). Picking a board resets the list selection. Multi-list sync checkboxes deferred; the per-task list picker in EditTaskModal still lets users override per push.
  - **GCal config.** Calendar dropdown loaded via `gcalListCalendars()`; renders calendar `summary` with "(Primary)" suffix where applicable. Push / Pull toggles for `gcal_sync_enabled` / `gcal_pull_enabled`, each as a `.v2-integrations-toggle-row` (label-left + iOS-style toggle right). Status filter checkboxes deferred — sensible defaults (all active statuses) cover the common case.
  - **Gmail config.** Auto-scan toggle + scan-window number input (1-30 days, default 7). Same row pattern as GCal toggles.
  - **Status-gated lazy loading.** All three pickers fetch data only when their integration is connected, with cleanup flags to avoid setting state on unmount mid-fetch. Cancellable via `cancelled` closure. Failures are silent (status dot already telegraphs disconnection).
  - **Right-column action button.** Hidden for any integration whose `inline` mode is non-null — the new picker UIs replace the "Configure / Manage in v1" button. Updated the gate from a 2-mode list to a 5-mode allow-list.
  - **CSS.** New `.v2-integrations-toggle-row` (flex space-between, label-left + control-right) for the GCal/Gmail toggle pairs.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 729KB precache (up from 725KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

- feat(ui): v2 EditTaskModal — Notion link + create [S]
  - **Why.** Per-task Notion linking was the last piece of v1's EditTaskModal "Connections" panel that v2 didn't carry. `useTaskForm` already had the full handler set (`notionState`, `notionResult`, `handleNotionSearch`, `handleNotionCreate`, `handleNotionLink`, `setNotionResult`) — they just had no v2 render path.
  - **New Connections section** between Comments and the action row. Initial state shows a "Notion" pill button (disabled if title is empty). Clicking calls `handleNotionSearch(title, notes)` → `suggestNotionLink` server-side. While searching, a spinner row reads "Searching Notion…". On error: red message + Retry pill.
  - **Suggestions list.** Server returns matched pages via AI similarity; v2 renders them as a hairline list of full-width buttons. Picking one calls `handleNotionLink(page)` → notionResult populated → linked-pill state.
  - **Create new.** Falls through if no good match: "Create new Notion page" pill calls `handleNotionCreate()` → server creates the page with the task's title/notes/labels → notionResult populated.
  - **Linked state.** Shows "Notion ↗" pill linking to `notionResult.url` with a ✕ unlink. Unlinking just clears `notionResult` locally — the actual Notion page stays put; the task simply stops tracking it.
  - **Persistence.** `handleSave` payload includes `notion_page_id: form.notionResult?.id || null` and `notion_url: form.notionResult?.url || null`. Same shape v1 saves; ongoing sync (`useExternalSync`) picks up the link automatically.
  - **`v2-form-ai-pill-static`.** New CSS class to opt out of the default `position: absolute` on `.v2-form-ai-pill`. Lets the pill sit inline in the Connections row alongside other pills.
  - **Note.** "DB sync configuration" (parent-page picker, database picker) split off into its own pending bullet for a future PR — that's a Settings flow with a different shape than the per-task link UI.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 725KB precache (up from 722KB).
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `wiki/V2-State.md`

- feat(ui): v2 EditTaskModal — Comments, AI Research, Attachments, Extract-Text [M]
  - **Why.** Common power-user features in v1's EditTaskModal that v2 didn't carry — users had to flip back to v1 to attach files, run AI research on a task, extract text from PDFs/images, or thread comments. Medium-priority item knocked off in one PR since they all live in the same modal.
  - **Research.** New "Research" pill next to "Polish" in the Notes action row. Click toggles an inline prompt input + Go button. Submitting calls `researchTask(title, notes, prompt, attachments)` and replaces notes with the AI-augmented version. State + handler live inline in EditTaskModal v2 (not in `useTaskForm`) since AddTaskModal doesn't surface Research.
  - **Attachments.** New section between Checklists and Labels. Reuses the `useTaskForm` attachments support (`attachments` / `handleFileSelect` / `removeAttachment` / `formatFileSize` / `attachError` / `extracting` / `handleExtractText`) which was already present but never rendered in v2. File picker accepts images/PDF/text formats; 5MB total cap; hairline-bordered list with name + size + ✕ remove per item.
  - **Extract Text.** When ≥1 attachment is present, an "Extract text" pill appears next to "Attach files." Calls `extractAttachmentText(attachments)` and appends the AI-extracted text to the existing notes (preserves the user's manual notes; doesn't overwrite).
  - **Comments.** New section between Make-recurring and the action row. Each comment is `{id, text, created_at}` (same shape v1 saves). List shows comment text + relative timestamp + ✕ remove per item. Input + Add button at the bottom; Enter also adds. Collapsed by default for tasks with no comments — "+ Add" affordance opens it.
  - **Persistence.** `handleSave` payload now includes `attachments: form.attachments` and `comments` so the changes round-trip through the existing `updateTask` path. Same data shape v1 uses, so cross-UI parity is preserved.
  - **Action-pill positioning.** v2's `.v2-form-ai-pill` was previously absolute-positioned solo at bottom-right of the textarea wrap. New `.v2-edit-notes-actions` flex container holds Polish + Research at `position: absolute; bottom: 8px; right: 8px`, with the pills inside reset to `position: static` so they flow side-by-side cleanly.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 722KB precache (up from 717KB).
  - Modified: `src/v2/components/EditTaskModal.jsx`, `src/v2/components/EditTaskModal.css`, `wiki/V2-State.md`

- feat(ui): v2 weather location picker in Integrations [S]
  - **Why.** Medium-priority item from V2-State. v2 had no surface for setting the weather location at all — users had to flip back to v1 just to point Boomerang at a city/zip. Open-Meteo is keyless so this is purely a geocode + setting-write flow.
  - **New `inline: 'weather'` row in IntegrationsPanel.** When unconfigured, shows a search input + Search button; Enter submits. Results render as a hairline-bordered scroll list with the geocoded `label` (city, region, country) per item. Picking a result writes `weather_latitude`, `weather_longitude`, `weather_location_name`, `weather_timezone` and flips `weather_enabled` on if it wasn't, then forces a server cache refresh so the badges/forecast update without a full reload.
  - **Configured state.** "📍 Location name" line + a "Change location" button that clears the lat/lon/name and disables `weather_enabled`, returning the row to the search state.
  - **Connection dot.** Weather row's status dot lights green when both `weather_enabled` is true and `weather_latitude` is set.
  - **Verification.** `npm run lint` clean (warnings only). `npm test` smoke test passes. Bundle: 717KB precache (up from 715KB).
  - Modified: `src/v2/components/SettingsModal.jsx`, `src/v2/components/SettingsModal.css`, `wiki/V2-State.md`

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
