# Crisis Tag ("prio") + Impact-Based Prioritization — Plan

**Status: PLAN, decisions resolved — ready to build.** Two interlocking features, drafted 2026-07-14; all open decision points answered by the user the same day (see "Decisions — RESOLVED" below). Nothing in this doc is shipped yet.

**The two asks, verbatim:**
1. *"I want the ability to use a tag (say `prio`) as an indicator that things need to follow a much higher priority path and that somehow beat me the fuck up. Example — if my wife says the washing machine is broken, that should not only help me distill down how to rapidly get started helping but also make sure that thing nags the ever loving fuck out of me."*
2. *"Need a better mechanism to prioritize based on impact (spouse impact, proximity to holidays, getting outside shit done before multiple days of upcoming bad weather, etc.). I'm doing lots of shit but none that feels super impactful."*

They interlock: the crisis tag is the manual override lever ("this is the fire, everything else waits"); impact ranking is the ambient ordering underneath it ("of the non-fires, which actually matters"). Crisis always outranks impact.

---

## Feature 1 — Crisis tag (`prio`)

### Concept

A user-configurable label (default `prio`) that, when present on a task, flips the task onto a **crisis path** with three behaviors:

1. **Nags relentlessly** — the most aggressive notification treatment in the app, more aggressive than `high_priority` stage 3.
2. **Distills a rapid start** — an automatic AI triage breakdown ("what are the first 3–5 concrete moves, starting with one I can do in under 5 minutes") written into the task's checklist.
3. **Pins to the top of everything** — a dedicated section at the top of Today/Tasks, hard-preferred by What Now, top-scored by the Next-up toast.

This reuses the proven tag-as-behavior-switch pattern from `quiet_hours_bypass_label` (`wake-me`): matched by label id against `task.tags`, configurable in Settings, toggled by a checkbox in the edit modal so the user never has to think about labels.

### Why a tag and not a new boolean column

- Zero-friction application from every surface that already handles tags: quick-add, Quokka (`create_task`/`update_task` `tags`), voice-to-Quokka ("the washing machine is broken, make it a prio"), Trello/Notion label mapping later.
- The `wake-me` precedent means the matching helper, the settings plumbing, and the checkbox UX all have a known-good shape to copy.
- Trade-off (accepted): tag matching is by label id, so renaming/deleting the label needs the same care `wake-me` already needs. The `crisis_label` setting keeps it configurable.

### Notification behavior (the "beat me the fuck up" spec)

A task carrying the crisis label, in an active status (`not_started`/`doing`/`waiting`), not snoozed:

| Aspect | Behavior |
|---|---|
| Loop | Its own per-task loop in all three engines (`pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`), placed **before** the high-priority loop — mirrors how the Escalation Ladder got its own block. |
| Frequency | New `notif_freq_crisis` setting, default **2h**, regardless of due date (no 3-stage ramp — a crisis is already at stage 3; per user 2026-07-14, 30-minute pings were overkill). Fractional hours supported like every other frequency setting, so it can be tightened per taste. Avoidance boost still applies on top (a `confrontation`-energy crisis pings up to ~1.56× more often, ≈ every 77 min at the 2h default). |
| Per-tick cap | Exempt from the high-pri `hpCount >= 3` cap. Crisis tasks always fire first. In practice there should be 0–2 of these at a time. |
| Pushover priority | **1** (bypasses quiet hours per existing Pushover semantics) immediately; escalates to **2 (Emergency — 30s retry, 1h expire)** once the task is overdue OR has been in crisis for >24h without a status change. Receipt saved to `tasks.pushover_receipt` so the existing act-to-cancel plumbing (`cancelEmergencyReceipt`) silences it the moment the user acts. |
| Quiet hours | Web push + email: silent during quiet hours by default, same as everything else. The tag-based `wake-me` bypass remains the wake-up mechanism — the crisis checkbox in the edit modal offers an inline "**also wake me for this**" sub-checkbox that adds the `wake-me` label, so 2am-worthy crises are one extra tap, not a default. (Decision point D1 below if you'd rather crisis imply bypass.) |
| `isNotifiable()` | Crisis label counts as an explicit opt-in, same as `nag_allowed` and an active escalation rung — an **undated** crisis task must still nag. Without this, the 2026-07-11 "quiet unless opted in" gate would silence exactly the washing-machine case (nobody sets a due date mid-crisis). |
| Aggregate pools | Excluded from stale/nudge/pile-up aggregate pools (no double-nag) — same exclusion pattern as escalation-active tasks. |
| Adaptive throttling | **Exempt** from `getEffectiveThrottleMultiplier()` back-off. Ignoring a crisis notification must never teach the app to nag less — that is the opposite of the feature. |
| Channel toggles | Rides the existing `*_notif_highpri` per-channel toggles rather than minting three new ones — crisis *is* high priority, dialed up. One new master kill-switch is unnecessary; if you have highpri push off, you've said you don't want urgent push. |

### Rapid-start distillation (the "help me get started" spec)

When the crisis tag lands on a task (at create or later) and `crisis_auto_breakdown` (default **true**) is on:

- A client-side hook modeled on `useSizeAutoInfer` watches for tasks with the crisis tag where `crisis_triage_done = false` (new column, migration 040). One cheap Claude call (SONNET_MODEL, same posture as tag inference) generates a **triage checklist**: 3–5 concrete steps, ordered stop-the-bleeding-first, the first step explicitly doable in under 5 minutes. Washing machine example: *1. Shut the water supply valves behind the machine. 2. Note the error code / symptom on the display. 3. Check if it's under warranty (photo of model/serial plate). 4. Search "\<model\> \<error code\>". 5. If not DIY-able, get 2 repair quotes.*
- Steps are **merged** into `checklist_items` (never overwrite existing hand-written items — same merge posture as AI auto-tagging), then `crisis_triage_done` is set so it runs exactly once per task.
- `ai_custom_instructions` flow into the prompt, so "I'm handy, prefer DIY-first steps" or "always include 'text my wife an ETA' as a step" personalizes triage.
- For messier crises, the crisis section header carries a "**Talk it through**" affordance that seeds a Quokka chat with the task context — the full-strength escape hatch when 5 checklist items isn't enough.

### Surfacing

- **"🚨 Now" section** pinned above everything (above Pinned projects and Stacks) in Today + Tasks views, both Kept shells and desktop. Card treatment: red/ember left border + the section itself is visually loud — this is the one place in the calm Kept language where loud is correct.
- **What Now:** hard rule injected into the prompt — if any crisis task fits the time window at all, it's pick #1 and the reason says why. (It still respects the size-vs-time HARD RULE; a 15-minute window gets the crisis task's *first checklist step* suggested, not the whole task.)
- **Next-up toast scorer** (`AppV2.jsx` ~line 641): crisis +1000, dwarfing high_priority's +100.
- **Digest:** crisis tasks lead the Today section with the 🚨 marker instead of being folded in.

### Guardrails

- **Never auto-applied.** The crisis label joins `quiet_hours_bypass_label` in the exclusion list for AI auto-tagging (`useSizeAutoInfer` + `handleAddTask` candidate lists). Only a human (or an explicit, user-stated Quokka instruction) escalates a task to crisis. An AI silently deciding something should wake you up / Emergency-page you is unacceptable.
- **Staleness check, not auto-decay.** If a task has carried the crisis tag for **7 days**, one gentle notification + an in-app banner asks "Still a crisis?" (Keep / Demote to high priority). It never silently demotes — but a permanent 30-minute nag loop that gets ignored for weeks would burn out the channel's meaning (the entire premise of the adaptive-throttle system). Decision point D2.
- **Pile-up exemption interplay:** a task can't be both pile-up-exempt and crisis (crisis wins; it's counted).

### Settings (all new)

| Key | Default | Purpose |
|---|---|---|
| `crisis_label` | `prio` | Which label id triggers the crisis path (free-text, like `quiet_hours_bypass_label`) |
| `notif_freq_crisis` | `2` (hours) | Per-task crisis nag cadence |
| `crisis_auto_breakdown` | `true` | Auto-generate the triage checklist |
| `crisis_stale_days` | `7` | Days before the "Still a crisis?" check-in (0 = never) |

Plus a new `{ id: 'prio', name: 'prio', color: '#DC2626' }` entry in `DEFAULT_LABELS` (`src/store.js`) so it exists out of the box, like `wake-me` does.

### Implementation touchpoints

- Migration **040**: `crisis_triage_done INTEGER DEFAULT 0` on `tasks`.
- `isCrisis(task, settings)` helper — duplicated per-file exactly like `isPileupExempt()`/`isAvoidance()` already are (project convention; not centralized): `pushNotifications.js`, `emailNotifications.js`, `pushoverNotifications.js`, `db.js` (`isNotifiable`), `src/` (one shared client copy is fine on the client side).
- `db.js`: `isNotifiable()` gains the crisis clause; crisis loop helpers.
- Three notification engines: crisis per-task block + aggregate-pool exclusions + throttle exemption.
- `src/hooks/useCrisisTriage.js` (new, modeled on `useSizeAutoInfer`) + `src/api.js` `generateCrisisTriage()`.
- `EditTaskModal`/`AddTaskModal`: "🚨 Crisis mode" checkbox (+ inline "also wake me") mirroring the existing "Wake me up for this" checkbox mechanics.
- Today/Tasks views (Kept `TodayView`, `TasksViewKept`, desktop): 🚨 section.
- `getWhatNow()` prompt rule; Next-up scorer; `digestBuilder.js` lead treatment.
- Quokka: no new tools needed (tags flow through `create_task`/`update_task`); system-prompt note so it knows what the tag means and asks before applying it.
- Dockerfile: no new root modules planned; if triage generation ends up server-side instead, the new module must be added to the Stage-3 COPY list (NON-NEGOTIABLE rule).

---

## Feature 2 — Impact-based prioritization

### Concept

The app currently ranks by **urgency mechanics** (due dates, staleness, priority flag) and rewards **effort** (size × energy points). Nothing anywhere represents *"who and what does this actually matter to?"* — which is exactly the "doing lots of shit but none feels impactful" gap. The fix is a third AI-inferred dimension alongside size and energy:

**`impact` (1–3)** — stored, AI-inferred at creation, tap-to-correct like energy:

| Level | Display | Rubric (the inference prompt's core) |
|---|---|---|
| 3 | ●●● | Affects people you're responsible to (spouse, kids, household), or carries real money/health/legal/relationship consequences if delayed, or unblocks other things |
| 2 | ●● | Meaningful forward motion on your own real commitments |
| 1 | ● | Self-only, low consequence if it slips a week |

`ai_custom_instructions` shape it — *"anything my wife asked for is impact 3"* becomes a standing rule, same as the existing energy-inference personalization. On top of the stored base, **live context boosts** are computed at rank time (never stored — they change daily):

- **Weather window** — outdoor task (`resolveWeatherVisibility() === 'visible'`) + today/tomorrow is one of `pickBestDays()`' picks + a bad stretch follows → boost. This is precisely "get outside shit done before multiple days of bad weather," and every ingredient already exists (`pickBestDays` in `WeatherSection.jsx` gets hoisted to a shared util).
- **Event proximity** — a small user-maintained list, `settings.impact_dates`: `[{ id, label, date, lead_days, tag? }]` ("Christmas 12-25 lead 21", "in-laws visit 08-02 lead 10"). Tasks sharing the event's `tag` get a boost that ramps as the date approaches. Manual-first on purpose: deterministic and debuggable. GCal-derived event detection is a later layer (see Parked).
- **Due proximity** — already exists in spirit; folded into one scorer instead of scattered heuristics.

```
impactRank(task, ctx) =
    crisis?            → top, always (sorts above everything)
    base               = (impact ?? 2) × 100
  + dueBoost           (overdue 80 / today 60 / tomorrow 40 / this week 20)
  + weatherWindowBoost (50 when the window is now and closes)
  + eventBoost         (0→50 ramping over lead_days)
  + staleDecay         (small; keeps ancient stuff from winning on boosts alone)
```

One function, `impactRank()` in `src/scoring.js`, unit-tested (it's pure). Every surface consumes the same number.

### Where it surfaces

1. **"Impact" sort mode** in the Tasks view (alongside the existing sort modes) + Today sections order by `impactRank` within each section. Sections themselves don't reshuffle — Doing/Stale/Up-next semantics stay; impact reorders *within*.
2. **Impact chip on cards** — `●`/`●●`/`●●●` in a distinct color next to the energy chip, tap-to-cycle 1→2→3 exactly like energy (zero-friction correction; manual tap sets `impact_inferred = true`... i.e. flags it user-owned so inference backs off, same flag semantics as `size_inferred`).
3. **What Now** — task lines gain `impact: high/med/low` + a prompt rule: *"Among tasks that fit the time/energy window, prefer higher impact; say who/what it matters for in the reason."* The size-vs-time HARD RULE stays supreme. The weather rule already in the prompt stays; impact doesn't replace it, it generalizes it.
4. **Next-up toast scorer** — `+ impact × 25`.
5. **Digest "Big rock" line** — one line after the lead-in: *"Big rock today: 🎯 Fix washing machine (Sarah's counting on it)."* Server-side it uses base impact + due proximity only (digestBuilder is synchronous and shouldn't grow a weather dependency in v1).
6. **The feeling of impact** (the actual complaint) — the completion toast for an impact-3 task says so (*"That one mattered."*), and Analytics gains an impact breakdown (done-by-impact, like done-by-energy) so "was this week impactful?" has an answer.

### Points interplay — decision point, default NO for v1

An impact multiplier on points (e.g. ×1.0/1.25/1.5) would make impactful work *pay* more and directly attack "none of it feels impactful." But it changes the streak/daily-goal economy that's been carefully repaired twice (see Derived-Stat Durability Rules), and effort-vs-impact are genuinely different axes — a 5-minute impact-3 phone call out-paying a 4-hour deep-work session might feel wrong a week in. **Recommendation: ship v1 without it**, let the visible chip + toast + analytics carry the feeling, revisit with real usage. (D3.)

### Data model + inference

- Migration **041**: `impact INTEGER` (nullable) + `impact_inferred INTEGER DEFAULT 0` on `tasks`; `impact INTEGER` on `routines` (propagates to spawned tasks at every spawn path, same as `energy_type`/`assignee` — a "get flu shots for the kids" routine is impact-3 every cycle).
- `inferSize()` in `src/api.js` grows an `impact` field in its existing single-call response (size + energy + energyLevel + tags + impact — still one API call, no new cost). Null-impact existing tasks get picked up by the existing `useSizeAutoInfer` net when `size_inferred` is false; **backfill of already-inferred tasks is deliberately lazy** — they default to displaying/scoring as impact 2 until touched, no mass re-inference call storm on upgrade day.
- `assignee`-set tasks: unchanged flat-1-point scoring, but assignee presence is a strong impact-3 signal in the inference prompt.

### Implementation touchpoints

- Migration 041; `db.js` CRUD passthrough for the new columns.
- `src/api.js` (`inferSize` prompt + parse), `src/hooks/useSizeAutoInfer.js` (write-through).
- `src/scoring.js`: `impactRank()` + tests (add to `npm test` alongside `cycles.test.mjs`/dates tests).
- Hoist `pickBestDays` from `WeatherSection.jsx` → shared util (it's pure; `WeatherSection` re-imports).
- Card chip + tap-to-cycle: Kept `TodayView`/`TasksViewKept` rows + legacy `TaskCard.jsx`; `EditTaskModal` field with Auto.
- Settings → Tasks tab: `impact_dates` editor (simple list CRUD, on par with Labels).
- `getWhatNow()`, Next-up scorer, `digestBuilder.js`, `Toast` copy, Analytics breakdown.
- Quokka: `create_task`/`update_task` accept `impact`; `update_settings` handles `impact_dates` (ordinary non-secret setting); `summarizeTask()` exposes it. A "what's my most impactful move today" question needs no new tool — search + summarize already carries the field.

---

## How the two features rank against each other

```
🚨 crisis (prio tag)      — always first, its own section, nags on its own loop
●●● impact 3 + boosts     — top of normal sections, preferred by What Now
●●  impact 2 (default)    — today's baseline
●   impact 1              — fills gaps, quick-win fodder
```

Crisis is deliberately **not** "impact 4" — it's a different axis (a manual alarm state with notification semantics), and keeping it a tag means it never dilutes into the ambient ranking.

## Build order (each PR independently mergeable, lands on `dev`)

1. **PR 1 — Crisis core [M]:** label + settings + `isCrisis` + `isNotifiable` clause + three-engine nag path (incl. Pushover escalation + throttle exemption) + 🚨 section + What Now rule + Next-up score + auto-tag exclusion + edit-modal checkbox.
2. **PR 2 — Crisis triage breakdown [S]:** migration 040, `useCrisisTriage`, `generateCrisisTriage()`, Quokka seed affordance, "Still a crisis?" check-in.
3. **PR 3 — Impact core [M]:** migration 041, inference extension, `impactRank()` + tests, chip + tap-to-cycle, Impact sort, What Now weighting, Next-up score, Quokka params.
4. **PR 4 — Context boosts [S]:** weather-window boost (hoist `pickBestDays`), `impact_dates` setting + Settings editor + event boost, digest Big-rock line, impact toast copy, Analytics breakdown.
5. **PR 5 (optional, post-usage) — points multiplier** if D3 flips to yes.

Docs per the NON-NEGOTIABLE rule each PR: Version-History always; CLAUDE.md + Features.md + Architecture.md for 1 and 3; Configuration.md for the new settings.

## Decisions — RESOLVED (user, 2026-07-14)

All five answered one at a time; every one landed on the recommended default. These are now locked spec, not open questions:

| # | Question | Decision |
|---|---|---|
| D0 | Crisis nag cadence | **Every 2 hours** (`notif_freq_crisis` default `2`; drafted at 0.5h, corrected by user — fractional hours let it be tightened later) |
| D1 | Crisis + quiet hours | **Separate opt-in** — crisis stays silent in quiet hours by default; the crisis checkbox offers an inline "also wake me for this" sub-checkbox that adds the `wake-me` label |
| D2 | "Still a crisis?" check-in | **Yes, after 7 days** — one gentle notification + in-app banner (Keep / Demote to high priority), `crisis_stale_days` configurable, 0 = never, never auto-demotes |
| D3 | Impact multiplier on points | **No for v1** — impact surfaces via chip/sort/What Now/toast/analytics only; points stay pure effort (size × energy). Revisit after real use |
| D4 | Pushover Emergency escalation | **Overdue OR >24h in crisis** — priority 1 immediately on tagging, priority 2 Emergency (30s retry / 1h expire / act-to-cancel receipt) only once the task is past due or has sat in crisis untouched for 24h |
| D5 | Impact display | **Dots (●/●●/●●●)** in a distinct color next to the energy chip, tap-to-cycle |

## Parked / explicitly out of scope for v1

- **GCal-derived event proximity** (auto-detecting "flight to Denver Thursday" as an impact date) — `impact_dates` is manual-first; GCal inference is a clean later layer on the same boost.
- **Impact on routines UI** beyond the stored column + propagation (no per-cycle impact editing).
- **Crisis + web-push inline actions** ("On it" button that snoozes the loop 2h) — the mechanism exists (Snooze1h/Done); wiring crisis-specific actions is follow-up scope, same posture as escalation nudges.
- **Weekly "impact recap"** notification — Analytics breakdown first; a pushed recap only if the passive surface isn't enough.
- **Trello/Notion crisis-label mapping.**
