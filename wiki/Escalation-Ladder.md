# Escalation Ladder (contact-persistence tasks)

A task-level feature for the "I need a response from someone and I'm not getting one" problem — different from Sequences (which chains *your own* follow-up steps after *you* complete something) and Routines (time-triggered recurrence). An Escalation Ladder tracks **repeated attempts to reach an unresponsive person or organization**, and — the actual point of the feature — prompts you to **change approach** once a rung's attempts are exhausted, instead of just nagging you to repeat the same thing that already isn't working.

The originating example (windows quote/repair): email the contractor, no response. After a couple of follow-up emails, switch to calling. After a few unanswered calls, call the company's main line instead of the individual. Still nothing — ask for a salesperson and get someone out in person. Each rung is a **different tactic**, not a repeat of the last one; the ladder's job is to notice "you've hit the ceiling on this approach" and tell you what to try next.

**Revision note (2026-07-04):** this spec was rewritten after a deliberate adversarial design pass (see below) that pushed back hard on the first draft. The core critique: the first draft modeled the *data* thoroughly and the *lifecycle moments* thinly — attempt-logging lived only behind an app-open, advancement was silent/automatic (the user asked for "prompt to move past it," not automate), there was no success path, and attempts earned no points despite being real effort. This revision keeps the one genuinely novel idea (the nudge carries the next tactic, not a generic nag) and fixes the lifecycle gaps.

---

## Why not Sequences

Sequences fire the next step when the current one is marked **done** — they model a chain of work you're doing yourself. An escalation ladder fires the next rung when the current one is exhausted by **repeated non-response** — there is no "done" signal from the other party, only a count of attempts. The two are structurally different triggers (completion vs. attempt-threshold) and reusing `follow_ups` would force an awkward fit. This is its own primitive, scoped to a single task.

---

## Data model

New columns on `tasks` (migration `039_add_escalation_ladder.sql`):

| Column | Type | Notes |
|---|---|---|
| `escalation_rungs` | JSON | Ordered array, see shape below. `NULL`/`[]` = feature off for this task. |
| `escalation_current_rung` | INTEGER | Index into `escalation_rungs`. Defaults to `0`. |
| `escalation_attempt_log` | JSON | Array of `{ id, at: ISO timestamp, rung_index, points: 1 }` — one entry per logged attempt, all rungs, never trimmed (audit trail + "how long has this been going on" + the points source — same shape family as a project's `session_log`). |
| `escalation_awaiting_advance` | INTEGER (bool) | `1` when the current rung's threshold is met and the app is *offering* to move on but hasn't yet — see Interaction model. Distinct from actually advancing. |
| `escalation_stuck` | INTEGER (bool) | `1` when the last rung's threshold is met and there's nowhere further to go — triggers the Brainstorm path. |

Rung shape — deliberately **one number, not two** (the first draft's `attempts_before_next` + `min_days_before_next` combo was overbuilt: the user's mental model is fuzzy, "a couple more emails, then switch," and with *prompted* advance the threshold only controls when the app starts *asking*, so precision buys nothing):

```json
{
  "id": "uuid",
  "label": "Email",
  "suggestion": "Send a polite follow-up email referencing the quote request.",
  "script": "Hi — following up on the windows quote for 123 Main St. Could we get a date on the calendar?",
  "attempts_before_ready": 3,
  "nudge_every_days": 2
}
```

- `label` — short tactic name shown on the card ("Email", "Call", "Call main line", "Ask for a manager").
- `suggestion` — the text surfaced in the nudge/notification for this rung.
- `script` *(optional but strongly encouraged, AI-authored)* — a literal one-to-two-line opener the user can read or paste, not just a description of the tactic. For confrontation-flavored rungs (calling a stranger, asking to speak to a manager) the barrier is rarely "remember to do it" — it's "know what to say when a human answers." Converting a rung from "make an awkward call" to "read this aloud" is worth more than the entire threshold system; Quokka always tries to write one.
- `attempts_before_ready` — how many logged attempts at this rung before the app starts *offering* to advance (see Prompted advance below). `null` = this is the **last rung** — reaching it never offers to advance; it flips `escalation_stuck` instead.
- `nudge_every_days` — how often the nudge fires *while on this rung*, e.g. "call every day" vs. "email, then wait a few days." This is cadence, not just a threshold — the user's own phrasing ("calling them every day or something") is a tempo, and rung 1 ("wait politely") and rung 3 ("call daily until a human answers") need different tempos. This is a per-rung override of the normal stale/nudge frequency, not an additional independent timer.

No reorder UI, no multi-field advance math. Rungs are almost always AI-drafted (see Quokka integration); user edits are inline text tweaks, add-one-at-the-end, or delete — never drag-reordering a state machine by hand.

---

## Interaction model

The design test for every interaction below: **does the intent reach the user at the moment it's actionable, in one tap or zero?** The first draft failed this test by putting every action behind an app-open.

**Logging an attempt — must be reachable from the nudge itself, not just the card.** In-app: a "Log attempt" button on the expanded task card (same one-tap precedent as the Project "Log session" button). On web push notifications for an active-ladder task: an inline action button (mirrors the existing Snooze 1h / Done pattern already in the service worker) so a call made from the car, ended, can be logged without opening the app. Each logged attempt appends `{id, at: now, rung_index: current, points: 1}` to `escalation_attempt_log`.

**Attempts earn points.** Per the app's own "waiting = progress" principle — sent the email, made the call is real effort even without resolution — each logged attempt is worth 1 point, summed into the daily total exactly like project session-log points (`computeEscalationStatsToday()` alongside the existing `computeSessionStatsToday()`, both rolled into `computeDailyStats`). This isn't decoration: if logging doesn't feel like scoring, it won't happen, the log goes stale, and the ladder starts nagging on wrong information.

**Prompted advance, not automatic.** After a logged attempt, if `attempts_before_ready` is met for the current rung, the *next* nudge changes shape: instead of continuing to ask for another attempt at the same tactic, it asks **"Email's had 3 tries with no response. Ready to switch to calling? [Move on] [One more try]"** — both are one-tap actions (in-app buttons always; web push inline actions where the transport supports it). `escalation_awaiting_advance` is set the moment the threshold is met so the UI can show the prompt state even before the next nudge fires. The app never silently changes what it's asking for — every transition is a decision the user makes, matching the same propose-then-confirm shape as Quokka's staged plans and the loop-reconcile review surface (both already-established "the app surfaces, the user decides" precedents in this codebase).
- **[Move on]** → `escalation_current_rung += 1`, `escalation_awaiting_advance = 0`, next nudge announces the new rung + its `script`.
- **[One more try]** → `escalation_awaiting_advance = 0`, stays on the current rung (the counter effectively gets a little slack — the user gets to decide their own threshold was too eager).

**Manual advance.** A "Move on" action is also available at any time from the expanded card, independent of whether the threshold has been hit yet — sometimes you already know email is dead the moment you send it and don't want to wait for the app to ask.

**Success path — modeled, not an afterthought.** A "Got a response" action, as prominent as Log attempt, available in-app and (where supported) inline on the nudge. Tapping it: clears the active ladder (`escalation_rungs` stays as a record but `escalation_current_rung`/`escalation_awaiting_advance`/`escalation_stuck` reset to closed), fires a genuine celebration toast ("Four rungs and you got them. What's next?" — this is the payoff of days of dreaded persistence and deserves to read like one), and offers a one-tap "Add a follow-up" prompt that hands off to a normal task (or, if there's obvious multi-step follow-on work like "they're coming Tuesday → prep questions → be home," a Sequence) — the natural next primitive once contact is actually established.

**Nudge integration.** While a task has an active ladder, its notification text is overridden across every transport: instead of generic stale/nudge copy, the message uses the current rung's `suggestion` (and `script` where the transport can show enough text) plus the attempt count — or, when `escalation_awaiting_advance` is set, the prompted-advance copy above. Cadence for these nudges is `nudge_every_days` on the current rung, not the task's normal stale/nudge frequency (waiting-status tasks are otherwise nagged calmly; an active-rung task needs to own its own tempo). This is a text-source + cadence override keyed on `escalation_rungs` presence — no new transport, reuses the existing per-type templates in `pushNotifications.js` / `emailNotifications.js` / `pushoverNotifications.js`.

**Running out of rungs.** Reaching the last rung's `attempts_before_ready` (or having no threshold and just... continuing to fail) flips `escalation_stuck` — there's nowhere scripted left to go. The card surfaces a **"Brainstorm next moves"** button. Tapping it runs a Quokka turn with the task's title/notes/full rung history, asking for genuinely new angles (public reviews for an alternate contact, a regional office, a different department, a consumer-complaint channel) — and **stages the results as new rungs** via `set_escalation_ladder` (append), landing as a normal staged-plan Apply, not a wall of prose dumped into notes. The peak-demoralization moment (every planned move has failed) is exactly the wrong time to ask the user to re-author freeform brainstorm text into structured rungs themselves.

---

## UI

`EditTaskModal` gets an **Escalation** section (same visual language as the Project/Sequences sections):

- Toggle: "Track contact attempts for this task"
- Rung list — simple stacked list (label, suggestion, script, tempo), add-one-at-the-end + delete per row. No reorder.
- Read-only summary once attempts exist: "Rung 2 of 4 · 3 attempts logged · last: 2 days ago"

Task card (collapsed): a small rung indicator next to the energy chip when a ladder is active (e.g. "☎ 2/4"), with a distinct visual state when `escalation_awaiting_advance` (e.g. an amber pulse) or `escalation_stuck` (e.g. the Brainstorm affordance surfaces directly on the collapsed card, since it's the highest-priority action once stuck). Expanded card: **Log attempt**, **Move on**, **Got a response** buttons (all always visible when a ladder is active — no submenu), attempt history as a compact list, script text shown prominently for the current rung.

---

## Quokka integration

- **`generate_escalation_ladder({ task_id, situation })`** — the primary entry point. `situation` is free text describing who/what/channels available/urgency. The model drafts an ordered rung list (label + suggestion + script + tempo, situation-aware — a time-sensitive ask gets a tighter `nudge_every_days` than a someday-maybe task) and stages it as a `set_escalation_ladder` update for approval.
- **`set_escalation_ladder({ task_id, rungs })`** — direct set/replace (also used by the Brainstorm-stages-rungs flow above, appending rather than replacing when called in that context).
- **`log_escalation_attempt({ task_id, note? })`** — lets Quokka log an attempt on the user's behalf mid-conversation ("I called again just now, still nothing — log that").
- **`advance_escalation_rung({ task_id })`** / **`resolve_escalation({ task_id })`** — Quokka-driven equivalents of Move on / Got a response, for "move this to calling" or "they finally got back to me, close it out" said in chat.
- `summarizeTask()` gains the escalation fields (current rung, awaiting-advance/stuck flags, attempt count) so `get_task`/`search_tasks` expose ladder state without a separate fetch.

---

## Known limitations / parked

- **No auto-detection of outbound attempts** (Gmail/Trello/Notion) — attempts are user- or Quokka-logged only. Matching sent mail to a task is real scope, deferred.
- **Inbound success detection is parked, not built in v1** — the idea (surface "looks like they replied — close the ladder?" when a Gmail message arrives from a matched sender) is cheap in principle since the Gmail scanner already polls, but wiring sender-matching against a specific task is nontrivial and depends on Gmail being connected. "Got a response" stays a manual/Quokka action for now.
- **Inline notification actions are web-push only in v1.** Email and Pushover show the rung's `suggestion`/`script` as text (a real improvement over generic nag copy) but don't get tappable Log attempt / Move on / Got a response buttons — those platforms' action-button support is either absent (Pushover) or would require building tokenized one-tap action links from scratch (email). Web push already has the actions-array + service-worker-click precedent from Snooze 1h/Done, so it's the only transport this ships with true inline actions on.
- **Reactive creation (the app noticing a stuck avoidance-prone task and offering to draft a ladder) is parked**, not built in v1. The natural hook exists (the avoidance-boost logic already flags `confrontation`/`errand` tasks sitting in `waiting` too long) but wiring a new proactive-suggestion surface is separate scope from the ladder mechanism itself. v1 creation paths are: the EditTaskModal toggle, or asking Quokka directly ("help me build an escalation plan for the windows quote").
- Not wired into Routines — a recurring "keep trying to reach the HOA" case would need per-cycle ladder resets, which isn't scoped here.
