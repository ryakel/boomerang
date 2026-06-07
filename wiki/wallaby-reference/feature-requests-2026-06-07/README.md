# Feature requests — 2026-06-07 (review pass)

User review of Wallaby with loggd comparisons. Captured here so nothing is lost
during the pause. ⚠️ Like the rest of `wallaby-reference/`, **delete before
promoting `dev → main`** (these are external loggd reference images + current
Boomerang state).

| File | What it shows |
|---|---|
| `01-edit-modal-boomerang-current.png` | **Boomerang** Wallaby Edit-task modal today — white default pills, doesn't match Wallaby. |
| `02-edit-sheet-loggd.png` | **loggd** add/edit sheet — compact pill *chips with dropdown carets* (☀️ Today · 🔴 High · 🏷️ Work · 🔁 Repeat), inline title/notes/+subtask, × cancel / ↑ submit. |
| `03-task-actionsheet-loggd.png` | **loggd** `⋯` action sheet — Reschedule (Tomorrow/Next week/Pick a date/No date) · Start Focus Timer · Edit · Delete. (Boomerang's `TaskActionSheet` already mirrors this.) |
| `04-todays-pulse-streaks-loggd.png` | **loggd** Today's Pulse — "🔥 Read 20 pages streak at risk! (9 days)" per-habit streak row with the day count. |
| `05-header-avatar-boomerang.png` | **Boomerang** header — the plain gradient avatar dot top-right the user wants replaced with an ↗ arrow. |

## The three requests (see Wallaby-Ideas.md → "Review pass 2026-06-07")

1. **Edit-task modal redesign** (real work) — re-skin the Wallaby `EditTaskModal`
   into loggd's language: compact pill *chips* with dropdowns for the common
   config (status / due / priority / energy / size), inline title + notes +
   subtasks, instead of the current rows of white segmented pills. Keep all of
   Boomerang's richer config — just present it in the chip language.
2. **Streaks in Today's Pulse** (new feature, easy) — the streak-at-risk row
   should name the habit AND show the streak length, e.g. "🔥 take meds streak
   at risk (9 days)". Extend the existing `atRisk` row in `HomeView`.
3. **Header avatar → ↗ arrow** (easy) — replace `.wb-header-avatar`'s plain
   gradient circle with an up-and-to-the-right arrow graphic (it opens
   Profile/"Your year", so growth-arrow fits; no real users).
