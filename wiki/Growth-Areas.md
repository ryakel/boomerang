# Growth Areas (personal-coaching reminders)

An optional, deliberately tiny feature: the user defines a short list of things they want to work on about *themselves* — not tasks, not habits with completion tracking, just standing reminders ("be more observant," "be more patient on calls," "stay focused during deep work"). Boomerang resurfaces them. This is the "life organizer, not just task manager" edge of the product — adjacent to Routines/Projects but explicitly **not** a task: nothing to check off, no streak, no points.

**Revision note (2026-07-04):** rewritten after an adversarial design pass. The first draft's data model and CRUD were fine; its *delivery mechanism* — a static banner and a static always-visible chip strip, same 2-3 phrases every day — was the actual weak point: static, unchanging text in a fixed slot is textbook habituation bait, and a "coaching" feature that's dismissed on autopilot by day 4 isn't coaching, it's decoration. This revision keeps every locked scope decision (no tracking, per-area surfacing choice) and rebuilds *only* the delivery: rotation instead of a full list, fresh AI-rephrased wording instead of static text, and contextual delivery instead of a permanent chip.

---

## Scope decisions (locked, per user — unchanged)

- **No tracking.** Pure reminder text, resurfaced. No progress bar, no streak, no daily check-in prompt. A streak on "be more patient" would just manufacture guilt — patience isn't completable, so any check-in is either meaningless ritual or a daily self-report of failure. This is locked; if it's revisited, it's a deliberate v2 decision made in the open, not scope creep.
- **Surfacing choice is per-area** (unchanged as a config concept — the *mechanism* behind each choice is what changed, see below): `morning`, `persistent`, or `both`.

---

## Data model

`growth_areas` — its **own** `app_data` collection, deliberately kept **out of** the bulk `/api/data` PUT/POST sync blob (the whole-blob last-writer-wins path). CLAUDE.md's durability rules are explicit that cross-device-merged keys need a server-side guard and the streak-anchor incident happened *twice* via exactly this blob; the clean fix here is to never let growth areas ride that path at all rather than patch around it. Real per-record server endpoints instead (see below) — same protective shape as `tasks`/`routines`/`packages`, which are already carved out of `setAllData()` for the identical reason.

```json
{
  "id": "uuid",
  "title": "Be more observant",
  "mode": "both",
  "energy_affinity": "confrontation",
  "active": true,
  "created_at": "iso timestamp"
}
```

- `energy_affinity` *(optional, new)* — one of the existing energy types (`desk`/`people`/`errand`/`confrontation`/`creative`/`physical`), inferred by Quokka at creation time when a title implies one ("more patient on calls" → `confrontation` or `people`). Powers contextual delivery (below). Omit if there's no clean match — not every area maps to a task flavor.
- `active: false` keeps the item around (edit history / easy re-enable) without surfacing it.

---

## Surfacing (the part that was rebuilt)

The locked per-area `mode` choice still exists, but what each mode *does* changed. The first draft's `persistent` was a static always-visible chip strip; that's exactly the habituation trap, so it's gone as a UI element. Instead:

- **`morning`** — eligible for the once-daily rotation (below). Not injected into other surfaces.
- **`persistent`** — *not* shown as static chrome anywhere. Instead, always eligible for **contextual injection** (What Now + Quokka, below) — "persistent" now means "present wherever it's contextually relevant," not "permanently on screen." This is a closer match to what a coach actually does: speaks at the moment of relevance, not on a fixed schedule.
- **`both`** — eligible for the morning rotation AND contextual injection.

**1. Morning rotation — one area, not a list, and never the same wording twice.**

Each local morning, pick exactly **one** active area from the `morning ∪ both` pool via a stable rotation (day-of-year index mod pool size — deterministic, so re-opening the app the same day always shows the same pick, but tomorrow moves on). Never surface the whole list at once; a list is skimmed, one line lands. With a recommended 2-3 active areas, each gets meaningful attention a couple of mornings a week instead of a daily blur — and it quietly caps the "I optimistically added nine areas one evening" problem, since the surface never grows just because the list does.

The picked area's stored `title` is a stable intent ("be more observant"); what's actually shown is a **fresh AI rendering of it**, generated fresh each day — reusing the same shape as the existing toast-message pipeline (`generateToastMessages()` in `src/api.js`: a short prompt, a 3-second timeout, a static fallback if the AI doesn't answer in time). Example: stored "be more observant" → surfaced "Notice one thing on your commute you'd normally walk past." Novelty is what defeats banner blindness; this is the single highest-leverage piece of the whole feature and needs zero new user-facing config — the user still only ever types a title.

Computed **once per day, server-side, and cached** (`app_data.growth_area_today = { date, area_id, text }`) so the digest and the client banner show the *same* pick and text without two independent AI calls or a chance of disagreeing. Static fallback (AI unavailable/slow) is just the area's own stored title, unmodified — never a blank surface.

Surfaced in two places, both reading the same cached pick:
1. **Digest line** — `digestBuilder.js` gains a section (after the lead-in, before Today): "☀️ Today: {surfaced text}". Rides whichever transports the digest already uses.
2. **Today-view banner** — a small dismissible card at the top of the Kept Today view (above the Day Arc hero). Dismiss hides it until the next local morning (bucketed in `settings.user_timezone`, same pattern as everything else daily-scoped in this app). No completion semantics — dismissing isn't "doing" anything, it's just "seen."

**2. Contextual injection — the actual "coaching," not the morning notice.**

A morning banner about staying patient on calls has evaporated by the 2pm call it was actually relevant to. The app already knows task energy types, so:
- **What Now** (`getWhatNow()`): the active `persistent`/`both` areas (with `energy_affinity` set) are passed alongside the existing weather-summary context. When the model picks a task whose energy matches an area's affinity, it may add one line — "…and this one's a rep for staying patient" — **only when genuinely relevant**, mirroring the existing rule that weather is only mentioned in the reason when it actually affects the pick. Never forced onto every response.
- **Quokka**: active growth areas (title + affinity, compact) are folded into the system prompt context, so "help me plan this call" or "I'm dreading this one" naturally gets a coaching-flavored response when it's actually relevant, without the user having to bring it up first.

Both reuse the *same* underlying small helper — a "does this task/context match an active area, and if so what's the one-line nudge" function — rather than two independent implementations, since the model input is the same question (task energy + active areas) asked from two call sites.

---

## Management UI

A "Growth areas" entry in the System menu (alongside Settings/Analytics/Done/Suggestions/Activity log). Simple list CRUD:

- Add: title + mode picker (morning / persistent / both). Copy hint: "Works best with 2-3 active areas — a longer list just means each one is seen less often."
- Edit: title, mode, active toggle. `energy_affinity` is Quokka-inferred, not a manual field — keeps the add-form to two inputs.
- Delete: removes entirely (the `active` flag already covers "pause without losing the wording," so no separate soft-delete is needed).

No detail modal, no checklist, no tier system — intentionally the simplest CRUD surface in the app, on par with Labels.

---

## Server endpoints

Dedicated per-record endpoints (NOT part of the bulk `/api/data` blob — see Data model above):

| Endpoint | Purpose |
|---|---|
| `GET /api/growth-areas` | List all (including inactive, for the management UI) |
| `POST /api/growth-areas` | Create `{title, mode}`; server infers `energy_affinity` via a cheap Claude call, same conservative-by-default posture as tag inference |
| `PATCH /api/growth-areas/:id` | Update any subset of fields |
| `DELETE /api/growth-areas/:id` | Remove |
| `GET /api/growth-areas/today` | The cached daily rotation pick `{area, text}` (or `null` if no active morning/both areas) — computes + caches on first call of the day, served from cache after |

---

## Quokka integration

- `list_growth_areas()` — read-only
- `create_growth_area({ title, mode })` — `energy_affinity` inferred server-side, same as the REST path
- `update_growth_area({ id, title?, mode?, active? })`
- `delete_growth_area({ id })`

All staged through the normal mutation/compensation flow (capture pre-mutation state, restore on rollback). Natural-language entry points: "I want to work on being more patient, remind me every morning" → `create_growth_area({title: "Be more patient", mode: "morning"})`. "Stop showing the observant one" → `update_growth_area({..., active: false})`.

---

## Known limitations / parked

- No tracking is a **deliberate, locked** v1 choice — not a placeholder for a future check-in. If that's ever revisited it should be argued for fresh, not slipped in as an obvious next step.
- No AI-suggested growth areas (unlike tag/routine suggestions) — the user authors these directly. Sourcing suggestions from patterns Quokka notices in conversation is speculative and not requested.
- `energy_affinity` inference is best-effort and single-valued — an area like "be more patient" that could plausibly apply to several energy types just gets the model's best single guess. Not worth a multi-select for a two-input add form.
- Contextual injection depends on the model actually judging relevance well; if it over-triggers (mentioning the same area every time a matching-energy task shows up) that's a prompt-tuning problem to watch for after real use, not something mitigated further at ship time.
