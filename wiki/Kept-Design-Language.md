# Kept — the Boomerang design language

> **Status (2026-06-10): approved direction, pre-implementation.** Chosen from a
> three-direction full-rebrand exploration (`brand-board.html`); prototypes live
> at `kept-preview.html` (mobile) and `kept-desktop.html` (desktop) — dev-only
> render harnesses, never shipped. This document is the single source of truth
> for the public-facing iOS + desktop redesign that replaces Wallaby.

**Why it exists.** Wallaby is a faithful study of loggd.life — close enough
(navy canvas, 5-color accent cycle, GitHub-style contribution grids, 5-tab IA,
the orange/green/yellow/red button stack) that shipping it publicly would read
as a clone. Kept keeps Wallaby's *spirit* — history-first glanceability, warm
dashboard energy, semantic clarity, friendly density — and rebuilds every
expression of it from Boomerang's own metaphor.

**The name.** A boomerang is thrown, it returns, and you *keep* it. The brand
verb set: **throw** (capture a task), **return** (snooze/recur — it comes
back), **catch** (complete), **kept** (your history — everything you caught).

---

## 1 · Identity pillars

1. **Arcs, not grids.** loggd is built on squares (heatmap cells, square
   checkboxes, card grids). Kept is built on circles and arcs: round day-dots,
   circular checks, streak *arcs* that physically bridge consecutive days, a
   semicircular day gauge, arc-tick section markers, the arc-into-catch brand
   mark. The arc is the boomerang's flight path; it appears at every scale.
2. **Night-gum + gold, never navy.** The dark canvas is a deep green-ink
   ("Nightgum"), the light canvas a warm green-tinted paper ("Linen"). The one
   hero color is gold-ochre. No popular productivity app — and certainly not
   loggd — lives in this palette.
3. **One hero color.** Gold carries primary actions, completion, progress, and
   focus. Everything else is hairlines, ink, and per-loop "feather" accents
   used *only* for identity (loop rings, tag dots, trail fills) — never for
   chrome. loggd sprays five equal accents across nav, buttons, and FABs; Kept
   doesn't.
4. **Hairline calm, dashboard warmth.** Structure comes from v2's heritage:
   hairline-separated lists, generous whitespace, heavy display titles. Cards
   are reserved for *modules* (the Day Arc, a loop's trail) — never for plain
   list rows. The serif display face keeps it human rather than dashboard-cold.
5. **Motion is flight.** Throw, return, catch — the signature micro-animations
   no other app has (§8).

---

## 2 · Brand assets

**The mark — "arc into catch."** An ochre arc descends into a dot (the
returning boomerang, caught), above an upturned ink curve (the open hand /
catch). At small sizes it reads as a sunrise-smile — keep that; it's the
friendliest accident in the system.

```svg
<svg viewBox="0 0 100 100" fill="none">
  <path d="M 22 52 C 30 18, 70 18, 78 52" stroke="#E3A93C" stroke-width="9" stroke-linecap="round"/>
  <circle cx="78" cy="52" r="7.5" fill="#E3A93C"/>
  <path d="M 30 70 C 42 82, 58 82, 70 70" stroke="#EFF3EC" stroke-width="8" stroke-linecap="round" opacity=".85"/>
</svg>
```
(The catch-curve takes the canvas ink color per palette: `#EFF3EC` on Nightgum,
`#1F2A22` on Linen.)

**Wordmark.** `boomerang.` — lowercase, Fraunces 700, with the period in gold.
The period is the caught dot from the mark; it terminates the name the way the
catch terminates the flight.

**App icon.** The mark centered on a Nightgum→deeper-green vertical gradient
(`#15211B → #0E1511`), rounded-square. Favicon/monochrome contexts: mark only,
single color. Splash: mark + wordmark on flat Nightgum/Linen per system mode.

**Asset checklist for implementation:** `Logo.jsx` replacement (mark, themable
via currentColor/tokens), `favicon.svg`, `icon-180/192/512.png`,
`apple-touch-icon.png`, Pushover application icon, README header.

---

## 3 · Color tokens (`--bm-*`)

Two first-class palettes; the app **follows the system setting** by default
(manual override stays in Settings). Both ship fully QA'd — neither is "the
alternate."

| Token | Nightgum (dark) | Linen (light) | Role |
|---|---|---|---|
| `--bm-bg` | `#101713` | `#F7F4EC` | canvas |
| `--bm-card` | `#18211B` | `#FFFFFF` | module cards |
| `--bm-card-2` | `#202B23` | `#EEEADF` | elevated / pressed |
| `--bm-hairline` | `rgba(238,243,236,.09)` | `rgba(31,42,34,.10)` | dividers |
| `--bm-hairline-strong` | `rgba(238,243,236,.17)` | `rgba(31,42,34,.20)` | outlines |
| `--bm-text` | `#EFF3EC` | `#1F2A22` | primary ink |
| `--bm-text-meta` | 56% ink | 58% ink | secondary |
| `--bm-text-faint` | 34% ink | 34% ink | tertiary |
| `--bm-gold` | `#E3A93C` | `#B8841C` | THE accent |
| `--bm-gold-soft` | gold @ 15% | gold @ 13% | tonal fills |
| `--bm-on-gold` | `#2A2106` | `#FFFBEF` | fg on gold fills |
| `--bm-danger` | `#D96C4A` | `#BA4B2C` | destructive (text-level) |
| `--bm-trail-empty` | ink @ 10% | ink @ 11% | unfilled day-dots |
| `--bm-scrim` | `rgba(5,9,7,.6)` | `rgba(31,42,34,.35)` | sheet backdrops |
| `--bm-shadow` / `--bm-shadow-pop` | palette-aware | palette-aware | elevation |

**Feathers** — per-loop/per-tag identity colors, warm-earth family. Assigned by
stable full-list index (the Wallaby `routineColors` rule carries over), user-
overridable per loop:

| Feather | Nightgum | Linen |
|---|---|---|
| Ochre | `#E3A93C` | `#B8841C` |
| Clay | `#D96C4A` | `#C24E2D` |
| Eucalypt | `#62B98B` | `#3D9A6B` |
| Billabong | `#6FA6C9` | `#41799C` |
| Ironbark | `#9D87D6` | `#7E61C7` |
| Heath | `#C77C9E` | `#B25579` |

Energy types map to feathers (desk→Billabong, people→Ironbark,
errand→Eucalypt, creative→Heath, physical→Clay) — retiring the Tailwind hexes
in `store.ENERGY_TYPES` at implementation time.

**Hard rules.** No raw hex in component CSS/JSX — every color goes through a
`--bm-*` token (the lesson from the Wallaby `--wb-on-action` cleanup is a
day-one rule here). Gold fills always pair with `--bm-on-gold` (dark ink on
gold in Nightgum — a deliberately un-loggd move; loggd puts white on
everything). Danger is text/outline-level only; no big red fills.

---

## 4 · Typography & shape

- **Display: Fraunces** (variable; 600–700, optical size on). Screen titles,
  card module titles, hero numerals (Day Arc count, streak numbers), the
  wordmark. The serif warmth is a primary differentiator from every grotesk
  dashboard app.
- **Body: DM Sans** (kept from v2) — rows, buttons, meta, charts.
- Scale: title 26–28 / module title 14.5–15 / row 14.5–15 / meta 12–12.5 /
  micro-label 10.5–11 (700, +0.1em tracking, uppercase).
- **Radii:** 10 (inputs/segments) · 14 (cards) · 22 (sheets) · circles for all
  checks, dots, and the Throw button. **Wing corner** — `22px 14px 14px 14px`
  — is reserved for ONE hero card per screen (Day Arc on Today; the trail card
  on a loop detail). Everything else is symmetric.
- **Hairline lists:** plain rows divided by `--bm-hairline`; cards never wrap
  plain lists. Tags render as **dot + text** (`• finance`), never filled pills.

---

## 5 · Signature data-viz (replaces every contribution grid)

All four live as standalone components (`FlightTrail`, `MonthDots`,
`DensityRibbon`, `DayArc`) shared verbatim between platforms.

1. **Flight Trail** — the default loop history. Rows of 14 round day-dots
   (2 weeks/row, ~10 weeks visible; mini variant = single 14-day row on list
   rows). Filled dots take the loop's feather at intensity-scaled opacity.
   **Consecutive done-days are bridged by a low arc stroke** above the dots —
   streaks are literally drawn as flights. This is the brand visual.
2. **Month Dots** — calendar view: numbered circle cells (outline = empty,
   feather fill = done), weekday-adjacent done-days bridged by the same arcs.
   Month stepper + "N days · %" footer carry over from Wallaby's detail.
3. **Density Ribbon** — the year view: weekly counts as a smooth area curve
   with a feather gradient fade. Replaces the 53-week grid everywhere
   (Flight log year activity, loop year view, analytics 52-week pattern).
4. **Day Arc** — the daily hero: a semicircular gauge sweeping gold from 0 to
   the points goal, hairline ticks at tenths, a gold tip-dot with ink center,
   the count in Fraunces beneath the apex. Sub-line: `N catches · N loops ·
   N pts left`. Tapping/clicking expands the records detail (current
   v2-home-stats behavior folds in here).

Data sources are unchanged: `completed_history`, `/api/analytics/history`,
`computeDailyStats` — Kept is a presentation swap.

---

## 6 · Mobile (iOS) — IA & components

**Bottom nav: 4 tabs + center Throw.** `Today · Loops · [Throw] · Tasks ·
More`. Tabs are ink/meta with gold active state + 4px dot — one accent, no
per-tab colors. **Throw** is a raised 56px gold circle carrying the brand mark:
tap = quick-capture sheet (title + smart date chips), long-press = full add.
Capture is the most important ADHD action; it owns the architectural center.
**Quokka lives in the header** (gold-tinted sparkle button, always one tap from
every screen), not in the nav — its plan-ready badge dots the bell.

- **Today** — header (mark + wordmark · Quokka · bell · avatar) → Day Arc hero
  (wing corner, date + `↻ N-day rally` chip) → **Today** task rows → **Loops**
  rows (feather ring icon · title · cadence/rally meta · mini Flight Trail ·
  feather-ringed catch circle). Stacks fan out exactly as Wallaby Home does.
- **Loops** — Trail/Month/Year via the single segmented style (underline
  indicator, gold); loop cards with full-width viz; detail keeps Wallaby's
  Streak/Best/Total + month calendar structure, restyled (stat row = hairline
  cells, not pill cards).
- **Tasks** — Upcoming/Backlog/Done segments, grouped sections with the
  arc-tick section label, swipe right-to-left = Catch / Delete, row tap = the
  action sheet (grabber, reschedule chips, "Throw it back — returns Mon",
  Edit, Delete).
- **More** — Arcs (projects), Flight log (profile), Analytics, Packages,
  Settings. Same drill-down pattern as Wallaby's More.
- **Editors** — the Wallaby chip editor carries over restyled (chips →
  hairline-outline, expanded pickers use gold-tint selection); "More options"
  full editor likewise. Full-page takeover + back arrow stays.
- **Sheets** — rounded-top 22, grabber, `--bm-scrim` backdrop.

**Checks:** tasks = gold-outline circles (muted hairline when snoozed/low);
loops = feather-outline circles; fills use the ring color with `--bm-on-gold`
ink check (feather fills use dark-ink check `#10241A`). **Snoozed rows** show
the dashed **`↩ returns Sat`** chip — the return is a first-class visual.

---

## 7 · Desktop — the command center

Not scaled-up mobile: a three-zone native-feeling workspace (prototype:
`kept-desktop.html`).

```
┌ sidebar 224 ┬ work surface (flex) ────────────┬ Today rail 308 ┐
│ wordmark    │ Title · view segs · search ⌘/   │ Day Arc card   │
│ [Throw ⌘K]  │ OVERDUE n  ── hairline rows     │ Loops today    │
│ Today       │ TODAY n    (sel row = card-2    │  (ring·title·  │
│ Tasks       │ UP NEXT n   + outline)          │   catch circle)│
│ Loops       │                                 │ rally-at-risk  │
│ Arcs        │                                 │ banner         │
│ ─ REVIEW ─  │                                 │                │
│ Flight log  │                                 │                │
│ Analytics   │                                 │                │
│ Packages    │                                 │                │
│ [Quokka]    │                                 │                │
│ Settings    ┴ kbd hint bar ──────────────────────────────────── │
```

- **Sidebar:** gold **"Throw a task ⌘K"** pill at top (the Throw button's
  desktop form); nav items with count badges; a persistent **Quokka card**
  (last exchange preview) above Settings — desktop Quokka opens as a right
  panel, not a modal.
- **Work surface:** view segments **List / Board / Timeline** — the existing
  Kanban survives as the Board mode (columns restyled: hairline lanes, no
  heavy card chrome); List is default. Selected row gets `card-2` fill +
  hairline outline and drives a right-side **detail panel** (the EditTaskModal
  drawer, restyled) that slides over the Today rail.
- **Today rail:** Day Arc card (wing corner), Loops-today checklist, streak-
  at-risk banner. The rail is the mobile Today screen folded into a column —
  same components, same order, which is what keeps the two platforms feeling
  like one product.
- **Keyboard-first:** persistent hint bar (`⌘K` throw · `J/K` move · `X` catch
  · `S` throw back · `E` edit · `Q` quokka · `?` help). Existing
  `useKeyboardShortcuts` maps over with `⌘K` added.

**Cross-platform coherence rules** (the contract that keeps iOS and desktop
"entirely different but coherent"): identical tokens, identical viz components,
identical row anatomy (check · title · meta/return-chip · feather dots),
identical naming and section labels, identical motion vocabulary. What changes
per platform: navigation chrome (bottom tabs + sheets vs sidebar + panels) and
information density — never the language.

---

## 8 · Motion & haptics

Vocabulary (200–300ms, custom spring `cubic-bezier(.3,1.4,.4,1)`-ish; all
gated on `prefers-reduced-motion`):

- **Catch** — check fills, a 2px gold dot arcs ~24px up-and-back into the
  check (the return), row settles 2px. iOS haptic: `.success` notification.
- **Throw back (snooze)** — row slides right with slight upward arc, fades;
  the `↩ returns` chip stamps in. Haptic: `.light` impact.
- **Throw (capture)** — the Throw button's mark rotates ~12° and springs back;
  the new row drops into the list with a soft arc. Haptic: `.medium` impact.
- **Rally tick** — when a catch extends a streak, the newest trail arc draws
  itself left-to-right (~240ms).
- **Day Arc** — sweeps to its value on screen entry (320ms ease-out), then
  only animates deltas.
- Surface transitions: 180ms fade + 8px slide. Sheets: 240ms spring rise.

---

## 9 · Voice & naming (hybrid)

Plain nouns for navigation — metaphor in verbs and moments. Never make the
user decode jargon to find something; let the personality live where it can't
confuse.

| Concept | UI label | Metaphor usage |
|---|---|---|
| Quick add | **Throw** (button) | "Throw a task" placeholder |
| Complete | check action | Toast: **"Caught it."** / "Nice catch — 3 today." |
| Snooze | Throw it back | Chip: **"↩ returns Tue"** |
| Routine | **Loops** (nav) | "loop closed" in recaps |
| Streak | streak | **"↻ N-day rally"** chip |
| Project | **Arcs** (nav) | "a long arc" in empty states |
| Profile/history | **Flight log** | year activity = "your flights" |

("Loops" and "Arcs" are the two metaphor nouns promoted to navigation — both
self-explanatory enough to pass the no-decoding rule; "Habits" and "Projects"
remain as subtitle glosses during transition, e.g. "Arcs · long-term
projects".)

---

## 10 · Accessibility

- Contrast floors: body ink ≥ 7:1 on canvas, meta ≥ 4.5:1, gold-on-canvas ≥
  3:1 for large/bold UI text only — gold never carries small body text;
  `--bm-on-gold` pairs are ≥ 7:1 in both palettes.
- Color is never the only signal: trail dots pair filled/empty shapes, streak
  arcs duplicate the rally number, feather identity pairs with the loop's
  icon, done-states strike through.
- Touch targets ≥ 44pt; the Throw button 56pt. Dynamic-type-friendly: rows
  wrap, viz components scale off a single `--bm-cell` custom prop (Wallaby
  heatmap pattern).
- Full reduced-motion variants (state changes swap instantly, no arcs drawn).

---

## 11 · Why this is legally & ethically distinct from loggd

| Axis | loggd / Wallaby | Kept |
|---|---|---|
| Canvas | deep navy | green-ink Nightgum / Linen paper |
| Accent model | 5 equal accents on chrome | one gold hero; feathers for identity only |
| History viz | GitHub contribution grid | Flight Trail dots + streak arcs / Density Ribbon |
| Geometry | squares, square cells, pills | circles, arcs, hairlines, dot-tags |
| Buttons | orange/green/yellow/red stack | gold fill · gold tonal · ghost · danger text |
| Fill foregrounds | white on everything | dark ink on gold |
| Nav | 5 flat color-coded tabs | 4 tabs + center Throw; sidebar command center on desktop |
| Type | grotesk throughout | Fraunces serif display + DM Sans |
| Identity moves | — | wing corner, arc-tick labels, `↩ returns` chip, throw/catch motion, `boomerang.` wordmark |

The retained *ideas* — glanceable per-habit history, a daily dashboard, a
range-segmented detail view — are unprotectable genre conventions shared by
every habit tracker; every *expression* of them above is original.

---

## 12 · Migration plan (Wallaby → Kept) — the rebuild IS the cleanup

Same reversible playbook that built Wallaby (parallel theme family, surface by
surface), but every phase retires technical debt. Kept must not become a THIRD
design language stacked on Wallaby + dormant Terminal — the end state is **one**
language and a structurally cleaner codebase.

- **K0 — Demolition (before any Kept code).** Execute the documented Terminal
  "didn't stick" teardown: `rm -rf src/v2/terminal/`, delete `useTerminalMode`,
  strip `terminalTitle`/`terminalCommand` props from every ModalShell/
  EmptyState/ConfirmDialog call site, drop both `check:terminal-*` CI scripts,
  keep only the `terminal-*` → theme migration shim in `loadSettings()`.
  Flatten `src/v2/` → `src/` (the deferred directory rename — `v2` is
  meaningless now that v1 is gone). Purge stale settings keys
  (`v1_disabled`, legacy `show_week_strip`) and consolidate the theme
  pre-paint/mount/picker maps into one shared module. Net: the bundle drops to
  exactly two languages (Standard + Wallaby) before Kept adds its own.
- **K1 — Brand + tokens.** New mark/wordmark/icons; `src/kept/palette.css`
  (`--bm-*`, `kept-dark`/`kept-light` + system-follow); Fraunces in
  `index.html`. **Cleanup baked in:** energy-type colors move into the token
  layer (feather mapping) with ONE source of truth — retiring the four
  duplicate energy color/icon definitions (`store.ENERGY_TYPES`, TaskCard,
  HomeView/HabitsView, WallabyEditTask).
- **K2 — Viz components.** `FlightTrail`, `MonthDots`, `DensityRibbon`,
  `DayArc` — built once, consumed identically by mobile and desktop. **Cleanup
  baked in:** one canonical date module (merging the two `localYMD`s +
  `parseLocalDate` into a single `src/dates.js` with the date-only-string
  contract documented), since every viz component depends on it.
- **K3 — Mobile shell.** KeptNav (4+Throw), header, Today, quick-capture
  sheet. **Cleanup baked in:** the AppV2 god-file split — KeptShell owns
  navigation/surface state, each surface container owns its own handlers and
  modal state; AppV2 shrinks to data-wiring + the shared-hook layer instead of
  ~40 useStates and every handler in one 1,600-line file.
- **K4 — Mobile surfaces.** Loops/detail, Tasks + action sheet, More, Arcs,
  Flight log; editors. **Rule: no reskin-by-override.** Kept surfaces are
  built Kept-first against `--bm-*` tokens; there will be NO
  `[data-theme^="kept"]` override stylesheets layered on shared components
  (the Wallaby `forms/settings/analytics/modals.css` override pattern — with
  its `!important`s and import-order traps — dies with Wallaby).
- **K5 — Desktop command center.** Sidebar, work surface (List default,
  Kanban as Board mode), Today rail, detail panel, ⌘K throw. SettingsModal
  gets split into per-tab panel files as it's restyled (the other god file).
- **K6 — Cutover + Wallaby teardown.** Default new installs to system-follow
  Kept; Wallaby demoted for one release, then `src/wallaby/` + every
  `[data-theme^="wallaby"]` override file is deleted (same teardown discipline
  as Terminal in K0). End state: ONE design language (Kept), Standard kept
  only as a minimal fallback or removed too — decided at cutover.
- **Throughout:** unit tests land with the pieces that keep regressing —
  the date module (K2) and scoring get real test coverage as they're touched,
  not after.

Each phase is an independently mergeable PR with screenshot verification in
both palettes (the Local-Verification-Harness runbook applies unchanged).
