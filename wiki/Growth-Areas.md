# Growth Areas (personal-coaching reminders)

An optional, deliberately tiny feature: the user defines a short list of things they want to work on about *themselves* — not tasks, not habits with completion tracking, just standing reminders ("be more observant," "be more patient on calls," "stay focused during deep work"). Boomerang resurfaces them. This is the "life organizer, not just task manager" edge of the product — adjacent to Routines/Projects but explicitly **not** a task: nothing to check off, no streak, no points.

**Revision note (2026-07-04, v2):** the first revision (below) fixed delivery (rotation + fresh AI wording + contextual injection instead of a static banner) but surfacing was still one-dimensional — every active area was equally eligible every day, regardless of what kind of day it was. Prod feedback: a work-flavored area shouldn't compete for the Saturday slot at all ("I'm saying leave work at work"), and there was no way to scope a reminder to evenings specifically (the natural home for a work-life-boundary nudge like "leave work at work" — itself the fix for the Saturday problem, since an evening+weekday-scoped area simply never enters the Saturday pool in the first place). This revision replaces the single `mode` enum with three independent surfacing flags (`morning`/`evening`/`persistent`) plus a `day_scope` eligibility filter (`any`/`weekdays`/`weekends`) — deterministic, user-declared scoping rather than the app trying to auto-infer "this is a work reminder, deprioritize on weekends," which would mean guessing life domains via AI and contradicts the whole feature's "dead simple, no tracking" design ethos.

**Revision note (2026-07-04, v1):** rewritten after an adversarial design pass. The first draft's data model and CRUD were fine; its *delivery mechanism* — a static banner and a static always-visible chip strip, same 2-3 phrases every day — was the actual weak point: static, unchanging text in a fixed slot is textbook habituation bait, and a "coaching" feature that's dismissed on autopilot by day 4 isn't coaching, it's decoration. This revision keeps every locked scope decision (no tracking, per-area surfacing choice) and rebuilds *only* the delivery: rotation instead of a full list, fresh AI-rephrased wording instead of static text, and contextual delivery instead of a permanent chip.

---

## Scope decisions (locked, per user — unchanged)

- **No tracking.** Pure reminder text, resurfaced. No progress bar, no streak, no daily check-in prompt. A streak on "be more patient" would just manufacture guilt — patience isn't completable, so any check-in is either meaningless ritual or a daily self-report of failure. This is locked; if it's revisited, it's a deliberate v2 decision made in the open, not scope creep.
- **Surfacing choice is per-area, and now two-dimensional:** independent *timing* flags (`morning`/`evening`/`persistent`, any combination) plus a *day eligibility* filter (`day_scope`: `any`/`weekdays`/`weekends`).

---

## Data model

`growth_areas` — its **own** `app_data` collection, deliberately kept **out of** the bulk `/api/data` PUT/POST sync blob (the whole-blob last-writer-wins path). CLAUDE.md's durability rules are explicit that cross-device-merged keys need a server-side guard and the streak-anchor incident happened *twice* via exactly this blob; the clean fix here is to never let growth areas ride that path at all rather than patch around it. Real per-record server endpoints instead (see below) — same protective shape as `tasks`/`routines`/`packages`, which are already carved out of `setAllData()` for the identical reason.

```json
{
  "id": "uuid",
  "title": "Be more observant",
  "morning": true,
  "evening": false,
  "persistent": true,
  "day_scope": "any",
  "energy_affinity": "confrontation",
  "active": true,
  "created_at": "iso timestamp"
}
```

- `morning` / `evening` / `persistent` *(booleans, independent)* — replaces the old single `mode` enum. An area can be any combination: morning-only, evening-only, persistent-only, or several at once. Legacy records (`mode: 'morning'|'persistent'|'both'`) are normalized to this shape on every read (`normalizeArea()` in `growthAreas.js`) — no migration needed since this is a JSON blob, not a SQL table.
- `day_scope` *(optional, new — `any` default / `weekdays` / `weekends`)* — filters whether the area is even ELIGIBLE at all on a given day, for both rotation and contextual injection. This is the mechanism for "leave work at work never comes up on a Saturday": scope it to `weekdays`, done. Deliberately simpler than trying to auto-detect a "work" vs. "family" domain and reweight — no new inference, no guessing.
- `energy_affinity` *(optional)* — one of the existing energy types (`desk`/`people`/`errand`/`confrontation`/`creative`/`physical`), inferred by Quokka at creation time when a title implies one ("more patient on calls" → `confrontation` or `people`). Powers contextual delivery (below). Omit if there's no clean match — not every area maps to a task flavor.
- `active: false` keeps the item around (edit history / easy re-enable) without surfacing it.

---

## Surfacing (the part that was rebuilt)

- **`morning`** — eligible for the once-daily **morning** rotation (below).
- **`evening`** — eligible for a separate, independently-computed once-daily **evening** rotation. Natural home for wind-down or work-life-boundary reminders — "leave work at work" as `evening` + `day_scope: weekdays` never surfaces at all on a non-workday.
- **`persistent`** — *not* shown as static chrome anywhere. Always eligible for **contextual injection** (What Now + Quokka, below) — "persistent" means "present wherever it's contextually relevant," not "permanently on screen." This is a closer match to what a coach actually does: speaks at the moment of relevance, not on a fixed schedule.
- **`day_scope`** — applied on top of all three: an area with `day_scope: 'weekdays'` is invisible to rotation AND contextual injection on a Saturday/Sunday, full stop, regardless of its morning/evening/persistent flags.

**1. Two independent daily rotations — one area each, never the same wording twice.**

Each local morning AND each local evening, pick exactly **one** active, day-scope-eligible area from that period's pool via a stable rotation (day-of-year index mod pool size — deterministic, so re-opening the app the same day always shows the same pick, but tomorrow moves on). Never surface the whole list at once; a list is skimmed, one line lands. With a recommended 2-3 active areas, each gets meaningful attention a couple of times a week instead of a daily blur — and it quietly caps the "I optimistically added nine areas one evening" problem, since the surface never grows just because the list does.

The picked area's stored `title` is a stable intent ("be more observant"); what's actually shown is a **fresh AI rendering of it**, generated fresh each day — reusing the same shape as the existing toast-message pipeline (`generateToastMessages()` in `src/api.js`: a short prompt, a 3-second timeout, a static fallback if the AI doesn't answer in time). The rephrase prompt is period-flavored: morning picks are framed as a start-the-day cue, evening picks as a wind-down/closing-out cue. Example: stored "be more observant" → surfaced "Notice one thing on your commute you'd normally walk past" (morning). Novelty is what defeats banner blindness; this is the single highest-leverage piece of the whole feature and needs zero new user-facing config beyond the timing checkboxes — the user still only ever types a title.

Computed **once per day per period, server-side, and cached** (`app_data.growth_area_today = { date, morning: {area_id, area_title, text} | null, evening: {...} | null }`) so the digest and the client banner show the *same* pick and text without two independent AI calls or a chance of disagreeing. An empty pick (`area_id: null` — no eligible areas that period/day) is deliberately NOT sticky: it's re-checked on every call until a real pick lands, so adding your first area (or a work-boundary reminder finally becoming day-scope-eligible) shows up the same cycle instead of waiting for tomorrow. Static fallback (AI unavailable/slow) is just the area's own stored title, unmodified — never a blank surface.

Surfaced in two places, both reading the same cached picks:
1. **Digest line** — `digestBuilder.js` gains a section (after the lead-in, before Today): "☀️ Today: {surfaced text}", reading the `morning` pick only (the digest is a morning artifact).
2. **Today-view banner** — a small dismissible card at the top of the Kept Today view (above the Day Arc hero). Shows whichever period it currently is client-side (evening from 5pm local on, falling back to the other period's pick if that one has no eligible areas that day) — no server round-trip needed for the time check, the client already has both cached picks. Dismiss is keyed per `date:period` (bucketed in `settings.user_timezone` for the date; the period switch itself is a plain client-side clock check) so dismissing the morning banner doesn't suppress an evening one appearing later, and vice versa. No completion semantics — dismissing isn't "doing" anything, it's just "seen."

**2. Contextual injection — the actual "coaching," not the morning notice.**

A morning banner about staying patient on calls has evaporated by the 2pm call it was actually relevant to. The app already knows task energy types, so:
- **What Now** (`getWhatNow()`): the active `persistent` areas (with `energy_affinity` set, day-scope filtered) are passed alongside the existing weather-summary context. When the model picks a task whose energy matches an area's affinity, it may add one line — "…and this one's a rep for staying patient" — **only when genuinely relevant**, mirroring the existing rule that weather is only mentioned in the reason when it actually affects the pick. Never forced onto every response.
- **Quokka**: active `persistent` growth areas (title + affinity, compact, day-scope filtered) are folded into the system prompt context, so "help me plan this call" or "I'm dreading this one" naturally gets a coaching-flavored response when it's actually relevant, without the user having to bring it up first.

Both reuse the *same* underlying filter (`contextualGrowthAreas()` in `growthAreas.js`) rather than two independent implementations, since the model input is the same question (task energy + active, day-eligible areas) asked from two call sites.

---

## Management UI

A "Growth areas" entry in the System menu (alongside Settings/Analytics/Done/Suggestions/Activity log). Simple list CRUD:

- Add: title + three timing checkboxes (Morning / Evening / Persistent, default morning+persistent) + a day-scope select (Any day / Weekdays / Weekends, default Any). Copy hint: "Works best with 2-3 active areas... Evening + Weekdays is a good fit for work-life-boundary reminders — they simply won't come up on a Saturday."
- Edit: title, timing flags, day_scope, active toggle. `energy_affinity` is Quokka-inferred, not a manual field.
- Delete: removes entirely (the `active` flag already covers "pause without losing the wording," so no separate soft-delete is needed).

No detail modal, no checklist, no tier system — intentionally the simplest CRUD surface in the app, on par with Labels.

---

## Server endpoints

Dedicated per-record endpoints (NOT part of the bulk `/api/data` blob — see Data model above):

| Endpoint | Purpose |
|---|---|
| `GET /api/growth-areas` | List all (including inactive, for the management UI) |
| `POST /api/growth-areas` | Create `{title, morning?, evening?, persistent?, day_scope?}`; server infers `energy_affinity` via a cheap Claude call, same conservative-by-default posture as tag inference |
| `PATCH /api/growth-areas/:id` | Update any subset of fields |
| `DELETE /api/growth-areas/:id` | Remove |
| `GET /api/growth-areas/today` | The cached daily picks `{date, morning, evening}` (either may be `null`/empty if no eligible areas that period/day) — computes + caches on first call of the day per period, served from cache after |

---

## Quokka integration

- `list_growth_areas()` — read-only
- `create_growth_area({ title, morning?, evening?, persistent?, day_scope? })` — `energy_affinity` inferred server-side, same as the REST path. Defaults to morning+persistent if none of the three timing flags are specified.
- `update_growth_area({ id, title?, morning?, evening?, persistent?, day_scope?, active? })`
- `delete_growth_area({ id })`

All staged through the normal mutation/compensation flow (capture pre-mutation state, restore on rollback). Natural-language entry points: "I want to work on being more patient, remind me every morning" → `create_growth_area({title: "Be more patient", morning: true})`. "Remind me to leave work at work, but only on workdays in the evening" → `create_growth_area({title: "Leave work at work", evening: true, day_scope: "weekdays"})`. "Stop showing the observant one" → `update_growth_area({..., active: false})`.

---

## Known limitations / parked

- No tracking is a **deliberate, locked** v1 choice — not a placeholder for a future check-in. If that's ever revisited it should be argued for fresh, not slipped in as an obvious next step.
- No AI-suggested growth areas (unlike tag/routine suggestions) — the user authors these directly. Sourcing suggestions from patterns Quokka notices in conversation is speculative and not requested.
- `energy_affinity` inference is best-effort and single-valued — an area like "be more patient" that could plausibly apply to several energy types just gets the model's best single guess. Not worth a multi-select for a two-input add form.
- `day_scope` is a blunt weekday/weekend split, not a per-day-of-week picker (no "Tuesdays and Thursdays only") — deliberately, to keep the control a single select rather than a 7-checkbox grid. Revisit only if the two-bucket split proves too coarse in practice.
- The evening cutoff (5pm local) that decides which cached pick the Today-view banner shows is hardcoded client-side, not a setting — simplicity over configurability for a first cut.
- Contextual injection depends on the model actually judging relevance well; if it over-triggers (mentioning the same area every time a matching-energy task shows up) that's a prompt-tuning problem to watch for after real use, not something mitigated further at ship time.
