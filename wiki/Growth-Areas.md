# Growth Areas (personal-coaching reminders)

An optional, deliberately tiny feature: the user defines a short list of things they want to work on about *themselves* — not tasks, not habits with completion tracking, just standing reminders ("be more observant," "be more patient on calls," "stay focused during deep work"). Boomerang resurfaces them on a cadence the user picks per item. This is the "life organizer, not just task manager" edge of the product — adjacent to Routines/Projects but explicitly **not** a task: nothing to check off, no streak, no points.

---

## Scope decisions (locked, per user)

- **No tracking.** Pure reminder text, resurfaced. No progress bar, no streak, no daily check-in prompt. If that changes later it's a deliberate v2, not an oversight.
- **Surfacing mode is per-area**, not a single global toggle:
  - `morning` — shown once, first thing in the day, then gets out of the way.
  - `persistent` — always visible somewhere, ambient.
  - `both` — shown as the morning nudge AND lives in the persistent strip.

---

## Data model

No new table — this is config-shaped data, same category as `labels` (CLAUDE.md: "Settings and labels remain in app_data as JSON blobs (intentional)"). New key: `app_data.growth_areas`, array of:

```json
{
  "id": "uuid",
  "title": "Be more observant",
  "mode": "both",
  "active": true,
  "created_at": "iso timestamp"
}
```

`active: false` keeps the item around (edit history / easy re-enable) without surfacing it — same soft-disable pattern used elsewhere in the app rather than deleting.

---

## Surfacing

**Morning (`morning` | `both`).**
1. Digest line — `digestBuilder.js` gains a new section (after the existing lead-in, before Today) listing active morning-mode areas: *"Today, work on: being more observant, staying patient on calls."* Rides whichever transports the digest already uses (push/email/Pushover) — no new transport.
2. Today-view banner — a small dismissible card at the top of the Kept Today view (above the Day Arc hero), same once-per-local-day dismissal model as everything else that's daily-scoped in this app (e.g., loop cycle windows bucket in `settings.user_timezone`). Dismissing hides it until the next local morning; it does **not** mark anything done because there's nothing to complete.

**Persistent (`persistent` | `both`).** A slim always-visible strip — a single line of chips, e.g. under the header or above the section list — listing active persistent-mode areas. No interaction beyond tapping to open the management sheet; this is ambient, not actionable.

**Both.** Simply satisfies both rules above — the item shows in the morning banner/digest AND sits in the persistent strip. Not a third rendering path.

---

## Management UI

A "Growth areas" entry in the System menu (alongside Settings/Analytics/Done/Suggestions/Activity log — matches the existing low-frequency-surface grouping). Simple list CRUD:

- Add: title + mode picker (morning / persistent / both)
- Edit: title, mode, active toggle
- Delete: removes entirely (no soft-delete needed beyond the existing `active` flag, which already covers "pause without losing the wording")

No detail modal, no checklist, no tier system — this is intentionally the simplest possible CRUD surface in the app, on par with Labels.

---

## Quokka integration

Standard CRUD, mirroring the Knowledge Base tools' shape (search/create/update/delete) but far smaller surface:

- `list_growth_areas()` — read-only
- `create_growth_area({ title, mode })`
- `update_growth_area({ id, title?, mode?, active? })`
- `delete_growth_area({ id })`

All staged through the normal mutation/compensation flow (capture the pre-mutation array, restore on rollback) — same shape as every other simple-array mutation tool, no external side effects to worry about.

Natural-language entry points: "I want to work on being more patient, remind me every morning" → `create_growth_area({title: "Be more patient", mode: "morning"})`. "Stop showing the observant one" → `update_growth_area({..., active: false})`.

---

## Known limitations / parked

- No tracking is a deliberate v1 choice (see Scope decisions), but if it's revisited later, the natural shape is a lightweight end-of-day check-in (thumbs up/down or 1-5) stored per area per day — explicitly NOT built now.
- No AI-suggested growth areas (unlike tag suggestions / routine suggestions) — the user authors these directly. Could eventually source suggestions from patterns Quokka notices in conversation, but that's speculative and not requested.
- No integration with notifications' quiet-hours or per-type toggles beyond riding the existing digest transports — a persistent-mode area showing in the UI strip has no notification component at all by design (ambient, not a push).
