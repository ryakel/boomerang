# Escalation Ladder (contact-persistence tasks)

A task-level feature for the "I need a response from someone and I'm not getting one" problem — different from Sequences (which chains *your own* follow-up steps after *you* complete something) and Routines (time-triggered recurrence). An Escalation Ladder tracks **repeated attempts to reach an unresponsive person or organization**, and — the actual point of the feature — prompts you to **change approach** once a rung's attempts are exhausted, instead of just nagging you to repeat the same thing that already isn't working.

The originating example (windows quote/repair): email the contractor, no response. After a couple of follow-up emails, switch to calling. After a few unanswered calls, call the company's main line instead of the individual. Still nothing — ask for a salesperson and get someone out in person. Each rung is a **different tactic**, not a repeat of the last one; the ladder's job is to notice "you've hit the ceiling on this approach" and tell you what to try next.

---

## Why not Sequences

Sequences fire the next step when the current one is marked **done** — they model a chain of work you're doing yourself. An escalation ladder fires the next rung when the current one is exhausted by **repeated non-response** — there is no "done" signal from the other party, only a count of attempts and elapsed time. The two are structurally different triggers (completion vs. attempt-threshold) and reusing `follow_ups` would force an awkward fit. This is its own primitive, scoped to a single task.

---

## Data model

New columns on `tasks` (new migration `038_add_escalation_ladder.sql`):

| Column | Type | Notes |
|---|---|---|
| `escalation_rungs` | JSON | Ordered array, see shape below. `NULL`/`[]` = feature off for this task. |
| `escalation_current_rung` | INTEGER | Index into `escalation_rungs`. Defaults to `0`. |
| `escalation_attempt_log` | JSON | Array of `{ at: ISO timestamp, rung_index, note? }` — one entry per logged attempt, all rungs, never trimmed (it's the audit trail + the "how long has this been going on" source). |

Rung shape:

```json
{
  "id": "uuid",
  "label": "Email",
  "suggestion": "Send a polite follow-up email referencing the quote request.",
  "attempts_before_next": 3,
  "min_days_before_next": 2
}
```

- `label` — short tactic name shown on the card ("Email", "Call", "Call main line", "Ask for a manager").
- `suggestion` — the text surfaced in the nudge/notification for this rung. AI-authored at ladder-creation time (see Quokka tool below) or user-edited.
- `attempts_before_next` — how many logged attempts at this rung before the ladder auto-advances. `null` = this is the **last rung** — logging attempts here never auto-advances (see "Running out of rungs" below).
- `min_days_before_next` — floor on elapsed time since the rung's first attempt, even if the attempt count is hit early (stops "call 3 times in one afternoon" from immediately unlocking the next rung — most real escalation only makes sense to move on after giving the current tactic a fair window).

---

## Interaction model

**Logging an attempt.** A "Log attempt" button on the expanded task card (same UX precedent as the existing Project "Log session" button — a single tap, no form). Appends to `escalation_attempt_log`, stamped with the current `escalation_current_rung`.

**Auto-advance.** After each logged attempt, check: has this rung's `attempts_before_next` been reached AND has `min_days_before_next` elapsed since the first attempt logged at this rung? If both, `escalation_current_rung += 1` and the next nudge announces the new rung ("You've emailed 3 times over 4 days with no response — time to call.").

**Manual advance.** A "Move to next step" action lets the user jump the queue without waiting on the thresholds (mirrors the existing Loop `skipCycle` pattern) — sometimes you already know email is dead the moment you send it.

**Nudge integration.** While a task has an active ladder (`escalation_rungs` non-empty and `escalation_current_rung` within range), its notification text is overridden: instead of the generic stale/nudge copy, the message uses the current rung's `suggestion` plus the attempt count so far ("Rung 2/4 · Call — you've called twice, no answer"). This rides the existing per-type notification templates in `pushNotifications.js`/`emailNotifications.js`/`pushoverNotifications.js` — no new transport, just a text-source override keyed on `escalation_rungs` presence.

**Running out of rungs.** Reaching the last rung's attempt threshold doesn't advance further (there's nowhere to go) — it flips a `stuck` state that changes the ask: instead of "try X again," the card surfaces a **"Brainstorm next moves"** button. This is the "creative way to get people to help" part of the ask — tapping it sends the task's title/notes + the full rung history to Claude and asks for genuinely new angles (public reviews for an alternate contact, a regional office, a different department, a mutual connection, a consumer-complaint channel) rather than another scripted rung, since by definition the user's own script has run out. Results append to the task's notes (same pattern as `research_task`), not a new rung — a brainstorm isn't a repeatable tactic.

---

## UI

`EditTaskModal` gets an **Escalation** section (same visual language as the Project/Sequences sections):

- Toggle: "Track contact attempts for this task"
- Rung list editor — same list/reorder/add/remove interaction as the Sequences `FollowUpStepRow` list, one row per rung (label, suggestion, attempts-before-next, min-days-before-next)
- Read-only summary once attempts exist: "Rung 2 of 4 · 3 attempts logged · last: 2 days ago"

Task card (collapsed): a small rung indicator next to the energy chip when a ladder is active (e.g. "☎ 2/4"). Expanded card: "Log attempt" + "Move to next step" buttons, attempt history as a compact list.

---

## Quokka integration

One generative tool plus the standard CRUD, all in `adviserToolsTasks.js`:

- **`generate_escalation_ladder({ task_id, situation })`** — the primary entry point. `situation` is free text describing who/what/channels available/urgency (what the user would otherwise type into chat: "trying to get a windows quote from Acme, they went quiet after the initial email, I have their email and a general phone number"). The model drafts an ordered rung list — channel-appropriate, situation-aware thresholds (a time-sensitive ask gets tighter `min_days_before_next` than a someday-maybe task) — and stages it as a `set_escalation_ladder` update for user approval, same staged-plan-confirm flow as every other mutation.
- **`set_escalation_ladder({ task_id, rungs })`** — direct set/replace, for manual edits or Quokka adjustments after the fact.
- **`log_escalation_attempt({ task_id, note? })`** — lets Quokka log an attempt on the user's behalf mid-conversation ("I called again just now, still nothing — log that").
- `summarizeTask()` gains the escalation fields so `get_task`/`search_tasks` expose ladder state without a separate fetch.

---

## Known limitations / parked

- No auto-detection of "attempt" from Gmail/Trello/Notion activity — attempts are user-logged only. Auto-detecting "I emailed them" from the Gmail sync is a plausible future enhancement but adds a lot of surface area (matching sent mail to a task) for v1.
- No per-rung channel enum/validation — `label`/`suggestion` are free text. A structured channel type (email/call/text/in-person/other) could drive channel-specific UI (a tel: link for a "call" rung) later.
- The "stuck" brainstorm doesn't currently create tasks/reminders from its output automatically — it's a notes append the user reads and acts on manually. Auto-staging a new rung from the brainstorm is a natural v2 extension once the pattern is validated.
- Not wired into Routines — a recurring "keep trying to reach the HOA" case would need per-cycle ladder resets, which isn't scoped here.
