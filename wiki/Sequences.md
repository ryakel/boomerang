# Sequences (follow-up task chains)

Boomerang's third primitive after Tasks and Routines: a **completion-triggered chain** of steps that walks forward as each step is finished. Routines are time-triggered (cron-like), checklists are sub-items inside one task; Sequences fill the gap between them — *"after I do X, remind me to do Y in 30 minutes, then Z in 2 days."*

The original use case (the user's mop):

1. Clean the floors (the routine itself fires weekly)
2. → auto-clean the mop *(immediately on step 1 complete, runs for 30 min)*
3. → empty the tanks to dry *(30 min later, when the cycle finishes)*
4. → put the dry containers back on the mop *(2 days later, when they're dry)*

Each step only spawns when its predecessor is **completed** — not on a wall-clock schedule. Skipping a step never triggers the next one. (Skip-and-advance is a planned PR 3 affordance — see Roadmap.)

---

## Data model

A new `follow_ups` JSON column on both `tasks` and `routines`. Format:

```json
[
  { "id": "uuid", "title": "Auto-clean the mop", "offset_minutes": 0 },
  { "id": "uuid", "title": "Empty the dirty tank", "offset_minutes": 30 },
  { "id": "uuid", "title": "Put the dry tanks back", "offset_minutes": 2880 }
]
```

Each step is timed by **either** a relative `offset_minutes` (delay after the
previous step is completed) **or** an absolute clock time `at_time` ('HH:MM' 24h,
plus optional `at_next_day: true` for "the next morning") — never both. The
dishwasher chain expressed with clock times:

```json
[
  { "id": "uuid", "title": "Pour kiddo milk", "at_time": "21:00" },
  { "id": "uuid", "title": "Empty the dishwasher", "at_time": "06:00", "at_next_day": true }
]
```

Optional fields per step (PR 1 ships with title + offset only; the rest fall back to AI inference):

| Field | Type | Notes |
|---|---|---|
| `energy_type` | `'desk' \| 'people' \| 'errand' \| 'confrontation' \| 'creative' \| 'physical'` | Skipped → background sizer infers |
| `energy_level` | `1 \| 2 \| 3` | Skipped → AI infers |
| `notes` | `string` | Copied verbatim onto the spawned task |

**Why two columns?** Routines hold the *template*. Tasks hold the *live remaining chain*. When a routine spawns a task, the routine's `follow_ups` are copied onto the spawned task. As each spawned step completes, the chain shifts left (`slice(1)`) and the next step spawns from the head of what's left. The routine template is unchanged — only the live in-flight chain on tasks gets consumed.

Migration: `migrations/023_add_follow_ups.sql`.

---

## Spawn semantics

Lives in `db.js` `updateTaskPartial` → `spawnNextChainStep(parentTask)`.

When a task transitions to `status='done'` or `'completed'` AND has a non-empty `follow_ups` array:

1. Take `step = follow_ups[0]`, `remaining = follow_ups.slice(1)`.
2. Compute `triggerAt = Date.now() + step.offset_minutes * 60000`.
3. Build a new task:
   - `title = step.title`
   - `notes = step.notes || ''`
   - `routine_id` inherited from the parent task (so the chain stays grouped under the source routine for `completed_history`, activity log, and analytics)
   - `due_date = YYYY-MM-DD` of the trigger date
   - `snoozed_until = triggerAt.toISOString()` if the offset is sub-day (so it doesn't surface in the list until the cycle is up)
   - `energy = step.energy_type || null`, `energyLevel = step.energy_level ?? null`
   - `size = step.energy_type ? 'M' : null` (so points compute immediately if energy is set)
   - `size_inferred = false` (background hook fills in any missing energy data)
   - `follow_ups = remaining`
4. `upsertTask(newTask)`. The PATCH endpoint that wrapped the original completion broadcasts a single SSE update; the new task lands in the next client refetch.

**Sub-day vs ≥1-day offsets.** If the offset is < 24h AND the trigger is the same calendar day: `due_date = today`, `snoozed_until = trigger time` so the task is invisible until the cycle is up. If the offset is ≥ 24h: `due_date = future date`, no snooze (it'll naturally appear on its due day).

**Absolute clock-time steps (`at_time` / `at_next_day`, migration 033).** A step may carry `at_time` ('HH:MM' 24h) instead of `offset_minutes`. When present, `spawnNextChainStep` ignores the offset path and schedules the new task at that wall-clock time **today**, or on **the next day** when `at_next_day` is true. It snoozes until that instant (or surfaces immediately if the time already passed) and sets `due_date` to that day. A step is single-mode: `at_time` wins if both fields exist; the editor and Quokka tools clear the other field when you switch modes. Computed in server-local time (same TZ characteristic as the offset path). This is what lets the dishwasher chain read as real clock times — "pour milk at 9pm", "empty dishwasher at 6am next morning" — rather than offsets relative to when each prior step happened to be completed.

---

## Routine integration

Two spawn paths in `src/hooks/useRoutines.js`:

- **`spawnNow(routineId)`** — manual "+" button on a routine card. Bypasses cadence, due date = today.
- **`spawnDueTasks(existingTasks)`** — the cadence-driven spawn loop. Fires when a routine is due AND has no active task already.

Both copy `routine.follow_ups` onto the spawned task. The walk takes over from there as each step completes.

---

## UI

`RoutinesModal` form view gets a **Follow-ups** section between Notes and Labels.

- "+ Add step" pill (existing `.v2-edit-add-pill` style) appends a blank step
- Each step row shows: position number, title input, offset value + unit dropdown (`min` / `h` / `d`), reorder up/down chevrons, remove ×
- Steps with empty title are filtered out on save (incomplete drafts don't pollute the chain)
- The same form drives both create + edit; `initial.follow_ups` is the initial seed

`FollowUpStepRow` is a sub-component. Internal state tracks `value` + `unit` independently to avoid jitter on intermediate input ("1." → NaN); commits to `offset_minutes` on every change.

---

## Roadmap

- **PR 2 — Chain-break confirmation (SHIPPED).** When a task with queued follow-ups is about to be deleted, moved to backlog, moved to projects, or cancelled, a `ConfirmDialog` warns: *"This task has N follow-up step(s) queued. {Action} will stop the chain — the queued step(s) won't spawn."* Two options: confirm-with-stop (red), or "Keep task" (cancel). Completion is intentionally ungated since `done`/`completed` ADVANCE the chain — they don't break it. Implementation: `gateOnChainBreak()` helper in `AppV2.jsx` wraps `handleDelete`/`handleBacklog`/`handleProject`/`handleStatusChange`. Reusable `src/v2/components/ConfirmDialog.jsx` + `.css`.
- **PR 3 — Skip & advance (SHIPPED).** New amber "skip step" button (lucide `SkipForward`) appears on chain-step tasks (any task with `follow_ups.length > 0`) in the expanded card actions row. Tapping marks the task `status='cancelled'`, `skipped=true`, `completed_at=now`, then runs `spawnNextChainStep` so the chain keeps walking despite this step being abandoned. Server endpoint: `POST /api/tasks/:id/skip-advance` (atomic: marks-skipped + spawns-next in one DB pass). Schema: migration 024 adds `skipped INTEGER DEFAULT 0` to `tasks`. Activity log records `'skipped'` action so DoneList / ActivityLog can distinguish from a true cancel in future polish.
- **PR 4 — AI-mediated edit reconciliation (SHIPPED).** When the user saves an existing routine's `follow_ups` template after editing/adding/removing steps, a `ChainReconcileModal` appears between the form and the persistence layer. Modal lifecycle: `review` (summary of what changed) → user clicks "Ask Quokka" → `loading` → `diffs` (per-suggestion accept/reject toggles) → save with merged chain. "Save without scan" path skips the AI step entirely. Skips brand-new chains (no point reconciling steps you just drafted). Title-only diff trigger — offset/notes/energy edits don't propagate linguistically. Implementation: `aiReconcileChain()` in `src/api.js` (uses the existing `/api/messages` proxy with a focused prompt; conservative-by-default — empty suggestions are fine), `src/v2/components/ChainReconcileModal.jsx` + `.css`, hooked into `RoutineForm`'s `handleSave` via `pendingSave` state in `RoutinesModal.jsx`. Live in-flight chain editing is parked for a future PR — current scope is template-only.
- **PR 5 — Quokka tools (SHIPPED).** Four atomic tools on routine `follow_ups` arrays, all in `adviserToolsTasks.js`:
  - `add_follow_up({routine_id, title, offset_minutes|at_time, [at_next_day], [step_index], [energy_*], [notes]})` — append (or insert) a step. Time it with `offset_minutes` OR `at_time` ('HH:MM', +`at_next_day` for "next morning"). Returns the new `step_id` so subsequent calls can reference it.
  - `edit_follow_up({routine_id, step_id|step_index, [title, offset_minutes, at_time, at_next_day, energy_*, notes]})` — update a single step's fields. Setting `at_time` switches to clock-time mode (clears `offset_minutes`) and vice-versa; `at_time: null` reverts to offset mode. `null` for energy_type/level/notes clears that field.
  - `remove_follow_up({routine_id, step_id|step_index})` — delete one step.
  - `reorder_follow_ups({routine_id, step_ids[] OR (from_index, to_index)})` — full reorder by id list, or single-step move by indices.
  - All four capture the routine's pre-state and restore it on rollback (LIFO compensation chain — same pattern as existing routine tools).
  - `summarizeRoutine` now exposes `follow_ups` with `step_index` + `step_id` + fields, so `get_routine` and `list_routines` give the model what it needs to address steps without a separate fetch. Tool count: 50 → 54.
  - **Live in-flight task chain editing via Quokka is intentionally not in this PR.** Editing the routine template propagates to the NEXT spawn cycle; already-spawned tasks carry their own `follow_ups` snapshot from PR 1's spawn copy and aren't retroactively mutated. If a user wants to surgically edit a queued step on an in-flight chain, that's a separate flow that lands when live-edit reconciliation (Scenario B in PR 4) does.

Other parking-lot questions:

- **Ad-hoc chains on one-off tasks.** Today the editor only lives on routines. EditTaskModal could expose the same editor on any task — useful for "after I publish this blog post, remind me to share it on socials in 2 hours." Defer until the routine flow is validated.
- **Notification semantics.** A spawned step lands with `status='not_started'`. Whether nudges/stale notifications fire depends on `due_date` vs today and `snoozed_until` — same rules as any other task. No special-case treatment in PR 1.
- **Cancellation observability.** When the chain stops because a step is deleted (PR 2), should that show up in the routine's activity log so the user can see "hey, your mop chain stalled at step 3 last Tuesday"? Probably yes; defer to PR 2 along with the delete prompt.

---

## File touchpoints (PR 1)

- `migrations/023_add_follow_ups.sql` — new
- `db.js` — `taskToRow`, `rowToTask`, `UPSERT_TASK_SQL`, `runUpsertTask`, `routineToRow`, `rowToRoutine`, `UPSERT_ROUTINE_SQL`, `runUpsertRoutine`, `updateTaskPartial`, `spawnNextChainStep` (new)
- `src/hooks/useRoutines.js` — `addRoutine` signature, `spawnNow`, `spawnDueTasks`
- `src/v2/components/RoutinesModal.jsx` — `FollowUpStepRow` (new), `RoutineForm` state + UI, `handleSubmitForm`
- `src/v2/components/RoutinesModal.css` — `.v2-followups-*`, `.v2-form-section-hint`
- `wiki/Sequences.md` — this file
