# Loops + Notifications — work plan

Five items, grounded in the actual code as of 2026-06-13. Loop interaction
answers are baked in (Spawn + Skip only; **no** "do-it-now / reset clock", **no**
Snooze). This file is self-contained so it can be carried into a fresh chat.

---

## 1. Surface loop quick-actions on the Loops page — **Spawn task now** + **Skip cycle**

Both already exist as `spawnNow` and `skipCycle` in `src/hooks/useRoutines.js`.
Today they're only reachable inside the buried `RoutinesModal` list (expand a row
→ tap a button). AppV2 already hands `onSpawnNow` / `onSkipCycle` to that modal —
they just need threading out to the Kept surface.

- Thread `onSpawnNow` + `onSkipCycle` through `KeptShell` / `KeptDesktop` →
  `LoopsView` → `LoopDetail`.
- **Swipe** (the "slider"): wrap each `LoopsView` card in a loop-flavored swipe
  (same mechanic as `RowSwipe` / `useSwipeActions`) revealing **Spawn** (gold) +
  **Skip**, with a brief ✓ confirmation like the modal's spawn feedback.
- **Buttons on tap**: add a "Spawn now" + "Skip cycle" action row to `LoopDetail`
  (under the rally / best / lifetime stat cards) so the tap-through destination
  carries them too.
- `spawnNow` returns an **array** → route through `addSpawnedTasks` exactly as
  AppV2's existing `onSpawnNow` wrapper does.
- **Gardyn case note:** spawn today → complete that task → the cycle's clock
  resets on completion. So Spawn alone covers "run it today, the month resets"
  once it's no longer buried. (This is why "do-it-now / reset clock" was dropped —
  it's redundant with spawn-then-complete.)

**Files:** `src/kept/LoopsView.jsx`, `src/kept/LoopDetail.jsx`,
`src/kept/KeptShell.jsx`, `src/kept/KeptDesktop.jsx`, a small loop-swipe (reuse
`src/hooks/useSwipeActions.js`), `src/kept/shell.css`.

---

## 2. Fix the smashed Edit-loop header

The form (`RoutineForm`) renders its own `← Back to {noun}s` pill stacked directly
under ModalShell's chrome (back arrow + "Edit loop" title) — that's the collision
in the screenshot.

- Remove the redundant in-form `v2-routine-back` pill; ModalShell's close
  affordance is the single exit.

**Files:** `src/components/RoutinesModal.jsx`, `src/components/RoutinesModal.css`.

---

## 3. Save / Cancel returns to the Kept loops page, not the leftover internal list

The "v2 page that happens to be left over" is `RoutinesModal`'s own internal
`list` view (the "Loops · 12 active" screen). When the form is reached from Kept
(via `editRoutineId` / `openToForm`), Save currently does `setView('list')` and
dumps the user there.

- Track whether the modal opened **directly into the form**. If so, Save and
  Cancel call `onClose()` (back to the Kept loops page). Only forms reached from
  the modal's own internal list return to the list.

**Files:** `src/components/RoutinesModal.jsx`.

---

## 4. Loop auto-completes + gets counted when its task(s) are done

Reported gap: the loop card "stays visible/uncrossed AND doesn't get counted as
done on the loops page." The cadence clock **does** advance
(`handleComplete → completeRoutine` stamps `completed_history`), but the card's
done-state (`doneToday`, from `historyByDay(completed_history)`) and the Today
"Loops `{done}/{total}`" header aren't reliably flipping when the task is
completed from the **main task list** rather than by tapping the loop's own check.

- Reconcile the two completion paths so they agree: the loop-card done indicator
  and the count must derive from the same evidence a spawned-task completion
  writes.
- **Prime suspect to verify at implementation time:** a timezone bucketing
  mismatch between `historyByDay` and `localYMD`. The toggle path
  (`toggleHabitDay`) writes `${day}T12:00:00.000Z` (noon UTC); `handleComplete`/
  `completeRoutine` write real-time ISO (`new Date().toISOString()`). An
  off-by-one in bucketing would explain "advanced but not crossed."
- Stacks already close on last-member clear; this fix targets **ordinary cadence
  loops**.

**Files:** `src/kept/TodayView.jsx`, `src/kept/heatmapUtils.js` (bucketing),
possibly `src/AppV2.jsx` (`toggleHabitDay` / `handleComplete` alignment).

---

## 5. Notifications never stay read — **(root cause confirmed)**

"Read" is conflated with the engagement-analytics `tapped_at` field. The bug is
threefold:

1. `markAllRead` in `NotificationsModal.jsx` **only mutates local React state —
   it never calls the server.** On reopen, `getNotifLog` refetches server rows
   where nothing was persisted → everything is unread again.
2. `tapped_at` is keyed by `task_id` + `channel`, so **task-less notifications**
   (weather, pile-up, generic) can never be marked read at all.
3. Even per-row taps only persist for task-bearing rows, and stamping `tapped_at`
   for a passive "I glanced at the center" pollutes engagement analytics.

**Fix — give notifications a real, persisted read flag separate from `tapped_at`:**

- **Migration `036_notification_read_at.sql`**: add `read_at TEXT` to
  `notification_log`. (Rides the same table, which already survives bulk wipes
  per the durability rules, so read-state syncs across devices.)
- **`db.js`**: `markNotifEntriesRead(ids)` + `markAllNotifsRead()`; `listNotifLog`
  returns `read_at`.
- **`server.js`**: `POST /api/notifications/log/read` (body `{ ids }` or
  `{ all: true }`), stamping `read_at` by log-entry id. (No Dockerfile change —
  migrations are already covered by the existing `COPY migrations ./migrations`
  line.)
- **`src/api.js`**: `markNotifsRead(...)`.
- **`src/components/NotificationsModal.jsx`**: `handleTap` and `markAllRead` call
  the new endpoint; "unread" keys off `read_at`; the bell badge follows it. The
  existing `markNotificationTap` stays for analytics on real task taps.

**Files:** `migrations/036_notification_read_at.sql`, `db.js`, `server.js`,
`src/api.js`, `src/components/NotificationsModal.jsx`.

---

## Suggested shipping order

Independent, so each can be its own PR through the normal dev → main path.

- **Batch one (low-risk, self-contained):** (5) notifications read-state +
  (2)+(3) edit-modal fixes.
- **Batch two:** (1) loop actions — the biggest UI build.
- **Batch three:** (4) loop auto-complete — needs a short runtime investigation
  (the bucketing check) before the fix lands.

Per the docs rule, each batch ships with a `wiki/Version-History.md` entry plus
any `Features.md` / `Architecture.md` touch (the `read_at` column is an
Architecture/schema change).

---

## Decisions already locked (from 2026-06-13 Q&A)

- Loop quick-actions = **Spawn task now** + **Skip this cycle**. Dropped:
  "Do it now (reset clock)" (redundant with spawn→complete) and "Snooze loop".
- Placement = swipe action on the Loops-page cards **and** buttons on the
  `LoopDetail` tap-through page.
- Item 4 scope = make the loop **card cross out** and the **Loops count**
  increment when its spawned task(s) are completed (clock already advances).
