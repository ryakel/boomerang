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
- **PR 3 — Skip & advance.** Button on a chain-step task that marks it `cancelled` with `skipped: true`, then runs the spawn logic anyway. Activity log distinguishes skip from completion.
- **PR 4 — AI-mediated edit reconciliation.** Editing a step (live OR template) pops a small Quokka modal: *"You changed X. Want me to update the rest of the chain to match?"* AI suggests per-step diffs, user accepts/rejects.
- **PR 5 — Quokka tools.** `add_follow_up`, `edit_follow_up`, `remove_follow_up`, `reorder_follow_ups` so chains can be created/edited via natural language.

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
